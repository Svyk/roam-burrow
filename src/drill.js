import { parseFilters } from "./filters.js";
import { ordinalQuery, startsWithOrdinal } from "./ordinal.js";
import { matchFromKey, searchKey, searchPlan, stripRoamMarkup } from "./search.js";

// Drill grammar (spec §5), inside [[ ]] only:
//   expr := title ( "#" q )? ( ">" q )*
// `#q` matches headings anywhere on the page, `> q` the direct children of
// the current target. Inside a `> q` step a `#` is plain text.
export function parseSteps(rest) {
  if (!rest || (rest[0] !== "#" && rest[0] !== ">")) return null;
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

// Drill switches on only when the text before a `#` or `>` resolves exactly
// to a page (title or alias, case- and separator-insensitive). The longest
// such title wins, so a page named `a > b` can still be drilled into. When
// some page title starts with the whole typed text (`C#`, `a > b`), the user
// is typing that title and the text stays native.
export function parseDrill(query, titles) {
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

// More pages than this match the typed title: none clearly wins.
export const NEAR_PAGES = 5;
const NEAR_MIN = 3;

// Drill from a near title (spec §30): the text before the first `#` or `>` is
// no exact title, but one page clearly wins the match. It wins alone, or
// among up to NEAR_PAGES as the only one the steps typed so far resolve on
// (`Executor Lanes#grok`). `held` keeps the page chosen for this title while
// the steps change, so a step that stops matching is not handed to Roam's
// Enter, which would create the page.
export function parseNearDrill(query, titles, { steps, held = null } = {}) {
  const text = String(query ?? "");
  if (!titles?.near) return null;
  const at = text.search(/[#>]/);
  if (at <= 0) return null;
  const title = text.slice(0, at).trim();
  const lower = text.trim().toLowerCase();
  // `Bug #12` is a name being typed, and filters mean what they say.
  if (searchKey(title).compact.length < NEAR_MIN || /\s#\d/.test(text) || parseFilters(text)) return null;
  if (titles.resolve(text) || titles.namesText(lower)) return null;
  const parsed = parseSteps(text.slice(at));
  if (!parsed) return null;
  const found = (page) => ({ page, typedTitle: title, near: true, ...parsed });
  if (held?.typedTitle === title) return found(held.page);
  const pages = titles.near(title);
  if (pages.length === 1) return found(pages[0]);
  if (!pages.length || pages.length > NEAR_PAGES) return null;
  if (!(parsed.heading ?? parsed.steps[0])) return null;
  const reached = pages.filter((page) => steps?.({ page, ...parsed }));
  return reached.length === 1 ? found(reached[0]) : null;
}

// Best scorer match among candidates; ties go to outline order: the order
// candidates are given in, or `first(ties)` when they come unordered.
export function bestMatch(candidates, query, { strict = false, first, ordinals = false, hideEmpty = false } = {}) {
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
      if (match.score > bestScore) { bestScore = match.score; ties = [node]; } else if (match.score === bestScore) ties.push(node);
    }
  }
  if (!ties.length) return null;
  return ties.length > 1 && first ? first(ties) : ties[0];
}

export function nodeKey(node) {
  if (!node.key) node.key = searchKey(stripRoamMarkup(node.string ?? node.title ?? ""));
  return node.key;
}

// Walks the parsed expression over a tree source:
//   children(uid) -> [{uid, string, heading}] in order
//   headings(pageUid) -> [{uid, string, heading}]
//   first(nodes) -> the node that comes first in the outline
// Returns the deepest resolved node (null: only the page resolved) and the
// step that failed, if any.
export function resolveDrill(parsed, source, { strict = false, ordinals = false, hideEmpty = false } = {}) {
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
      if (!hit) { failedAt = i + (parsed.heading != null ? 1 : 0); break; }
      target = hit;
    }
  }
  return {
    page,
    target,
    failedAt,
    insertion: target ? `((${target.uid}))` : `[[${page.title}]]`,
  };
}
