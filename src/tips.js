// Hover tips on Burrow's own nodes: what a row, chip, preview or hint is and
// which key does what with it. Drawn by Burrow in the popover's colors
// inverted (Blueprint's tooltip look, light and dark) instead of the native
// `title` box, which follows the OS theme; an element's `title` is set aside
// while its tip shows and put back after. Mouse events only, never a key.
const DELAY_MS = 450;
const GAP = 6;
const MAX_WIDTH = 320;

export function createTips({ doc, win, lifecycle, enabled, avoid = () => null }) {
  const node = doc.createElement("div");
  node.className = "burrow-tip";
  node.setAttribute("role", "tooltip");
  node.hidden = true;
  lifecycle.node(node, doc.body);
  let timer = null;
  let anchor = null;
  let stash = null;

  function hide() {
    if (timer != null) { win.clearTimeout(timer); timer = null; }
    if (stash) { if (!stash.el.hasAttribute("title")) stash.el.setAttribute("title", stash.title); stash = null; }
    anchor = null;
    if (!node.hidden) node.hidden = true;
  }
  lifecycle.add(hide);

  function render({ title, lines }) {
    const parts = [];
    if (title) parts.push(Object.assign(doc.createElement("div"), { className: "burrow-tip-title", textContent: title }));
    for (const [keys, what] of lines || []) {
      const line = Object.assign(doc.createElement("div"), { className: "burrow-tip-line" });
      if (keys) line.append(Object.assign(doc.createElement("span"), { className: "burrow-tip-key", textContent: keys }));
      line.append(what);
      parts.push(line);
    }
    node.replaceChildren(...parts);
  }

  // Under the element when it fits and leaves the text being edited free,
  // else above it; always inside the window.
  function place(rect, styleFrom) {
    for (const name of ["--burrow-bg", "--burrow-fg"]) node.style.setProperty(name, styleFrom.style.getPropertyValue(name) || "");
    node.style.zIndex = String((Number.parseInt(styleFrom.style.zIndex, 10) || 30) + 2);
    node.style.maxWidth = `${MAX_WIDTH}px`;
    node.style.left = "0px";
    node.style.top = "0px";
    node.hidden = false;
    const box = node.getBoundingClientRect();
    const ta = avoid();
    const hits = (top) => ta && top < ta.bottom && top + box.height > ta.top && rect.left < ta.right && rect.left + box.width > ta.left;
    let top = rect.bottom + GAP;
    if (top + box.height > win.innerHeight || hits(top)) top = rect.top - GAP - box.height;
    if (top < 0 || hits(top)) top = Math.min(win.innerHeight - box.height, rect.bottom + GAP);
    const left = Math.max(4, Math.min(rect.left, win.innerWidth - box.width - 4));
    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(Math.max(0, top))}px`;
  }

  // resolve(target) -> { el, title, lines: [[keys, what]], themeFrom } or null.
  function attach(container, resolve) {
    lifecycle.event(container, "mouseover", (event) => {
      if (!enabled()) { if (anchor) hide(); return; }
      const hit = resolve(event.target);
      if (!hit) { hide(); return; }
      if (hit.el === anchor) return;
      hide();
      anchor = hit.el;
      if (hit.el.hasAttribute("title")) {
        stash = { el: hit.el, title: hit.el.getAttribute("title") };
        hit.el.removeAttribute("title");
      }
      timer = win.setTimeout(() => {
        timer = null;
        if (anchor !== hit.el || !hit.el.isConnected) return;
        render(hit);
        place(hit.el.getBoundingClientRect(), hit.themeFrom || container);
      }, DELAY_MS);
    });
    lifecycle.event(container, "mouseleave", hide);
    lifecycle.event(container, "mousedown", hide, true);
    lifecycle.event(container, "wheel", hide, { passive: true });
  }

  return {
    node,
    attach,
    hide,
    get visible() { return anchor != null; },
  };
}
