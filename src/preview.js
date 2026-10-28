// Drill preview (spec §5): one read-only outline pane. With Roam's preview
// open (Ctrl-O) it lies exactly over Roam's preview area, whose content a
// reversible class on the popover hides; otherwise it sits beside the
// popover where Roam's preview would open. Text only: no Roam blocks are
// rendered, so a click cannot open an editor. TODO/DONE show as Roam's
// checkbox before the line's text.
import { plainText, renderParts } from "./rich.js";
import { hasTask, taskParts } from "./tasks.js";
import { firstImage } from "./thumbs.js";

const SIBLING_WINDOW = 24;
const CHILD_LIMIT = 16;
const ITEM_LIMIT = 80;
const GAP = 4;
const WIDTH = 400;
const MAX_HEIGHT = 300;
export const DRILL_CLASS = "burrow-drill";

// A reader for previewModel: { trail(uid), window(uid, from, size) -> { total,
// kids }, indexOf(parentUid, uid) } (src/pagetree.js full / bounded). A plain
// tree with children() and trail() (the unit tests) is adapted.
const readerOf = (tree) => (tree.window ? tree : {
  trail: (uid) => tree.trail(uid),
  window(uid, from, size) { const kids = tree.children(uid); return { total: kids.length, kids: kids.slice(from, from + size) }; },
  indexOf: (parentUid, uid) => tree.children(parentUid).findIndex((k) => k.uid === uid),
});

// model: { key, trail: [text], items: [{ text, string, depth, heading, target }] }
// Reads only what it shows: 16 children per level, 24 siblings around the
// target, so a page with thousands of blocks costs as much as a small one.
export function previewModel(result, tree, text, { hideEmpty = false, images = false } = {}) {
  const read = readerOf(tree);
  const { page, target } = result;
  const trailNodes = target ? read.trail(target.uid) : [];
  const parentUid = trailNodes.length ? trailNodes[trailNodes.length - 1].uid : page.uid;
  const trail = [page.title, ...trailNodes.slice(1).map((n) => text(n.string || ""))];
  const items = [];
  const emptyLeaf = (n) => hideEmpty && !text(n.string || "").trim() && Array.isArray(n.kids) && n.kids.length === 0;
  // A line with a task macro draws a checkbox before its text (CSS on the
  // line itself, so a line stays one element: src/extension.css).
  const task = (s) => (hasTask(s) ? taskParts(s).find((p) => p.task)?.task ?? null : null);
  // kids === null: has children not read yet (or not known).
  // Only the highlighted block's first image shows (src/thumbs.js).
  const withImage = (item, string) => { if (images && item.target) { const image = firstImage(string); if (image) item.image = image; } return item; };
  const mayHaveKids = (n) => n.kids == null || n.kids.length > 0;
  const pushKids = (uid, depth, levels) => {
    const { total, kids } = read.window(uid, 0, CHILD_LIMIT);
    for (const kid of kids) {
      if (items.length >= ITEM_LIMIT) return;
      if (emptyLeaf(kid)) continue;
      items.push({ uid: kid.uid, text: text(kid.string || ""), string: kid.string ?? "", task: task(kid.string), depth, heading: kid.heading, target: false });
      if (levels > 1 && mayHaveKids(kid)) pushKids(kid.uid, depth + 1, levels - 1);
    }
    if (total > CHILD_LIMIT) items.push({ more: total - CHILD_LIMIT, depth });
  };
  if (!target) {
    pushKids(page.uid, 0, 2);
    return { key: `page:${page.uid}`, trail, items };
  }
  const at = Math.max(0, read.indexOf(parentUid, target.uid));
  const { total } = read.window(parentUid, 0, 0);
  const from = Math.max(0, Math.min(at - Math.floor(SIBLING_WINDOW / 2), total - SIBLING_WINDOW));
  const siblings = read.window(parentUid, from, SIBLING_WINDOW).kids;
  if (from > 0) items.push({ more: from, depth: 0 });
  for (const sib of siblings) {
    const isTarget = sib.uid === target.uid;
    if (!isTarget && emptyLeaf(sib)) continue;
    items.push(withImage({ uid: sib.uid, text: text(sib.string || ""), string: sib.string ?? "", task: task(sib.string), depth: 0, heading: sib.heading, target: isTarget }, sib.string));
    if (isTarget) pushKids(target.uid, 1, 2);
  }
  if (from + SIBLING_WINDOW < total) items.push({ more: total - from - SIBLING_WINDOW, depth: 0 });
  if (!siblings.length) items.push(withImage({ uid: target.uid, text: text(target.string || ""), string: target.string ?? "", task: task(target.string), depth: 0, heading: target.heading, target: true }, target.string));
  return { key: `node:${target.uid}`, trail, items };
}

// rich(item) -> parts (src/rich.js) or null: a line is drawn as Roam draws the
// block (spans only where the block has markup), else as plain text.
export function createPreview({ doc, win, lifecycle, rich = null, thumbs = null }) {
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
  // The highlighted line's thumbnail box (src/thumbs.js): { key, box, image }.
  let thumb = null;
  let thumbSeen = false;
  // A model drawn again unchanged still has its box armed (a row change cancels the dwell).
  function rearmThumb() {
    if (thumb?.box.isConnected) thumbs.ensure(thumb.box, thumb.image, pane);
  }
  function dropThumb() {
    if (!thumb) return;
    thumbs.cancel(pane);
    thumb.box.remove();
    thumb = null;
  }

  // One element per line (the bullet is CSS): in svy's theme every node a
  // render adds costs style work, so the 0.4.0 three spans per line were
  // most of a draw.
  // Lines of the shown model not drawn yet (render with a line limit), and
  // where they go.
  let rest = null;
  let restAt = 0;
  // deadline: a performance.now() time after which no further line is written
  // (the line with the highlighted block always is); the rest stays in `rest`.
  function render(model, lines = Infinity, deadline = Infinity) {
    // The pane says what it is (src/extension.css draws "Preview" before the trail).
    trailNode.replaceChildren();
    model.trail.forEach((part, i) => {
      if (i) trailNode.append(Object.assign(doc.createElement("span"), { className: "burrow-sep", textContent: " › " }));
      trailNode.append(Object.assign(doc.createElement("span"), { className: "burrow-crumb", textContent: part }));
    });
    const first = model.items.slice(0, lines);
    thumbSeen = false;
    const wrote = writeLines(first, 0, deadline);
    rest = model.items.length > wrote ? model.items.slice(wrote) : null;
    restAt = wrote;
    // Lines of the last outline past this one's end go; those this one draws
    // later wait hidden.
    const kids = outline.children;
    if (thumbs && !thumbSeen) dropThumb();
    while (kids.length > model.items.length) kids[kids.length - 1].remove();
    for (let i = wrote; i < kids.length; i++) kids[i].hidden = true;
  }

  // Lines are written into the outline's existing line nodes (in svy a new
  // node costs about 0.06 ms to insert, a rewrite next to nothing); only
  // lines past the last outline's count are made.
  // Returns how many items were written; `min` of them whatever the deadline.
  function writeLines(items, from, deadline = Infinity, min = 0) {
    const kids = outline.children;
    const made = [];
    let lastTarget = -1;
    if (deadline !== Infinity) for (let i = 0; i < items.length; i++) if (items[i].target) lastTarget = i;
    let wrote = 0;
    for (; wrote < items.length; wrote++) {
      if (deadline !== Infinity && wrote >= min && wrote > lastTarget && performance.now() > deadline) break;
      const item = items[wrote];
      const row = kids[from + wrote] || doc.createElement("div");
      let cls = "burrow-node";
      if (item.more != null) cls += " burrow-more";
      else {
        if (item.heading) cls += ` burrow-h${item.heading}`;
        if (item.target) cls += " burrow-target";
        if (item.task) cls += ` burrow-task-${item.task}`;
      }
      if (row.className !== cls) row.className = cls;
      const depth = String(item.depth);
      if (row.style.getPropertyValue("--burrow-depth") !== depth) row.style.setProperty("--burrow-depth", depth);
      writeContent(row, item);
      if (thumbs) writeThumb(row, item);
      if (row.hidden) row.hidden = false;
      if (!row.parentNode) made.push(row);
    }
    if (made.length) outline.append(...made);
    return wrote;
  }

  // A line's content. A rich line remembers what it holds, so a line that is
  // still the same block is not rewritten (a rewrite replaces its nodes).
  function writeContent(row, item) {
    if (item.more == null && item.string != null && rich) {
      const key = `${item.uid}\u0000${item.string}`;
      if (row.__burrowLine === key) return;
      const parts = rich(item)?.filter((part) => !part.task);
      if (parts?.length) {
        row.__burrowLine = key;
        if (parts.every((part) => part.cls === "")) setText(row, plainText(parts) || " ");
        else row.replaceChildren(renderParts(doc, parts));
        return;
      }
    }
    row.__burrowLine = null;
    setText(row, item.more != null ? `+${item.more} more` : item.text || " ");
  }

  // The highlighted line's box is the line's last child, reserved before its
  // image loads; any other line holds none.
  function writeThumb(row, item) {
    if (item.target && item.image) {
      thumbSeen = true;
      const key = `${item.uid}\u0000${item.image.url}`;
      if (thumb?.key !== key) {
        thumb?.box.remove();
        thumb = { key, box: thumbs.box(item.image), image: item.image };
        thumbs.want(thumb.box, item.image, pane);
      } else thumbs.ensure(thumb.box, item.image, pane);
      if (thumb.box.parentNode !== row || thumb.box !== row.lastChild) row.append(thumb.box);
    } else if (thumb && thumb.box.parentNode === row) thumb.box.remove();
  }

  function setText(row, text) {
    if (row.childNodes.length === 1 && row.firstChild.nodeType === 3) {
      if (row.firstChild.data !== text) row.firstChild.data = text;
    } else row.textContent = text;
  }

  // Docked over Roam's preview: the rect is read before the pane is written,
  // so a draw at idle lays out no new nodes before the frame does.
  function dockRect(beside) {
    if (beside || !pop.classList.contains("rm-autocomplete__results--expanded")) return null;
    const native = pop.querySelector(".rm-autocomplete__preview");
    return native ? native.getBoundingClientRect() : null;
  }

  function dock(r) {
    Object.assign(pane.style, { left: `${Math.round(r.left)}px`, top: `${Math.round(r.top)}px`,
      width: `${Math.round(r.width)}px`, height: `${Math.round(r.height)}px`, maxHeight: "" });
    pane.classList.add("burrow-preview-docked");
  }

  function place(avoid, beside) {
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
    if (!target) { if (pane.scrollTop) pane.scrollTop = 0; return; }
    const top = target.offsetTop - trailNode.offsetHeight;
    const bottom = target.offsetTop + target.offsetHeight;
    if (top < pane.scrollTop) pane.scrollTop = Math.max(0, top - 4);
    else if (bottom > pane.scrollTop + pane.clientHeight) pane.scrollTop = bottom - pane.clientHeight + 4;
  }

  // The scroll to the highlighted line reads layout, so a docked draw leaves
  // it to the next frame, where layout runs anyway; `onFrame(ms)` gets its cost.
  let scrollFrame = null;
  const cancelScroll = () => { if (scrollFrame != null) { win.cancelAnimationFrame(scrollFrame); scrollFrame = null; } };
  lifecycle.add(cancelScroll);

  // Content written by fill() that show() has not placed and scrolled yet.
  let filled = false;
  return {
    node: pane,
    // Does this pane lie over `popover`'s preview area (its class hides Roam's)?
    drills: (popover) => !pane.hidden && pop === popover && pane.classList.contains("burrow-preview-docked"),
    // The model's lines only, no layout read: show() places them (in a frame).
    fill(model, popover, { budgetMs = Infinity } = {}) {
      if (pop && pop !== popover) pop.classList.remove(DRILL_CLASS);
      pop = popover;
      if (model.key === shownKey) { if (thumbs) rearmThumb(); return; }
      render(model, Infinity, performance.now() + budgetMs);
      shownKey = model.key;
      filled = true;
    },
    // inFrame: called from a frame callback, so the scroll runs now, in this frame.
    // lines: draw only that many lines now; more() draws the rest later.
    // budgetMs: stop writing lines after that long (past the highlighted one).
    show(model, popover, { avoid = null, beside = null, onFrame = null, inFrame = false, lines = Infinity, budgetMs = Infinity } = {}) {
      if (pop && pop !== popover) pop.classList.remove(DRILL_CLASS);
      pop = popover;
      // The class can grow the popover (min-height), so it goes on before the read.
      if (!beside) pop.classList.add(DRILL_CLASS);
      const docked = dockRect(beside);
      const changed = model.key !== shownKey || pane.hidden || filled;
      filled = false;
      if (model.key !== shownKey) { render(model, lines, performance.now() + budgetMs); shownKey = model.key; }
      else if (thumbs) rearmThumb();
      pane.hidden = false;
      if (docked) dock(docked);
      else place(avoid, beside);
      if (!changed) return;
      cancelScroll();
      if (!docked || inFrame) { scrollToTarget(); return; }
      scrollFrame = win.requestAnimationFrame(() => {
        scrollFrame = null;
        if (pane.hidden || shownKey !== model.key) return;
        const t0 = performance.now();
        scrollToTarget();
        onFrame?.(performance.now() - t0);
      });
    },
    // Lines show() left for later, `lines` more of them drawn now (appended:
    // the scroll stays).
    get pending() { return Boolean(rest) && !pane.hidden; },
    // Lines left for more(), shown or not yet (fill() leaves the pane hidden).
    get unfinished() { return Boolean(rest); },
    more(lines = Infinity, budgetMs = Infinity) {
      if (!rest || pane.hidden) return;
      const items = rest.slice(0, lines);
      const wrote = writeLines(items, restAt, performance.now() + budgetMs, 1);
      rest = wrote < rest.length ? rest.slice(wrote) : null;
      restAt += wrote;
    },
    hide() {
      cancelScroll();
      rest = null;
      pane.hidden = true;
      shownKey = null;
      filled = false;
      if (thumbs) dropThumb();
      if (pop) pop.classList.remove(DRILL_CLASS);
      pop = null;
    },
  };
}
