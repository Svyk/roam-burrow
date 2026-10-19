import { nodeKey } from "./drill.js";
import { matchFromKey, searchPlan } from "./search.js";

// Rows of one Tab-drill level: the children of a page or block, filtered by
// what was typed while scoped. nodes: [{ uid, string, heading, kids }] in
// outline order. Close (typo-tier) matches are left out, as in drill.
export function scopeRows(nodes, query, { strict = false, text = (s) => s } = {}) {
  const row = (node) => ({ uid: node.uid, text: text(node.string ?? ""), heading: node.heading || 0, drillable: Boolean(node.kids?.length), node });
  const plan = String(query ?? "").trim() ? searchPlan(query) : null;
  if (!plan) return nodes.map(row);
  const hits = [];
  nodes.forEach((node, index) => {
    const match = matchFromKey(nodeKey(node), plan, { strict });
    if (match.score < 0 || match.tier === "close") return;
    hits.push({ node, index, score: match.score });
  });
  hits.sort((a, b) => b.score - a.score || a.index - b.index);
  return hits.map((hit) => row(hit.node));
}
