# Burrow brief

Burrow is a new Roam Depot extension in `~/system-setup/roam-burrow` (its own git repo, branch `main`).
It ADDS to Roam's native `[[` page search and `((` block search. It never replaces them.
The look must be subtle and native: Roam/Blueprint theme tokens, light and dark, no badges or pills.

## What it does

1. Alias search. Port the alias and navigation ideas from Svy's Thymer plugin
   https://github.com/Svyk/thymer-reference-extravaganza to Roam: typing a page alias in `[[` or `((`
   finds the page. Roam aliases are `Aliases::` attributes; check the real graph for the convention in use.
2. Drill-down navigation (the idea from a Roam Slack post; screenshots in `docs/refs/1.png` and `2.png`):
   after `[[` the user types `title#heading1 > xxx`. `#` searches headings only, `>` descends one outline level.
   Parent context stays visible, and the preview scrolls to and highlights the block the expression resolves to.
   The user types and the preview follows. No arrow-key interaction inside the preview pane.
3. Better ranking and matching for page and inline search. Keep Roam's results and add to them.

## References

- https://github.com/mmssddss/roam-inline-autocomplete shows how to hook into Roam's inline autocomplete. Read it before designing the hook.
- `~/system-setup/roam-extension-template` and the sibling `roam-*` repos show house conventions.
- Use the `roam-plugin-dev` and `feel-instant` skills.

## Rules

- Keyboard ownership must be explicit and reversible. Test that the block text is byte-for-byte unchanged after
  Enter, Escape, Tab, arrows, typing, and failure recovery (GUARDRAILS: Roam Grid input leak).
- Theme: explicit host dark marker (`bp3-dark`) first, then the measured body background. Never use the OS `prefers-color-scheme` alone.
- No source-document mutation beyond inserting the reference the user picked.
- Budget: per-keystroke work must stay cheap. Roam already taxes every keystroke. Measure before claiming it is fast.
- Testing happens on the `notes` graph (Readwisenotes) through Roam Desktop CDP :9223, never on `svy`.
- Install by GitHub Pages URL, not a local-folder mount. Do not create the GitHub repo or push without Svy's go-ahead.
- Commits: `git -c user.name="Svyatoslav Kleshchev" -c user.email="svyk@icloud.com" commit`, new commits only, never skip hooks.
- Routing: the Grok lane is live (`grok-run.sh`, see `~/.claude/orch/lane-fit.md` "Grok lane"). Use it for long-context reading of the
  reference repos or for a cross-family review. Plans go to Fable, implementation to sonnet-worker.

## First step

Propose threads: (a) research both reference repos plus Roam's autocomplete DOM and write a short design spec,
then (b) scaffold and build alias search, then (c) build drill-down plus preview. Wait for Svy's go-ahead.

## Decisions (Svy, 2026-10-17)

- Every Burrow feature gets its own on/off toggle in the extension settings panel. No always-on features.
- `((` ranking: prefer blocks that already have block references. The original block (the one others already ref) ranks first. Example: searching "ant man" in `((` should show `((3XSu0IJ8f))` first in the notes graph.
- Alias compatibility: https://github.com/dive2Pro/roam-aliases is the alias plugin everyone already uses. Burrow must read its alias convention and work alongside it, not fight it.
- Many Slack-thread features already exist in https://github.com/Svyk/thymer-reference-extravaganza. Port them to Roam and improve them; do not reinvent.
- Use the `roam-plugin-dev` skill for Roam extension work.
