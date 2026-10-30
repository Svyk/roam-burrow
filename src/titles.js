import { searchKey } from "./search.js";

// Page titles for drill (spec §5): exact resolution of the text before a `#`
// or `>`, and the "some title starts with what is typed" check that keeps
// titles like `C#` native. rows: [title, uid]. aliases: the alias index.
//
// An Escape on a drill expression leaves `[[X#h]]` in the block, and Roam
// then creates an empty page `X#h`. Such a page must not turn drill off for
// that text, nor become a drill target, so a title holding `#` or `>` only
// counts when its page has content (`withContent`, a Set of titles; without
// it every title counts).
export function buildTitleIndex(rows, aliases, withContent = null) {
  const byRaw = new Map();
  const byLower = new Map();
  const byCompact = new Map();
  const byUid = new Map();
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
    byUid.set(uid, title);
    add(byLower, title.toLowerCase(), page);
    const compact = searchKey(title).compact;
    if (compact) add(byCompact, compact, page);
  }
  let aliasLower = new Map();
  let aliasCompact = new Map();
  // Aliases can be swapped in alone when an alias block changes.
  const setAliases = (next) => {
    aliasLower = new Map();
    aliasCompact = new Map();
    for (const entry of next?.entries || []) {
      const page = { title: entry.title, uid: entry.uid };
      add(aliasLower, entry.alias.toLowerCase(), page);
      if (entry.key?.compact) add(aliasCompact, entry.key.compact, page);
    }
  };
  setAliases(aliases);
  const sorted = [...byLower.keys()].filter((t) => /[#>]/.test(t)).sort();
  let allSorted = null;
  const one = (list) => (list?.length === 1 ? list[0] : null);
  return {
    size: byRaw.size,
    // Page uid -> title, for the recent rows.
    byUid: (uid) => byUid.get(uid) ?? null,
    setAliases,
    // Exact title, then case-insensitive, then separator-insensitive, then
    // an alias; an ambiguous spelling resolves to nothing.
    resolve(text) {
      const raw = String(text ?? "").trim();
      if (!raw) return null;
      if (byRaw.has(raw)) return byRaw.get(raw);
      const lower = raw.toLowerCase();
      const compact = searchKey(raw).compact;
      return one(byLower.get(lower)) || one(compact && byCompact.get(compact))
        || one(aliasLower.get(lower)) || one(compact && aliasCompact.get(compact)) || null;
    },
    // Every page whose title starts with `prefix`, without case (`#ns:`).
    startingWith(prefix) {
      const lower = String(prefix ?? "").toLowerCase();
      allSorted ||= [...byLower.keys()].sort();
      let lo = 0;
      let hi = allSorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (allSorted[mid] < lower) lo = mid + 1;
        else hi = mid;
      }
      const pages = [];
      for (let i = lo; i < allSorted.length && allSorted[i].startsWith(lower); i += 1) pages.push(...byLower.get(allSorted[i]));
      return pages;
    },
    hasPrefix(lower) {
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < lower) lo = mid + 1;
        else hi = mid;
      }
      return lo < sorted.length && sorted[lo].startsWith(lower);
    },
  };
}
