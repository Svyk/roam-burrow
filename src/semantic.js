// Related rows: Roam's own semantic search, asked once after a typing pause.
// This file is the request side only (eligibility, debounce, cache, one
// request in flight); src/strip.js reads the replies and draws the band.
// Nothing here touches the DOM, and a key costs one clearTimeout and one
// setTimeout.
export const DEBOUNCE_MS = 400;
export const MIN_WORDS = 2;
export const MIN_CHARS = 8;
export const K = 10;
export const CACHE_LIMIT = 50;
export const CACHE_TTL_MS = 5 * 60 * 1000;

// Two words and eight characters: shorter queries are keywords, which
// Roam's own list answers better than an embedding does.
export function eligibleQuery(query) {
  const text = String(query ?? "").trim();
  return text.length >= MIN_CHARS && text.split(/\s+/).length >= MIN_WORDS;
}

// Roam's hits -> [{ kind: "block" | "page", uid }], in rank order, no uid twice.
// A chunk stands for the block its first topUid names; a page hit only counts
// in [[, where a page can be inserted.
export function candidates(hits, kind) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(hits)) return out;
  for (const hit of hits) {
    if (!hit) continue;
    const page = hit.type === "page";
    const uid = hit.type === "chunk" ? hit.topUids?.[0] : hit.uid;
    if (typeof uid !== "string" || !uid || seen.has(uid)) continue;
    if (page && kind !== "[[") continue;
    seen.add(uid);
    out.push({ kind: page ? "page" : "block", uid });
  }
  return out;
}

export function createSemantic({ api, win = globalThis, perf = null, trace = () => {}, graph = () => "", now = () => Date.now(), onReply = () => {} }) {
  const cache = new Map();
  let timer = null;
  // The newest pause that asked, the one waiting for the request in flight,
  // the request in flight. An entry is { token, key, gen }.
  let latest = null;
  let pending = null;
  let inFlight = null;
  let failed = false;
  let logged = false;
  // Bumped when the popup closes: a reply that outlives its popup is cached, never drawn.
  let generation = 0;
  const info = { lastQuery: null, lastMs: null };

  // Roam says no (or throws) when semantic search is off for the graph.
  function available() {
    try { return Boolean(api?.data?.semanticSearchEnabled?.()) && typeof api.data.async?.semanticSearch === "function"; } catch { return false; }
  }

  const keyFor = (token) => `${graph()}\u0000${token.kind}\u0000${token.query.trim()}`;

  function cached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    cache.delete(key);
    if (now() - entry.at > CACHE_TTL_MS) return null;
    cache.set(key, entry);
    return entry.list;
  }

  function store(key, list) {
    cache.delete(key);
    cache.set(key, { at: now(), list });
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }

  // The per-key path: no query, no pull, no layout.
  function schedule(token) {
    if (timer != null) win.clearTimeout(timer);
    timer = null;
    if (failed || !eligibleQuery(token.query)) return;
    timer = win.setTimeout(() => { timer = null; ask(token); }, DEBOUNCE_MS);
  }

  function cancel() {
    if (timer != null) win.clearTimeout(timer);
    timer = null;
  }

  function ask(token) {
    if (failed || !available()) return;
    const entry = { token, key: keyFor(token), gen: generation };
    latest = entry;
    const list = cached(entry.key);
    if (list) {
      pending = null;
      trace({ ev: "related", step: "cache", query: token.query.trim(), n: list.length });
      onReply(token, list);
      return;
    }
    if (inFlight) { pending = entry; return; }
    void request(entry);
  }

  async function request(entry) {
    const { token } = entry;
    const query = token.query.trim();
    inFlight = entry;
    info.lastQuery = query;
    trace({ ev: "related", step: "request", kind: token.kind, query });
    const t0 = now();
    let list = null;
    let error = null;
    try {
      const hits = await api.data.async.semanticSearch({ "search-str": query, k: K, "search-blocks": true, "search-pages": token.kind === "[[" });
      list = candidates(hits, token.kind);
    } catch (caught) {
      error = caught;
    }
    inFlight = null;
    const ms = now() - t0;
    info.lastMs = ms;
    if (error) {
      trace({ ev: "related", step: "fail", query });
      // A failure after the popup closed says nothing about the next one.
      if (entry.gen !== generation) return;
      failed = true;
      pending = null;
      if (!logged) {
        logged = true;
        console.debug("[burrow] related rows: semantic search failed", String(error?.message || error));
      }
      return;
    }
    perf?.push("related.request", ms);
    store(entry.key, list);
    trace({ ev: "related", step: "reply", query, n: list.length, ms: Math.round(ms) });
    // A newer pause is waiting: this reply is cached and not drawn.
    if (pending && pending.gen === generation) {
      const next = pending;
      pending = null;
      const hit = cached(next.key);
      if (hit) { trace({ ev: "related", step: "cache", query: next.token.query.trim(), n: hit.length }); onReply(next.token, hit); } else void request(next);
      return;
    }
    if (entry.gen !== generation || latest !== entry) {
      trace({ ev: "related", step: "drop", query, why: entry.gen !== generation ? "closed" : "superseded" });
      return;
    }
    onReply(token, list);
  }

  // The popup closed: forget the pause and the failure, and never draw a
  // reply still on its way. The cache stays (it is per graph and query).
  function reset() {
    cancel();
    pending = null;
    latest = null;
    failed = false;
    logged = false;
    generation += 1;
  }

  return {
    available, eligible: (token) => Boolean(token) && eligibleQuery(token.query),
    schedule, cancel, reset,
    clear() { cache.clear(); },
    get cacheSize() { return cache.size; },
    get inFlight() { return inFlight != null; },
    get failed() { return failed; },
    get lastQuery() { return info.lastQuery; },
    get lastMs() { return info.lastMs; },
  };
}
