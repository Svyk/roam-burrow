// Hover tips on Burrow's own nodes: what a row, chip, preview or hint is and
// which key does what with it. Drawn by Burrow in the popover's colors
// inverted (Blueprint's tooltip look, light and dark) instead of the native
// `title` box, which follows the OS theme; an element's `title` is set aside
// while its tip shows and put back after. Mouse events only, never a key.
const DELAY_MS = 450;
const GAP = 6;
const MAX_WIDTH = 320;

// Where a tip goes: beside the picker (right, then left), level with the
// element; above or below it when neither side has room; never over the
// picker's own text or the text being edited. Pure, for the tests.
//   el: the hovered element's rect; box: { width, height } of the tip;
//   area: the picker's rect (popover and Burrow's panes together) or null;
//   ta: the edited text's rect or null; view: { width, height }.
export function placeTip(el, box, area, ta, view) {
  const hits = (r, x, y) => r && x < r.right && x + box.width > r.left && y < r.bottom && y + box.height > r.top;
  const free = (x, y) => !hits(area, x, y) && !hits(ta, x, y);
  const clampY = (y) => Math.max(0, Math.min(view.height - box.height, y));
  const clampX = (x) => Math.max(4, Math.min(view.width - box.width - 4, x));
  if (area) {
    const y = clampY(el.top);
    const right = area.right + GAP;
    if (right + box.width <= view.width - 4 && free(right, y)) return { left: right, top: y };
    const left = area.left - GAP - box.width;
    if (left >= 4 && free(left, y)) return { left, top: y };
    const x = clampX(el.left);
    const below = area.bottom + GAP;
    if (below + box.height <= view.height && free(x, below)) return { left: x, top: below };
    const above = area.top - GAP - box.height;
    if (above >= 0 && free(x, above)) return { left: x, top: above };
  }
  // No room around the picker: under the element, or above it, off the text.
  const x = clampX(el.left);
  let top = el.bottom + GAP;
  if (top + box.height > view.height || hits(ta, x, top)) top = el.top - GAP - box.height;
  if (top < 0 || hits(ta, x, top)) top = Math.min(view.height - box.height, el.bottom + GAP);
  return { left: x, top: Math.max(0, top) };
}

export function createTips({ doc, win, lifecycle, enabled, avoid = () => null, around = () => null }) {
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

  function place(rect, styleFrom) {
    for (const name of ["--burrow-bg", "--burrow-fg"]) node.style.setProperty(name, styleFrom.style.getPropertyValue(name) || "");
    node.style.zIndex = String((Number.parseInt(styleFrom.style.zIndex, 10) || 30) + 2);
    node.style.maxWidth = `${MAX_WIDTH}px`;
    node.style.left = "0px";
    node.style.top = "0px";
    node.hidden = false;
    const box = node.getBoundingClientRect();
    const at = placeTip(rect, box, around(), avoid(), { width: win.innerWidth, height: win.innerHeight });
    node.style.left = `${Math.round(at.left)}px`;
    node.style.top = `${Math.round(at.top)}px`;
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
