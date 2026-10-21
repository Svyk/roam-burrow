// Tab-drill panel: one body-level portal that takes the popover's place while
// a scope is open (the popover itself is only made invisible). Rows are
// rebuilt when the level, query or row list changes; moving the highlight
// touches classes only.
import { hintsKey, keyLabel, renderHints as paintHints } from "./hints.js";

const MAX_LABEL = 40;

export function createScopePanel({ doc, win, lifecycle, highlight }) {
  const node = doc.createElement("div");
  node.className = "burrow-scope bp3-elevation-3";
  node.setAttribute("role", "listbox");
  node.hidden = true;
  const crumb = doc.createElement("div");
  crumb.className = "burrow-scope-crumb";
  const list = doc.createElement("div");
  list.className = "burrow-scope-list";
  const hintsLine = doc.createElement("div");
  hintsLine.className = "burrow-scope-hints";
  node.append(crumb, list, hintsLine);
  lifecycle.node(node, doc.body);
  let listKey = null;

  const span = (className, textContent) => Object.assign(doc.createElement("span"), { className, textContent });
  const ellipsize = (text) => (text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text);

  function renderCrumb(scope) {
    const level = scope.levels[scope.levels.length - 1];
    const parts = [span("burrow-crumb burrow-crumb-root", scope.rootLabel)];
    scope.levels.forEach((l, i) => {
      parts.push(span("burrow-sep", " › "));
      const part = span("burrow-crumb", ellipsize(l.label));
      part.dataset.level = String(i);
      parts.push(part);
    });
    const filter = span("burrow-scope-filter", level.query || "type to filter");
    filter.classList.toggle("burrow-placeholder", !level.query);
    crumb.replaceChildren(...parts, filter);
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
      if (row.text) text.append(highlight(row.text, level.query));
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
  function renderHints(scope, on) {
    hintsLine.hidden = !on;
    if (!on) return;
    const level = scope.levels[scope.levels.length - 1];
    const active = scope.rows[level.active];
    const items = [];
    if (active?.drillable) items.push(["⇥/>", "drill"]);
    items.push(["⇧⇥", "back"], [keyLabel("ctrlO"), "preview"], ["↵", active?.more != null ? "more" : "insert"], ["esc", "results"]);
    const key = hintsKey(items);
    if (key === hintsShown) return;
    hintsShown = key;
    paintHints(doc, hintsLine, items);
  }

  function paintActive(scope, hintsOn) {
    const level = scope.levels[scope.levels.length - 1];
    list.querySelectorAll(".burrow-row").forEach((item, i) => {
      const on = i === level.active;
      item.classList.toggle("burrow-active", on);
      item.setAttribute("aria-selected", String(on));
      if (on) item.scrollIntoView?.({ block: "nearest" });
    });
    renderHints(scope, hintsOn);
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
    show(scope, hintsOn) {
      renderCrumb(scope);
      renderList(scope);
      node.hidden = false;
      paintActive(scope, hintsOn);
    },
    paintActive,
    place,
    hide() {
      node.hidden = true;
      listKey = null;
      hintsShown = null;
    },
  };
}
