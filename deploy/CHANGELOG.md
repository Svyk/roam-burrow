# Changelog

All notable changes to this project follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
