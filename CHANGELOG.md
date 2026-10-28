# Changelog

All notable changes to this project follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.2] - 2026-10-27

### Added

- **Images in the preview** (`previewImages`, on). In Burrow's previews (the row preview over Roam's, the `[[` drill-down preview and the preview beside the Tab list), the highlighted block's first `![](url)` shows as a thumbnail under its line in a box reserved when the line is drawn (at most 240×160, `object-fit: contain`), with `+N` when the block has more images. It loads after the row has stayed highlighted for 150 ms, only for that row: a newer highlight cancels the wait, and a result that arrives after the highlight moved is not shown. A plain graph's image is an `<img loading="lazy">`; in an encrypted graph, or for a `.enc` URL, Roam's `file.get` decrypts it into an object URL. Up to 8 object URLs are kept, revoked on eviction, when the popup closes and on unload. A decrypted file over 5 MB, a failed download or a failed decode keeps the `image` label with the alt text, in the same box; nothing throws. No Roam component is mounted in the popup. Burrow's rows keep the `image` label.
- Live gates: thumbnails in svy (encrypted) and notes, the box reserved before load and unmoved after, `+N`, a broken image's label, ↓ through 10 image blocks in the Tab list starting at most one download, no object URL left after the popup closes, the `[[` drill preview, the switch off; thumbnails in the text-box overlap pass. `tools/shots.mjs` scenarios 69–72.
- `__BURROW_PERF` `scope.key`: the time of each ↑/↓ in the drill panel, whose preview is redrawn in the key.

### Fixed

- A thumbnail stayed an empty box when you pressed ↓ then ↑ back to its row before the next row's preview was drawn. The box is re-armed, and the decrypt already running for it is reused (one download).
- ↓/↑ in the drill panel draw its preview in the next frame instead of inside the key, so the key only moves the highlight.
- In an encrypted graph, an external image that falls back from `file.get` to a plain image counts one download, not two.
- Gate tooling: a gate started right after another one could meet the previous run's cleanup still deleting in the page (svy is slow to delete): it aborted on a "stale fixture tree", or lost its own fixture when the old cleanup finished. Setup now waits for it, and a cleanup clears only its own fixture. A crashed run's block whose page was deleted under it is moved onto the fixture page before it is deleted (Roam's delete throws on a block without a parent).

## [0.9.1] - 2026-10-27

### Added

- **Order alias chips by use** (`aliasUsage`, on; BRW-19). Chips under an alias row start with the alias you link most: each is counted by how many times `[alias]([[Page]])` appears in the graph (the link must be that page's exact title, the alias text is read without case), most used first, ties in the alias block's order. A chip's tip adds a quiet `×N` when N is above 0 (`zq used three ×3`). ⌥↓ still enters the chips on the alias that matched, wherever it now sits. Off: the alias block's order and plain tips.
- **`alias:` prefix** (`aliasPrefix`, on). `[[alias:lo` lists only alias rows for `lo` (up to three, one character is enough), then Roam's list as usual below. Enter inserts `[alias]([[Page]])` (or `[[Page]]`, per the link format) in place of the whole `[[alias:lo]]`. No recent rows, page rows or drill-down for that text, and an empty `[[alias:` shows nothing of Burrow's. The first row is selected by the usual alias rule, judged on `lo`. Off: `[[alias:lo` is an ordinary search. The key list names it. **Disable all features** also turns off both new switches.

### Changed

- **Shared aliases, checked and tested.** When two pages carry the same alias, Burrow shows one row per page, never merged and never guessed, each with its own reference count and, on its chips, its own use count. That was already so (with `aliasInline` on and off); 0.9.1 adds the unit cases.
- Cost: the chip order costs one more idle query in the build, next to the reference counts (`[:find ?u ?r ?s … includes? ?s "]([["]`, 56 ms async for 8 alias pages in notes and 73–76 ms for 24 alias pages in svy, read-only; the existing count query returns only a number per page, so it cannot carry the alias text), counted in `__BURROW_PERF` as `aliasUses`. An alias edit carries the counts over to the refreshed index; a keystroke reads a ready list: 0 queries, 0 pulls. Turning the switch on without counts read schedules a build.
- Live gates: chips in use order with `×N` tips on a scratch fixture page (notes has 8 alias pages, none with three aliases, and no `[alias]([[Page]])` links), `[[alias:` rows only, shared-alias fixture with two rows.

## [0.9.0] - 2026-10-27

### Added

- **Query filters** (`queryFilters`, on) in Burrow's `((` and `[[` rows (BRW-18; precedents RefX R5 filters, Omnisearch, Search+, Logseq's search in page):
  - `"quoted words"` must stand together, whole words in order (`(("black panther"` leaves out `the black cat and the panther`); while the closing quote is not typed yet, the last word may be a prefix.
  - `-word` (or `-"two words"`) leaves out blocks that have it.
  - `in:here` keeps blocks on the page being edited; `in:Page Title` keeps that page's blocks, the title running to the next filter or the end (`((pcr in:PhD/Cronobacter & Spore Control in PIF`), matched like a drill title (case and separators ignored) or by an alias; `in:"Title"` ends at its quote.
  - `ns:Systems/` keeps pages under that namespace (and the page `Systems` itself). `in:here` and `ns:` are one word (`ns:"Media Captures/"` for one with a space), so search words may follow them: `((in:here pcr`, `((ns:Systems/ grok`.
  - `is:todo` and `is:done` keep blocks whose first task macro is a TODO or a DONE (Better Tasks' `{{[[DONE]]:((uid))}}` counts), read as Burrow draws checkboxes; `is:t` already means todo while you type.
  - Several page filters add up (a block passes when any names its page); every other filter must hold.
  - A word is a filter only with its colon (`in:`, `ns:`, `is:`), its quotes, or a leading `-` before a letter or quote: `in here`, `ant-man`, `a - b` and `-20` stay search text. `in:`, `ns:` and `is:` need their value right after the colon, so `what it is: foo` is text. Search words go before `in:Page Title`.
  - Burrow never rewrites the token: Roam's own list searches the text as typed, and a Burrow pick replaces the whole token, filters included, with `((uid))` as before. A filter that matches nothing leaves no Burrow rows; Roam's list is untouched. `[[` rows are pages, so `is:` leaves none there, and `in:`/`ns:` keep the pages they name.
  - Burrow's rows show the filters in force as one quiet plain-text line above them (`is:todo · -closed`, `in:here (October 27th, 2026)`), no pills. The key list has a Filters group while the switch is on.
  - The pool is unchanged: Burrow's `((` rows are referenced blocks; filters narrow it, they do not read a page's other blocks.
  - Off: every word is search text, as in 0.8.1.
- Live gates: fixture cases for `is:todo`, `is:done`, `-word`, `"quilt pattern"` against `quilt pattern`, `in:`, `in:here`, `ns:`, a filter with no match, the switch off and two `[[` cases; svy `((watch is:todo` and `(("black panther"` against `((black panther` and notes `((pcr in:PhD/Cronobacter & Spore Control in PIF` on real data; Escape and Enter on a filtered query byte-for-byte against Burrow off and gone. `tools/shots.mjs` scenarios 63–65.
- Gate run (2026-10-27, this build): svy 18 of 18 filter cases PASS, notes 9 of 9 PASS (including the byte-for-byte Escape and Enter cases in the on, off and gone arms). Per key p95 with three filters: svy `((ant man is:todo -wakanda in:MCU Watch Order` 2.0–2.1 ms (1.8–1.9 ms without filters), notes `(("pcr screen" -wgs in:PhD/Cronobacter & Spore Control in PIF` 1.6–1.7 ms; input-to-paint p95 delta at most +1.75 ms; 0 queries per key. After merging 0.8.1: svy 7/7 and notes 3/3 key cases PASS again, three-filter p95 svy 2.1–2.3 ms, notes 1.6–1.8 ms.

## [0.8.1] - 2026-10-27

### Added

- **Recent rows** (`recentRows`, on; BRW-14). With up to two characters after `((` or `[[`, Burrow shows up to three rows: the blocks or pages you picked most recently, then the ones edited most recently (the last 14 days). Nothing is selected, so Enter does what Roam does; ↑ from Roam's first row moves onto them. A character narrows them to those with a word that starts with it. In `[[`, alias rows come first and recent pages fill what is left; a page Roam already lists is not shown twice. The block or page you are editing is never offered. Hover says `Recent pick` or `Edited recently`.
- **Frequent first** (`frecency`, on). Every pick feeds a score that halves every two weeks. Among rows that match equally well and have as many references, the ones you pick more often and more lately come first, for any query and also for alias rows. Picks of Roam's own rows count too: Burrow reads back what Roam inserted. Kept in this browser only: uids, a score and a time (never block text), at most 500 per graph.
- **Burrow: forget recent picks** in the command palette clears this graph's history. **Disable all features** also turns off the two new switches.

### Changed

- **Frequent first replaces Pick memory.** The exact-query rule is gone with its `pickMemory` switch; what you had picked under `burrow:picks:<graph>` is folded into the new store the first time 0.8.1 loads (each pick at its own time; the query text and alias are dropped) and the old key is removed.
- Cost: the last-14-days query (about 185 ms in notes, 274 ms the first time; 105k blocks, 4,006 edits) runs only inside the quiet idle build, the first one included, never with a popup open; a keystroke does a few array operations on lists made at idle, 0 queries and 0 pulls.
- Live gates: recent pick first and not selected with the same Enter in the off and gone arms, three picks flip two equal rows, forget clears; the pick-memory case is gone.

## [0.7.0] - 2026-10-26

### Fixed

- **Code blocks outranked a short task in `((`** (Svy, svy dark, 2026-10-25: `((black pan` showed two R code blocks of 90 KB and 62 KB as Burrow's rows; `{{[[TODO]]}} Watch [[Black Panther]]` was only in Roam's list). A block's key was its whole text with punctuation dropped, so ggplot's `color = "black"),` and the next line's `panel.grid` read as the words `black panel`: a contiguous match, the same band as a phrase in prose. The task itself had no inbound ref yet (its one ref is the pick Svy made right after), so it was not in Burrow's pool of referenced blocks. Now a block is keyed on its prose: fenced code, inline code and the insides of macros (`{{embed}}`, `{{roam/render}}`, `{{query: {and: …}}}`, nested ones whole) are left out, and the code is matched only when what you type looks like code (`((panel.grid`, `((library(gg`, `((zebra_plot`). With the task referenced, `((black pan` lists it first and pre-selected, and no code block.
- **Very long blocks no longer outrank short ones.** Inside a match band, a block of more than 64 words ranks after shorter blocks that match as well, whatever their refs; a match inside a page title or tag the block links (`Watch [[Black Panther]]`) comes before one elsewhere among equals; scattered words rank by how close they sit. A contiguous phrase or word prefix in order still always beats scattered words.
- Page links inside code are no longer counted as the block's linked pages (alias re-keying, title matches).
- **The popover could cover the block you are typing in.** In a small window, when the popover did not fit below a block that wraps, Roam flipped it above the caret's line, over the block's first line; with the preview open, Burrow's drill preview made the popover tall enough to flip. The popover is now lifted clear of the text. 0.6.1 had this too.

### Added

- **Prose before code in `((`** (`refProse`, on): the ranking above. Off: code matches like any text and length and titles do not count, as in 0.6.1.
- **Rows drawn like Roam** (`richRows`, on): Burrow's `((` rows, the drill row, the drill panel and both previews draw a block as Roam does instead of raw markdown. A code block shows its language (`R`) and its first line of code, or the line that matched a code query, without the fence or leading comments; inline code is monospace; `[[links]]`, `#tags` and `((block refs))` (resolved to their text) are drawn as references in the theme's own colors; bold, italic, highlight and strike are drawn; `{{embed}}` (with the embedded text), `{{query}}`, `{{roam/render}}`, SmartBlock buttons and other macros, images and files are small labels; a long block is cut to `…` before the place where your words occur together. TODO and DONE stay Roam's checkboxes. On the selected row and the preview's highlighted line a tag takes the link color, so it stays readable on the highlight. Block text is never turned into HTML: `<img onerror=…>` shows as text. Off: plain text, as in 0.6.1.
- Unit test of the key list's wiring in `src/strip.js` on a real DOM (jsdom, dev only): with the list open, Enter, Tab and their modified forms only close it; removing the wiring fails the test (BRW-9 review).
- Live gates: the svy acceptance `((black pan` → `Watch [[Black Panther]]` first with no code rows; code rows only for a code-looking query; rich rows on and off, macros, media, a cut long row, block text never turned into HTML, rich preview lines; text-over-text checked in 32 picker states. `tools/shots.mjs` scenarios 49–57.

## [0.6.1] - 2026-10-24

### Fixed

- **Enter under the key list ran a row you could not see** (the same class as the 0.5.0 footnote). With the key list (⌥/, F1 or the `?`) open over Roam's `((` or `[[` popover, Enter closed the list and went on: Roam ran its highlighted row, hidden under the list (in svy, `((ant man` made a new block), or Burrow inserted its own row or the drill panel's. Now Enter and Tab, with any modifier, only close the list; Esc, ⌥/ and F1 close it as before; any other key closes it and goes on. Checked in svy with Roam's list open: only plain Enter and Tab pick a row there (Shift+Enter types a newline, ⌘Enter toggles TODO, Alt or Ctrl with Tab does nothing), so the drill panel, the alias field and a selected Burrow row already kept every key that picks; the key list was the one overlay that let it through.
- The **Key hints** setting in Settings → Burrow names the labels 0.6.0 shows (`⇥ blocks on this page`, `⇥ children of this block`, `⇧⇥ parent`; in the drill panel `↵ insert · ⇥/> children · ⇧⇥ up · esc results · ⌃O preview`), not 0.5.0's `⇥ drill` and `⇥/> drill · ⇧⇥ back · ⌃O preview`. The **Key list** setting says Enter and Tab only close the list.
- `docs/spec.md` §15 gives the due rebuild's delay as 2.1–4.0 s, as the final run and this changelog.

### Added

- Live gates: six key-list cases (Roam's `((` row and `[[` row under the list, Burrow's row, the drill panel, Tab after F1, Shift+Enter / ⌘Enter / Shift+Tab), each also checking that no block was created anywhere in the graph; all six fail on 0.6.0. The gates' key runner takes `ctrl+` and `meta+` keys, which type nothing.
- `--theme light|dark` works in a window whose svy-theme Appearance is fixed (notes is set to Dark): the gate does in memory what svy-theme's own switch does for the other mode (`bp3-dark` / `bp3-light` and `data-bp-appearance` on `<html>`, the topbar toggle's icon and label, which Better Tasks follows), writes no setting, and puts it all back at the end; if the run dies, the page puts it back by itself 20 s later. So the text-box gate now runs in all four combinations, svy and notes in light and dark.
- Final gate run (2026-10-24, this build): `gate-all --theme dark` 8 of 8 PASS, svy and notes live in light PASS; text boxes 26 states each, 857 boxes in svy and 873 in notes, light and dark, none intersecting. Per key p95: svy `((` 2.6–2.7 ms, 2.5–2.7 ms with Roam's preview open (preview slices p95 1.3–1.4 ms, max 3.4–3.5 ms), drill-down 0.7–1.1 ms; notes 1.5–1.6 ms, drill-down 0.6 ms; input-to-paint p50 −0.3 to +0.8 ms against Burrow absent; the due rebuild 0 times while typing, 2.3–3.8 s after the popup closed.

## [0.6.0] - 2026-10-22

### Fixed

- **Enter could run a Roam row that was not highlighted** (Svy's 0.5.0 test in svy made a footnote of `((agen`). The caret had moved back into the token while Roam's row was highlighted; Burrow kept its rows for the old text, ↑ put its row in the selection, and Enter, refused because the text had changed, went on to Roam's first row ("Create as footnote"), hidden under Burrow's rows with its highlight muted. Now Burrow ranks again whenever the caret moves (`selectionchange`); a caret inside a token that closes further on (`((agen|t))`) leaves the popup to Roam alone; and while Burrow's row holds the highlight, a refused Enter or Tab (and a throw) is consumed and ranks again, never passed to Roam.
- **Burrow's rows no longer lie over Roam's.** The strip and the hint line are part of Roam's list column (above its results, under its footer), in its flow, so no native row is under them in any state; Roam's highlight is muted by a selector on Burrow's strip instead of a popover class Roam drops when it re-renders (Ctrl-O). Roam's list scroller is the rows' offset parent, so Ctrl-O no longer scrolls Roam's list by Burrow's height (24 px in svy) and cuts its first rows mid-line.
- **No text overprints other text.** The preview's trail stays on top of its lines (they were painted over it once the preview scrolled); hover tips open beside the picker instead of over the rows below.
- **One highlight.** The pointer selects a Burrow row (no separate hover color), and the active color is Roam's own, never a muted sample.
- **TODO and DONE** (`{{[[TODO]]}}`, `{{[[DONE]]}}`, `{{TODO}}`, `{{DONE}}`, Better Tasks' `{{[[DONE]]:((uid))}}`) show as Roam's checkbox (its 12 px box, border, blue and tick), read-only, in Burrow's rows, the previews and the drill list. A macro that only starts like one (svy's SmartBlock button `{{TODO today:SmartBlock:TODO today}}`) stays text, as in Roam. Each is one element drawn by CSS: in svy every inserted element costs about 0.03 ms, and Roam's own markup is four.
- **A second load of Burrow disposes the first.** svy ran two 0.5.0 instances side by side (Roam had loaded the Depot extension twice), each drawing rows and taking keys; the live instance is now kept on the window. The dev tools park every installed instance's listeners too.
- The once-a-minute index rebuild no longer starts when a popup opens: a popup only marks it due, and it runs at the next quiet moment (no popup, 2 s after the last key), checked again right before its long query. `perf-gate`: 0 rebuilds while typing in every run; the due rebuild ran 2.1–4.0 s after the popup closed (its long task 0.39–0.42 s in svy, 0.33–0.36 s in notes).
- The row preview reads a node's child ids with one pull of at most 151 children; a node with more is read in pages (one id query, 1.2 ms at 966 children in svy, then orders 150 at a time), so no node takes one long task (svy's 966-child block: one 6.8 ms read before). Its lines are rewritten in place, 24 per idle slice: svy, typing `((ant man` with Roam's preview open, slice p95 1.8–1.9 ms, max 3.2–3.4 ms (0.5.0: 3.6–3.8 ms p95); first draws of a large page p95 3.2 ms, max 3.6 ms.
- The key list says ⌥⌫ needs Alias chips when Delete aliases is on and the chips are off.
- An alias page is watched before it exists, so the first alias typed by hand in a graph without one arrives through the watch.
- Per key, final gate run (dark): svy `((` p95 3.6–3.8 ms in a window open for days (2.2–2.5 ms just after a reload), 3.6–3.8 ms with Roam's preview open, drill-down 1.8–1.9 ms; notes 1.4–1.6 ms and 0.5–0.6 ms; input-to-paint p50 +0.6 to +0.8 ms in svy, −0.1 ms in notes, against Burrow absent.

### Added

- Where the block lives (`refContext`, on): under the highlighted block row in `((`, `in Page › … › Parent` and `⇥ N children` (counted up to `100+`, one bounded pull at idle).
- Up and down the outline (`refOutline`, on): ⇧⇥ on a highlighted block row lists its parent's children with the block highlighted; ⇧⇥ again goes higher, Enter inserts the highlighted one (the parent or a sibling). Tab on a block row lists its children under the block's whole trail.
- The hint line and tips name what Tab lists: `⇥ blocks on this page` or `⇥ children of this block`; the drill panel says `DRILL blocks on this page` / `DRILL children of this block: …` and the previews say `PREVIEW`. The drill panel's hints put the most needed first (`↵ insert · ⇥/> children · ⇧⇥ back · esc results · ⌃O preview`), so the line fits.
- F1 opens the key list on any keyboard layout (⌥/ needs a / key of its own); on a Mac keyboard that is fn+F1, and the `?` on the hint line works everywhere.
- Live gates: a text-box gate (every text node of the picker and the edited line, measured from DOM rects, in 13 states with Roam's preview closed and open: 857 boxes in svy light and dark, 873 in notes, none intersecting; the 0.5.0 build fails it), Svy's footnote case, the caret back at the end, a refused pick, checkboxes, the context line, ⇧⇥ up and Enter on the parent, Tab under the trail, `refOutline` off, the pointer selecting a row, Ctrl-O not scrolling Roam's list, F1, the ⌥⌫ note, a TODO whose child is a SmartBlock button (preview draws, Tab drills). `perf-gate` checks a due rebuild never runs while typing and holds the context line's idle reads to 4 ms. The gates delete a page Roam made from their typing only if they typed its title, so a page another job writes during a run stays.

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
