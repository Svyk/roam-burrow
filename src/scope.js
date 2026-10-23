import { nodeKey } from "./drill.js";
import { hasTask, taskParts } from "./tasks.js";
import { ordinalQuery, startsWithOrdinal } from "./ordinal.js";
import { matchFromKey, searchPlan } from "./search.js";

// Rows of one Tab-drill level: the children of a page or block, filtered by
// what was typed while scoped. nodes: [{ uid, string, heading, kids }] in
// outline order. Close (typo-tier) matches are left out, as in drill.
export function scopeRows(nodes, query, { strict = false, text = (s) => s, ordinals = false, hideEmpty = false } = {}) {
  const row = (node, ord = false) => {
    const shown = text(node.string ?? "");
    const parts = hasTask(node.string) ? taskParts(node.string).map((p) => (p.task ? p : { text: text(p.text) })) : null;
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

export const CAP = 50;

export function capRows(rows, limit) {
  if (limit === Infinity || limit >= rows.length) return rows;
  return [...rows.slice(0, limit), { more: rows.length - limit, key: "more", uid: null, text: "", drillable: false }];
}

export function firstReal(rows) {
  const at = rows.findIndex((row) => !row.empty && row.more == null);
  return at < 0 ? 0 : at;
}
