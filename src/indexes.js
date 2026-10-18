import { buildAliasIndex, keywordTitles } from "./aliases.js";
import { buildRefIndexSliced } from "./refindex.js";

const TTL_MS = 60_000;

const REFERENCED_BLOCKS = `[:find ?u ?s (count ?r)
  :where [?r :block/refs ?b] [?b :block/string ?s] [?b :block/uid ?u]]`;
const ALIAS_PAGES = "[:find [?a ...] :in $ [?t ...] :where [?a :node/title ?t]]";
const ALIAS_BLOCKS = `[:find ?s ?pt ?pu :in $ [?a ...]
  :where [?b :block/refs ?a] [?b :block/string ?s] [?b :block/page ?p] [?p :node/title ?pt] [?p :block/uid ?pu]]`;

// Both indexes are built at idle and refreshed lazily when a popup opens and
// they are older than the TTL. Nothing here runs on a keystroke.
const yieldTo = () => new Promise((resolve) => setTimeout(resolve, 0));

export function createIndexes({ api, perf, setting, idle }) {
  let aliases = null;
  let refs = null;
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
    const t1 = performance.now();
    const nextAliases = buildAliasIndex(aliasRows, nextKeyword);
    refs = await buildRefIndexSliced(rows, nextAliases.byPage, { yieldTo });
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
    schedule,
    build,
    refreshIfStale() {
      if (!builtAt || Date.now() - builtAt > TTL_MS || keyword !== (setting("aliasKeyword") || "Aliases")) schedule();
    },
  };
}
