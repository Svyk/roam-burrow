/* Burrow v0.2.0 | MIT | generated; edit src/ */

// src/search.js
var NUM_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
var ABBREV_FORWARD = {
  s: ["season", "series"],
  e: ["episode"],
  ep: ["episode"],
  v: ["volume", "version"],
  vol: ["volume"],
  q: ["quarter"],
  w: ["week"],
  wk: ["week"],
  ch: ["chapter"],
  pt: ["part"],
  no: ["number"],
  vs: ["versus"]
};
var ABBREV_REVERSE = /* @__PURE__ */ new Map();
for (const [key, vals] of Object.entries(ABBREV_FORWARD)) {
  for (const word of vals) ABBREV_REVERSE.set(word, key);
}
function stripRoamMarkup(value) {
  return String(value == null ? "" : value).replace(/^\s*([^:\n`]{1,80})::\s*/, "$1 ").replace(/\{\{[^{}]*\}\}/g, " ").replace(/\(\(([^()]*)\)\)/g, " ").replace(/\[([^\]]*)\]\(\[\[([^\]]*)\]\]\)/g, "$1 $2").replace(/\[\[|\]\]|#\[\[|\*\*|\^\^|__|~~/g, " ").replace(/(^|\s)#(?=\S)/g, "$1");
}
function searchKey(value) {
  let raw = String(value == null ? "" : value).toLowerCase();
  try {
    raw = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  } catch {
  }
  raw = raw.replace(/\s+/g, " ").trim();
  const spaced = raw.replace(/(\p{L})(\p{N})/gu, "$1 $2").replace(/(\p{N})(\p{L})/gu, "$1 $2").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  return { raw, spaced, compact: spaced.replace(/\s+/g, ""), tokens: spaced ? spaced.split(" ") : [] };
}
function numWord(n) {
  const i = Number(n);
  return Number.isInteger(i) && i >= 0 && i <= 12 ? NUM_WORDS[i] : null;
}
function tokenAlts(tokens) {
  const alts = tokens.map(() => /* @__PURE__ */ new Set());
  const compactRe = /^([a-z]+)(\d+)$/i;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    alts[i].add(t);
    const word = /^\d+$/.test(t) ? numWord(t) : null;
    if (word) alts[i].add(word);
    if (/^[a-z]+$/.test(t)) {
      const idx = NUM_WORDS.indexOf(t);
      if (idx >= 0) alts[i].add(String(idx));
      const abbrevKey = ABBREV_REVERSE.get(t);
      if (abbrevKey) alts[i].add(abbrevKey);
      for (const [key, vals] of Object.entries(ABBREV_FORWARD)) {
        if (vals.includes(t)) {
          alts[i].add(key);
          for (const v of vals) alts[i].add(v);
        }
      }
    }
    const cm = t.match(compactRe);
    if (cm) {
      alts[i].add(cm[1]);
      alts[i].add(cm[2]);
      for (const v of ABBREV_FORWARD[cm[1]] || []) {
        alts[i].add(v);
        alts[i].add(v + cm[2]);
      }
    }
    if (i + 1 < tokens.length && /^[a-z]+$/.test(t) && /^\d+$/.test(tokens[i + 1])) {
      const key = ABBREV_REVERSE.get(t) || (t.length === 1 ? t : null);
      if (key) {
        alts[i].add(key + tokens[i + 1]);
        alts[i + 1].add(key + tokens[i + 1]);
      }
    }
  }
  return alts;
}
var rowPrev2 = new Int16Array(64);
var rowPrev = new Int16Array(64);
var rowCur = new Int16Array(64);
function editDistance(a, b, max) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (!la) return lb <= max ? lb : max + 1;
  if (!lb) return la <= max ? la : max + 1;
  if (Math.abs(la - lb) > max) return max + 1;
  if (rowCur.length <= lb) {
    rowPrev2 = new Int16Array(lb + 1);
    rowPrev = new Int16Array(lb + 1);
    rowCur = new Int16Array(lb + 1);
  }
  for (let j = 0; j <= lb; j++) rowPrev[j] = j;
  for (let i = 1; i <= la; i++) {
    rowCur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rowPrev[j] + 1, rowCur[j - 1] + 1, rowPrev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rowPrev2[j - 2] + 1);
      rowCur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const spare = rowPrev2;
    rowPrev2 = rowPrev;
    rowPrev = rowCur;
    rowCur = spare;
  }
  return rowPrev[lb] <= max ? rowPrev[lb] : max + 1;
}
function initialisms(key) {
  if (key._init) return key._init;
  const inits = [];
  const tokens = key.tokens || [];
  let i = 0;
  while (i < tokens.length) {
    if (!/^[a-z]+$/.test(tokens[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < tokens.length && /^[a-z]+$/.test(tokens[j])) j++;
    const alphaRun = tokens.slice(i, j);
    let k = 0;
    while (k < alphaRun.length) {
      const single = alphaRun[k].length === 1;
      let m = k;
      while (m < alphaRun.length && alphaRun[m].length === 1 === single) m++;
      const run = alphaRun.slice(k, m);
      if (run.length >= 2) {
        if (single) {
          inits.push(run.join(""));
          if (run.length > 2) inits.push(run.slice(0, -1).join(""));
        } else inits.push(run.map((t) => t[0]).join(""));
      }
      k = m;
    }
    i = j;
  }
  key._init = inits;
  return inits;
}
function searchPlan(query) {
  const clauses = String(query == null ? "" : query).split("+").map((q) => {
    const key = searchKey(q);
    if (!key.compact) return null;
    key.tokenAlts = tokenAlts(key.tokens);
    return key;
  }).filter(Boolean);
  if (!clauses.length) return null;
  let needsInitialism = false;
  for (const clause of clauses) {
    for (const token of clause.tokens) {
      if (/^[a-z]{2,6}$/.test(token)) needsInitialism = true;
    }
  }
  return { clauses, compactLength: clauses.reduce((n, q) => n + q.compact.length, 0), needsInitialism };
}
function strictMatch(target, plan) {
  if (!target?.compact || !plan?.clauses?.length) return { score: -1, level: 0 };
  let total = 0;
  let level = 3;
  for (const q of plan.clauses) {
    let score = -1;
    if (target.raw === q.raw) score = 1200;
    else if (target.spaced === q.spaced) score = 1160;
    else if (target.compact === q.compact) score = 1120;
    else if (target.spaced.startsWith(q.spaced)) score = 980;
    else if (target.compact.startsWith(q.compact)) score = 940;
    else if (wordIncludes(target, q)) score = 840;
    else if (compactIncludes(target, q.compact)) score = 800;
    else {
      let at = -1, ordered = true, gap = 0;
      for (const token of q.tokens) {
        const next = target.tokens.indexOf(token, at + 1);
        if (next < 0) {
          ordered = false;
          break;
        }
        if (at >= 0) gap += Math.max(0, next - at - 1);
        at = next;
      }
      if (ordered) score = 640 - Math.min(120, gap * 8);
      else if (q.tokens.every((token) => tokenSet(target).has(token))) score = 500;
      else if (q.tokens.every((token) => target.tokens.some((candidate) => candidate.startsWith(token)))) score = 440;
      else if (q.tokens.length === 1 && q.compact.length >= 2 && q.compact.length <= 6 && target.tokens.length >= q.compact.length && initialsOf(target).startsWith(q.compact)) score = 380;
    }
    if (score < 0) return { score: -1, level: 0 };
    level = Math.min(level, score >= 1120 ? 3 : score >= 800 ? 2 : score === 440 ? 0 : 1);
    total += score;
  }
  return { score: total - Math.min(80, Math.max(0, target.compact.length - plan.compactLength)), level };
}
function initialsOf(key) {
  if (key._initials == null) key._initials = key.tokens.map((token) => token[0] || "").join("");
  return key._initials;
}
function strictPrefilter(plan) {
  const needles = plan.clauses.map((q) => q.tokens.reduce((a, b) => b.length > a.length ? b : a, ""));
  const one = plan.clauses.length === 1 && plan.clauses[0].tokens.length === 1 ? plan.clauses[0] : null;
  const initial = one && one.compact.length >= 2 && one.compact.length <= 6 ? one.compact : null;
  const test = (key) => {
    if (!key?.compact) return false;
    if (needles.every((n) => key.compact.includes(n))) return true;
    return initial != null && initialsOf(key).startsWith(initial);
  };
  test.needles = needles;
  test.initial = initial;
  return test;
}
function wordIncludes(target, q) {
  const words = q.tokens;
  if (!words.length) return false;
  const last = words.length - 1;
  for (const i of tokensFrom(target, words[0][0])) {
    if (i + last >= target.tokens.length) break;
    let ok = true;
    for (let k = 0; k <= last && ok; k++) {
      const t = target.tokens[i + k];
      ok = k === last ? t.startsWith(words[k]) : t === words[k];
    }
    if (ok) return true;
  }
  return false;
}
function compactIncludes(target, needle) {
  if (!needle) return false;
  for (const i of tokensFrom(target, needle[0])) {
    let rest = needle;
    for (let j = i; j < target.tokens.length; j++) {
      const t = target.tokens[j];
      if (rest.length <= t.length) {
        if (t.startsWith(rest)) return true;
        break;
      }
      if (!rest.startsWith(t)) break;
      rest = rest.slice(t.length);
    }
  }
  return false;
}
var NONE = [];
function tokensFrom(key, ch) {
  if (!key._byFirst) {
    key._byFirst = /* @__PURE__ */ new Map();
    key.tokens.forEach((token, i) => {
      const list = key._byFirst.get(token[0]);
      if (list) list.push(i);
      else key._byFirst.set(token[0], [i]);
    });
  }
  return key._byFirst.get(ch) || NONE;
}
function tokenSet(key) {
  if (!key._set) key._set = new Set(key.tokens);
  return key._set;
}
function recallTokenMatch(qForms, qOrig, tt, isInit) {
  const isNumQ = /^\d+$/.test(qOrig);
  const isNumT = /^\d+$/.test(tt);
  if (isNumQ || isNumT) {
    if (qOrig === tt) return { quality: 1, partial: true };
    return null;
  }
  let best = null;
  for (const qf of qForms) {
    if (qf === tt) {
      const q = qf === qOrig ? 1 : 0.8;
      if (!best || q > best.quality) best = { quality: q, partial: q >= 0.85 };
    } else if (tt.startsWith(qf) && qf.length >= 1) {
      const q = qf === qOrig ? 0.85 : 0.8;
      if (!best || q > best.quality) best = { quality: q, partial: q >= 0.85 };
    } else if (qf.length >= 4 && tt.includes(qf)) {
      if (!best || 0.6 > best.quality) best = { quality: 0.6, partial: false };
    } else if (qf.length >= 4) {
      const maxDist = qf.length >= 8 ? 2 : 1;
      if (editDistance(qf, tt, maxDist) <= maxDist) {
        if (!best || 0.55 > best.quality) best = { quality: 0.55, partial: false };
      }
    }
  }
  if (isInit && best && best.quality > 0) best = { ...best, quality: Math.min(best.quality, 0.8) };
  return best;
}
function matchFromKey(target, plan, opts = {}) {
  const empty = { score: -1, tier: "strict", level: 0 };
  if (!target?.compact || !plan?.clauses?.length) return empty;
  const strict = strictMatch(target, plan);
  if (strict.score >= 0) return { score: strict.score, tier: "strict", level: strict.level };
  if (opts.strict === true) return empty;
  const lengthPenalty = Math.min(80, Math.max(0, target.compact.length - plan.compactLength));
  let best = null;
  for (const clause of plan.clauses) {
    const tokens = clause.tokens;
    const alts = clause.tokenAlts || tokens.map((t) => /* @__PURE__ */ new Set([t]));
    const targetTokens = target.tokens || [];
    const inits = plan.needsInitialism ? initialisms(target) : [];
    const initOffset = targetTokens.length;
    const allTargets = targetTokens.concat(inits);
    const qualities = [];
    const usedTarget = /* @__PURE__ */ new Set();
    let anyExact = false;
    for (let qi = 0; qi < tokens.length; qi++) {
      const qOrig = tokens[qi];
      const qForms = alts[qi] || /* @__PURE__ */ new Set([qOrig]);
      let tokenBest = null;
      for (let ti = 0; ti < allTargets.length; ti++) {
        if (usedTarget.has(ti)) continue;
        const hit = recallTokenMatch(qForms, qOrig, allTargets[ti], ti >= initOffset);
        if (hit && (!tokenBest || hit.quality > tokenBest.quality)) tokenBest = { ...hit, targetIdx: ti };
      }
      if (tokenBest) {
        usedTarget.add(tokenBest.targetIdx);
        qualities.push(tokenBest.quality);
        if (tokenBest.quality === 1) anyExact = true;
      } else {
        qualities.push(0);
      }
    }
    const matched = qualities.filter((q) => q > 0).length;
    const unmatched = tokens.length - matched;
    let tier = "strict";
    if (unmatched > 0) {
      if (tokens.length <= 2) continue;
      if (unmatched > 1) continue;
      const missTok = tokens[qualities.findIndex((q) => q <= 0)];
      if (/^\d+$/.test(missTok)) continue;
      const alphaCount = tokens.filter((t) => /^[a-z]+$/.test(t)).length;
      if (alphaCount === 1 && /^[a-z]+$/.test(missTok)) continue;
      const longest = tokens.reduce((a, b) => a.length >= b.length ? a : b);
      if (missTok === longest) continue;
      tier = "close";
    }
    const avgQuality = qualities.reduce((s, q) => s + q, 0) / tokens.length;
    const base = tier === "close" ? 100 + Math.round(80 * avgQuality) : Math.round(300 * avgQuality) + 80;
    const score = base - lengthPenalty;
    if (score < 0) continue;
    if (!best || score > best.score || score === best.score && tier === "strict" && best.tier === "close") best = { score, tier, level: 0, recall: true, anyExact };
  }
  return best || empty;
}
function isPrecise(match) {
  if (!match || match.score < 0 || match.tier === "close") return false;
  return match.level >= 1 || Boolean(match.recall && match.anyExact);
}

// src/aliases.js
function parseAliasBlock(string, keyword = "Aliases") {
  const kw = String(keyword || "Aliases").trim();
  const text = String(string || "");
  const head = text.slice(0, kw.length + 2);
  if (head.toLowerCase() !== `${kw.toLowerCase()}::`) return [];
  return text.slice(kw.length + 2).split(",").map((value) => value.trim().replace(/^#?\[\[(.*)\]\]$/, "$1").replace(/^#/, "").trim()).filter(Boolean);
}
function keywordTitles(keyword = "Aliases") {
  const kw = String(keyword || "Aliases").trim();
  const lower = kw.toLowerCase();
  return [.../* @__PURE__ */ new Set([kw, lower, lower[0]?.toUpperCase() + lower.slice(1), kw.toUpperCase()])];
}
function buildAliasIndex(rows, keyword) {
  const entries = [];
  const byPage = /* @__PURE__ */ new Map();
  const exact = `${String(keyword || "Aliases").trim()}::`;
  for (const [string, title, uid] of rows || []) {
    const seenByRoamAliases = String(string).startsWith(exact);
    for (const alias of parseAliasBlock(string, keyword)) {
      if (alias.toLowerCase() === String(title).toLowerCase()) continue;
      entries.push({ alias, title, uid, key: searchKey(alias), seenByRoamAliases });
      if (!byPage.has(title)) byPage.set(title, []);
      byPage.get(title).push(alias);
    }
  }
  return { entries, byPage };
}
function matchAliases(index, plan, { strict = false, limit = 3, skip, picked = null } = {}) {
  if (!index || !plan) return [];
  const hits = [];
  for (const entry of index.entries) {
    if (skip?.(entry)) continue;
    const match = matchFromKey(entry.key, plan, { strict });
    if (match.score < 0 || match.tier === "close") continue;
    hits.push({ ...entry, score: match.score, level: match.level, tier: match.tier });
  }
  const pick = (hit) => picked?.get(`${hit.uid}:${hit.alias}`) || 0;
  hits.sort((a, b) => pick(b) - pick(a) || b.score - a.score || a.title.localeCompare(b.title) || a.alias.localeCompare(b.alias));
  return hits.slice(0, limit);
}
function roamAliasesWillList(entry, query) {
  return Boolean(entry.seenByRoamAliases) && entry.alias.toLowerCase().includes(String(query).toLowerCase());
}
function aliasInsertion(entry, format) {
  if (format === "[[Page]]") return `[[${entry.title}]]`;
  return `[${entry.alias}]([[${entry.title}]])`;
}

// src/refindex.js
var BLOCK_REF = /\(\(([\w-]{9})\)\)/g;
var PAGE_REF = /\[\[([^[\]]+)\]\]|#([^\s[\]#,]+)/g;
var RECALL_MAX_TOKENS = 40;
async function buildRefIndexSliced(rows, aliasesByPage, { sliceMs = 8, yieldTo: yieldTo2 }) {
  const index = startRefIndex(rows);
  let at = 0;
  while (at < index.entries.length) {
    const t0 = performance.now();
    while (at < index.entries.length && performance.now() - t0 < sliceMs) {
      keyEntry(index.entries[at++], index, aliasesByPage);
    }
    if (at < index.entries.length) await yieldTo2();
  }
  return index;
}
function startRefIndex(rows) {
  const byUid = /* @__PURE__ */ new Map();
  for (const [uid, string, refs, page] of rows || []) {
    byUid.set(uid, { uid, string: String(string || ""), refs: Number(refs) || 0, page: page ?? null });
  }
  return { entries: [...byUid.values()], byUid, words: /* @__PURE__ */ new Map(), builtAt: Date.now() };
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
  entry.pureQuote = quotes.length === 1 && !/[\p{L}\p{N}]/u.test(entry.string.replace(BLOCK_REF, "").replace(/\{\{[^{}]*\}\}/g, "")) ? quotes[0] : null;
  const aliases = [];
  if (aliasesByPage?.size) {
    for (const m of entry.string.matchAll(PAGE_REF)) {
      const found = aliasesByPage.get(m[1] || m[2]);
      if (found) aliases.push(...found);
    }
  }
  entry.aliasKey = aliases.length ? searchKey(aliases.join(" ")) : null;
  if (entry.key.tokens.length <= RECALL_MAX_TOKENS) {
    const seen = new Set(entry.aliasKey ? entry.key.tokens.concat(entry.aliasKey.tokens) : entry.key.tokens);
    for (const word of seen) {
      const list = index.words.get(word);
      if (list) list.push(entry);
      else index.words.set(word, [entry]);
    }
  }
}
function rankRefs(index, plan, { limit = 3, recall = true, aliasExpand = true, picked = null, currentPage = null } = {}) {
  if (!index || !plan) return [];
  const hits = /* @__PURE__ */ new Map();
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
  const strictHit = /* @__PURE__ */ new Set();
  for (const entry of prefiltered(index, plan, aliasExpand)) {
    if (consider(entry, { strict: true })) strictHit.add(entry);
  }
  const words = plan.clauses.reduce((n, q) => n + q.tokens.length, 0);
  if (recall && words >= 2 && hits.size < limit) {
    const candidates = /* @__PURE__ */ new Set();
    for (const clause of plan.clauses) {
      for (const word of clause.tokens) for (const entry of index.words.get(word) || []) candidates.add(entry);
    }
    for (const entry of candidates) if (!strictHit.has(entry)) consider(entry, {});
  }
  for (const hit of hits.values()) hit.quoter = hit.entry.quotes.some((uid) => uid !== hit.entry.uid && hits.has(uid));
  const rows = [...hits.values()];
  const pick = (hit) => picked?.get(hit.entry.uid) || 0;
  const onPage = (hit) => Number(currentPage != null && hit.entry.page === currentPage);
  rows.sort((a, b) => rankOf(b.match) - rankOf(a.match) || pick(b) - pick(a) || Number(a.quoter) - Number(b.quoter) || refStep(b.entry.refs) - refStep(a.entry.refs) || Number(b.viaAlias) - Number(a.viaAlias) || onPage(b) - onPage(a) || b.match.score - a.match.score || a.entry.string.length - b.entry.string.length || (a.entry.uid < b.entry.uid ? -1 : a.entry.uid > b.entry.uid ? 1 : 0));
  return rows.slice(0, limit).map(({ entry, match, viaAlias, quoter }) => ({
    uid: entry.uid,
    string: entry.string,
    refs: entry.refs,
    level: match.level,
    tier: match.tier,
    score: match.score,
    viaAlias,
    quoter,
    picked: Boolean(picked?.get(entry.uid)),
    onPage: currentPage != null && entry.page === currentPage
  }));
}
var PREFILTER_CACHE = 24;
function prefiltered(index, plan, aliasExpand) {
  const maybe = strictPrefilter(plan);
  const sig = `${aliasExpand ? 1 : 0}${maybe.initial ?? ""}${maybe.needles.join("")}`;
  const cache = index.prefilter || (index.prefilter = /* @__PURE__ */ new Map());
  const hit = cache.get(sig);
  if (hit) {
    cache.delete(sig);
    cache.set(sig, hit);
    return hit;
  }
  let source = index.entries;
  for (const [, cached] of cache) {
    if (cached.initial == null && cached.aliasExpand === aliasExpand && cached.needles.length === maybe.needles.length && cached.needles.every((n, i) => maybe.needles[i].includes(n)) && cached.length < source.length) {
      source = cached;
    }
  }
  const list = source.filter((entry) => maybe(entry.key) || aliasExpand && maybe(entry.aliasKey));
  list.needles = maybe.needles;
  list.initial = maybe.initial;
  list.aliasExpand = aliasExpand;
  cache.set(sig, list);
  if (cache.size > PREFILTER_CACHE) cache.delete(cache.keys().next().value);
  return list;
}
function rankOf(match) {
  return Math.min(match.level, 2);
}
function refStep(refs) {
  return Math.floor(Math.log2(1 + refs));
}

// src/titles.js
function buildTitleIndex(rows, aliases, withContent = null) {
  const byRaw = /* @__PURE__ */ new Map();
  const byLower = /* @__PURE__ */ new Map();
  const byCompact = /* @__PURE__ */ new Map();
  const add = (map, key, page) => {
    const list = map.get(key);
    if (!list) map.set(key, [page]);
    else if (!list.some((p) => p.uid === page.uid)) list.push(page);
  };
  for (const [title, uid] of rows || []) {
    if (typeof title !== "string" || !title) continue;
    if (withContent && /[#>]/.test(title) && !withContent.has(title)) continue;
    const page = { title, uid };
    byRaw.set(title, page);
    add(byLower, title.toLowerCase(), page);
    const compact = searchKey(title).compact;
    if (compact) add(byCompact, compact, page);
  }
  const aliasLower = /* @__PURE__ */ new Map();
  const aliasCompact = /* @__PURE__ */ new Map();
  for (const entry of aliases?.entries || []) {
    const page = { title: entry.title, uid: entry.uid };
    add(aliasLower, entry.alias.toLowerCase(), page);
    if (entry.key?.compact) add(aliasCompact, entry.key.compact, page);
  }
  const sorted = [...byLower.keys()].filter((t) => /[#>]/.test(t)).sort();
  const one = (list) => list?.length === 1 ? list[0] : null;
  return {
    size: byRaw.size,
    // Exact title, then case-insensitive, then separator-insensitive, then
    // an alias; an ambiguous spelling resolves to nothing.
    resolve(text) {
      const raw = String(text ?? "").trim();
      if (!raw) return null;
      if (byRaw.has(raw)) return byRaw.get(raw);
      const lower = raw.toLowerCase();
      const compact = searchKey(raw).compact;
      return one(byLower.get(lower)) || one(compact && byCompact.get(compact)) || one(aliasLower.get(lower)) || one(compact && aliasCompact.get(compact)) || null;
    },
    hasPrefix(lower) {
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = lo + hi >> 1;
        if (sorted[mid] < lower) lo = mid + 1;
        else hi = mid;
      }
      return lo < sorted.length && sorted[lo].startsWith(lower);
    }
  };
}

// src/indexes.js
var TTL_MS = 6e4;
var REFERENCED_BLOCKS = `[:find ?u ?s (count ?r) ?pt
  :where [?r :block/refs ?b] [?b :block/string ?s] [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?pt]]`;
var TITLES = "[:find ?t ?u :where [?p :node/title ?t] [?p :block/uid ?u]]";
var WITH_CONTENT = "[:find [?t ...] :in $ [?t ...] :where [?p :node/title ?t] [?p :block/children ?c]]";
var ALIAS_PAGES = "[:find [?a ...] :in $ [?t ...] :where [?a :node/title ?t]]";
var ALIAS_BLOCKS = `[:find ?s ?pt ?pu :in $ [?a ...]
  :where [?b :block/refs ?a] [?b :block/string ?s] [?b :block/page ?p] [?p :node/title ?pt] [?p :block/uid ?pu]]`;
var yieldTo = () => new Promise((resolve) => setTimeout(resolve, 0));
function createIndexes({ api, perf, setting, idle }) {
  let aliases = null;
  let refs = null;
  let titles = null;
  let builtAt = 0;
  let keyword = null;
  let pending = false;
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
      build().catch((error) => console.error("[burrow] index build failed", error)).finally(() => {
        pending = false;
      });
    });
  };
  return {
    get aliases() {
      return aliases;
    },
    get refs() {
      return refs;
    },
    get titles() {
      return titles;
    },
    schedule,
    build,
    refreshIfStale() {
      if (!builtAt || Date.now() - builtAt > TTL_MS || keyword !== (setting("aliasKeyword") || "Aliases")) schedule();
    }
  };
}

// src/lifecycle.js
function isPromiseLike(value) {
  return value != null && typeof value.then === "function";
}
async function callSafely(disposer) {
  const result = disposer();
  if (isPromiseLike(result)) await result;
}
function createLifecycle() {
  let disposed = false;
  const disposers = [];
  const add = (disposer) => {
    if (typeof disposer !== "function") throw new TypeError("A disposer must be a function");
    if (disposed) {
      void callSafely(disposer).catch((error) => console.error("[burrow] Late cleanup failed", error));
      return disposer;
    }
    disposers.push(disposer);
    return disposer;
  };
  return {
    get disposed() {
      return disposed;
    },
    add,
    async command(commandApi, config) {
      if (!commandApi?.addCommand || !commandApi?.removeCommand) {
        throw new TypeError("A command API with addCommand/removeCommand is required");
      }
      await commandApi.addCommand(config);
      add(() => commandApi.removeCommand({ label: config.label }));
    },
    event(target, type, listener, options) {
      target.addEventListener(type, listener, options);
      add(() => target.removeEventListener(type, listener, options));
      return listener;
    },
    interval(callback, delay, ...args) {
      const id = globalThis.setInterval(callback, delay, ...args);
      add(() => globalThis.clearInterval(id));
      return id;
    },
    timeout(callback, delay, ...args) {
      const id = globalThis.setTimeout(callback, delay, ...args);
      add(() => globalThis.clearTimeout(id));
      return id;
    },
    observer(observer, target, options) {
      observer.observe(target, options);
      add(() => observer.disconnect());
      return observer;
    },
    node(node, parent = globalThis.document?.body) {
      if (!parent) throw new Error("A parent node is required outside the browser");
      parent.append(node);
      add(() => node.remove());
      return node;
    },
    pullWatch(dataApi, pattern, entity, callback) {
      if (!dataApi?.addPullWatch || !dataApi?.removePullWatch) {
        throw new TypeError("A Roam data API with addPullWatch/removePullWatch is required");
      }
      dataApi.addPullWatch(pattern, entity, callback);
      add(() => dataApi.removePullWatch(pattern, entity, callback));
      return callback;
    },
    async settingsPanel(extensionAPI, config) {
      await extensionAPI.settings.panel.create(config);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      const errors = [];
      for (const disposer of disposers.splice(0).reverse()) {
        try {
          await callSafely(disposer);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "One or more extension cleanups failed");
    }
  };
}

// src/perf.js
function createPerf(size = 512) {
  const samples = { input: [], render: [] };
  const counters = { queries: 0, pulls: 0, builds: 0 };
  const push = (name, ms) => {
    const list = samples[name] || (samples[name] = []);
    list.push(ms);
    if (list.length > size) list.shift();
  };
  const pct = (name, p) => {
    const list = [...samples[name] || []].sort((a, b) => a - b);
    if (!list.length) return null;
    return list[Math.min(list.length - 1, Math.floor(p * list.length))];
  };
  return {
    samples,
    counters,
    push,
    time(name, fn) {
      const t0 = performance.now();
      try {
        return fn();
      } finally {
        push(name, performance.now() - t0);
      }
    },
    summary(name = "input") {
      return { n: samples[name]?.length || 0, p50: pct(name, 0.5), p95: pct(name, 0.95), max: pct(name, 1) };
    },
    reset() {
      for (const key of Object.keys(samples)) samples[key] = [];
      for (const key of Object.keys(counters)) counters[key] = 0;
    }
  };
}

// src/picks.js
var LIMIT = 200;
var MIN_QUERY = 2;
function createPickMemory({ storage, key }) {
  let picks = null;
  const load = () => {
    if (picks) return picks;
    try {
      picks = JSON.parse(storage?.getItem(key) || "[]");
    } catch {
      picks = [];
    }
    if (!Array.isArray(picks)) picks = [];
    return picks;
  };
  const save = () => {
    try {
      storage?.setItem(key, JSON.stringify(picks));
    } catch {
    }
  };
  return {
    record(kind, query, uid) {
      const q = searchKey(query).compact;
      if (q.length < MIN_QUERY || !uid) return;
      const list = load().filter((p) => !(p.kind === kind && p.q === q && p.uid === uid));
      list.push({ kind, q, uid, t: Date.now() });
      picks = list.slice(-LIMIT);
      save();
    },
    // uid -> recency rank (higher is more recent) for picks made with this
    // query or a longer one that starts with it.
    lookup(kind, query) {
      const q = searchKey(query).compact;
      const found = /* @__PURE__ */ new Map();
      if (q.length < MIN_QUERY) return found;
      const list = load();
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.kind === kind && p.q.startsWith(q)) found.set(p.uid, i + 1);
      }
      return found;
    },
    clear() {
      picks = [];
      save();
    }
  };
}

// src/settings.js
var DEFAULTS = Object.freeze({
  aliasPages: true,
  aliasExpand: true,
  refRanking: true,
  refPreselect: true,
  betterMatch: true,
  drill: true,
  drillPreview: true,
  pickMemory: false,
  pageBoost: true,
  aliasKeyword: "Aliases",
  aliasLinkFormat: "[alias]([[Page]])",
  perfHud: false
});
var SWITCHES = [
  ["aliasPages", "Alias rows in [[", "Typing a page alias in [[ shows the page. Hidden for aliases that roam-aliases already lists."],
  ["aliasExpand", "Alias expansion in ((", "In ((, an alias also finds referenced blocks that link to its page."],
  ["refRanking", "Referenced blocks first in ((", "Shows up to three already-referenced blocks above Roam's results, originals before blocks that quote them."],
  ["refPreselect", "Pre-select the referenced original", "The first referenced block starts selected, so Enter inserts it. ↓ past it returns to Roam's rows."],
  ["betterMatch", "Forgiving matching", "Abbreviations, initialisms and small typos for Burrow's rows. Off: separator-insensitive word matches only."],
  ["drill", "Drill-down in [[", "Type [[Page#heading > child to reach a block inside a page; Enter inserts its ((uid)). Only when the text before # or > is an exact page title or alias."],
  ["drillPreview", "Drill-down preview", "Shows the page outline around the block a drill-down resolves to, highlighted. Drill-down still works without it."],
  ["pickMemory", "Pick memory", "A Burrow row you picked ranks first the next time you type the same query. Kept in this browser only."],
  ["pageBoost", "Current page first", "Among equal referenced blocks in ((, blocks on the page you are editing rank first."],
  ["perfHud", "Performance readout", "Shows Burrow's per-key cost (p50/p95) in the corner. Also at window.__BURROW_PERF."]
];
function createSettingsReader(extensionAPI) {
  return (id) => {
    const value = extensionAPI.settings.get(id);
    return value == null ? DEFAULTS[id] : value;
  };
}
function createSettingsPanel({ onChange } = {}) {
  const changed = (id) => (event) => onChange?.(id, event);
  return {
    tabTitle: "Burrow",
    settings: [
      ...SWITCHES.map(([id, name, description]) => ({
        id,
        name,
        description,
        action: { type: "switch", onChange: changed(id) }
      })),
      {
        id: "aliasKeyword",
        name: "Alias attribute",
        description: "The attribute that holds a page's aliases. Use the same value as roam-aliases' Keyword. Matched without case.",
        action: { type: "input", placeholder: DEFAULTS.aliasKeyword, onChange: changed("aliasKeyword") }
      },
      {
        id: "aliasLinkFormat",
        name: "Alias link format",
        description: "What an alias row inserts in [[.",
        action: { type: "select", items: ["[alias]([[Page]])", "[[Page]]"], onChange: changed("aliasLinkFormat") }
      }
    ]
  };
}
async function initializeSettings(extensionAPI) {
  if (extensionAPI.settings.canSet === false) return;
  for (const [id, value] of Object.entries(DEFAULTS)) {
    if (extensionAPI.settings.get(id) == null) await extensionAPI.settings.set(id, value);
  }
}

// src/drill.js
function parseSteps(rest) {
  if (!rest || rest[0] !== "#" && rest[0] !== ">") return null;
  let heading = null;
  let tail = rest;
  if (rest[0] === "#") {
    const gt = rest.indexOf(">");
    heading = (gt < 0 ? rest.slice(1) : rest.slice(1, gt)).trim();
    tail = gt < 0 ? "" : rest.slice(gt);
  }
  const steps = tail ? tail.slice(1).split(">").map((q) => q.trim()) : [];
  return { heading, steps };
}
function parseDrill(query, titles) {
  const text = String(query ?? "");
  if (!/[#>]/.test(text) || !titles) return null;
  const lower = text.trim().toLowerCase();
  if (titles.hasPrefix(lower)) return null;
  for (let at = text.length - 1; at > 0; at--) {
    if (text[at] !== "#" && text[at] !== ">") continue;
    const title = text.slice(0, at).trim();
    if (!title) continue;
    const page = titles.resolve(title);
    if (!page) continue;
    const parsed = parseSteps(text.slice(at));
    if (!parsed) continue;
    return { page, typedTitle: title, ...parsed };
  }
  return null;
}
function bestMatch(candidates, query, { strict = false, first } = {}) {
  if (!candidates.length) return null;
  const plan = query ? searchPlan(query) : null;
  let ties = candidates;
  if (plan) {
    let bestScore = -1;
    ties = [];
    for (const node of candidates) {
      const match = matchFromKey(nodeKey(node), plan, { strict });
      if (match.score < 0) continue;
      if (match.score > bestScore) {
        bestScore = match.score;
        ties = [node];
      } else if (match.score === bestScore) ties.push(node);
    }
  }
  if (!ties.length) return null;
  return ties.length > 1 && first ? first(ties) : ties[0];
}
function nodeKey(node) {
  if (!node.key) node.key = searchKey(stripRoamMarkup(node.string ?? node.title ?? ""));
  return node.key;
}
function resolveDrill(parsed, source, { strict = false } = {}) {
  const { page } = parsed;
  let target = null;
  let failedAt = null;
  if (parsed.heading != null) {
    const hit = bestMatch(source.headings(page.uid), parsed.heading, { strict, first: source.first });
    if (hit) target = hit;
    else failedAt = 0;
  }
  if (failedAt == null) {
    for (let i = 0; i < parsed.steps.length; i++) {
      const kids = source.children(target ? target.uid : page.uid) || [];
      const hit = bestMatch(kids, parsed.steps[i], { strict });
      if (!hit) {
        failedAt = i + (parsed.heading != null ? 1 : 0);
        break;
      }
      target = hit;
    }
  }
  return {
    page,
    target,
    failedAt,
    insertion: target ? `((${target.uid}))` : `[[${page.title}]]`
  };
}

// src/pagetree.js
var TWO_LEVELS = `[:block/uid :node/title :block/string :block/heading :block/order
  {:block/children [:block/uid :block/string :block/heading :block/order
    {:block/children [:block/uid :block/string :block/heading :block/order {:block/children [:block/uid]}]}]}]`;
var UP = "[:block/uid :node/title :block/string :block/heading :block/order {:block/_children ...}]";
var PAGE_ID = "[:db/id]";
var HEADINGS = "[:find ?b ?h :in $ ?p :where [?b :block/page ?p] [?b :block/heading ?h]]";
var HEADING = "[:block/uid :block/string :block/heading :block/order]";
var FIRST_SCAN_LIMIT = 3e3;
function createTreeSource({ pull, q, onFetch }) {
  const nodes = /* @__PURE__ */ new Map();
  const headingsByPage = /* @__PURE__ */ new Map();
  const trails = /* @__PURE__ */ new Map();
  const node = (raw) => {
    const uid = raw[":block/uid"];
    let n = nodes.get(uid);
    if (!n) {
      n = {
        uid,
        string: raw[":block/string"] ?? null,
        title: raw[":node/title"] ?? null,
        heading: raw[":block/heading"] || 0,
        order: raw[":block/order"] ?? 0,
        kids: null
      };
      nodes.set(uid, n);
    } else if (n.string == null && raw[":block/string"] != null) {
      n.string = raw[":block/string"];
      n.heading = raw[":block/heading"] || 0;
      n.order = raw[":block/order"] ?? n.order;
    }
    return n;
  };
  const sortKids = (raw) => [...raw[":block/children"] || []].sort((a, b) => (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0));
  function load(uid) {
    onFetch?.("pull");
    const raw = pull(TWO_LEVELS, [":block/uid", uid]);
    if (!raw) return [];
    const self = node(raw);
    self.kids = sortKids(raw).map((child) => {
      const c = node(child);
      c.kids = sortKids(child).map((grand) => {
        const g = node(grand);
        if (!g.kids && !grand[":block/children"]?.length) g.kids = [];
        return g;
      });
      return c;
    });
    return self.kids;
  }
  function children(uid) {
    return nodes.get(uid)?.kids || load(uid);
  }
  function twoLevels(uid) {
    const kids = children(uid);
    return kids.some((k) => k.kids == null) ? load(uid) : kids;
  }
  function headings(pageUid) {
    if (headingsByPage.has(pageUid)) return headingsByPage.get(pageUid);
    onFetch?.("query");
    const page = pull(PAGE_ID, [":block/uid", pageUid]);
    const rows = page ? q(HEADINGS, page[":db/id"]) || [] : [];
    const list = [];
    for (const [eid, heading] of rows) {
      if (!(heading > 0)) continue;
      const raw = pull(HEADING, eid);
      if (raw) list.push(node(raw));
    }
    headingsByPage.set(pageUid, list);
    return list;
  }
  function trail(uid) {
    if (trails.has(uid)) return trails.get(uid);
    onFetch?.("pull");
    const raw = pull(UP, [":block/uid", uid]);
    const chain = [];
    let at = raw?.[":block/_children"]?.[0];
    while (at) {
      chain.unshift(node(at));
      at = at[":block/_children"]?.[0];
    }
    const self = raw ? node(raw) : null;
    if (self && raw[":block/order"] != null) self.order = raw[":block/order"];
    trails.set(uid, chain);
    return chain;
  }
  function first(candidates) {
    const want = new Set(candidates.map((c) => c.uid));
    const page = trail(candidates[0].uid)[0];
    if (page) {
      let seen = 0;
      const stack = [page.uid];
      while (stack.length && seen < FIRST_SCAN_LIMIT) {
        const uid = stack.pop();
        seen += 1;
        if (want.has(uid)) return nodes.get(uid);
        const kids = children(uid);
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i].uid);
      }
    }
    const path = (c) => trail(c.uid).slice(1).map((a) => a.order).concat(nodes.get(c.uid)?.order ?? 0);
    return [...candidates].sort((a, b) => {
      const pa = path(a);
      const pb = path(b);
      for (let i = 0; i < Math.min(pa.length, pb.length); i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
      return pa.length - pb.length;
    })[0];
  }
  return {
    children,
    twoLevels,
    headings,
    trail,
    first,
    get: (uid) => nodes.get(uid) || null,
    clear() {
      nodes.clear();
      headingsByPage.clear();
      trails.clear();
    },
    get size() {
      return nodes.size;
    }
  };
}

// src/preview.js
var SIBLING_WINDOW = 24;
var CHILD_LIMIT = 16;
var ITEM_LIMIT = 80;
var GAP = 4;
var WIDTH = 400;
var MAX_HEIGHT = 300;
var DRILL_CLASS = "burrow-drill";
function previewModel(result, tree, text) {
  const { page, target } = result;
  const trailNodes = target ? tree.trail(target.uid) : [];
  const parentUid = trailNodes.length ? trailNodes[trailNodes.length - 1].uid : page.uid;
  const trail = [page.title, ...trailNodes.slice(1).map((n) => text(n.string || ""))];
  const items = [];
  const pushKids = (uid, depth, levels) => {
    const kids = levels > 1 ? tree.twoLevels(uid) : tree.children(uid);
    for (const kid of kids.slice(0, CHILD_LIMIT)) {
      if (items.length >= ITEM_LIMIT) return;
      items.push({ uid: kid.uid, text: text(kid.string || ""), depth, heading: kid.heading, target: false });
      if (levels > 1 && kid.kids?.length) pushKids(kid.uid, depth + 1, levels - 1);
    }
    if (kids.length > CHILD_LIMIT) items.push({ more: kids.length - CHILD_LIMIT, depth });
  };
  if (!target) {
    pushKids(page.uid, 0, 2);
    return { key: `page:${page.uid}`, trail, items };
  }
  const siblings = tree.children(parentUid);
  let at = siblings.findIndex((s) => s.uid === target.uid);
  if (at < 0) at = 0;
  const from = Math.max(0, Math.min(at - Math.floor(SIBLING_WINDOW / 2), siblings.length - SIBLING_WINDOW));
  if (from > 0) items.push({ more: from, depth: 0 });
  for (const sib of siblings.slice(from, from + SIBLING_WINDOW)) {
    const isTarget = sib.uid === target.uid;
    items.push({ uid: sib.uid, text: text(sib.string || ""), depth: 0, heading: sib.heading, target: isTarget });
    if (isTarget) pushKids(target.uid, 1, 2);
  }
  if (from + SIBLING_WINDOW < siblings.length) items.push({ more: siblings.length - from - SIBLING_WINDOW, depth: 0 });
  if (!siblings.length) items.push({ uid: target.uid, text: text(target.string || ""), depth: 0, heading: target.heading, target: true });
  return { key: `node:${target.uid}`, trail, items };
}
function createPreview({ doc, win, lifecycle }) {
  const pane = doc.createElement("div");
  pane.className = "burrow-preview bp3-elevation-3";
  pane.hidden = true;
  pane.setAttribute("aria-hidden", "true");
  const trailNode = doc.createElement("div");
  trailNode.className = "burrow-trail";
  const outline = doc.createElement("div");
  outline.className = "burrow-outline";
  pane.append(trailNode, outline);
  lifecycle.node(pane, doc.body);
  let shownKey = null;
  let pop = null;
  function render(model) {
    trailNode.replaceChildren();
    model.trail.forEach((part, i) => {
      if (i) trailNode.append(Object.assign(doc.createElement("span"), { className: "burrow-sep", textContent: " › " }));
      trailNode.append(Object.assign(doc.createElement("span"), { className: "burrow-crumb", textContent: part }));
    });
    const rows = model.items.map((item) => {
      const row = doc.createElement("div");
      row.className = "burrow-node";
      row.style.setProperty("--burrow-depth", String(item.depth));
      if (item.more != null) {
        row.classList.add("burrow-more");
        row.textContent = `… ${item.more} more`;
        return row;
      }
      if (item.heading) row.classList.add(`burrow-h${item.heading}`);
      if (item.target) row.classList.add("burrow-target");
      const bullet = Object.assign(doc.createElement("span"), { className: "burrow-bullet" });
      const body = Object.assign(doc.createElement("span"), { className: "burrow-body", textContent: item.text || " " });
      row.append(bullet, body);
      return row;
    });
    outline.replaceChildren(...rows);
  }
  function place() {
    const native = pop.querySelector(".rm-autocomplete__preview");
    if (native && pop.classList.contains("rm-autocomplete__results--expanded")) {
      const r2 = native.getBoundingClientRect();
      Object.assign(pane.style, {
        left: `${Math.round(r2.left)}px`,
        top: `${Math.round(r2.top)}px`,
        width: `${Math.round(r2.width)}px`,
        height: `${Math.round(r2.height)}px`,
        maxHeight: ""
      });
      pane.classList.add("burrow-preview-docked");
      return;
    }
    const r = pop.getBoundingClientRect();
    const height = Math.min(MAX_HEIGHT, pane.scrollHeight || MAX_HEIGHT);
    let left = r.right + GAP;
    let top = r.top;
    if (left + WIDTH > win.innerWidth) {
      if (r.left - GAP - WIDTH >= 0) left = r.left - GAP - WIDTH;
      else {
        left = Math.max(0, Math.min(r.left, win.innerWidth - WIDTH));
        top = r.bottom + GAP + height <= win.innerHeight ? r.bottom + GAP : Math.max(0, r.top - GAP - height);
      }
    }
    Object.assign(pane.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${WIDTH}px`, height: "", maxHeight: `${MAX_HEIGHT}px` });
    pane.classList.remove("burrow-preview-docked");
  }
  function scrollToTarget() {
    const target = outline.querySelector(".burrow-target");
    if (!target) {
      pane.scrollTop = 0;
      return;
    }
    const top = target.offsetTop - trailNode.offsetHeight;
    const bottom = target.offsetTop + target.offsetHeight;
    if (top < pane.scrollTop) pane.scrollTop = Math.max(0, top - 4);
    else if (bottom > pane.scrollTop + pane.clientHeight) pane.scrollTop = bottom - pane.clientHeight + 4;
  }
  return {
    node: pane,
    show(model, popover) {
      if (pop && pop !== popover) pop.classList.remove(DRILL_CLASS);
      pop = popover;
      pop.classList.add(DRILL_CLASS);
      const changed = model.key !== shownKey || pane.hidden;
      if (model.key !== shownKey) {
        render(model);
        shownKey = model.key;
      }
      pane.hidden = false;
      place();
      if (changed) scrollToTarget();
    },
    hide() {
      pane.hidden = true;
      shownKey = null;
      if (pop) pop.classList.remove(DRILL_CLASS);
      pop = null;
    }
  };
}

// src/theme.js
var DARK_MARKERS = [
  ["html", "bp3-dark"],
  ["body", "bp3-dark"],
  ["body", "bt-theme-dark"],
  ["body", "rm-dark-theme"]
];
function parseRgb(value) {
  const m = String(value || "").match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
}
function luminance({ r, g, b }) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function isDarkHost(doc = globalThis.document) {
  if (!doc) return false;
  for (const [tag, cls] of DARK_MARKERS) {
    const el = tag === "html" ? doc.documentElement : doc.body;
    if (el?.classList.contains(cls)) return true;
  }
  if (doc.body?.classList.contains("roam-body") && doc.body.classList.contains("dark")) return true;
  const bg = parseRgb(globalThis.getComputedStyle?.(doc.body).backgroundColor);
  return Boolean(bg && bg.a > 0 && luminance(bg) < 0.2);
}

// src/token.js
function findToken(value, caret) {
  if (typeof value !== "string" || !Number.isInteger(caret) || caret < 2) return null;
  const before = value.slice(0, caret);
  const page = before.lastIndexOf("[[");
  const block = before.lastIndexOf("((");
  const start = Math.max(page, block);
  if (start < 0) return null;
  const kind = start === page ? "[[" : "((";
  const close = kind === "[[" ? "]]" : "))";
  const query = before.slice(start + 2);
  if (query.includes(close) || query.includes("\n")) return null;
  if (kind === "[[" && query.includes("[[")) return null;
  const end = value.startsWith(close, caret) ? caret + close.length : caret;
  return { kind, start, end, caret, query, closed: end !== caret };
}
function applyToken(value, token, insertion) {
  return value.slice(0, token.start) + insertion + value.slice(token.end);
}
function tokenStillValid(value, selStart, selEnd, token) {
  if (selStart !== selEnd || selStart !== token.caret) return false;
  if (value.slice(token.start, token.caret) !== token.kind + token.query) return false;
  const close = token.kind === "[[" ? "]]" : "))";
  if (token.closed && !value.startsWith(close, token.caret)) return false;
  return true;
}

// src/strip.js
var POPUP = ".rm-autocomplete__results";
var NATIVE_ROWS = ".rm-autocomplete__results-scroll > div";
var OWNS = "burrow-owns-selection";
var PAD_CLASSES = ["burrow-pad-1", "burrow-pad-2", "burrow-pad-3"];
var ROW_LIMIT = 3;
var MIN_REF_QUERY = 3;
var MIN_ALIAS_QUERY = 2;
var POPUP_WAIT_FRAMES = 12;
var valueSetter = Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement?.prototype || {}, "value")?.set;
function createStrip({ setting, indexes, perf, lifecycle, api, picks = null, doc = document, win = window }) {
  const st = {
    phase: "IDLE",
    ta: null,
    token: null,
    uid: null,
    rows: [],
    active: -1,
    drill: null,
    pageTitle: null,
    pop: null,
    composing: false,
    ignoreNextInput: false,
    released: null,
    waitFrame: 0,
    observers: []
  };
  const debug = { lastFailure: null, commits: 0, trace: [] };
  const trace = (event) => {
    debug.trace.push({ t: Math.round(performance.now()), ...event });
    if (debug.trace.length > 60) debug.trace.shift();
  };
  const strip = doc.createElement("div");
  strip.className = "burrow-strip";
  strip.setAttribute("role", "listbox");
  strip.hidden = true;
  lifecycle.node(strip, doc.body);
  const preview = createPreview({ doc, win, lifecycle });
  const fast = api.data?.fast?.q ? (query, ...args) => api.data.fast.q(query, ...args) : (query, ...args) => api.q(query, ...args);
  const tree = createTreeSource({
    pull: (pattern, eid) => api.pull(pattern, eid),
    q: fast,
    onFetch: (kind) => {
      perf.counters[kind === "query" ? "drillQueries" : "drillPulls"] = (perf.counters[kind === "query" ? "drillQueries" : "drillPulls"] || 0) + 1;
    }
  });
  const anyFeature = () => setting("aliasPages") || setting("refRanking") || setting("drill");
  const isBlockInput = (el) => el?.tagName === "TEXTAREA" && el.classList.contains("rm-block-input");
  function rank(token) {
    st.drill = null;
    const recall = setting("betterMatch");
    if (token.kind === "[[" && setting("drill") && st.ta?.value[token.start - 1] !== "#") {
      const parsed = parseDrill(token.query, indexes.titles);
      if (parsed) {
        const result = resolveDrill(parsed, tree, { strict: !recall });
        st.drill = { ...result, key: `${result.page.uid}:${result.target?.uid ?? ""}` };
        return [drillRow(result)];
      }
    }
    const plan = searchPlan(token.query);
    if (!plan) return [];
    const compact = plan.clauses.reduce((n, c) => n + c.compact.length, 0);
    const memory = setting("pickMemory") ? picks : null;
    if (token.kind === "((") {
      if (!setting("refRanking") || compact < MIN_REF_QUERY) return [];
      return rankRefs(indexes.refs, plan, {
        limit: ROW_LIMIT,
        recall,
        aliasExpand: setting("aliasExpand"),
        picked: memory?.lookup("ref", token.query),
        currentPage: setting("pageBoost") ? st.pageTitle : null
      }).map((hit) => ({
        kind: "ref",
        key: `ref:${hit.uid}`,
        uid: hit.uid,
        refs: hit.refs,
        level: hit.level,
        text: displayText(hit.string),
        insertion: `((${hit.uid}))`,
        pick: hit.uid
      }));
    }
    if (!setting("aliasPages") || compact < MIN_ALIAS_QUERY) return [];
    if (st.ta?.value[token.start - 1] === "#") return [];
    const format = setting("aliasLinkFormat");
    return matchAliases(indexes.aliases, plan, { strict: !recall, limit: Infinity, picked: memory?.lookup("alias", token.query) }).map((hit) => ({
      kind: "alias",
      key: `alias:${hit.uid}:${hit.alias}`,
      uid: hit.uid,
      alias: hit.alias,
      title: hit.title,
      level: hit.level,
      insertion: aliasInsertion(hit, format),
      seenByRoamAliases: hit.seenByRoamAliases,
      pick: `${hit.uid}:${hit.alias}`
    }));
  }
  function drillRow(result) {
    const { page, target } = result;
    let crumb = page.title;
    if (target) {
      const parents = tree.trail(target.uid);
      if (parents.length > 1) crumb = readableText(parents[parents.length - 1].string);
    }
    return {
      kind: "drill",
      key: `drill:${result.insertion}`,
      uid: target?.uid ?? page.uid,
      level: 3,
      insertion: result.insertion,
      crumb: target ? crumb : null,
      text: target ? readableText(target.string) : page.title
    };
  }
  function readableText(string) {
    const byUid = indexes.refs?.byUid;
    return String(string ?? "").replace(/\(\(([\w-]{9})\)\)/g, (m, uid) => byUid?.get(uid)?.string ?? tree.get(uid)?.string ?? m).replace(/^\s*([^:\n`]{1,80})::/, "$1:").replace(/\{\{\[\[(TODO|DONE)\]\]\}\}\s*/g, "").replace(/\[([^\]]*)\]\(\[\[[^\]]*\]\]\)/g, "$1").replace(/#?\[\[([^\]]*)\]\]/g, "$1").replace(/\*\*|\^\^|__|~~/g, "").replace(/\s+/g, " ").trim();
  }
  function displayText(string) {
    const byUid = indexes.refs?.byUid;
    const resolved = string.replace(/\(\(([\w-]{9})\)\)/g, (m, uid) => byUid?.get(uid)?.string ?? m);
    return stripRoamMarkup(resolved).replace(/\s+/g, " ").trim();
  }
  let roamAliasesSheet = null;
  let blockHighlight = null;
  const detectRoamAliases = () => {
    for (const sheet of doc.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (!blockHighlight && rule.selectorText === ".block-highlight-blue" && rule.style?.backgroundColor) {
          blockHighlight = rule.style.backgroundColor;
        }
        if (!roamAliasesSheet && rule.selectorText?.includes(".rm-aliases")) roamAliasesSheet = sheet.ownerNode;
      }
    }
  };
  let detectId = null;
  const scheduleDetect = () => {
    if (detectId != null || typeof win.requestIdleCallback !== "function") return;
    detectId = win.requestIdleCallback(() => {
      detectId = null;
      try {
        detectRoamAliases();
      } catch {
      }
    }, { timeout: 5e3 });
  };
  scheduleDetect();
  lifecycle.add(() => {
    if (detectId != null) win.cancelIdleCallback(detectId);
  });
  function visibleRows() {
    if (!st.pop) return [];
    if (st.token?.kind !== "[[" || st.drill) return st.rows.slice(0, ROW_LIMIT);
    const nativeTitles = /* @__PURE__ */ new Set();
    for (const row of st.pop.querySelectorAll(NATIVE_ROWS)) {
      const title = row.getAttribute("title");
      if (title) nativeTitles.add(title.toLowerCase());
    }
    const listed = /* @__PURE__ */ new Set();
    for (const button of st.pop.querySelectorAll(".rm-aliases .rm-autocomplete-result")) {
      const m = button.textContent.match(/^\[(.*)\]\(\[\[(.*)\]\]\)$/s);
      if (m) listed.add(`${m[1].toLowerCase()}\0${m[2].toLowerCase()}`);
    }
    if (roamAliasesSheet && !roamAliasesSheet.isConnected) {
      roamAliasesSheet = null;
      scheduleDetect();
    }
    const roamAliasesPresent = Boolean(roamAliasesSheet) || Boolean(st.pop.querySelector(".rm-aliases"));
    const query = st.token.query;
    return st.rows.filter((row) => !nativeTitles.has(row.title.toLowerCase()) && !(roamAliasesPresent && roamAliasesWillList(row, query)) && !listed.has(`${row.alias.toLowerCase()}\0${row.title.toLowerCase()}`)).slice(0, ROW_LIMIT);
  }
  let shown = [];
  let shownQuery = null;
  function render() {
    const rows = visibleRows();
    const query = st.token?.query ?? null;
    const same = query === shownQuery && rows.length === shown.length && rows.every((row, i) => row.key === shown[i].key);
    if (!same) {
      strip.replaceChildren(...rows.map((row, i) => rowNode(row, i)));
      shown = rows;
      shownQuery = query;
    }
    if (!rows.length) {
      hideStrip();
      if (st.phase !== "IDLE") st.phase = "ARMED";
      return;
    }
    if (st.phase === "IDLE") st.phase = "ARMED";
    if (st.active >= rows.length) st.active = rows.length - 1;
    const preselect = (rows[0].kind === "drill" || st.token.kind === "((" && setting("refPreselect") && rows[0].level >= 2) && st.released !== releaseKey();
    if (st.phase === "ARMED" && preselect && st.active < 0) own(0);
    place(rows.length);
    paintActive();
    showPreview();
  }
  let model = null;
  function showPreview() {
    if (!st.drill || !setting("drillPreview") || !st.pop) {
      preview.hide();
      return;
    }
    if (model?.drillKey !== st.drill.key) {
      model = previewModel(st.drill, tree, readableText);
      model.drillKey = st.drill.key;
    }
    preview.show(model, st.pop);
  }
  function rowNode(row, i) {
    const node = doc.createElement("div");
    node.className = "burrow-row";
    node.setAttribute("role", "option");
    node.dataset.index = String(i);
    const text = doc.createElement("span");
    text.className = "burrow-text";
    if (row.kind === "alias") {
      text.append(highlight(row.alias), Object.assign(doc.createElement("span"), { className: "burrow-arrow", textContent: " ↳ " }), row.title);
      node.title = `${row.alias} → ${row.title}`;
    } else if (row.kind === "drill") {
      if (row.crumb) text.append(Object.assign(doc.createElement("span"), { className: "burrow-trail-inline", textContent: `${row.crumb} › ` }));
      text.append(row.text);
      node.title = row.crumb ? `${row.crumb} › ${row.text}` : row.text;
    } else {
      text.append(highlight(row.text));
      node.title = row.text;
    }
    node.append(text);
    if (row.kind === "ref") {
      const count = doc.createElement("sup");
      count.className = "rm-autocomplete__ref-count";
      count.textContent = String(row.refs);
      count.title = `${row.refs} block reference${row.refs === 1 ? "" : "s"}`;
      node.append(count);
    }
    return node;
  }
  function highlight(text) {
    const fragment = doc.createDocumentFragment();
    const words = (st.token?.query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1);
    if (!words.length) {
      fragment.append(text);
      return fragment;
    }
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${words.map(escapeRe).join("|")})`, "giu");
    let at = 0;
    for (const m of text.matchAll(re)) {
      fragment.append(text.slice(at, m.index));
      fragment.append(Object.assign(doc.createElement("span"), { className: "rm-search-match", textContent: m[0] }));
      at = m.index + m[0].length;
    }
    fragment.append(text.slice(at));
    return fragment;
  }
  function paintActive() {
    strip.querySelectorAll(".burrow-row").forEach((node, i) => {
      node.classList.toggle("burrow-active", st.phase === "OWNED" && i === st.active);
      node.setAttribute("aria-selected", String(st.phase === "OWNED" && i === st.active));
    });
    st.pop?.classList.toggle(OWNS, st.phase === "OWNED");
  }
  function place(count) {
    const pop = st.pop;
    for (const cls of PAD_CLASSES) pop.classList.toggle(cls, cls === PAD_CLASSES[count - 1]);
    const rect = pop.getBoundingClientRect();
    strip.style.left = `${Math.round(rect.left)}px`;
    strip.style.top = `${Math.round(rect.top)}px`;
    strip.style.width = `${Math.round(rect.width)}px`;
    strip.hidden = false;
  }
  function sampleTheme(pop) {
    const cs = win.getComputedStyle(pop);
    strip.style.setProperty("--burrow-bg", cs.backgroundColor);
    strip.style.setProperty("--burrow-fg", cs.color);
    strip.style.zIndex = String((Number.parseInt(cs.zIndex, 10) || 20) + 1);
    const firstRow = pop.querySelector(`${NATIVE_ROWS} .rm-autocomplete-result`);
    strip.style.font = firstRow ? win.getComputedStyle(firstRow).font : cs.font;
    const activeRow = [...pop.querySelectorAll(NATIVE_ROWS)].find((row) => row.style.backgroundColor);
    if (activeRow) strip.style.setProperty("--burrow-active", win.getComputedStyle(activeRow).backgroundColor);
    else strip.style.removeProperty("--burrow-active");
    const dark = isDarkHost(doc);
    strip.classList.toggle("burrow-dark", dark);
    for (const name of ["--burrow-bg", "--burrow-fg"]) preview.node.style.setProperty(name, strip.style.getPropertyValue(name));
    preview.node.style.zIndex = strip.style.zIndex;
    preview.node.style.font = strip.style.font;
    if (blockHighlight) preview.node.style.setProperty("--burrow-highlight", dark ? `color-mix(in srgb, ${blockHighlight} 28%, transparent)` : blockHighlight);
    else preview.node.style.removeProperty("--burrow-highlight");
    preview.node.classList.toggle("burrow-dark", dark);
  }
  function hideStrip() {
    strip.hidden = true;
    preview.hide();
    if (st.pop) {
      st.pop.classList.remove(OWNS, DRILL_CLASS, ...PAD_CLASSES);
    }
  }
  function attach(pop) {
    if (st.pop === pop) return;
    detach();
    st.pop = pop;
    sampleTheme(pop);
    const mo = new MutationObserver(() => {
      if (st.pop === pop && st.phase !== "IDLE") frame();
    });
    mo.observe(pop, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    const gone = new MutationObserver(() => {
      if (pop.isConnected || st.pop !== pop) return;
      if (doc.activeElement === st.ta && doc.querySelector(POPUP)) {
        trace({ ev: "popup-swapped" });
        detach();
        frame();
      } else {
        reset("popup-closed");
      }
    });
    gone.observe(pop.parentNode, { childList: true });
    st.observers = [mo, gone];
    indexes.refreshIfStale();
  }
  function detach() {
    for (const observer of st.observers) observer.disconnect();
    st.observers = [];
    preview.hide();
    if (st.pop) st.pop.classList.remove(OWNS, DRILL_CLASS, ...PAD_CLASSES);
    st.pop = null;
  }
  let frameQueued = false;
  function frame() {
    if (frameQueued) return;
    frameQueued = true;
    win.requestAnimationFrame(() => {
      if (frameQueued) draw();
    });
  }
  function draw() {
    frameQueued = false;
    if (st.phase === "IDLE" && !st.rows.length) return;
    const pop = st.pop?.isConnected ? st.pop : doc.querySelector(POPUP);
    if (!pop) {
      if (st.waitFrame++ < POPUP_WAIT_FRAMES) frame();
      else reset("no-popup");
      return;
    }
    st.waitFrame = 0;
    attach(pop);
    perf.time("render", render);
  }
  let pendingTa = null;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => flush();
  lifecycle.add(() => {
    pendingTa = null;
    channel.port1.close();
  });
  function scheduleEvaluate(ta) {
    const queued = pendingTa != null;
    pendingTa = ta;
    if (!queued) win.requestAnimationFrame(() => channel.port2.postMessage(0));
  }
  function flush() {
    const ta = pendingTa;
    if (!ta || lifecycle.disposed) return;
    pendingTa = null;
    perf.time("input", () => {
      evaluate(ta);
      if (frameQueued) draw();
    });
  }
  function reset(reason) {
    if (st.phase !== "IDLE" || st.rows.length) trace({ ev: "reset", reason });
    st.phase = "IDLE";
    st.rows = [];
    st.active = -1;
    st.token = null;
    st.released = null;
    st.drill = null;
    model = null;
    tree.clear();
    shown = [];
    shownQuery = null;
    strip.replaceChildren();
    hideStrip();
    detach();
  }
  function own(index) {
    st.phase = "OWNED";
    st.active = index;
    trace({ ev: "own", index });
  }
  function release() {
    st.phase = "ARMED";
    st.active = -1;
    st.released = releaseKey();
    trace({ ev: "release" });
  }
  const releaseKey = () => st.ta && st.token ? `${st.ta.id}:${st.token.start}` : null;
  function evaluate(ta) {
    if (!anyFeature() || st.composing) return reset("off");
    if (ta.selectionStart !== ta.selectionEnd) return reset("selection");
    const token = findToken(ta.value, ta.selectionStart);
    if (!token) return reset("no-token");
    if (st.ta !== ta || st.token?.start !== token.start) {
      st.uid = api.ui.getFocusedBlock?.()?.["block-uid"] ?? null;
      st.pageTitle = ta.closest?.("[data-page-title]")?.getAttribute("data-page-title") ?? null;
      st.active = -1;
      if (st.phase === "OWNED") st.phase = "ARMED";
    }
    st.ta = ta;
    st.token = token;
    st.rows = rank(token);
    if (!st.rows.length) {
      if (st.phase !== "IDLE") {
        st.phase = "ARMED";
        st.active = -1;
        shown = [];
        strip.replaceChildren();
        hideStrip();
      }
      return;
    }
    if (st.phase === "OWNED") st.active = 0;
    if (st.phase === "IDLE") st.phase = "ARMED";
    frame();
  }
  function onInput(event) {
    const ta = event.target;
    if (!isBlockInput(ta)) return;
    if (st.ignoreNextInput) {
      st.ignoreNextInput = false;
      return;
    }
    if (!anyFeature()) {
      if (st.phase !== "IDLE") reset("off");
      return;
    }
    scheduleEvaluate(ta);
  }
  function nativeActiveIsFirst() {
    const rows = st.pop?.querySelectorAll(NATIVE_ROWS);
    if (!rows?.length) return true;
    const active = [...rows].findIndex((row) => row.style.backgroundColor);
    return active <= 0;
  }
  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }
  const ACTION_KEYS = /* @__PURE__ */ new Set(["Enter", "Tab", "ArrowUp", "ArrowDown", "Escape"]);
  function onKeyDown(event) {
    if (pendingTa && ACTION_KEYS.has(event.key) && event.target === pendingTa) flush();
    if (st.phase === "IDLE") return;
    if (event.isComposing || st.composing || event.keyCode === 229) return;
    const ta = event.target;
    if (ta !== st.ta || !anyFeature()) {
      reset("foreign-key");
      return;
    }
    if (ta.selectionStart !== ta.selectionEnd) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const count = shown.length;
    const key = event.key;
    if (st.phase === "ARMED") {
      if (key === "ArrowUp" && !event.shiftKey && count && !strip.hidden && nativeActiveIsFirst()) {
        own(count - 1);
        paintActive();
        consume(event);
      }
      return;
    }
    if (event.shiftKey && key !== "Tab") return;
    if (shown[st.active]?.kind === "drill" && (key === "ArrowDown" || key === "ArrowUp")) {
      consume(event);
      return;
    }
    switch (key) {
      case "ArrowDown":
        if (st.active < count - 1) st.active += 1;
        else release();
        paintActive();
        consume(event);
        return;
      case "ArrowUp":
        if (st.active > 0) st.active -= 1;
        paintActive();
        consume(event);
        return;
      case "Enter":
      case "Tab": {
        if (event.shiftKey) return;
        const row = shown[st.active];
        if (row && commit(row)) consume(event);
        else reset("commit-refused");
        return;
      }
      case "Escape":
        release();
        paintActive();
        return;
      case "ArrowLeft":
      case "ArrowRight":
      case "Home":
      case "End":
      case "PageUp":
      case "PageDown":
        reset("caret-move");
        return;
      default:
    }
  }
  function commit(row) {
    const ta = st.ta;
    const token = st.token;
    const fail = (reason) => {
      debug.lastFailure = { reason, at: Date.now(), row: row?.key, value: ta?.value, token };
      trace({ ev: "commit-fail", reason });
      return false;
    };
    if (!ta || !token || !ta.isConnected) return fail("textarea-gone");
    if (doc.activeElement !== ta) return fail("not-focused");
    if (!tokenStillValid(ta.value, ta.selectionStart, ta.selectionEnd, token)) return fail("token-changed");
    const focused = api.ui.getFocusedBlock?.()?.["block-uid"] ?? null;
    if (!st.uid || focused !== st.uid) return fail("block-changed");
    const next = applyToken(ta.value, token, row.insertion);
    const caret = token.start + row.insertion.length;
    st.ignoreNextInput = true;
    valueSetter.call(ta, next);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    st.ignoreNextInput = false;
    if (row.pick && setting("pickMemory")) picks?.record(row.kind, token.query, row.pick);
    reset("committed");
    debug.commits += 1;
    trace({ ev: "commit", row: row.key });
    win.requestAnimationFrame(() => {
      if (ta.value !== next) {
        debug.lastFailure = { reason: "post-check", at: Date.now(), expected: next, actual: ta.value };
        return;
      }
      try {
        ta.setSelectionRange(caret, caret);
      } catch {
      }
    });
    return true;
  }
  function onStripMouseDown(event) {
    event.preventDefault();
    event.stopPropagation();
    const node = event.target.closest?.(".burrow-row");
    if (!node) return;
    const row = shown[Number(node.dataset.index)];
    if (row && !commit(row)) reset("click-refused");
  }
  function onCompositionStart(event) {
    if (!isBlockInput(event.target)) return;
    st.composing = true;
    pendingTa = null;
    reset("composition");
  }
  function onCompositionEnd(event) {
    if (!isBlockInput(event.target)) return;
    st.composing = false;
    if (anyFeature()) evaluate(event.target);
  }
  function onFocusOut(event) {
    if (event.target !== st.ta) return;
    win.setTimeout(() => {
      if (st.ta && doc.activeElement !== st.ta) reset("blur");
    }, 0);
  }
  const guarded = (name, handler) => (event) => {
    try {
      handler(event);
    } catch (error) {
      debug.lastFailure = { reason: `throw:${name}`, at: Date.now(), message: String(error?.message || error) };
      console.error(`[burrow] ${name} failed; falling back to Roam`, error);
      try {
        reset("error");
      } catch {
      }
    }
  };
  lifecycle.event(win, "keydown", guarded("keydown", onKeyDown), true);
  lifecycle.event(win, "input", guarded("input", onInput), true);
  lifecycle.event(win, "compositionstart", guarded("compositionstart", onCompositionStart), true);
  lifecycle.event(win, "compositionend", guarded("compositionend", onCompositionEnd), true);
  lifecycle.event(doc, "focusout", guarded("focusout", onFocusOut), true);
  lifecycle.event(strip, "mousedown", guarded("mousedown", onStripMouseDown));
  lifecycle.add(() => reset("unload"));
  return { state: st, debug, reset, tree };
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/extension.js
var VERSION = "0.2.0";
var activeLifecycle = null;
var FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pickMemory", "pageBoost"];
function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
function idleScheduler(lifecycle) {
  let pending = null;
  lifecycle.add(() => {
    if (pending) pending.cancel();
  });
  return (callback) => {
    const run = () => {
      pending = null;
      if (!lifecycle.disposed) callback();
    };
    if (typeof globalThis.requestIdleCallback === "function") {
      const id = globalThis.requestIdleCallback(run, { timeout: 4e3 });
      pending = { cancel: () => globalThis.cancelIdleCallback(id) };
    } else {
      const id = globalThis.setTimeout(run, 50);
      pending = { cancel: () => globalThis.clearTimeout(id) };
    }
  };
}
function installPerfHud({ lifecycle, perf, setting }) {
  const hud = document.createElement("div");
  hud.className = "burrow-hud";
  hud.hidden = true;
  lifecycle.node(hud, document.body);
  const fmt = (v) => v == null ? "–" : v.toFixed(1);
  lifecycle.interval(() => {
    hud.hidden = !setting("perfHud");
    if (hud.hidden) return;
    const s = perf.summary("input");
    hud.textContent = `burrow ${s.n} keys · p50 ${fmt(s.p50)} ms · p95 ${fmt(s.p95)} ms`;
  }, 1e3);
}
async function onload({ extensionAPI, extension }) {
  if (!extensionAPI) throw new TypeError("Roam did not provide extensionAPI");
  if (activeLifecycle) await activeLifecycle.dispose();
  const lifecycle = createLifecycle();
  activeLifecycle = lifecycle;
  try {
    const api = globalThis.window?.roamAlphaAPI;
    const setting = createSettingsReader(extensionAPI);
    const perf = createPerf();
    await initializeSettings(extensionAPI);
    let indexes = null;
    await lifecycle.settingsPanel(extensionAPI, createSettingsPanel({
      onChange: (id) => {
        if (id === "aliasKeyword") indexes?.schedule();
      }
    }));
    if (api && globalThis.document) {
      indexes = createIndexes({ api, perf, setting, idle: idleScheduler(lifecycle) });
      const picks = createPickMemory({ storage: safeLocalStorage(), key: `burrow:picks:${api.graph?.name ?? "graph"}` });
      const strip = createStrip({ setting, indexes, perf, lifecycle, api, picks });
      installPerfHud({ lifecycle, perf, setting });
      indexes.schedule();
      globalThis.window.__BURROW_PERF = perf;
      globalThis.window.__BURROW = { version: VERSION, state: strip.state, debug: strip.debug, indexes, tree: strip.tree, picks };
      lifecycle.add(() => {
        delete globalThis.window.__BURROW_PERF;
        delete globalThis.window.__BURROW;
      });
    }
    await lifecycle.command(extensionAPI.ui.commandPalette, {
      label: "Burrow: Disable all features",
      callback: async () => {
        for (const id of FEATURES) {
          await extensionAPI.settings.set(id, false);
        }
      }
    });
    console.info(`[burrow] Loaded v${extension?.version || VERSION}`);
  } catch (error) {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose().catch((cleanupError) => console.error(cleanupError));
    throw error;
  }
  return async () => {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose();
  };
}
async function onunload() {
  const lifecycle = activeLifecycle;
  activeLifecycle = null;
  if (lifecycle) await lifecycle.dispose();
  console.info("[burrow] Unloaded");
}
var extension_default = { onload, onunload };
export {
  VERSION,
  extension_default as default,
  onload,
  onunload
};
