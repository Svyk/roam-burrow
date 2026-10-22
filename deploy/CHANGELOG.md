# Changelog

All notable changes to this project follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-10-20

### Added

- Hint line, contextual (`keyHints`): it names only the keys that do something for what is highlighted, `↵ pick alias · ⌥↓ more aliases · ⇥ drill · ⌥A add alias` on an alias row, `↵ insert ref · ⇥ drill` on a referenced block, `⇥ drill · ⌥A add alias` on Roam's page row, `↑ alias rows` / `↑ referenced` on Roam's first row, and leaves Ctrl-O and ↵ to Roam's own footer. It stays while the picker is open, also when nothing applies and the key list is off, so it never comes and goes while typing.
- Hover tips (`helpTips`, on): rows, chips, the alias field, the previews, the hint items and the drill panel show what they are and their keys, drawn in the popover's colors inverted (Blueprint's tooltip look), light and dark, never over the text being edited.
- Key list (`helpSheet`, on): ⌥/ (Alt+/, matched by the character typed, so ⌥ with another layout's key in that place still types) or the `?` at the end of the hint line lists every Burrow key, grouped Pick, Aliases, Drill, Preview, for the switches that are on; ⌥A and ⌥⌫ are named when off, with the switches that turn them on. It takes the popover's place; Esc or ⌥/ closes it, any other key closes it and goes on.
- First-run line (`helpNudge`, on): the first picker ends its hint line with `⌥/ all keys ✕`, once; seen is stored in the extension settings (`helpNudgeSeen`).
- `perf-gate --cold "[[query"`: first draws of a large page's row preview, one cold popup at a time. Every `perf-gate` run also times the alias refresh an outside edit sets off and holds its p95 to 4 ms. `gate-all --notes "<window>"` picks the notes window when two are open.
- Live gates: refused aliases (no page created), an alias added and removed outside Burrow, the chip wheel at both ends, over chips that fit and with Roam's list at its top, the drill hint with and without blocks, the hint line with the key list off, the key list, the first-run line, the hover tips, ⌥/ with the key list off. `tools/shots.mjs` shoots every hint state, the key list, the first-run line and the tips (`--only` for some).

### Fixed

- The alias field refuses `#` anywhere (`issue #42`, and `C#` too: once another alias follows it, `#,` is a tag), `[ ]`, `(( ))`, `{{ }}`, `::`, commas and line breaks, with the reason in the field (`no #: Roam would make a tag`); nothing is written and no page is created. The page name in the field gives way so the typed text and the reason stay readable.
- The chip line takes a vertical wheel only while it can still scroll that way; at either end, and over Burrow's rows, the wheel scrolls Roam's list. Horizontal swipes, Shift+wheel and a wheel Roam's list cannot take either stay the browser's, as over Roam's own list.
- The hint line says ⇥ drill only when the highlighted page or block has children (and Tab then drills).
- Row preview within the 4 ms budget: bounded reads (child ids, then only the blocks shown), idle slices that start no new read after 3 ms (a read begun just before can carry a slice past it), one element per line, no forced layout in the slice. svy, `((ant man`: slice p95 1.9–2.8 ms, max 3.2–4.4 ms (was 5.9 / 12 ms); with the machine under heavy load, p95 2.4–3.5 ms, max 3.1–6.1 ms. `perf-gate --preview` now holds the p95 to the budget. A page or block with more than about 400 blocks directly under it still costs one read of all their ids (about 8 ms at 1,000).
- Aliases edited outside Burrow (by hand, roam-aliases, an undo) reach the index in under half a second (0.37–0.41 s measured in svy and notes): a pull watch on each alias page fires only on alias blocks, the aliases are taken from the pull it hands over and swapped in (alias rows, drill-by-alias, `((` alias expansion), and an open popup re-ranks. Was: up to 60 s. The refresh runs in idle tasks (it was one 2.6–6.9 ms task): it takes the rows from the pull Roam's watch hands over instead of pulling again, swaps only when they changed, parses and keys only the alias block that changed, and gives the blocks that link a page whose aliases changed (found through a page-to-blocks map kept with the index) their new alias key in slices of at most 3 ms. svy, an edit of the most linked alias page: read ≤ 0.9 ms, swap 0.6–1.2 ms, re-key slices 0.5–1.0 ms p95. An alias edited while a full rebuild runs survives it. `perf-gate` times every kind of these tasks on an edit of the most linked alias page (74 blocks in svy) and holds each p95 to 4 ms. In a graph that had no alias page, the first alias typed by hand is watched from the next popup.

### Changed

- Burrow reads layout only in a frame callback. Placing the strip, the hint line and the preview used to read the list column's (or Roam's preview's) rect in the match task, after the paint; Roam changes its popover after that paint, so the read laid Roam's changes out early, on Burrow's time (2.6 ms p50 per key in svy). Now the content is written at once and placed in the frame, which paints both together. svy per key, with the machine under load: p95 2.7–3.2 ms in `((` (was 5.6–6.6 ms), 1.0–1.4 ms in a drill-down (was 3.8 ms); input-to-paint p50 within +1.2 ms of Burrow absent.
- Aliases are read with a pull of the alias page's references (1–2 ms in svy) instead of a datalog query that held svy's main thread for 70 ms; Burrow's own ⌥A and Alt+Backspace refresh the aliases the same way instead of a full rebuild.
- The previews take the pointer while hover tips are on: they scroll with the wheel, and a click on them does nothing (it used to fall through to the page).

## [0.4.0] - 2026-10-19

### Added

- Preview follows Burrow's rows (`rowPreview`): with Roam's preview open (Ctrl-O), a selected alias row shows its page there and a selected referenced block shows its place in the outline, instead of Roam's "Select a page to preview"; while the ⌥A field or the delete confirm is open, it shows that page.
- Create an alias from the picker (`aliasCreate`, **off by default**, writes to the graph): ⌥A on a highlighted page row in `[[` opens an alias field seeded with the query; Enter appends the alias to that page's alias block (or creates `Aliases:: alias` as its first block) and inserts `[alias]([[Page]])`; Esc cancels. Only that one block changes. IME and dead-key input (⌥E then E) compose into the field, and text that comes without a key (the emoji picker or Character Viewer, text dropped on the block) goes into it too; the block keeps exactly its `[[query`.
- Delete an alias from the chips (`aliasDelete`, **off by default**, writes to the graph): Alt+Backspace on the selected chip asks to confirm; Enter removes only that alias from the alias block, Esc keeps it.
- Ordinal matching in drill (`drillOrdinals`): `1`, `2`, `(b)`, `iii` rank blocks that start with that ordinal first, in the Tab-drill filter and in typed `> step` drills.
- Empty blocks in drill (`drillEmpty`): empty leaf blocks are left out of the list and the preview; empty blocks with children show as `(empty) ▸` and stay drillable; the first selected row skips them.
- Long levels in slices (`drillCap`): a drill level lists 50 blocks and a `+N more` row that lists the next 50; the drill preview caps each level with `+N more` too.
- Block reference search (`refSearch`): palette command **Burrow: block reference search** opens `((` at the caret of the block being edited (also after the palette took focus). Optional Alt+Shift+9 for it (`refSearchHotkey`, off by default; Roam has no default use for that key).
- Ctrl-O in the Tab-drill panel shows or hides its preview.
- Live gates: cases for every item above, mouse use in the drill panel (click a child, a crumb, click away), the popup opening above the text, a `--theme light|dark` flag, a cost run with Roam's preview open (`perf-gate --preview`, part of `gate:live`), and `tools/shots.mjs` for before/after screenshots. A crashed gate run leaves no fixture behind: the next run removes what the ledger lists, and Ctrl-C cleans up.

### Changed

- Aliases are read from an alias block's first line only, and ⌥A / Alt+Backspace change only that line: a note on a second line is no longer appended to, read as part of the last alias, or deleted with it. An alias may not have a `#` right before text, anywhere in it (`issue #42`, `c#x`): Roam would read it as a tag and link or create that page. `C#` alone is fine.
- Alias chips scroll with the mouse wheel or trackpad, so every chip can be clicked; each chip carries its full alias as a tooltip, and the selected chip grows to the whole line so a long alias shows in full.
- Key hints read like RefX: `⌥A alias · ⌥↓ pick alias · ⇥/> drill · ⌃O preview · ↵ insert` in the picker, `⇥/> drill · ⇧⇥ back · ⌃O preview · ↵ insert · esc results` in the drill panel.
- The gates' click-away case clicks Roam's top bar, so it no longer moves the main window.

## [0.3.0] - 2026-10-18

### Added

- Alias rows with their page (`aliasInline`): one row per page, `alias ↳ Page` with its reference count, also when roam-aliases is installed. roam-aliases' rows for pages Burrow shows are hidden, so no alias is listed twice; the rest stay in its column.
- Alias pre-select (`aliasPreselect`): when an alias starts with the typed text and no page has exactly that title, its row starts selected.
- Alias chips (`aliasChips`): the selected alias row's aliases as chips; ⌥↓ moves into them, ←/→ picks, Enter inserts with that alias. Chips keep their width and the line scrolls to the selected one, so long aliases never run together.
- Tab drill (`tabDrill`): Tab on the highlighted page (Roam's row or Burrow's), a referenced block in `((`, or a resolved drill-down lists its children in place under a breadcrumb, with a filter that never reaches the block, a preview of the highlighted child, Tab / `>` deeper, Shift+Tab back, Enter inserting the child's `((uid))`. Nothing to drill into: Tab is Roam's.
- Keep panes apart (`paneLayout`): roam-aliases' column becomes a band above Roam's list (preview closed) or above the list column (preview open) instead of lying over Roam's list or preview.
- Key hints (`keyHints`): a line under Roam's list naming Burrow's keys; the drill panel has its own.
- Idle query for alias pages' reference counts.

### Changed

- Burrow's rows, chips and hint line pad Roam's list column only, so Roam's preview keeps its full height. The padding is a static class per size (`burrow-pad-N`, `-Nc` with the chips): rewriting a stylesheet whenever the row count changed restyled the whole document and cost 3+ ms on those keys in a dark theme.
- Burrow tracks every open `[[` / `((` token (layout, fold, hints and Tab need the popup even without rows of its own); still no data read per keystroke.
- Dev tools: `tools/dev-load.mjs` and the live and perf gates park an installed Burrow in memory while they run and put it back afterwards, so they work in a window that has the Depot build installed. `dev-load.mjs status` no longer unloads the dev build.

## [0.2.0] - 2026-10-17

### Added

- Drill-down in `[[`: `title#heading > child` resolves to a block, Enter or Tab inserts its `((uid))`, and an unresolved expression inserts `[[Page]]`, never a new page. Starts only after an exact title or alias; titles with `#` or `>` that have content stay native.
- Drill-down preview: a read-only outline over Roam's preview area (or beside the popup) with the parent trail, siblings, two levels of children, the resolved block highlighted and scrolled into view.
- Lazy page reads for drill-down: one pull per block visited, one heading lookup per page, cached until the popup closes.
- Pick memory for `((` and alias rows, off by default, kept in this browser.
- Current-page boost among equal referenced blocks in `((`.
- Switches `drill`, `drillPreview`, `pickMemory`, `pageBoost`; the disable-all command covers them.
- Live gates: drill cases on four arms (on, off, gone, drill off) with a page-count check, a real drill per graph, a pick-memory case, and a drill cost run with the preview open.

## [0.1.0] - 2026-10-17

### Added

- Alias rows in `[[` from `Aliases::` blocks (case-insensitive), inserting `[alias]([[Page]])` or `[[Page]]`; hidden where roam-aliases or Roam already shows the page.
- Referenced-first strip in `((`: originals before quoters, inbound-ref ranking, pre-selected top original.
- Alias query expansion in `((`.
- Search scorer ported from thymer-reference-extravaganza, with word-boundary substring matching.
- Explicit keyboard ownership state machine and byte-for-byte guarded commit.
- One settings switch per feature, a disable-all command, and a per-key cost readout.
