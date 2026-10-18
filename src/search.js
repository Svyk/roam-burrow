// Search scorer ported from Svyk/thymer-reference-extravaganza v4.64.1 (MIT,
// plugin.js _searchKey / _searchPlan / _searchStrictScoreFromKey /
// _searchMatchFromKey). Behaviour is kept; the class methods became functions.

const NUM_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

const ABBREV_FORWARD = {
  s: ["season", "series"], e: ["episode"], ep: ["episode"],
  v: ["volume", "version"], vol: ["volume"], q: ["quarter"],
  w: ["week"], wk: ["week"], ch: ["chapter"], pt: ["part"],
  no: ["number"], vs: ["versus"],
};
const ABBREV_REVERSE = new Map();
for (const [key, vals] of Object.entries(ABBREV_FORWARD)) {
  for (const word of vals) ABBREV_REVERSE.set(word, key);
}

// Roam markup removed before keying, so `[[Ant-Man]]`, `**bold**` and
// `Attr:: value` key on their visible words.
export function stripRoamMarkup(value) {
  return String(value == null ? "" : value)
    .replace(/^\s*([^:\n`]{1,80})::\s*/, "$1 ")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/\(\(([^()]*)\)\)/g, " ")
    .replace(/\[([^\]]*)\]\(\[\[([^\]]*)\]\]\)/g, "$1 $2")
    .replace(/\[\[|\]\]|#\[\[|\*\*|\^\^|__|~~/g, " ")
    .replace(/(^|\s)#(?=\S)/g, "$1");
}

// "EMP 26" finds "EMP26-002-BHP", "ant man" finds "Ant-Man": letter/number
// boundaries and punctuation split tokens; `compact` drops every separator.
export function searchKey(value) {
  let raw = String(value == null ? "" : value).toLowerCase();
  try { raw = raw.normalize("NFKD").replace(/[̀-ͯ]/g, ""); } catch { /* keep raw */ }
  raw = raw.replace(/\s+/g, " ").trim();
  const spaced = raw
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .replace(/(\p{N})(\p{L})/gu, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { raw, spaced, compact: spaced.replace(/\s+/g, ""), tokens: spaced ? spaced.split(" ") : [] };
}

function numWord(n) {
  const i = Number(n);
  return Number.isInteger(i) && i >= 0 && i <= 12 ? NUM_WORDS[i] : null;
}

function tokenAlts(tokens) {
  const alts = tokens.map(() => new Set());
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
        if (vals.includes(t)) { alts[i].add(key); for (const v of vals) alts[i].add(v); }
      }
    }
    const cm = t.match(compactRe);
    if (cm) {
      alts[i].add(cm[1]); alts[i].add(cm[2]);
      for (const v of ABBREV_FORWARD[cm[1]] || []) { alts[i].add(v); alts[i].add(v + cm[2]); }
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

// Optimal-string-alignment distance with an early exit above max. Three
// reused rows instead of a fresh matrix: this runs per token pair per key.
let rowPrev2 = new Int16Array(64);
let rowPrev = new Int16Array(64);
let rowCur = new Int16Array(64);

export function editDistance(a, b, max) {
  if (a === b) return 0;
  const la = a.length; const lb = b.length;
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
    const spare = rowPrev2; rowPrev2 = rowPrev; rowPrev = rowCur; rowCur = spare;
  }
  return rowPrev[lb] <= max ? rowPrev[lb] : max + 1;
}

function initialisms(key) {
  if (key._init) return key._init;
  const inits = [];
  const tokens = key.tokens || [];
  let i = 0;
  while (i < tokens.length) {
    if (!/^[a-z]+$/.test(tokens[i])) { i++; continue; }
    let j = i;
    while (j < tokens.length && /^[a-z]+$/.test(tokens[j])) j++;
    const alphaRun = tokens.slice(i, j);
    let k = 0;
    while (k < alphaRun.length) {
      const single = alphaRun[k].length === 1;
      let m = k;
      while (m < alphaRun.length && (alphaRun[m].length === 1) === single) m++;
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

// '+' is AND between clauses; inside a clause every token must match.
export function searchPlan(query) {
  const clauses = String(query == null ? "" : query)
    .split("+").map((q) => {
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

// Match level for ranking bands: 3 whole-key equality, 2 prefix or
// word-boundary substring, 1 exact words or initialism, 0 prefix-only words.
// The lowest clause wins.
export function strictScoreFromKey(target, plan) {
  return strictMatch(target, plan).score;
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
        if (next < 0) { ordered = false; break; }
        if (at >= 0) gap += Math.max(0, next - at - 1);
        at = next;
      }
      if (ordered) score = 640 - Math.min(120, gap * 8);
      else if (q.tokens.every((token) => tokenSet(target).has(token))) score = 500;
      else if (q.tokens.every((token) => target.tokens.some((candidate) => candidate.startsWith(token)))) score = 440;
      else if (q.tokens.length === 1 && q.compact.length >= 2 && q.compact.length <= 6
          && target.tokens.length >= q.compact.length
          && initialsOf(target).startsWith(q.compact)) score = 380;
    }
    if (score < 0) return { score: -1, level: 0 };
    // 440 (every word only a prefix, any order) is level 0: on a real graph
    // it is mostly noise ("ant man" -> "antibiotics ... management").
    level = Math.min(level, score >= 1120 ? 3 : score >= 800 ? 2 : score === 440 ? 0 : 1);
    total += score;
  }
  return { score: total - Math.min(80, Math.max(0, target.compact.length - plan.compactLength)), level };
}

function initialsOf(key) {
  if (key._initials == null) key._initials = key.tokens.map((token) => token[0] || "").join("");
  return key._initials;
}

// Cheap necessary condition for an admitted strict match (isPrecise level
// >= 1): the separator-free key holds each clause's longest word, or, for a
// short one-word query, the key's initials start with it. Lets a per-key
// scan skip most of the graph without running the full ladder.
export function strictPrefilter(plan) {
  const needles = plan.clauses.map((q) => q.tokens.reduce((a, b) => (b.length > a.length ? b : a), ""));
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

// Burrow change from Thymer: a spaced substring must start on a word
// boundary, so "ant man" does not hit "important manual" (spec §3). Both
// checks walk only the target tokens that start with the needle's first
// letter: long blocks are scored on every keystroke, and a text scan for a
// short needle like "ant" stops inside every "important" and "want".
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

// Same boundary rule for the separator-free form: the hit must start where a
// target token starts ("antman" hits "ant man", not "important manual").
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

const NONE = [];
function tokensFrom(key, ch) {
  if (!key._byFirst) {
    key._byFirst = new Map();
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
    if (qOrig === tt) return { quality: 1.0, partial: true };
    return null;
  }
  let best = null;
  for (const qf of qForms) {
    if (qf === tt) {
      const q = qf === qOrig ? 1.0 : 0.8;
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

// Returns { score, tier: 'strict' | 'close', level, recall, anyExact }.
// score -1 means no match. Recall hits (abbreviation, initialism, typo) have
// level 0, recall true, and anyExact when some query word matched exactly.
// opts.strict skips the recall tier (abbreviations, initialisms, typos).
export function matchFromKey(target, plan, opts = {}) {
  const empty = { score: -1, tier: "strict", level: 0 };
  if (!target?.compact || !plan?.clauses?.length) return empty;
  const strict = strictMatch(target, plan);
  if (strict.score >= 0) return { score: strict.score, tier: "strict", level: strict.level };
  if (opts.strict === true) return empty;
  const lengthPenalty = Math.min(80, Math.max(0, target.compact.length - plan.compactLength));
  let best = null;
  for (const clause of plan.clauses) {
    const tokens = clause.tokens;
    const alts = clause.tokenAlts || tokens.map((t) => new Set([t]));
    const targetTokens = target.tokens || [];
    const inits = plan.needsInitialism ? initialisms(target) : [];
    const initOffset = targetTokens.length;
    const allTargets = targetTokens.concat(inits);
    const qualities = [];
    const usedTarget = new Set();
    let anyExact = false;
    for (let qi = 0; qi < tokens.length; qi++) {
      const qOrig = tokens[qi];
      const qForms = alts[qi] || new Set([qOrig]);
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
      const longest = tokens.reduce((a, b) => (a.length >= b.length ? a : b));
      if (missTok === longest) continue;
      tier = "close";
    }
    const avgQuality = qualities.reduce((s, q) => s + q, 0) / tokens.length;
    const base = tier === "close"
      ? 100 + Math.round(80 * avgQuality)
      : Math.round(300 * avgQuality) + 80;
    const score = base - lengthPenalty;
    if (score < 0) continue;
    if (!best || score > best.score || (score === best.score && tier === "strict" && best.tier === "close")) best = { score, tier, level: 0, recall: true, anyExact };
  }
  return best || empty;
}

// What Burrow's rows admit: precise strict matches, and recall matches that
// still got at least one query word exactly right. Close (a word missing)
// and prefix-only matches are left to Roam's own rows.
export function isPrecise(match) {
  if (!match || match.score < 0 || match.tier === "close") return false;
  return match.level >= 1 || Boolean(match.recall && match.anyExact);
}

export function searchScore(text, query, opts = {}) {
  const plan = query?.clauses ? query : searchPlan(query);
  return matchFromKey(searchKey(text), plan, opts).score;
}
