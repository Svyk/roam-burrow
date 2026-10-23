// Burrow's key list (⌥/ or the ? on the hint line): every key Burrow adds,
// grouped, for the switches that are on. Keys of switches that are off are
// left out; the two that write to the graph are named with where to turn
// them on. The sheet takes the popover's place, like the Tab drill panel.
import { IS_MAC, keyLabel } from "./hints.js";

const WIDE = 620;

// groups: [{ title, items: [[keys, what]], notes: [text] }]
export function helpGroups(setting, mac = IS_MAC) {
  const k = (name) => keyLabel(name, mac);
  const on = (id) => Boolean(setting(id));
  const groups = [];
  const pick = { title: "Pick", items: [], notes: [] };
  if (on("aliasPages") || on("refRanking")) pick.items.push(["↑ ↓", "move; ↑ on Roam's first row enters Burrow's"]);
  pick.items.push(["↵", "insert the selected row, or click it"], ["esc", "back to Roam's rows"]);
  if (on("refRanking")) pick.items.push(["((", "referenced blocks first"]);
  if (on("refSearch") && on("refSearchHotkey")) pick.items.push([k("altShift9"), "open (( at the caret"]);
  groups.push(pick);

  const aliases = { title: "Aliases", items: [], notes: [] };
  if (on("aliasPages")) aliases.items.push(["[[alias", setting("aliasLinkFormat") === "[[Page]]" ? "↵ inserts [[Page]]" : "↵ inserts [alias]([[Page]])"]);
  if (on("aliasPages") && on("aliasChips")) aliases.items.push([k("altDown"), "the page's other aliases, ←→"]);
  if (on("aliasCreate")) aliases.items.push([k("altA"), "add an alias to the page"]);
  if (on("aliasDelete") && on("aliasChips")) aliases.items.push([k("altBackspace"), "delete the selected alias"]);
  const off = [];
  if (!on("aliasCreate")) off.push(`${k("altA")} add (Create aliases)`);
  if (!on("aliasDelete")) off.push(`${k("altBackspace")} delete (Delete aliases)`);
  if (off.length) aliases.notes.push(`Off, they write to your graph: ${off.join(", ")}. Settings → Burrow turns them on.`);
  // ⌥⌫ acts on the selected chip, so it needs the chips too.
  if (on("aliasDelete") && !(on("aliasPages") && on("aliasChips"))) {
    aliases.notes.push(`${k("altBackspace")} deletes the selected alias chip: turn on ${on("aliasPages") ? "Alias chips" : "Alias rows in [[ and Alias chips"} (Settings → Burrow) to use it.`);
  }
  groups.push(aliases);

  const drill = { title: "Drill", items: [], notes: [] };
  if (on("tabDrill")) {
    drill.items.push(["⇥ or >", "on a page: the blocks on it; on a block: its children"], ["⇧⇥ or ⌫", "one level back up"], ["type", "filter the list"]);
    if (on("drillOrdinals")) drill.items.push(["1 (b) iii", "numbered blocks first"]);
    drill.items.push(["esc", "back to the results"]);
  }
  if (on("refOutline")) drill.items.push(["⇧⇥", "on a block row: up to its parent, the block highlighted"]);
  if (on("drill")) drill.items.push(["# >", "[[Page#heading > child"]);
  if (drill.items.length) groups.push(drill);

  const preview = { title: "Preview", items: [], notes: [] };
  preview.items.push([k("ctrlO"), on("rowPreview") ? "Roam's preview, for Burrow's rows too" : "Roam's preview"]);
  if (on("tabDrill") && on("drillPreview")) preview.items.push([k("ctrlO"), "in a drill: its own preview"]);
  groups.push(preview);
  return groups;
}

export function createHelpSheet({ doc, win, lifecycle }) {
  const node = doc.createElement("div");
  node.className = "burrow-help bp3-elevation-3";
  node.setAttribute("role", "dialog");
  node.setAttribute("aria-label", "Burrow keys");
  node.hidden = true;
  lifecycle.node(node, doc.body);
  let shownKey = null;
  const el = (tag, className, textContent) => Object.assign(doc.createElement(tag), { className, ...(textContent != null ? { textContent } : {}) });

  function render(groups, closeKey) {
    const head = el("div", "burrow-help-head");
    head.append(el("span", "burrow-help-title", "Burrow keys"), el("span", "burrow-help-close", `${closeKey}, F1 or esc closes`));
    const grid = el("div", "burrow-help-grid");
    for (const group of groups) {
      const box = el("div", "burrow-help-group");
      box.append(el("div", "burrow-help-group-title", group.title));
      for (const [keys, what] of group.items) {
        const line = el("div", "burrow-help-item");
        line.append(el("span", "burrow-help-key", keys), el("span", "burrow-help-what", what));
        box.append(line);
      }
      for (const note of group.notes) box.append(el("div", "burrow-help-note", note));
      grid.append(box);
    }
    const foot = el("div", "burrow-help-foot", `Every key has its own switch in Settings → Burrow. Opens with ${closeKey}, F1 (any keyboard layout; fn+F1 on a Mac keyboard) or the ? on the hint line.`);
    node.replaceChildren(head, grid, foot);
  }

  // anchor: the rect the sheet takes over (the popover, or the drill panel);
  // above: the popover sits above the text, so the sheet keeps its bottom edge.
  // Opened on purpose, it may run wider (two columns) and taller than the
  // popover, never past the window.
  function place(anchor, taRect) {
    const above = taRect ? anchor.top + anchor.height / 2 < taRect.top : false;
    const width = Math.min(Math.max(anchor.width, WIDE), win.innerWidth - 16);
    node.style.left = `${Math.round(Math.max(0, Math.min(anchor.left, win.innerWidth - width)))}px`;
    node.style.width = `${Math.round(width)}px`;
    node.classList.toggle("burrow-wide", width >= WIDE);
    if (above) {
      node.style.top = "auto";
      node.style.bottom = `${Math.round(win.innerHeight - anchor.bottom)}px`;
      node.style.maxHeight = `${Math.round(Math.min(440, anchor.bottom - 8))}px`;
    } else {
      node.style.bottom = "auto";
      node.style.top = `${Math.round(anchor.top)}px`;
      node.style.maxHeight = `${Math.round(Math.min(440, win.innerHeight - anchor.top - 8))}px`;
    }
  }

  return {
    node,
    get open() { return !node.hidden; },
    show(groups, closeKey, anchor, taRect) {
      const key = JSON.stringify(groups) + closeKey;
      if (key !== shownKey) { render(groups, closeKey); shownKey = key; }
      place(anchor, taRect);
      node.hidden = false;
      node.scrollTop = 0;
    },
    hide() { node.hidden = true; },
  };
}
