# Changelog

All notable changes to this project follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-18

### Added

- Alias rows with their page (`aliasInline`): one row per page, `alias ↳ Page` with its reference count, also when roam-aliases is installed. roam-aliases' rows for pages Burrow shows are hidden, so no alias is listed twice; the rest stay in its column.
- Alias pre-select (`aliasPreselect`): when an alias starts with the typed text and no page has exactly that title, its row starts selected.
- Alias chips (`aliasChips`): the selected alias row's aliases as chips; ⌥↓ moves into them, ←/→ picks, Enter inserts with that alias.
- Tab drill (`tabDrill`): Tab on the highlighted page (Roam's row or Burrow's), a referenced block in `((`, or a resolved drill-down lists its children in place under a breadcrumb, with a filter that never reaches the block, a preview of the highlighted child, Tab / `>` deeper, Shift+Tab back, Enter inserting the child's `((uid))`. Nothing to drill into: Tab is Roam's.
- Keep panes apart (`paneLayout`): roam-aliases' column becomes a band above Roam's list (preview closed) or above the list column (preview open) instead of lying over Roam's list or preview.
- Key hints (`keyHints`): a line under Roam's list naming Burrow's keys; the drill panel has its own.
- Idle query for alias pages' reference counts.

### Changed

- Burrow's rows, chips and hint line pad Roam's list column only, so Roam's preview keeps its full height.
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
