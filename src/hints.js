export const IS_MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");

const NAMED = {
  altA: ["⌥A", "Alt+A"],
  altDown: ["⌥↓", "Alt+↓"],
  altBackspace: ["⌥⌫", "Alt+⌫"],
  ctrlO: ["⌃O", "Ctrl+O"],
  altSlash: ["⌥/", "Alt+/"],
  altR: ["⌥R", "Alt+R"],
  altShift9: ["⌥⇧9", "Alt+Shift+9"],
  shiftEnter: ["⇧↵", "Shift+↵"],
  altEnter: ["⌥↵", "Alt+↵"],
  sidebarEnter: ["⌘⇧↵", "Ctrl+Shift+↵"],
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
//   s.kind "[[" | "((" | "#"; s.prompt null | "add" | "delete"; s.chips: in the chips;
//   s.row (a Burrow row holds the selection): { kind: "alias" | "page" | "ref" | "drill",
//     chips: more aliases to pick, drill: Tab drills into it, aliasNew: ⌥A applies };
//   s.native (Roam's [[ row holds it): { drill, aliasNew } or null;
//   s.rowsAbove: Burrow rows are shown and ↑ from Roam's first row enters them (s.recentAbove: all of them recent rows);
//   s.related: "available" (the Related band has rows) | "active" (one of them holds the selection) | null;
//   s.footer: the same for the Related footer under the preview: "available" | "active" | null;
//   s.on: { tabDrill, drill, aliasDelete, pageOnly (alias link format [[Page]]), refOutline,
//     insertVariants, openInSidebar }; s.held: ⇧, ⌥ or ⌘ held on a Burrow row (the line
//     is full already, so the variants take its place while a modifier is held).
// The drill key names what Tab lists: a page's blocks or a block's children.
export function pickerHints(s, mac = IS_MAC) {
  if (s.related === "active") {
    return [["↵", "insert", "Insert the highlighted Related row (from Roam's semantic search)"], ["↑↓", "move", "Move between the Related rows"], ["esc", "back", "Back to Roam's rows"]];
  }
  if (s.footer === "active") {
    return [["↵", "insert", "Insert the highlighted block related to the previewed one (Roam's semantic search)"], ["↑↓", "move", "Move between the related blocks under the preview"], ["esc", "back", "Back to the highlighted row"]];
  }
  const items = baseHints(s, mac);
  // Not in the alias chips, a prompt or the held-modifier variants: those lines name only their own keys.
  // One ⌥R item whether the footer, the band or both are there (the footer comes first).
  if ((s.related === "available" || s.footer === "available") && !s.prompt && !s.chips && !s.held) {
    const tip = s.footer === "available" ? "Move into the blocks related to the highlighted one (Roam's semantic search)" : "Move into the Related rows from Roam's semantic search";
    items.push([keyLabel("altR", mac), "related", tip]);
  }
  return items;
}

function baseHints(s, mac) {
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
  if (s.held && row) {
    const variants = variantHints(row, on, mac);
    if (variants.length) return variants;
  }
  if (row && s.chips) {
    items.push(["←→", "alias", "Choose another alias of this page"]);
    if (on.aliasDelete) items.push([k("altBackspace"), "delete", "Delete the selected alias from the page (asks first)"]);
    items.push(["↵", "insert", "Insert the page shown as the selected alias"]);
    if (row.drill && on.tabDrill) items.push(drillHint(PAGE));
    items.push(["esc", "rows", "Back to the rows"]);
    return items;
  }
  if (row?.kind === "alias") {
    items.push(["↵", on.tag ? "insert" : "pick alias", on.tag ? "Insert #[[Page]]: a tag cannot carry an alias label" : on.pageOnly ? "Insert [[Page]]" : "Insert [alias]([[Page]])"]);
    if (row.chips) items.push([k("altDown"), "more aliases", "Move into the page's other aliases: ←→ choose, ↵ inserts the page shown as that alias"]);
    if (row.drill && on.tabDrill) items.push(drillHint(PAGE));
    if (row.aliasNew) items.push(addAlias);
    return items;
  }
  if (row?.kind === "page") {
    items.push(["↵", "insert", on.tag ? "Insert #[[Page]]" : "Insert [[Page]]"]);
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
  if (s.rowsAbove) items.push(["↑", s.recentAbove ? "recent" : s.kind === "((" ? "referenced" : "alias rows", "From Roam's first row, ↑ moves into Burrow's rows above it"]);
  if (s.kind === "[[" && s.native) {
    if (s.native.drill && on.tabDrill) items.push(drillHint(PAGE));
    if (s.native.aliasNew) items.push(addAlias);
  }
  return items;
}

// ⇧↵ ⌥↵ ⌘⇧↵ on a highlighted Burrow row (insertVariants, openInSidebar): the
// whole line while ⇧, ⌥ or ⌘ is held; the tips and key list name them too.
// row.page: it is a page (alias row, a drill-down that reached only its page).
export function variantHints(row, on, mac = IS_MAC) {
  if (!row) return [];
  const items = [];
  const page = row.kind === "alias" || row.page;
  if (on.insertVariants) {
    items.push([keyLabel("shiftEnter", mac), "embed", page ? "Insert {{[[embed]]: [[Page]]}}" : "Insert {{[[embed]]: ((uid))}}"]);
    items.push([keyLabel("altEnter", mac), "label", row.kind === "alias" ? "Insert [alias]([[Page]]), whatever the Alias link format says"
      : page ? "Insert [what you typed]([[Page]])" : "Insert [what you typed](((uid))), or the block's first 40 characters when you typed nothing"]);
  }
  if (on.openInSidebar) items.push([keyLabel("sidebarEnter", mac), "sidebar", "Open it in Roam's right sidebar (or ⇧+click); the text stays as you typed it"]);
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
