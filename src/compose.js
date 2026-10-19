// The ⌥A alias field is drawn by Burrow, not a real input: the block's
// textarea keeps the focus, or Roam would end the edit and close its popup.
// So a composition (an IME, or a dead key such as ⌥E then E) still happens in
// that textarea. While the field is open, Roam never sees it: the keys the IME
// takes and the input events stop at the window (no preventDefault, so the IME
// still gets them), the composed text joins the field when the composition
// ends, and the textarea gets back the value and caret it had.
const firstLine = (data) => String(data ?? "").split(/\r?\n/)[0];

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

  return { start, update, end, restore, key, input };
}
