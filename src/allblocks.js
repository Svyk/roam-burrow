// "Filters search every block" (filterAllBlocks): with is:, in:here, in:Page
// or ns: in ((, Burrow also reads blocks nobody references yet, from Roam's
// own search or from the named pages. This file is the read side only
// (eligibility, source, debounce, cache, one read in flight); src/strip.js
// merges the rows. Nothing here touches the DOM or writes to the graph, and a
// key costs one clearTimeout and one setTimeout.
import { taskState } from "./filters.js";

export const WIDE_DEBOUNCE_MS = 250;
// Roam's search returns 1000 at most.
export const SEARCH_LIMIT = 1000;
export const CACHE_LIMIT = 20;
// Blocks change as the graph is edited.
export const CACHE_TTL_MS = 60 * 1000;

const PAGE_PULL = "[:node/title {:block/_page [:block/uid :block/string]}]";
const OWNER_PULL = "[:block/uid {:block/page [:node/title]}]";

// Does the query hold a filter that looks past the referenced blocks?
export function wantsAllBlocks(filters) {
  return Boolean(filters) && Boolean(filters.is.length || filters.here || filters.pages.length || filters.ns.length);
}

// Where the blocks come from, or null when there is nothing to ask:
//   pages: every page filter is in:here / in:Title -> read those pages' blocks;
//   search: otherwise (any ns:, or is: alone) -> Roam's search for the words.
// An is: that names no state (or two) leaves no row, so it asks nothing.
export function sourceFor(filters, { currentPage = null, resolve = null } = {}) {
  if (!wantsAllBlocks(filters)) return null;
  const states = new Set(filters.is);
  if (states.has(null) || states.size > 1) return null;
  if (!filters.ns.length && (filters.here || filters.pages.length)) {
    const titles = new Map();
    if (filters.here && currentPage != null) titles.set(String(currentPage).toLowerCase(), String(currentPage));
    for (const value of filters.pages) {
      const title = String(resolve?.(value)?.title ?? value);
      titles.set(title.toLowerCase(), title);
    }
    if (!titles.size) return null;
    const keys = [...titles.keys()].sort();
    return { kind: "pages", titles: keys.map((key) => titles.get(key)), key: `pages\u0000${keys.join("\u0001")}` };
  }
  let text = String(filters.planText ?? "").trim();
  if (!text) return null;
  const [state] = states;
  if (state) text = `${text} ${state === "done" ? "DONE" : "TODO"}`;
  return { kind: "search", text, is: [...states], key: `search\u0000${text.toLowerCase()}` };
}

// source -> [[uid, string, pageTitle]]. Rejects when Roam does.
export async function readSource(api, source) {
  if (source.kind === "pages") return readPages(api, source.titles);
  return readSearch(api, source);
}

async function readPages(api, titles) {
  const pull = api.data?.async?.pull;
  const lists = await Promise.all(titles.map(async (title) => {
    const eid = [":node/title", title];
    const page = pull ? await pull(PAGE_PULL, eid) : api.pull(PAGE_PULL, eid);
    const rows = [];
    for (const block of page?.[":block/_page"] || []) {
      if (typeof block?.[":block/uid"] === "string") rows.push([block[":block/uid"], block[":block/string"] ?? "", title]);
    }
    return rows;
  }));
  return lists.flat();
}

async function readSearch(api, source) {
  const hits = await api.data.async.search({ "search-str": source.text, "search-pages": false, "search-blocks": true, limit: SEARCH_LIMIT });
  // The task state is known from the text: filter before any pull.
  const kept = [];
  const seen = new Set();
  for (const hit of Array.isArray(hits) ? hits : []) {
    const uid = hit?.[":block/uid"];
    const string = hit?.[":block/string"];
    if (typeof uid !== "string" || seen.has(uid) || typeof string !== "string") continue;
    if (source.is.length && !source.is.every((want) => want === taskState(string))) continue;
    seen.add(uid);
    kept.push([uid, string]);
  }
  if (!kept.length) return [];
  const eids = kept.map(([uid]) => [":block/uid", uid]);
  let owners;
  if (api.data?.async?.pull_many) owners = await api.data.async.pull_many(OWNER_PULL, eids);
  else owners = eids.map((eid) => api.pull(OWNER_PULL, eid));
  const rows = [];
  kept.forEach(([uid, string], i) => {
    const title = owners?.[i]?.[":block/page"]?.[":node/title"];
    if (title != null) rows.push([uid, string, title]);
  });
  return rows;
}

export function createAllBlocks({ api, win = globalThis, perf = null, trace = () => {}, graph = () => "", now = () => Date.now(), onReply = () => {} }) {
  const cache = new Map();
  let timer = null;
  // The newest pause that asked, the one waiting for the read in flight, the
  // read in flight. An entry is { source, token, key, gen }.
  let latest = null;
  let pending = null;
  let inFlight = null;
  let failed = false;
  // Bumped when the popup closes: a reply that outlives its popup is cached, never drawn.
  let generation = 0;
  const info = { lastKey: null, lastMs: null };

  const keyOf = (source) => `${graph()}\u0000${source.key}`;

  // Fresh rows for a source, or null.
  function get(source) {
    const key = keyOf(source);
    const entry = cache.get(key);
    if (!entry) return null;
    cache.delete(key);
    if (now() - entry.at > CACHE_TTL_MS) return null;
    cache.set(key, entry);
    return entry.rows;
  }

  function store(key, rows) {
    cache.delete(key);
    cache.set(key, { at: now(), rows });
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }

  // The per-key path: no read, no pull, no layout.
  function schedule(source, token) {
    if (timer != null) win.clearTimeout(timer);
    timer = null;
    if (failed) return;
    timer = win.setTimeout(() => { timer = null; ask({ source, token, key: keyOf(source), gen: generation }); }, WIDE_DEBOUNCE_MS);
  }

  function cancel() {
    if (timer != null) win.clearTimeout(timer);
    timer = null;
  }

  function ask(entry) {
    if (failed) return;
    latest = entry;
    const rows = get(entry.source);
    if (rows) {
      pending = null;
      trace({ ev: "wide", step: "cache", key: entry.source.key, n: rows.length });
      onReply(entry.token, rows);
      return;
    }
    if (inFlight) {
      // The same read is already on its way: its reply serves this key too.
      pending = inFlight.key === entry.key ? null : entry;
      return;
    }
    void request(entry);
  }

  async function request(entry) {
    inFlight = entry;
    info.lastKey = entry.source.key;
    trace({ ev: "wide", step: "request", kind: entry.source.kind, key: entry.source.key });
    const t0 = now();
    let rows = null;
    let error = null;
    try {
      rows = await readSource(api, entry.source);
    } catch (caught) {
      error = caught;
    }
    inFlight = null;
    const ms = now() - t0;
    info.lastMs = ms;
    if (error) {
      trace({ ev: "wide", step: "fail", key: entry.source.key });
      // A failure after the popup closed says nothing about the next one.
      if (entry.gen !== generation) { servePending(); return; }
      failed = true;
      pending = null;
      console.debug("[burrow] all-blocks read failed", error);
      return;
    }
    perf?.push?.("wide.read", ms);
    store(entry.key, rows);
    trace({ ev: "wide", step: "reply", key: entry.source.key, n: rows.length, ms: Math.round(ms) });
    // A newer, different key waits, or the popup closed: cached, not drawn.
    if ((pending && pending.gen === generation) || entry.gen !== generation || !latest || latest.key !== entry.key) {
      trace({ ev: "wide", step: "drop", key: entry.source.key, why: entry.gen !== generation ? "closed" : "superseded" });
      servePending();
      return;
    }
    onReply(latest.token, rows);
  }

  function servePending() {
    if (!pending || pending.gen !== generation) { pending = null; return false; }
    const next = pending;
    pending = null;
    const rows = get(next.source);
    if (rows) onReply(next.token, rows);
    else void request(next);
    return true;
  }

  // The popup closed: forget the pause and the failure, and never draw a
  // reply still on its way. The cache stays (the TTL bounds it).
  function reset() {
    cancel();
    pending = null;
    latest = null;
    failed = false;
    generation += 1;
  }

  return {
    get, schedule, cancel, reset,
    clear() { cache.clear(); },
    get cacheSize() { return cache.size; },
    get inFlight() { return inFlight != null; },
    get failed() { return failed; },
    get lastKey() { return info.lastKey; },
    get lastMs() { return info.lastMs; },
  };
}
