# Burrow

A Roam Research extension that adds to Roam's own `[[` page search and `((` block search. It never replaces them: Roam's rows stay where they are, and Burrow shows at most three rows of its own at the top of Roam's popup.

- **Alias rows in `[[`.** Type a page alias and the page shows up as `alias ↳ Page Title`. Picking it inserts `[alias]([[Page Title]])`, the same text roam-aliases writes. Aliases come from `Aliases:: a, b` blocks, read without case.
- **Referenced blocks first in `((`.** Blocks that other blocks already reference are ranked: the original before the blocks that quote it, then by inbound refs. The top original starts selected, so Enter inserts it.
- **Alias expansion in `((`.** An alias also finds referenced blocks that link to its page.
- **Forgiving matching.** `ant man` finds `[[Ant-Man]]`, `EMP 26` finds `EMP26-002-BHP`, `mcu` finds `Marvel Cinematic Universe`, small typos are forgiven. Numbers never fuzz.

The look follows Roam's popup: its colors, font and ref counts, light and dark. No badges.

## Keyboard

Burrow only takes keys while one of its rows is selected.

| Key | Burrow row selected | Roam row selected |
|---|---|---|
| ↑ | previous Burrow row | from Roam's first row: Burrow's last row |
| ↓ | next Burrow row; past the last, back to Roam | Roam |
| Enter / Tab | insert the Burrow row | Roam |
| Esc | hand selection back to Roam; Roam closes the popup | Roam |

Burrow writes only the `((…))` or `[[…]]` you are typing, and only if the text before the caret is still exactly what it ranked. Otherwise the key goes to Roam as if Burrow were not installed.

## Settings

Every feature has its own switch under **Settings → Burrow**: alias rows, alias expansion, referenced-first ranking, pre-select, forgiving matching, and a performance readout. **Alias attribute** should match roam-aliases' Keyword (default `Aliases`). **Alias link format** picks `[alias]([[Page]])` or `[[Page]]`. The command palette has **Burrow: Disable all features**.

## Working with roam-aliases

Burrow reads the roam-aliases convention and never edits `Aliases::` blocks; roam-aliases owns those comma lists. When roam-aliases already lists an alias in the popup, Burrow does not draw a second row for it.

## Cost

Burrow builds its indexes once at idle (one datalog query for referenced blocks, one for alias blocks) and refreshes them at most once a minute, when a popup opens. A keystroke runs only a JavaScript match over the in-memory index: no queries, no pulls. The match runs right after the frame that shows the typed character, so it never delays that paint. `window.__BURROW_PERF.summary()` reports p50/p95 per key.

## Development

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check   # build, secret scan, syntax check, tests, generated-artifact drift
```

`src/` is the source; `extension.js`, `extension.css` and `deploy/` are generated and committed together with it. `tools/` holds the live gates that drive Roam Desktop over CDP (port 9223), on a scratch `Burrow/Fixtures` page they create and remove. They need both Roam windows open (svy unlocked) and never reload a window.

```bash
npm run gate:live                            # everything below, both graphs, about 9 minutes, PASS/FAIL summary
node tools/live-gate.mjs Svy svy             # about 100 s: acceptance, byte-for-byte (on/off/gone), alias rows, fast typing
node tools/live-gate.mjs Readwisenotes notes # about 90 s
node tools/perf-gate.mjs Svy --runs 3        # about 180 s: per-key cost and input-to-paint, Burrow on vs absent
```

Each prints a short summary; add `--json` for the full record.

The design is in `docs/spec.md`.

Install: Roam **Settings → Roam Depot → Developer Extensions → URL**, `https://OWNER.github.io/roam-burrow` (no `/extension.js`).

## License

[MIT](LICENSE). The search scorer is ported from [thymer-reference-extravaganza](https://github.com/Svyk/thymer-reference-extravaganza) (MIT).
