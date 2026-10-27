// One switch per feature (Svy decision 2026-10-17). Handlers read settings at
// the start of each event, so a change applies on the next keystroke.
export const DEFAULTS = Object.freeze({
  aliasPages: true,
  aliasExpand: true,
  aliasInline: true,
  aliasPreselect: true,
  aliasChips: true,
  aliasUsage: true,
  aliasPrefix: true,
  refRanking: true,
  refPreselect: true,
  refProse: true,
  richRows: true,
  betterMatch: true,
  drill: true,
  drillPreview: true,
  tabDrill: true,
  paneLayout: true,
  keyHints: true,
  recentRows: true,
  frecency: true,
  pageBoost: true,
  rowPreview: true,
  aliasCreate: false,
  aliasDelete: false,
  drillOrdinals: true,
  drillEmpty: true,
  drillCap: true,
  refSearch: true,
  refSearchHotkey: false,
  helpTips: true,
  helpSheet: true,
  helpNudge: true,
  refContext: true,
  refOutline: true,
  // Not a switch: set once the first-run line has been shown.
  helpNudgeSeen: false,
  aliasKeyword: "Aliases",
  aliasLinkFormat: "[alias]([[Page]])",
  perfHud: false,
});

const SWITCHES = [
  ["aliasPages", "Alias rows in [[", "Typing a page alias in [[ shows the page. With Alias rows with their page off, aliases roam-aliases already lists are left to its column."],
  ["aliasExpand", "Alias expansion in ((", "In ((, an alias also finds referenced blocks that link to its page."],
  ["aliasInline", "Alias rows with their page", "One row per page an alias matches, alias ↳ Page with its reference count, also when roam-aliases is installed: its Aliases column folds into these rows instead of lying beside or over Roam's list. Off: Burrow leaves aliases that roam-aliases lists to its column."],
  ["aliasPreselect", "Pre-select the alias row", "When an alias starts with what you typed and no page has exactly that title, its row starts selected, so Enter inserts it."],
  ["aliasChips", "Alias chips", "Under a selected alias row, the page's other aliases as chips. ⌥↓ moves into them, ←/→ picks one (the line also scrolls with the mouse wheel or trackpad, and a chip shows its full alias when selected or hovered), Enter inserts the page shown as that alias, Esc goes back to the rows."],
  ["aliasUsage", "Order alias chips by use", "Chips under an alias row start with the alias you link most: each is counted by how many times [alias]([[Page]]) appears in your graph, most used first, ties in the alias block's order. A chip's tip adds ×N. Counted once at idle (about 75 ms for 24 alias pages in svy), never while typing. Off: the alias block's order."],
  ["aliasPrefix", "alias: prefix", "Type [[alias:lo to see only alias rows for lo (up to three), then Roam's list as usual. Enter inserts [alias]([[Page]]) in place of the whole [[alias:lo]]. Nothing else (recent rows, pages, drill-down) shows for that text. Off: [[alias:lo is an ordinary search."],
  ["refRanking", "Referenced blocks first in ((", "Shows up to three already-referenced blocks above Roam's results, originals before blocks that quote them."],
  ["refPreselect", "Pre-select the referenced original", "The first referenced block starts selected, so Enter inserts it. ↓ past it returns to Roam's rows."],
  ["refProse", "Prose before code in ((", "Burrow's (( rows match a block's own words: code blocks, inline code and the insides of {{embed}}, {{roam/render}} and other macros count only when what you type looks like code (it has ( ) . _ = or the like). A block of more than 64 words ranks after shorter blocks that match as well, and a match inside a [[page]] or #tag the block links comes first among equals. Off: code counts like any text and length does not count (0.6.1)."],
  ["richRows", "Rows drawn like Roam", "Burrow's (( rows, the drill panel and the previews draw a block as Roam does: a code block as its language and first line of code, inline code in a monospace face, [[links]], #tags and ((block refs)) as references, bold, italic, highlight and strike, embeds, queries, roam/render and SmartBlock buttons as small labels, images and files as labels. A long block shows the part around what you typed. Off: plain text, as in 0.6.1."],
  ["betterMatch", "Forgiving matching", "Abbreviations, initialisms and small typos for Burrow's rows. Off: separator-insensitive word matches only."],
  ["drill", "Drill-down in [[", "Type [[Page#heading > child to reach a block inside a page; Enter inserts its ((uid)). Only when the text before # or > is an exact page title or alias."],
  ["drillPreview", "Drill-down preview", "Shows the page outline around the block a drill-down resolves to, or around the highlighted block after Tab, highlighted. Drill-down still works without it."],
  ["tabDrill", "Tab drills in", "Tab on the highlighted page lists the blocks on that page, and on a referenced block with children lists the children of that block, in place under a breadcrumb. Type to filter, ↑/↓ to move, Enter inserts the block's ((uid)), Tab goes one level deeper, Shift+Tab or Backspace on an empty filter goes back, Esc returns to the results. With nothing to drill into, Tab does what Roam does."],
  ["paneLayout", "Keep panes apart", "Roam's preview, roam-aliases' column and the result list each get their own space in the picker; nothing is drawn over anything else."],
  ["keyHints", "Key hints", "A line at the bottom of the picker naming the keys that do something for the highlighted row, RefX style: on an alias row ↵ pick alias · ⌥↓ more aliases · ⇥ blocks on this page (only when the page has blocks) · ⌥A add alias; on a referenced block ↵ insert ref · ⇥ children of this block · ⇧⇥ parent; in the drill panel ↵ insert · ⇥/> children · ⇧⇥ up (back at the top) · esc results · ⌃O preview."],
  ["helpTips", "Hover tips", "Hovering a Burrow row, alias chip, preview or key hint shows what it is and which key does what with it, in Roam's colors."],
  ["helpSheet", "Key list (⌥/, F1 or ?)", "⌥/ (Alt+/) or F1 (fn+F1 on a Mac keyboard, any layout) while the picker is open, or the ? at the end of the hint line, lists every key Burrow adds, grouped, for the switches that are on. It covers the picker, so Esc, ⌥/, F1, Enter or Tab only closes it (Enter never picks a row hidden under it); any other key closes it and goes on as usual."],
  ["helpNudge", "First-run tip", "The first time the picker opens, the hint line ends with “⌥/ all keys”, once. ✕ hides it; it never comes back."],
  ["refContext", "Where the block lives", "Under the highlighted referenced block in ((, a line with its page and parent (Page › … › Parent) and how many children Tab lists."],
  ["refOutline", "Up and down the outline", "On a highlighted referenced block, Shift+Tab lists its parent's children with the block highlighted (Shift+Tab again goes higher, Enter inserts the highlighted one), and Tab lists its children under the block's whole trail."],
  ["rowPreview", "Preview follows Burrow's rows", "With Roam's preview open (Ctrl-O), a selected Burrow row shows its own page or block there: an alias row its page, a referenced block its place in the outline."],
  ["aliasCreate", "Create aliases from the picker (writes to your graph)", "⌥A (Alt+A) on a highlighted page in [[ opens an alias field. Enter adds the alias to that page's alias block (creating the block if there is none) and inserts the aliased link; Esc cancels. Changes only that one block. Off by default."],
  ["aliasDelete", "Delete aliases from the chips (writes to your graph)", "Alt+Backspace on the selected alias chip asks to confirm; Enter removes only that alias from the page's alias block, Esc keeps it. Off by default."],
  ["drillOrdinals", "Ordinal matching in drill-down", "While drilled in, typing 1, 2, (b) or iii ranks blocks that start with that number or letter first."],
  ["drillEmpty", "Hide empty blocks in drill-down", "Empty blocks without children are left out of the drill list; empty blocks with children show as (empty) ▸ and stay drillable."],
  ["drillCap", "Long levels in slices", "A drill level lists 50 blocks and a +N more row; selecting it lists the next 50, so huge pages open fast."],
  ["refSearch", "Block reference search command", "Adds Burrow: block reference search to the command palette: it opens (( at the caret of the block you are editing. Any key can be bound to it with the palette's Edit Hotkey entry, or use the switch below."],
  ["refSearchHotkey", "Alt+Shift+9 opens block reference search", "While editing a block, Alt+Shift+9 (⌥⇧9) opens (( at the caret. Off by default; Roam has no default use for this key."],
  ["recentRows", "Recent rows", "With up to two characters typed after (( or [[, up to three rows: the blocks or pages you picked most recently, then the ones edited most recently. Nothing is selected, so Enter does what Roam does; ↑ moves onto them. Picks are kept in this browser only, as uids and times; Burrow: forget recent picks clears them."],
  ["frecency", "Frequent first", "Among rows that match equally well and have as many references, the ones you pick more often and more recently come first, for any query. Kept in this browser only (uids and times, at most 500); replaces Pick memory."],
  ["pageBoost", "Current page first", "Among equal referenced blocks in ((, blocks on the page you are editing rank first."],
  ["perfHud", "Performance readout", "Shows Burrow's per-key cost (p50/p95) in the corner. Also at window.__BURROW_PERF."],
];

export function createSettingsReader(extensionAPI) {
  return (id) => {
    const value = extensionAPI.settings.get(id);
    return value == null ? DEFAULTS[id] : value;
  };
}

export function createSettingsPanel({ onChange } = {}) {
  const changed = (id) => (event) => onChange?.(id, event);
  return {
    tabTitle: "Burrow",
    settings: [
      ...SWITCHES.map(([id, name, description]) => ({
        id, name, description, action: { type: "switch", onChange: changed(id) },
      })),
      {
        id: "aliasKeyword",
        name: "Alias attribute",
        description: "The attribute that holds a page's aliases. Use the same value as roam-aliases' Keyword. Matched without case.",
        action: { type: "input", placeholder: DEFAULTS.aliasKeyword, onChange: changed("aliasKeyword") },
      },
      {
        id: "aliasLinkFormat",
        name: "Alias link format",
        description: "What an alias row inserts in [[.",
        action: { type: "select", items: ["[alias]([[Page]])", "[[Page]]"], onChange: changed("aliasLinkFormat") },
      },
    ],
  };
}

// A Roam switch renders unchecked for an unset key, so store the defaults once.
export async function initializeSettings(extensionAPI) {
  if (extensionAPI.settings.canSet === false) return;
  for (const [id, value] of Object.entries(DEFAULTS)) {
    if (extensionAPI.settings.get(id) == null) await extensionAPI.settings.set(id, value);
  }
}
