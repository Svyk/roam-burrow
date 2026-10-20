// The ⌥A alias field is drawn by Burrow, not a real input: the block's
// textarea keeps the focus, or Roam would end the edit and close its popup.
// So a composition (an IME, or a dead key such as ⌥E then E) still happens in
// that textarea. While the field is open, Roam never sees it: the keys the IME
// takes and the input events stop at the window (no preventDefault, so the IME
// still gets them), the composed text joins the field when the composition
// ends, and the textarea gets back the value and caret it had. Text that
// comes with neither a key press nor a composition (an emoji keyboard or the
// Character Viewer, dictation, a drop) joins the field the same way.
const firstLine = (data) => String(data ?? "").split(/\r?\n/)[0];

// What a change from `was` to `now` put in: the part between their common
// start and common end.
export function inserted(was, now) {
  const a = [...was], b = [...now];
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return b.slice(i, b.length - j).join("");
}

export function createPromptComposer({ prompt, textarea, setValue, render }) {
  const open = (event) => {
    const p = prompt();
    return p?.kind === "add" && event.target === textarea() ? p : null;
  };

  function start(event) {
    const p = open(event);
    if (!p) return false;
    const ta = event.target;
    if (p.fresh) { p.text = ""; p.fresh = false; }
    p.error = null;
    p.compose = { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd, text: "" };
    render();
    return true;
  }

  function update(event) {
    const p = open(event);
    if (!p?.compose) return false;
    p.compose.text = firstLine(event.data);
    render();
    return true;
  }

  function end(event) {
    const p = open(event);
    if (!p?.compose) return false;
    restore(p, event.target);
    p.text += firstLine(event.data);
    render();
    return true;
  }

  // Puts the textarea back as it was when the composition started.
  function restore(p, ta) {
    const c = p.compose;
    if (!c) return;
    p.compose = null;
    if (ta.value !== c.value) setValue(ta, c.value);
    try { ta.setSelectionRange(c.start, c.end); } catch { /* textarea replaced */ }
  }

  // keydown / keyup: the keys that start or feed a composition.
  function key(event) {
    const p = open(event);
    if (!p || !(p.compose || event.isComposing || event.keyCode === 229 || event.key === "Dead")) return false;
    event.stopImmediatePropagation();
    return true;
  }

  // beforeinput / input: the composition's text going into the textarea.
  function input(event) {
    if (!open(event)?.compose) return false;
    event.stopImmediatePropagation();
    return true;
  }

  // beforeinput outside a composition: nothing reaches the block, and the
  // text it carries joins the field (a delete or an undo from the menu
  // carries none).
  function insert(event) {
    const p = open(event);
    if (!p || p.compose || event.isComposing) return false;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (!event.defaultPrevented) return true;               // stray() below puts it back
    add(p, event.inputType?.startsWith("insert") ? event.data ?? event.dataTransfer?.getData("text/plain") : "");
    put(p, event.target);                                   // a drop moves the caret first
    return true;
  }

  // input outside a composition: one its beforeinput could not stop, or one
  // that came without one (execCommand). The textarea goes back to how it
  // was when the field opened, and what was put in joins the field.
  function stray(event) {
    const p = open(event);
    if (!p || p.compose || event.isComposing) return false;
    event.stopImmediatePropagation();
    const ta = event.target;
    add(p, event.inputType?.startsWith("insert") ? inserted(p.block.value, ta.value) : "");
    put(p, ta);
    return true;
  }

  function add(p, data) {
    const text = firstLine(data);
    if (!text || p.saving) return;
    p.text = p.fresh ? text : p.text + text;
    p.fresh = false;
    p.error = null;
    render();
  }

  function put(p, ta) {
    const b = p.block;
    if (ta.value !== b.value) setValue(ta, b.value);
    if (ta.selectionStart === b.start && ta.selectionEnd === b.end) return;
    try { ta.setSelectionRange(b.start, b.end); } catch { /* textarea replaced */ }
  }

  return { start, update, end, restore, key, input, insert, stray };
}
