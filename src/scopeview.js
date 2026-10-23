// Tab-drill panel: one body-level portal that takes the popover's place while
// a scope is open (the popover itself is only made invisible). Rows are
// rebuilt when the level, query or row list changes; moving the highlight
// touches classes only.
import { hintsKey, keyLabel, renderHints as paintHints } from "./hints.js";
import { checkbox } from "./tasks.js";

const MAX_LABEL = 40;
// Crumbs above the last one are cut shorter, so the level the list shows
// stays readable on a long trail (page › parent › block).
const MAX_ANCESTOR = 22;

export function createScopePanel({ doc, win, lifecycle, highlight }) {
  const node = doc.createElement("div");
  node.className = "burrow-scope bp3-elevation-3";
  node.setAttribute("role", "listbox");
  node.hidden = true;
  const crumb = doc.createElement("div");
  crumb.className = "burrow-scope-crumb";
  // What the list is: a page's blocks or a block's children (Tab drills).
  const what = doc.createElement("div");
  what.className = "burrow-scope-what";
  const list = doc.createElement("div");
  list.className = "burrow-scope-list";
  const hintsLine = doc.createElement("div");
  hintsLine.className = "burrow-scope-hints";
  const hintsList = doc.createElement("span");
  hintsList.className = "burrow-hints-list";
  const helpButton = doc.createElement("span");
  helpButton.className = "burrow-help-button";
  helpButton.setAttribute("role", "button");
  helpButton.setAttribute("aria-keyshortcuts", "Alt+/");
  helpButton.setAttribute("aria-label", `Burrow keys (${keyLabel("altSlash")})`);
  helpButton.textContent = "?";
  hintsLine.append(hintsList, helpButton);
  node.append(crumb, what, list, hintsLine);
  lifecycle.node(node, doc.body);
  let listKey = null;

  const span = (className, textContent) => Object.assign(doc.createElement("span"), { className, textContent });
  const ellipsize = (text, max = MAX_LABEL) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

  function renderCrumb(scope) {
    const level = scope.levels[scope.levels.length - 1];
    const parts = [span("burrow-crumb burrow-crumb-root", scope.rootLabel)];
    scope.levels.forEach((l, i) => {
      parts.push(span("burrow-sep", " › "));
      const part = span("burrow-crumb", ellipsize(l.label, i < scope.levels.length - 1 && scope.levels.length > 2 ? MAX_ANCESTOR : MAX_LABEL));
      part.title = l.label;
      part.dataset.level = String(i);
      parts.push(part);
    });
    const filter = span("burrow-scope-filter", level.query || "type to filter");
    filter.classList.toggle("burrow-placeholder", !level.query);
    crumb.replaceChildren(...parts, filter);
    const label = level.isPage ? "blocks on this page" : "children of this block";
    what.replaceChildren(span("burrow-tag", "Drill"), level.isPage ? `${label}` : `${label}: ${ellipsize(level.label)}`);
  }

  function renderList(scope) {
    const level = scope.levels[scope.levels.length - 1];
    const more = scope.rows.reduce((sum, r) => sum + (r.more ?? 0), 0);
    const key = `${level.uid}\u0000${level.query}\u0000${more}\u0000${scope.rows.map((r) => r.uid).join(",")}`;
    if (key === listKey) return;
    listKey = key;
    if (!scope.rows.length) {
      const self = doc.createElement("div");
      self.className = "burrow-row burrow-self";
      self.setAttribute("role", "option");
      self.dataset.index = "0";
      self.append(span("burrow-muted", "Insert "), level.label);
      list.replaceChildren(self);
      return;
    }
    list.replaceChildren(...scope.rows.map((row, i) => {
      const item = doc.createElement("div");
      item.className = "burrow-row";
      item.setAttribute("role", "option");
      item.dataset.index = String(i);
      if (row.more != null) {
        item.classList.add("burrow-more-row");
        item.textContent = `+${row.more} more`;
        return item;
      }
      if (row.heading) item.classList.add(`burrow-h${row.heading}`);
      const text = doc.createElement("span");
      text.className = "burrow-text";
      if (row.parts) for (const part of row.parts) text.append(part.task ? checkbox(doc, part.task, part.status) : highlight(part.text.trim(), level.query));
      else if (row.text) text.append(highlight(row.text, level.query));
      else if (row.drillable) {
        item.classList.add("burrow-empty-row");
        text.append(span("burrow-empty", "(empty) ▸"));
      } else text.append(span("burrow-empty", "(empty)"));
      item.append(text);
      if (row.drillable && row.text) item.append(span("burrow-drill-mark", "›"));
      return item;
    }));
  }

  let hintsShown = null;
  let hintItems = [];
  function renderHints(scope, on, help) {
    hintsLine.hidden = !on;
    helpButton.hidden = !help;
    if (!on) return;
    const level = scope.levels[scope.levels.length - 1];
    const active = scope.rows[level.active];
    const items = [];
    if (active?.drillable) items.push(["⇥/>", "its children", "Go into the highlighted block: its children are listed here"]);
    items.push(
      ["⇧⇥", scope.levels.length > 1 ? "up" : "back", scope.levels.length > 1 ? "One level up the outline: the parent's children, the parent highlighted (Backspace on an empty filter too)" : "Back to the results (Backspace on an empty filter too)"],
      [keyLabel("ctrlO"), "preview", "Show or hide the preview of the highlighted block"],
      ["↵", active?.more != null ? "more" : "insert", active?.more != null ? "List the next 50 blocks" : "Insert the highlighted block's ((uid)) in place of the whole [[…]]"],
      ["esc", "results", "Back to Roam's results; the text stays as you typed it"],
    );
    const key = hintsKey(items);
    if (key === hintsShown) return;
    hintsShown = key;
    hintItems = items;
    paintHints(doc, hintsList, items);
  }

  // scroll: bring the active row into view (keys); a hover never scrolls.
  function paintActive(scope, hintsOn, helpOn = false, scroll = true) {
    const level = scope.levels[scope.levels.length - 1];
    list.querySelectorAll(".burrow-row").forEach((item, i) => {
      const on = i === level.active;
      item.classList.toggle("burrow-active", on);
      item.setAttribute("aria-selected", String(on));
      if (on && scroll) item.scrollIntoView?.({ block: "nearest" });
    });
    renderHints(scope, hintsOn, helpOn);
  }

  // anchor: the rect the panel takes over; below: the popover opens under the
  // text (so the panel hangs from its top), else it sits above (bottom edge).
  function place(anchor, popRect, taRect) {
    const above = popRect.top + popRect.height / 2 < taRect.top;
    node.style.left = `${Math.round(anchor.left)}px`;
    node.style.width = `${Math.round(anchor.width)}px`;
    if (above) {
      node.style.top = "auto";
      node.style.bottom = `${Math.round(win.innerHeight - popRect.bottom)}px`;
    } else {
      node.style.bottom = "auto";
      node.style.top = `${Math.round(popRect.top)}px`;
    }
  }

  return {
    node,
    show(scope, hintsOn, helpOn = false) {
      renderCrumb(scope);
      renderList(scope);
      node.hidden = false;
      paintActive(scope, hintsOn, helpOn);
    },
    get hintItems() { return hintItems; },
    paintActive,
    place,
    hide() {
      node.hidden = true;
      listKey = null;
      hintsShown = null;
    },
  };
}
