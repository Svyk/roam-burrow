// Lazy page-tree cache for drill (spec §5). A whole-page pull is 377 ms on
// the largest notes page (28k blocks), so nodes are pulled on demand instead:
// one pull per node the drill visits (the node, its children and
// grandchildren: 2 ms on that page), one heading lookup per page, one
// upward pull per resolved node for its trail. All of it is kept until the
// popup closes; a keystroke that stays on cached nodes reads no data.
// The grandchildren carry their children's uids only, so a leaf is known to
// be a leaf without another pull.
const TWO_LEVELS = `[:block/uid :node/title :block/string :block/heading :block/order
  {:block/children [:block/uid :block/string :block/heading :block/order
    {:block/children [:block/uid :block/string :block/heading :block/order {:block/children [:block/uid]}]}]}]`;
const UP = "[:block/uid :node/title :block/string :block/heading :block/order {:block/_children ...}]";
// Joining :block/string or filtering ?h inside the query costs up to 40 ms;
// heading datoms of one page by eid cost 2-18 ms, then a pull per heading.
const PAGE_ID = "[:db/id]";
const HEADINGS = "[:find ?b ?h :in $ ?p :where [?b :block/page ?p] [?b :block/heading ?h]]";
const HEADING = "[:block/uid :block/string :block/heading :block/order]";

// A DFS for "first heading in the outline" stops after this many nodes.
const FIRST_SCAN_LIMIT = 3000;

export function createTreeSource({ pull, q, onFetch }) {
  const nodes = new Map();
  const headingsByPage = new Map();
  const trails = new Map();

  const node = (raw) => {
    const uid = raw[":block/uid"];
    let n = nodes.get(uid);
    if (!n) {
      n = { uid, string: raw[":block/string"] ?? null, title: raw[":node/title"] ?? null,
        heading: raw[":block/heading"] || 0, order: raw[":block/order"] ?? 0, kids: null };
      nodes.set(uid, n);
    } else if (n.string == null && raw[":block/string"] != null) {
      n.string = raw[":block/string"];
      n.heading = raw[":block/heading"] || 0;
      n.order = raw[":block/order"] ?? n.order;
    }
    return n;
  };
  const sortKids = (raw) => [...(raw[":block/children"] || [])].sort((a, b) => (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0));

  function load(uid) {
    onFetch?.("pull");
    const raw = pull(TWO_LEVELS, [":block/uid", uid]);
    if (!raw) return [];
    const self = node(raw);
    self.kids = sortKids(raw).map((child) => {
      const c = node(child);
      c.kids = sortKids(child).map((grand) => {
        const g = node(grand);
        if (!g.kids && !grand[":block/children"]?.length) g.kids = [];
        return g;
      });
      return c;
    });
    return self.kids;
  }

  function children(uid) {
    return nodes.get(uid)?.kids || load(uid);
  }

  // Children whose own children are known too (the preview shows two levels).
  function twoLevels(uid) {
    const kids = children(uid);
    return kids.some((k) => k.kids == null) ? load(uid) : kids;
  }

  function headings(pageUid) {
    if (headingsByPage.has(pageUid)) return headingsByPage.get(pageUid);
    onFetch?.("query");
    const page = pull(PAGE_ID, [":block/uid", pageUid]);
    const rows = page ? q(HEADINGS, page[":db/id"]) || [] : [];
    const list = [];
    for (const [eid, heading] of rows) {
      if (!(heading > 0)) continue;
      const raw = pull(HEADING, eid);
      if (raw) list.push(node(raw));
    }
    headingsByPage.set(pageUid, list);
    return list;
  }

  // Ancestors from the page down to the parent: [{uid, title|string, order}].
  function trail(uid) {
    if (trails.has(uid)) return trails.get(uid);
    onFetch?.("pull");
    const raw = pull(UP, [":block/uid", uid]);
    const chain = [];
    let at = raw?.[":block/_children"]?.[0];
    while (at) {
      chain.unshift(node(at));
      at = at[":block/_children"]?.[0];
    }
    const self = raw ? node(raw) : null;
    if (self && raw[":block/order"] != null) self.order = raw[":block/order"];
    trails.set(uid, chain);
    return chain;
  }

  // The first of `candidates` in outline order: a DFS from the page that
  // stops at the first candidate (headings usually sit near the top). Past
  // the scan limit, ancestor orders decide.
  function first(candidates) {
    const want = new Set(candidates.map((c) => c.uid));
    const page = trail(candidates[0].uid)[0];
    if (page) {
      let seen = 0;
      const stack = [page.uid];
      while (stack.length && seen < FIRST_SCAN_LIMIT) {
        const uid = stack.pop();
        seen += 1;
        if (want.has(uid)) return nodes.get(uid);
        const kids = children(uid);
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i].uid);
      }
    }
    const path = (c) => trail(c.uid).slice(1).map((a) => a.order).concat(nodes.get(c.uid)?.order ?? 0);
    return [...candidates].sort((a, b) => {
      const pa = path(a); const pb = path(b);
      for (let i = 0; i < Math.min(pa.length, pb.length); i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
      return pa.length - pb.length;
    })[0];
  }

  return {
    children,
    twoLevels,
    headings,
    trail,
    first,
    get: (uid) => nodes.get(uid) || null,
    clear() { nodes.clear(); headingsByPage.clear(); trails.clear(); },
    get size() { return nodes.size; },
  };
}
