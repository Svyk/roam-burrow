# Burrow design spec

Task roam-burrow/1 (BRW-1), research only. Written 2026-10-17. Committed in BRW-2 with Svy's decisions of 2026-10-17 folded in (§9). Where a decision overrides the text below, §9 wins.

## 0. Findings that change the brief

1. **`((3XSu0IJ8f))` is not in the notes graph.** It is `{{[[TODO]]}} Watch [[Ant-Man]]` on `MCU Watch Order` in **svy** (1 inbound ref). A notes pull for that uid returns `null`. For testing on notes I propose this stand-in, which has the same shape (separator-insensitive match, referenced original, unreferenced look-alikes):
   - query `real time pcr` in `((`: **`((6ZtlGN-Np))` "3. Real-time PCR screen"** (5 refs) must rank first. The other 5 notes blocks that match `real.?time.?pcr` have 0 refs.
   - The svy `ant man` → `((3XSu0IJ8f))` case is the real acceptance (decision 2026-10-17: testing on svy is allowed and preferred for performance). `real time pcr` on notes is the second case.
2. **Matching must ignore separators.** `ant man` must hit `Ant-Man` inside `[[Ant-Man]]`. Thymer's `_searchKey` (spaced and compact forms) already does this. Port it.
3. **roam-aliases is loaded in the notes window**: its `.rm-aliases` / `.alias-container` CSS is present. Coexisting with it is a live constraint, not a hypothetical one.
4. **The notes graph used two alias spellings.** It had 7 `Aliases::` blocks plus one `aliases:: EMP` (on `Environmental Monitoring Program`). roam-aliases (default keyword, `starts-with "Aliases::"`) missed the lowercase one. With Svy's approval BRW-2 renamed that block to `Aliases:: EMP`; Burrow still reads both spellings.
5. **Native Roam already has a preview pane and ref counts** in the autocomplete (`.rm-autocomplete__preview`, `.rm-autocomplete__ref-count`, `--expanded` / `--expanded-left`, footer hotkeys). Burrow must not draw a second competing pane next to it (see §4).

## 1. Sources read

| Source | What Burrow takes |
|---|---|
| `Svyk/thymer-reference-extravaganza` v4.64.1 (`plugin.js` 58k lines; README) | Search scorer `_searchKey` / `_searchPlan` / `_searchStrictScoreFromKey` / `_searchMatchFromKey` (strict tiers 1200→380, recall tier with abbreviations, initialisms, edit distance ≤1–2 and never on numbers, `+` = AND, quotes = phrase); alias rows `Alias ↳ Real Title`; one row with `· alias: X` when the title and an alias both match; ambiguous aliases kept as separate rows; result dedupe (`_r5PostProcessResults`); the Navigator's `#heading` filter and `>` drill; pick memory; current-page boost. |
| `mmssddss/roam-inline-autocomplete` (`extension.js`, `CLAUDE.md`) | The hook pattern: capture-phase `keydown` on `document` that intercepts **only while its own popup is open**; `commit()` checks the text before the cursor before writing and returns `false` so the key passes through on a mismatch; `nativeSetValue` + a dispatched `input` event; `ignoreNextInput`; IME `composing` gate; 200 ms late-open grace for Enter; cleanup through `on()`/`listeners`; themes measured from real Roam DOM. |
| `dive2Pro/roam-aliases` (`src/roam.ts`, `index.tsx`, `config-settings.ts`) | Alias convention: a block on the page whose string starts with `${Keyword}::` (default `Aliases`, configurable), values split on `,` and trimmed. The README says first-level block, but the code accepts any depth. It injects an `.rm-aliases` section as first child of `.rm-autocomplete__results.bp3-elevation-3`, reacts to mouse only, and inserts `[alias]([[Page]])` through `updateBlock`. |
| Roam notes window, CDP :9223, read-only `Runtime.evaluate` | Autocomplete CSS class map (§4), graph size, alias census, query timings (§6). Nothing was typed, clicked or written. |

## 2. Alias search model

**Index (read-only, never written by Burrow).**
- An alias block is any block on a page whose string matches `^(Keyword)::` case-insensitively. Keyword is a Burrow setting (default `Aliases`), and Svy sets it to the same value as roam-aliases. The case-insensitive match also picks up `aliases:: EMP`.
- Values come from `split(",")`, then `trim()`, with surrounding `[[ ]]` and `#` removed. Empty values are dropped.
- The page is the identity. One alias can point to several pages, and Burrow then shows every page and guesses none (Thymer rule).
- Built once at idle after load: titles (6,904, 57 ms query) plus aliases. Refreshed by a pull watch on the `Aliases` page's `:block/_refs` and a 60 s TTL checked when a popup opens, never on a keystroke.
- **Burrow never edits `Aliases::` blocks** unless the user turns on one of the two alias-write switches (BRW-6, §13, both off by default). The template rule says roam-aliases owns that comma list; with the switches off, Thymer's ⌥A "create alias while picking" stays unported.

**`[[` behaviour.** An alias hit renders as one Burrow row: `alias ↳ Page Title`, matched span in `.rm-search-match` weight. If native results already show the page by title, Burrow adds no row for it.
- Commit inserts `[alias]([[Page Title]])`, the same text roam-aliases writes, so both plugins leave identical source. The setting `Alias link format` offers `[alias]([[Page]])` (default) or `[[Page]]`.
- **With roam-aliases present** (`.rm-aliases` found inside the native popup): Burrow does not draw its own alias rows, because roam-aliases already lists them. Burrow still uses aliases for ranking and for `((` expansion. Two plugins listing the same alias would be the "fight" the decision forbids.

**`((` behaviour.** No new row type. An alias hit acts as query expansion: if the query, or a run of its tokens, matches an alias of page P, blocks that reference P get the alias boost (§3). Typing `Mike Khieu` in `((` then finds blocks that mention `[[Entities/Michael Khieu]]`. Burrow never inserts a page link from `((`.

## 3. `((` ranking

Roam's results stay as they are. Burrow adds a short ranked strip above them (§4).

**Candidate pool = referenced blocks only.** In notes that is 3,767 blocks: `[?r :block/refs ?b] [?b :block/string]`. Without the `:block/string` clause the count is 7,269, because it also counts referenced pages, which `((` does not want. The query takes 61–200 ms. Burrow builds the set once at idle and refreshes it lazily when a popup opens if it is older than 60 s. Native search already covers unreferenced blocks. Restricting Burrow to the referenced set keeps every keystroke a JS loop over about 4k strings, with no datalog.

**Order inside the strip:**
1. Match tier from the Thymer scorer: strict before close (typo).
2. **Originals before quoters.** A block whose text only contains `((X))` folds into X, and X takes its place. The original block, the one others already reference, ranks first.
3. Inbound ref count, as `log2(1+refs)` steps.
4. Alias boost (§2), current-page boost (+small), pick memory (phase 2).
5. Shorter text, then uid, so ties always break the same way.

Before matching, the key strips Roam markup (`[[ ]]`, `(( ))`, `{{ }}`, `**`, `^^`, attribute prefix) and uses Thymer's spaced and compact forms, so `ant man` = `Ant-Man` and `real time pcr` = `Real-time PCR`. Matching is on word boundaries. A rough substring probe for `ant` + `man` over the referenced set alone gave 66 hits (`important`, `semantic`…). Plain `ant` matches 460 referenced blocks and 15,780 blocks in the whole graph. The strict tiers rule those out.

**Strip size:** at most 3 rows. A row is dropped when native's first row is already the same block. Native rows carry no uid, so the check compares rendered text; if that is ambiguous, the row stays.

**Default selection.** The decision says the referenced original shows *first*. With the `((` ranking toggle on and Burrow's top row being a referenced original that native has not put first, that row is **pre-selected**, so Enter inserts it. Native's own active-row highlight is muted while Burrow owns selection. ↓ past Burrow's last row hands selection back to native's first row.

**Acceptance:** svy: `((ant man` → first, pre-selected row is `((3XSu0IJ8f))`. notes: `((real time pcr` → `((6ZtlGN-Np))`.

## 4. Popup hook

**Native DOM, from Roam's live stylesheet** (the class names in the compiled bundle are generated, so the CSS is the stable contract):
`.rm-autocomplete__results` (popover, 400 px, max-height 300 px, flex column) › `.rm-autocomplete__results-main` › `.rm-autocomplete__results-scroll` › `.rm-autocomplete-result` rows (with `.rm-autocomplete__ref-count`, `.rm-search-match`); `.rm-autocomplete__preview` › `.rm-autocomplete__preview-content` (title, `__preview-title__refs`, `.rm-zoom` breadcrumbs, ghost blocks); `--expanded` / `--expanded-left` when the preview is open; `.rm-autocomplete-footer` with `__action--preview` and hotkey icons. The Ctrl-Shift-9 Advanced Block Search dialog is `.rm-search-path`.

**Open questions that need one live capture before code** (phase 1, step 0, §8): the active-row class, whether native rows are React-keyed children of `-scroll`, and what closes the popup after a programmatic value change.

**Detection, with no global MutationObserver.** A capture-phase `input` / `keydown` handler on `textarea.rm-block-input` scans the text before the caret for the last unclosed `[[` or `((`, the same way inline-autocomplete's `insideRoamSyntax` does. Only then does it run one `querySelector('.rm-autocomplete__results')`. While a popup is open, one `ResizeObserver` follows it, and it is dropped when the popup closes.

**Burrow's own DOM.** One portal node on `document.body`, sitting flush against the native popover's edge (above it, or below when there is no room), the same width, built from Blueprint `bp3-menu` / `bp3-menu-item` tokens.
- It never gets the class `rm-autocomplete__results`: roam-aliases (`querySelector(TARGET_CLASS)`) and inline-autocomplete (`roamAutocompleteVisible`) both key on it.
- It never inserts into or reorders React-owned native nodes. The one native mutation is a reversible class `burrow-owns-selection` on the native popover, which mutes the native active-row style while Burrow holds selection.

**Keyboard ownership state machine** (explicit and reversible):

| State | Enter | Leave | Keys Burrow consumes |
|---|---|---|---|
| IDLE | — | popup opens with a Burrow feature enabled | none |
| ARMED | strip has rows, native holds selection | → OWNED on ↑ from the strip edge or on pre-select (§3); → IDLE when the popup closes | none |
| OWNED | a Burrow row is active | ↓ past the last row → ARMED; Esc → ARMED and Esc passes through to Roam; caret move, blur, popup close or composition start → IDLE | ↑ ↓ Enter Tab |

Every handler first checks `e.isComposing`, `state.composing`, that the event target is the tracked textarea, and that the selection is collapsed. If any check fails, the event passes through untouched.

**Commit, byte-for-byte.** On keydown, Burrow snapshots `{uid, value, selStart, selEnd, token:{kind,start,end,query}}`. A write happens only when:
- `value.slice(start, caret) === open + query`,
- the auto-inserted closer, if any, sits right after the caret,
- the caret has not moved, and
- the uid is still focused (`ui.getFocusedBlock`).

`next = value.slice(0,start) + insertion + value.slice(closerEnd)`. That is one `nativeSetValue` plus one `input` event, `ignoreNextInput`, and the caret set to the end of the insertion in the next rAF. Then a post-check: `ta.value === next`. If it does not match, Burrow logs `__BURROW.lastFailure` and **never writes a second time**. A precondition failure returns `false` and the key reaches Roam as if Burrow were absent.
- Burrow never calls `updateBlock` (roam-aliases does). Writing through the textarea keeps Roam's undo stack and avoids a re-render race.
- **Only the token span changes.** Every byte outside `[start, closerEnd)` must be identical.

**Byte-for-byte gate (run on notes, page `Burrow/Fixtures`).** For each case, pull `:block/string` before and after: Enter, Tab, Esc, ↑, ↓, ←, →, typing `abc`, Backspace, an IME composition (Pinyin), click-away, and failure recovery (caret moved between keydown and commit; scorer throws; extension unloaded mid-popup). Expected: the string is unchanged in every case except a Burrow commit, where only the token span differs. Run the same sequence once more with every Burrow toggle off. Its result must equal the run with Burrow uninstalled.

**Theme:** `.bp3-dark` on body or an ancestor first, then the measured `body` background luminance (notes measured `rgb(32,43,51)`, dark). Never `prefers-color-scheme` alone. Re-measure on class change of `<html>` / `<body>` only. Colors come from Roam's own tokens: no badges, no pills, plain `refs` number in `.rm-autocomplete__ref-count` style.

## 5. Drill-down: `title#heading > child`

**Grammar (inside `[[ ]]` only):** `expr := title ( "#" q )? ( ">" q )*`
- `title` resolves to the best page by title or alias with the Burrow scorer. **Drill mode switches on only when `title` resolves exactly** (title or alias, case- and separator-insensitive). Titles that legitimately contain `#` or `>` (`C#`, `a > b`) stay native, because the full string then matches a page and nothing parses.
- `#q` matches headings (`:block/heading` 1–3) anywhere under the page. notes has 4,130 heading blocks; `Systems/Executor Lanes and LaunchAgents` has 36. An empty `#` highlights the first heading.
- `> q` matches the **direct children** of the current target, one level, as in the Slack post. An empty `q` highlights the first child. `title > q` without `#` starts from the page's top level.
- Each step picks the best scorer match. Ties go to outline order. To get another sibling, the user types more. There are no arrow keys in the preview, per the brief and the Slack post.

**Preview.** While drill mode is on, Burrow owns the native preview area's *content*: it hides `.rm-autocomplete__preview-content` with a class and renders its own read-only outline in a portal laid exactly over it, so there is one pane, not two.
- The outline shows a breadcrumb trail of page › heading › … › parent (parent context stays visible), the resolved node's siblings, and the resolved node's first 2 levels of children.
- **The resolved block gets a highlight** (Roam's block-highlight color from the theme, no outline box), and `scrollIntoView({block:"nearest"})` runs on each change.
- The outline is built from one `pull` of the page tree, cached per page uid until the popup closes. It renders as text: `pointer-events:none` on bodies, no `renderBlock`, so a click cannot open an editor and change source.

**Commit.**
- Enter or Tab with a drill expression replaces the whole `[[expr]]` token with `((uid))` of the resolved block.
- If nothing below the page resolved, the commit is `[[Page Title]]`.
- **Burrow never lets Enter create a page named `title#heading > xxx`.**
- Esc leaves the text as typed and passes through.

**Example on notes (each step checked read-only over CDP):** `[[Systems/Executor Lanes and LaunchAgents#grok lane > never`
- `Systems/Executor Lanes and LaunchAgents` is an exact page title.
- `#grok lane` resolves to the level-2 heading `((TsuLMBRGP))` "Grok lane (since [[October 17th, 2026]])".
- `> never` matches one of its 6 direct children: `((-EeRGLF5U))` "Never Grok for: document writing …".
- The preview shows the trail `Systems/Executor Lanes and LaunchAgents › Grok lane …` with that child highlighted. Enter inserts `((-EeRGLF5U))`.

**Counter-example:** `[[Executor Lanes#grok lane` does **not** enter drill mode. `Executor Lanes` is not an exact title: the pages are `Concepts/Executor Lanes` and `Systems/Executor Lanes and LaunchAgents`, and neither has an alias. The text stays native. A namespaced page needs its full title or an `Aliases::` entry to start a drill.

## 6. Per-keystroke cost budget

**Measured on notes** (103,156 blocks, 6,904 pages; Roam Desktop, read-only):

| Operation | Cost | When Burrow runs it |
|---|---|---|
| datalog regex scan of all blocks | **110 ms** | never per key |
| referenced-block set + ref counts | 61–203 ms | idle once, then lazy ≥60 s |
| key normalisation of 3,767 refd blocks | 71 ms | idle once, with the set |
| title list | 22–57 ms | idle once + watch |
| JS match over 3,767 refd keys | **0.9–2.9 ms** | per key in `((` |
| JS match over 6,904 title keys | **1.9 ms** | per key in `[[` |

**Budget (each is a release gate, measured with `performance.now()` marks exposed at `window.__BURROW_PERF`):**
- **0 datalog queries and 0 `pull`s per keystroke.** The exception is the first `#` or `>` after a title resolves: one `pull` of that page tree, then cached.
- **Burrow JS ≤ 4 ms p95 per input event** on notes (match, rank, diff-render of at most 3 rows plus preview). No full `innerHTML` rebuild when rows are unchanged; the active-row change touches classes only (inline-autocomplete's `render` / `setActive` split).
- **Input→paint delta vs Burrow-off ≤ +5 ms p95** over a 200-keystroke scripted run with the popup open, on a `Burrow/Fixtures` block. Baseline first, then Burrow on, n ≥ 2 runs each, with the spread reported.
- Idle builds go through `requestIdleCallback` chunks of ≤ 6 ms (Thymer's cooperative lane) and pause while a popup is open.
- Kill switch: every feature toggle is checked at the top of the handler; all off = listeners are present but return in the first line. Command palette `Burrow: Disable all` for safe mode.

## 7. Settings (one toggle per feature, Svy decision)

Roam's `extensionAPI.settings.panel.create`, read through a `setting(id)` helper with defaults. Each handler checks its toggle at the start of the event, so a change applies to the next keystroke with no reload.

| id | Type | Default | Feature |
|---|---|---|---|
| `aliasPages` | switch | on | Alias rows in `[[` (auto-hidden when roam-aliases draws its own) |
| `aliasExpand` | switch | on | Alias query expansion in `((` |
| `refRanking` | switch | on | Referenced-first strip in `((` |
| `refPreselect` | switch | on | Pre-select the referenced original (Enter takes it) |
| `betterMatch` | switch | on | Separator-insensitive, any-order, initialism, typo matching for Burrow rows |
| `drill` | switch | on | `title#heading > child` in `[[` |
| `drillPreview` | switch | on | Highlighted preview for drill (drill still works without it) |
| `pickMemory` | switch | off | Phase 2: learn from picks |
| `pageBoost` | switch | on | Phase 2: blocks on the page being edited first among equals in `((` |
| `aliasInline` | switch | on | BRW-5: one alias row per page with its ref count, roam-aliases' duplicates folded |
| `aliasPreselect` | switch | on | BRW-5: the alias row starts selected when the alias starts with the query and no page has that exact title |
| `aliasChips` | switch | on | BRW-5: the selected alias row's aliases as chips (⌥↓) |
| `tabDrill` | switch | on | BRW-5: Tab / Shift+Tab drill into the highlighted row's children |
| `paneLayout` | switch | on | BRW-5: roam-aliases' column, Roam's list and Roam's preview each in their own space |
| `keyHints` | switch | on | BRW-5: key-hint line under Roam's list and in the drill panel (BRW-6: RefX wording) |
| `rowPreview` | switch | on | BRW-6: with Roam's preview open, a selected Burrow row previews its page or block |
| `aliasCreate` | switch | **off** | BRW-6: ⌥A on a highlighted page row adds an alias to its alias block (graph write) |
| `aliasDelete` | switch | **off** | BRW-6: Alt+Backspace on the active chip removes that alias, after a confirm (graph write) |
| `drillOrdinals` | switch | on | BRW-6: `1`, `2`, `(b)`, `iii` rank blocks starting with that ordinal first while drilled in |
| `drillEmpty` | switch | on | BRW-6: empty leaf blocks left out of the drill list; empty parents shown as `(empty) ▸` |
| `drillCap` | switch | on | BRW-6: a drill level lists 50 blocks and a `+N more` row |
| `refSearch` | switch | on | BRW-6: palette command `Burrow: block reference search` (opens `((` at the caret) |
| `refSearchHotkey` | switch | off | BRW-6: Alt+Shift+9 runs that command |
| `aliasKeyword` | input | `Aliases` | Same value as roam-aliases' Keyword |
| `aliasLinkFormat` | select | `[alias]([[Page]])` | or `[[Page]]` |
| `perfHud` | switch | off | Show `__BURROW_PERF` p50/p95 in a corner |

## 8. Build plan

**Phase 1: alias search + `((` ranking + matching** (repo bootstrap from `~/roam-extension-template`)
0. Live capture on notes, `Burrow/Fixtures` page: open `[[` and `((` once, save the popup's outerHTML, the active-row class, and what happens to the popup after a programmatic `nativeSetValue`. This needs typing into a notes block. Treat it as the first write step and get Svy's OK.
1. Lifecycle, settings panel (§7), detection (§4), portal strip, theme.
2. Port the Thymer scorer into `src/search.js` with node:test cases copied from Thymer (`ant man`/`Ant-Man`, `EMP 26`/`EMP26-002-BHP`, `s3`/`season 3`, no numeric fuzz).
3. Alias index, `[[` alias rows, roam-aliases coexistence.
4. Referenced-block index, `((` strip, originals-over-quoters fold, pre-select, keyboard state machine, commit.
5. Gates: `npm run check`; the byte-for-byte gate (§4); the `real time pcr` → `((6ZtlGN-Np))` acceptance; the cost budget (§6). Then Svy installs by GitHub Pages URL after his go-ahead to create and push the repo.

**Phase 2: drill-down + preview**
1. Grammar parser with unit tests, including titles that contain `#` and `>`.
2. Page-tree pull cache, resolver, commit to `((uid))`.
3. Preview overlay with trail, siblings, highlight and scroll; native preview content hidden only while drill is on.
4. Pick memory (off by default), current-page boost.
5. Gates: byte-for-byte gate re-run with drill cases (Enter on unresolved, Esc, typing past `>`); no page created by any drill sequence (query `:node/title` count before and after); budget re-measured with the preview open.

Routing per the brief: the plan review goes to Fable (`claude-run.sh --plan`) and the implementation units to `sonnet-worker`. A Grok cross-family review of the hook and commit code comes before phase 1 ships.

## 9. Decisions (Svy, 2026-10-17)

These override the text above.

1. **svy is a test graph.** Testing on svy is allowed and preferred for performance: it is encrypted and slower, so every budget must hold there. Never reload the svy window (the unlock prompt). `((ant man` → `((3XSu0IJ8f))` on svy is the real acceptance; `((real time pcr` → `((6ZtlGN-Np))` on notes is the second case.
2. **Scratch pages** (`Burrow/Fixtures`) are fine in notes and svy. Burrow's tests delete only what they created.
3. **Pre-select stays on by default.** The referenced original shows first and Enter takes it; the `refPreselect` switch turns it off.
4. **Every feature has its own on/off setting.**
5. **Coexist with roam-aliases.** Burrow reads `Aliases::` case-insensitively and draws no alias row that roam-aliases already lists. The notes block `aliases:: EMP` was renamed to `Aliases:: EMP` so roam-aliases sees it.
6. **Live checks** go through Roam Desktop CDP :9223. Install by GitHub Pages URL later; no GitHub repo and no push without Svy's go-ahead.
7. **Commits** as `git -c user.name="Svyatoslav Kleshchev" -c user.email="svyk@icloud.com" commit`; new commits, never skip hooks.
8. **Feel:** subtle, native Roam/Blueprint look, light and dark, no badges or pills.

## 10. Phase 1 build notes (BRW-2)

Findings from the live capture (§8 step 0) that the code relies on:

- Native rows are `.rm-autocomplete__results-scroll > div.dont-unfocus-block[title]`; the `title` attribute holds the page title or the block text. The active row has **no class**: Roam paints it with an inline `background-color`. Burrow detects it that way and mutes it with `!important` only while the popover carries `burrow-owns-selection`.
- In `((` Roam's first two rows are "Create as footnote" and "Create as block below", and the second is active by default, so Enter on native creates a block. Pre-select moves Enter to Burrow's original.
- The popover is a direct child of `<body>`, popper-positioned, `box-sizing: border-box`, `max-height: 300px`. roam-aliases prepends `.rm-aliases` (and adds `alias-container`) inside it.
- A programmatic `value` set plus one `input` event, with the caret set in the next frame, closes Roam's popup and saves exactly the new string (checked: `x ((6ZtlGN-Np)) ok`).
- Escape with the popup open closes it and leaves the editor.
- **Strip placement.** The strip is a portal on `<body>` laid over the top of the popover. A reversible class `burrow-pad-N` on the popover adds `padding-top` for N rows, so no native row is covered and the strip reads as the popover's first section. No node is inserted into Roam's tree.
- **Ranking bands.** Exact and word-boundary substring matches share one band so inbound refs decide between them; token-wise matches come next, recall (abbreviation, initialism, typo) after, close matches last. Substring hits must start at a word boundary, also in the separator-free form, so `ant man` does not hit `important manual`.
- **Roam swaps the popover element** on native arrow navigation. A disconnected popover only means "closed" when no replacement exists; otherwise Burrow re-attaches.
- **Strip admission** is stricter than Thymer's picker, because the strip pre-selects and Enter takes it. Admitted: whole-key, prefix and word-boundary substring matches (also separator-free); exact-word matches in or out of order; initialisms. Left to Roam's rows: prefix-only words in any order (Thymer's 440 tier: on notes `ant man` → "antibiotics … management"), close matches (a word missing), and recall matches with no exact word. Alias rows keep the full forgiving scorer (a one-word typo like `lorinatr` → `lorinator`), since aliases are few and short.
- **Per-key cost.** A strict pass behind a cheap prefilter (the separator-free key must hold each clause's longest word, or its initials start the query), with the passing set cached per needle set: typing forward scans the cached superset, Backspace hits the cache. Recall runs only when the strip is not full, never for one-word queries, and only over blocks found through a word index (an admitted recall row needs one exact word). Ranking runs in a task posted from `requestAnimationFrame`, so it never delays the paint of the typed character; Enter, Tab, ↑, ↓ and Esc flush it first.
- **Test harness trap** (Roam, not Burrow): after Escape Roam leaves the block *selected*, and that selection survives a programmatic `setBlockFocusAndSelection`. The next Backspace then deletes the whole block, with Burrow unloaded too. The gates clear the selection (Escape) before focusing, and guard every key that is not aimed at the fixture textarea.
- **Indexes** are built with `data.async.fast.q` where Roam offers it. svy: 5,304 referenced blocks, 200 ms query; notes: 3,767, 172 ms. Alias pages are found by exact title lookups for the keyword's spellings, then their referring blocks.

## 11. Phase 2 build notes (BRW-3)

Findings from the live work on notes and svy that the drill code relies on. Where they differ from §5, this section wins.

- **Roam's preview is off until Ctrl-O** and Roam remembers the choice. Open, the popover gets `--expanded` (`--expanded-left` near the right edge) and `.rm-autocomplete__preview` is as tall as the popover; with a drill expression the results show "No pages found.", so the popover is 67 px tall. While drill is on, a reversible `burrow-drill` class hides the preview's children and gives the expanded popover `min-height: 300px`; Burrow's pane lies over the preview's rect. With the preview closed, the pane sits beside the popover (right, then left, then below or above), never over it.
- **No whole-page pull.** `PhD/Cronobacter & Spore Control in PIF` (28,570 blocks) takes 377 ms to pull whole, and `data.async.pull` blocks the main thread just as long. A pull of one block with two levels of children takes 1.9 ms there, an upward `{:block/_children ...}` pull 0.2 ms. The tree source pulls per visited node (children and grandchildren, grandchildren with child uids so leaves need no pull) and keeps everything until the popup closes.
- **Headings by page eid.** A datalog query that joins `:block/string` or filters `(> ?h 0)` costs 20–40 ms even on small pages. `[:find ?b ?h :in $ ?p :where [?b :block/page ?p] [?b :block/heading ?h]]` with the page eid costs 2–18 ms; the strings then come from one pull per heading. svy stores `:block/heading 0` on 17k blocks, so `0` is filtered in JS. Ties go to outline order through a DFS from the page that stops at the first candidate.
- **Escape makes pages.** Esc closes the popup and leaves the editor; Roam saves `[[X#h > q]]` and creates an empty page `X#h > q`. Enter in Roam's own popup does the same (checked with Burrow absent: every drill case whose text still held `#` or `>` created that page). Burrow keeps Esc as Roam's (§5), so the gate compares pages per case against Burrow absent; Burrow's own commits create none. Because of these pages, a title holding `#` or `>` counts (for "stay native" and as a drill page) only when the page has child blocks.
- **Keys in drill.** Drill is OWNED with one row: Enter and Tab commit, ↑ and ↓ are consumed and do nothing (no arrow keys in the preview, and ↓ to Roam's "No pages found." row would let Enter create the page), Esc passes through, a caret move or a refused commit hands the key to Roam.
- **Pick memory** sits right after the match band (before originals-over-quoters), so a pick can reorder equal matches but never lift a weaker band. It is stored in `localStorage` under `burrow:picks:<graph>`, at most 200 picks. **Current page** sits after the alias boost, before the raw score; the page comes from the editing block's `data-page-title`.
- **Cost on svy with the preview open** (`perf-gate --drill`, 3 interleaved runs, 234 keys each): Burrow JS p95 1.4–1.5 ms per key, one-time max 9 ms when the first `#` resolves; input-to-paint median p95 delta −0.1 ms against Burrow absent; 7 data reads per run, 0 index queries per key.

## 12. Picker parity with RefX (BRW-5)

Svy's 0.2.0 test in svy (2026-10-18) showed three gaps against RefX: no pickable alias row on the page, no Tab drill, and overlapping text. Where this section differs from §2, §4, §5 or §9.5, it wins.

- **roam-aliases' column was the overlap.** It prepends `.rm-aliases` (`position:absolute; right:0; min-width:400px`) to the popover and adds `alias-container` (popover `min-width: 800px`). Roam drops that class whenever it re-renders the popover (Ctrl-O, some updates), and the 400 px column then lies on top of Roam's list; with the preview open (`--expanded-left` near the right edge) it lies on the list or the preview. Burrow's own panes were not involved.
- **Burrow now lists aliases itself, with roam-aliases installed** (Svy, task BRW-5: "make alias matches pickable inline on the page row"). One row per page, `alias ↳ Page` and the page's inbound-ref count (one idle query over the alias pages). roam-aliases' rows `[alias]([[Page]])` whose page Burrow shows (with chips on: any of that page's aliases) get `data-burrow-folded`; when all are folded the popover gets `burrow-fold-aliases` and the column disappears. Rows Burrow does not show stay. Both plugins write the same text, so nothing is lost and nothing is listed twice. `aliasInline` off restores §2's "leave it to roam-aliases".
- **Alias chips.** Under the selected alias row, one 28 px line `aliases: a b c` with every alias of that page. ⌥↓ moves into it at the matched alias, ←/→ (or ↑/↓) move, Enter inserts the page shown as that alias, Tab drills into the page, Esc or ⌥↑ goes back to the rows. Chips keep their width (a very long alias is cut with an ellipsis at three quarters of the line), so their text never runs together; when they do not all fit, the line is clipped and scrolls to keep the selected chip in view, and back to the start on the first chip. That scroll reads layout on chip keys only, never on typed keys. (BRW-6: the line also scrolls with the wheel or trackpad, every chip carries its alias as a tooltip, and the selected chip may take the whole line, see §13.)
- **Keep panes apart.** While roam-aliases' column still shows, `burrow-layout` makes it static: a 96 px scrolling band above Roam's list in the normal column popover, and a grid (`aliases | preview` over `main | preview`) when the preview is open. Burrow's strip, chips and hint line pad `.rm-autocomplete__results-main`, not the popover, so Roam's preview keeps its full 300 px column. The padding comes from static classes on the popover (`burrow-pad-N` for N rows, `burrow-pad-Nc` with the alias chips, `burrow-pad-foot` for the hint line): a class toggle restyles only the popover, while rewriting a stylesheet per row-count change restyled the whole document and cost 3+ ms per such key in svy's dark theme.
- **Roam's own Tab** in the `[[` popup inserts the active row, exactly like Enter. Right after the popup opens no row carries the inline background yet, and Enter/Tab still take row 0, so "Roam's active row" is the row with the background, else row 0.
- **Tab drill is picker-only, RefX style.** Tab consumes the key only when the highlighted row (Burrow's, or Roam's `[[` row whose `title` is an exact page title) has children: one cached pull. While scoped, Burrow consumes printable keys, Backspace, ↑ ↓ Enter Tab Shift+Tab and Esc; the textarea keeps exactly the typed `[[query`, so a scoped filter can never create a page, and Enter replaces the whole token through the usual commit check. The popover gets `visibility: hidden` (`burrow-scope-open`) and a Burrow panel takes its place (above or below the caret like the popover); the preview of the highlighted child sits beside it. Esc returns to the results with Roam's popup still open; ← → Home End leave the drill and move the caret. `((` native rows carry no uid, so Tab there stays Roam's; Burrow's referenced rows drill.
- **Pre-select for aliases** happens only when the alias starts with the typed text and no page has exactly that title (Roam's row or the title index). In svy `[[lori` pre-selects `lori ↳ Lori Boyd`: the empty page `lori` that used to block it was deleted on 2026-10-19. Typing `[[lori` and leaving with Esc or a click makes Roam create that page again, and from then on Roam's own `lori` row wins, on purpose. A pre-selection that stops holding while native rows arrive is handed back silently.
- **Roam ships a global `kbd { color: #fff; background: #333 }`**; Burrow's hint keys set their own colors.
- **Testing next to an installed Burrow.** svy runs 0.2.0 from its GitHub Pages URL, and a developer extension has no on/off switch in Roam Depot (only reload and remove). For the live checks the installed instance was parked in memory only: its state reads `composing`, its nodes were detached and its stylesheet disabled; unparking restores all three. Nothing persistent changed.

## 13. Picker polish (BRW-6)

BRW-5's review left five findings; Svy's task added seven RefX features. Where this section differs from §2, §5, §7 or §12, it wins.

- **Chips by mouse.** The chip line is `overflow-x: auto` with its scrollbar hidden (the 28 px line keeps its height). A vertical wheel scrolls it sideways; a trackpad swipe or Shift+wheel scrolls it natively. Clicking any chip inserts it, as before. The selected chip may grow to the whole line (`max-width: 100%`), so an alias wider than the ¾ cap shows in full when selected; every chip carries its alias in `title`. The line moves itself only when the chip selection moves: a redraw (Roam re-renders the popover often) leaves a wheel scroll where the user put it. The gates' "fits" rule is now: chip boxes never overlap, every chip shows its whole text or is ellipsized with that text in its tooltip, and the selected chip shows its whole text whenever it is narrower than the line.
- **Preview follows Burrow's rows** (`rowPreview`). Roam's preview pane shows Roam's own active row; while a Burrow row holds the selection Roam has none, so it said "Select a page to preview". With Roam's preview open, Burrow's read-only outline pane now lies over Roam's preview area (the drill preview's docked mode) for the selected alias row (its page, two levels) or referenced block (its place among its siblings, children below). It is drawn at idle (`requestIdleCallback`, 150 ms timeout) after the strip, so it adds nothing to a key's cost; its own cost is `__BURROW_PERF` "preview": 3.9–4.9 ms p95 while typing `((ant man` in svy with the preview open (`perf-gate --preview`), up to ~30 ms the first time a large page is pulled. While the ⌥A field or the delete confirm is open, it shows the page they act on. With Roam's row selected, Roam's preview is back.
- **Alias writes** (`aliasCreate`, `aliasDelete`, both off by default). ⌥A matches `event.code === "KeyA"` (on a Mac `key` is `å`). The page is Burrow's selected alias row, or Roam's highlighted `[[` row when its title is an existing page. The field is drawn by Burrow in the strip; the block textarea keeps focus and exactly the typed `[[query` (Burrow consumes the keys, as in the Tab drill, and takes a paste event), because moving focus to an input would end Roam's edit and save `[[query]]` as a page. A composition (an IME, or a Mac dead key such as ⌥E then E) still happens in the textarea, since nothing else holds the caret: while the field is open the keys the IME takes and the `beforeinput`/`input` events stop at the window without `preventDefault` (so the IME still gets them and Roam never sees the composing text), the text being composed shows underlined in the field, and at `compositionend` the composed text joins the field and the textarea gets back the value and caret it had at `compositionstart` (`src/compose.js`). Before this, the composition closed the field and the composed text landed in the `[[query`, so Roam made a page of it. Enter validates (no commas, brackets, line breaks or a leading `#`, which Roam reads as a tag), writes, then inserts through the usual commit check. The write: the page's alias blocks are the blocks on that page that reference the keyword's attribute page and start with `Keyword::` (any case); a top-level one is preferred. Its string is re-read just before the write; the alias is appended with `, `, or the block `Keyword:: alias` is created as the page's first child. Delete removes one comma part and keeps every other byte. Aliases are read from, added to and removed from the block's first line only; a second line (a note under the list) is kept byte for byte and never read as an alias. Checked live: writing another block, even on the page being edited, keeps the textarea, its value and the popup intact.
- **Ordinals** (`drillOrdinals`): a query that is 1–3 digits, one letter, or a roman numeral up to 39 (`(b)`, `b)`, `2.` accepted) is an ordinal. Blocks whose text starts with `(t)`, `t.`, `t)` or `t:` (digits also `t ` and never `10` for `1` or `1.5`) rank first in the Tab-drill filter, and win outright in a typed `> step` or `#heading`. Words made of roman letters (`mix`, `dim`) are not ordinals.
- **Empty blocks** (`drillEmpty`): empty leaves are left out of the drill list, the drill preview and typed `>` steps; empty parents show as `(empty) ▸` in the list, Enter or a click goes into them, and the first selected row skips them. In the page-tree cache `kids === null` means "has children, not loaded yet", so only `kids: []` counts as a leaf.
- **Children cap** (`drillCap`): 50 rows per level and a `+N more` row (Enter or click: the next 50, selection on the first new row). The drill preview already capped each level at 16 children; its marker reads `+N more`. The pull per level is unchanged (one pull of the level and its grandchildren's uids); the cap bounds DOM work.
- **Block reference search** (`refSearch`, `refSearchHotkey`). Roam's Ctrl-Shift-9 is its own Advanced Block Search, so Burrow does not take it. The palette command remembers the last block editor and its caret (the palette takes focus), refocuses it with `setBlockFocusAndSelection`, and inserts `(())` with the caret inside: a value set, the caret set, then one `input` event opens Roam's `((` popup (checked live). The optional key is Alt+Shift+9, which Roam alone only types as `·` (checked live with Burrow absent); Roam's palette also offers "Edit Hotkey: Burrow: block reference search" for any other key.
- **Key hints** read like RefX, plain text with `·` separators, Mac glyphs (`⌥A`, `⌥↓`, `⌥⌫`, `⌃O`) on a Mac and `Alt+…`/`Ctrl+…` elsewhere. In the drill panel Ctrl-O shows or hides Burrow's preview (consumed, so Roam's hidden popover keeps its state).
- **Light mode in svy without a reload.** svy's theme is on Auto and follows `prefers-color-scheme`; CDP `Emulation.setEmulatedMedia` flips it, and the override ends with the CDP connection. The notes window's dark mode is not Auto, so it stays dark. The gates and `tools/shots.mjs` take `--theme light|dark`.
- **Popup above the text.** The gate pushes the sidebar fixture down with a temporary `padding-top` on `#roam-right-sidebar-content` (DOM only) so Roam opens its popup above the block, then checks the strip, hints, drill panel and previews stay inside the popover or beside it and off the text.

## Also noticed

- `dive2Pro/roam-aliases` `src/roam.ts`: its alias query is case-sensitive `starts-with "Aliases::"`, so the notes block `aliases:: EMP` (page `Environmental Monitoring Program`) is invisible to it. Either rename it to `Aliases::` or note it.
- `dive2Pro/roam-aliases` `src/roam.ts` `allBlocks()` pulls `[*]` for every entity in the graph (103k blocks in notes) on first unlinked-alias use. That is a heavy cost on this graph, worth knowing if typing feels slow.
- `~/system-setup/roam-extension-template` README rule says roam-aliases owns `Aliases::` comma lists. Burrow follows it; keep it in Burrow's README.
