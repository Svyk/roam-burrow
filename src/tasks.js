// {{[[TODO]]}} and {{[[DONE]]}} (also {{TODO}}, {{DONE}} and Better Tasks'
// {{[[DONE]]:((uid))}}) drawn as Roam draws them in its own rows: a read-only
// checkbox where the macro sits. Everything else stays text.
const TASK = /\{\{\s*(?:\[\[)?(TODO|DONE)(?:\]\])?(?::[^{}]*)?\s*\}\}/g;

// [{ text } | { task: "todo" | "done" }], in order; empty text parts dropped.
export function taskParts(string) {
  const parts = [];
  const value = String(string ?? "");
  let at = 0;
  for (const m of value.matchAll(TASK)) {
    if (m.index > at) parts.push({ text: value.slice(at, m.index) });
    parts.push({ task: m[1] === "DONE" ? "done" : "todo" });
    at = m.index + m[0].length;
  }
  if (at < value.length) parts.push({ text: value.slice(at) });
  return parts;
}

export const hasTask = (string) => /\{\{\s*(?:\[\[)?(?:TODO|DONE)\b/.test(String(string ?? ""));

// One element, drawn by src/extension.css to Roam's own checkbox (12 px,
// its border and blue, the white tick), read-only: a click picks the row.
// Roam's markup (span, label, input, span) costs four inserted elements per
// box, and in svy every element inserted costs about 0.03 ms, so a preview of
// 80 task lines cost 7 ms with it.
export function checkbox(doc, state) {
  const box = doc.createElement("span");
  box.className = `burrow-check burrow-${state}`;
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", state === "done" ? "done" : "to do");
  return box;
}
