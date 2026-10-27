import { aliasRowsFromPull, buildAliasIndex, keywordTitles, setAliasRefs } from "./aliases.js";
import { aliasKeyTargets, buildRefIndexSliced, rekeyAliases } from "./refindex.js";
import { RECENT_DAYS, latestEdits, pullBlocks } from "./recents.js";
import { buildTitleIndex } from "./titles.js";

const TTL_MS = 60_000;
// The full rebuild's referenced-blocks query holds the main thread (about
// 0.3 s in svy; Roam's async query runs there too), so it never starts while
// a popup is open or within this long of the last key, click or edit: it
// waits for a quiet moment instead of starting when a popup opens.
const QUIET_MS = 2_000;
const POPUP = ".rm-autocomplete__results";
// An alias edit outside Burrow (by hand, roam-aliases, an undo) reaches the
// index this long after Roam's watch reports it; edits in a burst coalesce.
const ALIAS_SETTLE_MS = 250;
// The re-key after an alias edit runs in idle slices this long at most (plus
// the one block in hand).
const REKEY_SLICE_MS = 3;

const REFERENCED_BLOCKS = `[:find ?u ?s (count ?r) ?pt
  :where [?r :block/refs ?b] [?b :block/string ?s] [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?pt]]`;
// The blocks edited in the last RECENT_DAYS days with their pages (recent
// rows, spec §18): about 180 ms on the main thread in a 114k-block graph, so
// it runs only inside the quiet build, with the long query above.
const EDITED_SINCE = `[:find ?u ?t ?pu ?pt :in $ ?since
  :where [?b :edit/time ?t] [(> ?t ?since)] [?b :block/uid ?u] [?b :block/page ?p] [?p :block/uid ?pu] [?p :node/title ?pt]]`;
const TITLES = "[:find ?t ?u :where [?p :node/title ?t] [?p :block/uid ?u]]";
const WITH_CONTENT = "[:find [?t ...] :in $ [?t ...] :where [?p :node/title ?t] [?p :block/children ?c]]";
// The blocks that reference an alias attribute page, read with one pull per
// spelling of the keyword (1-2 ms in svy; the equivalent datalog query blocks
// the main thread for 70 ms). Roam re-runs the same pull for the watch.
export const ALIAS_PULL = "[{:block/_refs [:block/string {:block/page [:node/title :block/uid]}]}]";
const ALIAS_REFS = "[:find ?u (count ?r) :in $ [?u ...] :where [?p :block/uid ?u] [?r :block/refs ?p]]";

// Both indexes are built at idle and refreshed lazily when a popup opens and
// they are older than the TTL. Nothing here runs on a keystroke.
const yieldTo = () => new Promise((resolve) => setTimeout(resolve, 0));

export function createIndexes({ api, perf, setting, idle, lifecycle = null, win = globalThis, doc = globalThis.document ?? null, now = () => performance.now() }) {
  let aliases = null;
  let refs = null;
  let titles = null;
  let recent = null;
  let builtAt = 0;
  let keyword = null;
  let pending = false;
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) { try { fn(); } catch (error) { console.error("[burrow] index listener failed", error); } } };

  // data.async.fast.q keeps the scan off the keystroke path where Roam
  // offers it; the sync form is the fallback.
  const q = (query, ...args) => {
    perf.counters.queries += 1;
    const asyncQ = api.data.async?.fast?.q;
    return asyncQ ? asyncQ(query, ...args) : Promise.resolve(api.data.fast.q(query, ...args));
  };

  // The last pull of each alias page's refs: read here, or handed over by
  // that page's watch, which pulls the same pattern on every change.
  const pulled = new Map();
  // [blockString, pageTitle, pageUid] for every block on an alias page's
  // refs, each tuple once (as the datalog query it replaces returned them).
  // only: the spellings to read (the watched pages), else every spelling.
  // fresh: pull them now, else take the watches' last pulls.
  const readAliasRows = (kw, only = null, fresh = true) => {
    const rows = new Map();
    for (const title of only?.length ? only : keywordTitles(kw)) {
      if (fresh || !pulled.has(title)) {
        perf.counters.aliasPulls = (perf.counters.aliasPulls || 0) + 1;
        pulled.set(title, api.pull(ALIAS_PULL, [":node/title", title]));
      }
      for (const row of aliasRowsFromPull(pulled.get(title))) rows.set(row.join("\u0000"), row);
    }
    return [...rows.values()];
  };

  // One pull watch per spelling of the keyword's page: it fires when a block
  // that references the page is created, edited, moved or deleted, and when
  // a block gains or loses the `Keyword::` prefix; edits elsewhere never fire
  // it. Roam calls it with the pull before and after the change. A page that
  // does not exist yet is watched too: the watch fires when the first
  // `Aliases::` block typed by hand creates it (checked live).
  const watches = new Map();
  let settleTimer = null;
  let watchCalls = 0;
  const watchOf = (title) => (_before, after) => {
    pulled.set(title, after);
    watchCalls += 1;
    if (settleTimer != null) win.clearTimeout(settleTimer);
    settleTimer = win.setTimeout(() => { settleTimer = null; refreshAliases(); }, ALIAS_SETTLE_MS);
  };
  // Returns whether it started watching a page it did not watch before.
  const syncWatches = (kw) => {
    const addWatch = api.data?.addPullWatch;
    if (!lifecycle || lifecycle.disposed || typeof addWatch !== "function") return false;
    let added = false;
    const wanted = new Set(keywordTitles(kw));
    for (const [title, watch] of watches) {
      if (wanted.has(title)) continue;
      api.data.removePullWatch(ALIAS_PULL, watch.entity, watch.cb);
      watches.delete(title);
      pulled.delete(title);
    }
    for (const title of wanted) {
      if (watches.has(title)) continue;
      const watch = { entity: `[:node/title ${JSON.stringify(title)}]`, cb: watchOf(title) };
      api.data.addPullWatch(ALIAS_PULL, watch.entity, watch.cb);
      watches.set(title, watch);
      added = true;
    }
    return added;
  };
  lifecycle?.add(() => {
    if (settleTimer != null) win.clearTimeout(settleTimer);
    for (const watch of watches.values()) api.data.removePullWatch(ALIAS_PULL, watch.entity, watch.cb);
    watches.clear();
    pulled.clear();
    listeners.clear();
  });

  // Aliases alone, from the pulls: the alias index, the titles' alias
  // spellings and the (( alias expansion. Reference counts of pages already
  // known are kept; a new alias page gets its count at the next full build.
  // Idle tasks: the rows (from the watches' last pulls; a pull only when no
  // page is watched yet); then, only if they differ from the last ones read,
  // the swap; then the new alias keys of the blocks that link a changed page,
  // in slices, and an open popup re-ranks. force: swap even so (perf-gate).
  let aliasPrint = null;
  const printOf = (rows) => rows.map((row) => row.join("\u0000")).join("\u0001");
  function refreshAliases({ force = false, fresh = false } = {}) {
    idle(() => {
      if (lifecycle?.disposed) return;
      const kw = setting("aliasKeyword") || "Aliases";
      if (!aliases || !titles || !refs || kw !== keyword) { schedule(); return; }
      const t0 = performance.now();
      const rows = readAliasRows(kw, [...watches.keys()], fresh || !watches.size);
      const print = printOf(rows);
      perf.push("aliasRead", performance.now() - t0);
      if (print === aliasPrint && !force) return;
      idle(() => swapAliases(kw, rows, print));
    });
  }
  // The re-key in progress: { refs, entries, at, keys }. A newer swap takes
  // over the blocks it has not reached; a full build drops it.
  let rekey = null;
  function swapAliases(kw, rows, print) {
    if (lifecycle?.disposed || !aliases || kw !== keyword) return;
    const t0 = performance.now();
    const next = buildAliasIndex(rows, kw, aliases.memo);
    setAliasRefs(next, [...aliases.refsByPage]);
    titles.setAliases(next);
    const left = rekey?.refs === refs ? rekey.entries.slice(rekey.at) : [];
    const entries = [...new Set([...left, ...aliasKeyTargets(refs, next.byPage, aliases.byPage)])];
    aliases = next;
    aliasPrint = print;
    perf.push("aliasRefresh", performance.now() - t0);
    const run = rekey = { refs, entries, at: 0, keys: new Map() };
    idle(() => rekeyStep(run));
  }
  function rekeyStep(run) {
    if (lifecycle?.disposed || rekey !== run || refs !== run.refs) return;
    const t0 = performance.now();
    run.at = rekeyAliases(refs, run.entries, aliases.byPage, { from: run.at, stop: () => performance.now() - t0 > REKEY_SLICE_MS, keys: run.keys }).next;
    perf.push("aliasRekey", performance.now() - t0);
    if (run.at < run.entries.length) { idle(() => rekeyStep(run)); return; }
    rekey = null;
    perf.counters.aliasRefreshes = (perf.counters.aliasRefreshes || 0) + 1;
    notify();
  }

  // Last key, click or edit anywhere in the window (Burrow's own listeners
  // stamp it), for the rebuild's quiet check.
  let lastInput = -Infinity;
  const stamp = () => { lastInput = now(); };
  if (lifecycle && win?.addEventListener) {
    for (const type of ["keydown", "pointerdown", "input", "wheel"]) lifecycle.event(win, type, stamp, { capture: true, passive: true });
  }
  const quiet = () => now() - lastInput >= QUIET_MS && !doc?.querySelector?.(POPUP);

  // first: the initial build, which has no index to wait with.
  const build = async ({ first = false } = {}) => {
    const t0 = performance.now();
    const calls = watchCalls;
    const nextKeyword = setting("aliasKeyword") || "Aliases";
    const aliasRows = readAliasRows(nextKeyword);
    const aliasUids = [...new Set((aliasRows || []).map((row) => row[2]))];
    const aliasRefRows = aliasUids.length ? await q(ALIAS_REFS, aliasUids) : [];
    // The long query: not now if the user is typing or a popup opened meanwhile.
    if (!first && refs && !quiet()) { perf.counters.rebuildsDeferred = (perf.counters.rebuildsDeferred || 0) + 1; return false; }
    const rows = await q(REFERENCED_BLOCKS);
    // The newest edits: blocks (with their text, pulled once) and pages.
    let nextRecent = null;
    if (setting("recentRows")) {
      try {
        const edited = latestEdits(await q(EDITED_SINCE, Date.now() - RECENT_DAYS * 86_400_000), { blocks: 30 });
        nextRecent = { blocks: pullBlocks(api, edited.blocks), pages: edited.pages, builtAt: Date.now() };
      } catch (error) { console.error("[burrow] recent edits unavailable", error); }
    }
    const titleRows = await q(TITLES);
    const separated = (titleRows || []).map(([t]) => t).filter((t) => /[#>]/.test(t));
    const withContent = new Set(separated.length ? await q(WITH_CONTENT, separated) : []);
    const t1 = performance.now();
    const nextAliases = buildAliasIndex(aliasRows, nextKeyword);
    setAliasRefs(nextAliases, aliasRefRows);
    const nextRefs = await buildRefIndexSliced(rows, nextAliases.byPage, { yieldTo });
    await yieldTo();
    titles = buildTitleIndex(titleRows, nextAliases, withContent);
    rekey = null;
    refs = nextRefs;
    recent = nextRecent;
    aliases = nextAliases;
    aliasPrint = printOf(aliasRows);
    keyword = nextKeyword;
    builtAt = Date.now();
    perf.counters.builds += 1;
    perf.push("buildQuery", t1 - t0);
    perf.push("buildKeys", performance.now() - t1);
    if (!refs.entries.length) perf.counters.emptyBuilds = (perf.counters.emptyBuilds || 0) + 1;
    syncWatches(nextKeyword);
    notify();
    // An alias edit while the build awaited its queries: its rows are newer
    // than the ones this build read first.
    if (watchCalls !== calls) refreshAliases();
    return true;
  };

  // Builds at idle: the first one at once, later ones (the TTL, a keyword
  // change) only at a quiet moment, checked again right before the long query.
  let quietTimer = null;
  const schedule = () => {
    if (pending) return;
    pending = true;
    const first = !refs;
    const attempt = () => {
      quietTimer = null;
      if (lifecycle?.disposed) { pending = false; return; }
      if (!first && !quiet()) { quietTimer = win.setTimeout(attempt, QUIET_MS); return; }
      idle(() => {
        build({ first })
          .then((done) => { pending = false; if (done === false) schedule(); })
          .catch((error) => { pending = false; console.error("[burrow] index build failed", error); });
      });
    };
    attempt();
  };
  lifecycle?.add(() => { if (quietTimer != null) win.clearTimeout(quietTimer); });

  return {
    get aliases() { return aliases; },
    get refs() { return refs; },
    get titles() { return titles; },
    get recent() { return recent; },
    schedule,
    build,
    refreshAliases,
    // fn() runs after a build or an alias refresh.
    listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get watched() { return [...watches.keys()]; },
    // A popup opened: an index older than the TTL is rebuilt at the next
    // quiet moment (after this popup closes and the typing stops), never now.
    refreshIfStale() {
      if (!builtAt || Date.now() - builtAt > TTL_MS || keyword !== (setting("aliasKeyword") || "Aliases")) schedule();
    },
  };
}
