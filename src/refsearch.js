export function insertOpener(value, caret) {
  return { value: value.slice(0, caret) + "(())" + value.slice(caret), caret: caret + 2 };
}

export function parseInputId(id) {
  const match = /^block-input-(.+)-([A-Za-z0-9_-]{9})$/.exec(String(id ?? ""));
  return match ? { windowId: match[1], uid: match[2] } : null;
}

export function isRefSearchHotkey(event) {
  return event.code === "Digit9" && Boolean(event.altKey) && Boolean(event.shiftKey) && !event.ctrlKey && !event.metaKey;
}

export function createRefSearch({ api, doc = document, win = window, lifecycle, setting }) {
  let last = null;
  const isEditor = (node) => Boolean(node?.matches?.("textarea.rm-block-input"));

  lifecycle.event(doc, "focusin", (event) => {
    if (!isEditor(event.target)) return;
    const parsed = parseInputId(event.target.id);
    if (parsed) last = { id: event.target.id, ...parsed };
  }, true);
  lifecycle.event(doc, "focusout", (event) => {
    if (!isEditor(event.target)) return;
    const parsed = parseInputId(event.target.id);
    if (parsed) last = { id: event.target.id, ...parsed, caret: event.target.selectionEnd, at: Date.now() };
  }, true);

  const nextFrame = () => new Promise((resolve) => (win.requestAnimationFrame ? win.requestAnimationFrame(resolve) : setTimeout(resolve, 16)));

  async function open() {
    let ta = isEditor(doc.activeElement) ? doc.activeElement : null;
    if (!ta) {
      if (!last || last.at == null || Date.now() - last.at > 60000) return false;
      await api.ui.setBlockFocusAndSelection({
        location: { "block-uid": last.uid, "window-id": last.windowId },
        selection: { start: last.caret },
      });
      const until = Date.now() + 1000;
      while (Date.now() < until && !(isEditor(doc.activeElement) && doc.activeElement.id.endsWith(last.uid))) await nextFrame();
      if (!(isEditor(doc.activeElement) && doc.activeElement.id.endsWith(last.uid))) return false;
      ta = doc.activeElement;
    }
    const { value, caret } = insertOpener(ta.value, ta.selectionEnd);
    Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement?.prototype ?? HTMLTextAreaElement.prototype, "value").set.call(ta, value);
    ta.setSelectionRange(caret, caret);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  lifecycle.event(win, "keydown", (event) => {
    if (!setting("refSearchHotkey") || !isRefSearchHotkey(event) || event.isComposing) return;
    const target = event.target;
    if (!isEditor(target) || target.selectionStart !== target.selectionEnd) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    open();
  }, true);

  return { open, last: () => last };
}
