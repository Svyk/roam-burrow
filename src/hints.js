export const IS_MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");

const NAMED = {
  altA: ["⌥A", "Alt+A"],
  altDown: ["⌥↓", "Alt+↓"],
  altBackspace: ["⌥⌫", "Alt+⌫"],
  ctrlO: ["⌃O", "Ctrl+O"],
  altSlash: ["⌥/", "Alt+/"],
  altShift9: ["⌥⇧9", "Alt+Shift+9"],
};

export function keyLabel(name, mac = IS_MAC) {
  const pair = NAMED[name];
  return pair ? pair[mac ? 0 : 1] : name;
}

// ⌥/ by the character, not the key's position: on a mac ⌥/ types ÷ (⌥⇧/ ¿),
// elsewhere Alt+/ keeps the /. On a layout where the US / position holds
// another key (German -), ⌥ with that key still types its own character.
const ALT_SLASH = new Set(["/", "÷", "?", "¿"]);
export const isAltSlash = (e) => e.altKey && !e.ctrlKey && !e.metaKey && ALT_SLASH.has(e.key);
// F1 opens the key list on every layout, also where no ⌥ chord types / (a
// German Mac keyboard has / on ⇧7); it types nothing, so nothing is lost.
export const isHelpKey = (e) => isAltSlash(e) || (e.key === "F1" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey);

export function hintsKey(items) {
  return items.map(([keys, label]) => `${keys}\u0000${label}`).join("\u0001");
}

// The picker's hint line, contextual (spec §14): only keys that do something
// for what is highlighted now, each [keys, label, tip] (the tip is the hover
// text). Pure: the strip says what it knows.
//   s.kind "[[" | "(("; s.prompt null | "add" | "delete"; s.chips: in the chips;
//   s.row (a Burrow row holds the selection): { kind: "alias" | "ref" | "drill",
//     chips: more aliases to pick, drill: Tab drills into it, aliasNew: ⌥A applies };
//   s.native (Roam's [[ row holds it): { drill, aliasNew } or null;
//   s.rowsAbove: Burrow rows are shown and ↑ from Roam's first row enters them;
//   s.on: { tabDrill, drill, aliasDelete, pageOnly (alias link format [[Page]]), refOutline }.
// The drill key names what Tab lists: a page's blocks or a block's children.
export function pickerHints(s, mac = IS_MAC) {
  const on = s.on || {};
  const k = (name) => keyLabel(name, mac);
  const PAGE = "blocks on this page";
  const BLOCK = "children of this block";
  const drillHint = (what) => ["⇥", what, `Tab lists the ${what} in place: type to filter, ↵ inserts one, ⇧⇥ comes back`];
  const upHint = ["⇧⇥", "parent", "Shift+Tab goes up: the parent's children, this block highlighted; ⇧⇥ again goes higher, ↵ inserts the highlighted one"];
  const addAlias = [k("altA"), "add alias", "Add an alias to this page's Aliases:: block and insert it (writes to your graph)"];
  if (s.prompt === "add") return [["↵", "save alias", "Add it to the page's Aliases:: block, then insert the link"], ["esc", "cancel", "Back to the picker; nothing is written"]];
  if (s.prompt === "delete") return [["↵", "delete", "Remove only this alias from the page's alias block"], ["esc", "keep", "Keep the alias"]];
  const items = [];
  const row = s.row;
  if (row && s.chips) {
    items.push(["←→", "alias", "Choose another alias of this page"]);
    if (on.aliasDelete) items.push([k("altBackspace"), "delete", "Delete the selected alias from the page (asks first)"]);
    items.push(["↵", "insert", "Insert the page shown as the selected alias"]);
    if (row.drill && on.tabDrill) items.push(drillHint(PAGE));
    items.push(["esc", "rows", "Back to the rows"]);
    return items;
  }
  if (row?.kind === "alias") {
    items.push(["↵", "pick alias", on.pageOnly ? "Insert [[Page]]" : "Insert [alias]([[Page]])"]);
    if (row.chips) items.push([k("altDown"), "more aliases", "Move into the page's other aliases: ←→ choose, ↵ inserts the page shown as that alias"]);
    if (row.drill && on.tabDrill) items.push(drillHint(PAGE));
    if (row.aliasNew) items.push(addAlias);
    return items;
  }
  if (row?.kind === "ref") {
    items.push(["↵", "insert ref", "Insert this block's ((uid)): the original other blocks already reference"]);
    if (row.drill && on.tabDrill) items.push(drillHint(BLOCK));
    if (on.refOutline) items.push(upHint);
    return items;
  }
  if (row?.kind === "drill") {
    items.push(["↵", "insert block", "Insert the ((uid)) of the block the drill-down reaches"]);
    if (row.drill && on.tabDrill) items.push(["⇥/>", BLOCK, "Tab lists the children of this block; typing > goes one level down"]);
    else if (row.drill && on.drill) items.push([">", "next level", "Type > and a few words to reach one of its child blocks"]);
    if (on.refOutline && row.block) items.push(upHint);
    return items;
  }
  if (s.rowsAbove) items.push(["↑", s.kind === "((" ? "referenced" : "alias rows", "From Roam's first row, ↑ moves into Burrow's rows above it"]);
  if (s.kind === "[[" && s.native) {
    if (s.native.drill && on.tabDrill) items.push(drillHint(PAGE));
    if (s.native.aliasNew) items.push(addAlias);
  }
  return items;
}

export function renderHints(doc, node, items) {
  const span = (className, textContent) => Object.assign(doc.createElement("span"), { className, textContent });
  const parts = [];
  items.forEach(([keys, label], i) => {
    if (i) parts.push(span("burrow-hint-sep", " · "));
    const item = span("burrow-hint", "");
    item.dataset.hint = String(i);
    item.append(span("burrow-hint-key", keys), ` ${label}`);
    parts.push(item);
  });
  node.replaceChildren(...parts);
}
