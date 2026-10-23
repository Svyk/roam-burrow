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

// Roam's own row markup (`.rm-checkbox .check-container .checkmark`), so the
// theme styles it as in Roam's list; disabled, and the pointer passes through
// to the row (a click picks the row, it never toggles the task).
export function checkbox(doc, state) {
  const wrap = doc.createElement("span");
  wrap.className = `rm-checkbox rm-${state} burrow-check`;
  const label = doc.createElement("label");
  label.className = "check-container";
  const input = doc.createElement("input");
  input.type = "checkbox";
  input.disabled = true;
  input.tabIndex = -1;
  input.checked = state === "done";
  const mark = doc.createElement("span");
  mark.className = "checkmark";
  label.append(input, mark);
  wrap.append(label);
  return wrap;
}

// Text with its task macros as checkboxes; `textOf(part)` turns each text part
// into a node or string (highlighting, markup stripping).
export function withTasks(doc, string, textOf = (s) => s) {
  const fragment = doc.createDocumentFragment();
  for (const part of taskParts(string)) {
    if (part.task) fragment.append(checkbox(doc, part.task));
    else fragment.append(textOf(part.text));
  }
  return fragment;
}
