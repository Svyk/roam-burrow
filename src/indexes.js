import { buildAliasIndex, keywordTitles } from "./aliases.js";
import { buildRefIndexSliced } from "./refindex.js";
import { buildTitleIndex } from "./titles.js";

const TTL_MS = 60_000;

const REFERENCED_BLOCKS = `[:find ?u ?s (count ?r) ?pt
  :where [?r :block/refs ?b] [?b :block/string ?s] [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?pt]]`;
const TITLES = "[:find ?t ?u :where [?p :node/title ?t] [?p :block/uid ?u]]";
const WITH_CONTENT = "[:find [?t ...] :in $ [?t ...] :where [?p :node/title ?t] [?p :block/children ?c]]";
const ALIAS_PAGES = "[:find [?a ...] :in $ [?t ...] :where [?a :node/title ?t]]";
const ALIAS_BLOCKS = `[:find ?s ?pt ?pu :in $ [?a ...]
  :where [?b :block/refs ?a] [?b :block/string ?s] [?b :block/page ?p] [?p :node/title ?pt] [?p :block/uid ?pu]]`;

// Both indexes are built at idle and refreshed lazily when a popup opens and
// they are older than the TTL. Nothing here runs on a keystroke.
const yieldTo = () => new Promise((resolve) => setTimeout(resolve, 0));

export function createIndexes({ api, perf, setting, idle }) {
  let aliases = null;
  let refs = null;
  let titles = null;
  let builtAt = 0;
  let keyword = null;
  let pending = false;

  // data.async.fast.q keeps the scan off the keystroke path where Roam
  // offers it; the sync form is the fallback.
  const q = (query, ...args) => {
    perf.counters.queries += 1;
    const asyncQ = api.data.async?.fast?.q;
    return asyncQ ? asyncQ(query, ...args) : Promise.resolve(api.data.fast.q(query, ...args));
  };

  const build = async () => {
    const t0 = performance.now();
    const nextKeyword = setting("aliasKeyword") || "Aliases";
    const pageIds = await q(ALIAS_PAGES, keywordTitles(nextKeyword));
    const aliasRows = pageIds?.length ? await q(ALIAS_BLOCKS, pageIds) : [];
    const rows = await q(REFERENCED_BLOCKS);
    const titleRows = await q(TITLES);
    const separated = (titleRows || []).map(([t]) => t).filter((t) => /[#>]/.test(t));
    const withContent = new Set(separated.length ? await q(WITH_CONTENT, separated) : []);
    const t1 = performance.now();
    const nextAliases = buildAliasIndex(aliasRows, nextKeyword);
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
    refreshIfStale() {
      if (!builtAt || Date.now() - builtAt > TTL_MS || keyword !== (setting("aliasKeyword") || "Aliases")) schedule();
    },
  };
}
