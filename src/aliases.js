import { matchFromKey, searchKey } from "./search.js";

// roam-aliases convention: a block `Keyword:: a, b` on the page. Burrow reads
// the keyword case-insensitively (`aliases:: EMP` counts too) and never edits
// these blocks.
export function parseAliasBlock(string, keyword = "Aliases") {
  const kw = String(keyword || "Aliases").trim();
  const text = String(string || "").split("\n")[0];
  const head = text.slice(0, kw.length + 2);
  if (head.toLowerCase() !== `${kw.toLowerCase()}::`) return [];
  return text.slice(kw.length + 2).split(",")
    .map((value) => value.trim().replace(/^#?\[\[(.*)\]\]$/, "$1").replace(/^#/, "").trim())
    .filter(Boolean);
}

// Title spellings to look up as attribute pages; Roam titles are
// case-sensitive, so `aliases::` and `Aliases::` are different pages.
export function keywordTitles(keyword = "Aliases") {
  const kw = String(keyword || "Aliases").trim();
  const lower = kw.toLowerCase();
  return [...new Set([kw, lower, lower[0]?.toUpperCase() + lower.slice(1), kw.toUpperCase()])];
}

// One alias page's ALIAS_PULL result (src/indexes.js) as buildAliasIndex rows.
export function aliasRowsFromPull(pulled) {
  const rows = [];
  for (const ref of pulled?.[":block/_refs"] || []) {
    const page = ref[":block/page"];
    const string = ref[":block/string"];
    if (typeof string === "string" && page?.[":node/title"] != null && page[":block/uid"]) rows.push([string, page[":node/title"], page[":block/uid"]]);
  }
  return rows;
}

// rows: [blockString, pageTitle, pageUid]. One alias may name several pages;
// each stays its own entry and Burrow never guesses between them.
// memo: the previous index's .memo (same keyword), so a rebuild after one
// alias block changed parses and keys only that block's aliases.
export function buildAliasIndex(rows, keyword, memo = null) {
  const entries = [];
  const byPage = new Map();
  const pageAliases = new Map();
  const parsed = new Map();
  const keys = new Map();
  const exact = `${String(keyword || "Aliases").trim()}::`;
  for (const [string, title, uid] of rows || []) {
    // roam-aliases reads only the exact-case keyword; Burrow reads any case.
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
  return { entries, byPage, pageAliases, refsByPage: new Map(), usesByAlias: new Map(), aliasesByUse: new Map(), memo: { parsed, keys } };
}

// rows: [[pageUid, count], ...]. Counts are read at idle, never per key.
export function setAliasRefs(index, rows) {
  const refsByPage = new Map(rows || []);
  for (const entry of index.entries) entry.refs = refsByPage.get(entry.uid) ?? null;
  index.refsByPage = refsByPage;
}

const useKey = (uid, alias) => `${uid}\u0000${String(alias).trim().toLowerCase()}`;

// rows: [[pageUid, refBlockUid, blockString], ...], the blocks that reference
// an alias page and contain `](`[[`. Counts every `[alias]([[Page]])` whose
// link is that page's exact title and whose text is one of its aliases.
export function countAliasUses(index, rows) {
  const uses = new Map();
  const titles = new Map();
  const names = new Map();
  for (const entry of index?.entries || []) {
    titles.set(entry.uid, entry.title);
    if (!names.has(entry.uid)) names.set(entry.uid, new Set());
    names.get(entry.uid).add(entry.alias.trim().toLowerCase());
  }
  for (const [uid, , string] of rows || []) {
    if (typeof string !== "string" || !titles.has(uid)) continue;
    for (const m of string.matchAll(/\[([^\[\]]+)\]\(\[\[([^\]]+)\]\]\)/g)) {
      const text = m[1].trim().toLowerCase();
      if (m[2] !== titles.get(uid) || !names.get(uid).has(text)) continue;
      const key = useKey(uid, text);
      uses.set(key, (uses.get(key) || 0) + 1);
    }
  }
  return uses;
}

// Stores the counts and, per page, its aliases most used first (ties keep the
// alias block's order), so a keystroke only reads a ready list.
export function setAliasUses(index, uses) {
  index.usesByAlias = uses || new Map();
  index.aliasesByUse = new Map();
  if (!index.usesByAlias.size) return;
  for (const [uid, list] of index.pageAliases) {
    index.aliasesByUse.set(uid, [...list].sort((a, b) => aliasUses(index, uid, b) - aliasUses(index, uid, a)));
  }
}

export function aliasUses(index, uid, alias) {
  return index?.usesByAlias?.get(useKey(uid, alias)) || 0;
}

// hits: matchAliases output, best first. One row per page: its best alias,
// plus every alias the page has, for the chips (byUse: most used first).
export function groupAliasHits(hits, index, { byUse = false } = {}) {
  const seen = new Set();
  const rows = [];
  for (const hit of hits) {
    if (seen.has(hit.uid)) continue;
    seen.add(hit.uid);
    rows.push({
      uid: hit.uid, title: hit.title, alias: hit.alias, level: hit.level, score: hit.score, tier: hit.tier,
      refs: hit.refs ?? null, seenByRoamAliases: hit.seenByRoamAliases,
      aliases: (byUse && index.aliasesByUse?.get(hit.uid)) || index.pageAliases?.get(hit.uid) || [hit.alias],
    });
  }
  return rows;
}

export function matchAliases(index, plan, { strict = false, limit = 3, skip, picked = null } = {}) {
  if (!index || !plan) return [];
  const hits = [];
  for (const entry of index.entries) {
    if (skip?.(entry)) continue;
    const match = matchFromKey(entry.key, plan, { strict });
    // Aliases are few and short, so alias rows keep the scorer's full
    // forgiveness (a one-word typo like "lorinatr"); only close matches,
    // which miss a query word, are left out.
    if (match.score < 0 || match.tier === "close") continue;
    hits.push({ ...entry, score: match.score, level: match.level, tier: match.tier });
  }
  // picked: page uid -> frecency score (spec §18), a tie-break after the match.
  const pick = (hit) => picked?.get(hit.uid) || 0;
  hits.sort((a, b) => b.score - a.score || pick(b) - pick(a) || a.title.localeCompare(b.title) || a.alias.localeCompare(b.alias));
  return hits.slice(0, limit);
}

// roam-aliases lists an alias when its text contains what is typed inside
// [[ ]], ignoring case (its src/index.tsx). Burrow skips those up front, so
// it never shows a row that roam-aliases is about to draw a moment later.
export function roamAliasesWillList(entry, query) {
  return Boolean(entry.seenByRoamAliases) && entry.alias.toLowerCase().includes(String(query).toLowerCase());
}

export function aliasInsertion(entry, format) {
  if (format === "[[Page]]") return `[[${entry.title}]]`;
  return `[${entry.alias}]([[${entry.title}]])`;
}
