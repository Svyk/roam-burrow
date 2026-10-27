/* Burrow v0.8.3 | MIT | generated; edit src/ */

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
  return stripMacros(String(value == null ? "" : value).replace(/^\s*([^:\n`]{1,80})::\s*/, "$1 ")).replace(/\(\(([^()]*)\)\)/g, " ").replace(/\[([^\]]*)\]\(\[\[([^\]]*)\]\]\)/g, "$1 $2").replace(/\[\[|\]\]|#\[\[|\*\*|\^\^|__|~~/g, " ").replace(/(^|\s)#(?=\S)/g, "$1");
}
var MACRO_CAP = 4e3;
function stripMacros(value) {
  let at = value.indexOf("{{");
  if (at === -1) return value;
  let out = "";
  let from = 0;
  while (at !== -1) {
    const stop = Math.min(value.length, at + MACRO_CAP);
    let depth = 0;
    let end = -1;
    for (let j = at; j < stop; j++) {
      const c = value.charCodeAt(j);
      if (c === 123) depth++;
      else if (c === 125 && --depth === 0) {
        end = j + 1;
        break;
      }
    }
    if (end === -1) {
      at = value.indexOf("{{", at + 2);
      continue;
    }
    out += value.slice(from, at) + " ";
    from = end;
    at = value.indexOf("{{", end);
  }
  return out + value.slice(from);
}
function looksLikeCode(query) {
  return /[`(){}[\]=<>$;\\|]|::|->|<-/.test(query) || /[\p{L}\p{N}][._][\p{L}\p{N}]/u.test(query) || /\p{Ll}{2,}\p{Lu}/u.test(query);
}
function searchKey(value) {
  let raw = String(value == null ? "" : value).toLowerCase();
  try {
    raw = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  } catch {
  }
  raw = raw.replace(/\s+/g, " ").trim();
  const spaced2 = raw.replace(/(\p{L})(\p{N})/gu, "$1 $2").replace(/(\p{N})(\p{L})/gu, "$1 $2").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  return { raw, spaced: spaced2, compact: spaced2.replace(/\s+/g, ""), tokens: spaced2 ? spaced2.split(" ") : [] };
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
    let lv = 1;
    if (target.raw === q.raw) {
      score = 1200;
      lv = 3;
    } else if (target.spaced === q.spaced) {
      score = 1160;
      lv = 3;
    } else if (target.compact === q.compact) {
      score = 1120;
      lv = 3;
    } else if (target.spaced.startsWith(q.spaced)) {
      score = 980;
      lv = 2;
    } else if (target.compact.startsWith(q.compact)) {
      score = 940;
      lv = 2;
    } else if (wordIncludes(target, q)) {
      score = 840;
      lv = 2;
    } else if (compactIncludes(target, q.compact)) {
      score = 800;
      lv = 2;
    } else {
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
      else if (q.tokens.every((token) => tokenSet(target).has(token))) {
        const places = q.tokens.map((token) => target.tokens.indexOf(token));
        const spread = Math.max(...places) - Math.min(...places) + 1 - q.tokens.length;
        score = 500 - Math.min(40, spread * 2);
      } else if (q.tokens.every((token) => target.tokens.some((candidate) => candidate.startsWith(token)))) {
        score = 440;
        lv = 0;
      } else if (q.tokens.length === 1 && q.compact.length >= 2 && q.compact.length <= 6 && target.tokens.length >= q.compact.length && initialsOf(target).startsWith(q.compact)) score = 380;
    }
    if (score < 0) return { score: -1, level: 0 };
    level = Math.min(level, lv);
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
  const text = String(string || "").split("\n")[0];
  const head = text.slice(0, kw.length + 2);
  if (head.toLowerCase() !== `${kw.toLowerCase()}::`) return [];
  return text.slice(kw.length + 2).split(",").map((value) => value.trim().replace(/^#?\[\[(.*)\]\]$/, "$1").replace(/^#/, "").trim()).filter(Boolean);
}
function keywordTitles(keyword = "Aliases") {
  const kw = String(keyword || "Aliases").trim();
  const lower = kw.toLowerCase();
  return [.../* @__PURE__ */ new Set([kw, lower, lower[0]?.toUpperCase() + lower.slice(1), kw.toUpperCase()])];
}
function aliasRowsFromPull(pulled) {
  const rows = [];
  for (const ref of pulled?.[":block/_refs"] || []) {
    const page = ref[":block/page"];
    const string = ref[":block/string"];
    if (typeof string === "string" && page?.[":node/title"] != null && page[":block/uid"]) rows.push([string, page[":node/title"], page[":block/uid"]]);
  }
  return rows;
}
function buildAliasIndex(rows, keyword, memo = null) {
  const entries = [];
  const byPage = /* @__PURE__ */ new Map();
  const pageAliases = /* @__PURE__ */ new Map();
  const parsed = /* @__PURE__ */ new Map();
  const keys = /* @__PURE__ */ new Map();
  const exact = `${String(keyword || "Aliases").trim()}::`;
  for (const [string, title, uid] of rows || []) {
    const seenByRoamAliases = String(string).startsWith(exact);
    const list = parsed.get(string) || memo?.parsed.get(string) || parseAliasBlock(string, keyword);
    parsed.set(string, list);
    for (const alias of list) {
      if (alias.toLowerCase() === String(title).toLowerCase()) continue;
      const key = keys.get(alias) || memo?.keys.get(alias) || searchKey(alias);
      keys.set(alias, key);
      entries.push({ alias, title, uid, key, seenByRoamAliases, refs: null });
      if (!byPage.has(title)) byPage.set(title, []);
      byPage.get(title).push(alias);
      if (!pageAliases.has(uid)) pageAliases.set(uid, []);
      if (!pageAliases.get(uid).includes(alias)) pageAliases.get(uid).push(alias);
    }
  }
  return { entries, byPage, pageAliases, refsByPage: /* @__PURE__ */ new Map(), memo: { parsed, keys } };
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
var LONG_TOKENS = 64;
function splitCode(string) {
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
  return { entries: [...byUid.values()], byUid, words: /* @__PURE__ */ new Map(), byLinked: /* @__PURE__ */ new Map(), builtAt: Date.now() };
}
function keyEntry(entry, index, aliasesByPage) {
  const { byUid } = index;
  const quotes = [];
  const { prose, code } = splitCode(entry.string);
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
  entry.pureQuote = quotes.length === 1 && !/[\p{L}\p{N}]/u.test(entry.string.replace(BLOCK_REF, "").replace(/\{\{[^{}]*\}\}/g, "")) ? quotes[0] : null;
  const linked = [...bare.matchAll(PAGE_REF)].map((m) => m[1] || m[2]);
  entry.linked = linked.length ? linked : null;
  for (const title of new Set(linked)) {
    const list = index.byLinked.get(title);
    if (list) list.push(entry);
    else index.byLinked.set(title, [entry]);
  }
  entry.aliasKey = aliasKeyOf(entry, aliasesByPage);
  if (entry.key.tokens.length <= RECALL_MAX_TOKENS) {
    const seen = new Set(entry.aliasKey ? entry.key.tokens.concat(entry.aliasKey.tokens) : entry.key.tokens);
    for (const word of seen) addWord(index, word, entry);
  }
}
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
function aliasKeyTargets(index, aliasesByPage, previousByPage = null) {
  if (!index) return [];
  let pages = null;
  if (previousByPage) {
    pages = /* @__PURE__ */ new Set();
    const same = (title) => (previousByPage.get(title) || []).join("\0") === (aliasesByPage.get(title) || []).join("\0");
    for (const title of previousByPage.keys()) if (!same(title)) pages.add(title);
    for (const title of aliasesByPage.keys()) if (!same(title)) pages.add(title);
    if (!pages.size) return [];
  }
  if (!pages) return index.entries.filter((entry) => entry.linked);
  const out = /* @__PURE__ */ new Set();
  for (const title of pages) for (const entry of index.byLinked.get(title) || []) out.add(entry);
  return [...out];
}
function rekeyAliases(index, entries, aliasesByPage, { from = 0, stop = () => false, keys = /* @__PURE__ */ new Map() } = {}) {
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
function rankRefs(index, plan, { limit = 3, recall = true, aliasExpand = true, picked = null, currentPage = null, prose = true, code = false } = {}) {
  if (!index || !plan) return [];
  const hits = /* @__PURE__ */ new Map();
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
    const previous = hits.get(target.uid);
    if (previous && rankOf(previous.match) >= rankOf(match)) return true;
    hits.set(target.uid, { entry: target, match, viaAlias, inCode });
    return true;
  };
  const strictHit = /* @__PURE__ */ new Set();
  for (const entry of prefiltered(index, plan, aliasExpand, withCode)) {
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
  const titled = (hit) => {
    var _a;
    if (hit.titled == null) {
      (_a = hit.entry).titleKeys ?? (_a.titleKeys = (hit.entry.linked || []).map((t) => searchKey(t)));
      hit.titled = Number(hit.entry.titleKeys.some((k) => matchFromKey(k, plan, { strict: true }).level >= 2));
    }
    return hit.titled;
  };
  rows.sort((a, b) => rankOf(b.match) - rankOf(a.match) || pick(b) - pick(a) || Number(a.quoter) - Number(b.quoter) || (prose ? Number(a.entry.long) - Number(b.entry.long) : 0) || refStep(b.entry.refs) - refStep(a.entry.refs) || Number(b.viaAlias) - Number(a.viaAlias) || onPage(b) - onPage(a) || (prose ? titled(b) - titled(a) : 0) || b.match.score - a.match.score || a.entry.string.length - b.entry.string.length || (a.entry.uid < b.entry.uid ? -1 : a.entry.uid > b.entry.uid ? 1 : 0));
  return rows.slice(0, limit).map(({ entry, match, viaAlias, quoter, inCode }) => ({
    uid: entry.uid,
    string: entry.string,
    refs: entry.refs,
    page: entry.page,
    level: match.level,
    tier: match.tier,
    score: match.score,
    viaAlias,
    quoter,
    inCode,
    long: entry.long,
    picked: Boolean(picked?.get(entry.uid)),
    onPage: currentPage != null && entry.page === currentPage
  }));
}
var PREFILTER_CACHE = 24;
function prefiltered(index, plan, aliasExpand, withCode) {
  const maybe = strictPrefilter(plan);
  const sig = `${aliasExpand ? 1 : 0}${withCode ? 1 : 0}${maybe.initial ?? ""}${maybe.needles.join("")}`;
  const cache = index.prefilter || (index.prefilter = /* @__PURE__ */ new Map());
  const hit = cache.get(sig);
  if (hit) {
    cache.delete(sig);
    cache.set(sig, hit);
    return hit;
  }
  let source = index.entries;
  for (const [, cached] of cache) {
    if (cached.initial == null && cached.aliasExpand === aliasExpand && cached.withCode === withCode && cached.needles.length === maybe.needles.length && cached.needles.every((n, i) => maybe.needles[i].includes(n)) && cached.length < source.length) {
      source = cached;
    }
  }
  const list = source.filter((entry) => maybe(entry.key) || aliasExpand && maybe(entry.aliasKey) || withCode && maybe(entry.codeKey));
  list.needles = maybe.needles;
  list.initial = maybe.initial;
  list.aliasExpand = aliasExpand;
  list.withCode = withCode;
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
  let aliasLower = /* @__PURE__ */ new Map();
  let aliasCompact = /* @__PURE__ */ new Map();
  const setAliases = (next) => {
    aliasLower = /* @__PURE__ */ new Map();
    aliasCompact = /* @__PURE__ */ new Map();
    for (const entry of next?.entries || []) {
      const page = { title: entry.title, uid: entry.uid };
      add(aliasLower, entry.alias.toLowerCase(), page);
      if (entry.key?.compact) add(aliasCompact, entry.key.compact, page);
    }
  };
  setAliases(aliases);
  const sorted = [...byLower.keys()].filter((t) => /[#>]/.test(t)).sort();
  const one = (list) => list?.length === 1 ? list[0] : null;
  return {
    size: byRaw.size,
    setAliases,
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
var QUIET_MS = 2e3;
var POPUP = ".rm-autocomplete__results";
var ALIAS_SETTLE_MS = 250;
var REKEY_SLICE_MS = 3;
var REFERENCED_BLOCKS = `[:find ?u ?s (count ?r) ?pt
  :where [?r :block/refs ?b] [?b :block/string ?s] [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?pt]]`;
var TITLES = "[:find ?t ?u :where [?p :node/title ?t] [?p :block/uid ?u]]";
var WITH_CONTENT = "[:find [?t ...] :in $ [?t ...] :where [?p :node/title ?t] [?p :block/children ?c]]";
var ALIAS_PULL = "[{:block/_refs [:block/string {:block/page [:node/title :block/uid]}]}]";
var ALIAS_REFS = "[:find ?u (count ?r) :in $ [?u ...] :where [?p :block/uid ?u] [?r :block/refs ?p]]";
var yieldTo = () => new Promise((resolve) => setTimeout(resolve, 0));
function createIndexes({ api, perf, setting, idle, lifecycle = null, win = globalThis, doc = globalThis.document ?? null, now = () => performance.now() }) {
  let aliases = null;
  let refs = null;
  let titles = null;
  let builtAt = 0;
  let keyword = null;
  let pending = false;
  const listeners = /* @__PURE__ */ new Set();
  const notify = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch (error) {
        console.error("[burrow] index listener failed", error);
      }
    }
  };
  const q = (query, ...args) => {
    perf.counters.queries += 1;
    const asyncQ = api.data.async?.fast?.q;
    return asyncQ ? asyncQ(query, ...args) : Promise.resolve(api.data.fast.q(query, ...args));
  };
  const pulled = /* @__PURE__ */ new Map();
  const readAliasRows = (kw, only = null, fresh = true) => {
    const rows = /* @__PURE__ */ new Map();
    for (const title of only?.length ? only : keywordTitles(kw)) {
      if (fresh || !pulled.has(title)) {
        perf.counters.aliasPulls = (perf.counters.aliasPulls || 0) + 1;
        pulled.set(title, api.pull(ALIAS_PULL, [":node/title", title]));
      }
      for (const row of aliasRowsFromPull(pulled.get(title))) rows.set(row.join("\0"), row);
    }
    return [...rows.values()];
  };
  const watches = /* @__PURE__ */ new Map();
  let settleTimer = null;
  let watchCalls = 0;
  const watchOf = (title) => (_before, after) => {
    pulled.set(title, after);
    watchCalls += 1;
    if (settleTimer != null) win.clearTimeout(settleTimer);
    settleTimer = win.setTimeout(() => {
      settleTimer = null;
      refreshAliases();
    }, ALIAS_SETTLE_MS);
  };
  const syncWatches = (kw) => {
    const addWatch = api.data?.addPullWatch;
    if (!lifecycle || lifecycle.disposed || typeof addWatch !== "function") return false;
    let added = false;
    const wanted = new Set(keywordTitles(kw));
    for (const [title, watch] of watches) {
      if (wanted.has(title)) continue;
      api.data.removePullWatch(ALIAS_PULL, watch.entity, watch.cb);
      watches.delete(title);
      pulled.delete(title);
    }
    for (const title of wanted) {
      if (watches.has(title)) continue;
      const watch = { entity: `[:node/title ${JSON.stringify(title)}]`, cb: watchOf(title) };
      api.data.addPullWatch(ALIAS_PULL, watch.entity, watch.cb);
      watches.set(title, watch);
      added = true;
    }
    return added;
  };
  lifecycle?.add(() => {
    if (settleTimer != null) win.clearTimeout(settleTimer);
    for (const watch of watches.values()) api.data.removePullWatch(ALIAS_PULL, watch.entity, watch.cb);
    watches.clear();
    pulled.clear();
    listeners.clear();
  });
  let aliasPrint = null;
  const printOf = (rows) => rows.map((row) => row.join("\0")).join("");
  function refreshAliases({ force = false, fresh = false } = {}) {
    idle(() => {
      if (lifecycle?.disposed) return;
      const kw = setting("aliasKeyword") || "Aliases";
      if (!aliases || !titles || !refs || kw !== keyword) {
        schedule();
        return;
      }
      const t0 = performance.now();
      const rows = readAliasRows(kw, [...watches.keys()], fresh || !watches.size);
      const print = printOf(rows);
      perf.push("aliasRead", performance.now() - t0);
      if (print === aliasPrint && !force) return;
      idle(() => swapAliases(kw, rows, print));
    });
  }
  let rekey = null;
  function swapAliases(kw, rows, print) {
    if (lifecycle?.disposed || !aliases || kw !== keyword) return;
    const t0 = performance.now();
    const next = buildAliasIndex(rows, kw, aliases.memo);
    setAliasRefs(next, [...aliases.refsByPage]);
    titles.setAliases(next);
    const left = rekey?.refs === refs ? rekey.entries.slice(rekey.at) : [];
    const entries = [.../* @__PURE__ */ new Set([...left, ...aliasKeyTargets(refs, next.byPage, aliases.byPage)])];
    aliases = next;
    aliasPrint = print;
    perf.push("aliasRefresh", performance.now() - t0);
    const run = rekey = { refs, entries, at: 0, keys: /* @__PURE__ */ new Map() };
    idle(() => rekeyStep(run));
  }
  function rekeyStep(run) {
    if (lifecycle?.disposed || rekey !== run || refs !== run.refs) return;
    const t0 = performance.now();
    run.at = rekeyAliases(refs, run.entries, aliases.byPage, { from: run.at, stop: () => performance.now() - t0 > REKEY_SLICE_MS, keys: run.keys }).next;
    perf.push("aliasRekey", performance.now() - t0);
    if (run.at < run.entries.length) {
      idle(() => rekeyStep(run));
      return;
    }
    rekey = null;
    perf.counters.aliasRefreshes = (perf.counters.aliasRefreshes || 0) + 1;
    notify();
  }
  let lastInput = -Infinity;
  const stamp = () => {
    lastInput = now();
  };
  if (lifecycle && win?.addEventListener) {
    for (const type of ["keydown", "pointerdown", "input", "wheel"]) lifecycle.event(win, type, stamp, { capture: true, passive: true });
  }
  const quiet = () => now() - lastInput >= QUIET_MS && !doc?.querySelector?.(POPUP);
  const build = async ({ first = false } = {}) => {
    const t0 = performance.now();
    const calls = watchCalls;
    const nextKeyword = setting("aliasKeyword") || "Aliases";
    const aliasRows = readAliasRows(nextKeyword);
    const aliasUids = [...new Set((aliasRows || []).map((row) => row[2]))];
    const aliasRefRows = aliasUids.length ? await q(ALIAS_REFS, aliasUids) : [];
    if (!first && refs && !quiet()) {
      perf.counters.rebuildsDeferred = (perf.counters.rebuildsDeferred || 0) + 1;
      return false;
    }
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
    rekey = null;
    refs = nextRefs;
    aliases = nextAliases;
    aliasPrint = printOf(aliasRows);
    keyword = nextKeyword;
    builtAt = Date.now();
    perf.counters.builds += 1;
    perf.push("buildQuery", t1 - t0);
    perf.push("buildKeys", performance.now() - t1);
    if (!refs.entries.length) perf.counters.emptyBuilds = (perf.counters.emptyBuilds || 0) + 1;
    syncWatches(nextKeyword);
    notify();
    if (watchCalls !== calls) refreshAliases();
    return true;
  };
  let quietTimer = null;
  const schedule = () => {
    if (pending) return;
    pending = true;
    const first = !refs;
    const attempt = () => {
      quietTimer = null;
      if (lifecycle?.disposed) {
        pending = false;
        return;
      }
      if (!first && !quiet()) {
        quietTimer = win.setTimeout(attempt, QUIET_MS);
        return;
      }
      idle(() => {
        build({ first }).then((done) => {
          pending = false;
          if (done === false) schedule();
        }).catch((error) => {
          pending = false;
          console.error("[burrow] index build failed", error);
        });
      });
    };
    attempt();
  };
  lifecycle?.add(() => {
    if (quietTimer != null) win.clearTimeout(quietTimer);
  });
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
    refreshAliases,
    // fn() runs after a build or an alias refresh.
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get watched() {
      return [...watches.keys()];
    },
    // A popup opened: an index older than the TTL is rebuilt at the next
    // quiet moment (after this popup closes and the typing stops), never now.
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
  refProse: true,
  richRows: true,
  betterMatch: true,
  drill: true,
  drillPreview: true,
  tabDrill: true,
  paneLayout: true,
  keyHints: true,
  pickMemory: false,
  pageBoost: true,
  rowPreview: true,
  previewImages: true,
  aliasCreate: false,
  aliasDelete: false,
  drillOrdinals: true,
  drillEmpty: true,
  drillCap: true,
  refSearch: true,
  refSearchHotkey: false,
  helpTips: true,
  helpSheet: true,
  helpNudge: true,
  refContext: true,
  refOutline: true,
  // Not a switch: set once the first-run line has been shown.
  helpNudgeSeen: false,
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
  ["refProse", "Prose before code in ((", "Burrow's (( rows match a block's own words: code blocks, inline code and the insides of {{embed}}, {{roam/render}} and other macros count only when what you type looks like code (it has ( ) . _ = or the like). A block of more than 64 words ranks after shorter blocks that match as well, and a match inside a [[page]] or #tag the block links comes first among equals. Off: code counts like any text and length does not count (0.6.1)."],
  ["richRows", "Rows drawn like Roam", "Burrow's (( rows, the drill panel and the previews draw a block as Roam does: a code block as its language and first line of code, inline code in a monospace face, [[links]], #tags and ((block refs)) as references, bold, italic, highlight and strike, embeds, queries, roam/render and SmartBlock buttons as small labels, images and files as labels. A long block shows the part around what you typed. Off: plain text, as in 0.6.1."],
  ["betterMatch", "Forgiving matching", "Abbreviations, initialisms and small typos for Burrow's rows. Off: separator-insensitive word matches only."],
  ["drill", "Drill-down in [[", "Type [[Page#heading > child to reach a block inside a page; Enter inserts its ((uid)). Only when the text before # or > is an exact page title or alias."],
  ["drillPreview", "Drill-down preview", "Shows the page outline around the block a drill-down resolves to, or around the highlighted block after Tab, highlighted. Drill-down still works without it."],
  ["tabDrill", "Tab drills in", "Tab on the highlighted page lists the blocks on that page, and on a referenced block with children lists the children of that block, in place under a breadcrumb. Type to filter, ↑/↓ to move, Enter inserts the block's ((uid)), Tab goes one level deeper, Shift+Tab or Backspace on an empty filter goes back, Esc returns to the results. With nothing to drill into, Tab does what Roam does."],
  ["paneLayout", "Keep panes apart", "Roam's preview, roam-aliases' column and the result list each get their own space in the picker; nothing is drawn over anything else."],
  ["keyHints", "Key hints", "A line at the bottom of the picker naming the keys that do something for the highlighted row, RefX style: on an alias row ↵ pick alias · ⌥↓ more aliases · ⇥ blocks on this page (only when the page has blocks) · ⌥A add alias; on a referenced block ↵ insert ref · ⇥ children of this block · ⇧⇥ parent; in the drill panel ↵ insert · ⇥/> children · ⇧⇥ up (back at the top) · esc results · ⌃O preview."],
  ["helpTips", "Hover tips", "Hovering a Burrow row, alias chip, preview or key hint shows what it is and which key does what with it, in Roam's colors."],
  ["helpSheet", "Key list (⌥/, F1 or ?)", "⌥/ (Alt+/) or F1 (fn+F1 on a Mac keyboard, any layout) while the picker is open, or the ? at the end of the hint line, lists every key Burrow adds, grouped, for the switches that are on. It covers the picker, so Esc, ⌥/, F1, Enter or Tab only closes it (Enter never picks a row hidden under it); any other key closes it and goes on as usual."],
  ["helpNudge", "First-run tip", "The first time the picker opens, the hint line ends with “⌥/ all keys”, once. ✕ hides it; it never comes back."],
  ["refContext", "Where the block lives", "Under the highlighted referenced block in ((, a line with its page and parent (Page › … › Parent) and how many children Tab lists."],
  ["refOutline", "Up and down the outline", "On a highlighted referenced block, Shift+Tab lists its parent's children with the block highlighted (Shift+Tab again goes higher, Enter inserts the highlighted one), and Tab lists its children under the block's whole trail."],
  ["rowPreview", "Preview follows Burrow's rows", "With Roam's preview open (Ctrl-O), a selected Burrow row shows its own page or block there: an alias row its page, a referenced block its place in the outline."],
  ["previewImages", "Images in the preview", "In the previews, the highlighted block's first image shows as a thumbnail (at most 240×160) under its line, +N when it has more. It loads after the row has been highlighted for 150 ms, only for that row; in an encrypted graph it is decrypted with Roam's file API and kept for the popup only (8 at most). Files over 5 MB and images that fail keep the image label with their alt text. Rows keep the label."],
  ["aliasCreate", "Create aliases from the picker (writes to your graph)", "⌥A (Alt+A) on a highlighted page in [[ opens an alias field. Enter adds the alias to that page's alias block (creating the block if there is none) and inserts the aliased link; Esc cancels. Changes only that one block. Off by default."],
  ["aliasDelete", "Delete aliases from the chips (writes to your graph)", "Alt+Backspace on the selected alias chip asks to confirm; Enter removes only that alias from the page's alias block, Esc keeps it. Off by default."],
  ["drillOrdinals", "Ordinal matching in drill-down", "While drilled in, typing 1, 2, (b) or iii ranks blocks that start with that number or letter first."],
  ["drillEmpty", "Hide empty blocks in drill-down", "Empty blocks without children are left out of the drill list; empty blocks with children show as (empty) ▸ and stay drillable."],
  ["drillCap", "Long levels in slices", "A drill level lists 50 blocks and a +N more row; selecting it lists the next 50, so huge pages open fast."],
  ["refSearch", "Block reference search command", "Adds Burrow: block reference search to the command palette: it opens (( at the caret of the block you are editing. Any key can be bound to it with the palette's Edit Hotkey entry, or use the switch below."],
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
var REFUSED = [
  [/[\r\n]/, "no line breaks"],
  [/,/, "no commas: Roam splits aliases on them"],
  [/#/, "no #: Roam would make a tag"],
  [/\(\(|\)\)/, "no (( )): Roam would make a block ref"],
  [/\{\{|\}\}/, "no {{ }}: Roam would make a component"],
  [/::/, "no double colon: Roam would make an attribute"],
  [/[[\]]/, "no [ ]: Roam would make a link"]
];
function validAlias(text) {
  const alias = String(text ?? "").trim();
  if (!alias) return { ok: false, reason: "type an alias" };
  for (const [re, reason] of REFUSED) if (re.test(alias)) return { ok: false, reason };
  return { ok: true, alias };
}
function isAliasBlock(string, keyword) {
  const kw = kwOf(keyword);
  return String(string).slice(0, kw.length + 2).toLowerCase() === `${kw.toLowerCase()}::`;
}
var splitFirst = (string) => {
  const at = string.indexOf("\n");
  return at < 0 ? [string, ""] : [string.slice(0, at), string.slice(at)];
};
var holds = (string, keyword, alias) => parseAliasBlock(string, keyword).some((a) => a.toLowerCase() === alias.toLowerCase());
function appendAlias(string, keyword, alias) {
  if (!isAliasBlock(string, keyword)) return null;
  if (holds(string, keyword, alias)) return { string, changed: false };
  const [line, rest] = splitFirst(string);
  const at = kwOf(keyword).length + 2;
  if (!line.slice(at).trim()) return { string: `${line.slice(0, at)} ${alias}${rest}`, changed: true };
  return { string: `${line.trimEnd()}, ${alias}${rest}`, changed: true };
}
function removeAlias(string, keyword, alias) {
  if (!isAliasBlock(string, keyword)) return null;
  const [line, rest] = splitFirst(string);
  const at = kwOf(keyword).length + 2;
  const parts = line.slice(at).split(",");
  let index = parts.findIndex((part) => clean(part) === alias);
  if (index < 0) index = parts.findIndex((part) => clean(part).toLowerCase() === alias.toLowerCase());
  if (index < 0) return null;
  parts.splice(index, 1);
  return line.slice(0, at) + parts.join(",") + rest;
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

// src/compose.js
var firstLine = (data) => String(data ?? "").split(/\r?\n/)[0];
function inserted(was, now) {
  const a = [...was], b = [...now];
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return b.slice(i, b.length - j).join("");
}
function createPromptComposer({ prompt, textarea, setValue, render }) {
  const open = (event) => {
    const p = prompt();
    return p?.kind === "add" && event.target === textarea() ? p : null;
  };
  function start(event) {
    const p = open(event);
    if (!p) return false;
    const ta = event.target;
    if (p.fresh) {
      p.text = "";
      p.fresh = false;
    }
    p.error = null;
    p.compose = { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd, text: "" };
    render();
    return true;
  }
  function update(event) {
    const p = open(event);
    if (!p?.compose) return false;
    p.compose.text = firstLine(event.data);
    render();
    return true;
  }
  function end(event) {
    const p = open(event);
    if (!p?.compose) return false;
    restore(p, event.target);
    p.text += firstLine(event.data);
    render();
    return true;
  }
  function restore(p, ta) {
    const c = p.compose;
    if (!c) return;
    p.compose = null;
    if (ta.value !== c.value) setValue(ta, c.value);
    try {
      ta.setSelectionRange(c.start, c.end);
    } catch {
    }
  }
  function key(event) {
    const p = open(event);
    if (!p || !(p.compose || event.isComposing || event.keyCode === 229 || event.key === "Dead")) return false;
    event.stopImmediatePropagation();
    return true;
  }
  function input(event) {
    if (!open(event)?.compose) return false;
    event.stopImmediatePropagation();
    return true;
  }
  function insert(event) {
    const p = open(event);
    if (!p || p.compose || event.isComposing) return false;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (!event.defaultPrevented) return true;
    add(p, event.inputType?.startsWith("insert") ? event.data ?? event.dataTransfer?.getData("text/plain") : "");
    put(p, event.target);
    return true;
  }
  function stray(event) {
    const p = open(event);
    if (!p || p.compose || event.isComposing) return false;
    event.stopImmediatePropagation();
    const ta = event.target;
    add(p, event.inputType?.startsWith("insert") ? inserted(p.block.value, ta.value) : "");
    put(p, ta);
    return true;
  }
  function add(p, data) {
    const text = firstLine(data);
    if (!text || p.saving) return;
    p.text = p.fresh ? text : p.text + text;
    p.fresh = false;
    p.error = null;
    render();
  }
  function put(p, ta) {
    const b = p.block;
    if (ta.value !== b.value) setValue(ta, b.value);
    if (ta.selectionStart === b.start && ta.selectionEnd === b.end) return;
    try {
      ta.setSelectionRange(b.start, b.end);
    } catch {
    }
  }
  return { start, update, end, restore, key, input, insert, stray };
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
  ctrlO: ["⌃O", "Ctrl+O"],
  altSlash: ["⌥/", "Alt+/"],
  altShift9: ["⌥⇧9", "Alt+Shift+9"]
};
function keyLabel(name, mac = IS_MAC) {
  const pair = NAMED[name];
  return pair ? pair[mac ? 0 : 1] : name;
}
var ALT_SLASH = /* @__PURE__ */ new Set(["/", "÷", "?", "¿"]);
var isAltSlash = (e) => e.altKey && !e.ctrlKey && !e.metaKey && ALT_SLASH.has(e.key);
var isHelpKey = (e) => isAltSlash(e) || e.key === "F1" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
function hintsKey(items) {
  return items.map(([keys, label]) => `${keys}\0${label}`).join("");
}
function pickerHints(s, mac = IS_MAC) {
  const on = s.on || {};
  const k = (name) => keyLabel(name, mac);
  const PAGE = "blocks on this page";
  const BLOCK = "children of this block";
  const drillHint = (what) => ["⇥", what, `Tab lists the ${what} in place: type to filter, ↵ inserts one, ⇧⇥ comes back`];
  const upHint = ["⇧⇥", "parent", "Shift+Tab goes up: the parent's children, this block highlighted; ⇧⇥ again goes higher, ↵ inserts the highlighted one"];
  const addAlias = [k("altA"), "add alias", "Add an alias to this page's Aliases:: block and insert it (writes to your graph)"];
  if (s.prompt === "add") return [["↵", "save alias", "Add it to the page's Aliases:: block, then insert the link"], ["esc", "cancel", "Back to the picker; nothing is written"]];
  if (s.prompt === "delete") return [["↵", "delete", "Remove only this alias from the page's alias block"], ["esc", "keep", "Keep the alias"]];
  const items = [];
  const row = s.row;
  if (row && s.chips) {
    items.push(["←→", "alias", "Choose another alias of this page"]);
    if (on.aliasDelete) items.push([k("altBackspace"), "delete", "Delete the selected alias from the page (asks first)"]);
    items.push(["↵", "insert", "Insert the page shown as the selected alias"]);
    if (row.drill && on.tabDrill) items.push(drillHint(PAGE));
    items.push(["esc", "rows", "Back to the rows"]);
    return items;
  }
  if (row?.kind === "alias") {
    items.push(["↵", "pick alias", on.pageOnly ? "Insert [[Page]]" : "Insert [alias]([[Page]])"]);
    if (row.chips) items.push([k("altDown"), "more aliases", "Move into the page's other aliases: ←→ choose, ↵ inserts the page shown as that alias"]);
    if (row.drill && on.tabDrill) items.push(drillHint(PAGE));
    if (row.aliasNew) items.push(addAlias);
    return items;
  }
  if (row?.kind === "ref") {
    items.push(["↵", "insert ref", "Insert this block's ((uid)): the original other blocks already reference"]);
    if (row.drill && on.tabDrill) items.push(drillHint(BLOCK));
    if (on.refOutline) items.push(upHint);
    return items;
  }
  if (row?.kind === "drill") {
    items.push(["↵", "insert block", "Insert the ((uid)) of the block the drill-down reaches"]);
    if (row.drill && on.tabDrill) items.push(["⇥/>", BLOCK, "Tab lists the children of this block; typing > goes one level down"]);
    else if (row.drill && on.drill) items.push([">", "next level", "Type > and a few words to reach one of its child blocks"]);
    if (on.refOutline && row.block) items.push(upHint);
    return items;
  }
  if (s.rowsAbove) items.push(["↑", s.kind === "((" ? "referenced" : "alias rows", "From Roam's first row, ↑ moves into Burrow's rows above it"]);
  if (s.kind === "[[" && s.native) {
    if (s.native.drill && on.tabDrill) items.push(drillHint(PAGE));
    if (s.native.aliasNew) items.push(addAlias);
  }
  return items;
}
function renderHints(doc, node, items) {
  const span = (className, textContent) => Object.assign(doc.createElement("span"), { className, textContent });
  const parts = [];
  items.forEach(([keys, label], i) => {
    if (i) parts.push(span("burrow-hint-sep", " · "));
    const item = span("burrow-hint", "");
    item.dataset.hint = String(i);
    item.append(span("burrow-hint-key", keys), ` ${label}`);
    parts.push(item);
  });
  node.replaceChildren(...parts);
}

// src/help.js
var WIDE = 620;
var MODIFIERS = /* @__PURE__ */ new Set(["Shift", "Alt", "Meta", "Control", "CapsLock"]);
function helpKeyAction(event) {
  if (event.key === "Enter" || event.key === "Tab" || isHelpKey(event)) return "close";
  if (event.key === "Escape" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) return "close";
  if (MODIFIERS.has(event.key)) return "keep";
  return "pass";
}
function helpGroups(setting, mac = IS_MAC) {
  const k = (name) => keyLabel(name, mac);
  const on = (id) => Boolean(setting(id));
  const groups = [];
  const pick = { title: "Pick", items: [], notes: [] };
  if (on("aliasPages") || on("refRanking")) pick.items.push(["↑ ↓", "move; ↑ on Roam's first row enters Burrow's"]);
  pick.items.push(["↵", "insert the selected row, or click it"], ["esc", "back to Roam's rows"]);
  if (on("refRanking")) pick.items.push(["((", "referenced blocks first"]);
  if (on("refSearch") && on("refSearchHotkey")) pick.items.push([k("altShift9"), "open (( at the caret"]);
  groups.push(pick);
  const aliases = { title: "Aliases", items: [], notes: [] };
  if (on("aliasPages")) aliases.items.push(["[[alias", setting("aliasLinkFormat") === "[[Page]]" ? "↵ inserts [[Page]]" : "↵ inserts [alias]([[Page]])"]);
  if (on("aliasPages") && on("aliasChips")) aliases.items.push([k("altDown"), "the page's other aliases, ←→"]);
  if (on("aliasCreate")) aliases.items.push([k("altA"), "add an alias to the page"]);
  if (on("aliasDelete") && on("aliasChips")) aliases.items.push([k("altBackspace"), "delete the selected alias"]);
  const off = [];
  if (!on("aliasCreate")) off.push(`${k("altA")} add (Create aliases)`);
  if (!on("aliasDelete")) off.push(`${k("altBackspace")} delete (Delete aliases)`);
  if (off.length) aliases.notes.push(`Off, they write to your graph: ${off.join(", ")}. Settings → Burrow turns them on.`);
  if (on("aliasDelete") && !(on("aliasPages") && on("aliasChips"))) {
    aliases.notes.push(`${k("altBackspace")} deletes the selected alias chip: turn on ${on("aliasPages") ? "Alias chips" : "Alias rows in [[ and Alias chips"} (Settings → Burrow) to use it.`);
  }
  groups.push(aliases);
  const drill = { title: "Drill", items: [], notes: [] };
  if (on("tabDrill")) {
    drill.items.push(["⇥ or >", "on a page: the blocks on it; on a block: its children"], ["⇧⇥ or ⌫", "one level back up"], ["type", "filter the list"]);
    if (on("drillOrdinals")) drill.items.push(["1 (b) iii", "numbered blocks first"]);
    drill.items.push(["esc", "back to the results"]);
  }
  if (on("refOutline")) drill.items.push(["⇧⇥", "on a block row: up to its parent, the block highlighted"]);
  if (on("drill")) drill.items.push(["# >", "[[Page#heading > child"]);
  if (drill.items.length) groups.push(drill);
  const preview = { title: "Preview", items: [], notes: [] };
  preview.items.push([k("ctrlO"), on("rowPreview") ? "Roam's preview, for Burrow's rows too" : "Roam's preview"]);
  if (on("tabDrill") && on("drillPreview")) preview.items.push([k("ctrlO"), "in a drill: its own preview"]);
  groups.push(preview);
  return groups;
}
function createHelpSheet({ doc, win, lifecycle }) {
  const node = doc.createElement("div");
  node.className = "burrow-help bp3-elevation-3";
  node.setAttribute("role", "dialog");
  node.setAttribute("aria-label", "Burrow keys");
  node.hidden = true;
  lifecycle.node(node, doc.body);
  let shownKey = null;
  const el = (tag, className, textContent) => Object.assign(doc.createElement(tag), { className, ...textContent != null ? { textContent } : {} });
  function render(groups, closeKey) {
    const head = el("div", "burrow-help-head");
    head.append(el("span", "burrow-help-title", "Burrow keys"), el("span", "burrow-help-close", `${closeKey}, F1 or esc closes`));
    const grid = el("div", "burrow-help-grid");
    for (const group of groups) {
      const box = el("div", "burrow-help-group");
      box.append(el("div", "burrow-help-group-title", group.title));
      for (const [keys, what] of group.items) {
        const line = el("div", "burrow-help-item");
        line.append(el("span", "burrow-help-key", keys), el("span", "burrow-help-what", what));
        box.append(line);
      }
      for (const note of group.notes) box.append(el("div", "burrow-help-note", note));
      grid.append(box);
    }
    const foot = el("div", "burrow-help-foot", `Every key has its own switch in Settings → Burrow. Opens with ${closeKey}, F1 (any keyboard layout; fn+F1 on a Mac keyboard) or the ? on the hint line.`);
    node.replaceChildren(head, grid, foot);
  }
  function place(anchor, taRect) {
    const above = taRect ? anchor.top + anchor.height / 2 < taRect.top : false;
    const width = Math.min(Math.max(anchor.width, WIDE), win.innerWidth - 16);
    node.style.left = `${Math.round(Math.max(0, Math.min(anchor.left, win.innerWidth - width)))}px`;
    node.style.width = `${Math.round(width)}px`;
    node.classList.toggle("burrow-wide", width >= WIDE);
    if (above) {
      node.style.top = "auto";
      node.style.bottom = `${Math.round(win.innerHeight - anchor.bottom)}px`;
      node.style.maxHeight = `${Math.round(Math.min(440, anchor.bottom - 8))}px`;
    } else {
      node.style.bottom = "auto";
      node.style.top = `${Math.round(anchor.top)}px`;
      node.style.maxHeight = `${Math.round(Math.min(440, win.innerHeight - anchor.top - 8))}px`;
    }
  }
  return {
    node,
    get open() {
      return !node.hidden;
    },
    show(groups, closeKey, anchor, taRect) {
      const key = JSON.stringify(groups) + closeKey;
      if (key !== shownKey) {
        render(groups, closeKey);
        shownKey = key;
      }
      place(anchor, taRect);
      node.hidden = false;
      node.scrollTop = 0;
    },
    hide() {
      node.hidden = true;
    }
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
var ORDER_BATCH = 150;
var SLOTS = `[:db/id {(limit :block/children ${ORDER_BATCH + 1}) [:db/id :block/order]}]`;
var KID_IDS = "[:find [?c ...] :in $ ?p :where [?p :block/children ?c]]";
var ORDER = "[:db/id :block/order]";
var BRIEF = "[:block/uid :block/string :block/heading :block/order {(limit :block/children 1) [:db/id]}]";
var EID = "[:db/id]";
var PAUSE = /* @__PURE__ */ Symbol("burrow-preview-pause");
function createTreeSource({ pull, q, pullMany = null, onFetch }) {
  const nodes = /* @__PURE__ */ new Map();
  const headingsByPage = /* @__PURE__ */ new Map();
  const trails = /* @__PURE__ */ new Map();
  const slots = /* @__PURE__ */ new Map();
  const paging = /* @__PURE__ */ new Map();
  const byEid = /* @__PURE__ */ new Map();
  const eids = /* @__PURE__ */ new Map();
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
  const full = {
    trail,
    window(uid, from, size) {
      const kids = children(uid);
      return { total: kids.length, kids: kids.slice(from, from + size) };
    },
    indexOf(parentUid, uid) {
      return children(parentUid).findIndex((k) => k.uid === uid);
    }
  };
  function bounded(expired = () => false) {
    const read = (fn) => {
      if (expired()) throw PAUSE;
      onFetch?.("pull");
      return fn();
    };
    const byOrder = (list) => list.sort((a, b) => a[1] - b[1]).map(([eid]) => eid);
    const slotIds = (uid) => {
      if (slots.has(uid)) return slots.get(uid);
      let job = paging.get(uid);
      if (!job) {
        const raw = read(() => pull(SLOTS, [":block/uid", uid]));
        const first2 = (raw?.[":block/children"] || []).map((k) => [k[":db/id"], k[":block/order"] ?? 0]);
        if (first2.length <= ORDER_BATCH) {
          slots.set(uid, byOrder(first2));
          return slots.get(uid);
        }
        job = { eid: raw[":db/id"], ids: null, orders: [], at: 0 };
        paging.set(uid, job);
      }
      if (!job.ids) job.ids = [...read(() => q(KID_IDS, job.eid)) || []];
      while (job.at < job.ids.length) {
        const batch = job.ids.slice(job.at, job.at + ORDER_BATCH);
        const got = read(() => pullMany ? pullMany(ORDER, batch) : batch.map((eid) => pull(ORDER, eid)));
        for (const raw of got || []) if (raw?.[":db/id"] != null) job.orders.push([raw[":db/id"], raw[":block/order"] ?? 0]);
        job.at += batch.length;
      }
      paging.delete(uid);
      slots.set(uid, byOrder(job.orders));
      return slots.get(uid);
    };
    const brief = (eid) => {
      if (!byEid.has(eid)) {
        const raw = read(() => pull(BRIEF, eid));
        const n = raw?.[":block/uid"] ? node(raw) : null;
        if (n && !Array.isArray(n.kids) && !raw[":block/children"]?.length) n.kids = [];
        if (n) eids.set(n.uid, eid);
        byEid.set(eid, n);
      }
      return byEid.get(eid);
    };
    const eidOf = (uid) => {
      if (!eids.has(uid)) eids.set(uid, read(() => pull(EID, [":block/uid", uid]))?.[":db/id"] ?? null);
      return eids.get(uid);
    };
    return {
      trail(uid) {
        if (!trails.has(uid) && expired()) throw PAUSE;
        return trail(uid);
      },
      window(uid, from, size) {
        const known = nodes.get(uid)?.kids;
        if (Array.isArray(known)) return { total: known.length, kids: known.slice(from, from + size) };
        const ids = slotIds(uid);
        return { total: ids.length, kids: ids.slice(from, from + size).map(brief).filter(Boolean) };
      },
      indexOf(parentUid, uid) {
        const known = nodes.get(parentUid)?.kids;
        if (Array.isArray(known)) return known.findIndex((k) => k.uid === uid);
        const ids = slotIds(parentUid);
        return ids.indexOf(eidOf(uid));
      }
    };
  }
  return {
    children,
    twoLevels,
    headings,
    trail,
    first,
    full,
    bounded,
    get: (uid) => nodes.get(uid) || null,
    clear() {
      nodes.clear();
      headingsByPage.clear();
      trails.clear();
      slots.clear();
      paging.clear();
      byEid.clear();
      eids.clear();
    },
    get size() {
      return nodes.size;
    }
  };
}

// src/tasks.js
var TASK_SOURCE = String.raw`\{\{\s*(?:\[\[)?(TODO|DONE)(?:\]\])?(?::[^{}]*)?\s*\}\}`;
var TASK = new RegExp(TASK_SOURCE, "g");
var ANY_TASK = new RegExp(TASK_SOURCE);
function taskParts(string) {
  const parts = [];
  const value = String(string ?? "");
  let at = 0;
  for (const m of value.matchAll(TASK)) {
    if (m.index > at) parts.push({ text: value.slice(at, m.index) });
    parts.push({ task: m[1] === "DONE" ? "done" : "todo" });
    at = m.index + m[0].length;
  }
  if (at < value.length) parts.push({ text: value.slice(at) });
  return parts;
}
var hasTask = (string) => ANY_TASK.test(String(string ?? ""));
function checkbox(doc, state) {
  const box = doc.createElement("span");
  box.className = `burrow-check burrow-${state}`;
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", state === "done" ? "done" : "to do");
  return box;
}

// src/rich.js
var CHIP = "burrow-label";
var ATTR = "burrow-attr";
var ATTR_AT = /^\s*([^:\n`]{1,80})::\s*/;
var WS = /\s/;
var WS_RUN = /\s+/g;
var BRACKETS = /\[\[|\]\]/g;
var SMARTBLOCK = /:\d*SmartBlock:/i;
var BREF_IN = /\(\(([\w-]{9})\)\)/;
var FILE = /\.(?:pdf|docx|xlsx|pptx|zip|csv|mp4|mov|mp3|png|jpg|jpeg|gif)(?:[?#].*)?$/i;
var COMMENT = /^\s*(#|\/\/|--|;|%|\/\*|\*|<!--)/;
var MACRO_CAP2 = 4e3;
var SPAN_CAP = 500;
var MACROS = /* @__PURE__ */ new Map([
  ["embed", "embed"],
  ["embed-path", "embed"],
  ["embed-children", "embed"],
  ["roam/render", "render"],
  ["query", "query"],
  ["pdf", "pdf"],
  ["video", "video"],
  ["youtube", "video"],
  ["audio", "audio"],
  ["iframe", "iframe"]
]);
var LANGS = /* @__PURE__ */ new Map([
  ["r", "R"],
  ["js", "JS"],
  ["javascript", "JS"],
  ["ts", "TS"],
  ["typescript", "TS"],
  ["py", "Python"],
  ["python", "Python"],
  ["clj", "Clojure"],
  ["clojure", "Clojure"],
  ["cljs", "Clojure"],
  ["sh", "Shell"],
  ["bash", "Shell"],
  ["shell", "Shell"],
  ["zsh", "Shell"],
  ["css", "CSS"],
  ["html", "HTML"],
  ["sql", "SQL"],
  ["json", "JSON"],
  ["md", "Markdown"],
  ["markdown", "Markdown"],
  ["yaml", "YAML"],
  ["yml", "YAML"]
]);
var STYLES = [["**", "burrow-b"], ["__", "burrow-i"], ["^^", "burrow-hl"], ["~~", "burrow-s"]];
function langLabel(lang) {
  const key = lang.toLowerCase();
  if (!key) return "code";
  const known = LANGS.get(key);
  if (known) return known;
  return key.length <= 3 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
}
function codeLine(body, needle = null) {
  const text = String(body ?? "");
  let first = "";
  let firstCode = "";
  let comment = "";
  let at = 0;
  while (at <= text.length) {
    let end = text.indexOf("\n", at);
    if (end === -1) end = text.length;
    const line = text.slice(at, end);
    at = end + 1;
    if (!line.trim()) continue;
    if (needle) {
      needle.lastIndex = 0;
      const hit = needle.test(line);
      needle.lastIndex = 0;
      if (hit) {
        if (!COMMENT.test(line)) return line.trim().slice(0, 120);
        if (!comment) comment = line;
      }
    }
    if (!first) first = line;
    if (!firstCode && !COMMENT.test(line)) {
      firstCode = line;
      if (!needle) break;
    }
  }
  return (comment || firstCode || first).trim().slice(0, 120);
}
function closeAt(s, from, open, close, cap) {
  const end = Math.min(s.length, from + cap);
  const width = open.length;
  let depth = 1;
  for (let j = from + width; j < end; j++) {
    const c = s.charCodeAt(j);
    if (c === open.charCodeAt(0) && (width === 1 || s.charCodeAt(j + 1) === open.charCodeAt(1))) {
      depth++;
      j += width - 1;
    } else if (c === close.charCodeAt(0) && (width === 1 || s.charCodeAt(j + 1) === close.charCodeAt(1))) {
      depth--;
      if (depth === 0) return j + width;
      j += width - 1;
    }
  }
  return -1;
}
function macroEnd(s, from) {
  const end = Math.min(s.length, from + MACRO_CAP2);
  let depth = 0;
  for (let j = from; j < end; j++) {
    const c = s.charCodeAt(j);
    if (c === 123) depth++;
    else if (c === 125 && --depth === 0) return j + 1;
  }
  return -1;
}
function macroLabel(inner) {
  const colon = inner.indexOf(":");
  if (SMARTBLOCK.test(inner)) return inner.slice(0, colon).trim() || "SmartBlock";
  const written = (colon === -1 ? inner : inner.slice(0, colon)).replace(BRACKETS, "").trim();
  const known = MACROS.get(written.toLowerCase());
  if (known) return known;
  if (!written) return "macro";
  return written.length > 24 ? `${written.slice(0, 24)}…` : written;
}
function richParts(string, { resolve = () => null, needle = null } = {}) {
  return parse(String(string ?? ""), resolve, false, needle);
}
function parse(input, resolve, inner, needle = null) {
  let s = input.trim();
  const parts = [];
  if (s.startsWith(":hiccup")) return [{ text: "hiccup", cls: CHIP }];
  if (s.startsWith("> ")) s = s.slice(2);
  const on = [false, false, false, false];
  let style = "";
  const push = (text, base = "") => {
    if (!text) return;
    if (WS.test(text)) text = text.replace(WS_RUN, " ");
    const cls = base === CHIP ? base : style ? base ? `${base} ${style}` : style : base;
    const last2 = parts[parts.length - 1];
    if (cls !== CHIP && (!last2 || last2.task || last2.cls !== CHIP && last2.text.endsWith(" ")) && text[0] === " ") text = text.slice(1);
    if (!text) return;
    if (last2 && !last2.task && cls !== CHIP && last2.cls === cls) last2.text += text;
    else parts.push({ text, cls });
  };
  const pushTask = (task) => {
    const last2 = parts[parts.length - 1];
    if (last2 && !last2.task && last2.cls !== CHIP && last2.text.endsWith(" ")) {
      last2.text = last2.text.slice(0, -1);
      if (!last2.text) parts.pop();
    }
    parts.push({ task });
  };
  const attr = ATTR_AT.exec(s);
  let i = 0;
  if (attr) {
    push(`${attr[1].trim()}:`, ATTR);
    i = attr[0].length;
  }
  const n = s.length;
  let from = i;
  let marked = -1;
  const flush = (to) => {
    if (to > from) push(s.slice(from, to));
  };
  const done = (to) => {
    i = to;
    from = to;
  };
  while (i < n) {
    const c = s.charCodeAt(i);
    let end = -1;
    switch (c) {
      case 123: {
        if (s.charCodeAt(i + 1) !== 123 || (end = macroEnd(s, i)) === -1) break;
        flush(i);
        const macro = s.slice(i, end);
        const asTask = taskParts(macro);
        if (asTask.length === 1 && asTask[0].task) pushTask(asTask[0].task);
        else {
          const body = macro.slice(2, -2);
          const label = macroLabel(body);
          push(label, CHIP);
          if (!inner && label === "embed") {
            const uid = BREF_IN.exec(body)?.[1];
            const text = uid ? resolve(uid) : null;
            if (typeof text === "string") for (const part of parse(text, resolve, true)) part.task ? pushTask(part.task) : push(part.text, part.cls);
          }
        }
        done(end);
        continue;
      }
      case 96: {
        if (s.startsWith("```", i)) {
          flush(i);
          const close = s.indexOf("```", i + 3);
          const nl = s.indexOf("\n", i + 3);
          let lang = "";
          let body;
          if (nl === -1 || close !== -1 && close < nl) body = close === -1 ? s.slice(i + 3) : s.slice(i + 3, close);
          else {
            lang = s.slice(i + 3, nl).trim().split(WS_RUN)[0];
            body = close === -1 ? s.slice(nl + 1) : s.slice(nl + 1, close);
          }
          push(langLabel(lang), CHIP);
          push(codeLine(body, needle), "burrow-code");
          done(close === -1 ? n : close + 3);
          continue;
        }
        end = s.indexOf("`", i + 1);
        if (end > i + 1 && !(s.indexOf("\n", i + 1) < end && s.indexOf("\n", i + 1) !== -1)) {
          flush(i);
          push(s.slice(i + 1, end), "burrow-code");
          done(end + 1);
          continue;
        }
        break;
      }
      case 36: {
        if (s.charCodeAt(i + 1) !== 36) break;
        end = s.indexOf("$$", i + 2);
        if (end <= i + 2) break;
        flush(i);
        push(s.slice(i + 2, end), "burrow-code");
        done(end + 2);
        continue;
      }
      case 91: {
        if (s.charCodeAt(i + 1) === 91) {
          end = closeAt(s, i, "[[", "]]", SPAN_CAP);
          if (end === -1) break;
          flush(i);
          push(s.slice(i + 2, end - 2).replace(BRACKETS, ""), "burrow-ref");
          done(end);
          continue;
        }
        const link = linkAt(s, i);
        if (!link) break;
        flush(i);
        const target = link.target.trim();
        const text = link.text || target;
        if (target.startsWith("[[") && target.endsWith("]]")) push(text, "burrow-ref");
        else if (target.startsWith("((") && target.endsWith("))")) push(text, "burrow-bref");
        else {
          if (target.includes("firebasestorage") || FILE.test(target)) push("file", CHIP);
          push(text, "burrow-link");
        }
        done(link.end);
        continue;
      }
      case 33: {
        if (s.charCodeAt(i + 1) !== 91) break;
        const image = linkAt(s, i + 1);
        if (!image) break;
        flush(i);
        push("image", CHIP);
        done(image.end);
        continue;
      }
      case 35: {
        const before = i === 0 ? 32 : s.charCodeAt(i - 1);
        if (!(before === 32 || before === 40 || before === 9 || before === 10 || before === 13 || marked === i)) break;
        if (s.charCodeAt(i + 1) === 91 && s.charCodeAt(i + 2) === 91) {
          end = closeAt(s, i + 1, "[[", "]]", SPAN_CAP);
          if (end === -1) break;
          flush(i);
          push(`#${s.slice(i + 3, end - 2).replace(BRACKETS, "")}`, "burrow-tag");
          done(end);
          continue;
        }
        let j = i + 1;
        while (j < n) {
          const d = s.charCodeAt(j);
          if (d === 32 || d === 9 || d === 10 || d === 13 || d === 91 || d === 93 || d === 35 || d === 44 || d === 40 || d === 41) break;
          if ((d === 42 || d === 95 || d === 94 || d === 126) && s.charCodeAt(j + 1) === d && on[d === 42 ? 0 : d === 95 ? 1 : d === 94 ? 2 : 3]) break;
          j++;
        }
        while (j > i + 1 && `.,!?;:'"`.includes(s[j - 1])) j--;
        if (j === i + 1) break;
        flush(i);
        push(s.slice(i, j), "burrow-tag");
        done(j);
        continue;
      }
      case 40: {
        if (s.charCodeAt(i + 1) !== 40 || s.charCodeAt(i + 11) !== 41 || s.charCodeAt(i + 12) !== 41) break;
        const uid = s.slice(i + 2, i + 11);
        if (!BREF_IN.test(`((${uid}))`)) break;
        flush(i);
        const text = inner ? null : resolve(uid);
        push(typeof text === "string" ? plainText(parse(text, resolve, true)) : `((${uid}))`, "burrow-bref");
        done(i + 13);
        continue;
      }
      case 42:
      case 95:
      case 94:
      case 126: {
        if (s.charCodeAt(i + 1) !== c) break;
        const k = c === 42 ? 0 : c === 95 ? 1 : c === 94 ? 2 : 3;
        if (!on[k] && s.indexOf(STYLES[k][0], i + 2) === -1) break;
        flush(i);
        on[k] = !on[k];
        style = STYLES.filter((_, x) => on[x]).map((x) => x[1]).join(" ");
        marked = i + 2;
        done(i + 2);
        continue;
      }
    }
    i++;
  }
  flush(n);
  const last = parts[parts.length - 1];
  if (last && !last.task && last.cls !== CHIP) {
    last.text = last.text.trimEnd();
    if (!last.text) parts.pop();
  }
  return parts;
}
function linkAt(s, from) {
  const close = closeAt(s, from, "[", "]", SPAN_CAP);
  if (close === -1 || s.charCodeAt(close) !== 40) return null;
  const end = closeAt(s, close, "(", ")", SPAN_CAP);
  if (end === -1) return null;
  return { text: s.slice(from + 1, close - 1), target: s.slice(close + 1, end - 1), end };
}
var spaced = (part) => part.cls === CHIP || part.cls === ATTR;
function plainText(parts) {
  let out = "";
  let apart = false;
  for (const part of parts) {
    if (part.task) continue;
    const gap = out && !out.endsWith(" ") && part.text[0] !== " " && (apart || spaced(part));
    out += (gap ? " " : "") + part.text;
    apart = spaced(part);
  }
  return out.trim();
}
function snippet(parts, re, { lead = 30, keep = 24 } = {}) {
  if (!re) return parts;
  let full = "";
  for (const part of parts) if (!part.task && part.cls !== CHIP) full += part.text;
  const scan = re.global ? re : new RegExp(re.source, `${re.flags}g`);
  scan.lastIndex = 0;
  const hits = [];
  for (let m = scan.exec(full); m && hits.length < 64; m = scan.exec(full)) {
    if (!m[0]) {
      scan.lastIndex++;
      continue;
    }
    hits.push({ index: m.index, word: m[0].toLowerCase() });
  }
  scan.lastIndex = 0;
  if (re.lastIndex) re.lastIndex = 0;
  if (!hits.length) return parts;
  let hit = hits[0];
  let best = 0;
  for (let i = 0; i < hits.length; i++) {
    const words = /* @__PURE__ */ new Set();
    for (let j = i; j < hits.length && hits[j].index <= hits[i].index + 40; j++) words.add(hits[j].word);
    if (words.size > best) {
      best = words.size;
      hit = hits[i];
    }
  }
  if (hit.index <= lead) return parts;
  let cut = hit.index - keep;
  if (cut <= 0) return parts;
  const space = full.indexOf(" ", cut);
  if (space !== -1 && space < hit.index) cut = space + 1;
  const out = [];
  let k = 0;
  while (k < parts.length && parts[k].task) out.push(parts[k++]);
  out.push({ text: "…", cls: "burrow-ellipsis" });
  let at = 0;
  for (const part of parts) {
    if (part.task || part.cls === CHIP) {
      if (at >= cut && !(part.task && out.includes(part))) out.push(part);
      continue;
    }
    const to = at + part.text.length;
    if (to > cut) out.push(at >= cut ? part : { text: part.text.slice(cut - at), cls: part.cls });
    at = to;
  }
  return out;
}
function renderParts(doc, parts, highlight = (text) => text) {
  const fragment = doc.createDocumentFragment();
  for (const part of parts) {
    if (part.task) fragment.append(checkbox(doc, part.task));
    else if (!part.cls) fragment.append(highlight(part.text));
    else {
      const span = doc.createElement("span");
      span.className = part.cls;
      if (part.cls === CHIP) span.textContent = part.text;
      else span.append(highlight(part.text));
      fragment.append(span);
    }
  }
  return fragment;
}
function createRichCache(limit = 400) {
  const map = /* @__PURE__ */ new Map();
  return {
    get(uid, string, make) {
      const key = `${uid}\0${string}`;
      if (map.has(key)) return map.get(key);
      const value = make();
      map.set(key, value);
      if (map.size > limit) map.delete(map.keys().next().value);
      return value;
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    }
  };
}

// src/thumbs.js
var FENCE = /```[\s\S]*?(?:```|$)/g;
var INLINE_CODE = /`[^`\n]*`/g;
var SCHEME = /^(?:https?:\/\/|data:image\/)/i;
function firstImage(string) {
  if (!string || string.indexOf("![") === -1) return null;
  const s = string.replace(FENCE, " ").replace(INLINE_CODE, " ");
  let first = null;
  let more = 0;
  let at = 0;
  for (; ; ) {
    const i = s.indexOf("![", at);
    if (i === -1) break;
    at = i + 2;
    const mid = s.indexOf("](", at);
    if (mid === -1) break;
    if (s.indexOf("]", at) !== mid) continue;
    let depth = 1;
    let j = mid + 2;
    for (; j < s.length && depth; j++) {
      const c = s.charCodeAt(j);
      if (c === 40) depth++;
      else if (c === 41) depth--;
    }
    if (depth) break;
    at = j;
    const url = s.slice(mid + 2, j - 1).trim().split(/\s/)[0];
    if (!SCHEME.test(url)) continue;
    if (first) more++;
    else first = { url, alt: s.slice(i + 2, mid).trim() };
  }
  return first && { ...first, more };
}
function isEncryptedUrl(url) {
  let path = String(url).split(/[?#]/)[0];
  try {
    path = decodeURIComponent(path);
  } catch {
  }
  return path.toLowerCase().endsWith(".enc");
}
function createThumbs({ doc, win, api, perf, lifecycle, encrypted = () => api?.graph?.isEncrypted === true, dwellMs = 150, maxBytes = 5 * 1024 * 1024, cacheSize = 8 }) {
  const lru = /* @__PURE__ */ new Map();
  let timer = null;
  let current = null;
  let generation = 0;
  const syncCount = () => {
    perf.counters.thumbUrls = lru.size;
  };
  const count = () => {
    perf.counters.thumbLoads = (perf.counters.thumbLoads || 0) + 1;
  };
  syncCount();
  function revoke(objectUrl) {
    try {
      win.URL.revokeObjectURL(objectUrl);
    } catch {
    }
  }
  function remember(url, objectUrl) {
    const old = lru.get(url);
    if (old) {
      lru.delete(url);
      revoke(old);
    }
    lru.set(url, objectUrl);
    while (lru.size > cacheSize) {
      const oldest = lru.keys().next().value;
      revoke(lru.get(oldest));
      lru.delete(oldest);
    }
    syncCount();
  }
  function setImg(box, img) {
    box.querySelector(".burrow-thumb-img")?.remove();
    box.prepend(img);
  }
  function fail(box, image) {
    try {
      box.dataset.state = "failed";
      box.querySelector(".burrow-thumb-img")?.remove();
      box.querySelector(".burrow-label")?.remove();
      const label = doc.createElement("span");
      label.className = "burrow-label";
      label.append("image");
      if (image.alt) label.append(` ${image.alt}`);
      box.prepend(label);
    } catch {
    }
  }
  function showImg(req, src, lazy) {
    const { box, image } = req;
    const img = doc.createElement("img");
    img.className = "burrow-thumb-img";
    if (lazy) img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
    img.alt = image.alt || "";
    img.draggable = false;
    img.addEventListener("load", () => {
      box.dataset.state = "ok";
    });
    img.addEventListener("error", () => fail(box, image));
    box.dataset.state = "loading";
    setImg(box, img);
    img.src = src;
  }
  function plain(req) {
    count();
    showImg(req, req.image.url, true);
  }
  async function decrypted(req) {
    const { box, image } = req;
    const gen = generation;
    box.dataset.state = "loading";
    count();
    let file;
    try {
      file = await api.file.get({ url: image.url });
    } catch {
      if (!isEncryptedUrl(image.url) && current === req && box.isConnected) plain(req);
      else fail(box, image);
      return;
    }
    try {
      if (!file || !(file.size <= maxBytes)) {
        fail(box, image);
        return;
      }
      if (gen !== generation) return;
      const objectUrl = win.URL.createObjectURL(file);
      remember(image.url, objectUrl);
      if (current === req && box.isConnected) showImg(req, objectUrl, false);
    } catch {
      fail(box, image);
    }
  }
  function load(req) {
    try {
      if (encrypted() || isEncryptedUrl(req.image.url)) {
        if (!api?.file?.get) {
          fail(req.box, req.image);
          return;
        }
        decrypted(req).catch(() => fail(req.box, req.image));
      } else plain(req);
    } catch {
      fail(req.box, req.image);
    }
  }
  function stopTimer() {
    if (timer != null) {
      win.clearTimeout(timer);
      timer = null;
    }
  }
  function cancel(owner) {
    if (owner != null && current?.owner !== owner) return;
    stopTimer();
    current = null;
  }
  function clear() {
    cancel();
    generation++;
    for (const objectUrl of lru.values()) revoke(objectUrl);
    lru.clear();
    syncCount();
  }
  lifecycle.add(() => clear());
  return {
    box(image) {
      const box = doc.createElement("div");
      box.className = "burrow-thumb";
      box.dataset.state = "wait";
      if (image.more > 0) {
        const more = doc.createElement("span");
        more.className = "burrow-thumb-more";
        more.textContent = `+${image.more}`;
        box.append(more);
      }
      return box;
    },
    want(box, image, owner) {
      stopTimer();
      const req = { box, image, owner };
      current = req;
      try {
        const cached = lru.get(image.url);
        if (cached) {
          lru.delete(image.url);
          lru.set(image.url, cached);
          showImg(req, cached, false);
          return;
        }
        timer = win.setTimeout(() => {
          timer = null;
          try {
            if (current === req && box.isConnected) load(req);
          } catch {
            fail(box, image);
          }
        }, dwellMs);
      } catch {
        fail(box, image);
      }
    },
    cancel,
    clear,
    get live() {
      return lru.size;
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
var readerOf = (tree) => tree.window ? tree : {
  trail: (uid) => tree.trail(uid),
  window(uid, from, size) {
    const kids = tree.children(uid);
    return { total: kids.length, kids: kids.slice(from, from + size) };
  },
  indexOf: (parentUid, uid) => tree.children(parentUid).findIndex((k) => k.uid === uid)
};
function previewModel(result, tree, text, { hideEmpty = false, images = false } = {}) {
  const read = readerOf(tree);
  const { page, target } = result;
  const trailNodes = target ? read.trail(target.uid) : [];
  const parentUid = trailNodes.length ? trailNodes[trailNodes.length - 1].uid : page.uid;
  const trail = [page.title, ...trailNodes.slice(1).map((n) => text(n.string || ""))];
  const items = [];
  const emptyLeaf = (n) => hideEmpty && !text(n.string || "").trim() && Array.isArray(n.kids) && n.kids.length === 0;
  const task = (s) => hasTask(s) ? taskParts(s).find((p) => p.task)?.task ?? null : null;
  const withImage = (item, string) => {
    if (images && item.target) {
      const image = firstImage(string);
      if (image) item.image = image;
    }
    return item;
  };
  const mayHaveKids = (n) => n.kids == null || n.kids.length > 0;
  const pushKids = (uid, depth, levels) => {
    const { total: total2, kids } = read.window(uid, 0, CHILD_LIMIT);
    for (const kid of kids) {
      if (items.length >= ITEM_LIMIT) return;
      if (emptyLeaf(kid)) continue;
      items.push({ uid: kid.uid, text: text(kid.string || ""), string: kid.string ?? "", task: task(kid.string), depth, heading: kid.heading, target: false });
      if (levels > 1 && mayHaveKids(kid)) pushKids(kid.uid, depth + 1, levels - 1);
    }
    if (total2 > CHILD_LIMIT) items.push({ more: total2 - CHILD_LIMIT, depth });
  };
  if (!target) {
    pushKids(page.uid, 0, 2);
    return { key: `page:${page.uid}`, trail, items };
  }
  const at = Math.max(0, read.indexOf(parentUid, target.uid));
  const { total } = read.window(parentUid, 0, 0);
  const from = Math.max(0, Math.min(at - Math.floor(SIBLING_WINDOW / 2), total - SIBLING_WINDOW));
  const siblings = read.window(parentUid, from, SIBLING_WINDOW).kids;
  if (from > 0) items.push({ more: from, depth: 0 });
  for (const sib of siblings) {
    const isTarget = sib.uid === target.uid;
    if (!isTarget && emptyLeaf(sib)) continue;
    items.push(withImage({ uid: sib.uid, text: text(sib.string || ""), string: sib.string ?? "", task: task(sib.string), depth: 0, heading: sib.heading, target: isTarget }, sib.string));
    if (isTarget) pushKids(target.uid, 1, 2);
  }
  if (from + SIBLING_WINDOW < total) items.push({ more: total - from - SIBLING_WINDOW, depth: 0 });
  if (!siblings.length) items.push(withImage({ uid: target.uid, text: text(target.string || ""), string: target.string ?? "", task: task(target.string), depth: 0, heading: target.heading, target: true }, target.string));
  return { key: `node:${target.uid}`, trail, items };
}
function createPreview({ doc, win, lifecycle, rich = null, thumbs = null }) {
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
  let thumb = null;
  let thumbSeen = false;
  function dropThumb() {
    if (!thumb) return;
    thumbs.cancel(pane);
    thumb.box.remove();
    thumb = null;
  }
  let rest = null;
  let restAt = 0;
  function render(model, lines = Infinity, deadline = Infinity) {
    trailNode.replaceChildren();
    model.trail.forEach((part, i) => {
      if (i) trailNode.append(Object.assign(doc.createElement("span"), { className: "burrow-sep", textContent: " › " }));
      trailNode.append(Object.assign(doc.createElement("span"), { className: "burrow-crumb", textContent: part }));
    });
    const first = model.items.slice(0, lines);
    thumbSeen = false;
    const wrote = writeLines(first, 0, deadline);
    rest = model.items.length > wrote ? model.items.slice(wrote) : null;
    restAt = wrote;
    const kids = outline.children;
    if (thumbs && !thumbSeen) dropThumb();
    while (kids.length > model.items.length) kids[kids.length - 1].remove();
    for (let i = wrote; i < kids.length; i++) kids[i].hidden = true;
  }
  function writeLines(items, from, deadline = Infinity, min = 0) {
    const kids = outline.children;
    const made = [];
    let lastTarget = -1;
    if (deadline !== Infinity) {
      for (let i = 0; i < items.length; i++) if (items[i].target) lastTarget = i;
    }
    let wrote = 0;
    for (; wrote < items.length; wrote++) {
      if (deadline !== Infinity && wrote >= min && wrote > lastTarget && performance.now() > deadline) break;
      const item = items[wrote];
      const row = kids[from + wrote] || doc.createElement("div");
      let cls = "burrow-node";
      if (item.more != null) cls += " burrow-more";
      else {
        if (item.heading) cls += ` burrow-h${item.heading}`;
        if (item.target) cls += " burrow-target";
        if (item.task) cls += ` burrow-task-${item.task}`;
      }
      if (row.className !== cls) row.className = cls;
      const depth = String(item.depth);
      if (row.style.getPropertyValue("--burrow-depth") !== depth) row.style.setProperty("--burrow-depth", depth);
      writeContent(row, item);
      if (thumbs) writeThumb(row, item);
      if (row.hidden) row.hidden = false;
      if (!row.parentNode) made.push(row);
    }
    if (made.length) outline.append(...made);
    return wrote;
  }
  function writeContent(row, item) {
    if (item.more == null && item.string != null && rich) {
      const key = `${item.uid}\0${item.string}`;
      if (row.__burrowLine === key) return;
      const parts = rich(item)?.filter((part) => !part.task);
      if (parts?.length) {
        row.__burrowLine = key;
        if (parts.every((part) => part.cls === "")) setText(row, plainText(parts) || " ");
        else row.replaceChildren(renderParts(doc, parts));
        return;
      }
    }
    row.__burrowLine = null;
    setText(row, item.more != null ? `+${item.more} more` : item.text || " ");
  }
  function writeThumb(row, item) {
    if (item.target && item.image) {
      thumbSeen = true;
      const key = `${item.uid}\0${item.image.url}`;
      if (thumb?.key !== key) {
        thumb?.box.remove();
        thumb = { key, box: thumbs.box(item.image) };
        thumbs.want(thumb.box, item.image, pane);
      }
      if (thumb.box.parentNode !== row || thumb.box !== row.lastChild) row.append(thumb.box);
    } else if (thumb && thumb.box.parentNode === row) thumb.box.remove();
  }
  function setText(row, text) {
    if (row.childNodes.length === 1 && row.firstChild.nodeType === 3) {
      if (row.firstChild.data !== text) row.firstChild.data = text;
    } else row.textContent = text;
  }
  function dockRect(beside) {
    if (beside || !pop.classList.contains("rm-autocomplete__results--expanded")) return null;
    const native = pop.querySelector(".rm-autocomplete__preview");
    return native ? native.getBoundingClientRect() : null;
  }
  function dock(r) {
    Object.assign(pane.style, {
      left: `${Math.round(r.left)}px`,
      top: `${Math.round(r.top)}px`,
      width: `${Math.round(r.width)}px`,
      height: `${Math.round(r.height)}px`,
      maxHeight: ""
    });
    pane.classList.add("burrow-preview-docked");
  }
  function place(avoid, beside) {
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
      if (pane.scrollTop) pane.scrollTop = 0;
      return;
    }
    const top = target.offsetTop - trailNode.offsetHeight;
    const bottom = target.offsetTop + target.offsetHeight;
    if (top < pane.scrollTop) pane.scrollTop = Math.max(0, top - 4);
    else if (bottom > pane.scrollTop + pane.clientHeight) pane.scrollTop = bottom - pane.clientHeight + 4;
  }
  let scrollFrame = null;
  const cancelScroll = () => {
    if (scrollFrame != null) {
      win.cancelAnimationFrame(scrollFrame);
      scrollFrame = null;
    }
  };
  lifecycle.add(cancelScroll);
  let filled = false;
  return {
    node: pane,
    // Does this pane lie over `popover`'s preview area (its class hides Roam's)?
    drills: (popover) => !pane.hidden && pop === popover && pane.classList.contains("burrow-preview-docked"),
    // The model's lines only, no layout read: show() places them (in a frame).
    fill(model, popover, { budgetMs = Infinity } = {}) {
      if (pop && pop !== popover) pop.classList.remove(DRILL_CLASS);
      pop = popover;
      if (model.key === shownKey) return;
      render(model, Infinity, performance.now() + budgetMs);
      shownKey = model.key;
      filled = true;
    },
    // inFrame: called from a frame callback, so the scroll runs now, in this frame.
    // lines: draw only that many lines now; more() draws the rest later.
    // budgetMs: stop writing lines after that long (past the highlighted one).
    show(model, popover, { avoid = null, beside = null, onFrame = null, inFrame = false, lines = Infinity, budgetMs = Infinity } = {}) {
      if (pop && pop !== popover) pop.classList.remove(DRILL_CLASS);
      pop = popover;
      if (!beside) pop.classList.add(DRILL_CLASS);
      const docked = dockRect(beside);
      const changed = model.key !== shownKey || pane.hidden || filled;
      filled = false;
      if (model.key !== shownKey) {
        render(model, lines, performance.now() + budgetMs);
        shownKey = model.key;
      }
      pane.hidden = false;
      if (docked) dock(docked);
      else place(avoid, beside);
      if (!changed) return;
      cancelScroll();
      if (!docked || inFrame) {
        scrollToTarget();
        return;
      }
      scrollFrame = win.requestAnimationFrame(() => {
        scrollFrame = null;
        if (pane.hidden || shownKey !== model.key) return;
        const t0 = performance.now();
        scrollToTarget();
        onFrame?.(performance.now() - t0);
      });
    },
    // Lines show() left for later, `lines` more of them drawn now (appended:
    // the scroll stays).
    get pending() {
      return Boolean(rest) && !pane.hidden;
    },
    // Lines left for more(), shown or not yet (fill() leaves the pane hidden).
    get unfinished() {
      return Boolean(rest);
    },
    more(lines = Infinity, budgetMs = Infinity) {
      if (!rest || pane.hidden) return;
      const items = rest.slice(0, lines);
      const wrote = writeLines(items, restAt, performance.now() + budgetMs, 1);
      rest = wrote < rest.length ? rest.slice(wrote) : null;
      restAt += wrote;
    },
    hide() {
      cancelScroll();
      rest = null;
      pane.hidden = true;
      shownKey = null;
      filled = false;
      if (thumbs) dropThumb();
      if (pop) pop.classList.remove(DRILL_CLASS);
      pop = null;
    }
  };
}

// src/scope.js
function scopeRows(nodes, query, { strict = false, text = (s) => s, ordinals = false, hideEmpty = false } = {}) {
  const row = (node, ord = false) => {
    const shown = text(node.string ?? "");
    const parts = hasTask(node.string) ? taskParts(node.string).map((p) => p.task ? p : { text: text(p.text) }) : null;
    return { uid: node.uid, text: shown, parts, empty: !shown.trim() && !parts, ord, heading: node.heading || 0, drillable: Boolean(node.kids?.length), node };
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
var MAX_ANCESTOR = 22;
var RICH_NOW = 12;
var UPGRADE_SLICE_MS = 3;
function createScopePanel({ doc, win, lifecycle, highlight, rich = null, onSlice = null }) {
  const node = doc.createElement("div");
  node.className = "burrow-scope bp3-elevation-3";
  node.setAttribute("role", "listbox");
  node.hidden = true;
  const crumb = doc.createElement("div");
  crumb.className = "burrow-scope-crumb";
  const what = doc.createElement("div");
  what.className = "burrow-scope-what";
  const list = doc.createElement("div");
  list.className = "burrow-scope-list";
  const hintsLine = doc.createElement("div");
  hintsLine.className = "burrow-scope-hints";
  const hintsList = doc.createElement("span");
  hintsList.className = "burrow-hints-list";
  const helpButton = doc.createElement("span");
  helpButton.className = "burrow-help-button";
  helpButton.setAttribute("role", "button");
  helpButton.setAttribute("aria-keyshortcuts", "Alt+/");
  helpButton.setAttribute("aria-label", `Burrow keys (${keyLabel("altSlash")})`);
  helpButton.textContent = "?";
  hintsLine.append(hintsList, helpButton);
  node.append(crumb, what, list, hintsLine);
  lifecycle.node(node, doc.body);
  let listKey = null;
  const span = (className, textContent) => Object.assign(doc.createElement("span"), { className, textContent });
  const ellipsize = (text, max = MAX_LABEL) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
  function renderCrumb(scope) {
    const level = scope.levels[scope.levels.length - 1];
    const parts = [span("burrow-crumb burrow-crumb-root", scope.rootLabel)];
    scope.levels.forEach((l, i) => {
      parts.push(span("burrow-sep", " › "));
      const part = span("burrow-crumb", ellipsize(l.label, i < scope.levels.length - 1 && scope.levels.length > 2 ? MAX_ANCESTOR : MAX_LABEL));
      part.title = l.label;
      part.dataset.level = String(i);
      parts.push(part);
    });
    const filter = span("burrow-scope-filter", level.query || "type to filter");
    filter.classList.toggle("burrow-placeholder", !level.query);
    crumb.replaceChildren(...parts, filter);
    const label = level.isPage ? "blocks on this page" : "children of this block";
    what.replaceChildren(span("burrow-what", "Drill"), level.isPage ? `${label}` : `${label}: ${ellipsize(level.label)}`);
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
    cancelUpgrade();
    const later = [];
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
      const parts = rich && row.text ? i < RICH_NOW ? rich(row) : (later.push([text, row]), null) : null;
      if (parts) text.append(renderParts(doc, parts, (t) => highlight(t, level.query)));
      else if (row.parts) for (const part of row.parts) text.append(part.task ? checkbox(doc, part.task) : highlight(part.text.trim(), level.query));
      else if (row.text) text.append(highlight(row.text, level.query));
      else if (row.drillable) {
        item.classList.add("burrow-empty-row");
        text.append(span("burrow-empty", "(empty) ▸"));
      } else text.append(span("burrow-empty", "(empty)"));
      item.append(text);
      if (row.drillable && row.text) item.append(span("burrow-drill-mark", "›"));
      return item;
    }));
    if (later.length) scheduleUpgrade(later, level.query, key);
  }
  let upgradeId = null;
  function cancelUpgrade() {
    if (upgradeId == null) return;
    (win.cancelIdleCallback || win.clearTimeout).call(win, upgradeId);
    upgradeId = null;
  }
  function scheduleUpgrade(later, query, forKey) {
    let at = 0;
    const run = () => {
      upgradeId = null;
      if (listKey !== forKey) return;
      const t0 = performance.now();
      while (at < later.length && performance.now() - t0 < UPGRADE_SLICE_MS) {
        const [text, row] = later[at++];
        if (!text.isConnected) continue;
        const parts = rich(row);
        if (parts) text.replaceChildren(renderParts(doc, parts, (t) => highlight(t, query)));
      }
      onSlice?.(performance.now() - t0);
      if (at < later.length) schedule();
    };
    const schedule = () => {
      upgradeId = typeof win.requestIdleCallback === "function" ? win.requestIdleCallback(run, { timeout: 200 }) : win.setTimeout(run, 30);
    };
    schedule();
  }
  lifecycle.add(cancelUpgrade);
  let hintsShown = null;
  let hintItems = [];
  function renderHints2(scope, on, help) {
    hintsLine.hidden = !on;
    helpButton.hidden = !help;
    if (!on) return;
    const level = scope.levels[scope.levels.length - 1];
    const active = scope.rows[level.active];
    const items = [["↵", active?.more != null ? "more" : "insert", active?.more != null ? "List the next 50 blocks" : "Insert the highlighted block's ((uid)) in place of the whole [[…]]"]];
    if (active?.drillable) items.push(["⇥/>", "children", "Go into the highlighted block: its children are listed here"]);
    items.push(
      ["⇧⇥", scope.levels.length > 1 ? "up" : "back", scope.levels.length > 1 ? "One level up the outline: the parent's children, the parent highlighted (Backspace on an empty filter too)" : "Back to the results (Backspace on an empty filter too)"],
      ["esc", "results", "Back to Roam's results; the text stays as you typed it"],
      [keyLabel("ctrlO"), "preview", "Show or hide the preview of the highlighted block"]
    );
    const key = hintsKey(items);
    if (key === hintsShown) return;
    hintsShown = key;
    hintItems = items;
    renderHints(doc, hintsList, items);
  }
  function paintActive(scope, hintsOn, helpOn = false, scroll = true) {
    const level = scope.levels[scope.levels.length - 1];
    list.querySelectorAll(".burrow-row").forEach((item, i) => {
      const on = i === level.active;
      item.classList.toggle("burrow-active", on);
      item.setAttribute("aria-selected", String(on));
      if (on && scroll) item.scrollIntoView?.({ block: "nearest" });
    });
    renderHints2(scope, hintsOn, helpOn);
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
    show(scope, hintsOn, helpOn = false) {
      renderCrumb(scope);
      renderList(scope);
      node.hidden = false;
      paintActive(scope, hintsOn, helpOn);
    },
    get hintItems() {
      return hintItems;
    },
    paintActive,
    place,
    hide() {
      cancelUpgrade();
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

// src/tips.js
var DELAY_MS = 450;
var GAP2 = 6;
var MAX_WIDTH = 320;
var MIN_WIDTH = 160;
function placeTip(el, box, area, ta, view) {
  const hits = (r, x2, y2, w = box.width) => r && x2 < r.right && x2 + w > r.left && y2 < r.bottom && y2 + box.height > r.top;
  const clampY = (y2) => Math.max(0, Math.min(view.height - box.height, y2));
  const clampX = (x2) => Math.max(4, Math.min(view.width - box.width - 4, x2));
  if (!area) {
    const x2 = clampX(el.left);
    let top = el.bottom + GAP2;
    if (top + box.height > view.height || hits(ta, x2, top)) top = el.top - GAP2 - box.height;
    return top >= 0 && !hits(ta, x2, top) ? { left: x2, top } : null;
  }
  const y = clampY(el.top);
  const right = view.width - 4 - (area.right + GAP2);
  if (right >= box.width) return { left: area.right + GAP2, top: y };
  const left = area.left - GAP2 - 4;
  if (left >= box.width) return { left: area.left - GAP2 - box.width, top: y };
  const x = clampX(el.left);
  const below = area.bottom + GAP2;
  if (below + box.height <= view.height && !hits(ta, x, below)) return { left: x, top: below };
  const above = Math.min(area.top, ta?.top ?? area.top) - GAP2 - box.height;
  if (above >= 0 && !hits(area, x, above)) return { left: x, top: above };
  const side = Math.max(right, left);
  if (side >= MIN_WIDTH) return right >= left ? { left: area.right + GAP2, top: y, width: side } : { left: 4, top: y, width: side };
  return null;
}
function createTips({ doc, win, lifecycle, enabled, avoid = () => null, around = () => null }) {
  const node = doc.createElement("div");
  node.className = "burrow-tip";
  node.setAttribute("role", "tooltip");
  node.hidden = true;
  lifecycle.node(node, doc.body);
  let timer = null;
  let anchor = null;
  let stash = null;
  function hide() {
    if (timer != null) {
      win.clearTimeout(timer);
      timer = null;
    }
    if (stash) {
      if (!stash.el.hasAttribute("title")) stash.el.setAttribute("title", stash.title);
      stash = null;
    }
    anchor = null;
    if (!node.hidden) node.hidden = true;
  }
  lifecycle.add(hide);
  function render({ title, lines }) {
    const parts = [];
    if (title) parts.push(Object.assign(doc.createElement("div"), { className: "burrow-tip-title", textContent: title }));
    for (const [keys, what] of lines || []) {
      const line = Object.assign(doc.createElement("div"), { className: "burrow-tip-line" });
      if (keys) line.append(Object.assign(doc.createElement("span"), { className: "burrow-tip-key", textContent: keys }));
      line.append(what);
      parts.push(line);
    }
    node.replaceChildren(...parts);
  }
  function place(rect, styleFrom) {
    for (const name of ["--burrow-bg", "--burrow-fg"]) node.style.setProperty(name, styleFrom.style.getPropertyValue(name) || "");
    node.style.zIndex = String((Number.parseInt(styleFrom.style.zIndex, 10) || 30) + 2);
    node.style.maxWidth = `${MAX_WIDTH}px`;
    node.style.width = "";
    node.style.left = "0px";
    node.style.top = "0px";
    node.hidden = false;
    const view = { width: win.innerWidth, height: win.innerHeight };
    const at = placeTip(rect, node.getBoundingClientRect(), around(), avoid(), view);
    if (!at) {
      hide();
      return;
    }
    if (at.width) {
      node.style.width = `${Math.floor(at.width)}px`;
      at.top = Math.max(0, Math.min(view.height - node.getBoundingClientRect().height, at.top));
    }
    node.style.left = `${Math.round(at.left)}px`;
    node.style.top = `${Math.round(at.top)}px`;
  }
  let lastAt = null;
  function attach(container, resolve) {
    lifecycle.event(container, "mousemove", (event) => {
      const at = `${event.clientX},${event.clientY}`;
      if (at === lastAt) return;
      lastAt = at;
      if (!enabled()) {
        if (anchor) hide();
        return;
      }
      const hit = resolve(event.target);
      if (!hit) {
        hide();
        return;
      }
      if (hit.el === anchor) return;
      hide();
      anchor = hit.el;
      if (hit.el.hasAttribute("title")) {
        stash = { el: hit.el, title: hit.el.getAttribute("title") };
        hit.el.removeAttribute("title");
      }
      timer = win.setTimeout(() => {
        timer = null;
        if (anchor !== hit.el || !hit.el.isConnected) return;
        render(hit);
        place(hit.el.getBoundingClientRect(), hit.themeFrom || container);
      }, DELAY_MS);
    });
    lifecycle.event(container, "mouseleave", hide);
    lifecycle.event(container, "mousedown", hide, true);
    lifecycle.event(container, "wheel", hide, { passive: true });
  }
  return {
    node,
    attach,
    hide,
    get visible() {
      return anchor != null;
    }
  };
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
  if (end === caret && insideClosed(value, caret, kind === "[[" ? "[[" : "((", close)) return null;
  return { kind, start, end, caret, query, closed: end !== caret };
}
function insideClosed(value, caret, open, close) {
  const rest = value.slice(caret);
  const at = rest.indexOf(close);
  if (at <= 0) return false;
  const line = rest.indexOf("\n");
  if (line >= 0 && line < at) return false;
  return !rest.slice(0, at).includes(open);
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

// src/wheel.js
function wheelPlan({ deltaX = 0, deltaY = 0, deltaMode = 0, shiftKey = false }, chips, list = null) {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 300 : 1;
  const dx = deltaX * unit;
  const dy = deltaY * unit;
  const horizontal = shiftKey || Math.abs(dx) > Math.abs(dy);
  if (horizontal || !dy) return { to: "native" };
  if (chips && chips.max > 0 && (dy > 0 && chips.left < chips.max - 0.5 || dy < 0 && chips.left > 0.5)) {
    return { to: "chips", left: Math.max(0, Math.min(chips.max, chips.left + dy)) };
  }
  if (!list || !(dy > 0 && list.top < list.max - 0.5 || dy < 0 && list.top > 0.5)) return { to: "native" };
  return { to: "list", by: dy };
}

// src/strip.js
var POPUP2 = ".rm-autocomplete__results";
var NATIVE_ROWS = ".rm-autocomplete__results-scroll > div";
var OWNING = "burrow-owning";
var FOLD_ALIASES = "burrow-fold-aliases";
var LAYOUT = "burrow-layout";
var SCOPE_OPEN = "burrow-scope-open";
var HELP_OPEN = "burrow-help-open";
var FOLDED = "data-burrow-folded";
var EXPANDED = "rm-autocomplete__results--expanded";
var CHIPS_INSET = 8;
var ROW_LIMIT = 3;
var POP_CLASSES = [DRILL_CLASS, FOLD_ALIASES, LAYOUT, SCOPE_OPEN, HELP_OPEN];
var HAS_KIDS = "[(limit :block/children 1)]";
var MIN_REF_QUERY = 3;
var MIN_ALIAS_QUERY = 2;
var POPUP_WAIT_FRAMES = 12;
var PREVIEW_SLICE_MS = 3;
var PREVIEW_DRAW_ALONE_MS = 0.5;
var PREVIEW_FIRST_LINES = 24;
var CONTEXT_KIDS = 100;
var valueSetter = Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement?.prototype || {}, "value")?.set;
function createStrip({ setting, indexes, perf, lifecycle, api, picks = null, saveSetting = null, doc = document, win = window }) {
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
    prompt: null,
    help: false
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
  lifecycle.add(() => strip.remove());
  const chipsNode = doc.createElement("div");
  chipsNode.className = "burrow-chips";
  const contextNode = doc.createElement("div");
  contextNode.className = "burrow-context";
  const hints = doc.createElement("div");
  hints.className = "burrow-hints";
  hints.hidden = true;
  const hintsList = doc.createElement("span");
  hintsList.className = "burrow-hints-list";
  const helpButton = doc.createElement("span");
  helpButton.className = "burrow-help-button";
  helpButton.setAttribute("role", "button");
  helpButton.setAttribute("aria-keyshortcuts", "Alt+/");
  hints.append(hintsList, helpButton);
  lifecycle.add(() => hints.remove());
  const sheet = createHelpSheet({ doc, win, lifecycle });
  const tips = createTips({
    doc,
    win,
    lifecycle,
    enabled: () => setting("helpTips"),
    avoid: () => st.ta?.isConnected ? st.ta.getBoundingClientRect() : null,
    around: () => pickerArea()
  });
  const richCache = createRichCache();
  let richRefs = null;
  const resolveRef = (uid) => indexes.refs?.byUid.get(uid)?.string ?? tree.get(uid)?.string ?? null;
  const richFor = (uid, string) => setting("richRows") ? richCache.get(uid, string, () => richParts(string, { resolve: resolveRef })) : null;
  const previewRich = (item) => item.string != null ? richFor(item.uid, item.string) : null;
  const thumbs = createThumbs({ doc, win, api, perf, lifecycle });
  const preview = createPreview({ doc, win, lifecycle, rich: previewRich, thumbs });
  const scopePreview = createPreview({ doc, win, lifecycle, rich: previewRich, thumbs });
  const scopePanel = createScopePanel({
    doc,
    win,
    lifecycle,
    highlight: (text, query) => highlight(text, query),
    rich: (row) => row.node && row.more == null ? richFor(row.node.uid, row.node.string) : null,
    onSlice: (ms) => perf.push("scope.rich", ms)
  });
  const fast = api.data?.fast?.q ? (query, ...args) => api.data.fast.q(query, ...args) : (query, ...args) => api.q(query, ...args);
  const tree = createTreeSource({
    pull: (pattern, eid) => api.pull(pattern, eid),
    pullMany: api.data?.pull_many ? (pattern, eids) => api.data.pull_many(pattern, eids) : null,
    q: fast,
    onFetch: (kind) => {
      perf.counters[kind === "query" ? "drillQueries" : "drillPulls"] = (perf.counters[kind === "query" ? "drillQueries" : "drillPulls"] || 0) + 1;
    }
  });
  const anyFeature = () => setting("aliasPages") || setting("refRanking") || setting("drill") || setting("tabDrill") || setting("paneLayout") || setting("keyHints") || setting("helpSheet");
  const kidsKnown = /* @__PURE__ */ new Map();
  function hasKids(uid) {
    if (!uid) return false;
    const kids = tree.get(uid)?.kids;
    if (Array.isArray(kids)) return kids.length > 0;
    if (!kidsKnown.has(uid)) {
      perf.counters.kidChecks = (perf.counters.kidChecks || 0) + 1;
      kidsKnown.set(uid, Boolean(api.pull(HAS_KIDS, [":block/uid", uid])?.[":block/children"]?.length));
    }
    return kidsKnown.get(uid);
  }
  const isBlockInput = (el) => el?.tagName === "TEXTAREA" && el.classList.contains("rm-block-input");
  function pickerArea() {
    const rects = [];
    const add = (el) => {
      if (el && !el.hidden && el.isConnected) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height) rects.push(r);
      }
    };
    if (st.phase !== "SCOPE" && !st.help) add(st.pop);
    add(preview.node);
    add(scopePreview.node);
    if (st.phase === "SCOPE") add(scopePanel.node);
    if (!rects.length) return null;
    return {
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom))
    };
  }
  function rank(token) {
    st.drill = null;
    if (indexes.refs !== richRefs) {
      richRefs = indexes.refs;
      richCache.clear();
    }
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
        currentPage: setting("pageBoost") ? st.pageTitle : null,
        prose: setting("refProse"),
        code: looksLikeCode(token.query)
      }).map((hit) => ({
        kind: "ref",
        key: `ref:${hit.uid}`,
        uid: hit.uid,
        refs: hit.refs,
        level: hit.level,
        page: hit.page,
        inCode: hit.inCode,
        ...rowText(hit.string),
        insertion: `((${hit.uid}))`,
        pick: hit.uid,
        // A query that matched inside code shows the code line it matched.
        rich: hit.inCode && setting("richRows") ? richParts(hit.string, { resolve: resolveRef, needle: highlightPattern(token.query) }) : richFor(hit.uid, hit.string)
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
      text: target ? readableText(target.string) : page.title,
      rich: target ? richFor(target.uid, target.string) : null
    };
  }
  function readableText(string) {
    const byUid = indexes.refs?.byUid;
    return String(string ?? "").replace(/\(\(([\w-]{9})\)\)/g, (m, uid) => byUid?.get(uid)?.string ?? tree.get(uid)?.string ?? m).replace(/^\s*([^:\n`]{1,80})::/, "$1:").replace(/\{\{\[\[(TODO|DONE)\]\]\}\}\s*/g, "").replace(/\[([^\]]*)\]\(\[\[[^\]]*\]\]\)/g, "$1").replace(/#?\[\[([^\]]*)\]\]/g, "$1").replace(/\*\*|\^\^|__|~~/g, "").replace(/\s+/g, " ").trim();
  }
  function resolveRefs(string) {
    const byUid = indexes.refs?.byUid;
    return string.replace(/\(\(([\w-]{9})\)\)/g, (m, uid) => byUid?.get(uid)?.string ?? m);
  }
  function rowText(string) {
    const resolved = resolveRefs(string);
    const text = stripRoamMarkup(resolved).replace(/\s+/g, " ").trim();
    if (!hasTask(resolved)) return { text, parts: null };
    const parts = taskParts(resolved.trim().replace(/\s*(\{\{[^{}]*\}\})\s*/g, "$1")).map((part) => part.task ? { task: part.task } : { text: stripRoamMarkup(part.text).replace(/\s+/g, " ") });
    return { text, parts };
  }
  const ROW_HEIGHT = 33;
  const CHIPS_HEIGHT = 28;
  const CONTEXT_HEIGHT = 18;
  const STRIP_FRAME = 8;
  let stripHeight = null;
  function sizeStrip(count = shown.length) {
    const lines = (chipsNode.isConnected && chipsNode.parentNode === strip ? CHIPS_HEIGHT : 0) + (contextNode.isConnected && contextNode.parentNode === strip ? CONTEXT_HEIGHT : 0);
    const promptRow = strip.firstChild === promptNode ? 1 : 0;
    const height = count || promptRow ? (count || promptRow) * ROW_HEIGHT + lines + STRIP_FRAME : 0;
    if (height === stripHeight) return;
    stripHeight = height;
    strip.style.height = height ? `${height}px` : "";
  }
  let roamAliasesSheet = null;
  let blockHighlight = null;
  const detectRoamAliases = () => {
    for (const sheet2 of doc.styleSheets) {
      let rules;
      try {
        rules = sheet2.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (!blockHighlight && rule.selectorText === ".block-highlight-blue" && rule.style?.backgroundColor) {
          blockHighlight = rule.style.backgroundColor;
        }
        if (!roamAliasesSheet && rule.selectorText?.includes(".rm-aliases")) roamAliasesSheet = sheet2.ownerNode;
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
      try {
        sampleColors();
      } catch {
      }
    }, { timeout: 5e3 });
  };
  scheduleDetect();
  lifecycle.add(() => {
    if (detectId != null) win.cancelIdleCallback(detectId);
  });
  let sampledDark = null;
  function sampleColors() {
    const nodes = [strip, preview.node, scopePreview.node, scopePanel.node];
    const set = (name, value) => {
      for (const node of nodes) {
        if (value && !/^(transparent|rgba\(.*,\s*0\))$/.test(value)) node.style.setProperty(name, value);
        else node.style.removeProperty(name);
      }
    };
    const style = (selector) => {
      const el = doc.querySelector(selector);
      return el ? win.getComputedStyle(el) : null;
    };
    set("--burrow-ref", style(".rm-page-ref--link")?.color);
    set("--burrow-tag", style(".rm-page-ref--tag")?.color);
    const bref = style(".rm-block-ref");
    set("--burrow-bref", bref ? parseFloat(bref.borderBottomWidth) > 0 ? bref.borderBottomColor : bref.color : null);
    const hl = style(".rm-highlight");
    set("--burrow-hl-bg", hl?.backgroundColor);
    set("--burrow-hl-fg", hl?.color);
    const code = style("code");
    set("--burrow-code-bg", code?.backgroundColor);
    set("--burrow-code-fg", code?.color);
    set("--burrow-mono", code?.fontFamily);
  }
  function colorsStale(dark) {
    if (dark === sampledDark) return;
    sampledDark = dark;
    scheduleDetect();
  }
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
    placeInFlow();
    liftPop();
    if (st.prompt?.kind === "add") {
      renderPrompt();
      return;
    }
    const rows = visibleRows();
    const query = st.token?.query ?? null;
    const same = query === shownQuery && rows.length === shown.length && rows.every((row, i) => row.key === shown[i].key);
    if (!same) {
      strip.replaceChildren(...rows.map((row, i) => rowNode(row, i)));
      sizeStrip(rows.length);
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
  let rowPreviewReady = null;
  function cancelRowPreview() {
    if (rowPreviewId != null) {
      (win.cancelIdleCallback || win.clearTimeout).call(win, rowPreviewId);
      rowPreviewId = null;
    }
    rowPreviewKey = null;
    rowPreviewReady = null;
  }
  function previewTarget() {
    if (st.prompt) return { kind: "alias", key: `page:${st.prompt.page.uid}`, uid: st.prompt.page.uid, title: st.prompt.page.title };
    const row = st.phase === "OWNED" ? shown[st.active] : null;
    return row?.kind === "alias" || row?.kind === "ref" ? row : null;
  }
  function showPreview() {
    if (st.drill && setting("drillPreview") && st.pop) {
      cancelRowPreview();
      if (model?.drillKey !== st.drill.key) {
        model = previewModel(st.drill, tree.full, readableText, { hideEmpty: setting("drillEmpty"), images: setting("previewImages") });
        model.drillKey = st.drill.key;
      }
      const budgetMs = richBudget(1);
      if (inFrame) preview.show(model, st.pop, { avoid: st.ta?.getBoundingClientRect(), inFrame: true, budgetMs });
      else {
        preview.fill(model, st.pop, { budgetMs });
        redock = true;
        requestPlace();
      }
      if (preview.unfinished) scheduleRest(preview, () => Boolean(st.drill) && model?.drillKey === st.drill.key, "row");
      return;
    }
    const row = previewTarget();
    if (row && setting("rowPreview") && st.pop?.classList.contains(EXPANDED)) {
      if (rowPreviewKey === row.key) {
        if (model && !preview.node.hidden) {
          redock = true;
          requestPlace();
        }
        return;
      }
      cancelRowPreview();
      thumbs.cancel();
      if (model?.drillKey?.startsWith("row:") !== true) hidePreview();
      rowPreviewKey = row.key;
      scheduleRowPreview(row);
      return;
    }
    cancelRowPreview();
    hidePreview();
  }
  function scheduleRowPreview(row) {
    const run = () => {
      rowPreviewId = null;
      drawRowPreview(row);
    };
    rowPreviewId = typeof win.requestIdleCallback === "function" ? win.requestIdleCallback(run, { timeout: 150 }) : win.setTimeout(run, 50);
  }
  function drawRowPreview(row) {
    if (previewTarget()?.key !== row.key || !st.pop?.classList.contains(EXPANDED)) return;
    const t0 = performance.now();
    const elapsed = () => performance.now() - t0;
    let next = rowPreviewReady?.key === row.key ? rowPreviewReady.model : null;
    if (!next) {
      try {
        next = rowModel(row, tree.bounded(() => elapsed() > PREVIEW_SLICE_MS));
      } catch (error) {
        if (error !== PAUSE) throw error;
        previewSample("read", elapsed());
        scheduleRowPreview(row);
        return;
      }
      if (!next) {
        previewSample("read", elapsed());
        return;
      }
      if (elapsed() > PREVIEW_DRAW_ALONE_MS) {
        rowPreviewReady = { key: row.key, model: next };
        previewSample("read", elapsed());
        scheduleRowPreview(row);
        return;
      }
    }
    rowPreviewReady = null;
    model = next;
    preview.show(model, st.pop, {
      avoid: st.ta?.getBoundingClientRect(),
      onFrame: (ms) => previewSample("scroll", ms),
      lines: PREVIEW_FIRST_LINES,
      budgetMs: richBudget(Math.max(0.5, PREVIEW_SLICE_MS - elapsed()))
    });
    previewSample("draw", elapsed());
    if (preview.pending) scheduleRest(preview, () => previewTarget()?.key === row.key, "row");
  }
  const richBudget = (ms) => setting("richRows") ? ms : Infinity;
  function previewSample(kind, ms) {
    perf.push("preview", ms);
    perf.push(`preview.${kind}`, ms);
  }
  let scopeRestId = null;
  function scheduleRest(pane, current, slot) {
    if ((slot === "row" ? rowPreviewId : scopeRestId) != null) return;
    const set = (id) => {
      if (slot === "row") rowPreviewId = id;
      else scopeRestId = id;
    };
    const run = () => {
      set(null);
      if (!current() || !pane.unfinished) return;
      if (pane.pending) {
        const t0 = performance.now();
        pane.more(PREVIEW_FIRST_LINES, richBudget(PREVIEW_SLICE_MS));
        previewSample("rest", performance.now() - t0);
      }
      if (pane.unfinished) set(idle(run));
    };
    set(idle(run));
  }
  lifecycle.add(() => {
    if (scopeRestId != null) (win.cancelIdleCallback || win.clearTimeout).call(win, scopeRestId);
    scopeRestId = null;
  });
  const idle = (run) => typeof win.requestIdleCallback === "function" ? win.requestIdleCallback(run, { timeout: 300 }) : win.setTimeout(run, 60);
  function rowModel(row, read) {
    let page;
    let target = null;
    if (row.kind === "alias") page = { uid: row.uid, title: row.title };
    else {
      const first = read.trail(row.uid)[0];
      if (!first) return null;
      page = { uid: first.uid, title: first.title };
      target = tree.get(row.uid);
    }
    const next = previewModel({ page, target }, read, readableText, { hideEmpty: setting("drillEmpty"), images: setting("previewImages") });
    next.drillKey = `row:${row.key}`;
    return next;
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
      if (row.rich) text.append(richContent(row));
      else text.append(row.text);
      node.title = row.crumb ? `${row.crumb} › ${row.text}` : row.text;
    } else {
      if (row.rich) text.append(richContent(row));
      else if (row.parts) for (const part of row.parts) text.append(part.task ? checkbox(doc, part.task) : highlight(part.text));
      else text.append(highlight(row.text));
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
  let highlightFor = null;
  let highlightRe = null;
  function highlightPattern(query) {
    if (query !== highlightFor) {
      highlightFor = query;
      const words = (String(query ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1);
      highlightRe = words.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${words.map(escapeRe).join("|")})`, "giu") : null;
    }
    return highlightRe;
  }
  function richContent(row) {
    return renderParts(doc, snippet(row.rich, highlightPattern(st.token?.query)), (t) => highlight(t));
  }
  function highlight(text, query = st.token?.query) {
    const fragment = doc.createDocumentFragment();
    const re = highlightPattern(query);
    if (!re) {
      fragment.append(text);
      return fragment;
    }
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
    strip.classList.toggle(OWNING, st.phase === "OWNED");
    paintChips();
    paintContext();
    sizeStrip();
    layoutPop();
    showPreview();
  }
  const contextKnown = /* @__PURE__ */ new Map();
  let contextFor = null;
  let contextId = null;
  const contextAvailable = (row) => st.phase === "OWNED" && st.chip < 0 && !st.prompt && setting("refContext") && (row?.kind === "ref" || row?.kind === "drill");
  function paintContext() {
    const row = shown[st.active];
    if (!contextAvailable(row)) {
      contextFor = null;
      cancelContext();
      contextNode.remove();
      return;
    }
    const rowNode2 = strip.querySelectorAll(".burrow-row")[st.active];
    if (rowNode2 && contextNode.previousElementSibling !== rowNode2) rowNode2.after(contextNode);
    if (contextFor === row.key) return;
    contextFor = row.key;
    fillContext(row, contextKnown.get(row.uid));
    if (!contextKnown.has(row.uid)) scheduleContext(row);
  }
  function fillContext(row, known) {
    const trail = known?.trail ?? (row.page ? [row.page] : row.kind === "drill" && st.drill ? [st.drill.page.title] : []);
    const where = Object.assign(doc.createElement("span"), { className: "burrow-context-trail", textContent: trail.length ? `in ${trail.join(" › ")}` : "" });
    const parts = [where];
    if (known?.kids > 0 && (setting("tabDrill") || setting("refOutline"))) {
      const count = known.kids > CONTEXT_KIDS ? `${CONTEXT_KIDS}+` : String(known.kids);
      parts.push(Object.assign(doc.createElement("span"), { className: "burrow-context-kids", textContent: `⇥ ${count} ${known.kids === 1 ? "child" : "children"}` }));
    }
    contextNode.replaceChildren(...parts);
    contextNode.title = trail.length ? trail.join(" › ") : "";
  }
  function cancelContext() {
    if (contextId != null) {
      (win.cancelIdleCallback || win.clearTimeout).call(win, contextId);
      contextId = null;
    }
  }
  function scheduleContext(row) {
    cancelContext();
    const run = () => {
      contextId = null;
      if (contextFor !== row.key || !st.pop) return;
      const t0 = performance.now();
      contextKnown.set(row.uid, readContext(row.uid));
      perf.push("context", performance.now() - t0);
      fillContext(row, contextKnown.get(row.uid));
    };
    contextId = typeof win.requestIdleCallback === "function" ? win.requestIdleCallback(run, { timeout: 200 }) : win.setTimeout(run, 30);
  }
  function readContext(uid) {
    const chain = tree.trail(uid);
    const names = chain.map((n, i) => i === 0 ? n.title || readableText(n.string) : readableText(n.string) || "(empty)");
    const trail = names.length > 2 ? [names[0], "…", names[names.length - 1]] : names;
    perf.counters.contextPulls = (perf.counters.contextPulls || 0) + 2;
    const kids = api.pull(`[{(limit :block/children ${CONTEXT_KIDS + 1}) [:db/id]}]`, [":block/uid", uid])?.[":block/children"]?.length ?? 0;
    kidsKnown.set(uid, kids > 0);
    return { trail, kids };
  }
  let chipsFor = null;
  let chipsScrolled = false;
  let revealedChip = -1;
  const chipsAvailable = (row) => st.phase === "OWNED" && setting("aliasChips") && row?.kind === "alias" && row.aliases.length > 1;
  function paintChips() {
    const row = shown[st.active];
    const show = chipsAvailable(row);
    if (!show) {
      st.chip = -1;
      chipsFor = null;
      chipsNode.scrollLeft = 0;
      chipsScrolled = false;
      revealedChip = -1;
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
          chipsNode.scrollLeft = 0;
          chipsScrolled = false;
          revealedChip = -1;
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
  }
  function revealChip() {
    if (st.prompt?.kind === "delete") return;
    if (st.chip === revealedChip) return;
    revealedChip = st.chip;
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
  const listColumn = (pop) => pop.querySelector(":scope > .rm-autocomplete__results-main") || pop;
  function placeInFlow() {
    const pop = st.pop;
    if (!pop?.isConnected) return;
    const column = listColumn(pop);
    const list = column.querySelector(":scope > .rm-autocomplete__results-scroll");
    const before = list || column.firstChild;
    if (strip.parentNode !== column || before && strip.nextSibling !== before && before !== strip) column.insertBefore(strip, before === strip ? strip.nextSibling : before);
    if (hints.parentNode !== column || column.lastChild !== hints) column.append(hints);
  }
  function sampleTheme(pop) {
    const cs = win.getComputedStyle(pop);
    strip.style.setProperty("--burrow-bg", cs.backgroundColor);
    strip.style.setProperty("--burrow-fg", cs.color);
    strip.style.zIndex = String((Number.parseInt(cs.zIndex, 10) || 20) + 1);
    const firstRow = pop.querySelector(`${NATIVE_ROWS} .rm-autocomplete-result`);
    strip.style.font = firstRow ? win.getComputedStyle(firstRow).font : cs.font;
    const activeRow = [...pop.querySelectorAll(NATIVE_ROWS)].find((row) => row.style.backgroundColor);
    const active = activeRow ? win.getComputedStyle(activeRow).backgroundColor : null;
    if (active && !/^(transparent|rgba\(.*,\s*0\))$/.test(active)) strip.style.setProperty("--burrow-active", active);
    else if (!activeRow) strip.style.removeProperty("--burrow-active");
    const dark = isDarkHost(doc);
    strip.classList.toggle("burrow-dark", dark);
    colorsStale(dark);
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
      p.node.classList.toggle("burrow-tips", Boolean(setting("helpTips")));
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
    strip.classList.remove(OWNING);
    chipsNode.remove();
    chipsFor = null;
    contextNode.remove();
    contextFor = null;
    cancelContext();
    cancelRowPreview();
    hidePreview();
    st.pop?.classList.remove(DRILL_CLASS);
  }
  function clearPopover() {
    strip.remove();
    hints.remove();
    if (!st.pop) return;
    if (lifted) st.pop.style.marginBottom = "";
    lifted = 0;
    st.pop.classList.remove(...POP_CLASSES);
    for (const node of st.pop.querySelectorAll(`[${FOLDED}]`)) node.removeAttribute(FOLDED);
  }
  function hideStrip() {
    scopePanel.hide();
    scopePreview.hide();
    strip.hidden = true;
    strip.classList.remove(OWNING);
    chipsNode.remove();
    chipsFor = null;
    contextNode.remove();
    contextFor = null;
    cancelContext();
    hints.hidden = true;
    cancelRowPreview();
    hidePreview();
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
      wantFold = false;
      wantLayout = false;
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
    wantFold = items.length > 0 && visible === 0;
    wantLayout = setting("paneLayout") && visible > 0;
    pop.classList.toggle(FOLD_ALIASES, wantFold);
    pop.classList.toggle(LAYOUT, wantLayout);
  }
  let wantFold = false;
  let wantLayout = false;
  function reassertClasses(pop) {
    const want = [];
    if (st.phase === "SCOPE") want.push(SCOPE_OPEN);
    if (st.help) want.push(HELP_OPEN);
    if (wantFold) want.push(FOLD_ALIASES);
    if (wantLayout) want.push(LAYOUT);
    if (preview.drills(pop)) want.push(DRILL_CLASS);
    for (const cls of want) if (!pop.classList.contains(cls)) pop.classList.add(cls);
  }
  function hintList() {
    if (st.phase === "SCOPE" || !st.token) return [];
    const row = st.phase === "OWNED" ? shown[st.active] : null;
    const kind = st.token.kind;
    const aliasNew = (page) => Boolean(page) && setting("aliasCreate") && kind === "[[";
    const canDrill = (source) => Boolean(source) && (setting("tabDrill") || setting("drill")) && hasKids(source.uid);
    const state = {
      kind,
      prompt: st.prompt?.kind ?? null,
      chips: Boolean(row) && chipsAvailable(row) && st.chip >= 0,
      row: row ? {
        kind: row.kind,
        chips: chipsAvailable(row),
        aliasNew: aliasNew(row.kind === "alias"),
        drill: canDrill(ownedSource(row, st.chip)),
        block: Boolean(ownedSource(row, -1)?.block)
      } : null,
      native: !row && kind === "[[" ? (() => {
        const source = armedSource();
        return source ? { drill: canDrill(source), aliasNew: aliasNew(source) } : null;
      })() : null,
      rowsAbove: !row && shown.length > 0 && !strip.hidden && nativeActiveIsFirst(),
      on: { tabDrill: setting("tabDrill"), drill: setting("drill"), aliasDelete: setting("aliasDelete"), pageOnly: setting("aliasLinkFormat") === "[[Page]]", refOutline: setting("refOutline") }
    };
    return pickerHints(state);
  }
  let nudgeShown = false;
  let nudgeDone = false;
  const nudgeWanted = () => !nudgeDone && setting("helpSheet") && setting("helpNudge") && !setting("helpNudgeSeen");
  function nudgeSeen() {
    nudgeShown = false;
    if (nudgeDone || setting("helpNudgeSeen")) {
      nudgeDone = true;
      return;
    }
    nudgeDone = true;
    void Promise.resolve(saveSetting?.("helpNudgeSeen", true)).catch((error) => console.error("[burrow] could not save the tip as seen", error));
  }
  function paintHelpButton(nudge) {
    const want = !setting("helpSheet") ? "" : nudge ? "nudge" : "help";
    if (helpButton.dataset.mode === want) return;
    helpButton.dataset.mode = want;
    helpButton.hidden = !want;
    helpButton.classList.toggle("burrow-nudge", want === "nudge");
    const altSlash = keyLabel("altSlash");
    helpButton.setAttribute("aria-label", `Burrow keys (${altSlash})`);
    if (want === "nudge") {
      helpButton.replaceChildren(`${altSlash} all keys`, Object.assign(doc.createElement("span"), { className: "burrow-nudge-close", textContent: "✕" }));
    } else helpButton.textContent = want ? "?" : "";
  }
  let hintsFor = null;
  function layoutPop() {
    const pop = st.pop;
    if (!pop) return;
    const list = setting("keyHints") ? hintList() : [];
    const line = setting("keyHints") && st.phase !== "SCOPE" && !st.help && Boolean(st.token);
    if (!line) {
      hints.hidden = true;
      hintsFor = null;
    } else {
      const nudge = nudgeWanted();
      if (nudge) nudgeShown = true;
      const key = `${hintsKey(list)}${nudge}`;
      if (key !== hintsFor) {
        hintsFor = key;
        hintItems = list;
        renderHints(doc, hintsList, list);
      }
      paintHelpButton(nudge);
      hints.hidden = false;
    }
  }
  let inFrame = false;
  let placeId = null;
  let redock = false;
  function hidePreview() {
    redock = false;
    preview.hide();
  }
  const inFrameDo = (fn) => {
    inFrame = true;
    try {
      fn();
    } finally {
      inFrame = false;
    }
  };
  function requestPlace() {
    if (inFrame) {
      placePanes();
      return;
    }
    if (placeId != null) return;
    placeId = win.requestAnimationFrame(() => {
      placeId = null;
      inFrameDo(placePanes);
    });
  }
  lifecycle.add(() => {
    if (placeId != null) win.cancelAnimationFrame(placeId);
    placeId = null;
  });
  let lifted = 0;
  let liftId = null;
  function liftPop() {
    if (!inFrame) {
      if (liftId != null) return;
      liftId = win.requestAnimationFrame(() => {
        liftId = null;
        inFrameDo(liftPop);
      });
      return;
    }
    const pop = st.pop;
    const ta = st.ta;
    if (!pop?.isConnected || !ta) return;
    let lift = 0;
    if (pop.style.bottom === "0px") {
      const p = pop.getBoundingClientRect();
      const t = ta.getBoundingClientRect();
      const textTop = t.top + (parseFloat(win.getComputedStyle(ta).paddingTop) || 0);
      const top = p.top + lifted;
      const over = p.bottom + lifted - textTop;
      if (top < textTop && over > 0) lift = Math.max(0, Math.round(Math.min(over, top)));
    }
    if (lift === lifted) return;
    pop.style.marginBottom = lift ? `${lift}px` : "";
    lifted = lift;
  }
  lifecycle.add(() => {
    if (liftId != null) win.cancelAnimationFrame(liftId);
    liftId = null;
  });
  function placePanes() {
    const pop = st.pop;
    if (!pop?.isConnected) return;
    if (!redock) return;
    const t0 = performance.now();
    redock = false;
    if (model) preview.show(model, pop, { avoid: st.ta?.getBoundingClientRect(), inFrame: true });
    perf.push("place", performance.now() - t0);
  }
  let hintItems = [];
  function openHelp() {
    if (!st.pop || !setting("helpSheet")) return false;
    st.help = true;
    tips.hide();
    if (nudgeShown || nudgeWanted()) nudgeSeen();
    const covered = st.phase === "SCOPE" ? scopePanel.node : st.pop;
    const anchor = covered.getBoundingClientRect();
    for (const node of [strip, hints, preview.node, scopePreview.node, scopePanel.node]) node.classList.add("burrow-help-covered");
    st.pop.classList.add(HELP_OPEN);
    sampleSheet();
    sheet.show(helpGroups(setting), keyLabel("altSlash"), anchor, st.ta?.getBoundingClientRect());
    trace({ ev: "help-open" });
    return true;
  }
  function closeHelp() {
    if (!st.help) return;
    st.help = false;
    sheet.hide();
    for (const node of [strip, hints, preview.node, scopePreview.node, scopePanel.node]) node.classList.remove("burrow-help-covered");
    st.pop?.classList.remove(HELP_OPEN);
    trace({ ev: "help-close" });
    hintsFor = null;
    if (st.phase === "SCOPE") placeScope();
    else frame();
  }
  function sampleSheet() {
    for (const name of ["--burrow-bg", "--burrow-fg", "--burrow-active", "--burrow-footer-bg", "--burrow-footer-fg"]) {
      const value = (name.includes("footer") ? hints : strip).style.getPropertyValue(name);
      if (value) sheet.node.style.setProperty(name, value);
      else sheet.node.style.removeProperty(name);
    }
    sheet.node.style.zIndex = strip.style.zIndex;
    sheet.node.style.font = strip.style.font;
    sheet.node.classList.toggle("burrow-dark", strip.classList.contains("burrow-dark"));
  }
  function helpKey(event) {
    const action = helpKeyAction(event);
    if (action === "keep") return true;
    if (action === "close") consume(event);
    closeHelp();
    return action === "close";
  }
  function onHintsMouseDown(event) {
    event.preventDefault();
    event.stopPropagation();
  }
  function onHelpClick(event) {
    if (!event.target.closest?.(".burrow-help-button")) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.target.closest?.(".burrow-nudge-close")) {
      nudgeSeen();
      hintsFor = null;
      layoutPop();
      return;
    }
    if (st.help) closeHelp();
    else openHelp();
  }
  function attach(pop) {
    if (st.pop === pop) return;
    detach();
    st.pop = pop;
    sampleTheme(pop);
    if (st.phase === "SCOPE") pop.classList.add(SCOPE_OPEN);
    if (st.help) pop.classList.add(HELP_OPEN);
    const ours = (node) => node === strip || node === hints || strip.contains(node) || hints.contains(node);
    const mo = new MutationObserver((records) => {
      if (st.pop !== pop || st.phase === "IDLE") return;
      let roam = false;
      for (const r of records) {
        if (r.type === "attributes" && r.attributeName === "class") {
          if (r.target === pop) reassertClasses(pop);
          continue;
        }
        if (ours(r.target)) continue;
        if (r.type === "childList" && [...r.addedNodes, ...r.removedNodes].every(ours)) continue;
        roam = true;
      }
      if (roam) frame();
    });
    mo.observe(pop, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    const gone = new MutationObserver(() => {
      if (pop.isConnected || st.pop !== pop) return;
      if (doc.activeElement === st.ta && doc.querySelector(POPUP2)) {
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
    hidePreview();
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
      if (frameQueued) inFrameDo(draw);
    });
  }
  function draw() {
    frameQueued = false;
    if (st.phase === "IDLE" && !st.rows.length) return;
    const pop = st.pop?.isConnected ? st.pop : doc.querySelector(POPUP2);
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
  function stale(ta) {
    const token = st.token;
    if (!token) return false;
    return ta.selectionStart !== ta.selectionEnd || ta.selectionStart !== token.caret || ta.value.slice(token.start, token.caret) !== token.kind + token.query;
  }
  function refused() {
    trace({ ev: "refused" });
    if (st.phase === "SCOPE") exitScope();
    const ta = st.ta;
    if (ta?.isConnected && doc.activeElement === ta) {
      evaluate(ta);
      if (frameQueued) inFrameDo(draw);
    } else reset("commit-refused");
  }
  function reset(reason) {
    if (st.phase !== "IDLE" || st.rows.length) trace({ ev: "reset", reason });
    closeHelp();
    tips.hide();
    if (nudgeShown) nudgeSeen();
    nudgeDone = false;
    kidsKnown.clear();
    contextKnown.clear();
    contextFor = null;
    cancelContext();
    st.phase = "IDLE";
    st.rows = [];
    st.active = -1;
    st.token = null;
    st.released = null;
    st.drill = null;
    st.auto = false;
    st.chip = -1;
    st.scope = null;
    if (st.prompt?.compose) composer.restore(st.prompt, st.ta);
    st.prompt = null;
    promptRows = [];
    cancelRowPreview();
    thumbs.clear();
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
    if (st.prompt && (composer.input(event) || composer.stray(event))) return;
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
    if (tips.visible) tips.hide();
    if (pendingTa && (ACTION_KEYS.has(event.key) || event.altKey) && event.target === pendingTa) flush();
    if (st.phase === "IDLE") return;
    if (st.help && event.target === st.ta && helpKey(event)) return;
    if (st.phase === "OWNED" && event.target === st.ta && (ACTION_KEYS.has(event.key) || event.altKey) && stale(st.ta)) {
      trace({ ev: "stale-key", key: event.key });
      evaluate(st.ta);
      if (frameQueued) inFrameDo(draw);
      if (event.key === "Enter" || event.key === "Tab") {
        consume(event);
        return;
      }
      if (st.phase === "IDLE") return;
    }
    if (isHelpKey(event) && setting("helpSheet") && event.target === st.ta && !event.isComposing && !st.composing && !st.prompt?.compose) {
      if (openHelp()) {
        consume(event);
        return;
      }
    }
    if (st.prompt && composer.key(event)) return;
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
    if (event.shiftKey && key === "Tab" && setting("refOutline") && outlineUp(shown[st.active], event)) return;
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
        consume(event);
        if (!row || !commit(row)) refused();
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
      consume(event);
      if (!commit(chipRow(row, st.chip))) refused();
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
    const ta = st.ta;
    st.prompt = {
      kind: "add",
      page,
      text: st.token.query.trim(),
      fresh: true,
      saving: false,
      error: null,
      block: { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd }
    };
    st.auto = false;
    st.chip = -1;
    trace({ ev: "prompt", uid: page.uid });
    promptRows = shown.slice();
    render();
  }
  let promptRows = [];
  const promptNode = doc.createElement("div");
  promptNode.className = "burrow-row burrow-prompt";
  const composer = createPromptComposer({
    prompt: () => st.prompt,
    textarea: () => st.ta,
    setValue: (ta, value) => valueSetter.call(ta, value),
    render: () => renderPrompt()
  });
  function renderPrompt() {
    const p = st.prompt;
    const input = Object.assign(doc.createElement("span"), { className: "burrow-prompt-input", textContent: p.saving ? `${p.text} …` : p.text });
    input.classList.toggle("burrow-fresh", p.fresh && Boolean(p.text));
    if (p.compose?.text) input.append(Object.assign(doc.createElement("span"), { className: "burrow-prompt-compose", textContent: p.compose.text }));
    promptNode.replaceChildren(Object.assign(doc.createElement("span"), { className: "burrow-prompt-label", textContent: `alias for ${p.page.title}:` }), input);
    if (p.error) promptNode.append(Object.assign(doc.createElement("span"), { className: "burrow-prompt-error", textContent: p.error, title: p.error }));
    if (strip.firstChild !== promptNode || strip.childNodes.length !== 1) strip.replaceChildren(promptNode);
    sizeStrip(0);
    shown = [];
    shownQuery = null;
    chipsFor = null;
    chipsNode.remove();
    strip.hidden = false;
    syncPanes(promptRows);
    layoutPop();
    showPreview();
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
      promptRows = [];
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
    composer.restore(p, st.ta);
    st.prompt = null;
    promptRows = [];
    debug.lastWrite = { kind: "add", at: Date.now(), ...result };
    trace({ ev: "alias-added", uid: p.page.uid, block: result.blockUid });
    indexes.refreshAliases?.();
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
    indexes.refreshAliases?.();
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
  function onStripWheel(event) {
    const overChips = chipsNode.isConnected && chipsNode.contains(event.target);
    const list = st.pop?.querySelector(".rm-autocomplete__results-scroll");
    const plan = wheelPlan(
      event,
      overChips ? { left: chipsNode.scrollLeft, max: chipsNode.scrollWidth - chipsNode.clientWidth } : null,
      list ? { top: list.scrollTop, max: list.scrollHeight - list.clientHeight } : null
    );
    trace({ ev: "wheel", to: plan.to });
    if (plan.to === "chips") {
      chipsNode.scrollLeft = plan.left;
      event.preventDefault();
    } else if (plan.to === "list") {
      list.scrollTop += plan.by;
      event.preventDefault();
    }
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
    if (row.kind === "ref") return { uid: row.uid, label: row.text, page: null, insertion: row.insertion, block: true };
    if (row.kind === "drill" && st.drill) {
      const block = row.uid !== st.drill.page.uid;
      return { uid: row.uid, label: row.text, page: st.drill.page, insertion: row.insertion, block };
    }
    return null;
  }
  function outlineLevels(uid, label, self) {
    const chain = tree.trail(uid);
    if (!chain.length || chain[0].title == null) return null;
    const page = { uid: chain[0].uid, title: chain[0].title };
    const path = [...chain.map((n) => n.uid), uid];
    const nodes = self ? [...chain, { uid, label }] : chain;
    const limit = setting("drillCap") ? CAP : Infinity;
    return nodes.map((n, i) => ({
      uid: n.uid,
      page,
      isPage: i === 0,
      query: "",
      active: null,
      activeUid: path[i + 1] ?? null,
      limit,
      label: i === 0 ? page.title : n.label ?? (readableText(n.string) || "(empty)"),
      insertion: i === 0 ? `[[${page.title}]]` : `((${n.uid}))`
    }));
  }
  function outlineUp(row, event) {
    if (row?.kind !== "ref" && row?.kind !== "drill") return false;
    const source = ownedSource(row, -1);
    if (!source?.block) return false;
    const levels = outlineLevels(row.uid, row.text, false);
    return Boolean(levels) && enterScope(source, event, levels);
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
  function enterScope(source, event, up = null) {
    const ta = st.ta;
    if (!source || !st.pop || st.composing || event.target !== ta) return false;
    if (!tokenStillValid(ta.value, ta.selectionStart, ta.selectionEnd, st.token)) return false;
    if (!up && !tree.children(source.uid).length) return false;
    const levels = up || source.block && setting("refOutline") && outlineLevels(source.uid, source.label, true) || [{ ...source, isPage: !source.block, query: "", active: 0, limit: setting("drillCap") ? CAP : Infinity }];
    st.scope = {
      rootLabel: st.token.kind === "[[" ? "Pages" : "Blocks",
      levels,
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
    strip.classList.remove(OWNING);
    chipsNode.remove();
    contextNode.remove();
    contextFor = null;
    cancelRowPreview();
    hidePreview();
    st.pop.classList.remove(DRILL_CLASS);
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
    const on = !level.query && level.activeUid && (keepActive ? level.active == null : true) ? st.scope.all.findIndex((row) => row.uid === level.activeUid) : -1;
    if (on >= 0 && level.limit !== Infinity) level.limit = Math.max(level.limit, Math.ceil((on + 1) / CAP) * CAP);
    st.scope.rows = capRows(st.scope.all, level.limit);
    if (on >= 0) level.active = on;
    else if (keepActive && level.active != null) level.active = Math.min(level.active, Math.max(0, st.scope.rows.length - 1));
    else level.active = level.query ? 0 : firstReal(st.scope.rows);
    scopePanel.show(st.scope, setting("keyHints"), setting("helpSheet"));
    placeScope();
  }
  function scopeMore() {
    const level = scopeLevel();
    const at = level.limit;
    level.limit += CAP;
    st.scope.rows = capRows(st.scope.all, level.limit);
    level.active = Math.min(at, st.scope.rows.length - 1);
    scopePanel.show(st.scope, setting("keyHints"), setting("helpSheet"));
    placeScope();
  }
  let scopeModel = null;
  function placeScope() {
    const scope = st.scope;
    const pop = st.pop;
    if (!scope || !pop) return;
    pop.classList.add(SCOPE_OPEN);
    liftPop();
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
      scopeModel = previewModel({ page, target }, tree.full, readableText, { hideEmpty: setting("drillEmpty"), images: setting("previewImages") });
      scopeModel.drillKey = key;
    }
    scopePreview.show(scopeModel, st.pop, { beside: scopePanel.node.getBoundingClientRect(), avoid: st.ta.getBoundingClientRect(), budgetMs: richBudget(1) });
    if (scopePreview.unfinished) scheduleRest(scopePreview, () => st.phase === "SCOPE" && Boolean(st.scope?.preview), "scope");
  }
  function scopeMove(delta) {
    perf.time("scope.key", () => {
      const level = scopeLevel();
      level.active = Math.max(0, Math.min(Math.max(0, st.scope.rows.length - 1), level.active + delta));
      scopePanel.paintActive(st.scope, setting("keyHints"), setting("helpSheet"));
      showScopePreview();
    });
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
      consume(event);
      if (!scopeCommit()) refused();
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
    if (event.target.closest?.(".burrow-help-button")) return;
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
    if (st.prompt && composer.start(event)) return;
    st.composing = true;
    pendingTa = null;
    reset("composition");
  }
  function onCompositionEnd(event) {
    if (!isBlockInput(event.target)) return;
    if (st.prompt && composer.end(event)) return;
    st.composing = false;
    if (anyFeature()) evaluate(event.target);
  }
  function onFocusOut(event) {
    if (event.target !== st.ta) return;
    win.setTimeout(() => {
      if (st.ta && doc.activeElement !== st.ta) reset("blur");
    }, 0);
  }
  const guardedTip = (resolve) => (target) => {
    try {
      return resolve(target);
    } catch (error) {
      console.error("[burrow] tip failed", error);
      return null;
    }
  };
  const drillLine = (uid, what) => setting("tabDrill") && hasKids(uid) ? ["⇥", what] : null;
  function stripTip(target) {
    const chip = target.closest?.(".burrow-chip");
    const active = shown[st.active];
    if (chip && active?.kind === "alias") {
      const i = Number(chip.dataset.index);
      return { el: chip, title: active.aliases[i], lines: [
        ["↵", `or click: insert ${chipRow(active, i).insertion}`],
        ["←→", "move between the aliases"],
        setting("aliasDelete") ? [keyLabel("altBackspace"), "delete the selected alias (asks first)"] : null
      ].filter(Boolean) };
    }
    const promptRow = target.closest?.(".burrow-prompt");
    if (promptRow && st.prompt?.kind === "add") {
      return { el: promptRow, title: `New alias for ${st.prompt.page.title}`, lines: [["↵", "add it to the page's Aliases:: block, then insert it"], ["esc", "cancel; nothing is written"]] };
    }
    const where = target.closest?.(".burrow-context");
    if (where) {
      return { el: where, title: where.title || null, lines: [
        ["", "where the highlighted block lives: its page and parent"],
        setting("tabDrill") ? ["⇥", "list the children of this block"] : null,
        setting("refOutline") ? ["⇧⇥", "go up to its parent"] : null
      ].filter(Boolean) };
    }
    const confirm = target.closest?.(".burrow-chips.burrow-confirm");
    if (confirm) return { el: confirm, title: null, lines: [["↵", "delete this alias from the page"], ["esc", "keep it"]] };
    const node = target.closest?.(".burrow-row");
    const row = node ? shown[Number(node.dataset.index)] : null;
    if (!row) return null;
    if (row.kind === "alias") {
      return { el: node, title: `${row.alias} ↳ ${row.title}`, lines: [
        ["↵", `or click: insert ${row.insertion}`],
        setting("aliasChips") && row.aliases.length > 1 ? [keyLabel("altDown"), `pick one of its ${row.aliases.length} aliases`] : null,
        drillLine(row.uid, "list the blocks on this page"),
        setting("aliasCreate") ? [keyLabel("altA"), "add an alias to this page"] : null
      ].filter(Boolean) };
    }
    const upLine = setting("refOutline") ? ["⇧⇥", "go up to its parent (the parent's children, this block highlighted)"] : null;
    if (row.kind === "ref") {
      return { el: node, title: row.text, lines: [
        ["↵", `or click: insert ((${row.uid}))`],
        ["", `${row.refs} block${row.refs === 1 ? "" : "s"} reference it`],
        drillLine(row.uid, "list the children of this block"),
        upLine
      ].filter(Boolean) };
    }
    return { el: node, title: row.crumb ? `${row.crumb} › ${row.text}` : row.text, lines: [
      ["↵", "insert the block the drill-down reaches"],
      drillLine(row.uid, "list the children of this block"),
      ownedSource(row, -1)?.block ? upLine : null
    ].filter(Boolean) };
  }
  function hintTip(target) {
    if (target.closest?.(".burrow-help-button")) {
      const lines = [[keyLabel("altSlash"), "or click: every key Burrow adds, for the switches that are on"]];
      if (helpButton.dataset.mode === "nudge") lines.push(["✕", "hide this line; ? stays"]);
      return { el: helpButton, title: "Burrow keys", lines };
    }
    const item = target.closest?.(".burrow-hint");
    const hint = item ? hintItems[Number(item.dataset.hint)] : null;
    return hint ? { el: item, title: null, lines: [[hint[0], hint[2] || hint[1]]] } : null;
  }
  function scopeTip(target) {
    if (target.closest?.(".burrow-help-button")) return { el: target.closest(".burrow-help-button"), title: "Burrow keys", lines: [[keyLabel("altSlash"), "or click: every key Burrow adds"]] };
    const crumb = target.closest?.(".burrow-crumb");
    if (crumb) return { el: crumb, title: crumb.textContent, lines: [["click", crumb.dataset.level == null ? "back to the results" : "back to this level"]] };
    const item = target.closest?.(".burrow-hint");
    const hint = item ? scopePanel.hintItems[Number(item.dataset.hint)] : null;
    if (hint) return { el: item, title: null, lines: [[hint[0], hint[2] || hint[1]]] };
    const node = target.closest?.(".burrow-row");
    const row = node && st.scope ? st.scope.rows[Number(node.dataset.index)] : null;
    if (!node || !st.scope) return null;
    if (!row) return { el: node, title: scopeLevel().label, lines: [["↵", "insert this level"]] };
    if (row.more != null) return { el: node, title: `${row.more} more blocks`, lines: [["↵", "or click: list the next 50"]] };
    return { el: node, title: row.text || "(empty)", lines: [
      row.empty && row.drillable ? ["↵", "or click: go into it"] : ["↵", `or click: insert ((${row.uid}))`],
      row.drillable ? ["⇥ or >", "go into it"] : null
    ].filter(Boolean) };
  }
  function previewTip(target, pane) {
    const node = target.closest?.(".burrow-preview");
    if (!node) return null;
    const trail = [...node.querySelectorAll(".burrow-trail .burrow-crumb")].map((n) => n.textContent).join(" › ");
    if (pane === scopePreview) return { el: node, title: trail, lines: [[keyLabel("ctrlO"), "show or hide this preview"], ["", "read-only; the highlighted line is the selected block"]] };
    if (st.drill) return { el: node, title: trail, lines: [["↵", "insert the highlighted block"], ["", "read-only; follows what you type after # and >"]] };
    return { el: node, title: trail, lines: [[keyLabel("ctrlO"), "close Roam's preview (and this one)"], ["", "read-only preview of the highlighted Burrow row: its page, or the block among its siblings; Tab lists what is under it"]] };
  }
  const guarded = (name, handler) => (event) => {
    const held = name === "keydown" && (st.phase === "OWNED" || st.phase === "SCOPE" || Boolean(st.prompt)) && (event.key === "Enter" || event.key === "Tab");
    try {
      handler(event);
    } catch (error) {
      debug.lastFailure = { reason: `throw:${name}`, at: Date.now(), message: String(error?.message || error) };
      console.error(`[burrow] ${name} failed; falling back to Roam`, error);
      if (held) consume(event);
      try {
        reset("error");
      } catch {
      }
    }
  };
  function onSelectionChange() {
    const ta = st.ta;
    if (!ta || st.prompt || doc.activeElement !== ta || !anyFeature()) return;
    if (st.phase === "IDLE") {
      if (pendingTa == null && doc.querySelector(POPUP2)) scheduleEvaluate(ta);
      return;
    }
    if (stale(ta)) {
      if (st.phase === "SCOPE") exitScope();
      scheduleEvaluate(ta);
    }
  }
  let lastPointer = null;
  function onStripMouseMove(event) {
    const at = `${event.clientX},${event.clientY}`;
    if (at === lastPointer) return;
    lastPointer = at;
    if (st.prompt || st.help || st.phase !== "ARMED" && st.phase !== "OWNED") return;
    const node = event.target.closest?.(".burrow-row");
    if (!node || !strip.contains(node)) return;
    const index = Number(node.dataset.index);
    if (!shown[index] || st.phase === "OWNED" && st.active === index) return;
    if (st.phase === "OWNED" && st.chip >= 0) st.chip = -1;
    own(index);
    st.auto = false;
    paintActive();
  }
  function onScopeMouseMove(event) {
    const at = `${event.clientX},${event.clientY}`;
    if (at === lastPointer) return;
    lastPointer = at;
    if (st.phase !== "SCOPE" || !st.scope) return;
    const node = event.target.closest?.(".burrow-scope-list .burrow-row");
    if (!node) return;
    const index = Number(node.dataset.index);
    const level = scopeLevel();
    if (!st.scope.rows[index] || level.active === index) return;
    level.active = index;
    scopePanel.paintActive(st.scope, setting("keyHints"), setting("helpSheet"), false);
    showScopePreview();
  }
  lifecycle.event(win, "keydown", guarded("keydown", onKeyDown), true);
  lifecycle.event(doc, "selectionchange", guarded("selectionchange", onSelectionChange));
  lifecycle.event(strip, "mousemove", guarded("mousemove", onStripMouseMove));
  lifecycle.event(win, "input", guarded("input", onInput), true);
  lifecycle.event(win, "compositionstart", guarded("compositionstart", onCompositionStart), true);
  lifecycle.event(win, "compositionupdate", guarded("compositionupdate", (event) => {
    if (st.prompt) composer.update(event);
  }), true);
  lifecycle.event(win, "compositionend", guarded("compositionend", onCompositionEnd), true);
  lifecycle.event(win, "beforeinput", guarded("beforeinput", (event) => {
    if (st.prompt && !composer.input(event)) composer.insert(event);
  }), true);
  lifecycle.event(win, "keyup", guarded("keyup", (event) => {
    if (st.prompt) composer.key(event);
  }), true);
  lifecycle.event(doc, "focusout", guarded("focusout", onFocusOut), true);
  lifecycle.event(win, "paste", guarded("paste", onPaste), true);
  lifecycle.event(strip, "wheel", guarded("wheel", onStripWheel), { passive: false });
  lifecycle.event(chipsNode, "scroll", () => {
    chipsScrolled = chipsNode.scrollLeft > 0;
  }, { passive: true });
  lifecycle.event(strip, "mousedown", guarded("mousedown", onStripMouseDown));
  lifecycle.event(hints, "mousedown", guarded("mousedown", onHintsMouseDown));
  lifecycle.event(hints, "click", guarded("click", onHelpClick));
  lifecycle.event(scopePanel.node, "click", guarded("click", onHelpClick));
  lifecycle.event(sheet.node, "mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  for (const p of [preview, scopePreview]) lifecycle.event(p.node, "mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  tips.attach(strip, guardedTip(stripTip));
  tips.attach(hints, guardedTip(hintTip));
  tips.attach(scopePanel.node, guardedTip(scopeTip));
  for (const p of [preview, scopePreview]) tips.attach(p.node, guardedTip((target) => previewTip(target, p)));
  const unlisten = indexes.listen?.(() => {
    if (!st.ta || !st.token || st.phase === "IDLE" || st.phase === "SCOPE" || st.prompt || st.help || st.chip >= 0) return;
    if (st.phase === "OWNED" && !st.auto) return;
    if (doc.activeElement === st.ta) scheduleEvaluate(st.ta);
  });
  if (unlisten) lifecycle.add(unlisten);
  lifecycle.event(scopePanel.node, "mousedown", guarded("mousedown", onScopeMouseDown));
  lifecycle.event(scopePanel.node, "mousemove", guarded("mousemove", onScopeMouseMove));
  lifecycle.add(() => reset("unload"));
  return { state: st, debug, reset, tree };
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/extension.js
var VERSION = "0.8.3";
var activeLifecycle = null;
var FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pickMemory", "pageBoost", "aliasInline", "aliasPreselect", "aliasChips", "tabDrill", "paneLayout", "keyHints", "rowPreview", "previewImages", "aliasCreate", "aliasDelete", "drillOrdinals", "drillEmpty", "drillCap", "refSearch", "refSearchHotkey", "helpTips", "helpSheet", "helpNudge", "refContext", "refOutline"];
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
var LIVE = "__burrowLive";
async function disposePrevious() {
  const win = globalThis.window;
  const prior = win?.[LIVE];
  if (!prior || win.__burrowParked) return;
  win[LIVE] = null;
  try {
    await prior.dispose();
  } catch (error) {
    console.error("[burrow] could not unload the previous instance", error);
  }
}
async function onload({ extensionAPI, extension }) {
  if (!extensionAPI) throw new TypeError("Roam did not provide extensionAPI");
  if (activeLifecycle) await activeLifecycle.dispose();
  await disposePrevious();
  const lifecycle = createLifecycle();
  activeLifecycle = lifecycle;
  if (globalThis.window) {
    globalThis.window[LIVE] = lifecycle;
    lifecycle.add(() => {
      if (globalThis.window[LIVE] === lifecycle) globalThis.window[LIVE] = null;
    });
  }
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
      indexes = createIndexes({ api, perf, setting, idle: idleScheduler(lifecycle), lifecycle, win: globalThis.window });
      const picks = createPickMemory({ storage: safeLocalStorage(), key: `burrow:picks:${api.graph?.name ?? "graph"}` });
      const strip = createStrip({ setting, indexes, perf, lifecycle, api, picks, saveSetting: (id, value) => extensionAPI.settings.set(id, value) });
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
