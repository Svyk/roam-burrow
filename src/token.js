// The `[[query` or `((query` token the caret sits in, if any. Roam auto-pairs
// the closer, so `end` covers it when it sits right after the caret.
export function findToken(value, caret) {
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
  // A nested opener after this one (`[[a ((b`) was handled above by
  // lastIndexOf; an opener of the other kind before it is irrelevant.
  if (kind === "[[" && query.includes("[[")) return null;
  const end = value.startsWith(close, caret) ? caret + close.length : caret;
  // The caret moved back into a token that closes further on (`((agen|t))`):
  // Roam searches the text before the caret, but a Burrow pick there would
  // leave `t))` behind, so the popup is Roam's alone until the caret is back.
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

// Exact replacement of the token span; every byte outside it is untouched.
export function applyToken(value, token, insertion) {
  return value.slice(0, token.start) + insertion + value.slice(token.end);
}

// Burrow writes only when the textarea still holds exactly the token it
// ranked for: same text before the caret, same closer, collapsed selection.
export function tokenStillValid(value, selStart, selEnd, token) {
  if (selStart !== selEnd || selStart !== token.caret) return false;
  if (value.slice(token.start, token.caret) !== token.kind + token.query) return false;
  const close = token.kind === "[[" ? "]]" : "))";
  if (token.closed && !value.startsWith(close, token.caret)) return false;
  return true;
}
