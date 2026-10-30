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
  queryFilters: true,
  filterAllBlocks: true,
  richRows: true,
  betterMatch: true,
  drill: true,
  drillPreview: true,
  drillNearTitle: true,
  tabDrill: true,
  paneLayout: true,
  keyHints: true,
  recentRows: true,
  frecency: true,
  pageBoost: true,
  rowPreview: true,
  previewImages: true,
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
  insertVariants: true,
  openInSidebar: true,
  previewTables: true,
  semanticRows: true,
  semanticRelated: true,
  suggestRows: false,
  tagRows: true,
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
  ["refPreselect", "Pre-select the referenced original", "The first referenced block starts selected, so Enter inserts it, unless another block has exactly the typed text. A pasted block uid finds that block. ↓ past it returns to Roam's rows."],
  ["refProse", "Prose before code in ((", "Burrow's (( rows match a block's own words: code blocks, inline code and the insides of {{embed}}, {{roam/render}} and other macros count only when what you type looks like code (it has ( ) . _ = or the like). A block of more than 64 words ranks after shorter blocks that match as well, and a match inside a [[page]] or #tag the block links comes first among equals. Off: code counts like any text and length does not count (0.6.1)."],
  ["queryFilters", "Query filters", "In (( and [[, \"quoted words\" must stand together, -word leaves out blocks with that word, in:here keeps blocks on this page, in:Page Title (to the next filter or the end; an alias works) keeps that page's blocks, ns:Systems/ keeps pages under Systems/, is:todo and is:done keep open or done tasks. Only a word with its colon, quotes or leading - is a filter; Roam's own list gets the text as typed. Off: every word is search text, as in 0.8.1."],
  ["filterAllBlocks", "Filters search every block", "With is:todo, is:done, in:here, in:Page or ns: in ((, Burrow also searches blocks nobody references yet: it asks Roam's own search for the words (or reads the named page's blocks) after a short pause and applies the filters, so its rows are no longer only referenced blocks. A block whose words stand together or start as you typed comes before one with the words scattered; on equal footing referenced blocks come first. These rows never start selected. Inserts stay ((uid)). Nothing is read without one of these filters. Needs Query filters and Referenced blocks first in ((. Off: filtered rows come from referenced blocks only, as in 0.12.0."],
  ["richRows", "Rows drawn like Roam", "Burrow's (( rows, the drill panel and the previews draw a block as Roam does: a code block as its language and first line of code, inline code in a monospace face, [[links]], #tags and ((block refs)) as references, bold, italic, highlight and strike, embeds, queries, roam/render and SmartBlock buttons as small labels, images and files as labels. A long block shows the part around what you typed. Off: plain text, as in 0.6.1."],
  ["betterMatch", "Forgiving matching", "Abbreviations, initialisms and small typos for Burrow's rows. Off: separator-insensitive word matches only."],
  ["drill", "Drill-down in [[", "Type [[Page#heading > child to reach a block inside a page; Enter inserts its ((uid)). Only when the text before # or > is an exact page title or alias."],
  ["drillNearTitle", "Drill from a near title", "[[Executor Lanes#grok drills when one page clearly wins the match on the text before # or >: it is the only match, or the only one of a few where the heading or child you typed exists. The row names the page. Titles that really hold # or > stay Roam's, and a drill never creates a page."],
  ["drillPreview", "Drill-down preview", "Shows the page outline around the block a drill-down resolves to, or around the highlighted block after Tab, highlighted. Drill-down still works without it."],
  ["tabDrill", "Tab drills in", "Tab on the highlighted page lists the blocks on that page, and on a referenced block with children lists the children of that block, in place under a breadcrumb. Type to filter, ↑/↓ to move, Enter inserts the block's ((uid)), Tab goes one level deeper, Shift+Tab or Backspace on an empty filter goes back, Esc returns to the results. With nothing to drill into, Tab does what Roam does."],
  ["paneLayout", "Keep panes apart", "Roam's preview, roam-aliases' column and the result list each get their own space in the picker; nothing is drawn over anything else."],
  ["keyHints", "Key hints", "A line at the bottom of the picker naming the keys that do something for the highlighted row, RefX style: on an alias row ↵ pick alias · ⌥↓ more aliases · ⇥ blocks on this page (only when the page has blocks) · ⌥A add alias; on a referenced block ↵ insert ref · ⇥ children of this block · ⇧⇥ parent; in the drill panel ↵ insert · ⇥/> children · ⇧⇥ up (back at the top) · esc results · ⌃O preview."],
  ["helpTips", "Hover tips", "Hovering a Burrow row, alias chip, preview or key hint shows what it is and which key does what with it, in Roam's colors."],
  ["helpSheet", "Key list (⌥/, F1 or ?)", "⌥/ (Alt+/) or F1 (fn+F1 on a Mac keyboard, any layout) while the picker is open, or the ? at the end of the hint line, lists every key Burrow adds, grouped, for the switches that are on. It covers the picker, so Esc, ⌥/, F1, Enter or Tab only closes it (Enter never picks a row hidden under it); any other key closes it and goes on as usual."],
  ["helpNudge", "First-run tip", "The first time the picker opens, the hint line ends with “⌥/ all keys”, once. ✕ hides it; it never comes back."],
  ["refContext", "Where the block lives", "Under the highlighted referenced block in ((, a line with its page and parent (Page › … › Parent) and how many children Tab lists."],
  ["refOutline", "Up and down the outline", "On a highlighted referenced block, Shift+Tab lists its parent's children with the block highlighted (Shift+Tab again goes higher, Enter inserts the highlighted one), and Tab lists its children under the block's whole trail."],
  ["insertVariants", "Insert variants (⇧↵ embed, ⌥↵ label)", "On a highlighted Burrow row, drill row or drill panel row: Shift+Enter inserts an embed ({{[[embed]]: ((uid))}} for a block, {{[[embed]]: [[Page]]}} for a page); Alt+Enter inserts a labelled link: [label](((uid))) for a block, where the label is what you typed (or the block's first 40 characters when you typed nothing), and [alias]([[Page]]) for an alias row whatever the Alias link format says. On Roam's own rows these keys stay Roam's."],
  ["openInSidebar", "Open in sidebar (⌘⇧↵ or ⇧+click)", "On a highlighted Burrow row, drill row or drill panel row, Cmd+Shift+Enter (Ctrl+Shift+Enter off a Mac) or Shift+click opens that page or block in Roam's right sidebar. The block you are typing in keeps its text and the picker stays open."],
  ["previewTables", "Tables in the preview", "When the highlighted block in a preview (the drill-down preview, a Burrow row with Roam's preview open, or the list after Tab) is a {{[[table]]}} or {{table}} block, its first 6 rows and 5 columns show under it as a small read-only grid, each cell cut at about 40 characters and drawn like Roam (with Rows drawn like Roam on), with +R rows, +C cols when the table is bigger. One small read per shown row, kept until the popup closes. {{[[roam/grid]]}} large grids keep their label. Off: the table's rows show as an outline, as in 0.9.0."],
  ["semanticRows", "Related rows (Roam semantic search)", "When Roam's semantic search is on for the graph (Settings > Graph), up to three Related rows from it show under Roam's results in (( and [[, after you pause typing a phrase of two or more words. Each lookup sends what you typed after the (( or [[ to the embedding provider set in Settings > Graph; in an encrypted graph the query text still goes to that provider. Roam keeps extension settings per graph, so this switch is kept per graph: turn it off in any graph where that is not wanted. ⌥R (Alt+R) moves into the Related rows, ↑/↓ move inside them, Esc goes back to Roam's rows. Enter inserts a Related row only when it is highlighted, by those keys or by the mouse; otherwise it does what it did before."],
  ["semanticRelated", "Related to the highlighted block", "When Roam's semantic search is on for the graph (Settings > Graph) and a block or page row, a drill row or a drill panel row has been highlighted for half a second with a preview showing, up to four blocks related to it by meaning show at the bottom of that preview, inside its space: the preview does not grow. ⌥R (Alt+R) moves into them, ↑/↓ move inside them, Esc goes back to the highlighted row. Enter or Tab or a click inserts ((uid)); ⇧↵ ⌥↵ ⌘⇧↵ and ⇧+click work as on Burrow's rows. Each lookup sends the highlighted block's text (for a page, its title and first ten blocks, up to 600 characters) to the embedding provider set in Settings > Graph; in an encrypted graph that text still goes to the provider. Roam keeps extension settings per graph, so this switch is kept per graph: turn it off in any graph where that is not wanted. Independent of Related rows."],
  ["suggestRows", "Suggested links", "With an empty [[, up to three pages Roam's link suggestions find for the block you are editing show under a quiet Suggested label, after a short pause: ⌥R moves into them, Enter inserts the page. Each lookup gives the block's text to Roam's AI link suggestions, which can send it to Roam's AI provider, in encrypted graphs too. Kept per graph, off by default."],
  ["tagRows", "Burrow rows in #", "In Roam's # tag popup, Burrow's page rows above its list: alias rows with forgiving matching, frequent pages first, and with up to two characters typed the recent pages. #ns:Systems/ lists pages under Systems/, and #ns:Systems/la the ones whose title goes on with la. A row inserts #[[Page]]: a tag cannot carry an alias label. Nothing starts selected, so Enter still leaves what you typed; ↑ moves onto the rows. No drill-down, embeds or Related rows here. Off: the popup is Roam's alone."],
  ["rowPreview", "Preview follows Burrow's rows", "With Roam's preview open (Ctrl-O), a selected Burrow row shows its own page or block there: an alias row its page, a referenced block its place in the outline."],
  ["previewImages", "Images in the preview", "In the previews, the highlighted block's first image shows as a thumbnail (at most 240×160) under its line, +N when it has more. It loads after the row has been highlighted for 150 ms, only for that row; in an encrypted graph it is decrypted with Roam's file API and kept for the popup only (8 at most). Files over 5 MB and images that fail keep the image label with their alt text. Rows keep the label."],
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
