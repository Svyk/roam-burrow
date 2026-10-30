// Related rows: Roam's own semantic search, asked once after a typing pause.
// Suggested links (empty [[) use the same request side with their own fetch.
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
// Roam throws "Initial sync in progress" while it re-embeds the graph (svy:
// about 10 s of every minute, 2026-10-28). That is a wait, not a failure:
// the same query is asked again, a few times, while it is still the newest.
export const SYNC_RETRY_MS = 2000;
export const SYNC_RETRIES = 6;
const syncing = (error) => /sync in progress/i.test(String(error?.message || error));

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

// Suggested links: at most this much of the block is asked about. Roam's
// matcher runs on the main thread (50 KB took 960 ms in notes, 2026-10-30).
export const SUGGEST_TEXT = 2000;
export const SUGGEST_MIN = 3;

// The block as the empty [[ leaves it: its text without the token, or null
// when too little is left to ask about.
export function suggestText(value, token) {
  const text = (String(value ?? "").slice(0, token.start) + String(value ?? "").slice(token.end)).trim().slice(0, SUGGEST_TEXT);
  return text.length >= SUGGEST_MIN ? text : null;
}

// Roam's reply { suggestions: [{ title, matchType, ... }] } -> titles in its
// order, no title twice without case (notes has Notes and notes).
export function suggestTitles(reply) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(reply?.suggestions)) return out;
  for (const hit of reply.suggestions) {
    const title = hit?.title;
    if (typeof title !== "string" || !title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push(title);
  }
  return out;
}

// `k` and `keyOf` let a second instance (the preview footer) ask for more hits
// and keep its cache per subject; `perfName` keeps its samples apart. `fetch`,
// `canAsk` and `eligible` replace the search itself (Suggested links).
export function createSemantic({ api, win = globalThis, perf = null, trace = () => {}, graph = () => "", now = () => Date.now(), onReply = () => {}, k = K, keyOf = null, perfName = "related.request", fetch = null, canAsk = null, eligible = eligibleQuery, what = "related rows: semantic search" }) {
  const cache = new Map();
  let timer = null;
  let retryTimer = null;
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
    if (canAsk) return canAsk();
    try { return Boolean(api?.data?.semanticSearchEnabled?.()) && typeof api.data.async?.semanticSearch === "function"; } catch { return false; }
  }

  const keyFor = (token) => (keyOf ? keyOf(token) : `${graph()}\u0000${token.kind}\u0000${token.query.trim()}`);

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
    if (failed || !eligible(token.query)) return;
    timer = win.setTimeout(() => { timer = null; ask(token); }, DEBOUNCE_MS);
  }

  function cancel() {
    if (timer != null) win.clearTimeout(timer);
    timer = null;
    if (retryTimer != null) win.clearTimeout(retryTimer);
    retryTimer = null;
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
      if (fetch) list = await fetch(token);
      else list = candidates(await api.data.async.semanticSearch({ "search-str": query, k, "search-blocks": true, "search-pages": token.kind === "[[" }), token.kind);
    } catch (caught) {
      error = caught;
    }
    inFlight = null;
    const ms = now() - t0;
    info.lastMs = ms;
    if (error) {
      trace({ ev: "related", step: "fail", query });
      // A failure after the popup closed says nothing about the next one:
      // a query the new popup queued behind it is asked now.
      if (entry.gen !== generation) { servePending(); return; }
      if (syncing(error)) {
        if (servePending()) return;
        entry.tries = (entry.tries ?? 0) + 1;
        if (latest === entry && entry.tries <= SYNC_RETRIES) {
          trace({ ev: "related", step: "sync-wait", query, tries: entry.tries });
          retryTimer = win.setTimeout(() => {
            retryTimer = null;
            if (latest === entry && entry.gen === generation && !inFlight) void request(entry);
          }, SYNC_RETRY_MS);
          return;
        }
      }
      failed = true;
      pending = null;
      if (!logged) {
        logged = true;
        console.debug(`[burrow] ${what} failed`, String(error?.message || error));
      }
      return;
    }
    perf?.push(perfName, ms);
    store(entry.key, list);
    trace({ ev: "related", step: "reply", query, n: list.length, ms: Math.round(ms) });
    // A newer pause is waiting: this reply is cached and not drawn.
    if (servePending()) return;
    if (entry.gen !== generation || latest !== entry) {
      trace({ ev: "related", step: "drop", query, why: entry.gen !== generation ? "closed" : "superseded" });
      return;
    }
    onReply(token, list);
  }

  // The query a newer pause queued behind the request that just settled.
  function servePending() {
    if (!pending || pending.gen !== generation) return false;
    const next = pending;
    pending = null;
    const hit = cached(next.key);
    if (hit) { trace({ ev: "related", step: "cache", query: next.token.query.trim(), n: hit.length }); onReply(next.token, hit); } else void request(next);
    return true;
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
    available, eligible: (token) => Boolean(token) && eligible(token.query),
    schedule, cancel, reset, ask,
    clear() { cache.clear(); },
    get cacheSize() { return cache.size; },
    get inFlight() { return inFlight != null; },
    get failed() { return failed; },
    get lastQuery() { return info.lastQuery; },
    get lastMs() { return info.lastMs; },
  };
}

// The preview footer ("Related to the highlighted block"): one lookup after
// the highlight has rested FOOTER_DWELL_MS, for the highlighted block or page.
export const FOOTER_DWELL_MS = 500;
// Roam's search returns the block itself and the blocks on its own page first
// (notes, block 6ZtlGN-Np "3. Real-time PCR screen": k=6 gave the block plus 5
// neighbours on its page, all of which are left out, so nothing would show),
// so 30 are asked for and the first FOOTER_POOL that pass are kept.
export const FOOTER_K = 30;
export const FOOTER_POOL = 6;
export const FOOTER_ROWS = 4;
export const FOOTER_TEXT = 600;
export const FOOTER_CHILDREN = 10;

// The text a lookup is asked with: a block's own text, or a page's title and
// its first ten children, one per line (roam-related-notes' rule), cut at 600.
export function footerText({ title = null, string = "", children = [] }) {
  const lines = title != null ? [title, ...children.slice(0, FOOTER_CHILDREN)] : [string];
  return lines.map((line) => String(line ?? "").trim()).filter(Boolean).join("\n").slice(0, FOOTER_TEXT);
}

// One pulled hit { uid, string, title, pageUid }: does it belong in the footer?
// Not the subject, not a block on the subject's page, no page, no empty block,
// nothing already shown elsewhere (skip: a Set of uids).
export function footerKeep(hit, info, skip) {
  if (!hit || typeof hit.uid !== "string") return false;
  if (hit.uid === info.subjectUid || (hit.pageUid != null && hit.pageUid === info.pageUid)) return false;
  if (hit.title != null || typeof hit.string !== "string" || !hit.string.trim()) return false;
  return !skip.has(hit.uid);
}

// The first FOOTER_POOL hits that pass, no uid twice (the footer draws FOOTER_ROWS of them).
export function footerPick(hits, info, skip) {
  const out = [];
  const seen = new Set(skip);
  for (const hit of hits) {
    if (out.length >= FOOTER_POOL) break;
    if (!footerKeep(hit, info, seen)) continue;
    seen.add(hit.uid);
    out.push(hit);
  }
  return out;
}
