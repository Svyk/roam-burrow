import { isPrecise, matchFromKey, searchKey, strictPrefilter, stripMacros, stripRoamMarkup } from "./search.js";

const BLOCK_REF = /\(\(([\w-]{9})\)\)/g;
const PAGE_REF = /\[\[([^[\]]+)\]\]|#([^\s[\]#,]+)/g;

// The recall tier (typos, initialisms) walks every target token; on long
// paragraphs that dominates the per-key cost, so it only runs on short blocks.
const RECALL_MAX_TOKENS = 40;

// About 400 characters; svy has 5,314 referenced blocks, 140 of them longer;
// notes 3,775, 77 longer (measured 2026-10-25).
const LONG_TOKENS = 64;

// Fenced and inline code, apart from the prose around it: a query of plain
// words must not match inside ggplot code. Each code span leaves one space.
export function splitCode(string) {
  const code = [];
  const prose = String(string).replace(/```[\w+#.-]*[ \t]*\n?([\s\S]*?)(?:```|$)/g, (_, text) => {
    code.push(text);
    return " ";
  }).replace(/`([^`\n]+)`/g, (_, text) => {
    code.push(text);
    return " ";
  });
  return { prose, code: code.join("\n") };
}

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
  return { entries: [...byUid.values()], byUid, words: new Map(), byLinked: new Map(), builtAt: Date.now() };
}

function keyEntry(entry, index, aliasesByPage) {
  const { byUid } = index;
  const quotes = [];
  const { prose, code } = splitCode(entry.string);
  // Macros go before refs resolve, so an embed's or render's ((uid)) is not pulled in.
  const bare = stripMacros(prose);
  const resolved = bare.replace(BLOCK_REF, (_, uid) => {
    const target = byUid.get(uid);
    return target ? ` ${target.string} ` : " ";
  });
  for (const m of entry.string.matchAll(BLOCK_REF)) quotes.push(m[1]);
  entry.key = searchKey(stripRoamMarkup(resolved));
  entry.quotes = quotes;
  entry.codeKey = code.trim() ? searchKey(code) : null;
  entry.words = entry.key.tokens.length + (entry.codeKey?.tokens.length || 0);
  entry.long = entry.words > LONG_TOKENS;
  // A block that is nothing but `((X))` is a quoter of X and folds into it.
  entry.pureQuote = quotes.length === 1
    && !/[\p{L}\p{N}]/u.test(entry.string.replace(BLOCK_REF, "").replace(/\{\{[^{}]*\}\}/g, ""))
    ? quotes[0] : null;
  // The pages it links, kept so an alias edit can re-key it (refreshAliasKeys).
  const linked = [...bare.matchAll(PAGE_REF)].map((m) => m[1] || m[2]);
  entry.linked = linked.length ? linked : null;
  // Page title -> the blocks that link it, for aliasKeyTargets.
  for (const title of new Set(linked)) {
    const list = index.byLinked.get(title);
    if (list) list.push(entry);
    else index.byLinked.set(title, [entry]);
  }
  entry.aliasKey = aliasKeyOf(entry, aliasesByPage);
  // Word -> entries, for the recall pass (it needs one exact word).
  if (entry.key.tokens.length <= RECALL_MAX_TOKENS) {
    const seen = new Set(entry.aliasKey ? entry.key.tokens.concat(entry.aliasKey.tokens) : entry.key.tokens);
    for (const word of seen) addWord(index, word, entry);
  }
}

// keys: joined aliases -> their search key, shared by the blocks of one
// re-key run (blocks that link the same pages get the same key).
function aliasKeyOf(entry, aliasesByPage, keys = null) {
  if (!entry.linked || !aliasesByPage?.size) return null;
  const aliases = [];
  for (const title of entry.linked) {
    const found = aliasesByPage.get(title);
    if (found) aliases.push(...found);
  }
  if (!aliases.length) return null;
  const joined = aliases.join(" ");
  let key = keys?.get(joined);
  if (!key) {
    key = searchKey(joined);
    keys?.set(joined, key);
  }
  return key;
}

function addWord(index, word, entry) {
  const list = index.words.get(word);
  if (!list) index.words.set(word, [entry]);
  else if (!list.includes(entry)) list.push(entry);
}

// An alias block changed (Burrow's watch on the alias pages): only the
// blocks that link a page whose aliases differ now need a new alias key, so
// (( alias expansion follows without a rebuild. Given the previous map, only
// those are returned, not every linking block (4,400 in svy).
export function aliasKeyTargets(index, aliasesByPage, previousByPage = null) {
  if (!index) return [];
  let pages = null;
  if (previousByPage) {
    pages = new Set();
    const same = (title) => (previousByPage.get(title) || []).join("\u0000") === (aliasesByPage.get(title) || []).join("\u0000");
    for (const title of previousByPage.keys()) if (!same(title)) pages.add(title);
    for (const title of aliasesByPage.keys()) if (!same(title)) pages.add(title);
    if (!pages.size) return [];
  }
  if (!pages) return index.entries.filter((entry) => entry.linked);
  const out = new Set();
  for (const title of pages) for (const entry of index.byLinked.get(title) || []) out.add(entry);
  return [...out];
}

// Gives entries[from..] their alias key from aliasesByPage until stop()
// (checked after each block) says to pause; src/indexes.js runs it in idle
// slices. Returns where to go on and how many blocks changed.
export function rekeyAliases(index, entries, aliasesByPage, { from = 0, stop = () => false, keys = new Map() } = {}) {
  let at = from;
  let changed = 0;
  while (at < entries.length) {
    const entry = entries[at++];
    const next = aliasKeyOf(entry, aliasesByPage, keys);
    if ((next?.spaced ?? null) !== (entry.aliasKey?.spaced ?? null)) {
      if (entry.key.tokens.length <= RECALL_MAX_TOKENS) {
        const keep = new Set(next ? entry.key.tokens.concat(next.tokens) : entry.key.tokens);
        for (const word of entry.aliasKey?.tokens || []) {
          if (keep.has(word)) continue;
          const list = index.words.get(word)?.filter((e) => e !== entry);
          if (list?.length) index.words.set(word, list);
          else index.words.delete(word);
        }
        for (const word of next?.tokens || []) addWord(index, word, entry);
      }
      entry.aliasKey = next;
      changed += 1;
    }
    if (stop()) break;
  }
  if (changed) index.prefilter = null;
  return { next: at, changed };
}

// Both at once. Returns how many blocks changed.
export function refreshAliasKeys(index, aliasesByPage, previousByPage = null) {
  return rekeyAliases(index, aliasKeyTargets(index, aliasesByPage, previousByPage), aliasesByPage).changed;
}

// Ranking (spec §3): match band, a row picked before for this query (pick
// memory, most recent first), originals before quoters, long blocks (more
// than 64 words) after shorter ones, inbound refs in log2 steps, alias hit,
// on the page being edited, a match inside a linked [[page]] or #tag, score
// (start of block and word distance), shorter text, uid. With prose off the
// long and title steps are skipped and code matches like prose (the 0.6.1
// order).
// accept (query filters, src/filters.js) tests the row's block after a
// quoter folds into its original. Pass 1 is strict only;
// recall (typos, abbreviations) runs only when the strip is not yet full,
// because recall rows rank below every strict row.
export function rankRefs(index, plan, { limit = 3, recall = true, aliasExpand = true, picked = null, currentPage = null, prose = true, code = false, accept = null } = {}) {
  if (!index || !plan) return [];
  const hits = new Map();
  const withCode = !prose || code;
  const consider = (entry, opts) => {
    let match = matchFromKey(entry.key, plan, opts);
    let viaAlias = false;
    let inCode = false;
    if (withCode && entry.codeKey) {
      const codeMatch = matchFromKey(entry.codeKey, plan, opts);
      if (isPrecise(codeMatch) && (!isPrecise(match) || rankOf(codeMatch) > rankOf(match))) {
        match = codeMatch;
        inCode = true;
      }
    }
    if (aliasExpand && entry.aliasKey) {
      const aliasMatch = matchFromKey(entry.aliasKey, plan, opts);
      if (isPrecise(aliasMatch) && (!isPrecise(match) || rankOf(aliasMatch) > rankOf(match))) {
        match = aliasMatch;
        viaAlias = true;
        inCode = false;
      }
    }
    if (!isPrecise(match)) return false;
    let target = entry;
    if (entry.pureQuote && index.byUid.has(entry.pureQuote)) target = index.byUid.get(entry.pureQuote);
    if (accept && !accept(target)) return false;
    const previous = hits.get(target.uid);
    if (previous && rankOf(previous.match) >= rankOf(match)) return true;
    hits.set(target.uid, { entry: target, match, viaAlias, inCode });
    return true;
  };
  const strictHit = new Set();
  for (const entry of prefiltered(index, plan, aliasExpand, withCode)) {
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
  // 1 when the query matches inside a page or tag the block links; worked out
  // once per hit, and only when the comparator gets this far.
  const titled = (hit) => {
    if (hit.titled == null) {
      hit.entry.titleKeys ??= (hit.entry.linked || []).map((t) => searchKey(t));
      hit.titled = Number(hit.entry.titleKeys.some((k) => matchFromKey(k, plan, { strict: true }).level >= 2));
    }
    return hit.titled;
  };
  rows.sort((a, b) => rankOf(b.match) - rankOf(a.match)
    || pick(b) - pick(a)
    || Number(a.quoter) - Number(b.quoter)
    || (prose ? Number(a.entry.long) - Number(b.entry.long) : 0)
    || refStep(b.entry.refs) - refStep(a.entry.refs)
    || Number(b.viaAlias) - Number(a.viaAlias)
    || onPage(b) - onPage(a)
    || (prose ? titled(b) - titled(a) : 0)
    || b.match.score - a.match.score
    || a.entry.string.length - b.entry.string.length
    || (a.entry.uid < b.entry.uid ? -1 : a.entry.uid > b.entry.uid ? 1 : 0));
  return rows.slice(0, limit).map(({ entry, match, viaAlias, quoter, inCode }) => ({
    uid: entry.uid, string: entry.string, refs: entry.refs, page: entry.page, level: match.level, tier: match.tier, score: match.score, viaAlias, quoter,
    inCode, long: entry.long,
    picked: Boolean(picked?.get(entry.uid)), onPage: currentPage != null && entry.page === currentPage,
  }));
}

// Entries that pass the strict prefilter, cached per needle set. Typing
// forward only narrows the set (each new needle contains an old one), so the
// scan runs over the cached superset instead of the whole graph; Backspace
// returns to a cached set.
const PREFILTER_CACHE = 24;

function prefiltered(index, plan, aliasExpand, withCode) {
  const maybe = strictPrefilter(plan);
  const sig = `${aliasExpand ? 1 : 0}${withCode ? 1 : 0}\u0002${maybe.initial ?? ""}\u0002${maybe.needles.join("\u0001")}`;
  const cache = index.prefilter || (index.prefilter = new Map());
  const hit = cache.get(sig);
  if (hit) {
    cache.delete(sig);
    cache.set(sig, hit);
    return hit;
  }
  let source = index.entries;
  for (const [, cached] of cache) {
    if (cached.initial == null && cached.aliasExpand === aliasExpand && cached.withCode === withCode && cached.needles.length === maybe.needles.length
        && cached.needles.every((n, i) => maybe.needles[i].includes(n)) && cached.length < source.length) {
      source = cached;
    }
  }
  const list = source.filter((entry) => maybe(entry.key) || (aliasExpand && maybe(entry.aliasKey)) || (withCode && maybe(entry.codeKey)));
  list.needles = maybe.needles;
  list.initial = maybe.initial;
  list.aliasExpand = aliasExpand;
  list.withCode = withCode;
  cache.set(sig, list);
  if (cache.size > PREFILTER_CACHE) cache.delete(cache.keys().next().value);
  return list;
}

// Bands: a contiguous phrase or prefix (levels 2-3) always beats scattered
// words (level 1), whatever the refs; recall hits come after.
function rankOf(match) {
  return Math.min(match.level, 2);
}

function refStep(refs) {
  return Math.floor(Math.log2(1 + refs));
}
