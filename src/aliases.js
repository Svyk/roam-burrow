import { matchFromKey, searchKey } from "./search.js";

// roam-aliases convention: a block `Keyword:: a, b` on the page. Burrow reads
// the keyword case-insensitively (`aliases:: EMP` counts too) and never edits
// these blocks.
export function parseAliasBlock(string, keyword = "Aliases") {
  const kw = String(keyword || "Aliases").trim();
  const text = String(string || "");
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

// rows: [blockString, pageTitle, pageUid]. One alias may name several pages;
// each stays its own entry and Burrow never guesses between them.
export function buildAliasIndex(rows, keyword) {
  const entries = [];
  const byPage = new Map();
  const exact = `${String(keyword || "Aliases").trim()}::`;
  for (const [string, title, uid] of rows || []) {
    // roam-aliases reads only the exact-case keyword; Burrow reads any case.
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

export function matchAliases(index, plan, { strict = false, limit = 3, skip } = {}) {
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
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.alias.localeCompare(b.alias));
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
