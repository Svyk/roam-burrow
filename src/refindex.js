import { isPrecise, matchFromKey, searchKey, strictPrefilter, stripRoamMarkup } from "./search.js";

const BLOCK_REF = /\(\(([\w-]{9})\)\)/g;
const PAGE_REF = /\[\[([^[\]]+)\]\]|#([^\s[\]#,]+)/g;

// The recall tier (typos, initialisms) walks every target token; on long
// paragraphs that dominates the per-key cost, so it only runs on short blocks.
const RECALL_MAX_TOKENS = 40;

// rows: [uid, string, inboundRefCount, pageTitle] for blocks that other
// blocks reference.
// aliasesByPage: Map(pageTitle -> [alias]) for alias query expansion.
export function buildRefIndex(rows, aliasesByPage = new Map()) {
  const index = startRefIndex(rows);
  for (const entry of index.entries) keyEntry(entry, index, aliasesByPage);
  return index;
}

// Same build in slices of at most sliceMs, so no single task blocks typing.
export async function buildRefIndexSliced(rows, aliasesByPage, { sliceMs = 8, yieldTo }) {
  const index = startRefIndex(rows);
  let at = 0;
  while (at < index.entries.length) {
    const t0 = performance.now();
    while (at < index.entries.length && performance.now() - t0 < sliceMs) {
      keyEntry(index.entries[at++], index, aliasesByPage);
    }
    if (at < index.entries.length) await yieldTo();
  }
  return index;
}

function startRefIndex(rows) {
  const byUid = new Map();
  for (const [uid, string, refs, page] of rows || []) {
    byUid.set(uid, { uid, string: String(string || ""), refs: Number(refs) || 0, page: page ?? null });
  }
  return { entries: [...byUid.values()], byUid, words: new Map(), builtAt: Date.now() };
}

function keyEntry(entry, index, aliasesByPage) {
  const { byUid } = index;
  const quotes = [];
  const resolved = entry.string.replace(BLOCK_REF, (_, uid) => {
    quotes.push(uid);
    const target = byUid.get(uid);
    return target ? ` ${target.string} ` : " ";
  });
  entry.key = searchKey(stripRoamMarkup(resolved));
  entry.quotes = quotes;
  // A block that is nothing but `((X))` is a quoter of X and folds into it.
  entry.pureQuote = quotes.length === 1
    && !/[\p{L}\p{N}]/u.test(entry.string.replace(BLOCK_REF, "").replace(/\{\{[^{}]*\}\}/g, ""))
    ? quotes[0] : null;
  const aliases = [];
  if (aliasesByPage?.size) {
    for (const m of entry.string.matchAll(PAGE_REF)) {
      const found = aliasesByPage.get(m[1] || m[2]);
      if (found) aliases.push(...found);
    }
  }
  entry.aliasKey = aliases.length ? searchKey(aliases.join(" ")) : null;
  // Word -> entries, for the recall pass (it needs one exact word).
  if (entry.key.tokens.length <= RECALL_MAX_TOKENS) {
    const seen = new Set(entry.aliasKey ? entry.key.tokens.concat(entry.aliasKey.tokens) : entry.key.tokens);
    for (const word of seen) {
      const list = index.words.get(word);
      if (list) list.push(entry);
      else index.words.set(word, [entry]);
    }
  }
}

// Ranking (spec §3): match band, a row picked before for this query (pick
// memory, most recent first), originals before quoters, inbound refs in log2
// steps, alias hit, on the page being edited, score, shorter text, uid.
// Pass 1 is strict only;
// recall (typos, abbreviations) runs only when the strip is not yet full,
// because recall rows rank below every strict row.
export function rankRefs(index, plan, { limit = 3, recall = true, aliasExpand = true, picked = null, currentPage = null } = {}) {
  if (!index || !plan) return [];
  const hits = new Map();
  const consider = (entry, opts) => {
    let match = matchFromKey(entry.key, plan, opts);
    let viaAlias = false;
    if (aliasExpand && entry.aliasKey) {
      const aliasMatch = matchFromKey(entry.aliasKey, plan, opts);
      if (isPrecise(aliasMatch) && (!isPrecise(match) || rankOf(aliasMatch) > rankOf(match))) {
        match = aliasMatch;
        viaAlias = true;
      }
    }
    if (!isPrecise(match)) return false;
    let target = entry;
    if (entry.pureQuote && index.byUid.has(entry.pureQuote)) target = index.byUid.get(entry.pureQuote);
    const previous = hits.get(target.uid);
    if (previous && rankOf(previous.match) >= rankOf(match)) return true;
    hits.set(target.uid, { entry: target, match, viaAlias });
    return true;
  };
  const strictHit = new Set();
  for (const entry of prefiltered(index, plan, aliasExpand)) {
    if (consider(entry, { strict: true })) strictHit.add(entry);
  }
  // A recall row needs one word exact and another fuzzy, so a one-word
  // query can never produce one.
  const words = plan.clauses.reduce((n, q) => n + q.tokens.length, 0);
  if (recall && words >= 2 && hits.size < limit) {
    // An admitted recall row has some query word as an exact word, so the
    // word index yields every candidate.
    const candidates = new Set();
    for (const clause of plan.clauses) {
      for (const word of clause.tokens) for (const entry of index.words.get(word) || []) candidates.add(entry);
    }
    for (const entry of candidates) if (!strictHit.has(entry)) consider(entry, {});
  }
  for (const hit of hits.values()) hit.quoter = hit.entry.quotes.some((uid) => uid !== hit.entry.uid && hits.has(uid));
  const rows = [...hits.values()];
  const pick = (hit) => picked?.get(hit.entry.uid) || 0;
  const onPage = (hit) => Number(currentPage != null && hit.entry.page === currentPage);
  rows.sort((a, b) => rankOf(b.match) - rankOf(a.match)
    || pick(b) - pick(a)
    || Number(a.quoter) - Number(b.quoter)
    || refStep(b.entry.refs) - refStep(a.entry.refs)
    || Number(b.viaAlias) - Number(a.viaAlias)
    || onPage(b) - onPage(a)
    || b.match.score - a.match.score
    || a.entry.string.length - b.entry.string.length
    || (a.entry.uid < b.entry.uid ? -1 : a.entry.uid > b.entry.uid ? 1 : 0));
  return rows.slice(0, limit).map(({ entry, match, viaAlias, quoter }) => ({
    uid: entry.uid, string: entry.string, refs: entry.refs, level: match.level, tier: match.tier, score: match.score, viaAlias, quoter,
    picked: Boolean(picked?.get(entry.uid)), onPage: currentPage != null && entry.page === currentPage,
  }));
}

// Entries that pass the strict prefilter, cached per needle set. Typing
// forward only narrows the set (each new needle contains an old one), so the
// scan runs over the cached superset instead of the whole graph; Backspace
// returns to a cached set.
const PREFILTER_CACHE = 24;

function prefiltered(index, plan, aliasExpand) {
  const maybe = strictPrefilter(plan);
  const sig = `${aliasExpand ? 1 : 0}\u0002${maybe.initial ?? ""}\u0002${maybe.needles.join("\u0001")}`;
  const cache = index.prefilter || (index.prefilter = new Map());
  const hit = cache.get(sig);
  if (hit) {
    cache.delete(sig);
    cache.set(sig, hit);
    return hit;
  }
  let source = index.entries;
  for (const [, cached] of cache) {
    if (cached.initial == null && cached.aliasExpand === aliasExpand && cached.needles.length === maybe.needles.length
        && cached.needles.every((n, i) => maybe.needles[i].includes(n)) && cached.length < source.length) {
      source = cached;
    }
  }
  const list = source.filter((entry) => maybe(entry.key) || (aliasExpand && maybe(entry.aliasKey)));
  list.needles = maybe.needles;
  list.initial = maybe.initial;
  list.aliasExpand = aliasExpand;
  cache.set(sig, list);
  if (cache.size > PREFILTER_CACHE) cache.delete(cache.keys().next().value);
  return list;
}

// Bands: exact and substring hits share one band so inbound refs decide
// between them (the referenced original wins); token-wise hits come next,
// recall hits after.
function rankOf(match) {
  return Math.min(match.level, 2);
}

function refStep(refs) {
  return Math.floor(Math.log2(1 + refs));
}
