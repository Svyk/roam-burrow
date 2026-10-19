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

// Best scorer match among candidates; ties go to outline order: the order
// candidates are given in, or `first(ties)` when they come unordered.
export function bestMatch(candidates, query, { strict = false, first } = {}) {
  if (!candidates.length) return null;
  const plan = query ? searchPlan(query) : null;
  let ties = candidates;
  if (plan) {
    let bestScore = -1;
    ties = [];
    for (const node of candidates) {
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
export function resolveDrill(parsed, source, { strict = false } = {}) {
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
