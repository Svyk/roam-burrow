// Drill preview (spec §5): one read-only outline pane. With Roam's preview
// open (Ctrl-O) it lies exactly over Roam's preview area, whose content a
// reversible class on the popover hides; otherwise it sits beside the
// popover where Roam's preview would open. Text only: no Roam blocks are
// rendered, so a click cannot open an editor.
const SIBLING_WINDOW = 24;
const CHILD_LIMIT = 16;
const ITEM_LIMIT = 80;
const GAP = 4;
const WIDTH = 400;
const MAX_HEIGHT = 300;
export const DRILL_CLASS = "burrow-drill";

// model: { key, trail: [text], items: [{ text, depth, heading, target }] }
export function previewModel(result, tree, text, { hideEmpty = false } = {}) {
  const { page, target } = result;
  const trailNodes = target ? tree.trail(target.uid) : [];
  const parentUid = trailNodes.length ? trailNodes[trailNodes.length - 1].uid : page.uid;
  const trail = [page.title, ...trailNodes.slice(1).map((n) => text(n.string || ""))];
  const items = [];
  const emptyLeaf = (n) => hideEmpty && !text(n.string || "").trim() && Array.isArray(n.kids) && n.kids.length === 0;
  const pushKids = (uid, depth, levels) => {
    const kids = levels > 1 ? tree.twoLevels(uid) : tree.children(uid);
    for (const kid of kids.slice(0, CHILD_LIMIT)) {
      if (items.length >= ITEM_LIMIT) return;
      if (emptyLeaf(kid)) continue;
      items.push({ uid: kid.uid, text: text(kid.string || ""), depth, heading: kid.heading, target: false });
      if (levels > 1 && kid.kids?.length) pushKids(kid.uid, depth + 1, levels - 1);
    }
    if (kids.length > CHILD_LIMIT) items.push({ more: kids.length - CHILD_LIMIT, depth });
  };
  if (!target) {
    pushKids(page.uid, 0, 2);
    return { key: `page:${page.uid}`, trail, items };
  }
  const siblings = tree.children(parentUid);
  let at = siblings.findIndex((s) => s.uid === target.uid);
  if (at < 0) at = 0;
  const from = Math.max(0, Math.min(at - Math.floor(SIBLING_WINDOW / 2), siblings.length - SIBLING_WINDOW));
  if (from > 0) items.push({ more: from, depth: 0 });
  for (const sib of siblings.slice(from, from + SIBLING_WINDOW)) {
    const isTarget = sib.uid === target.uid;
    if (!isTarget && emptyLeaf(sib)) continue;
    items.push({ uid: sib.uid, text: text(sib.string || ""), depth: 0, heading: sib.heading, target: isTarget });
    if (isTarget) pushKids(target.uid, 1, 2);
  }
  if (from + SIBLING_WINDOW < siblings.length) items.push({ more: siblings.length - from - SIBLING_WINDOW, depth: 0 });
  if (!siblings.length) items.push({ uid: target.uid, text: text(target.string || ""), depth: 0, heading: target.heading, target: true });
  return { key: `node:${target.uid}`, trail, items };
}

export function createPreview({ doc, win, lifecycle }) {
  const pane = doc.createElement("div");
  pane.className = "burrow-preview bp3-elevation-3";
  pane.hidden = true;
  pane.setAttribute("aria-hidden", "true");
  const trailNode = doc.createElement("div");
  trailNode.className = "burrow-trail";
  const outline = doc.createElement("div");
  outline.className = "burrow-outline";
  pane.append(trailNode, outline);
  lifecycle.node(pane, doc.body);
  let shownKey = null;
  let pop = null;

  function render(model) {
    trailNode.replaceChildren();
    model.trail.forEach((part, i) => {
      if (i) trailNode.append(Object.assign(doc.createElement("span"), { className: "burrow-sep", textContent: " › " }));
      trailNode.append(Object.assign(doc.createElement("span"), { className: "burrow-crumb", textContent: part }));
    });
    const rows = model.items.map((item) => {
      const row = doc.createElement("div");
      row.className = "burrow-node";
      row.style.setProperty("--burrow-depth", String(item.depth));
      if (item.more != null) {
        row.classList.add("burrow-more");
        row.textContent = `+${item.more} more`;
        return row;
      }
      if (item.heading) row.classList.add(`burrow-h${item.heading}`);
      if (item.target) row.classList.add("burrow-target");
      const bullet = Object.assign(doc.createElement("span"), { className: "burrow-bullet" });
      const body = Object.assign(doc.createElement("span"), { className: "burrow-body", textContent: item.text || " " });
      row.append(bullet, body);
      return row;
    });
    outline.replaceChildren(...rows);
  }

  function place(avoid, beside) {
    const native = pop.querySelector(".rm-autocomplete__preview");
    if (!beside && native && pop.classList.contains("rm-autocomplete__results--expanded")) {
      const r = native.getBoundingClientRect();
      Object.assign(pane.style, { left: `${Math.round(r.left)}px`, top: `${Math.round(r.top)}px`,
        width: `${Math.round(r.width)}px`, height: `${Math.round(r.height)}px`, maxHeight: "" });
      pane.classList.add("burrow-preview-docked");
      return;
    }
    // Beside the popover where Roam's own preview would open: right, then
    // left, then below or above it, never over it.
    const r = beside || pop.getBoundingClientRect();
    const height = Math.min(MAX_HEIGHT, pane.scrollHeight || MAX_HEIGHT);
    let left = r.right + GAP;
    let top = r.top;
    if (left + WIDTH > win.innerWidth) {
      if (r.left - GAP - WIDTH >= 0) left = r.left - GAP - WIDTH;
      else {
        left = Math.max(0, Math.min(r.left, win.innerWidth - WIDTH));
        const below = r.bottom + GAP;
        const above = Math.max(0, r.top - GAP - height);
        const hits = (y) => avoid && left < avoid.right && left + WIDTH > avoid.left && y < avoid.bottom && y + height > avoid.top;
        if (below + height <= win.innerHeight && !hits(below)) top = below;
        else if (!hits(above)) top = above;
        else top = below + height <= win.innerHeight ? below : above;
      }
    }
    Object.assign(pane.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${WIDTH}px`, height: "", maxHeight: `${MAX_HEIGHT}px` });
    pane.classList.remove("burrow-preview-docked");
  }

  function scrollToTarget() {
    const target = outline.querySelector(".burrow-target");
    if (!target) { pane.scrollTop = 0; return; }
    const top = target.offsetTop - trailNode.offsetHeight;
    const bottom = target.offsetTop + target.offsetHeight;
    if (top < pane.scrollTop) pane.scrollTop = Math.max(0, top - 4);
    else if (bottom > pane.scrollTop + pane.clientHeight) pane.scrollTop = bottom - pane.clientHeight + 4;
  }

  return {
    node: pane,
    show(model, popover, { avoid = null, beside = null } = {}) {
      if (pop && pop !== popover) pop.classList.remove(DRILL_CLASS);
      pop = popover;
      if (!beside) pop.classList.add(DRILL_CLASS);
      const changed = model.key !== shownKey || pane.hidden;
      if (model.key !== shownKey) { render(model); shownKey = model.key; }
      pane.hidden = false;
      place(avoid, beside);
      if (changed) scrollToTarget();
    },
    hide() {
      pane.hidden = true;
      shownKey = null;
      if (pop) pop.classList.remove(DRILL_CLASS);
      pop = null;
    },
  };
}
