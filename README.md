# Burrow

A Roam Research extension that adds to Roam's own `[[` page search and `((` block search. It never replaces them: Roam's rows stay where they are, and Burrow shows at most three rows of its own at the top of Roam's list column, in its own room above Roam's results, so nothing of Roam's is ever under them. There is one highlight at a time, and Enter does what it shows.

- **Alias rows in `[[`.** Type a page alias and the page shows up as one row, `alias ↳ Page Title` with its reference count. Picking it inserts `[alias]([[Page Title]])`, the same text roam-aliases writes. Aliases come from `Aliases:: a, b` blocks, read without case. When an alias starts with what you typed and no page has exactly that title, the row starts selected, so Enter takes it.
- **Alias chips.** Under the selected alias row, all of the page's aliases as chips (`aliases: Lori  lori  lorinator`). ⌥↓ moves into them, ←/→ picks one (the line scrolls to it when they don't all fit; the mouse wheel and trackpad scroll it too, so any chip can be clicked), Enter inserts the page shown as that alias. At either end of the line, the wheel scrolls Roam's list again. The selected chip shows its whole alias, and every chip has it as a tooltip.
- **Preview follows Burrow's rows.** With Roam's preview open (Ctrl-O), a selected alias row shows its page there, and a selected referenced block its place in the outline. It reads only the blocks it shows, in slices under the per-key budget, so a page with thousands of blocks opens about as fast as a small one: even the ids of a node's children come in pages (one id query, then their order 150 at a time).
- **Create and delete aliases** (both off by default, they write to your graph). ⌥A on a highlighted page in `[[` opens a small alias field: type a name, Enter adds it to the page's `Aliases::` block (or creates that block) and inserts `[name]([[Page]])`, Esc cancels. A name with `#`, `[ ]`, `(( ))`, `{{ }}`, `::` or a comma is refused, with the reason in the field (Roam would turn it into a tag, link or attribute and create a page). Alt+Backspace on a selected chip asks to confirm, Enter removes that one alias. Nothing else in the graph changes.
- **Block reference search.** The command palette entry **Burrow: block reference search** opens `((` at the caret of the block you are editing. Alt+Shift+9 does the same once you turn it on, and the palette's **Edit Hotkey** entry binds any other key to it.
- **Tab drills in.** Tab on the highlighted page (Roam's row or Burrow's) lists the blocks on that page in place under a breadcrumb (`Pages › Lori Boyd`, and a line saying `DRILL blocks on this page`), with a preview of the highlighted block beside the list (labelled `PREVIEW`). Type to filter, Enter inserts the block's `((uid))`, Tab goes deeper, Shift+Tab goes back. A referenced block in `((` drills the same way. With nothing to drill into, Tab is Roam's. Typing `1`, `2`, `(b)` or `iii` puts blocks that start with that number or letter first; empty blocks without children are left out, empty ones with children show as `(empty) ▸`; a long level lists 50 blocks and a `+N more` row for the next 50.
- **One popup, no overlap.** roam-aliases' Aliases column folds into Burrow's rows; when it stays (aliases Burrow does not show), it gets its own band above Roam's list. Roam's preview keeps its own column.
- **Learn it from the picker.** A hint line at the bottom names only the keys that do something for what is highlighted, and what Tab lists: `↵ pick alias · ⌥↓ more aliases · ⇥ blocks on this page · ⌥A add alias` on an alias row, `↵ insert ref · ⇥ children of this block · ⇧⇥ parent` on a block row (⇥ only when there is something under it). Hovering a row, chip, preview or hint shows what it is and its keys, in Roam's colors, beside the picker so it never covers a row. ⌥/, F1 (any keyboard layout; fn+F1 on a Mac keyboard) or the `?` at the end of the hint line lists every Burrow key, grouped (Pick, Aliases, Drill, Preview), for the switches that are on, and names the alias keys that are off with the switch that turns them on. The list covers the picker, so Esc, Enter or Tab only closes it: Enter never picks a row hidden under it. Any other key closes it and goes on. The first picker says `⌥/ all keys` once.
- **Referenced blocks first in `((`.** Blocks that other blocks already reference are ranked: the original before the blocks that quote it, then by inbound refs. The top original starts selected, so Enter inserts it. TODO and DONE show as Roam's own (read-only) checkboxes, in the rows, the preview and the drill list; a macro that only starts like one (a SmartBlock button such as `{{TODO today:SmartBlock:…}}`) stays text, as Roam draws it.
- **Prose before code in `((`.** Burrow's rows match a block's own words: code blocks, inline code and what sits inside macros (`{{embed}}`, `{{roam/render}}`, `{{query}}`) count only when what you type looks like code (`((panel.grid`, `((library(gg`). A block of more than 64 words ranks after shorter blocks that match as well, and a match inside a page or tag the block links comes first among equals. `((black pan` lists `Watch [[Black Panther]]`, not the R scripts that set `color = "black"` before `panel.grid`.
- **Rows drawn like Roam.** Burrow's rows, the drill panel and the previews draw a block as Roam does: a code block as its language (`R`) and its first line of code, inline code in a monospace face, links, tags and block refs (resolved to their text) as references in the theme's colors, bold, italic, highlight and strike, embeds, queries, `roam/render` and SmartBlock buttons, images and files as small labels. A long block shows the part around what you typed. Text only: nothing in a block can turn into HTML.
- **Where the block lives.** Under the highlighted block row, a quiet line with its page and parent (`in MCU Watch Order › Watch Order (…)`) and how many children Tab lists (`⇥ 2 children`, counted up to `100+`).
- **Up and down the outline.** On a highlighted block row, Shift+Tab lists its parent's children with the block highlighted; Shift+Tab again goes higher, Enter inserts the highlighted one, so you can pick the parent or a sibling instead. Tab lists the block's children under its whole trail (`Blocks › MCU Watch Order › Watch Order › Watch Agents…`).
- **Insert as embed, as a labelled link, or open in the sidebar.** On a highlighted Burrow row, drill row or drill panel row, ⇧↵ inserts an embed (`{{[[embed]]: ((uid))}}` for a block, `{{[[embed]]: [[Page]]}}` for a page), ⌥↵ a labelled link (`[ant man](((uid)))` with what you typed as the label, or the block's first 40 characters when you typed nothing; `[alias]([[Page]])` on an alias row, whatever the alias link format), and ⌘⇧↵ or ⇧+click opens the page or block in Roam's right sidebar: the text stays as you typed it and the picker stays open. On Roam's own rows these keys stay Roam's (⇧↵ its newline). Hold ⇧, ⌥ or ⌘ for a moment on a Burrow row and the hint line becomes `⇧↵ embed · ⌥↵ label · ⌘⇧↵ sidebar` (typing a capital never flickers it); the tips show exactly what each would insert, and the key list names all three.
- **Alias expansion in `((`.** An alias also finds referenced blocks that link to its page.
- **Forgiving matching.** `ant man` finds `[[Ant-Man]]`, `EMP 26` finds `EMP26-002-BHP`, `mcu` finds `Marvel Cinematic Universe`, small typos are forgiven. Numbers never fuzz.
- **Drill-down in `[[`.** Type a page, then `#` for a heading on it and `>` for a child one level down: `[[Systems/Executor Lanes and LaunchAgents#grok lane > never`. A preview shows the page outline around that block, highlighted, with the trail of its parents. Enter inserts the block's `((uid))`. If nothing below the page matches, Enter inserts `[[Page]]`, so a drill-down never creates a page.
- **Pick memory** (off by default). A row you picked ranks first among equal matches the next time you type the same query.
- **Current page first.** Among equal referenced blocks in `((`, blocks on the page you are editing come first.

The look follows Roam's popup: its colors, font and ref counts, light and dark. No badges.

## Keyboard

Burrow takes keys only while one of its rows is selected, on Tab over a row it can drill into, and while drilled in. The pointer moving over a Burrow row selects it, so there is only ever one highlight.

| Key | Burrow row selected | Roam row selected |
|---|---|---|
| ↑ | previous Burrow row | from Roam's first row: Burrow's last row |
| ↓ | next Burrow row; past the last, back to Roam | Roam |
| Enter | insert the Burrow row; if the text changed under it, nothing is inserted and the rows are ranked again (Enter never goes on to a Roam row that was not highlighted) | Roam |
| ⇧↵ | insert the row as an embed (when Insert variants is on) | Roam (a newline) |
| ⌥↵ | insert `[label](((uid)))`, or `[alias]([[Page]])` on an alias row (when Insert variants is on) | Roam |
| ⌘⇧↵ (Ctrl+Shift+↵ off a Mac), ⇧+click | open the row's page or block in the right sidebar; the text and the picker stay (when Open in sidebar is on) | Roam |
| Tab | page or alias row: the blocks on the page; block row: its children; nothing under it: insert the row | `[[`: the blocks on the page; nothing to drill into: Roam |
| ⇧⇥ | block row: up to its parent, the block highlighted (when Up and down the outline is on) | Roam |
| ⌥↓ | alias row: move into its chips | Roam |
| ⌥A | alias row: alias field for its page (when alias creation is on) | `[[` page row: alias field for that page (when on); otherwise Roam |
| ⌥/ or F1 (fn+F1 on a Mac) | Burrow's key list (when the key list is on) | the same |
| Esc | hand selection back to Roam; Roam closes the popup | Roam |

In the alias chips: ←/→ (or ↑/↓) move, Enter inserts with that alias, Tab drills into the page, Alt+Backspace asks to delete that alias (when alias deletion is on; Enter deletes, Esc keeps), Esc or ⌥↑ goes back to the rows.

In the alias field (⌥A): type the name (the typed query is there, selected, so the first key replaces it), Backspace deletes, paste, IME or dead-key input (⌥E then E for é), the emoji picker and a drop work, Enter saves the alias and inserts the link, Esc goes back to the picker. The block keeps exactly the `[[…` you typed until Enter.

While drilled in (Tab), Burrow holds the keyboard and the block keeps exactly the `[[…` you typed:

| Key | Does |
|---|---|
| letters, space | filter the blocks of this level (shown in the breadcrumb, never typed into the block) |
| ↑ / ↓ | move |
| Enter | insert the highlighted block's `((uid))` in place of the whole `[[…]]`; with no block left, insert the level itself; on `(empty) ▸`, go into it; on `+N more`, list the next 50 |
| ⇧↵ / ⌥↵ | insert it as an embed / as `[filter](((uid)))` (the block's first 40 characters with no filter) |
| ⌘⇧↵, ⇧+click | open it in the right sidebar; the panel stays open |
| Tab or `>` | one level deeper (rows with children carry a `›`) |
| Shift+Tab | one level back; from the first level, back to the results |
| Backspace | delete a filter character; on an empty filter, one level back |
| Ctrl-O | show or hide the preview beside the list |
| Esc | back to the results (a second Esc is Roam's) |
| mouse | click a block to insert it, `(empty) ▸` or `+N more` to open it, a crumb to go back to that level; clicking outside ends the drill and leaves the text as typed |
| ← → Home End | leave the drill, the caret moves as usual |

While a drill-down is on (the text before `#` or `>` is a page title or alias), Burrow's one row is selected: Enter inserts it, Tab drills into its children (or inserts it when it has none), ↑ and ↓ do nothing, Esc goes to Roam. Delete the `#` or `>` and Roam's search is back.

Burrow writes only the `((…))` or `[[…]]` you are typing, and only if the text before the caret is still exactly what it ranked (⇧↵, ⌥↵ and ⌘⇧↵ too). When the caret moves (a click, ← or →), Burrow ranks again for the text before it, as Roam does; with the caret back inside a token that closes further on (`((agen|t))`) the popup is Roam's alone, with its own highlight, until the caret is back at the end. The one exception to "only the token" is the opt-in alias switches: ⌥A and Alt+Backspace change one page's alias block, nothing else.

| Key | While drilled in after ⇧⇥ or Tab on a block row |
|---|---|
| ⇧⇥ | one level up the block's trail: the parent's children, the parent highlighted; from the page level, back to the results |
| Tab or `>` | into the highlighted block's children |
| Enter | insert the highlighted block's `((uid))` |
| a crumb | jump to that level |

## Drill-down

- `title` must be an exact page title or `Aliases::` entry, ignoring case and separators. `[[Executor Lanes#x` does nothing when the page is `Systems/Executor Lanes and LaunchAgents`.
- `#q` matches headings anywhere on the page; an empty `#` takes the first heading. `> q` matches the direct children of the block so far (or the page's top level); an empty `>` takes the first child. Each step takes the best match, ties in outline order. Type more to reach another sibling.
- Titles that contain `#` or `>` stay Roam's: when a page with content is named like the text you are typing (`C#`, `a > b`), Burrow stays out of the way.
- The preview lies over Roam's own preview area when that is open (Ctrl-O), and beside the popup otherwise. It is read-only text.
- Esc leaves the text as you typed it. Roam then makes a page of that name when it saves the block, exactly as it would without Burrow; Burrow ignores such empty pages.
- Tab on the resolved block lists its children (the Tab drill above); on a block without children it inserts it.

## Settings

Every feature has its own switch under **Settings → Burrow**: alias rows, alias rows with their page, alias pre-select, alias chips, alias expansion, referenced-first ranking, pre-select, prose before code, rows drawn like Roam, forgiving matching, drill-down, drill-down preview, Tab drill, keep panes apart, key hints, hover tips, key list (⌥/, F1 or ?), first-run tip, where the block lives, up and down the outline, insert variants (⇧↵ embed, ⌥↵ label), open in sidebar (⌘⇧↵ or ⇧+click), preview follows Burrow's rows, ordinal matching, hide empty blocks, long levels in slices, the block reference search command and its Alt+Shift+9 key (off by default), create aliases and delete aliases (both off by default: they write to your graph), pick memory (off by default, kept in this browser only), current page first, and a performance readout. **Alias attribute** should match roam-aliases' Keyword (default `Aliases`). **Alias link format** picks `[alias]([[Page]])` or `[[Page]]`. The command palette has **Burrow: Disable all features**.

## Working with roam-aliases

Burrow reads the roam-aliases convention and leaves `Aliases::` blocks to roam-aliases, unless you turn on **Create aliases** or **Delete aliases**. An alias edited anywhere else (by hand, in roam-aliases, by an undo) reaches Burrow in under half a second (0.37–0.41 s measured), through a watch on the alias page; the page is watched even before it exists, so in a graph with no alias page yet the first alias typed by hand arrives the same way. With the switches on, ⌥A appends one name to the page's alias block (creating `Aliases:: name` as the page's first block when it has none) and Alt+Backspace on a chip removes one name, keeping every other byte of the block. Aliases are the comma list on the block's first line; a second line is left alone. With **Alias rows with their page** on, Burrow lists aliases in Roam's list (keyboard and mouse) and hides roam-aliases' rows for pages it already shows, so no alias appears twice; rows Burrow does not show stay in roam-aliases' column, which **Keep panes apart** lays out above Roam's list instead of over it. With that switch off, Burrow leaves aliases roam-aliases lists to its column, as in 0.2.0. Both write the same `[alias]([[Page]])` text.

## Cost

Burrow builds its indexes once at idle (datalog queries for referenced blocks and page titles, a pull of the alias page's references for the aliases) and refreshes them at most once a minute. The refresh's referenced-blocks query holds the main thread (about 0.26 s in svy, and Roam offers no way to run it elsewhere), so it never starts while a popup is open or within 2 s of a key: a popup only marks the index due, and the rebuild waits for the next quiet moment. Alias edits refresh the aliases alone, from the pull Roam's watch hands over, in idle tasks of at most about 3 ms (the new alias keys of the blocks that link the edited page go in slices). A keystroke runs only a JavaScript match over the in-memory index: no queries. The one pull a key can cause is the hint line's has-children check, `(limit :block/children 1)`, 0.1–0.3 ms once per page or block highlighted. A drill-down reads the page lazily: one small pull the first time it reaches a block (that block, its children and grandchildren), one heading lookup per page, all kept until the popup closes. A Tab drill reads the same way: one pull per level it opens. Alias reference counts are one more idle query. The match runs right after the frame that shows the typed character, so it never delays that paint, and Burrow reads layout only in a frame callback, where the browser lays the page out anyway: read in the match task, it would lay out Roam's own popover changes early, on Burrow's time. Rows drawn like Roam parse a block once (kept by uid and text until the index is rebuilt) and add a few spans per row; the drill panel draws its first 12 rows that way at once and the rest at idle, and a preview stops drawing after 1 ms in a key's work (past the highlighted line) and finishes in idle slices. `window.__BURROW_PERF.summary()` reports p50/p95 per key.

## Development

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check   # build, secret scan, syntax check, tests, generated-artifact drift
```

`src/` is the source; `extension.js`, `extension.css` and `deploy/` are generated and committed together with it. `tools/` holds the live gates that drive Roam Desktop over CDP (port 9223), on a scratch `Burrow/Fixtures` page they create and remove. They need both Roam windows open (svy unlocked) and never reload a window. When a window already has Burrow installed (svy runs the Depot URL build), the gates and `tools/dev-load.mjs` park it in memory while they run: its handlers go idle and its nodes and stylesheet come out. The gates put it back when they finish, also after a failure; after `dev-load.mjs <window> load`, run `dev-load.mjs <window> unload`.

```bash
npm run gate:live                            # everything below, both graphs, about 40 minutes, PASS/FAIL summary (add -- --theme light|dark, -- --notes "Readwisenotes - Daily" when two notes windows are open)
node tools/live-gate.mjs Svy svy             # about 12 min: acceptance, byte-for-byte (on/off/gone/drill off) incl. drill cases and Svy's footnote case, alias rows, block navigation, pick memory, fast typing, rows drawn like Roam, text boxes in 32 picker states
node tools/live-gate.mjs Readwisenotes notes # about 11 min
node tools/live-gate.mjs Svy svy --only "alias chips: ⌥↓, ←, Enter"   # one case and its verdict, about 30 s
node tools/live-gate.mjs Svy svy --only "text boxes: no text overlaps another in any picker state"   # no text over other text, about 3 min
node tools/perf-gate.mjs Svy --runs 3        # about 3 min: per-key cost and input-to-paint, Burrow on vs absent
node tools/perf-gate.mjs Svy --runs 3 --drill # the same while typing a drill-down with the preview open
node tools/perf-gate.mjs Svy --runs 3 --preview # (( typing with Roam's preview open, where Burrow's rows draw their own preview (its idle slices also <= 4 ms p95)
node tools/perf-gate.mjs Svy --runs 2 --cold "[[plexus"  # first draws of a large page's preview, one cold popup at a time
node tools/live-gate.mjs Svy svy --theme light   # any gate in light or dark mode (svy follows the emulated OS theme; in notes, whose svy-theme mode is fixed, the gate switches svy-theme's classes for the run; nothing is saved)
node tools/shots.mjs Svy svy --label after --theme light   # before/after screenshots of every picker state (--only 21,24 for some)
```

A run that crashes or is stopped with Ctrl-C leaves no fixture behind: Ctrl-C runs the cleanup, and a ledger in the system temp folder lets the next run remove exactly what a killed run created. A page Roam made from the gate's typing (an unclosed `[[x`) is deleted only if it is empty, nothing links to it and the gate itself typed its title, so a page another device or job writes during a run is left alone. Keep the display awake for a long run (`caffeinate -d node tools/…`): with the display asleep, svy's window once stopped answering at the gate's first step and crashed when the display woke.

Each prints a short summary; add `--json` for the full record.

The design is in `docs/spec.md`.

Install: Roam **Settings → Roam Depot → Developer Extensions → URL**, `https://OWNER.github.io/roam-burrow` (no `/extension.js`).

## License

[MIT](LICENSE). The search scorer is ported from [thymer-reference-extravaganza](https://github.com/Svyk/thymer-reference-extravaganza) (MIT).
