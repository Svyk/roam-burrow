// Shared fixture for the live gates: a `Burrow/Fixtures` page with one fresh
// block created for this run, opened in the right sidebar, plus a key guard.
// The guard swallows every trusted key whose target is not that block's
// textarea (after Escape Roam leaves the block *selected*, and a stray
// Backspace would delete it). Cleanup deletes only what the run created.

// A small heading tree for the drill gates, created on the fixture page:
//   Alpha section (h2) > first child note, never grok for writing > grandchild one, third item
//   Beta section (h2) > beta child
export const DRILL_TREE = [
  { key: "alpha", string: "Alpha section", heading: 2, children: [
    { key: "first", string: "first child note" },
    { key: "never", string: "never grok for writing", children: [{ key: "grand", string: "grandchild one" }] },
    { key: "third", string: "third item" },
  ] },
  { key: "beta", string: "Beta section", heading: 2, children: [{ key: "betaChild", string: "beta child" }] },
  // Two referenced blocks that rank the same in (( (the pick-memory case).
  { key: "pickA", string: "zebra burrow pick one" },
  { key: "pickB", string: "zebra burrow pick two" },
];

// Aliases of the `<fixture> Chips` page: more than one chip line holds.
export const CHIP_ALIASES = ["zq chip alpha long alias", "zq chip bravo long alias", "zq chip charlie long alias", "zq chip delta long alias",
  "zq chip echo long alias", "zq chip foxtrot long alias", "zq chip golf long alias", "zq chip hotel long alias"];

// The gates use this page; BURROW_FIXTURE_PAGE picks another when a crashed run left a stale tree.
export const FIXTURE_PAGE = process.env.BURROW_FIXTURE_PAGE || "Burrow/Fixtures";

export async function setupFixture(c, { drillTree = false } = {}) {
  return c.evaluate(async ({ drillTree, tree, title, aliases }) => {
    const api = window.roamAlphaAPI;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const created = { page: false, sidebar: false };
    let pageUid = api.q(`[:find ?u . :where [?p :node/title "${title}"] [?p :block/uid ?u]]`);
    if (drillTree && pageUid && api.q(`[:find ?b . :where [?p :block/uid "${pageUid}"] [?p :block/children ?b] [?b :block/string "Alpha section"]]`)) {
      throw new Error(`stale fixture tree on ${title}: rerun with BURROW_FIXTURE_PAGE=<other title>`);
    }
    if (!pageUid) {
      pageUid = api.util.generateUID();
      await api.data.page.create({ page: { title, uid: pageUid } });
      created.page = true;
    }
    // An empty page for the "nothing to drill into" Tab case.
    const emptyTitle = `${title} Empty`;
    let emptyUid = api.q(`[:find ?u . :where [?p :node/title "${emptyTitle}"] [?p :block/uid ?u]]`);
    created.emptyPage = false;
    if (!emptyUid) {
      emptyUid = api.util.generateUID();
      await api.data.page.create({ page: { title: emptyTitle, uid: emptyUid } });
      created.emptyPage = true;
    }
    // A page with more aliases than one chip line holds, for the chip scroll case.
    const chipsTitle = `${title} Chips`;
    let chipsUid = api.q(`[:find ?u . :where [?p :node/title "${chipsTitle}"] [?p :block/uid ?u]]`);
    created.chipsPage = false;
    if (!chipsUid) {
      chipsUid = api.util.generateUID();
      await api.data.page.create({ page: { title: chipsTitle, uid: chipsUid } });
      await api.data.block.create({ location: { "parent-uid": chipsUid, order: 0 }, block: { string: `Aliases:: ${aliases.join(", ")}` } });
      created.chipsPage = true;
    }
    // The drill tree goes in before the typing block and before keepAll, so
    // the gates never count it as a block Roam created.
    const drill = {};
    created.drill = [];
    if (drillTree) {
      const make = async (nodes, parent) => {
        for (const n of nodes) {
          const uid = api.util.generateUID();
          await api.data.block.create({ location: { "parent-uid": parent, order: "last" }, block: { string: n.string, uid, ...(n.heading ? { heading: n.heading } : {}) } });
          drill[n.key] = uid;
          if (parent === pageUid) created.drill.push(uid);
          if (n.children) await make(n.children, uid);
        }
      };
      await make(tree, pageUid);
      const refsUid = api.util.generateUID();
      await api.data.block.create({ location: { "parent-uid": pageUid, order: "last" }, block: { string: `refs ((${drill.pickA})) ((${drill.pickB}))`, uid: refsUid } });
      created.drill.push(refsUid);
    }
    const blockUid = api.util.generateUID();
    await api.data.block.create({ location: { "parent-uid": pageUid, order: "last" }, block: { string: "", uid: blockUid } });
    const windowId = `sidebar-outline-${pageUid}`;
    if (!api.ui.rightSidebar.getWindows().some((w) => w["window-id"] === windowId)) {
      await api.ui.rightSidebar.addWindow({ window: { type: "outline", "block-uid": pageUid } });
      created.sidebar = true;
    }
    await sleep(900);
    const keepAll = api.q(`[:find [?u ...] :where [?p :block/uid "${pageUid}"] [?b :block/page ?p] [?b :block/uid ?u]]`) || [];
    const inputId = `block-input-${windowId}-${blockUid}`;
    const guard = { aborted: [], armed: true };
    guard.onKeyDown = (e) => {
      if (!guard.armed || !e.isTrusted) return;
      // Backspace into an empty block would merge it into its sibling.
      if (e.target?.id === inputId && !(e.key === "Backspace" && e.target.value === "")) return;
      // Escape only clears Roam's block selection; it is how the harness
      // gets out of the selected state, so it may pass.
      if (e.key === "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      guard.aborted.push(`${e.key} on ${e.target?.tagName}#${e.target?.id || ""}`);
    };
    // A run that died before cleanup leaves its guard armed, and that guard
    // would swallow every key aimed at this run's block. Guards live in one
    // registry, so a new fixture removes any left over.
    for (const old of window.__burrowGuards || []) window.removeEventListener("keydown", old, true);
    window.__burrowGuards = [guard.onKeyDown];
    window.addEventListener("keydown", guard.onKeyDown, true);
    window.__burrowFixture = { pageUid, blockUid, windowId, inputId, created, keepAll, guard, drill, emptyTitle, emptyUid, chipsTitle, chipsUid };
    return { pageUid, blockUid, windowId, created, drill, chipsTitle };
  }, { drillTree, tree: DRILL_TREE, title: FIXTURE_PAGE, aliases: CHIP_ALIASES });
}

// After Escape Roam keeps the block *selected*, and that selection survives
// a programmatic focus: the next Backspace then deletes the whole block
// (checked with Burrow unloaded; it is Roam's behavior). Clear it first.
const selectedCount = (c) => c.evaluate(() => {
  const api = window.roamAlphaAPI;
  const dom = document.querySelectorAll(".block-highlight-blue, .rm-block--selected, .block-highlight").length;
  return dom + (api.ui.multiselect?.getSelected?.().length || 0) + (api.ui.individualMultiselect?.getSelectedUids?.().length || 0);
});

export async function clearSelection(c) {
  for (let i = 0; i < 4; i++) {
    if (!(await selectedCount(c))) return true;
    await c.evaluate(() => { if (document.activeElement?.tagName === "TEXTAREA") document.activeElement.blur(); });
    await c.key("Escape");
    await new Promise((r) => setTimeout(r, 120));
  }
  return !(await selectedCount(c));
}

// Blur, set the fixture string, focus it with the caret at the end.
export async function primeFixture(c, seed) {
  if (!(await clearSelection(c))) return { ok: false, reason: "block selection would not clear" };
  return c.evaluate(async (seed) => {
    const api = window.roamAlphaAPI;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (cond, ms) => {
      const t0 = performance.now();
      while (!cond() && performance.now() - t0 < ms) await sleep(30);
      return cond();
    };
    const g = window.__burrowFixture;
    const stored = () => api.q(`[:find ?s . :where [?b :block/uid "${g.blockUid}"] [?b :block/string ?s]]`);
    if (document.activeElement?.tagName === "TEXTAREA") document.activeElement.blur();
    await sleep(60);
    await api.data.block.update({ block: { uid: g.blockUid, string: seed } });
    await until(() => stored() === seed, 1500);
    const focused = () => document.activeElement?.id === g.inputId && document.activeElement.value === seed;
    // The encrypted graph can take a moment longer to mount the editor.
    for (let i = 0; i < 6 && !focused(); i++) {
      await api.ui.setBlockFocusAndSelection({ location: { "block-uid": g.blockUid, "window-id": g.windowId }, selection: { start: seed.length } });
      await until(focused, 1200);
    }
    const ta = document.activeElement;
    return { ok: focused(), value: ta?.value, caret: ta?.selectionStart };
  }, seed);
}

export async function guardReport(c) {
  return c.evaluate(() => window.__burrowFixture?.guard.aborted.splice(0) || []);
}

export async function cleanupFixture(c, { keep = false } = {}) {
  return c.evaluate(async ({ keep }) => {
    const api = window.roamAlphaAPI;
    const g = window.__burrowFixture;
    if (!g) return null;
    g.guard.armed = false;
    window.removeEventListener("keydown", g.guard.onKeyDown, true);
    window.__burrowGuards = (window.__burrowGuards || []).filter((h) => h !== g.guard.onKeyDown);
    if (document.activeElement?.tagName === "TEXTAREA") document.activeElement.blur();
    await new Promise((r) => setTimeout(r, 300));
    const exists = api.q(`[:find ?e . :where [?e :block/uid "${g.blockUid}"]]`);
    if (keep) {
      if (exists) await api.data.block.update({ block: { uid: g.blockUid, string: "" } });
      return { kept: true, blockExists: Boolean(exists) };
    }
    if (exists) await api.data.block.delete({ block: { uid: g.blockUid } });
    for (const uid of g.created.drill || []) await api.data.block.delete({ block: { uid } });
    if (g.created.sidebar) await api.ui.rightSidebar.removeWindow({ window: { type: "outline", "block-uid": g.pageUid } });
    if (g.created.page) {
      const left = api.q(`[:find (count ?b) . :where [?p :block/uid "${g.pageUid}"] [?b :block/page ?p]]`) || 0;
      if (!left) await api.data.page.delete({ page: { uid: g.pageUid } });
    }
    if (g.created.emptyPage) {
      const p = api.pull("[:block/uid {:block/children [:db/id]} {:block/_refs [:db/id]}]", [":block/uid", g.emptyUid]);
      if (p && !p[":block/children"]?.length && !p[":block/_refs"]?.length) await api.data.page.delete({ page: { uid: g.emptyUid } });
    }
    if (g.created.chipsPage) {
      const p = api.pull("[:block/uid {:block/children [:block/string]} {:block/_refs [:db/id]}]", [":block/uid", g.chipsUid]);
      const kids = p?.[":block/children"] || [];
      if (p && kids.length === 1 && kids[0][":block/string"].startsWith("Aliases:: zq chip") && !p[":block/_refs"]?.length) {
        await api.data.page.delete({ page: { uid: g.chipsUid } });
      }
    }
    window.__burrowFixture = null;
    return { blockExists: Boolean(exists) };
  }, { keep });
}

// Titles that exist now, so a run can delete exactly the pages it caused.
export async function snapshotTitles(c) {
  return c.evaluate(() => {
    window.__burrowTitles = new Set(window.roamAlphaAPI.q("[:find [?t ...] :where [?p :node/title ?t]]"));
    return window.__burrowTitles.size;
  });
}

// Pages created since snapshotTitles: an unclosed `[[x` saved by Roam. Only
// pages that are empty and that nothing links to are deleted.
export async function deleteNewPages(c) {
  return c.evaluate(async () => {
    const api = window.roamAlphaAPI;
    const before = window.__burrowTitles || new Set();
    const created = api.q("[:find [?t ...] :where [?p :node/title ?t]]").filter((t) => !before.has(t));
    const deleted = [];
    for (const t of created) {
      const p = api.pull("[:block/uid {:block/children [:db/id]} {:block/_refs [:db/id]}]", [":node/title", t]);
      if (p && !p[":block/children"]?.length && !p[":block/_refs"]?.length) {
        await api.data.page.delete({ page: { uid: p[":block/uid"] } });
        deleted.push(t);
      }
    }
    return { created, deleted };
  });
}
