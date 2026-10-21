import { aliasRowsFromPull, buildAliasIndex, keywordTitles, setAliasRefs } from "./aliases.js";
import { buildRefIndexSliced, refreshAliasKeys } from "./refindex.js";
import { buildTitleIndex } from "./titles.js";

const TTL_MS = 60_000;
// An alias edit outside Burrow (by hand, roam-aliases, an undo) reaches the
// index this long after Roam's watch reports it; edits in a burst coalesce.
const ALIAS_SETTLE_MS = 250;

const REFERENCED_BLOCKS = `[:find ?u ?s (count ?r) ?pt
  :where [?r :block/refs ?b] [?b :block/string ?s] [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?pt]]`;
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

export function createIndexes({ api, perf, setting, idle, lifecycle = null, win = globalThis }) {
  let aliases = null;
  let refs = null;
  let titles = null;
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

  // [blockString, pageTitle, pageUid] for every block on an alias page's
  // refs, each tuple once (as the datalog query it replaces returned them).
  const readAliasRows = (kw) => {
    const rows = new Map();
    for (const title of keywordTitles(kw)) {
      perf.counters.aliasPulls = (perf.counters.aliasPulls || 0) + 1;
      for (const row of aliasRowsFromPull(api.pull(ALIAS_PULL, [":node/title", title]))) rows.set(row.join("\u0000"), row);
    }
    return [...rows.values()];
  };

  // One pull watch per alias page that exists: it fires when a block that
  // references the page is created, edited, moved or deleted, and when a
  // block gains or loses the `Keyword::` prefix; edits elsewhere never fire it.
  const watches = new Map();
  let settleTimer = null;
  const onWatch = () => {
    if (settleTimer != null) win.clearTimeout(settleTimer);
    settleTimer = win.setTimeout(() => { settleTimer = null; refreshAliases(); }, ALIAS_SETTLE_MS);
  };
  const syncWatches = (kw) => {
    const addWatch = api.data?.addPullWatch;
    if (!lifecycle || lifecycle.disposed || typeof addWatch !== "function") return;
    const wanted = new Set(keywordTitles(kw).filter((t) => api.pull("[:db/id]", [":node/title", t])));
    for (const [title, entity] of watches) {
      if (wanted.has(title)) continue;
      api.data.removePullWatch(ALIAS_PULL, entity, onWatch);
      watches.delete(title);
    }
    for (const title of wanted) {
      if (watches.has(title)) continue;
      const entity = `[:node/title ${JSON.stringify(title)}]`;
      api.data.addPullWatch(ALIAS_PULL, entity, onWatch);
      watches.set(title, entity);
    }
  };
  lifecycle?.add(() => {
    if (settleTimer != null) win.clearTimeout(settleTimer);
    for (const entity of watches.values()) api.data.removePullWatch(ALIAS_PULL, entity, onWatch);
    watches.clear();
    listeners.clear();
  });

  // Aliases alone, from the pulls: the alias index, the titles' alias
  // spellings and the (( alias expansion. Reference counts of pages already
  // known are kept; a new alias page gets its count at the next full build.
  function refreshAliases() {
    if (lifecycle?.disposed) return;
    const kw = setting("aliasKeyword") || "Aliases";
    if (!aliases || !titles || !refs || kw !== keyword) { schedule(); return; }
    const t0 = performance.now();
    const next = buildAliasIndex(readAliasRows(kw), kw);
    setAliasRefs(next, [...aliases.refsByPage]);
    titles.setAliases(next);
    refreshAliasKeys(refs, next.byPage);
    aliases = next;
    syncWatches(kw);
    perf.counters.aliasRefreshes = (perf.counters.aliasRefreshes || 0) + 1;
    perf.push("aliasRefresh", performance.now() - t0);
    notify();
  }

  const build = async () => {
    const t0 = performance.now();
    const nextKeyword = setting("aliasKeyword") || "Aliases";
    const aliasRows = readAliasRows(nextKeyword);
    const aliasUids = [...new Set((aliasRows || []).map((row) => row[2]))];
    const aliasRefRows = aliasUids.length ? await q(ALIAS_REFS, aliasUids) : [];
    const rows = await q(REFERENCED_BLOCKS);
    const titleRows = await q(TITLES);
    const separated = (titleRows || []).map(([t]) => t).filter((t) => /[#>]/.test(t));
    const withContent = new Set(separated.length ? await q(WITH_CONTENT, separated) : []);
    const t1 = performance.now();
    const nextAliases = buildAliasIndex(aliasRows, nextKeyword);
    setAliasRefs(nextAliases, aliasRefRows);
    const nextRefs = await buildRefIndexSliced(rows, nextAliases.byPage, { yieldTo });
    await yieldTo();
    titles = buildTitleIndex(titleRows, nextAliases, withContent);
    refs = nextRefs;
    aliases = nextAliases;
    keyword = nextKeyword;
    builtAt = Date.now();
    perf.counters.builds += 1;
    perf.push("buildQuery", t1 - t0);
    perf.push("buildKeys", performance.now() - t1);
    if (!refs.entries.length) perf.counters.emptyBuilds = (perf.counters.emptyBuilds || 0) + 1;
    syncWatches(nextKeyword);
    notify();
  };

  const schedule = () => {
    if (pending) return;
    pending = true;
    idle(() => {
      build()
        .catch((error) => console.error("[burrow] index build failed", error))
        .finally(() => { pending = false; });
    });
  };

  return {
    get aliases() { return aliases; },
    get refs() { return refs; },
    get titles() { return titles; },
    schedule,
    build,
    refreshAliases,
    // fn() runs after a build or an alias refresh.
    listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get watched() { return [...watches.keys()]; },
    refreshIfStale() {
      if (!builtAt || Date.now() - builtAt > TTL_MS || keyword !== (setting("aliasKeyword") || "Aliases")) schedule();
    },
  };
}
