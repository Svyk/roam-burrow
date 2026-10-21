const ROMAN = /^(?=[ivx])x{0,3}(ix|iv|v?i{0,3})$/;

// "1", "2.", "(b)", "b)", "iii", "(iv)" -> the bare token ("1", "b", "iii"); anything else -> null.
export function ordinalQuery(query) {
  let q = String(query ?? "").trim().toLowerCase();
  if (q.startsWith("(")) q = q.slice(1);
  if (q.endsWith(")") || q.endsWith(".")) q = q.slice(0, -1);
  if (/^\d{1,3}$/.test(q) || /^[a-z]$/.test(q) || ROMAN.test(q)) return q;
  return null;
}

// Does `text` (already markup-stripped, readable) start with that ordinal?
export function startsWithOrdinal(text, token) {
  if (!token) return false;
  const t = String(text ?? "").trimStart().toLowerCase();
  const tok = String(token).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^\\(${tok}\\)(\\s|$)`).test(t)) return true;
  if (new RegExp(`^${tok}[.):](\\s|$)`).test(t)) return true;
  return /^\d+$/.test(token) && new RegExp(`^${tok}(\\s|$)`).test(t);
}
