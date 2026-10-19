/* Burrow v0.4.0 | MIT | generated; edit src/ */

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
  const pageAliases = /* @__PURE__ */ new Map();
  const exact = `${String(keyword || "Aliases").trim()}::`;
  for (const [string, title, uid] of rows || []) {
    const seenByRoamAliases = String(string).startsWith(exact);
    for (const alias of parseAliasBlock(string, keyword)) {
      if (alias.toLowerCase() === String(title).toLowerCase()) continue;
      entries.push({ alias, title, uid, key: searchKey(alias), seenByRoamAliases, refs: null });
      if (!byPage.has(title)) byPage.set(title, []);
      byPage.get(title).push(alias);
      if (!pageAliases.has(uid)) pageAliases.set(uid, []);
      if (!pageAliases.get(uid).includes(alias)) pageAliases.get(uid).push(alias);
    }
  }
  return { entries, byPage, pageAliases, refsByPage: /* @__PURE__ */ new Map() };
}
function setAliasRefs(index, rows) {
  const refsByPage = new Map(rows || []);
  for (const entry of index.entries) entry.refs = refsByPage.get(entry.uid) ?? null;
  index.refsByPage = refsByPage;
}
function groupAliasHits(hits, index) {
  const seen = /* @__PURE__ */ new Set();
  const rows = [];
  for (const hit of hits) {
    if (seen.has(hit.uid)) continue;
    seen.add(hit.uid);
    rows.push({
      uid: hit.uid,
      title: hit.title,
      alias: hit.alias,
      level: hit.level,
      score: hit.score,
      tier: hit.tier,
      refs: hit.refs ?? null,
      seenByRoamAliases: hit.seenByRoamAliases,
      aliases: index.pageAliases?.get(hit.uid) || [hit.alias]
    });
  }
  return rows;
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
var ALIAS_REFS = "[:find ?u (count ?r) :in $ [?u ...] :where [?p :block/uid ?u] [?r :block/refs ?p]]";
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

// src/refsearch.js
function insertOpener(value, caret) {
  return { value: value.slice(0, caret) + "(())" + value.slice(caret), caret: caret + 2 };
}
function parseInputId(id) {
  const match = /^block-input-(.+)-([A-Za-z0-9_-]{9})$/.exec(String(id ?? ""));
  return match ? { windowId: match[1], uid: match[2] } : null;
}
function isRefSearchHotkey(event) {
  return event.code === "Digit9" && Boolean(event.altKey) && Boolean(event.shiftKey) && !event.ctrlKey && !event.metaKey;
}
function createRefSearch({ api, doc = document, win = window, lifecycle, setting }) {
  let last = null;
  const isEditor = (node) => Boolean(node?.matches?.("textarea.rm-block-input"));
  lifecycle.event(doc, "focusin", (event) => {
    if (!isEditor(event.target)) return;
    const parsed = parseInputId(event.target.id);
    if (parsed) last = { id: event.target.id, ...parsed };
  }, true);
  lifecycle.event(doc, "focusout", (event) => {
    if (!isEditor(event.target)) return;
    const parsed = parseInputId(event.target.id);
    if (parsed) last = { id: event.target.id, ...parsed, caret: event.target.selectionEnd, at: Date.now() };
  }, true);
  const nextFrame = () => new Promise((resolve) => win.requestAnimationFrame ? win.requestAnimationFrame(resolve) : setTimeout(resolve, 16));
  async function open() {
    let ta = isEditor(doc.activeElement) ? doc.activeElement : null;
    if (!ta) {
      if (!last || last.at == null || Date.now() - last.at > 6e4) return false;
      await api.ui.setBlockFocusAndSelection({
        location: { "block-uid": last.uid, "window-id": last.windowId },
        selection: { start: last.caret }
      });
      const until = Date.now() + 1e3;
      while (Date.now() < until && !(isEditor(doc.activeElement) && doc.activeElement.id.endsWith(last.uid))) await nextFrame();
      if (!(isEditor(doc.activeElement) && doc.activeElement.id.endsWith(last.uid))) return false;
      ta = doc.activeElement;
    }
    const { value, caret } = insertOpener(ta.value, ta.selectionEnd);
    Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement?.prototype ?? HTMLTextAreaElement.prototype, "value").set.call(ta, value);
    ta.setSelectionRange(caret, caret);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  lifecycle.event(win, "keydown", (event) => {
    if (!setting("refSearchHotkey") || !isRefSearchHotkey(event) || event.isComposing) return;
    const target = event.target;
    if (!isEditor(target) || target.selectionStart !== target.selectionEnd) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    open();
  }, true);
  return { open, last: () => last };
}

// src/settings.js
var DEFAULTS = Object.freeze({
  aliasPages: true,
  aliasExpand: true,
  aliasInline: true,
  aliasPreselect: true,
  aliasChips: true,
  refRanking: true,
  refPreselect: true,
  betterMatch: true,
  drill: true,
  drillPreview: true,
  tabDrill: true,
  paneLayout: true,
  keyHints: true,
  pickMemory: false,
  pageBoost: true,
  rowPreview: true,
  aliasCreate: false,
  aliasDelete: false,
  drillOrdinals: true,
  drillEmpty: true,
  drillCap: true,
  refSearch: true,
  refSearchHotkey: false,
  aliasKeyword: "Aliases",
  aliasLinkFormat: "[alias]([[Page]])",
  perfHud: false
});
var SWITCHES = [
  ["aliasPages", "Alias rows in [[", "Typing a page alias in [[ shows the page. With Alias rows with their page off, aliases roam-aliases already lists are left to its column."],
  ["aliasExpand", "Alias expansion in ((", "In ((, an alias also finds referenced blocks that link to its page."],
  ["aliasInline", "Alias rows with their page", "One row per page an alias matches, alias ↳ Page with its reference count, also when roam-aliases is installed: its Aliases column folds into these rows instead of lying beside or over Roam's list. Off: Burrow leaves aliases that roam-aliases lists to its column."],
  ["aliasPreselect", "Pre-select the alias row", "When an alias starts with what you typed and no page has exactly that title, its row starts selected, so Enter inserts it."],
  ["aliasChips", "Alias chips", "Under a selected alias row, the page's other aliases as chips. ⌥↓ moves into them, ←/→ picks one (the line also scrolls with the mouse wheel or trackpad, and a chip shows its full alias when selected or hovered), Enter inserts the page shown as that alias, Esc goes back to the rows."],
  ["refRanking", "Referenced blocks first in ((", "Shows up to three already-referenced blocks above Roam's results, originals before blocks that quote them."],
  ["refPreselect", "Pre-select the referenced original", "The first referenced block starts selected, so Enter inserts it. ↓ past it returns to Roam's rows."],
  ["betterMatch", "Forgiving matching", "Abbreviations, initialisms and small typos for Burrow's rows. Off: separator-insensitive word matches only."],
  ["drill", "Drill-down in [[", "Type [[Page#heading > child to reach a block inside a page; Enter inserts its ((uid)). Only when the text before # or > is an exact page title or alias."],
  ["drillPreview", "Drill-down preview", "Shows the page outline around the block a drill-down resolves to, or around the highlighted block after Tab, highlighted. Drill-down still works without it."],
  ["tabDrill", "Tab drills in", "Tab on the highlighted page, or on a referenced block with children, lists its blocks in place under a breadcrumb. Type to filter, ↑/↓ to move, Enter inserts the block's ((uid)), Tab goes one level deeper, Shift+Tab or Backspace on an empty filter goes back, Esc returns to the results. With nothing to drill into, Tab does what Roam does."],
  ["paneLayout", "Keep panes apart", "Roam's preview, roam-aliases' column and the result list each get their own space in the picker; nothing is drawn over anything else."],
  ["keyHints", "Key hints", "A line at the bottom of the picker naming the keys Burrow adds, RefX style: ⌥A alias · ⌥↓ pick alias · ⇥/> drill · ⇧⇥ back · ⌃O preview · ↵ insert."],
  ["rowPreview", "Preview follows Burrow's rows", "With Roam's preview open (Ctrl-O), a selected Burrow row shows its own page or block there: an alias row its page, a referenced block its place in the outline."],
  ["aliasCreate", "Create aliases from the picker (writes to your graph)", "⌥A (Alt+A) on a highlighted page in [[ opens an alias field. Enter adds the alias to that page's alias block (creating the block if there is none) and inserts the aliased link; Esc cancels. Changes only that one block. Off by default."],
  ["aliasDelete", "Delete aliases from the chips (writes to your graph)", "Alt+Backspace on the selected alias chip asks to confirm; Enter removes only that alias from the page's alias block, Esc keeps it. Off by default."],
  ["drillOrdinals", "Ordinal matching in drill-down", "While drilled in, typing 1, 2, (b) or iii ranks blocks that start with that number or letter first."],
  ["drillEmpty", "Hide empty blocks in drill-down", "Empty blocks without children are left out of the drill list; empty blocks with children show as (empty) ▸ and stay drillable."],
  ["drillCap", "Long levels in slices", "A drill level lists 50 blocks and a +N more row; selecting it lists the next 50, so huge pages open fast."],
  ["refSearch", "Block reference search command", "Adds Burrow: block reference search to the command palette: it opens (( at the caret of the block you are editing. Bind your own key in Roam's Settings → Hotkeys, or use the switch below."],
  ["refSearchHotkey", "Alt+Shift+9 opens block reference search", "While editing a block, Alt+Shift+9 (⌥⇧9) opens (( at the caret. Off by default; Roam has no default use for this key."],
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

// src/aliasedit.js
var kwOf = (keyword) => String(keyword || "Aliases").trim();
var clean = (value) => value.trim().replace(/^#?\[\[(.*)\]\]$/, "$1").replace(/^#/, "").trim();
function validAlias(text) {
  const alias = String(text ?? "").trim();
  if (!alias) return { ok: false, reason: "type an alias" };
  if (alias.includes(",")) return { ok: false, reason: "no commas: Roam splits aliases on them" };
  if (/[\r\n[\]]/.test(alias) || alias.includes("((") || alias.includes("))")) return { ok: false, reason: "no brackets or line breaks" };
  return { ok: true, alias };
}
function isAliasBlock(string, keyword) {
  const kw = kwOf(keyword);
  return String(string).slice(0, kw.length + 2).toLowerCase() === `${kw.toLowerCase()}::`;
}
var holds = (string, keyword, alias) => parseAliasBlock(string, keyword).some((a) => a.toLowerCase() === alias.toLowerCase());
function appendAlias(string, keyword, alias) {
  if (!isAliasBlock(string, keyword)) return null;
  if (holds(string, keyword, alias)) return { string, changed: false };
  const at = kwOf(keyword).length + 2;
  if (!string.slice(at).trim()) return { string: `${string.slice(0, at)} ${alias}`, changed: true };
  return { string: `${string.trimEnd()}, ${alias}`, changed: true };
}
function removeAlias(string, keyword, alias) {
  if (!isAliasBlock(string, keyword)) return null;
  const at = kwOf(keyword).length + 2;
  const parts = string.slice(at).split(",");
  let index = parts.findIndex((part) => clean(part) === alias);
  if (index < 0) index = parts.findIndex((part) => clean(part).toLowerCase() === alias.toLowerCase());
  if (index < 0) return null;
  parts.splice(index, 1);
  return string.slice(0, at) + parts.join(",");
}
function findAliasBlocks(api, pageUid, keyword) {
  const attrIds = api.q("[:find [?a ...] :in $ [?t ...] :where [?a :node/title ?t]]", keywordTitles(keyword));
  if (!attrIds?.length) return [];
  const rows = api.q("[:find ?u ?s :in $ ?pu [?a ...] :where [?p :block/uid ?pu] [?b :block/page ?p] [?b :block/refs ?a] [?b :block/string ?s] [?b :block/uid ?u]]", pageUid, attrIds) || [];
  const blocks = rows.filter(([, string]) => isAliasBlock(string, keyword));
  if (!blocks.length) return [];
  const page = api.pull("[{:block/children [:block/uid]}]", [":block/uid", pageUid]);
  const topUids = new Set((page?.[":block/children"] || []).map((child) => child[":block/uid"]));
  return blocks.map(([uid, string]) => ({ uid, string, top: topUids.has(uid) })).sort((a, b) => Number(b.top) - Number(a.top) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
}
var freshString = (api, uid) => api.pull("[:block/string]", [":block/uid", uid])?.[":block/string"] ?? "";
var message = (error) => String(error?.message || error);
async function addAliasToPage(api, { pageUid, keyword, alias }) {
  try {
    const kw = kwOf(keyword);
    const blocks = findAliasBlocks(api, pageUid, kw);
    const held = blocks.find((block) => holds(block.string, kw, alias));
    if (held) return { ok: true, changed: false, blockUid: held.uid };
    if (blocks.length) {
      const uid2 = blocks[0].uid;
      const before = freshString(api, uid2);
      const result = appendAlias(before, kw, alias);
      if (!result) return { ok: false, error: "alias block changed" };
      if (!result.changed) return { ok: true, changed: false, blockUid: uid2 };
      await api.data.block.update({ block: { uid: uid2, string: result.string } });
      return { ok: true, changed: true, created: false, blockUid: uid2, before, after: result.string };
    }
    const uid = api.util.generateUID();
    const after = `${kw}:: ${alias}`;
    await api.data.block.create({ location: { "parent-uid": pageUid, order: 0 }, block: { string: after, uid } });
    return { ok: true, changed: true, created: true, blockUid: uid, before: null, after };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}
async function deleteAliasFromPage(api, { pageUid, keyword, alias }) {
  const missing = { ok: false, error: "alias not found on the page" };
  try {
    const blocks = findAliasBlocks(api, pageUid, keyword);
    const has = (block, test) => parseAliasBlock(block.string, keyword).some(test);
    const target = blocks.find((block) => has(block, (a) => a === alias)) || blocks.find((block) => has(block, (a) => a.toLowerCase() === alias.toLowerCase()));
    if (!target) return missing;
    const before = freshString(api, target.uid);
    const after = removeAlias(before, keyword, alias);
    if (after == null) return missing;
    await api.data.block.update({ block: { uid: target.uid, string: after } });
    return { ok: true, blockUid: target.uid, before, after };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

// src/ordinal.js
var ROMAN = /^(?=[ivx])x{0,3}(ix|iv|v?i{0,3})$/;
function ordinalQuery(query) {
  let q = String(query ?? "").trim().toLowerCase();
  if (q.startsWith("(")) q = q.slice(1);
  if (q.endsWith(")") || q.endsWith(".")) q = q.slice(0, -1);
  if (/^\d{1,3}$/.test(q) || /^[a-z]$/.test(q) || ROMAN.test(q)) return q;
  return null;
}
function startsWithOrdinal(text, token) {
  if (!token) return false;
  const t = String(text ?? "").trimStart().toLowerCase();
  const tok = String(token).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^\\(${tok}\\)(\\s|$)`).test(t)) return true;
  if (new RegExp(`^${tok}[.):](\\s|$)`).test(t)) return true;
  return /^\d+$/.test(token) && new RegExp(`^${tok}(\\s|$)`).test(t);
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
function bestMatch(candidates, query, { strict = false, first, ordinals = false, hideEmpty = false } = {}) {
  const plain = (node) => stripRoamMarkup(node.string ?? "").trim();
  let list = candidates;
  if (hideEmpty) {
    list = candidates.filter((node) => plain(node) || node.kids?.length);
    if (!String(query ?? "").trim()) list = [list.find((node) => plain(node)) ?? list[0]].filter(Boolean);
  }
  if (!list.length) return null;
  const token = ordinals ? ordinalQuery(query) : null;
  if (token) {
    const ords = list.filter((node) => startsWithOrdinal(plain(node), token));
    if (ords.length) return ords.length > 1 && first ? first(ords) : ords[0];
  }
  const plan = query ? searchPlan(query) : null;
  let ties = list;
  if (plan) {
    let bestScore = -1;
    ties = [];
    for (const node of list) {
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
function resolveDrill(parsed, source, { strict = false, ordinals = false, hideEmpty = false } = {}) {
  const { page } = parsed;
  let target = null;
  let failedAt = null;
  if (parsed.heading != null) {
    const hit = bestMatch(source.headings(page.uid), parsed.heading, { strict, first: source.first, ordinals, hideEmpty });
    if (hit) target = hit;
    else failedAt = 0;
  }
  if (failedAt == null) {
    for (let i = 0; i < parsed.steps.length; i++) {
      const kids = source.children(target ? target.uid : page.uid) || [];
      const hit = bestMatch(kids, parsed.steps[i], { strict, ordinals, hideEmpty });
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

// src/hints.js
var IS_MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");
var NAMED = {
  altA: ["⌥A", "Alt+A"],
  altDown: ["⌥↓", "Alt+↓"],
  altBackspace: ["⌥⌫", "Alt+⌫"],
  ctrlO: ["⌃O", "Ctrl+O"]
};
function keyLabel(name, mac = IS_MAC) {
  const pair = NAMED[name];
  return pair ? pair[mac ? 0 : 1] : name;
}
function hintsKey(items) {
  return items.map(([keys, label]) => `${keys}\0${label}`).join("");
}
function renderHints(doc, node, items) {
  const span = (className, textContent) => Object.assign(doc.createElement("span"), { className, textContent });
  const parts = [];
  items.forEach(([keys, label], i) => {
    if (i) parts.push(span("burrow-hint-sep", " · "));
    const item = span("burrow-hint", "");
    item.append(span("burrow-hint-key", keys), ` ${label}`);
    parts.push(item);
  });
  node.replaceChildren(...parts);
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
        row.textContent = `+${item.more} more`;
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
  function place(avoid, beside) {
    const native = pop.querySelector(".rm-autocomplete__preview");
    if (!beside && native && pop.classList.contains("rm-autocomplete__results--expanded")) {
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
    const r = beside || pop.getBoundingClientRect();
    const height = Math.min(MAX_HEIGHT, pane.scrollHeight || MAX_HEIGHT);
    let left = r.right + GAP;
    let top = r.top;
    if (left + WIDTH > win.innerWidth) {
      if (r.left - GAP - WIDTH >= 0) left = r.left - GAP - WIDTH;
      else {
        left = Math.max(0, Math.min(r.left, win.innerWidth - WIDTH));
        const below = r.bottom + GAP;
        const above = Math.max(0, r.top - GAP - height);
        const hits = (y) => avoid && left < avoid.right && left + WIDTH > avoid.left && y < avoid.bottom && y + height > avoid.top;
        if (below + height <= win.innerHeight && !hits(below)) top = below;
        else if (!hits(above)) top = above;
        else top = below + height <= win.innerHeight ? below : above;
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
    show(model, popover, { avoid = null, beside = null } = {}) {
      if (pop && pop !== popover) pop.classList.remove(DRILL_CLASS);
      pop = popover;
      if (!beside) pop.classList.add(DRILL_CLASS);
      const changed = model.key !== shownKey || pane.hidden;
      if (model.key !== shownKey) {
        render(model);
        shownKey = model.key;
      }
      pane.hidden = false;
      place(avoid, beside);
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

// src/scope.js
function scopeRows(nodes, query, { strict = false, text = (s) => s, ordinals = false, hideEmpty = false } = {}) {
  const row = (node, ord = false) => {
    const shown = text(node.string ?? "");
    return { uid: node.uid, text: shown, empty: !shown.trim(), ord, heading: node.heading || 0, drillable: Boolean(node.kids?.length), node };
  };
  const kept = hideEmpty ? nodes.filter((node) => text(node.string ?? "").trim() || node.kids?.length) : nodes;
  const plan = String(query ?? "").trim() ? searchPlan(query) : null;
  if (!plan) return kept.map((node) => row(node));
  const token = ordinals ? ordinalQuery(query) : null;
  const hits = [];
  kept.forEach((node, index) => {
    const ord = Boolean(token) && startsWithOrdinal(text(node.string ?? ""), token);
    const match = matchFromKey(nodeKey(node), plan, { strict });
    if (!ord && (match.score < 0 || match.tier === "close")) return;
    hits.push({ node, index, ord, score: match.score });
  });
  hits.sort((a, b) => Number(b.ord) - Number(a.ord) || b.score - a.score || a.index - b.index);
  return hits.map((hit) => row(hit.node, hit.ord));
}
var CAP = 50;
function capRows(rows, limit) {
  if (limit === Infinity || limit >= rows.length) return rows;
  return [...rows.slice(0, limit), { more: rows.length - limit, key: "more", uid: null, text: "", drillable: false }];
}
function firstReal(rows) {
  const at = rows.findIndex((row) => !row.empty && row.more == null);
  return at < 0 ? 0 : at;
}

// src/scopeview.js
var MAX_LABEL = 40;
function createScopePanel({ doc, win, lifecycle, highlight }) {
  const node = doc.createElement("div");
  node.className = "burrow-scope bp3-elevation-3";
  node.setAttribute("role", "listbox");
  node.hidden = true;
  const crumb = doc.createElement("div");
  crumb.className = "burrow-scope-crumb";
  const list = doc.createElement("div");
  list.className = "burrow-scope-list";
  const hintsLine = doc.createElement("div");
  hintsLine.className = "burrow-scope-hints";
  node.append(crumb, list, hintsLine);
  lifecycle.node(node, doc.body);
  let listKey = null;
  const span = (className, textContent) => Object.assign(doc.createElement("span"), { className, textContent });
  const ellipsize = (text) => text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
  function renderCrumb(scope) {
    const level = scope.levels[scope.levels.length - 1];
    const parts = [span("burrow-crumb burrow-crumb-root", scope.rootLabel)];
    scope.levels.forEach((l, i) => {
      parts.push(span("burrow-sep", " › "));
      const part = span("burrow-crumb", ellipsize(l.label));
      part.dataset.level = String(i);
      parts.push(part);
    });
    const filter = span("burrow-scope-filter", level.query || "type to filter");
    filter.classList.toggle("burrow-placeholder", !level.query);
    crumb.replaceChildren(...parts, filter);
  }
  function renderList(scope) {
    const level = scope.levels[scope.levels.length - 1];
    const more = scope.rows.reduce((sum, r) => sum + (r.more ?? 0), 0);
    const key = `${level.uid}\0${level.query}\0${more}\0${scope.rows.map((r) => r.uid).join(",")}`;
    if (key === listKey) return;
    listKey = key;
    if (!scope.rows.length) {
      const self = doc.createElement("div");
      self.className = "burrow-row burrow-self";
      self.setAttribute("role", "option");
      self.dataset.index = "0";
      self.append(span("burrow-muted", "Insert "), level.label);
      list.replaceChildren(self);
      return;
    }
    list.replaceChildren(...scope.rows.map((row, i) => {
      const item = doc.createElement("div");
      item.className = "burrow-row";
      item.setAttribute("role", "option");
      item.dataset.index = String(i);
      if (row.more != null) {
        item.classList.add("burrow-more-row");
        item.textContent = `+${row.more} more`;
        return item;
      }
      if (row.heading) item.classList.add(`burrow-h${row.heading}`);
      const text = doc.createElement("span");
      text.className = "burrow-text";
      if (row.text) text.append(highlight(row.text, level.query));
      else if (row.drillable) {
        item.classList.add("burrow-empty-row");
        text.append(span("burrow-empty", "(empty) ▸"));
      } else text.append(span("burrow-empty", "(empty)"));
      item.append(text);
      if (row.drillable && row.text) item.append(span("burrow-drill-mark", "›"));
      return item;
    }));
  }
  let hintsShown = null;
  function renderHints2(scope, on) {
    hintsLine.hidden = !on;
    if (!on) return;
    const level = scope.levels[scope.levels.length - 1];
    const active = scope.rows[level.active];
    const items = [];
    if (active?.drillable) items.push(["⇥/>", "drill"]);
    items.push(["⇧⇥", "back"], [keyLabel("ctrlO"), "preview"], ["↵", active?.more != null ? "more" : "insert"], ["esc", "results"]);
    const key = hintsKey(items);
    if (key === hintsShown) return;
    hintsShown = key;
    renderHints(doc, hintsLine, items);
  }
  function paintActive(scope, hintsOn) {
    const level = scope.levels[scope.levels.length - 1];
    list.querySelectorAll(".burrow-row").forEach((item, i) => {
      const on = i === level.active;
      item.classList.toggle("burrow-active", on);
      item.setAttribute("aria-selected", String(on));
      if (on) item.scrollIntoView?.({ block: "nearest" });
    });
    renderHints2(scope, hintsOn);
  }
  function place(anchor, popRect, taRect) {
    const above = popRect.top + popRect.height / 2 < taRect.top;
    node.style.left = `${Math.round(anchor.left)}px`;
    node.style.width = `${Math.round(anchor.width)}px`;
    if (above) {
      node.style.top = "auto";
      node.style.bottom = `${Math.round(win.innerHeight - popRect.bottom)}px`;
    } else {
      node.style.bottom = "auto";
      node.style.top = `${Math.round(popRect.top)}px`;
    }
  }
  return {
    node,
    show(scope, hintsOn) {
      renderCrumb(scope);
      renderList(scope);
      node.hidden = false;
      paintActive(scope, hintsOn);
    },
    paintActive,
    place,
    hide() {
      node.hidden = true;
      listKey = null;
      hintsShown = null;
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
var PAD = "burrow-pad";
var PAD_BOTTOM = "burrow-pad-foot";
var FOLD_ALIASES = "burrow-fold-aliases";
var LAYOUT = "burrow-layout";
var SCOPE_OPEN = "burrow-scope-open";
var FOLDED = "data-burrow-folded";
var EXPANDED = "rm-autocomplete__results--expanded";
var HINTS_HEIGHT = 22;
var CHIPS_INSET = 8;
var ROW_LIMIT = 3;
var PAD_SIZES = Array.from({ length: ROW_LIMIT }, (_, i) => i + 1).flatMap((n) => [`${PAD}-${n}`, `${PAD}-${n}c`]);
var POP_CLASSES = [OWNS, DRILL_CLASS, PAD, ...PAD_SIZES, PAD_BOTTOM, FOLD_ALIASES, LAYOUT, SCOPE_OPEN];
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
    observers: [],
    auto: false,
    chip: -1,
    scope: null,
    prompt: null
  };
  const debug = { lastFailure: null, lastWrite: null, commits: 0, trace: [] };
  const trace = (event) => {
    debug.trace.push({ t: Math.round(performance.now()), ...event });
    if (debug.trace.length > 60) debug.trace.shift();
  };
  const strip = doc.createElement("div");
  strip.className = "burrow-strip";
  strip.setAttribute("role", "listbox");
  strip.hidden = true;
  lifecycle.node(strip, doc.body);
  const chipsNode = doc.createElement("div");
  chipsNode.className = "burrow-chips";
  const hints = doc.createElement("div");
  hints.className = "burrow-hints";
  hints.hidden = true;
  lifecycle.node(hints, doc.body);
  const preview = createPreview({ doc, win, lifecycle });
  const scopePreview = createPreview({ doc, win, lifecycle });
  const scopePanel = createScopePanel({ doc, win, lifecycle, highlight: (text, query) => highlight(text, query) });
  const fast = api.data?.fast?.q ? (query, ...args) => api.data.fast.q(query, ...args) : (query, ...args) => api.q(query, ...args);
  const tree = createTreeSource({
    pull: (pattern, eid) => api.pull(pattern, eid),
    q: fast,
    onFetch: (kind) => {
      perf.counters[kind === "query" ? "drillQueries" : "drillPulls"] = (perf.counters[kind === "query" ? "drillQueries" : "drillPulls"] || 0) + 1;
    }
  });
  const anyFeature = () => setting("aliasPages") || setting("refRanking") || setting("drill") || setting("tabDrill") || setting("paneLayout") || setting("keyHints");
  const isBlockInput = (el) => el?.tagName === "TEXTAREA" && el.classList.contains("rm-block-input");
  function rank(token) {
    st.drill = null;
    const recall = setting("betterMatch");
    if (token.kind === "[[" && setting("drill") && st.ta?.value[token.start - 1] !== "#") {
      const parsed = parseDrill(token.query, indexes.titles);
      if (parsed) {
        const result = resolveDrill(parsed, tree, { strict: !recall, ordinals: setting("drillOrdinals"), hideEmpty: setting("drillEmpty") });
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
    const hits = matchAliases(indexes.aliases, plan, { strict: !recall, limit: Infinity, picked: memory?.lookup("alias", token.query) });
    if (setting("aliasInline")) {
      return groupAliasHits(hits, indexes.aliases).map((hit) => ({
        kind: "alias",
        key: `alias:${hit.uid}`,
        uid: hit.uid,
        alias: hit.alias,
        title: hit.title,
        aliases: hit.aliases,
        refs: hit.refs,
        level: hit.level,
        insertion: aliasInsertion(hit, format),
        pick: `${hit.uid}:${hit.alias}`
      }));
    }
    return hits.map((hit) => ({
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
    if (st.token?.kind !== "[[" || st.drill || setting("aliasInline")) return st.rows.slice(0, ROW_LIMIT);
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
    if (st.phase === "SCOPE") {
      placeScope();
      return;
    }
    if (st.prompt?.kind === "add") {
      renderPrompt();
      return;
    }
    const rows = visibleRows();
    const query = st.token?.query ?? null;
    const same = query === shownQuery && rows.length === shown.length && rows.every((row, i) => row.key === shown[i].key);
    if (!same) {
      strip.replaceChildren(...rows.map((row, i) => rowNode(row, i)));
      shown = rows;
      shownQuery = query;
      chipsFor = null;
    }
    if (!rows.length) {
      if (st.phase !== "IDLE") {
        st.phase = "ARMED";
        st.active = -1;
        st.auto = false;
        st.chip = -1;
      }
      hideRows();
      syncPanes(rows);
      layoutPop();
      return;
    }
    if (st.phase === "IDLE") st.phase = "ARMED";
    if (st.active >= rows.length) st.active = rows.length - 1;
    const wanted = rows[0].kind === "drill" || st.token.kind === "((" && setting("refPreselect") && rows[0].level >= 2 || setting("aliasPreselect") && rows[0].kind === "alias" && aliasStarts(rows[0].alias, query) && !exactTitle(query);
    if (st.phase === "OWNED" && st.auto && !wanted) {
      st.phase = "ARMED";
      st.active = -1;
      st.auto = false;
      st.chip = -1;
    }
    if (st.phase === "ARMED" && wanted && st.released !== releaseKey() && st.active < 0) {
      own(0);
      st.auto = true;
    }
    strip.hidden = false;
    syncPanes(rows);
    paintActive();
    showPreview();
  }
  const aliasStarts = (alias, query) => {
    const a = alias.toLowerCase().trim();
    const q = String(query).toLowerCase().trim();
    if (!q) return false;
    if (a.startsWith(q)) return true;
    const compact = searchKey(query).compact;
    return Boolean(compact) && searchKey(alias).compact.startsWith(compact);
  };
  function exactTitle(query) {
    const text = String(query).trim().toLowerCase();
    if (!text) return false;
    for (const row of st.pop?.querySelectorAll(NATIVE_ROWS) || []) {
      if ((row.getAttribute("title") || "").trim().toLowerCase() === text) return true;
    }
    return indexes.titles?.resolve(query)?.title.toLowerCase() === text;
  }
  let model = null;
  let rowPreviewKey = null;
  let rowPreviewId = null;
  function cancelRowPreview() {
    if (rowPreviewId != null) {
      (win.cancelIdleCallback || win.clearTimeout).call(win, rowPreviewId);
      rowPreviewId = null;
    }
    rowPreviewKey = null;
  }
  function showPreview() {
    if (st.drill && setting("drillPreview") && st.pop) {
      cancelRowPreview();
      if (model?.drillKey !== st.drill.key) {
        model = previewModel(st.drill, tree, readableText);
        model.drillKey = st.drill.key;
      }
      preview.show(model, st.pop, { avoid: st.ta?.getBoundingClientRect() });
      return;
    }
    const row = st.phase === "OWNED" && !st.prompt ? shown[st.active] : null;
    if (row && (row.kind === "alias" || row.kind === "ref") && setting("rowPreview") && st.pop?.classList.contains(EXPANDED)) {
      if (rowPreviewKey === row.key) {
        if (model && !preview.node.hidden) preview.show(model, st.pop, { avoid: st.ta?.getBoundingClientRect() });
        return;
      }
      cancelRowPreview();
      preview.hide();
      rowPreviewKey = row.key;
      const run = () => {
        rowPreviewId = null;
        perf.time("preview", () => drawRowPreview(row));
      };
      rowPreviewId = typeof win.requestIdleCallback === "function" ? win.requestIdleCallback(run, { timeout: 150 }) : win.setTimeout(run, 50);
      return;
    }
    cancelRowPreview();
    preview.hide();
  }
  function drawRowPreview(row) {
    if (st.phase !== "OWNED" || st.prompt || shown[st.active]?.key !== row.key || !st.pop?.classList.contains(EXPANDED)) return;
    let page;
    let target = null;
    if (row.kind === "alias") page = { uid: row.uid, title: row.title };
    else {
      const first = tree.trail(row.uid)[0];
      if (!first) return;
      page = { uid: first.uid, title: first.title };
      target = tree.get(row.uid);
    }
    model = previewModel({ page, target }, tree, readableText);
    model.drillKey = `row:${row.key}`;
    preview.show(model, st.pop, { avoid: st.ta?.getBoundingClientRect() });
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
    } else if (row.kind === "alias" && row.refs != null) {
      const count = doc.createElement("sup");
      count.className = "rm-autocomplete__ref-count";
      count.textContent = String(row.refs);
      count.title = `${row.refs} linked reference${row.refs === 1 ? "" : "s"}`;
      node.append(count);
    }
    return node;
  }
  function highlight(text, query = st.token?.query) {
    const fragment = doc.createDocumentFragment();
    const words = (String(query ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1);
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
    paintChips();
    layoutPop();
    showPreview();
  }
  let chipsFor = null;
  let chipsScrolled = false;
  const chipsAvailable = (row) => st.phase === "OWNED" && setting("aliasChips") && row?.kind === "alias" && row.aliases.length > 1;
  function paintChips() {
    const row = shown[st.active];
    const show = chipsAvailable(row);
    if (!show) {
      st.chip = -1;
      chipsFor = null;
      chipsScrolled = false;
      chipsNode.remove();
    } else {
      const confirm = st.prompt?.kind === "delete" ? st.prompt : null;
      const key = confirm ? `confirm\0${row.key}\0${confirm.alias}\0${confirm.saving}\0${confirm.error ?? ""}` : `${row.key}\0${row.aliases.join("\0")}`;
      if (key !== chipsFor) {
        chipsFor = key;
        chipsNode.classList.toggle("burrow-confirm", Boolean(confirm));
        if (confirm) {
          const text = confirm.saving ? `deleting “${confirm.alias}”…` : `delete alias “${confirm.alias}” from ${confirm.page.title}?`;
          chipsNode.replaceChildren(Object.assign(doc.createElement("span"), { className: "burrow-confirm-text", textContent: text }));
          if (confirm.error) chipsNode.append(Object.assign(doc.createElement("span"), { className: "burrow-prompt-error", textContent: confirm.error }));
        } else {
          chipsNode.replaceChildren(
            Object.assign(doc.createElement("span"), { className: "burrow-chips-label", textContent: "aliases:" }),
            ...row.aliases.map((alias, i) => {
              const chip = Object.assign(doc.createElement("span"), { className: "burrow-chip", textContent: alias, title: alias });
              chip.dataset.index = String(i);
              return chip;
            })
          );
        }
      }
      if (!confirm) chipsNode.querySelectorAll(".burrow-chip").forEach((node, i) => node.classList.toggle("burrow-active", i === st.chip));
      const rowNode2 = strip.querySelectorAll(".burrow-row")[st.active];
      if (rowNode2 && chipsNode.previousElementSibling !== rowNode2) rowNode2.after(chipsNode);
      revealChip();
    }
    setPad(shown.length, show);
  }
  function revealChip() {
    if (st.prompt?.kind === "delete") return;
    if (st.chip <= 0) {
      if (chipsScrolled) chipsNode.scrollLeft = 0;
      chipsScrolled = false;
      return;
    }
    const chip = chipsNode.querySelectorAll(".burrow-chip")[st.chip];
    if (!chip) return;
    const box = chipsNode.getBoundingClientRect();
    const rect = chip.getBoundingClientRect();
    if (rect.right > box.right - CHIPS_INSET) chipsNode.scrollLeft += rect.right - box.right + CHIPS_INSET;
    else if (rect.left < box.left + CHIPS_INSET) chipsNode.scrollLeft -= box.left + CHIPS_INSET - rect.left;
    chipsScrolled = chipsNode.scrollLeft > 0;
  }
  function setPad(count, withChips) {
    if (!st.pop) return;
    const wanted = count > 0 ? `${PAD}-${Math.min(count, ROW_LIMIT)}${withChips ? "c" : ""}` : null;
    for (const cls of PAD_SIZES) if (st.pop.classList.contains(cls) !== (cls === wanted)) st.pop.classList.toggle(cls);
    if (wanted) st.pop.classList.add(PAD);
    else st.pop.classList.remove(PAD);
  }
  const listColumn = (pop) => pop.querySelector(":scope > .rm-autocomplete__results-main") || pop;
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
    sampleHints(pop, dark);
    for (const p of [preview, scopePreview]) {
      for (const name of ["--burrow-bg", "--burrow-fg"]) p.node.style.setProperty(name, strip.style.getPropertyValue(name));
      p.node.style.zIndex = strip.style.zIndex;
      p.node.style.font = strip.style.font;
    }
    for (const p of [preview, scopePreview]) {
      if (blockHighlight) p.node.style.setProperty("--burrow-highlight", dark ? `color-mix(in srgb, ${blockHighlight} 28%, transparent)` : blockHighlight);
      else p.node.style.removeProperty("--burrow-highlight");
      p.node.classList.toggle("burrow-dark", dark);
    }
    const panel = scopePanel.node;
    for (const name of ["--burrow-bg", "--burrow-fg", "--burrow-active"]) {
      const value = strip.style.getPropertyValue(name);
      if (value) panel.style.setProperty(name, value);
      else panel.style.removeProperty(name);
    }
    panel.style.zIndex = strip.style.zIndex;
    panel.style.font = strip.style.font;
    panel.classList.toggle("burrow-dark", dark);
    for (const name of ["--burrow-footer-bg", "--burrow-footer-fg"]) {
      const value = hints.style.getPropertyValue(name);
      if (value) panel.style.setProperty(name, value);
      else panel.style.removeProperty(name);
    }
  }
  function sampleHints(pop, dark) {
    const footer = pop.querySelector(".rm-autocomplete-footer");
    const cs = footer ? win.getComputedStyle(footer) : null;
    const bg = cs?.backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") hints.style.setProperty("--burrow-footer-bg", bg);
    else hints.style.removeProperty("--burrow-footer-bg");
    if (cs?.color) hints.style.setProperty("--burrow-footer-fg", cs.color);
    else hints.style.removeProperty("--burrow-footer-fg");
    for (const name of ["--burrow-bg", "--burrow-fg"]) hints.style.setProperty(name, strip.style.getPropertyValue(name));
    hints.style.fontFamily = strip.style.fontFamily;
    hints.style.zIndex = strip.style.zIndex;
    hints.classList.toggle("burrow-dark", dark);
  }
  function hideRows() {
    strip.hidden = true;
    chipsNode.remove();
    chipsFor = null;
    cancelRowPreview();
    preview.hide();
    st.pop?.classList.remove(OWNS, DRILL_CLASS, PAD, ...PAD_SIZES);
  }
  function clearPopover() {
    if (!st.pop) return;
    st.pop.classList.remove(...POP_CLASSES);
    for (const node of st.pop.querySelectorAll(`[${FOLDED}]`)) node.removeAttribute(FOLDED);
  }
  function hideStrip() {
    scopePanel.hide();
    scopePreview.hide();
    strip.hidden = true;
    chipsNode.remove();
    chipsFor = null;
    hints.hidden = true;
    cancelRowPreview();
    preview.hide();
    clearPopover();
  }
  function foldedByRow(item, rows) {
    const m = (item.querySelector("button")?.textContent ?? "").match(/^\[(.*)\]\(\[\[(.*)\]\]\)$/s);
    if (!m) return false;
    const [, alias, title] = m;
    const lower = alias.toLowerCase();
    const chips = setting("aliasChips");
    return rows.some((row) => row.kind === "alias" && row.title.toLowerCase() === title.toLowerCase() && (row.alias === alias || row.alias.toLowerCase() === lower || chips && row.aliases.some((a) => a === alias || a.toLowerCase() === lower)));
  }
  function syncPanes(rows) {
    const pop = st.pop;
    if (!pop) return;
    if (st.token?.kind !== "[[") {
      pop.classList.remove(FOLD_ALIASES, LAYOUT);
      return;
    }
    const fold = setting("aliasPages") && setting("aliasInline") && !st.drill;
    const items = [...pop.querySelectorAll(".rm-aliases .dont-focus-block.alias")];
    let visible = 0;
    for (const item of items) {
      if (fold && foldedByRow(item, rows)) item.setAttribute(FOLDED, "");
      else {
        item.removeAttribute(FOLDED);
        visible += 1;
      }
    }
    pop.classList.toggle(FOLD_ALIASES, items.length > 0 && visible === 0);
    pop.classList.toggle(LAYOUT, setting("paneLayout") && visible > 0);
  }
  function hintList() {
    if (st.phase === "SCOPE") return [];
    if (st.prompt?.kind === "add") return [["↵", "save alias"], ["esc", "cancel"]];
    if (st.prompt?.kind === "delete") return [["↵", "delete"], ["esc", "keep"]];
    const row = shown[st.active];
    if (chipsAvailable(row) && st.chip >= 0) {
      return [["←→", "alias"], ...setting("aliasDelete") ? [[keyLabel("altBackspace"), "delete"]] : [], ["↵", "insert"], ["esc", "rows"]];
    }
    const list = [];
    if (setting("aliasCreate") && st.token?.kind === "[[" && aliasSource()) list.push([keyLabel("altA"), "alias"]);
    if (chipsAvailable(row)) list.push([keyLabel("altDown"), "pick alias"]);
    if (setting("tabDrill") && st.token?.kind === "[[") list.push(["⇥/>", "drill"]);
    else if (setting("tabDrill") && st.phase === "OWNED" && row?.kind === "ref") list.push(["⇥", "drill"]);
    if (!list.length) return [];
    list.push([keyLabel("ctrlO"), "preview"], ["↵", "insert"]);
    return list;
  }
  let hintsFor = null;
  function layoutPop() {
    const pop = st.pop;
    if (!pop) return;
    const list = setting("keyHints") ? hintList() : [];
    if (!list.length) {
      hints.hidden = true;
      hintsFor = null;
      pop.classList.remove(PAD_BOTTOM);
    } else {
      const key = hintsKey(list);
      if (key !== hintsFor) {
        hintsFor = key;
        renderHints(doc, hints, list);
      }
      pop.classList.add(PAD_BOTTOM);
    }
    if (strip.hidden && !list.length) return;
    const rect = listColumn(pop).getBoundingClientRect();
    const left = `${Math.round(rect.left)}px`;
    const width = `${Math.round(rect.width)}px`;
    if (!strip.hidden) Object.assign(strip.style, { left, top: `${Math.round(rect.top)}px`, width });
    if (list.length) {
      Object.assign(hints.style, { left, top: `${Math.round(rect.bottom - HINTS_HEIGHT)}px`, width });
      hints.hidden = false;
    }
  }
  function attach(pop) {
    if (st.pop === pop) return;
    detach();
    st.pop = pop;
    sampleTheme(pop);
    if (st.phase === "SCOPE") pop.classList.add(SCOPE_OPEN);
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
    cancelRowPreview();
    preview.hide();
    hints.hidden = true;
    hintsFor = null;
    clearPopover();
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
    st.auto = false;
    st.chip = -1;
    st.scope = null;
    st.prompt = null;
    cancelRowPreview();
    model = null;
    scopeModel = null;
    tree.clear();
    shown = [];
    shownQuery = null;
    chipsFor = null;
    hintsFor = null;
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
    st.auto = false;
    st.chip = -1;
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
    st.chip = -1;
    if (!st.rows.length && st.phase === "OWNED") {
      st.phase = "ARMED";
      st.active = -1;
      st.auto = false;
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
    if (st.prompt) st.prompt = null;
    if (st.phase === "SCOPE") exitScope();
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
    if (pendingTa && (ACTION_KEYS.has(event.key) || event.altKey) && event.target === pendingTa) flush();
    if (st.phase === "IDLE") return;
    if (event.isComposing || st.composing || event.keyCode === 229) return;
    const ta = event.target;
    if (ta !== st.ta || !anyFeature()) {
      reset("foreign-key");
      return;
    }
    if (ta.selectionStart !== ta.selectionEnd) return;
    if (st.prompt) {
      promptKey(event);
      return;
    }
    const count = shown.length;
    const key = event.key;
    if (st.phase === "SCOPE") {
      scopeKey(event);
      return;
    }
    if (isAltA(event) && setting("aliasCreate") && st.token?.kind === "[[" && (st.phase === "ARMED" || st.phase === "OWNED")) {
      const page = aliasSource();
      if (page) {
        openPrompt(page);
        consume(event);
        return;
      }
    }
    if (st.phase === "OWNED" && chipKey(event)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (st.phase === "ARMED") {
      if (key === "Tab" && !event.shiftKey && setting("tabDrill") && st.token.kind === "[[" && enterScope(armedSource(), event)) return;
      if (key === "ArrowUp" && !event.shiftKey && count && !strip.hidden && nativeActiveIsFirst()) {
        own(count - 1);
        st.auto = false;
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
        st.auto = false;
        st.chip = -1;
        if (st.active < count - 1) st.active += 1;
        else release();
        paintActive();
        consume(event);
        return;
      case "ArrowUp":
        st.auto = false;
        st.chip = -1;
        if (st.active > 0) st.active -= 1;
        paintActive();
        consume(event);
        return;
      case "Enter":
      case "Tab": {
        if (event.shiftKey) return;
        const row = shown[st.active];
        if (key === "Tab" && setting("tabDrill") && enterScope(ownedSource(row, -1), event)) return;
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
  function chipKey(event) {
    const row = shown[st.active];
    if (!chipsAvailable(row)) {
      st.chip = -1;
      return false;
    }
    const key = event.key;
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (st.chip < 0) {
      if (key !== "ArrowDown" || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
      st.auto = false;
      st.chip = Math.max(0, row.aliases.indexOf(row.alias));
      paintActive();
      consume(event);
      return true;
    }
    const last = row.aliases.length - 1;
    if (plain && (key === "ArrowLeft" || key === "ArrowUp")) st.chip = Math.max(0, st.chip - 1);
    else if (plain && (key === "ArrowRight" || key === "ArrowDown")) st.chip = Math.min(last, st.chip + 1);
    else if (key === "Backspace" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && setting("aliasDelete")) {
      st.prompt = { kind: "delete", page: { uid: row.uid, title: row.title }, alias: row.aliases[st.chip], saving: false, error: null };
      trace({ ev: "confirm-delete", alias: st.prompt.alias });
    } else if (key === "ArrowUp" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey || key === "Escape" && plain) st.chip = -1;
    else if (plain && (key === "Enter" || key === "Tab")) {
      if (key === "Tab" && setting("tabDrill") && enterScope(ownedSource(row, st.chip), event)) return true;
      if (!commit(chipRow(row, st.chip))) reset("commit-refused");
      consume(event);
      return true;
    } else {
      st.chip = -1;
      paintActive();
      return false;
    }
    paintActive();
    consume(event);
    return true;
  }
  const isAltA = (e) => e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyA";
  function aliasSource() {
    if (st.phase === "OWNED") {
      const row = shown[st.active];
      return row?.kind === "alias" ? { uid: row.uid, title: row.title } : null;
    }
    const native = armedSource();
    return native ? { uid: native.page.uid, title: native.page.title } : null;
  }
  function openPrompt(page) {
    st.prompt = { kind: "add", page, text: st.token.query.trim(), fresh: true, saving: false, error: null };
    st.auto = false;
    st.chip = -1;
    trace({ ev: "prompt", uid: page.uid });
    render();
  }
  const promptNode = doc.createElement("div");
  promptNode.className = "burrow-row burrow-prompt";
  function renderPrompt() {
    const p = st.prompt;
    const input = Object.assign(doc.createElement("span"), { className: "burrow-prompt-input", textContent: p.saving ? `${p.text} …` : p.text });
    input.classList.toggle("burrow-fresh", p.fresh && Boolean(p.text));
    promptNode.replaceChildren(Object.assign(doc.createElement("span"), { className: "burrow-prompt-label", textContent: `alias for ${p.page.title}:` }), input);
    if (p.error) promptNode.append(Object.assign(doc.createElement("span"), { className: "burrow-prompt-error", textContent: p.error }));
    if (strip.firstChild !== promptNode || strip.childNodes.length !== 1) strip.replaceChildren(promptNode);
    shown = [];
    shownQuery = null;
    chipsFor = null;
    chipsNode.remove();
    cancelRowPreview();
    preview.hide();
    strip.hidden = false;
    setPad(1, false);
    layoutPop();
  }
  function promptKey(event) {
    const p = st.prompt;
    const key = event.key;
    if (key === "Shift" || key === "Alt" || key === "Meta" || key === "Control" || key === "CapsLock") return;
    if (p.kind === "delete") {
      consume(event);
      if (p.saving) return;
      if (key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        confirmDelete();
        return;
      }
      st.prompt = null;
      paintActive();
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (mod && key.toLowerCase() === "v") return;
    consume(event);
    if (p.saving) return;
    if (key === "Escape") {
      st.prompt = null;
      render();
      return;
    }
    if (key === "Enter") {
      savePrompt();
      return;
    }
    if (mod) {
      if (key.toLowerCase() === "a") p.fresh = true;
      renderPrompt();
      return;
    }
    if (key === "Backspace") {
      p.text = p.fresh ? "" : [...p.text].slice(0, -1).join("");
      p.fresh = false;
      p.error = null;
    } else if (key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End") p.fresh = false;
    else if (key.length === 1 || [...key].length === 1) {
      p.text = p.fresh ? key : p.text + key;
      p.fresh = false;
      p.error = null;
    }
    renderPrompt();
  }
  async function savePrompt() {
    const p = st.prompt;
    const check = validAlias(p.text);
    if (!check.ok) {
      p.error = check.reason;
      renderPrompt();
      return;
    }
    p.saving = true;
    p.error = null;
    renderPrompt();
    let result;
    try {
      result = await addAliasToPage(api, { pageUid: p.page.uid, keyword: setting("aliasKeyword") || "Aliases", alias: check.alias });
    } catch (error) {
      result = { ok: false, error: String(error?.message || error) };
    }
    if (st.prompt !== p) return;
    if (!result.ok) {
      p.saving = false;
      p.error = result.error;
      renderPrompt();
      return;
    }
    st.prompt = null;
    debug.lastWrite = { kind: "add", at: Date.now(), ...result };
    trace({ ev: "alias-added", uid: p.page.uid, block: result.blockUid });
    indexes.schedule();
    const row = { kind: "alias", key: `alias-new:${p.page.uid}`, insertion: aliasInsertion({ alias: check.alias, title: p.page.title }, setting("aliasLinkFormat")), pick: null };
    if (!commit(row)) reset("commit-refused");
  }
  async function confirmDelete() {
    const p = st.prompt;
    p.saving = true;
    p.error = null;
    paintActive();
    let result;
    try {
      result = await deleteAliasFromPage(api, { pageUid: p.page.uid, keyword: setting("aliasKeyword") || "Aliases", alias: p.alias });
    } catch (error) {
      result = { ok: false, error: String(error?.message || error) };
    }
    if (st.prompt !== p) return;
    if (!result.ok) {
      p.saving = false;
      p.error = result.error;
      paintActive();
      return;
    }
    st.prompt = null;
    debug.lastWrite = { kind: "delete", at: Date.now(), ...result };
    trace({ ev: "alias-deleted", alias: p.alias, block: result.blockUid });
    for (const r of /* @__PURE__ */ new Set([...st.rows, ...shown])) {
      if (r.kind === "alias" && r.uid === p.page.uid) r.aliases = r.aliases.filter((a) => a !== p.alias);
    }
    const row = shown[st.active];
    st.chip = chipsAvailable(row) ? Math.min(st.chip, row.aliases.length - 1) : -1;
    chipsFor = null;
    indexes.schedule();
    paintActive();
  }
  function onPaste(event) {
    const p = st.prompt;
    if (p?.kind !== "add" || event.target !== st.ta) return;
    consume(event);
    if (p.saving) return;
    const text = (event.clipboardData?.getData("text/plain") ?? "").split(/\r?\n/)[0];
    p.text = p.fresh ? text : p.text + text;
    p.fresh = false;
    p.error = null;
    renderPrompt();
  }
  function onChipsWheel(event) {
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const max = chipsNode.scrollWidth - chipsNode.clientWidth;
    if (max <= 0) return;
    const step = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    chipsNode.scrollLeft = Math.max(0, Math.min(max, chipsNode.scrollLeft + step));
    event.preventDefault();
  }
  function chipRow(row, index) {
    const alias = row.aliases[index];
    return { ...row, insertion: aliasInsertion({ alias, title: row.title }, setting("aliasLinkFormat")), pick: `${row.uid}:${alias}` };
  }
  function ownedSource(row, chip) {
    if (!row) return null;
    if (row.kind === "alias") {
      const insertion = chip >= 0 ? chipRow(row, chip).insertion : row.insertion;
      return { uid: row.uid, label: row.title, page: { uid: row.uid, title: row.title }, insertion };
    }
    if (row.kind === "ref") return { uid: row.uid, label: row.text, page: null, insertion: row.insertion };
    if (row.kind === "drill" && st.drill) return { uid: row.uid, label: row.text, page: st.drill.page, insertion: row.insertion };
    return null;
  }
  function armedSource() {
    const rows = [...st.pop?.querySelectorAll(NATIVE_ROWS) || []];
    if (!rows.length) return null;
    const at = rows.findIndex((row) => row.style.backgroundColor);
    const title = rows[Math.max(0, at)].getAttribute("title");
    const page = title ? indexes.titles?.resolve(title) : null;
    if (!page || page.title !== title) return null;
    return { uid: page.uid, label: title, page, insertion: `[[${title}]]` };
  }
  function enterScope(source, event) {
    const ta = st.ta;
    if (!source || !st.pop || st.composing || event.target !== ta) return false;
    if (!tokenStillValid(ta.value, ta.selectionStart, ta.selectionEnd, st.token)) return false;
    if (!tree.children(source.uid).length) return false;
    st.scope = {
      rootLabel: st.token.kind === "[[" ? "Pages" : "Blocks",
      levels: [{ ...source, query: "", active: 0, limit: setting("drillCap") ? CAP : Infinity }],
      rows: [],
      all: [],
      preview: setting("drillPreview"),
      returnTo: { phase: st.phase, active: st.active, chip: st.chip }
    };
    st.phase = "SCOPE";
    st.auto = false;
    st.chip = -1;
    trace({ ev: "scope-enter", uid: source.uid });
    strip.hidden = true;
    chipsNode.remove();
    cancelRowPreview();
    preview.hide();
    st.pop.classList.remove(OWNS, DRILL_CLASS, PAD, ...PAD_SIZES, PAD_BOTTOM);
    st.pop.classList.add(SCOPE_OPEN);
    hints.hidden = true;
    hintsFor = null;
    scopeRefresh(false);
    consume(event);
    return true;
  }
  function exitScope() {
    const scope = st.scope;
    if (!scope) return;
    st.scope = null;
    scopePanel.hide();
    scopePreview.hide();
    scopeModel = null;
    st.pop?.classList.remove(SCOPE_OPEN);
    st.phase = scope.returnTo.phase;
    st.active = scope.returnTo.active;
    st.chip = scope.returnTo.chip;
    trace({ ev: "scope-exit" });
    frame();
  }
  const scopeLevel = () => st.scope.levels[st.scope.levels.length - 1];
  function scopeRefresh(keepActive) {
    const level = scopeLevel();
    level.limit ?? (level.limit = setting("drillCap") ? CAP : Infinity);
    st.scope.all = scopeRows(tree.twoLevels(level.uid), level.query, {
      strict: !setting("betterMatch"),
      text: readableText,
      ordinals: setting("drillOrdinals"),
      hideEmpty: setting("drillEmpty")
    });
    st.scope.rows = capRows(st.scope.all, level.limit);
    level.active = keepActive ? Math.min(level.active, Math.max(0, st.scope.rows.length - 1)) : level.query ? 0 : firstReal(st.scope.rows);
    scopePanel.show(st.scope, setting("keyHints"));
    placeScope();
  }
  function scopeMore() {
    const level = scopeLevel();
    const at = level.limit;
    level.limit += CAP;
    st.scope.rows = capRows(st.scope.all, level.limit);
    level.active = Math.min(at, st.scope.rows.length - 1);
    scopePanel.show(st.scope, setting("keyHints"));
    placeScope();
  }
  let scopeModel = null;
  function placeScope() {
    const scope = st.scope;
    const pop = st.pop;
    if (!scope || !pop) return;
    pop.classList.add(SCOPE_OPEN);
    const popRect = pop.getBoundingClientRect();
    const main = pop.classList.contains("rm-autocomplete__results--expanded") ? pop.querySelector(".rm-autocomplete__results-main") : null;
    scopePanel.place(main ? main.getBoundingClientRect() : popRect, popRect, st.ta.getBoundingClientRect());
    showScopePreview();
  }
  function showScopePreview() {
    const level = scopeLevel();
    if (!st.scope.preview) {
      scopePreview.hide();
      return;
    }
    const row = st.scope.rows[level.active];
    const target = row && row.more == null ? row.node : level.page?.uid === level.uid ? null : tree.get(level.uid);
    const first = tree.trail(level.uid)[0];
    const page = level.page || (first ? { uid: first.uid, title: first.title } : null);
    if (!page) {
      scopePreview.hide();
      return;
    }
    const key = `${page.uid}:${target?.uid ?? ""}`;
    if (scopeModel?.drillKey !== key) {
      scopeModel = previewModel({ page, target }, tree, readableText);
      scopeModel.drillKey = key;
    }
    scopePreview.show(scopeModel, st.pop, { beside: scopePanel.node.getBoundingClientRect(), avoid: st.ta.getBoundingClientRect() });
  }
  function scopeMove(delta) {
    const level = scopeLevel();
    level.active = Math.max(0, Math.min(Math.max(0, st.scope.rows.length - 1), level.active + delta));
    scopePanel.paintActive(st.scope, setting("keyHints"));
    showScopePreview();
  }
  function scopeDeeper() {
    const level = scopeLevel();
    const row = st.scope.rows[level.active];
    if (!row?.drillable || row.more != null) return;
    st.scope.levels.push({
      uid: row.uid,
      label: row.text || "(empty)",
      page: level.page,
      insertion: `((${row.uid}))`,
      query: "",
      active: 0,
      limit: setting("drillCap") ? CAP : Infinity
    });
    scopeRefresh(false);
  }
  function scopeBack(toLevel = st.scope.levels.length - 2) {
    if (toLevel < 0) {
      exitScope();
      return;
    }
    st.scope.levels.length = toLevel + 1;
    scopeRefresh(true);
  }
  function scopeCommit() {
    const level = scopeLevel();
    const row = st.scope.rows[level.active];
    if (row?.more != null) {
      scopeMore();
      return true;
    }
    if (row?.empty && row.drillable) {
      scopeDeeper();
      return true;
    }
    return commit(row ? { kind: "scope", key: `scope:${row.uid}`, insertion: `((${row.uid}))` } : { kind: "scope", key: `scope:${level.uid}`, insertion: level.insertion });
  }
  function scopeKey(event) {
    const key = event.key;
    if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.code === "KeyO") {
      st.scope.preview = !st.scope.preview;
      consume(event);
      showScopePreview();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const level = scopeLevel();
    if (key === "Tab") {
      consume(event);
      if (event.shiftKey) scopeBack();
      else scopeDeeper();
      return;
    }
    if (key === "Enter") {
      if (scopeCommit()) consume(event);
      else reset("commit-refused");
      return;
    }
    if (key === "Escape") {
      exitScope();
      consume(event);
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      scopeMove(key === "ArrowDown" ? 1 : -1);
      consume(event);
      return;
    }
    if (key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End" || key === "PageUp" || key === "PageDown") {
      exitScope();
      reset("caret-move");
      return;
    }
    if (key === "Backspace") {
      consume(event);
      if (level.query) {
        level.query = [...level.query].slice(0, -1).join("");
        level.limit = setting("drillCap") ? CAP : Infinity;
        scopeRefresh(false);
      } else scopeBack();
      return;
    }
    if (key.length === 1) {
      consume(event);
      if (key === ">" && st.scope.rows[level.active]?.drillable) {
        scopeDeeper();
        return;
      }
      level.query += key;
      level.limit = setting("drillCap") ? CAP : Infinity;
      scopeRefresh(false);
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
    if (st.prompt) return;
    const chip = event.target.closest?.(".burrow-chip");
    if (chip) {
      const row2 = shown[st.active];
      if (row2 && !commit(chipRow(row2, Number(chip.dataset.index)))) reset("click-refused");
      return;
    }
    const node = event.target.closest?.(".burrow-row");
    if (!node) return;
    const row = shown[Number(node.dataset.index)];
    if (row && !commit(row)) reset("click-refused");
  }
  function onScopeMouseDown(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!st.scope) return;
    const crumb = event.target.closest?.(".burrow-crumb");
    if (crumb) {
      if (crumb.dataset.level == null) exitScope();
      else scopeBack(Number(crumb.dataset.level));
      return;
    }
    const row = event.target.closest?.(".burrow-row");
    if (!row) return;
    const level = scopeLevel();
    level.active = Number(row.dataset.index);
    const clicked = st.scope.rows[level.active];
    if (clicked?.more != null) scopeMore();
    else if (clicked?.empty && clicked.drillable) scopeDeeper();
    else if (!scopeCommit()) reset("click-refused");
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
  lifecycle.event(win, "paste", guarded("paste", onPaste), true);
  lifecycle.event(chipsNode, "wheel", guarded("wheel", onChipsWheel), { passive: false });
  lifecycle.event(chipsNode, "scroll", () => {
    chipsScrolled = chipsNode.scrollLeft > 0;
  }, { passive: true });
  lifecycle.event(strip, "mousedown", guarded("mousedown", onStripMouseDown));
  lifecycle.event(scopePanel.node, "mousedown", guarded("mousedown", onScopeMouseDown));
  lifecycle.add(() => reset("unload"));
  return { state: st, debug, reset, tree };
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/extension.js
var VERSION = "0.4.0";
var activeLifecycle = null;
var FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pickMemory", "pageBoost", "aliasInline", "aliasPreselect", "aliasChips", "tabDrill", "paneLayout", "keyHints", "rowPreview", "aliasCreate", "aliasDelete", "drillOrdinals", "drillEmpty", "drillCap", "refSearch", "refSearchHotkey"];
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
    let refSearch = null;
    let added = false;
    const commandApi = extensionAPI.ui.commandPalette;
    const refLabel = "Burrow: block reference search";
    const syncRefCommand = async (on = setting("refSearch")) => {
      if (lifecycle.disposed) return;
      if (on && !added) {
        added = true;
        await commandApi.addCommand({ label: refLabel, callback: () => refSearch?.open() });
      } else if (!on && added) {
        added = false;
        await commandApi.removeCommand({ label: refLabel });
      }
    };
    await lifecycle.settingsPanel(extensionAPI, createSettingsPanel({
      onChange: (id, event) => {
        if (id === "aliasKeyword") indexes?.schedule();
        if (id !== "refSearch") return;
        const value = typeof event === "boolean" ? event : event?.target?.checked;
        if (typeof value === "boolean") void syncRefCommand(value);
        else lifecycle.timeout(() => {
          void syncRefCommand();
        }, 0);
      }
    }));
    lifecycle.add(async () => {
      if (added) {
        added = false;
        await commandApi.removeCommand({ label: refLabel });
      }
    });
    await syncRefCommand();
    if (api && globalThis.document) {
      indexes = createIndexes({ api, perf, setting, idle: idleScheduler(lifecycle) });
      const picks = createPickMemory({ storage: safeLocalStorage(), key: `burrow:picks:${api.graph?.name ?? "graph"}` });
      const strip = createStrip({ setting, indexes, perf, lifecycle, api, picks });
      refSearch = createRefSearch({ api, lifecycle, setting });
      installPerfHud({ lifecycle, perf, setting });
      indexes.schedule();
      globalThis.window.__BURROW_PERF = perf;
      globalThis.window.__BURROW = { version: VERSION, state: strip.state, debug: strip.debug, indexes, tree: strip.tree, picks, refSearch };
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
        await syncRefCommand();
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
