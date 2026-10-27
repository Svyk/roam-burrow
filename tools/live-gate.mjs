#!/usr/bin/env node
// Live gates for Burrow on Roam Desktop over CDP (:9223). Keys are trusted
// CDP input events into one block on a `Burrow/Fixtures` page opened in the
// right sidebar. The gate loads the build itself per arm; an installed Burrow
// is parked for the run and put back afterwards.
//
//   node tools/live-gate.mjs <window-title-prefix> <graph-config> [--keep]
//   node tools/live-gate.mjs <window> <svy|notes> --only "<case name>" [--arms on,gone] [--repeat N]
//     one case with its verdict, about 30 s
//   --theme light|dark   emulate prefers-color-scheme for the run (reset at the end)
//
// Graph configs (below) name the acceptance query and expected block uid.
// Arms: "on" (all toggles on), "off" (all toggles off), "gone" (module
// unloaded), and for the drill cases "drilloff" (everything on but drill).
// Every case's block string and the pages it caused must be identical across
// off, drilloff and gone, and identical in "on" except the commit cases,
// where only the token span may differ and no page may appear. Blocks or
// pages the run creates are deleted afterwards.
import { readFile } from "node:fs/promises";
import { connect, sleep } from "./cdp.mjs";
import { parkInstalled, unparkInstalled } from "./installed.mjs";
import {
  CHIP_ALIASES, CHIP_LONG, CHIPS_ALIAS_STRING, FIXTURE_PAGE, TWIN_A_TITLE, TWIN_ALIAS, TWIN_B_TITLE, TWIN_REFS, USED_ALIASES, USED_ORDER, USED_TITLE, USED_USES,
  aliasBlockString, childStrings, cleanupFixture, createdSince, deleteBlock, editedSince, guardReport,
  neutralClick, onAbort, pageNow, placeLow, placeNormal, primeFixture, setAliasBlock, setupFixture, waitAliasFixtures,
} from "./fixture.mjs";

const CONFIGS = {
  svy: {
    ref: { query: "((ant man", uid: "3XSu0IJ8f" },
    // Svy's case (2026-10-25): two 60-90 KB R code blocks were Burrow's rows for `((black pan`.
    accept: [{ query: "((black pan", uid: "cs1PFq5go" }],
    alias: { query: "[[lorinatr", insert: "[lorinator]([[Lori Boyd]])" },
    listed: { query: "[[lorinator" },
    drill: { query: "[[MCU Watch Order > watch order > ant man", uid: "3XSu0IJ8f" },
    preselect: { query: "[[lorina", insert: "[lorinator]([[Lori Boyd]])", page: "Lori Boyd" },
    chips: { query: "[[lorina", keys: ["alt+ArrowDown", "ArrowLeft", "Enter"], insert: "[lori]([[Lori Boyd]])" },
    // A pre-selected alias row whose chips all fit, over a Roam list that scrolls.
    wheelList: { query: "[[lori" },
    refHasChildren: true,
  },
  notes: {
    ref: { query: "((real time pcr", uid: "6ZtlGN-Np" },
    alias: { query: "[[holy gost", insert: "[Holy Ghost]([[Concepts/Holy Spirit]])" },
    listed: { query: "[[mike khi" },
    drill: { query: "[[Systems/Executor Lanes and LaunchAgents#grok lane > never", uid: "-EeRGLF5U" },
    preselect: { query: "[[mike kh", insert: "[Mike Khieu]([[Entities/Michael Khieu]])", page: "Entities/Michael Khieu" },
    chips: { query: "[[mike kh", keys: ["alt+ArrowDown", "ArrowLeft", "Enter"], insert: "[king_khieu]([[Entities/Michael Khieu]])" },
    wheelList: { query: "[[mike" },
  },
};
const SEED = "seed αβ 🙂 ";
const TYPE_MS = 35;
const FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pageBoost",
  "aliasInline", "aliasPreselect", "aliasChips", "aliasUsage", "aliasPrefix", "tabDrill", "paneLayout", "keyHints",
  "rowPreview", "aliasCreate", "aliasDelete", "drillOrdinals", "drillEmpty", "drillCap", "refSearch", "refSearchHotkey",
  "helpTips", "helpSheet", "helpNudge", "refProse", "richRows", "recentRows", "frecency"];
const REF_COMMAND = "Burrow: block reference search";

const [title, configName, ...flags] = process.argv.slice(2);
const config = CONFIGS[configName];
if (!title || !config) throw new Error("usage: live-gate.mjs <window-title-prefix> <svy|notes> [--keep]");
const keep = flags.includes("--keep");
const flagValue = (name) => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : null; };
const only = flagValue("--only");
const arms = (flagValue("--arms") || "on,off,gone,drilloff").split(",");
const repeat = Number(flagValue("--repeat") || 1);
const theme = flagValue("--theme");
if (theme && theme !== "light" && theme !== "dark") throw new Error("--theme must be light or dark");
const root = new URL("..", import.meta.url);
const c = await connect(title);
const themeSet = theme ? await c.setTheme(theme) : null;

// ---- page-side helpers ----

async function prime(seed) {
  let primed = await primeFixture(c, seed);
  if (!primed.ok) {
    await sleep(800);
    primed = await primeFixture(c, seed);
  }
  await c.evaluate(() => {
    const g = window.__burrowFixture;
    g.titleSet = new Set(window.roamAlphaAPI.q("[:find [?t ...] :where [?p :node/title ?t]]"));
  });
  return primed;
}

async function readBack() {
  await sleep(150);
  const guarded = await guardReport(c);
  const result = await c.evaluate(async () => {
    const api = window.roamAlphaAPI;
    const g = window.__burrowFixture;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (document.activeElement?.tagName === "TEXTAREA") document.activeElement.blur();
    // Wait until the stored string and the page's block count stop changing
    // (Roam saves on blur and may still be creating a native block).
    const snapshot = () => JSON.stringify([
      api.q(`[:find ?s . :where [?b :block/uid "${g.blockUid}"] [?b :block/string ?s]]`),
      api.q(`[:find (count ?b) . :where [?p :block/uid "${g.pageUid}"] [?b :block/page ?p]]`),
    ]);
    let last = snapshot();
    for (let stable = 0, t0 = performance.now(); stable < 3 && performance.now() - t0 < 2500;) {
      await sleep(80);
      const next = snapshot();
      stable = next === last ? stable + 1 : 0;
      last = next;
    }
    let string = api.q(`[:find ?s . :where [?b :block/uid "${g.blockUid}"] [?b :block/string ?s]]`);
    // Roam's own "Create as block below" makes a new block with a fresh uid
    // each run; find every new block on the fixture page, compare arms by
    // its text, and delete it.
    const all = api.q(`[:find [?u ...] :where [?p :block/uid "${g.pageUid}"] [?b :block/page ?p] [?b :block/uid ?u]]`) || [];
    const extra = all.filter((u) => u !== g.blockUid && !g.keepAll.includes(u));
    const extraStrings = extra.map((u) => api.q(`[:find ?s . :where [?b :block/uid "${u}"] [?b :block/string ?s]]`)).sort();
    for (const u of extra) string = string.split(`((${u}))`).join("((<new>))");
    for (const u of extra) await api.data.block.delete({ block: { uid: u } });
    // Clear the fixture first, so a page its text created has no ref left.
    await api.data.block.update({ block: { uid: g.blockUid, string: "" } });
    for (let t0 = performance.now(); performance.now() - t0 < 1500;) {
      if (api.q(`[:find ?s . :where [?b :block/uid "${g.blockUid}"] [?b :block/string ?s]]`) === "") break;
      await sleep(40);
    }
    // Pages created during this case only, by title, so an unrelated sync
    // (Readwise, another device) does not count.
    const titles = new Set(api.q("[:find [?t ...] :where [?p :node/title ?t]]"));
    const newPages = [...titles].filter((t) => !g.titleSet.has(t)).filter(Boolean);
    // A page this case's typing created (an unclosed [[x left behind) is ours
    // to delete, but only while it is empty, nothing else links to it and the
    // case's own text names it: a page an outside write made meanwhile (notes'
    // daily-plan job wrote two at 06:29 on 2026-10-23) is reported, not deleted.
    const typed = [string, ...extraStrings].join("\n");
    for (const t of newPages) {
      const p = api.pull("[:block/uid {:block/children [:db/id]} {:block/_refs [:db/id]}]", [":node/title", t]);
      if (p && typed.includes(t) && !p[":block/children"]?.length && !p[":block/_refs"]?.length) await api.data.page.delete({ page: { uid: p[":block/uid"] } });
    }
    return { string, extraStrings, newPages };
  });
  if (guarded.length) result.guarded = guarded;
  return result;
}

async function state() {
  return c.evaluate(() => {
    const b = window.__BURROW;
    const shown = (el) => {
      if (!el?.getClientRects().length) return false;
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
      }
      return true;
    };
    const rect = (el) => {
      if (!el || !shown(el)) return null;
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    };
    const overlap = (a, b) => {
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return w > 0 && h > 0 ? (w * h) / Math.min(a.width * a.height, b.width * b.height) : 0;
    };
    return {
      phase: b?.state.phase ?? "gone",
      rows: [...document.querySelectorAll(".burrow-strip:not([hidden]) .burrow-row")].map((r) => ({
        text: r.textContent, active: r.classList.contains("burrow-active"),
        labels: [...r.querySelectorAll(".burrow-label")].map((n) => n.textContent),
        code: [...r.querySelectorAll(".burrow-code")].map((n) => n.textContent),
        classes: [...new Set([...r.querySelectorAll("*")].flatMap((n) => [...n.classList].filter((x) => x.startsWith("burrow-"))))].sort(),
        checks: [...r.querySelectorAll(".burrow-check")].map((n) => `${n.classList.contains("burrow-done") ? "done" : "todo"}:${getComputedStyle(n, "::after").content !== "none" ? "on" : "off"}:${getComputedStyle(n).pointerEvents === "none" ? "ro" : "rw"}`),
      })),
      // The count element of each Burrow row (alias and page rows draw one when the page has links).
      nativeRows: document.querySelectorAll(".rm-autocomplete__results-scroll > div").length,
      rowCounts: [...document.querySelectorAll(".burrow-strip:not([hidden]) .burrow-row")].map((r) => r.querySelector(".rm-autocomplete__ref-count")?.textContent ?? null),
      // roam-aliases' items that are drawn, not folded into a Burrow row (see FOLDED in src/strip.js).
      roamAliasItems: [...document.querySelectorAll(".rm-aliases .dont-focus-block.alias")].filter((n) => shown(n) && !n.hasAttribute("data-burrow-folded")).map((n) => n.textContent),
      // Block text is never HTML: no element the text could have made, and no handler that ran.
      htmlEls: [...document.querySelectorAll(".burrow-strip img, .burrow-strip b, .burrow-strip script")].map((n) => n.tagName),
      xss: window.__burrowXss ?? null,
      firstUid: b?.state.rows?.[0]?.uid ?? null,
      activeUid: b && b.state.phase === "OWNED" ? b.state.rows?.[b.state.active]?.uid ?? null : null,
      context: document.querySelector(".burrow-strip:not([hidden]) .burrow-context")?.textContent ?? null,
      nativeActiveVisible: (() => {
        const row = [...document.querySelectorAll(".rm-autocomplete__results-scroll > div")].find((n) => n.style.backgroundColor);
        return row ? getComputedStyle(row).backgroundColor : null;
      })(),
      popup: Boolean(document.querySelector(".rm-autocomplete__results")),
      preview: (() => {
        const pane = document.querySelector(".burrow-preview:not([hidden])");
        if (!pane) return null;
        return {
          trail: pane.querySelector(".burrow-trail")?.textContent,
          target: pane.querySelector(".burrow-target")?.textContent ?? null,
          checks: [...pane.querySelectorAll(".burrow-node.burrow-task-todo, .burrow-node.burrow-task-done")].length,
          targetClasses: [...new Set([...(pane.querySelector(".burrow-target")?.querySelectorAll("*") || [])].flatMap((n) => [...n.classList].filter((x) => x.startsWith("burrow-"))))].sort(),
          label: getComputedStyle(pane.querySelector(".burrow-trail"), "::before").content,
          previewMore: pane.querySelector(".burrow-more")?.textContent ?? null,
          targetVisible: (() => {
            const t = pane.querySelector(".burrow-target");
            if (!t) return null;
            const a = t.getBoundingClientRect(); const b = pane.getBoundingClientRect();
            return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
          })(),
          nativeHidden: [...document.querySelectorAll(".rm-autocomplete__results.burrow-drill .rm-autocomplete__preview > *")].every((n) => getComputedStyle(n).visibility === "hidden"),
        };
      })(),
      rowPreview: (() => {
        const pane = document.querySelector(".burrow-preview.burrow-preview-docked:not([hidden])");
        if (!pane) return null;
        const native = document.querySelector(".rm-autocomplete__preview");
        const over = native ? overlap(pane.getBoundingClientRect(), native.getBoundingClientRect()) : 0;
        return { trail: pane.querySelector(".burrow-trail")?.textContent ?? null, docked: true, overNative: over >= 0.9 };
      })(),
      value: document.activeElement?.value,
      prompt: (() => {
        const el = document.querySelector(".burrow-prompt");
        if (!el) return null;
        const input = el.querySelector(".burrow-prompt-input");
        return {
          label: el.querySelector(".burrow-prompt-label")?.textContent ?? null,
          input: input ? (input.value ?? input.textContent) : null,
          fresh: Boolean(input?.classList.contains("burrow-fresh") || el.classList.contains("burrow-fresh")),
          error: el.querySelector(".burrow-prompt-error")?.textContent || null,
        };
      })(),
      confirm: document.querySelector(".burrow-confirm-text")?.textContent ?? null,
      visibleBurrow: [...document.querySelectorAll("[class*=burrow-]")]
        .filter((n) => !n.closest("[hidden]") && shown(n)).map((n) => `${n.tagName}.${String(n.className).split(/\s+/).filter((x) => x.includes("burrow-")).join(".")}`),
      geometry: {
        // The textarea's text line(s): its padding may sit under the popover's edge.
        ta: (() => {
          const el = document.getElementById(window.__burrowFixture?.inputId);
          const box = rect(el);
          if (!box) return null;
          const cs = getComputedStyle(el);
          return { l: box.l, t: box.t + parseFloat(cs.paddingTop), r: box.r, b: box.b - parseFloat(cs.paddingBottom) };
        })(),
        pop: rect(document.querySelector(".rm-autocomplete__results")),
        strip: rect(document.querySelector(".burrow-strip:not([hidden])")),
        hints: rect(document.querySelector(".burrow-hints:not([hidden])")),
        scope: rect(document.querySelector(".burrow-scope:not([hidden])")),
        preview: rect(document.querySelector(".burrow-preview:not([hidden])")),
      },
      ...(() => {
        const panel = document.querySelector(".burrow-scope:not([hidden])");
        const scopeRowsList = panel ? [...panel.querySelectorAll(".burrow-scope-list .burrow-row")] : [];
        const column = document.querySelector(".rm-aliases");
        const items = [...document.querySelectorAll(".rm-aliases .dont-focus-block.alias")];
        const line = document.querySelector(".burrow-chips");
        return {
          scope: panel ? {
            crumb: panel.querySelector(".burrow-scope-crumb")?.textContent ?? "",
            what: panel.querySelector(".burrow-scope-what")?.textContent ?? "",
            rows: scopeRowsList.map((r) => r.textContent),
            rowsFull: scopeRowsList.map((r) => ({ text: r.textContent, cls: r.className })),
            rowsRich: scopeRowsList.map((r) => ({
              text: r.textContent,
              labels: [...r.querySelectorAll(".burrow-label")].map((n) => n.textContent),
              checks: [...r.querySelectorAll(".burrow-check")].length,
            })),
            active: scopeRowsList.find((r) => r.classList.contains("burrow-active"))?.textContent ?? null,
            filter: panel.querySelector(".burrow-scope-filter")?.textContent ?? "",
          } : null,
          scopeHints: panel?.querySelector(".burrow-scope-hints .burrow-hints-list")?.textContent ?? null,
          chips: [...document.querySelectorAll(".burrow-chips .burrow-chip")].map((n) => {
            const box = n.parentElement.getBoundingClientRect();
            const r = n.getBoundingClientRect();
            return {
              text: n.textContent, title: n.getAttribute("title"), active: n.classList.contains("burrow-active"),
              inView: r.left >= box.left - 0.5 && r.right <= box.right + 0.5, l: r.left, r: r.right,
              ellipsized: n.scrollWidth > n.clientWidth + 1, clientWidth: n.clientWidth, scrollWidth: n.scrollWidth, lineWidth: line?.clientWidth ?? 0,
            };
          }),
          chipsScroll: line?.scrollLeft ?? null,
          hints: document.querySelector(".burrow-hints:not([hidden]) .burrow-hints-list")?.textContent ?? null,
          helpButton: (() => { const b = document.querySelector(".burrow-hints:not([hidden]) .burrow-help-button"); return b && !b.hidden ? b.textContent : null; })(),
          sheet: (() => {
            const sheet = document.querySelector(".burrow-help:not([hidden])");
            if (!sheet) return null;
            const r = sheet.getBoundingClientRect();
            return {
              groups: [...sheet.querySelectorAll(".burrow-help-group-title")].map((n) => n.textContent),
              keys: [...sheet.querySelectorAll(".burrow-help-key")].map((n) => n.textContent),
              notes: [...sheet.querySelectorAll(".burrow-help-note")].map((n) => n.textContent),
              box: { l: r.left, t: r.top, r: r.right, b: r.bottom }, inWindow: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
            };
          })(),
          popoverCovered: Boolean(document.querySelector(".rm-autocomplete__results.burrow-help-open")) && getComputedStyle(document.querySelector(".rm-autocomplete__results")).visibility === "hidden",
          tip: (() => {
            const tip = document.querySelector(".burrow-tip:not([hidden])");
            if (!tip) return null;
            const r = tip.getBoundingClientRect();
            return { text: tip.textContent, box: { l: r.left, t: r.top, r: r.right, b: r.bottom }, bg: getComputedStyle(tip).backgroundColor, fg: getComputedStyle(tip).color };
          })(),
          titles: [...document.querySelectorAll(".burrow-strip .burrow-row[title], .burrow-chips .burrow-chip[title]")].length,
          listScroll: document.querySelector(".rm-autocomplete__results-scroll")?.scrollTop ?? null,
          popBg: (() => { const p = document.querySelector(".rm-autocomplete__results"); return p ? getComputedStyle(p).backgroundColor : null; })(),
          lastWheel: (window.__BURROW?.debug.trace || []).filter((e) => e.ev === "wheel").at(-1)?.to ?? null,
          aliasEntries: window.__BURROW?.indexes?.aliases?.entries.map((e) => e.alias) ?? null,
          nudgeSeen: window.__burrowDev?.values?.helpNudgeSeen ?? null,
          listScrollable: (() => { const l = document.querySelector(".rm-autocomplete__results-scroll"); return l ? l.scrollHeight > l.clientHeight + 4 : null; })(),
          listMax: (() => { const l = document.querySelector(".rm-autocomplete__results-scroll"); return l ? l.scrollHeight - l.clientHeight : null; })(),
          popoverHidden: Boolean(document.querySelector(".rm-autocomplete__results.burrow-scope-open")),
          foldedAliases: column ? getComputedStyle(column).display === "none" || items.every((i) => !shown(i)) : true,
          roamAliasesVisibleRows: items.filter(shown).length,
        };
      })(),
    };
  });
}

async function setArm(arm) {
  const code = await readFile(new URL("extension.js", root), "utf8");
  const css = await readFile(new URL("extension.css", root), "utf8");
  const loaded = await c.evaluate(async ({ arm, code, css, features, refCommand }) => {
    const dev = window.__burrowDev || (window.__burrowDev = { values: {} });
    if (arm === "gone") {
      if (dev.module) await dev.module.default.onunload();
      dev.module = null;
      document.getElementById("burrow-dev-css")?.remove();
      const leftovers = document.querySelectorAll(".burrow-strip, .burrow-hints, .burrow-hud, .burrow-owning, .rm-autocomplete__results [class*=burrow-]").length;
      if (leftovers) throw new Error(`${leftovers} Burrow node(s) left after unload`);
      return { arm, leftovers };
    }
    for (const f of features) dev.values[f] = arm === "on" || arm === "drilloff";
    if (arm === "drilloff") { dev.values.drill = false; dev.values.drillPreview = false; }
    dev.values.helpNudgeSeen = true;
    if (!dev.module) {
      const style = document.createElement("style");
      style.id = "burrow-dev-css";
      style.textContent = css;
      document.head.append(style);
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      dev.module = await import(url);
      URL.revokeObjectURL(url);
      const extensionAPI = {
        settings: {
          canSet: true, get: (k) => (k in dev.values ? dev.values[k] : null),
          set: async (k, v) => { dev.values[k] = v; }, panel: { create: async () => null },
        },
        // Only the ref-search entry reaches Roam's palette; the installed 0.2.0
        // registered "Burrow: Disable all features" through its own API, so
        // that label is never added or removed here.
        ui: {
          commandPalette: {
            addCommand: async (cmd) => (cmd?.label === refCommand ? window.roamAlphaAPI.ui.commandPalette.addCommand(cmd) : null),
            removeCommand: async (cmd) => (cmd?.label === refCommand ? window.roamAlphaAPI.ui.commandPalette.removeCommand(cmd) : null),
          },
        },
      };
      await dev.module.default.onload({ extensionAPI, extension: { version: "gate" } });
    }
    const t0 = performance.now();
    while (!window.__BURROW?.indexes?.refs && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 100));
    return { arm, refs: window.__BURROW?.indexes?.refs?.entries.length };
  }, { arm, code, css, features: FEATURES, refCommand: REF_COMMAND });
  // The alias cases need the scratch alias pages (and use counts) in Burrow's index; "off" never reads them.
  if (arm === "on" || arm === "drilloff") await waitAliasFixtures(c);
  return loaded;
}

// ---- cases ----

const q = config.ref.query;
const qBody = q.slice(2);
const open = `${SEED}${q}${q.startsWith("((") ? "))" : "]]"}`;
const committed = `${SEED}((${config.ref.uid}))`;

const CASES = [
  { name: "Enter", keys: ["Enter"], on: committed },
  { name: "Tab", keys: ["Tab"], on: committed, settings: { tabDrill: false } },
  { name: "Escape", keys: ["Escape"] },
  { name: "ArrowDown past the strip then Escape", keys: ["down-past-strip", "Escape"] },
  { name: "ArrowUp then Escape", keys: ["ArrowUp", "Escape"] },
  // ↓ past Burrow's rows returns selection to Roam's row, so Enter must then
  // do exactly what Roam does with no Burrow at all.
  { name: "ArrowDown past the strip then Enter", keys: ["down-past-strip", "Enter"] },
  { name: "ArrowLeft then Enter", keys: ["ArrowLeft", "Enter"] },
  { name: "ArrowRight then Escape", keys: ["ArrowRight", "Escape"] },
  { name: "type abc then Escape", keys: ["type:abc", "Escape"] },
  { name: "Backspace then Escape", keys: ["Backspace", "Escape"] },
  { name: "click away", keys: ["click"] },
  { name: "IME composition then Escape", keys: ["ime", "Escape"] },
  { name: "caret moved before commit", keys: ["caret-move", "Enter"] },
  // Svy's 0.5.0 test (2026-10-22): ← into the token, ↑, Enter. Burrow gives the
  // popup to Roam at once (no rows of its own for a caret inside the token), so
  // ↑ and Enter are Roam's, on the row Roam shows highlighted: as without Burrow.
  // Roam re-queries a moment after the caret moves; an Enter before that makes
  // its footnote of the older text (seen in notes with Burrow absent), so each
  // arm waits for it.
  { name: "caret back into the token, ↑, Enter (Svy's footnote case)", keys: ["ArrowLeft", "wait:500", "snap", "ArrowUp", "wait:300", "snap", "Enter"],
    check: ({ snaps: [a, b] }) => (a?.rows.length || b?.rows.length ? `Burrow rows after ← ${JSON.stringify(a?.rows)} / after ↑ ${JSON.stringify(b?.rows)}` : null) },
  // Back at the end of the token, Burrow ranks again and its original is selected.
  { name: "caret back to the end of the token brings Burrow's rows back", keys: ["ArrowLeft", "ArrowRight", "wait:250", "snap", "Enter"], on: committed,
    check: ({ snaps: [a] }) => (a?.rows[0]?.active ? null : `rows after → ${JSON.stringify(a?.rows)}`) },
  // A pick Burrow cannot write (here the block it ranked for is no longer the
  // focused one): Enter stays Burrow's and writes nothing; no Roam row runs.
  { name: "a refused pick keeps Enter: nothing written, no Roam row runs", keys: ["refuse-focus", "Enter", "restore-focus", "snap"], on: open,
    check: ({ snaps: [a] }) => (a?.popup ? null : "the popup closed") },
  { name: "scorer throws", pre: "break", keys: ["Enter"] },
  { name: "unloaded mid-popup", keys: ["unload", "Enter"] },
];

// Drill cases (spec §5) on the fixture's heading tree; `on` values need the
// tree's uids, known once the fixture exists.
const DRILL_PAGE = FIXTURE_PAGE;
const DRILL_Q = `[[${DRILL_PAGE}#alpha > never`;
const DRILL_CASES = [
  { name: "drill: Enter inserts the resolved block", query: DRILL_Q, keys: ["Enter"], on: (d) => `${SEED}((${d.never}))`, preview: { trail: `${DRILL_PAGE} › Alpha section`, target: "never grok for writing" } },
  { name: "drill: Tab inserts the resolved block", query: DRILL_Q, keys: ["Tab"], on: (d) => `${SEED}((${d.never}))`, settings: { tabDrill: false } },
  { name: "drill: Escape", query: DRILL_Q, keys: ["Escape"] },
  { name: "drill: ArrowDown and ArrowUp do nothing, then Enter", query: DRILL_Q, keys: ["ArrowDown", "ArrowUp", "Enter"], on: (d) => `${SEED}((${d.never}))` },
  { name: "drill: typing past >", query: DRILL_Q, keys: ["type: > gr", "Enter"], on: (d) => `${SEED}((${d.grand}))` },
  { name: "drill: empty # takes the first heading", query: `[[${DRILL_PAGE}#`, keys: ["Enter"], on: (d) => `${SEED}((${d.alpha}))` },
  { name: "drill: Enter on an unresolved heading", query: `[[${DRILL_PAGE}#zzzz`, keys: ["Enter"], on: () => `${SEED}[[${DRILL_PAGE}]]` },
  { name: "drill: Backspace out of drill then Escape", query: `[[${DRILL_PAGE}#`, keys: ["Backspace", "Escape"] },
  { name: "drill: caret moved before commit", query: DRILL_Q, keys: ["caret-move", "Enter"] },
  { name: "drill: typed > 2 takes the numbered block", query: `[[${DRILL_PAGE} > steps > 2`, keys: ["Enter"], on: (d) => `${SEED}((${d.two}))`, line: true },
  // Burrow's preview shows 16 of the section's 55 children and says so.
  { name: "drill: preview caps children with +N more", query: `[[${DRILL_PAGE} > many`, keys: ["Enter"], on: (d) => `${SEED}((${d.many}))`, previewMore: "+39 more", line: true },
];

// After typing the query: wait until Roam's popup is up and, with Burrow on,
// its strip has rendered (ranking runs just after paint).
async function settle(arm) {
  const t0 = Date.now();
  while (Date.now() - t0 < 2000) {
    const ready = await c.evaluate((arm) => {
      if (!document.querySelector(".rm-autocomplete__results")) return false;
      if (arm !== "on") return true;
      const b = window.__BURROW;
      return Boolean(b && b.state.phase !== "IDLE" && document.querySelector(".burrow-strip:not([hidden]) .burrow-row"));
    }, arm);
    if (ready) break;
    await sleep(40);
  }
  await sleep(120);
}

// A case's own settings, applied after the arm is loaded and put back after.
async function withSettings(arm, settings, fn) {
  if (!settings || arm === "gone" || arm === "off") return fn();
  const previous = await c.evaluate((next) => {
    const values = window.__burrowDev.values;
    const saved = {};
    for (const [id, value] of Object.entries(next)) { saved[id] = values[id]; values[id] = value; }
    return saved;
  }, settings);
  try {
    return await fn();
  } finally {
    await c.evaluate((saved) => { Object.assign(window.__burrowDev.values, saved); }, previous);
  }
}

// Alt+Shift+9 as a mac sends it: the key is the typed character "·".
const altShift9 = async () => {
  const base = { key: "·", code: "Digit9", windowsVirtualKeyCode: 57, nativeVirtualKeyCode: 57, modifiers: 9 };
  await c.call("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: "·", unmodifiedText: "·" });
  await c.call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
};

// ⌥/ as a mac sends it: the key is the typed character "÷" (Roam alone types it).
const altSlash = async () => {
  const base = { key: "÷", code: "Slash", windowsVirtualKeyCode: 191, nativeVirtualKeyCode: 191, modifiers: 1 };
  await c.call("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: "÷", unmodifiedText: "÷" });
  await c.call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
};

// Roam's command palette; a raw key event, so no "p" is typed if Roam lets it through.
const metaP = async () => {
  const base = { key: "p", code: "KeyP", windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80, modifiers: 4 };
  await c.call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await c.call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
};

// Centre of the first element matching a selector whose text passes `test`.
const centerOf = (selector, text, exact = false) => c.evaluate(({ selector, text, exact }) => {
  const el = [...document.querySelectorAll(selector)].find((n) => (text == null ? true : exact ? n.textContent.trim() === text : n.textContent.includes(text)));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { selector, text, exact });

// A missing target is recorded, not thrown: the Roam-alone arm has no panel to click.
let misses = [];
let wheelSteps = 0;
// Roam's drag mode adds .dnd-drop-area separators on dragEnter that cover the
// editing textarea and cancel the drop, and it ends only when one of them gets
// a drop. So they are made click-through for the drop, then one is dropped on.
async function dropText(text) {
  const drag = (type, { x, y }, items = []) => c.call("Input.dispatchDragEvent", { type, x, y, data: { items, dragOperationsMask: 1 } });
  const centre = () => c.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  let at = null, found = false;
  await c.evaluate(() => { const st = document.createElement("style"); st.id = "burrow-gate-nodnd"; st.textContent = ".dnd-drop-area { pointer-events: none !important; }"; document.head.append(st); });
  try {
    const items = [{ mimeType: "text/plain", data: text }];
    at = await centre();
    await drag("dragEnter", at, items);
    await sleep(150);
    const point = await c.evaluate(() => {
      const ta = document.activeElement, r = ta.getBoundingClientRect(), cy = r.top + r.height / 2;
      const xs = [r.left + r.width / 2, r.left + 12, r.left + r.width / 4, r.left + 3 * r.width / 4];
      for (const y of [cy, r.top + 10]) for (const x of xs) if (document.elementFromPoint(x, y) === ta) return { x, y };
      return null;
    });
    if (point) {
      at = point;
      found = true;
      await drag("dragOver", point, items);
      await drag("drop", point, items);
    }
  } finally {
    await c.evaluate(() => document.getElementById("burrow-gate-nodnd")?.remove());
    await sleep(100);
    if (at) for (const type of ["dragEnter", "dragOver", "drop"]) await drag(type, at);
    await sleep(150);
  }
  if (!found) throw new Error("drop: no point on the textarea after dragEnter");
  const on = await c.evaluate(() => [...document.querySelectorAll(".dnd-drop-area")].filter((e) => e.getBoundingClientRect().height > 0).length);
  if (on) throw new Error("drop: Roam's drag mode stayed on");
}

async function clickAt(point, what) {
  if (!point) { misses.push(`missing click target: ${what}`); return; }
  await c.click(point.x, point.y);
}

// The palette input is not the fixture's textarea, so the key guard steps aside while it is open.
async function palette(label) {
  await c.evaluate(() => { window.__burrowFixture.guard.armed = false; });
  try {
    await metaP();
    for (let t0 = Date.now(); Date.now() - t0 < 3000;) {
      if (await c.evaluate(() => document.activeElement?.tagName === "INPUT")) break;
      await sleep(50);
    }
    await c.type(label, 25);
    await sleep(400);
    await c.key("Enter");
    await sleep(300);
  } finally {
    await c.evaluate(() => { if (window.__burrowFixture) window.__burrowFixture.guard.armed = true; });
  }
}

const restoreFocus = () => c.evaluate(() => {
  if (window.__burrowGateFocus) { window.roamAlphaAPI.ui.getFocusedBlock = window.__burrowGateFocus; window.__burrowGateFocus = null; }
});

async function runKeys(keys, snaps = []) {
  for (const k of keys) {
    const modified = k.match(/^(alt|ctrl|meta|shift)\+(.+)$/);
    if (k === "snap") snaps.push(await state());
    else if (k === "alt+shift+9") await altShift9();
    else if (k === "alt+slash") await altSlash();
    else if (k.startsWith("hover:")) {
      const point = await centerOf(k.slice(6), null);
      if (!point) misses.push(`missing hover target: ${k}`);
      else for (const dx of [-20, 0]) await c.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + dx, y: point.y });
    } else if (k === "mouse-away") await c.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
    else if (k.startsWith("outside-alias:")) await setAliasBlock(c, fx.chipsAliasUid, k.slice(14));
    else if (k === "ctrl+o") await ctrlO();
    else if (k === "meta+p") await metaP();
    else if (k === "preview-open") { if (!(await isExpanded())) await ctrlO(); }
    else if (k.startsWith("down:")) {
      for (let i = 0; i < Number(k.slice(5)); i++) { await c.key("ArrowDown"); await sleep(40); }
    } else if (k.startsWith("scope-to:")) {
      const want = k.slice(9);
      for (let i = 0; i < 60; i++) {
        const active = (await state()).scope?.active ?? "";
        if (active.includes(want)) break;
        await c.key("ArrowDown");
        await sleep(40);
      }
    } else if (k.startsWith("wheel:chips:")) {
      const point = await centerOf(".burrow-chips", null);
      if (!point) throw new Error("wheel: no chips line");
      await c.wheel(point.x, point.y, 0, Number(k.slice(12)));
    } else if (k.startsWith("wheel-until:chips:")) {
      const alias = k.slice(18);
      const chipInView = () => c.evaluate((alias) => {
        const line = document.querySelector(".burrow-chips");
        const chip = [...document.querySelectorAll(".burrow-chips .burrow-chip")].find((n) => n.textContent.trim() === alias);
        if (!line || !chip) return false;
        const box = line.getBoundingClientRect();
        const r = chip.getBoundingClientRect();
        return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
      }, alias);
      const point = await centerOf(".burrow-chips", null);
      if (!point) throw new Error("wheel-until: no chips line");
      let steps = 0;
      while (steps < 25 && !(await chipInView())) {
        await c.wheel(point.x, point.y, 0, 120);
        steps += 1;
        await sleep(80);
      }
      wheelSteps = steps;
    } else if (k.startsWith("click:chip:")) await clickAt(await centerOf(".burrow-chips .burrow-chip", k.slice(11), true), k);
    else if (k === "click:help") await clickAt(await centerOf(".burrow-hints:not([hidden]) .burrow-help-button", null), k);
    else if (k === "click:nudge-close") await clickAt(await centerOf(".burrow-hints:not([hidden]) .burrow-nudge-close", null), k);
    else if (k.startsWith("click:scope:")) await clickAt(await centerOf(".burrow-scope-list .burrow-row", k.slice(12)), k);
    else if (k.startsWith("click:crumb:")) await clickAt(await centerOf(`.burrow-crumb[data-level="${k.slice(12)}"]`, null), k);
    else if (k === "click-away") await neutralClick(c);
    else if (k.startsWith("palette:")) await palette(k.slice(8));
    else if (k.startsWith("wait:")) await sleep(Number(k.slice(5)));
    else if (k === "low") await placeLow(c);
    else if (k === "normal") await placeNormal(c);
    else if (modified) await c.key(modified[2], { alt: 1, ctrl: 2, meta: 4, shift: 8 }[modified[1]]);
    else if (k.startsWith("type:")) await c.type(k.slice(5), TYPE_MS);
    else if (k === "click") await neutralClick(c);
    else if (k === "down-past-strip") {
      const rows = (await state()).rows.length;
      for (let i = 0; i < rows; i++) { await c.key("ArrowDown"); await sleep(60); }
    }
    else if (k === "ime") {
      await c.call("Input.imeSetComposition", { text: "ni", selectionStart: 2, selectionEnd: 2 });
      await sleep(150);
      await c.call("Input.insertText", { text: "你" });
    } else if (k.startsWith("insert:")) await c.call("Input.insertText", { text: k.slice(7) });
    else if (k.startsWith("drop:")) await dropText(k.slice(5));
    else if (k.startsWith("exec:")) await c.evaluate((t) => document.execCommand("insertText", false, t), k.slice(5));
    else if (k === "refuse-focus") {
      // The block Burrow ranked for is no longer the focused one, as far as its commit check can tell.
      await c.evaluate(() => {
        const ui = window.roamAlphaAPI.ui;
        if (!window.__burrowGateFocus) window.__burrowGateFocus = ui.getFocusedBlock;
        ui.getFocusedBlock = () => ({ "block-uid": "zzzzzzzzz", "window-id": "gate" });
      });
    } else if (k === "restore-focus") {
      await restoreFocus();
    } else if (k === "caret-move") {
      await c.evaluate(() => { const ta = document.activeElement; ta.setSelectionRange(ta.selectionStart - 1, ta.selectionStart - 1); });
    } else if (k === "unload") {
      await c.evaluate(async () => { const d = window.__burrowDev; if (d?.module) await d.module.default.onunload(); });
    } else if (k === "rerender") {
      // A style change on Roam's popover makes Burrow redraw, as Roam's own updates do.
      await c.evaluate(() => {
        const pop = document.querySelector(".rm-autocomplete__results");
        pop?.style.setProperty("--burrow-gate", "1");
        pop?.style.removeProperty("--burrow-gate");
      });
    } else await c.key(k);
    if (k !== "snap" && !k.startsWith("wait:")) await sleep(120);
  }
}

// [[ alias cases, on arm only: Enter in Roam's own [[ could create a page.
const ALIAS_CASES = [
  { name: "alias row: ArrowUp into the strip, Enter", query: config.alias.query, keys: ["ArrowUp", "Enter"], on: `${SEED}${config.alias.insert}` },
  {
    name: "alias listed by roam-aliases: Burrow row, its column folded", query: config.listed.query, keys: ["snap", "Escape"],
    mayCreatePage: true, waitAliases: true,
    check: (r) => {
      const snap = r.snaps[0];
      if (!snap?.rows.some((row) => row.text.includes("↳"))) return `no Burrow alias row ${JSON.stringify(snap?.rows)}`;
      if (r.before.roamAliasesRows && !snap.foldedAliases) return "roam-aliases rows still visible";
      return null;
    },
  },
  {
    name: "aliasInline off: roam-aliases keeps its rows", query: config.listed.query, keys: ["snap", "Escape"],
    settings: { aliasInline: false }, mayCreatePage: true, waitAliases: true, noRows: true,
    check: (r) => {
      const snap = r.snaps[0];
      if (snap?.rows.length) return `Burrow rows ${JSON.stringify(snap.rows)}`;
      return snap?.roamAliasesVisibleRows > 0 ? null : "roam-aliases shows no rows";
    },
  },
  {
    name: "alias pre-selected: Enter inserts it", query: config.preselect.query, keys: ["snap", "Enter"], on: `${SEED}${config.preselect.insert}`,
    check: (r) => {
      if (!r.snaps[0]?.rows[0]?.active) return `first row not active ${JSON.stringify(r.snaps[0]?.rows)}`;
      return r.snaps[0].hints === HINTS_ROW ? null : `hints ${JSON.stringify(r.snaps[0].hints)}`;
    },
  },
  {
    // Real pages may have use counts; this case is about the alias-block order.
    name: "alias chips: ⌥↓, ←, Enter", query: config.chips.query, settings: { aliasUsage: false },
    keys: ["snap", ...config.chips.keys.flatMap((k) => (k === "alt+ArrowDown" ? [k, "snap"] : [k]))], on: `${SEED}${config.chips.insert}`,
    check: (r) => {
      const chips = r.snaps[1]?.chips || [];
      return chips.length >= 2 && chips.filter((chip) => chip.active).length === 1 ? null : `chips after ⌥↓ ${JSON.stringify(chips)}`;
    },
  },
  {
    // The fixture's Chips page has more aliases than the chip line holds.
    name: "alias chips: the active chip scrolls into view", query: `[[${CHIP_ALIASES[0].slice(0, 10)}`, settings: { aliasUsage: false },
    keys: ["alt+ArrowDown", "snap", ...Array(7).fill("ArrowRight"), "snap", ...Array(7).fill("ArrowLeft"), "snap", ...Array(7).fill("ArrowRight"), "Enter"],
    on: `${SEED}[${CHIP_ALIASES.at(-1)}]([[${FIXTURE_PAGE} Chips]])`,
    check: (r) => {
      const [first, last, back] = r.snaps;
      const at = (snap) => snap?.chips.findIndex((chip) => chip.active) ?? -1;
      const bad = r.snaps.map(chipsProblem).find(Boolean);
      if (bad) return bad;
      if (first?.chips.length !== CHIP_ALIASES.length + 1 || first.chips.every((chip) => chip.inView)) return `no clipped chips after ⌥↓ ${JSON.stringify(first?.chips)}`;
      if (at(last) !== CHIP_ALIASES.length - 1 || !last.chips[at(last)].inView) return `after → ×7 ${JSON.stringify(last?.chips)}`;
      if (at(back) !== 0 || !back.chips[0].inView || back.chipsScroll !== 0) return `after ← ×7 scroll ${back?.chipsScroll} ${JSON.stringify(back?.chips)}`;
      return null;
    },
  },
  {
    name: "alias chips: wheel scrolls the line, click a hidden chip", query: `[[${CHIP_ALIASES[0].slice(0, 10)}`, settings: { aliasUsage: false },
    keys: ["snap", `wheel-until:chips:${CHIP_ALIASES[7]}`, "rerender", "wait:300", "wait:200", "snap", `click:chip:${CHIP_ALIASES[7]}`],
    on: `${SEED}[${CHIP_ALIASES[7]}]([[${FIXTURE_PAGE} Chips]])`,
    check: ({ snaps: [a, b] }) => {
      const hotel = (snap) => snap?.chips.find((chip) => chip.text === CHIP_ALIASES[7]);
      if (!hotel(a) || hotel(a).inView || a.chipsScroll !== 0) return `before the wheel: scroll ${a?.chipsScroll} ${JSON.stringify(hotel(a))}`;
      if (!(b?.chipsScroll > 0) || !hotel(b)?.inView) return `after the wheel: scroll ${b?.chipsScroll} ${JSON.stringify(hotel(b))}`;
      return null;
    },
  },
  {
    name: "alias chips: a long alias shows in full when selected", query: `[[${CHIP_ALIASES[0].slice(0, 10)}`, settings: { aliasDelete: true, aliasUsage: false },
    keys: ["alt+ArrowDown", "snap", ...Array(8).fill("ArrowRight"), "snap", "Enter"],
    on: `${SEED}[${CHIP_LONG}]([[${FIXTURE_PAGE} Chips]])`,
    check: ({ snaps: [a, b] }) => {
      const long = (snap) => snap?.chips.find((chip) => chip.text === CHIP_LONG);
      const bad = [a, b].map(chipsProblem).find(Boolean);
      if (bad) return bad;
      if (!long(a)?.ellipsized || long(a).title !== CHIP_LONG) return `long chip before selecting ${JSON.stringify(long(a))}`;
      if (!long(b)?.active || long(b).ellipsized || !long(b).inView) return `long chip when selected ${JSON.stringify(long(b))}`;
      if (a.hints !== HINTS_CHIPS) return `chip hints ${JSON.stringify(a.hints)}`;
      return null;
    },
  },
  {
    name: "chips: a wheel the chips cannot take scrolls Roam's list", query: config.wheelList.query, mayCreatePage: true,
    keys: ["alt+ArrowDown", "snap", "wheel:chips:240", "wait:250", "snap", "Escape", "Escape"],
    check: ({ snaps: [a, b] }) => {
      if (!(a?.chips?.length >= 2)) return `no chips ${JSON.stringify(a?.chips)}`;
      if (!a.listScrollable) return "Roam's list does not scroll for this query";
      // Roam may have scrolled its own list to its active row already.
      if (!(b?.listScroll > a.listScroll) || b.lastWheel !== "list") return `after the wheel: list ${a.listScroll} -> ${b?.listScroll}, Burrow sent it to ${b?.lastWheel}`;
      return b.chipsScroll === 0 ? null : `the chips moved ${b.chipsScroll}`;
    },
  },
  {
    name: "chips: at the end of the line the wheel goes on to Roam's list", query: `[[${CHIP_ALIASES[0].slice(0, 10)}`, mayCreatePage: true, settings: { aliasUsage: false },
    keys: [`wheel-until:chips:${CHIP_LONG}`, "snap", "wheel:chips:120", "wait:250", "snap", "wheel:chips:-120", "wait:250", "snap", "Escape"],
    check: ({ snaps: [a, b, d] }) => {
      if (!(a?.chipsScroll > 0) || a.lastWheel !== "chips") return `the line did not scroll to its end: ${a?.chipsScroll} ${a?.lastWheel}`;
      // Past the chips: Roam's list, or the browser when that list cannot move down.
      const past = a.listScrollable && a.listScroll < a.listMax - 0.5 ? "list" : "native";
      if (b?.chipsScroll !== a.chipsScroll || b.lastWheel !== past) return `at the end: scroll ${b?.chipsScroll} (was ${a.chipsScroll}), sent to ${b?.lastWheel}, expected ${past}`;
      return d?.chipsScroll < b.chipsScroll && d.lastWheel === "chips" ? null : `back: scroll ${d?.chipsScroll}, sent to ${d?.lastWheel}`;
    },
  },
  {
    name: "chips: a wheel Roam's list cannot take is left to the browser", query: config.wheelList.query, mayCreatePage: true,
    keys: ["alt+ArrowDown", "snap", "wheel:chips:-240", "wait:250", "snap", "Escape", "Escape"],
    check: ({ snaps: [a, b] }) => {
      if (!(a?.chips?.length >= 2)) return `no chips ${JSON.stringify(a?.chips)}`;
      if (a.chipsScroll !== 0) return `the chips start scrolled ${a.chipsScroll}`;
      // Roam may have scrolled its list to its active row: then up is still the list's.
      const want = a.listScroll > 0.5 ? "list" : "native";
      if (b?.lastWheel !== want) return `list at ${a.listScroll}: sent to ${b?.lastWheel}, expected ${want}`;
      if (want === "native" && b.listScroll !== a.listScroll) return `the list moved ${a.listScroll} -> ${b.listScroll}`;
      return b.chipsScroll === 0 ? null : `the chips moved ${b.chipsScroll}`;
    },
  },
  {
    name: "hint line: no ⇥ on a page without blocks", query: `[[${FIXTURE_PAGE} Empty`, settings: { aliasCreate: false }, noRows: true,
    keys: ["snap", "Escape"],
    check: ({ snaps: [a] }) => (a?.hints === "" && a.helpButton === "?" ? null : `hints ${JSON.stringify(a?.hints)} button ${JSON.stringify(a?.helpButton)}`),
  },
  {
    name: "hint line: with the key list off it stays while typing, also with nothing to name", query: `[[${FIXTURE_PAGE} Empty`,
    settings: { aliasCreate: false, helpSheet: false }, noRows: true,
    keys: ["snap", "Backspace", "Backspace", "Backspace", "Backspace", "Backspace", "Backspace", "wait:300", "snap", "Escape"],
    check: ({ snaps: [a, b] }) => {
      if (a?.hints !== "" || a.helpButton !== null) return `on the empty page: hints ${JSON.stringify(a?.hints)} button ${JSON.stringify(a?.helpButton)}`;
      return b?.hints === "⇥ blocks on this page" && b.helpButton === null ? null : `on the page with blocks: hints ${JSON.stringify(b?.hints)} button ${JSON.stringify(b?.helpButton)}`;
    },
  },
  {
    name: "hint line: ⇥ blocks on this page, on a page with blocks", query: `[[${FIXTURE_PAGE}`, noRows: true,
    keys: ["snap", "Escape"],
    check: ({ snaps: [a] }) => (a?.hints === "⇥ blocks on this page · ⌥A add alias" && a.helpButton === "?" ? null : `hints ${JSON.stringify(a?.hints)} button ${JSON.stringify(a?.helpButton)}`),
  },
  {
    name: "key list: ⌥/ opens it in the popover's place, Esc closes it, the text stays", query: config.preselect.query, mayCreatePage: true,
    keys: ["alt+slash", "snap", "Escape", "snap", "Escape"],
    check: ({ snaps: [a, b] }) => {
      if (!a?.sheet) return "no key list after ⌥/";
      if (JSON.stringify(a.sheet.groups) !== JSON.stringify(["Pick", "Aliases", "Drill", "Preview"])) return `groups ${JSON.stringify(a.sheet.groups)}`;
      if (!["⌥A", "⌥⌫", "⌥↓", "⇥ or >", "⌃O"].every((k) => a.sheet.keys.includes(k))) return `keys ${JSON.stringify(a.sheet.keys)}`;
      if (!a.popoverCovered) return "Roam's popover still shows under the key list";
      if (!a.sheet.inWindow) return `key list outside the window ${JSON.stringify(a.sheet.box)}`;
      if (hits(a.sheet.box, a.geometry.ta)) return "key list covers the text";
      if (a.value !== `${SEED}${config.preselect.query}]]`) return `block while open ${JSON.stringify(a.value)}`;
      if (b?.sheet || !b?.popup || b.popoverCovered) return `after Esc: sheet ${JSON.stringify(b?.sheet)} popup ${b?.popup}`;
      return b.rows[0]?.active ? null : "the alias row lost its selection";
    },
  },
  {
    name: "key list: keys of switches that are off are left out, the write keys named", query: config.preselect.query, mayCreatePage: true,
    settings: { aliasCreate: false, aliasDelete: false, tabDrill: false, drill: false, refOutline: false },
    keys: ["alt+slash", "snap", "Escape", "Escape"],
    check: ({ snaps: [a] }) => {
      if (!a?.sheet) return "no key list";
      if (a.sheet.groups.includes("Drill")) return `a Drill group with drill off ${JSON.stringify(a.sheet.groups)}`;
      if (a.sheet.keys.includes("⌥A") || a.sheet.keys.includes("⌥⌫")) return `write keys listed ${JSON.stringify(a.sheet.keys)}`;
      return /⌥A add \(Create aliases\), ⌥⌫ delete \(Delete aliases\)\. Settings → Burrow/.test(a.sheet.notes.join(" ")) ? null : `notes ${JSON.stringify(a.sheet.notes)}`;
    },
  },
  {
    name: "key list: a typed key closes it and types", query: config.preselect.query, mayCreatePage: true,
    keys: ["alt+slash", "type:x", "snap", "Escape"],
    check: ({ snaps: [a] }) => (a && !a.sheet && !a.popoverCovered && a.value === `${SEED}${config.preselect.query}x]]` ? null : `after typing: sheet ${JSON.stringify(a?.sheet)} value ${JSON.stringify(a?.value)}`),
  },
  {
    name: "key list: the ? on the hint line opens it", query: config.preselect.query, mayCreatePage: true,
    keys: ["click:help", "snap", "Escape", "snap", "Escape"],
    check: ({ snaps: [a, b] }) => (a?.sheet && a.value === `${SEED}${config.preselect.query}]]` && b && !b.sheet && b.popup ? null : `click: sheet ${JSON.stringify(a?.sheet?.groups)} value ${JSON.stringify(a?.value)}; after Esc ${JSON.stringify(b?.sheet)}`),
  },
  {
    name: "first-run line: once, ✕ hides it for good", query: config.preselect.query, settings: { helpNudgeSeen: false }, mayCreatePage: true,
    keys: ["snap", "click:nudge-close", "snap", "Escape"],
    check: ({ snaps: [a, b] }) => {
      if (!a?.helpButton?.includes("all keys") || a.nudgeSeen !== false) return `before ✕: ${JSON.stringify(a?.helpButton)} seen ${a?.nudgeSeen}`;
      if (a.hints !== HINTS_ROW) return `hints beside the line ${JSON.stringify(a.hints)}`;
      return b?.helpButton === "?" && b.nudgeSeen === true && b.popup ? null : `after ✕: ${JSON.stringify(b?.helpButton)} seen ${b?.nudgeSeen}`;
    },
  },
  {
    name: "first-run line: closing the popup counts as seen", query: config.preselect.query, settings: { helpNudgeSeen: false }, mayCreatePage: true,
    keys: ["snap", "Escape", "wait:300", "snap"],
    check: ({ snaps: [a, b] }) => (a?.helpButton?.includes("all keys") && b?.nudgeSeen === true ? null : `line ${JSON.stringify(a?.helpButton)}, seen after closing ${b?.nudgeSeen}`),
  },
  {
    name: "hover tips: rows, chips, hints and preview say their keys, in Roam's colors", query: config.preselect.query, restorePreview: true, mayCreatePage: true,
    keys: ["hover:.burrow-strip .burrow-row", "wait:700", "snap", "mouse-away", "wait:150", "snap",
      "alt+ArrowDown", "hover:.burrow-chips .burrow-chip.burrow-active", "wait:700", "snap", "mouse-away", "Escape",
      "hover:.burrow-hints .burrow-hint", "wait:700", "snap", "mouse-away",
      "preview-open", "wait:500", "hover:.burrow-preview .burrow-trail", "wait:700", "snap", "mouse-away", "Escape"],
    check: ({ snaps: [row, away, chip, hint, pane] }) => {
      const page = config.preselect.page;
      if (!row?.tip?.text.includes(`↳ ${page}`) || !row.tip.text.includes(`insert ${config.preselect.insert}`) || !row.tip.text.includes("⌥↓")) return `row tip ${JSON.stringify(row?.tip?.text)}`;
      if (row.tip.bg === row.popBg) return `tip drawn in the popover's own background ${row.tip.bg}`;
      if (hits(row.tip.box, row.geometry.ta)) return "row tip covers the text";
      if (away?.tip || !(away?.titles > 0)) return `after leaving: tip ${JSON.stringify(away?.tip)} titles ${away?.titles}`;
      if (!chip?.tip?.text.includes("insert [") || !chip.tip.text.includes("⌥⌫")) return `chip tip ${JSON.stringify(chip?.tip?.text)}`;
      if (!hint?.tip?.text.includes("↵")) return `hint tip ${JSON.stringify(hint?.tip?.text)}`;
      return pane?.tip?.text.includes(page) && pane.tip.text.includes("⌃O") ? null : `preview tip ${JSON.stringify(pane?.tip?.text)}`;
    },
  },
  {
    name: "alias row preview: Ctrl-O shows the alias's page", query: config.preselect.query, restorePreview: true, mayCreatePage: true,
    keys: ["preview-open", "wait:400", "snap", "down-past-strip", "wait:400", "snap", "Escape"],
    check: ({ snaps: [a, b] }) => {
      if (a?.rowPreview?.trail !== config.preselect.page || !a.rowPreview.docked || !a.rowPreview.overNative) return `Burrow row selected: ${JSON.stringify(a?.rowPreview)}`;
      return b?.rowPreview === null ? null : `Roam row selected: ${JSON.stringify(b?.rowPreview)}`;
    },
  },
  {
    // 0.9.0: two pages share one alias. One Burrow row per page, each with its own count, and no
    // alias/page pair listed twice by Burrow and a roam-aliases item not folded away.
    name: "shared alias: one row per page", query: "[[zq twin sh", keys: ["snap", "ArrowUp", "snap", "Enter"],
    check: ({ snaps: [a, b], string }) => {
      const aliasRows = (a?.rows || []).map((row, i) => ({ row, i })).filter(({ row }) => row.text.includes("↳"));
      if (aliasRows.length !== 2) return `${aliasRows.length} alias rows ${JSON.stringify(a?.rows)}`;
      const which = (text) => (text.includes(TWIN_A_TITLE) ? "A" : text.includes(TWIN_B_TITLE) ? "B" : "?");
      if (aliasRows.map(({ row }) => which(row.text)).sort().join("") !== "AB") return `rows are not one per page ${JSON.stringify(a.rows)}`;
      for (const { row, i } of aliasRows) {
        const want = String(which(row.text) === "A" ? TWIN_REFS.a : TWIN_REFS.b);
        if (a.rowCounts?.[i] !== want) return `row ${JSON.stringify(row.text)} count ${JSON.stringify(a.rowCounts?.[i])}, expected ${want}`;
      }
      for (const title of [TWIN_A_TITLE, TWIN_B_TITLE]) {
        const listed = aliasRows.filter(({ row }) => row.text.includes(title)).length
          + (a.roamAliasItems || []).filter((text) => text.includes(TWIN_ALIAS) && text.includes(title)).length;
        if (listed > 1) return `${TWIN_ALIAS} -> ${title} listed ${listed} times ${JSON.stringify({ rows: a.rows.map((row) => row.text), roam: a.roamAliasItems })}`;
      }
      const at = b?.rows.findIndex((row) => row.active) ?? -1;
      if (at < 0 || !b.rows[at].text.includes("↳")) return `after ↑ no alias row selected ${JSON.stringify(b?.rows)}`;
      const title = which(b.rows[at].text) === "A" ? TWIN_A_TITLE : which(b.rows[at].text) === "B" ? TWIN_B_TITLE : null;
      if (!title) return `highlighted row ${JSON.stringify(b.rows[at].text)}`;
      return string === `${SEED}[${TWIN_ALIAS}]([[${title}]])` ? null : `inserted ${JSON.stringify(string)} for the highlighted ${title}`;
    },
  },
  {
    // 0.9.0: `[[alias:` lists alias rows only (up to 3) over Roam's list, the first pre-selected, and
    // Enter inserts the alias link with nothing of `alias:` left. The aliasPrefix-off arm is a byte case below.
    name: "alias: prefix lists only alias rows", query: "[[alias:zq us", keys: ["snap", "Enter"],
    check: ({ snaps: [a], string }) => {
      const rows = a?.rows || [];
      if (rows.length < 1 || rows.length > 3) return `${rows.length} Burrow rows ${JSON.stringify(rows)}`;
      if (rows.some((row) => !row.text.includes("↳") || !row.text.includes(USED_TITLE))) return `a row that is not an alias row of ${USED_TITLE}: ${JSON.stringify(rows)}`;
      if (!rows[0].active) return `first row not pre-selected ${JSON.stringify(rows)}`;
      if (!a.nativeRows) return "Roam's own list is gone";
      const escaped = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`^${escaped(SEED)}\\[(${USED_ALIASES.map(escaped).join("|")})\\]\\(\\[\\[${escaped(USED_TITLE)}\\]\\]\\)$`).test(string)) return `inserted ${JSON.stringify(string)}`;
      return string.includes("alias:") ? `alias: left in ${JSON.stringify(string)}` : null;
    },
  },
];

// 0.9.0 alias use order and the aliasPrefix switch, in the byte-for-byte arms: off and gone agree, and
// "on" is the expected text (or agrees with gone when nothing is written).
const usageTitle = (alias, uses) => (uses > 0 ? `${alias} ×${uses}` : alias);
const ALIAS_USAGE_CASES = [
  {
    // Chips under the selected alias row, most used first; ties keep the alias block's order.
    name: "alias usage: chips most used first", query: "[[zq used", keys: ["alt+ArrowDown", "snap", "Escape", "Escape"],
    check: ({ snaps: [a], string }) => {
      const chips = a?.chips || [];
      if (JSON.stringify(chips.map((chip) => chip.text)) !== JSON.stringify(USED_ORDER)) return `chips ${JSON.stringify(chips.map((chip) => chip.text))} != ${JSON.stringify(USED_ORDER)}`;
      const titles = chips.map((chip) => chip.title);
      const want = USED_ORDER.map((alias) => usageTitle(alias, USED_USES[alias]));
      if (JSON.stringify(titles) !== JSON.stringify(want)) return `chip titles ${JSON.stringify(titles)} != ${JSON.stringify(want)}`;
      return string === `${SEED}[[zq used]]` ? null : `block text ${JSON.stringify(string)}`;
    },
  },
  {
    name: "alias usage off: chips in the alias block's order", query: "[[zq used", settings: { aliasUsage: false }, keys: ["alt+ArrowDown", "snap", "Escape", "Escape"],
    check: ({ snaps: [a], string }) => {
      const chips = a?.chips || [];
      if (JSON.stringify(chips.map((chip) => chip.text)) !== JSON.stringify(USED_ALIASES)) return `chips ${JSON.stringify(chips.map((chip) => chip.text))} != ${JSON.stringify(USED_ALIASES)}`;
      if (chips.some((chip) => chip.title !== chip.text)) return `chip titles ${JSON.stringify(chips.map((chip) => chip.title))}`;
      return string === `${SEED}[[zq used]]` ? null : `block text ${JSON.stringify(string)}`;
    },
  },
  {
    // ⌥↓ lands on the matched alias chip; ← three times (the line has three, ← stops at the first) reaches the most used.
    name: "alias usage: Enter on the first chip inserts the most used", query: "[[zq used", keys: ["alt+ArrowDown", "ArrowLeft", "ArrowLeft", "ArrowLeft", "Enter"],
    on: `${SEED}[${USED_ORDER[0]}]([[${USED_TITLE}]])`,
  },
  {
    // aliasPrefix off: no Burrow row for the text, so Roam alone answers Enter (same as gone).
    name: "alias: prefix off: Roam's list alone", query: "[[alias:zq us", settings: { aliasPrefix: false }, loose: true, keys: ["snap", "Enter"],
    check: ({ snaps: [a] }) => (a?.rows.length ? `Burrow rows ${JSON.stringify(a.rows)}` : null),
  },
  {
    name: "alias: prefix: Esc writes nothing", query: "[[alias:zq tw", keys: ["snap", "Escape"],
    check: ({ snaps: [a], string }) => {
      if (!a?.rows.length || a.rows.some((row) => !row.text.includes("↳"))) return `rows ${JSON.stringify(a?.rows)}`;
      return string === `${SEED}[[alias:zq tw]]` ? null : `block text ${JSON.stringify(string)}`;
    },
  },
];

// The pre-selected alias row's page has blocks, so Tab drills and the line says so.
const HINTS_ROW = "↵ pick alias · ⌥↓ more aliases · ⇥ blocks on this page · ⌥A add alias";
// The Chips page holds its alias block, so it can be drilled into too.
const HINTS_CHIPS = "←→ alias · ⌥⌫ delete · ↵ insert · ⇥ blocks on this page · esc rows";
// Two levels down (page, then a section): ⇧⇥ goes up a level.
const HINTS_SCOPE = ["↵ insert", "⇥/> children", "⇧⇥ up", "esc results", "⌃O preview"];

// (( block navigation and tasks (0.6.0), on the fixture's referenced blocks.
const BLOCK_CASES = [
  {
    name: "(( TODO and DONE show as Roam's read-only checkboxes, in the rows and the preview", query: "((zebra task", restorePreview: true,
    keys: ["snap", "preview-open", "wait:600", "snap", "Escape"],
    check: ({ snaps: [a, b] }) => {
      const checks = (a?.rows || []).flatMap((row) => row.checks);
      if (!checks.includes("todo:off:ro") || !checks.includes("done:on:ro")) return `row checkboxes ${JSON.stringify(a?.rows)}`;
      if ((a.rows || []).some((row) => row.text.includes("{{"))) return `macro text left in a row ${JSON.stringify(a.rows)}`;
      if (!b?.preview?.checks) return `no checkbox in the preview ${JSON.stringify(b?.preview)}`;
      return b.preview.label === '"Preview"' ? null : `preview label ${JSON.stringify(b.preview.label)}`;
    },
  },
  {
    // Review of 0.6.0: a macro that only starts like a task made the preview throw.
    name: "(( a child that only starts like a task (a SmartBlock button): preview draws, Tab drills", query: "((zebra smart", restorePreview: true,
    keys: ["preview-open", "wait:600", "snap", "Tab", "wait:300", "snap", "Escape", "Escape"],
    check: ({ snaps: [a, b] }) => {
      if (!a?.rows[0]?.active || !a.rows[0].checks.includes("todo:off:ro")) return `row ${JSON.stringify(a?.rows)}`;
      if (!a.rowPreview?.docked || !a.preview?.target?.includes("zebra smart parent") || !(a.preview.checks >= 1)) return `preview ${JSON.stringify(a?.preview)} ${JSON.stringify(a?.rowPreview)}`;
      // With rich rows the macro is a label, "TODO today": not a checkbox, not the raw {{…}} text.
      if (!b?.scope || !b.scope.rowsRich.some((row) => row.text.trim() === "TODO today" && !row.checks)) return `drill panel ${JSON.stringify(b?.scope?.rowsRich)} phase`;
      return null;
    },
  },
  // 0.7.0: ranking and rich rows, on the fixture's zebra blocks.
  {
    name: "(( code rows only for a code-looking query: ((zebra plot none, ((zebra_plot the R row and its line", query: "((zebra plot",
    keys: ["snap", "Backspace", "Backspace", "Backspace", "Backspace", "Backspace", "type:_plot", "wait:400", "snap", "Escape"],
    check: ({ snaps: [a, b] }) => {
      if ((a?.rows || []).some((row) => row.labels.includes("R"))) return `a code row for a prose query ${JSON.stringify(a.rows)}`;
      const row = (b?.rows || []).find((r) => JSON.stringify(r.labels) === '["R"]');
      if (!row || JSON.stringify(row.code) !== JSON.stringify(["zebra_plot <- function(d) ggplot(d, aes(x, y))"])) return `no R row with its line for ((zebra_plot ${JSON.stringify(b?.rows)}`;
      return row.text.includes("```") ? `fence left in the row ${JSON.stringify(row.text)}` : null;
    },
  },
  {
    name: "(( rich rows: marks, code, links, tags and block refs drawn like Roam", query: "((zebra rich",
    keys: ["snap", "Escape"],
    check: ({ snaps: [a] }) => {
      const row = a?.rows[0];
      if (!row) return `no row ${JSON.stringify(a?.rows)}`;
      const missing = ["burrow-b", "burrow-i", "burrow-hl", "burrow-s", "burrow-code", "burrow-ref", "burrow-tag", "burrow-bref"].filter((x) => !row.classes.includes(x));
      if (missing.length) return `row lacks ${missing.join(", ")}: ${JSON.stringify(row)}`;
      const raw = ["**", "__", "^^", "~~", "[[", "((", "`"].filter((x) => row.text.includes(x));
      if (raw.length) return `markup text left in the row (${raw.join(" ")}) ${JSON.stringify(row.text)}`;
      return row.text.includes("never grok for writing") ? null : `block ref not resolved ${JSON.stringify(row.text)}`;
    },
  },
  {
    name: "(( rich rows off: the 0.6.1 drawing, no refs or labels", query: "((zebra rich", settings: { richRows: false },
    keys: ["snap", "Escape"],
    check: ({ snaps: [a] }) => {
      const row = a?.rows[0];
      if (!row) return `no row ${JSON.stringify(a?.rows)}`;
      return row.classes.includes("burrow-ref") || row.classes.includes("burrow-label") ? `rich classes with richRows off ${JSON.stringify(row.classes)}` : null;
    },
  },
  {
    name: "(( rich rows: macros and files are labels", query: "((zebra macros",
    keys: ["snap", "Escape"],
    check: ({ snaps: [a] }) => {
      const row = a?.rows[0];
      if (!row) return `no row ${JSON.stringify(a?.rows)}`;
      const missing = ["embed", "query", "zebra go"].filter((x) => !row.labels.includes(x));
      if (missing.length) return `labels lack ${missing.join(", ")}: ${JSON.stringify(row.labels)}`;
      return row.text.includes("{{") ? `macro text left ${JSON.stringify(row.text)}` : null;
    },
  },
  {
    name: "(( rich rows: images and files are labels", query: "((zebra media",
    keys: ["snap", "Escape"],
    check: ({ snaps: [a] }) => {
      const row = a?.rows[0];
      if (!row) return `no row ${JSON.stringify(a?.rows)}`;
      const missing = ["image", "file"].filter((x) => !row.labels.includes(x));
      if (missing.length) return `labels lack ${missing.join(", ")}: ${JSON.stringify(row.labels)}`;
      const raw = ["{{", "![", "]("].filter((x) => row.text.includes(x));
      return raw.length ? `markup text left (${raw.join(" ")}) ${JSON.stringify(row.text)}` : null;
    },
  },
  {
    name: "(( a long row is cut around the match", query: "((zebra snippet",
    keys: ["snap", "Escape"],
    check: ({ snaps: [a] }) => {
      const row = a?.rows[0];
      if (!row) return `no row ${JSON.stringify(a?.rows)}`;
      return row.text.startsWith("…") && row.text.includes("zebra snippet") ? null : `row text ${JSON.stringify(row.text)}`;
    },
  },
  {
    name: "(( block text is never HTML", query: "((zebra html",
    keys: ["snap", "wait:300", "snap", "Escape"],
    check: ({ snaps: [a, b] }) => {
      const row = a?.rows[0];
      if (!row) return `no row ${JSON.stringify(a?.rows)}`;
      if (!row.text.includes("<img")) return `the tag is not shown as text ${JSON.stringify(row.text)}`;
      if (a.htmlEls.length || b?.htmlEls.length) return `HTML elements in the strip ${JSON.stringify([a.htmlEls, b?.htmlEls])}`;
      return a.xss === null && b?.xss === null ? null : `onerror ran: window.__burrowXss = ${JSON.stringify(b?.xss ?? a.xss)}`;
    },
  },
  {
    name: "(( rich preview lines", query: "((zebra rich", restorePreview: true,
    keys: ["preview-open", "wait:600", "snap", "Escape"],
    check: ({ snaps: [a] }) => {
      const classes = a?.preview?.targetClasses || [];
      const missing = ["burrow-b", "burrow-ref"].filter((x) => !classes.includes(x));
      return missing.length ? `preview target lacks ${missing.join(", ")}: ${JSON.stringify(a?.preview)}` : null;
    },
  },
  ...(config.accept || []).map(({ query, uid }) => ({
    // Real data, no fixture: the original block leads and no code block outranks it.
    name: `acceptance: ${query} → ((${uid})) first and pre-selected, no code rows`, query,
    keys: ["snap", "Escape"],
    check: ({ snaps: [a] }) => {
      if (a?.firstUid !== uid) return `first row ${JSON.stringify(a?.firstUid)} != ${uid} ${JSON.stringify(a?.rows)}`;
      if (a.activeUid !== uid || !a.rows[0]?.active) return `first row not pre-selected: active ${JSON.stringify(a.activeUid)} ${JSON.stringify(a.rows)}`;
      const code = a.rows.filter((row) => row.labels.length || row.code.length);
      return code.length ? `code rows ${JSON.stringify(code)}` : null;
    },
  })),
  {
    name: "(( where the block lives: page › parent and its children under the highlighted row", query: "((never grok",
    keys: ["snap", "Escape"],
    check: ({ snaps: [a] }) => {
      if (!a?.rows[0]?.active) return `first row not selected ${JSON.stringify(a?.rows)}`;
      return a.context === `in ${FIXTURE_PAGE} › Alpha section⇥ 1 child` ? null : `context line ${JSON.stringify(a.context)}`;
    },
  },
  {
    name: "(( where the block lives: off, no line", query: "((never grok", settings: { refContext: false },
    keys: ["snap", "Escape"],
    check: ({ snaps: [a] }) => (a?.rows.length && a.context === null ? null : `rows ${a?.rows.length} context ${JSON.stringify(a?.context)}`),
  },
  {
    name: "(( ⇧⇥ goes up to the parent, ⇧⇥ again higher, Enter picks the highlighted parent", query: "((never grok",
    keys: ["snap", "shift+Tab", "snap", "shift+Tab", "snap", "Enter"],
    check: ({ snaps: [a, b, d], string }) => {
      if (a?.hints !== "↵ insert ref · ⇥ children of this block · ⇧⇥ parent") return `hints ${JSON.stringify(a?.hints)}`;
      if (!b?.scope?.crumb.includes("Alpha section") || !b.scope.what.includes("children of this block: Alpha section") || !b.scope.active?.includes("never grok for writing")) return `after ⇧⇥ ${JSON.stringify(b?.scope)}`;
      if (!d?.scope?.what.includes("blocks on this page") || !d.scope.active?.includes("Alpha section")) return `after ⇧⇥ ⇧⇥ ${JSON.stringify(d?.scope)}`;
      return string === `${SEED}((${fx.drill.alpha}))` ? null : `inserted ${JSON.stringify(string)}`;
    },
  },
  {
    name: "(( Tab on a block lists its children under its whole trail", query: "((never grok",
    keys: ["Tab", "snap", "Enter"],
    check: ({ snaps: [a], string }) => {
      if (!a?.scope?.crumb.includes(FIXTURE_PAGE) || !a.scope.crumb.includes("Alpha section") || a.scope.what !== "Drillchildren of this block: never grok for writing") return `scope ${JSON.stringify(a?.scope)}`;
      return string === `${SEED}((${fx.drill.grand}))` ? null : `inserted ${JSON.stringify(string)}`;
    },
  },
  {
    name: "(( Up and down the outline off: ⇧⇥ is not Burrow's, Tab lists the block alone", query: "((never grok", settings: { refOutline: false },
    keys: ["snap", "Tab", "snap", "Escape", "Escape"],
    check: ({ snaps: [a, b] }) => {
      if (a?.hints !== "↵ insert ref · ⇥ children of this block") return `hints ${JSON.stringify(a?.hints)}`;
      return b?.scope && !b.scope.crumb.includes(FIXTURE_PAGE) && b.scope.crumb.includes("never grok") ? null : `scope ${JSON.stringify(b?.scope)}`;
    },
  },
  {
    name: "the pointer selects a Burrow row; Enter inserts the one it shows", query: "((zebra task",
    keys: ["snap", "hover:.burrow-strip .burrow-row[data-index=\"1\"]", "wait:150", "snap", "Enter"],
    check: ({ snaps: [a, b], string }) => {
      if (a?.rows.length !== 2 || !a.rows[0].active) return `before ${JSON.stringify(a?.rows)}`;
      if (!b?.rows[1]?.active || b.rows[0].active || !b.activeUid) return `after the hover ${JSON.stringify(b?.rows)}`;
      return string === `${SEED}((${b.activeUid}))` ? null : `inserted ${JSON.stringify(string)} for ${b.activeUid}`;
    },
  },
  {
    name: "Ctrl-O does not scroll Roam's list under Burrow's rows", query: config.ref.query, restorePreview: true,
    keys: ["snap", "ctrl+o", "wait:500", "snap", "ctrl+o", "wait:500", "snap", "Escape"],
    check: ({ snaps }) => (snaps.every((snap) => snap?.listScroll === 0 && snap.rows[0]?.active) ? null : `list scroll ${JSON.stringify(snaps.map((snap) => snap?.listScroll))}`),
  },
  {
    name: "key list: F1 opens and closes it, on any keyboard layout", query: config.preselect.query, mayCreatePage: true,
    keys: ["F1", "snap", "F1", "snap", "Escape"],
    check: ({ snaps: [a, b] }) => (a?.sheet && b && !b.sheet && b.popup ? null : `F1: sheet ${JSON.stringify(a?.sheet?.groups)}, after ${JSON.stringify(b?.sheet)}`),
  },
  {
    name: "key list: with Delete aliases on and Alias chips off it says ⌥⌫ needs the chips", query: config.preselect.query, mayCreatePage: true,
    settings: { aliasDelete: true, aliasChips: false },
    keys: ["alt+slash", "snap", "Escape", "Escape"],
    check: ({ snaps: [a] }) => (a?.sheet?.notes.join(" ").includes("⌥⌫ deletes the selected alias chip: turn on Alias chips") && !a.sheet.keys.includes("⌥⌫") ? null : `notes ${JSON.stringify(a?.sheet?.notes)} keys ${JSON.stringify(a?.sheet?.keys)}`),
  },
  // BRW-9: the key list covers the picker, so Enter or Tab under it may only
  // close it. Before, the key went on to the row under the list: Roam's
  // highlighted (( row (a footnote, a block ref), Burrow's row, a drill row.
  {
    name: "key list over Roam's highlighted (( row: Enter only closes it, no Roam row runs", query: config.ref.query, created: true,
    keys: ["down-past-strip", "wait:200", "snap", "alt+slash", "snap", "Enter", "wait:300", "snap", "Escape"], on: open,
    check: ({ snaps: [a, b, d] }) => {
      if (a?.phase !== "ARMED" || !a.nativeActiveVisible) return `before ⌥/: phase ${a?.phase}, Roam's highlight ${a?.nativeActiveVisible}`;
      if (!b?.sheet || !b.popoverCovered) return `no key list over the popover ${JSON.stringify(b?.sheet)} covered ${b?.popoverCovered}`;
      if (d?.sheet || !d?.popup || d.value !== open || d.phase !== "ARMED") return `after Enter: sheet ${JSON.stringify(d?.sheet?.groups)} popup ${d?.popup} value ${JSON.stringify(d?.value)} phase ${d?.phase}`;
      return null;
    },
  },
  {
    name: "key list over Roam's highlighted (( row: Tab only closes it (F1)", query: config.ref.query, created: true,
    keys: ["down-past-strip", "wait:200", "F1", "snap", "Tab", "wait:300", "snap", "Escape"], on: open,
    check: ({ snaps: [a, b] }) => (a?.sheet && b && !b.sheet && b.popup && !b.scope && b.value === open ? null : `F1 ${JSON.stringify(a?.sheet?.groups)}; after Tab sheet ${JSON.stringify(b?.sheet)} popup ${b?.popup} scope ${JSON.stringify(b?.scope)} value ${JSON.stringify(b?.value)}`),
  },
  {
    name: "key list: Shift+Enter, ⌘Enter, Shift+Tab only close it too", query: config.ref.query, created: true,
    keys: ["down-past-strip", "wait:200", "alt+slash", "shift+Enter", "wait:200", "snap", "alt+slash", "meta+Enter", "wait:200", "snap", "alt+slash", "shift+Tab", "wait:200", "snap", "Escape"], on: open,
    check: ({ snaps }) => (snaps.every((s) => s && !s.sheet && s.popup && s.value === open) ? null : `after each key ${JSON.stringify(snaps.map((s) => [s?.value, Boolean(s?.sheet), s?.popup]))}`),
  },
  {
    name: "key list over Roam's highlighted [[ row: Enter only closes it, the popup stays", query: `[[${FIXTURE_PAGE}`, noRows: true, created: true,
    keys: ["alt+slash", "snap", "Enter", "wait:300", "snap", "Escape"],
    check: ({ snaps: [a, b] }) => (a?.sheet && b && !b.sheet && b.popup && b.value === `${SEED}[[${FIXTURE_PAGE}]]` ? null : `after Enter: sheet ${JSON.stringify(b?.sheet)} popup ${b?.popup} value ${JSON.stringify(b?.value)}`),
  },
  {
    name: "key list over Burrow's highlighted row: Enter only closes it, the row stays highlighted", query: config.ref.query, created: true,
    keys: ["snap", "alt+slash", "snap", "Enter", "wait:300", "snap", "Escape"], on: open,
    check: ({ snaps: [a, b, d] }) => {
      if (!a?.rows[0]?.active) return `first row not selected ${JSON.stringify(a?.rows)}`;
      if (!b?.sheet) return "no key list";
      return d && !d.sheet && d.rows[0]?.active && d.value === open ? null : `after Enter: sheet ${JSON.stringify(d?.sheet)} rows ${JSON.stringify(d?.rows)} value ${JSON.stringify(d?.value)}`;
    },
  },
  {
    name: "key list over the drill panel: Enter only closes it, the panel stays", query: `[[${FIXTURE_PAGE}`, noRows: true, created: true,
    keys: ["Tab", "wait:300", "snap", "alt+slash", "snap", "Enter", "wait:300", "snap", "Escape", "Escape"],
    check: ({ snaps: [a, b, d], string }) => {
      if (!a?.scope?.active) return `no drill panel ${JSON.stringify(a?.scope)}`;
      if (!b?.sheet) return "no key list over the panel";
      if (d?.sheet || d?.scope?.active !== a.scope.active || d.value !== `${SEED}[[${FIXTURE_PAGE}]]`) return `after Enter: sheet ${JSON.stringify(d?.sheet)} scope ${JSON.stringify(d?.scope)} value ${JSON.stringify(d?.value)}`;
      return string === `${SEED}[[${FIXTURE_PAGE}]]` ? null : `inserted ${JSON.stringify(string)}`;
    },
  },
];

// A cut chip is not an overlap: boxes must not overlap, a cut chip carries its
// full alias as a title, and the active chip is whole whenever it can be.
function chipsProblem(snap) {
  const chips = snap?.chips || [];
  const overlap = chips.findIndex((chip, i) => i && chip.l < chips[i - 1].r - 0.5);
  if (overlap >= 0) return `chips overlap ${JSON.stringify(chips)}`;
  const untitled = chips.find((chip) => chip.ellipsized && chip.title !== chip.text);
  if (untitled) return `cut chip without its title ${JSON.stringify(untitled)}`;
  const active = chips.find((chip) => chip.active);
  if (active?.ellipsized && active.scrollWidth <= active.lineWidth - 16) return `active chip cut though it fits ${JSON.stringify(active)}`;
  return null;
}

// Write cases, on arm only: each restores what it wrote. `read` runs before the restore.
const CHIPS_Q = `[[${CHIP_ALIASES[0].slice(0, 10)}`;
const WRITE_SETTINGS = { aliasCreate: true, aliasDelete: true, aliasUsage: false };
const within = (edited, ...allowed) => edited.every((u) => allowed.includes(u));
const WRITE_CASES = [
  {
    name: "alias create: ⌥A on a page without aliases", query: `[[${FIXTURE_PAGE} Empty`, settings: WRITE_SETTINGS,
    keys: ["alt+a", "snap", "type:zq new alias", "snap", "Enter"], on: `${SEED}[zq new alias]([[${FIXTURE_PAGE} Empty]])`,
    read: async () => ({ children: await childStrings(c, fx.emptyUid), kids: await childUids(fx.emptyUid) }),
    restore: async () => { for (const uid of await childUids(fx.emptyUid)) await deleteBlock(c, uid); },
    check: (r) => {
      const [a, b] = r.snaps;
      if (a?.prompt?.input !== `${FIXTURE_PAGE} Empty` || !a.prompt.fresh) return `prompt ${JSON.stringify(a?.prompt)}`;
      if (b?.prompt?.input !== "zq new alias") return `typed prompt ${JSON.stringify(b?.prompt)}`;
      if (JSON.stringify(r.read.children) !== JSON.stringify(["Aliases:: zq new alias"])) return `Empty page children ${JSON.stringify(r.read.children)}`;
      return within(r.edited, fx.blockUid, ...r.read.kids) ? null : `edited blocks ${JSON.stringify(r.edited)}`;
    },
  },
  {
    name: "alias create: ⌥A appends to the alias block", query: CHIPS_Q, settings: WRITE_SETTINGS,
    keys: ["alt+a", "type:zq chip kilo", "Enter"], on: `${SEED}[zq chip kilo]([[${FIXTURE_PAGE} Chips]])`,
    read: async () => ({ alias: await aliasBlockString(c, fx.chipsUid) }),
    restore: () => setAliasBlock(c, fx.chipsAliasUid, CHIPS_ALIAS_STRING),
    check: (r) => {
      if (r.read.alias !== `${CHIPS_ALIAS_STRING}, zq chip kilo`) return `alias block ${JSON.stringify(r.read.alias)}`;
      return within(r.edited, fx.blockUid, fx.chipsAliasUid) ? null : `edited blocks ${JSON.stringify(r.edited)}`;
    },
  },
  {
    name: "alias create: Esc writes nothing", query: `[[${FIXTURE_PAGE} Empty`, settings: WRITE_SETTINGS,
    keys: ["alt+a", "type:zz", "Escape", "snap", "Escape"], on: `${SEED}[[${FIXTURE_PAGE} Empty]]`,
    read: async () => ({ children: await childStrings(c, fx.emptyUid) }),
    restore: async () => { for (const uid of await childUids(fx.emptyUid)) await deleteBlock(c, uid); },
    check: (r) => {
      const [a] = r.snaps;
      if (a?.prompt !== null || !a.popup) return `after Esc prompt ${JSON.stringify(a?.prompt)} popup ${a?.popup}`;
      if (r.read.children.length) return `Empty page children ${JSON.stringify(r.read.children)}`;
      return within(r.edited, fx.blockUid) ? null : `edited blocks ${JSON.stringify(r.edited)}`;
    },
  },
  {
    name: "alias create: an IME composition goes into the field", query: `[[${FIXTURE_PAGE} Empty`, settings: WRITE_SETTINGS,
    keys: ["alt+a", "type:zq", "ime", "wait:200", "snap", "Enter"], on: `${SEED}[zq你]([[${FIXTURE_PAGE} Empty]])`,
    read: async () => ({ children: await childStrings(c, fx.emptyUid), kids: await childUids(fx.emptyUid) }),
    restore: async () => { for (const uid of await childUids(fx.emptyUid)) await deleteBlock(c, uid); },
    check: (r) => {
      const [a] = r.snaps;
      if (a?.prompt?.input !== "zq你") return `field ${JSON.stringify(a?.prompt)}`;
      if (a.value !== `${SEED}[[${FIXTURE_PAGE} Empty]]`) return `block while open ${JSON.stringify(a.value)}`;
      if (JSON.stringify(r.read.children) !== JSON.stringify(["Aliases:: zq你"])) return `Empty page children ${JSON.stringify(r.read.children)}`;
      return within(r.edited, fx.blockUid, ...r.read.kids) ? null : `edited blocks ${JSON.stringify(r.edited)}`;
    },
  },
  {
    name: "alias create: an IME composition replaces the seeded text, Esc writes nothing", query: `[[${FIXTURE_PAGE} Empty`, settings: WRITE_SETTINGS,
    keys: ["alt+a", "ime", "wait:200", "snap", "Escape", "snap", "Escape"], on: `${SEED}[[${FIXTURE_PAGE} Empty]]`,
    read: async () => ({ children: await childStrings(c, fx.emptyUid) }),
    restore: async () => { for (const uid of await childUids(fx.emptyUid)) await deleteBlock(c, uid); },
    check: (r) => {
      const [a, b] = r.snaps;
      if (a?.prompt?.input !== "你") return `field ${JSON.stringify(a?.prompt)}`;
      if (a.value !== `${SEED}[[${FIXTURE_PAGE} Empty]]`) return `block while open ${JSON.stringify(a.value)}`;
      if (b?.prompt !== null || !b.popup) return `after Esc prompt ${JSON.stringify(b?.prompt)} popup ${b?.popup}`;
      if (r.read.children.length) return `Empty page children ${JSON.stringify(r.read.children)}`;
      return within(r.edited, fx.blockUid) ? null : `edited blocks ${JSON.stringify(r.edited)}`;
    },
  },
  {
    name: "alias create: text inserted without a key (emoji keyboard) goes into the field", query: `[[${FIXTURE_PAGE} Empty`, settings: WRITE_SETTINGS,
    keys: ["alt+a", "type:zq", "insert:🙂", "wait:200", "snap", "Enter"], on: `${SEED}[zq🙂]([[${FIXTURE_PAGE} Empty]])`,
    read: async () => ({ children: await childStrings(c, fx.emptyUid), kids: await childUids(fx.emptyUid) }),
    restore: async () => { for (const uid of await childUids(fx.emptyUid)) await deleteBlock(c, uid); },
    check: (r) => {
      const [a] = r.snaps;
      if (a?.prompt?.input !== "zq🙂") return `field ${JSON.stringify(a?.prompt)}`;
      if (a.value !== `${SEED}[[${FIXTURE_PAGE} Empty]]`) return `block while open ${JSON.stringify(a.value)}`;
      if (JSON.stringify(r.read.children) !== JSON.stringify(["Aliases:: zq🙂"])) return `Empty page children ${JSON.stringify(r.read.children)}`;
      return within(r.edited, fx.blockUid, ...r.read.kids) ? null : `edited blocks ${JSON.stringify(r.edited)}`;
    },
  },
  {
    name: "alias create: inserted text replaces the seeded text, Esc writes nothing", query: `[[${FIXTURE_PAGE} Empty`, settings: WRITE_SETTINGS,
    keys: ["alt+a", "insert:🙂", "wait:200", "snap", "Escape", "snap", "Escape"], on: `${SEED}[[${FIXTURE_PAGE} Empty]]`,
    read: async () => ({ children: await childStrings(c, fx.emptyUid) }),
    restore: async () => { for (const uid of await childUids(fx.emptyUid)) await deleteBlock(c, uid); },
    check: (r) => {
      const [a, b] = r.snaps;
      if (a?.prompt?.input !== "🙂") return `field ${JSON.stringify(a?.prompt)}`;
      if (a.value !== `${SEED}[[${FIXTURE_PAGE} Empty]]`) return `block while open ${JSON.stringify(a.value)}`;
      if (b?.prompt !== null || !b.popup) return `after Esc prompt ${JSON.stringify(b?.prompt)} popup ${b?.popup}`;
      if (r.read.children.length) return `Empty page children ${JSON.stringify(r.read.children)}`;
      return within(r.edited, fx.blockUid) ? null : `edited blocks ${JSON.stringify(r.edited)}`;
    },
  },
  {
    name: "alias create: text put in by execCommand goes into the field", query: `[[${FIXTURE_PAGE} Empty`, settings: WRITE_SETTINGS,
    keys: ["alt+a", "type:zq", "exec:x9", "wait:200", "snap", "Enter"], on: `${SEED}[zqx9]([[${FIXTURE_PAGE} Empty]])`,
    read: async () => ({ children: await childStrings(c, fx.emptyUid), kids: await childUids(fx.emptyUid) }),
    restore: async () => { for (const uid of await childUids(fx.emptyUid)) await deleteBlock(c, uid); },
    check: (r) => {
      const [a] = r.snaps;
      if (a?.prompt?.input !== "zqx9") return `field ${JSON.stringify(a?.prompt)}`;
      if (a.value !== `${SEED}[[${FIXTURE_PAGE} Empty]]`) return `block while open ${JSON.stringify(a.value)}`;
      if (JSON.stringify(r.read.children) !== JSON.stringify(["Aliases:: zqx9"])) return `Empty page children ${JSON.stringify(r.read.children)}`;
      return within(r.edited, fx.blockUid, ...r.read.kids) ? null : `edited blocks ${JSON.stringify(r.edited)}`;
    },
  },
  {
    name: "alias create: dropped text goes into the field", query: `[[${FIXTURE_PAGE} Empty`, settings: WRITE_SETTINGS,
    keys: ["alt+a", "type:zq", "drop:dz", "wait:200", "snap", "Enter"], on: `${SEED}[zqdz]([[${FIXTURE_PAGE} Empty]])`,
    read: async () => ({ children: await childStrings(c, fx.emptyUid), kids: await childUids(fx.emptyUid) }),
    restore: async () => { for (const uid of await childUids(fx.emptyUid)) await deleteBlock(c, uid); },
    check: (r) => {
      const [a] = r.snaps;
      if (a?.prompt?.input !== "zqdz") return `field ${JSON.stringify(a?.prompt)}`;
      if (a.value !== `${SEED}[[${FIXTURE_PAGE} Empty]]`) return `block while open ${JSON.stringify(a.value)}`;
      if (JSON.stringify(r.read.children) !== JSON.stringify(["Aliases:: zqdz"])) return `Empty page children ${JSON.stringify(r.read.children)}`;
      return within(r.edited, fx.blockUid, ...r.read.kids) ? null : `edited blocks ${JSON.stringify(r.edited)}`;
    },
  },
  {
    name: "alias create: ref syntax in the alias is refused, nothing written", query: `[[${FIXTURE_PAGE} Empty`, settings: WRITE_SETTINGS,
    keys: ["alt+a", "type:issue #42", "Enter", "snap", ...Array(9).fill("Backspace"), "type:a::b", "Enter", "snap", "Escape", "snap", "Escape"],
    on: `${SEED}[[${FIXTURE_PAGE} Empty]]`,
    read: async () => ({ children: await childStrings(c, fx.emptyUid) }),
    restore: async () => { for (const uid of await childUids(fx.emptyUid)) await deleteBlock(c, uid); },
    check: (r) => {
      const [a, b, d] = r.snaps;
      if (a?.prompt?.error !== "no #: Roam would make a tag" || a.prompt.input !== "issue #42") return `after issue #42 ${JSON.stringify(a?.prompt)}`;
      if (b?.prompt?.error !== "no double colon: Roam would make an attribute" || b.prompt.input !== "a::b") return `after a::b ${JSON.stringify(b?.prompt)}`;
      if (a.value !== `${SEED}[[${FIXTURE_PAGE} Empty]]`) return `block while open ${JSON.stringify(a.value)}`;
      if (d?.prompt !== null || !d.popup) return `after Esc prompt ${JSON.stringify(d?.prompt)} popup ${d?.popup}`;
      if (r.read.children.length) return `Empty page children ${JSON.stringify(r.read.children)}`;
      return within(r.edited, fx.blockUid) ? null : `edited blocks ${JSON.stringify(r.edited)}`;
    },
  },
  {
    // Like a hand edit or roam-aliases: the gate writes the alias block itself.
    name: "alias index: an alias edited outside Burrow is picked up at once", query: "[[zq outside ki", mayCreatePage: true,
    before: () => c.evaluate(async ({ uid, string }) => {
      const t0 = performance.now();
      await window.roamAlphaAPI.data.block.update({ block: { uid, string } });
      while (performance.now() - t0 < 3000) {
        if (window.__BURROW?.indexes?.aliases?.entries.some((e) => e.alias === "zq outside kilo")) return Math.round(performance.now() - t0);
        await new Promise((r) => setTimeout(r, 20));
      }
      return null;
    }, { uid: fx.chipsAliasUid, string: `${CHIPS_ALIAS_STRING}, zq outside kilo` }),
    keys: ["snap", "Escape", `outside-alias:${CHIPS_ALIAS_STRING}`, "wait:700", "snap"],
    restore: () => setAliasBlock(c, fx.chipsAliasUid, CHIPS_ALIAS_STRING),
    check: (r) => {
      const [a, b] = r.snaps;
      if (r.beforeResult == null || r.beforeResult > 1000) return `the index took ${r.beforeResult} ms`;
      if (!a?.rows.some((row) => row.text.includes(`zq outside kilo ↳ ${FIXTURE_PAGE} Chips`))) return `no row for the new alias ${JSON.stringify(a?.rows)}`;
      return b?.aliasEntries && !b.aliasEntries.includes("zq outside kilo") ? null : "the alias stayed after it was removed outside Burrow";
    },
  },
  {
    name: "alias delete: Alt+Backspace, Enter removes only that alias", query: CHIPS_Q, settings: WRITE_SETTINGS, mayCreatePage: true,
    keys: ["alt+ArrowDown", "ArrowRight", "alt+Backspace", "snap", "Enter", "wait:300", "snap", "Escape", "Escape"], on: `${SEED}[[${CHIP_ALIASES[0].slice(0, 10)}]]`,
    read: async () => ({ alias: await aliasBlockString(c, fx.chipsUid) }),
    restore: () => setAliasBlock(c, fx.chipsAliasUid, CHIPS_ALIAS_STRING),
    check: (r) => {
      const [a, b] = r.snaps;
      if (!a?.confirm?.includes(CHIP_ALIASES[1])) return `confirm ${JSON.stringify(a?.confirm)}`;
      if (!b || b.chips.some((chip) => chip.text === CHIP_ALIASES[1])) return `chips after delete ${JSON.stringify(b?.chips.map((chip) => chip.text))}`;
      const want = CHIPS_ALIAS_STRING.replace(`, ${CHIP_ALIASES[1]}`, "");
      if (r.read.alias !== want) return `alias block ${JSON.stringify(r.read.alias)} != ${JSON.stringify(want)}`;
      return within(r.edited, fx.blockUid, fx.chipsAliasUid) ? null : `edited blocks ${JSON.stringify(r.edited)}`;
    },
  },
  {
    name: "alias delete: Esc keeps the alias", query: CHIPS_Q, settings: WRITE_SETTINGS, mayCreatePage: true,
    keys: ["alt+ArrowDown", "ArrowRight", "alt+Backspace", "Escape", "snap", "Escape", "Escape"],
    read: async () => ({ alias: await aliasBlockString(c, fx.chipsUid) }),
    restore: () => setAliasBlock(c, fx.chipsAliasUid, CHIPS_ALIAS_STRING),
    check: (r) => {
      const [a] = r.snaps;
      if (a?.confirm !== null || !a.chips.some((chip) => chip.text === CHIP_ALIASES[1])) return `after Esc confirm ${JSON.stringify(a?.confirm)} chips ${JSON.stringify(a?.chips.map((chip) => chip.text))}`;
      return r.read.alias === CHIPS_ALIAS_STRING ? null : `alias block ${JSON.stringify(r.read.alias)}`;
    },
  },
];

// Block reference search, on arm only: no query is typed; the command (or the
// hotkey) puts (()) at the caret and the typed words go between the parens.
const REFSEARCH_CASES = [
  {
    name: "ref search: palette opens (( at the caret", query: "", keys: [`palette:${REF_COMMAND}`, "wait:500", "snap", `type:${config.ref.query.slice(2)}`, "Enter"], on: committed,
    check: ({ snaps: [a] }) => (a?.value === `${SEED}(())` && a.popup ? null : `after the command ${JSON.stringify(a?.value)} popup ${a?.popup}`),
  },
  {
    name: "ref search: Alt+Shift+9 opens (( at the caret", query: "", settings: { refSearchHotkey: true }, keys: ["alt+shift+9", "wait:300", "snap", `type:${config.ref.query.slice(2)}`, "Enter"], on: committed,
    check: ({ snaps: [a] }) => (a?.value === `${SEED}(())` && a.popup ? null : `after the hotkey ${JSON.stringify(a?.value)} popup ${a?.popup}`),
  },
];

// Keys that are Roam's own with the Burrow switch off: on, off and gone must agree.
const PASS_CASES = [
  { name: "⌥A with alias writes off is Roam's", query: `[[${FIXTURE_PAGE} Empty`, settings: { aliasCreate: false }, keys: ["alt+a", "Escape"], line: true },
  { name: "Alt+Shift+9 with the hotkey off is Roam's", query: "", settings: { refSearchHotkey: false }, keys: ["alt+shift+9", "Escape"], line: true },
  { name: "⌥/ with the key list off is Roam's", query: `[[${FIXTURE_PAGE} Empty`, settings: { helpSheet: false }, keys: ["alt+slash", "Escape"], line: true },
];

// Tab drill, on and gone arms. `on` is the expected string with Burrow; a
// case without it must equal Roam alone. `expect(snaps, typedOpen)` returns a
// failure string or null. `loose` cases wait for Roam's popup only.
const EMPTY_Q = `[[${FIXTURE_PAGE} Empty`;
const TYPED_PAGE = `${SEED}[[${DRILL_PAGE}]]`;
const TAB_CASES = [
  {
    name: "tab drill: Tab on Roam's page row, type, Tab, Enter", query: `[[${DRILL_PAGE}`, loose: true,
    keys: ["Tab", "snap", "type:beta", "snap", "Tab", "snap", "Enter"], on: (d) => `${SEED}((${d.betaChild}))`,
    expect: ([s0, s1, s2]) => {
      if (!s0?.scope?.crumb.includes(DRILL_PAGE) || !s0.popoverHidden) return `after Tab ${JSON.stringify(s0?.scope)} hidden ${s0?.popoverHidden}`;
      if (s1?.value !== TYPED_PAGE || !s1.scope?.active?.includes("Beta section")) return `after typing value ${JSON.stringify(s1?.value)} scope ${JSON.stringify(s1?.scope)}`;
      if (!s2?.scope?.crumb.includes("Beta section") || !s2.scope.rows.some((row) => row.includes("beta child"))) return `after second Tab ${JSON.stringify(s2?.scope)}`;
      return null;
    },
  },
  {
    name: "tab drill: Shift+Tab goes back", query: `[[${DRILL_PAGE}`, loose: true,
    keys: ["Tab", "type:alpha", "Tab", "shift+Tab", "snap", "Enter"], on: (d) => `${SEED}((${d.alpha}))`,
    expect: ([s]) => (s?.scope?.filter === "alpha" && s.scope.active?.includes("Alpha section") ? null : `after Shift+Tab ${JSON.stringify(s?.scope)}`),
  },
  {
    name: "tab drill: Esc returns to Roam's results", query: `[[${DRILL_PAGE}`, loose: true,
    keys: ["Tab", "Escape", "snap", "Escape"], on: () => TYPED_PAGE,
    expect: ([s]) => (!s?.scope && s.popup && !s.popoverHidden ? null : `after Esc scope ${JSON.stringify(s?.scope)} popup ${s?.popup} hidden ${s?.popoverHidden}`),
  },
  {
    name: "tab drill: Backspace on an empty filter goes back", query: `[[${DRILL_PAGE}`, loose: true,
    keys: ["Tab", "Backspace", "snap", "Escape"], on: () => TYPED_PAGE,
    expect: ([s]) => (!s?.scope && s.value === TYPED_PAGE ? null : `after Backspace scope ${JSON.stringify(s?.scope)} value ${JSON.stringify(s?.value)}`),
  },
  { name: "tab: nothing to drill, Tab is Roam's", query: EMPTY_Q, loose: true, keys: ["Tab"] },
  {
    name: "typed drill + Tab drills into the resolved block", query: DRILL_Q, keys: ["Tab", "snap", "Enter"], on: (d) => `${SEED}((${d.grand}))`,
    expect: ([s]) => (s?.scope?.crumb.includes("never grok for writing") ? null : `crumb ${JSON.stringify(s?.scope)}`),
  },
  { name: "typed drill + Tab on a leaf inserts it", query: `[[${DRILL_PAGE}#alpha > first`, keys: ["Tab"], on: (d) => `${SEED}((${d.first}))` },
  {
    name: "Tab drills into a referenced original with children", query: config.ref.query, refCase: true,
    keys: ["Tab", "snap", "Enter"], on: (d, x) => `${SEED}((${x.refChild}))`,
    expect: ([s]) => (s?.scope ? null : "no scope panel"),
  },
  {
    name: "tab drill: click a child inserts it", query: `[[${DRILL_PAGE}`, loose: true,
    keys: ["Tab", "type:alpha", "Tab", "snap", "click:scope:third item"], on: (d) => `${SEED}((${d.third}))`,
    expect: ([s]) => {
      // The Alpha section level: its first child is a leaf unless the row carries ▸.
      const drillable = (s?.scope?.active ?? "").includes("▸");
      const want = HINTS_SCOPE.filter((part) => drillable || !part.startsWith("⇥/>")).join(" · ");
      return s?.scopeHints === want ? null : `scope hints ${JSON.stringify(s?.scopeHints)} != ${JSON.stringify(want)} (active ${JSON.stringify(s?.scope?.active)})`;
    },
  },
  {
    name: "tab drill: click a crumb goes back", query: `[[${DRILL_PAGE}`, loose: true,
    keys: ["Tab", "type:alpha", "Tab", "click:crumb:0", "snap", "Escape", "Escape"], on: () => TYPED_PAGE,
    expect: ([s]) => (s?.scope && s.scope.crumb.includes(DRILL_PAGE) && !s.scope.crumb.includes("Alpha section") && s.scope.filter === "alpha"
      ? null : `after the crumb click ${JSON.stringify(s?.scope)}`),
  },
  {
    name: "tab drill: click away while drilled in", query: `[[${DRILL_PAGE}`, loose: true,
    keys: ["Tab", "snap", "click-away", "wait:300", "snap"], on: () => TYPED_PAGE,
    expect: ([s0, s1]) => {
      if (!s0?.scope) return `no scope panel before the click ${JSON.stringify(s0?.scope)}`;
      const left = s1?.visibleBurrow?.filter((n) => /burrow-(strip|hints|preview|scope|chips|row)/.test(n)) ?? [];
      // Roam decides whether the click ends editing (svy's top bar does, notes' does not and keeps its own popup
      // open); Burrow's part is that its drill closes, leaves nothing drawn and never leaves Roam's popover hidden.
      if (s1?.scope !== null || s1.rows.length || s1.hints !== null || s1.preview !== null || (s1.popup && s1.popoverHidden) || left.length) {
        return `after the click scope ${JSON.stringify(s1?.scope)} rows ${s1?.rows.length} hints ${JSON.stringify(s1?.hints)} popup ${s1?.popup} hidden ${s1?.popoverHidden} visible ${JSON.stringify(s1?.visibleBurrow)}`;
      }
      return s1.visibleBurrow.length ? `Burrow nodes still visible ${JSON.stringify(s1.visibleBurrow)}` : null;
    },
  },
  {
    name: "tab drill: ordinals rank 2. (b) iii first", query: `[[${DRILL_PAGE}`, loose: true,
    keys: ["Tab", "type:steps", "Tab", "type:2", "snap", "Backspace", "type:(b)", "snap", "Backspace", "Backspace", "Backspace", "type:iii", "snap", "Enter"],
    on: (d) => `${SEED}((${d.roman}))`,
    expect: ([a, b, c3]) => {
      const got = [a, b, c3].map((snap) => snap?.scope?.active ?? null);
      const want = ["2. bake", "(b) cool", "iii. serve"];
      return want.every((text, i) => got[i]?.includes(text)) ? null : `active rows ${JSON.stringify(got)}`;
    },
  },
  {
    name: "tab drill: ordinals off keeps outline order", query: `[[${DRILL_PAGE}`, loose: true, settings: { drillOrdinals: false },
    keys: ["Tab", "type:steps", "Tab", "type:(b)", "snap", "Escape", "Escape"], on: () => TYPED_PAGE,
    expect: ([s]) => (s?.scope?.active?.includes("B-side") ? null : `active row ${JSON.stringify(s?.scope?.active)}`),
  },
  {
    name: "tab drill: (empty) ▸ shown, empty leaf hidden", query: `[[${DRILL_PAGE}`, loose: true,
    keys: ["Tab", "type:hollow", "Tab", "snap", "ArrowUp", "Tab", "snap", "Enter"], on: (d) => `${SEED}((${d.insideHollow}))`,
    expect: ([a, b]) => {
      if (JSON.stringify(a?.scope?.rows) !== JSON.stringify(["(empty) ▸", "after hollow"]) || a.scope.active !== "after hollow") return `rows ${JSON.stringify(a?.scope?.rows)} active ${JSON.stringify(a?.scope?.active)}`;
      if (!b?.scope?.crumb.includes("(empty)") || JSON.stringify(b.scope.rows) !== JSON.stringify(["inside hollow"])) return `inside ${JSON.stringify(b?.scope)}`;
      return null;
    },
  },
  {
    name: "tab drill: +N more lists the next slice", query: `[[${DRILL_PAGE}`, loose: true,
    keys: ["Tab", "type:many", "Tab", "snap", "down:50", "snap", "Enter", "snap", "Enter"], on: (d) => `${SEED}((${d.many51}))`,
    expect: ([a, b, c3]) => {
      const rows = a?.scope?.rowsFull ?? [];
      if (rows.length !== 51 || !rows.at(-1).text.includes("+5 more") || !rows.at(-1).cls.includes("burrow-more-row")) return `first slice ${rows.length} rows, last ${JSON.stringify(rows.at(-1))}`;
      if (!b?.scope?.active?.includes("+5 more") || !b.scopeHints?.includes("↵ more")) return `on the more row: active ${JSON.stringify(b?.scope?.active)} hints ${JSON.stringify(b?.scopeHints)}`;
      if (c3?.scope?.rows.length !== 55 || !c3.scope.active?.includes("many 51")) return `second slice ${c3?.scope?.rows.length} rows, active ${JSON.stringify(c3?.scope?.active)}`;
      return null;
    },
  },
].filter((kase) => !kase.refCase || config.refHasChildren);

// Recent rows and frequent first (BRW-14), on arm only. The browser's own
// frecency and old pick stores are put back exactly as they were, and the
// running instance re-reads them.
async function withPickStore(fn) {
  const saved = await c.evaluate(() => {
    const graph = window.roamAlphaAPI.graph?.name ?? "graph";
    return [`burrow:frecency:${graph}`, `burrow:picks:${graph}`].map((key) => ({ key, value: localStorage.getItem(key) }));
  });
  try {
    await c.evaluate(() => window.__BURROW.frecency.clear());
    return await fn();
  } finally {
    await c.evaluate((saved) => {
      for (const { key, value } of saved) {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      window.__BURROW?.frecency?.reload();
    }, saved);
  }
}

const seedPick = (uid) => c.evaluate((uid) => window.__BURROW.frecency.record("block", uid), uid);

async function runPickCases() {
  return withPickStore(async () => {
    const query = "((zebra burrow pick";
    const typeAndRead = async (text) => {
      const primed = await prime(SEED);
      if (!primed.ok) return { error: "focus failed" };
      await c.type(text, TYPE_MS);
      await settle("on");
      return state();
    };
    const out = {};
    // (a) Pick the second of two equal rows; an empty (( then lists it first,
    // not selected. (The same Enter in off/gone arms: the byte case below.)
    const first = await typeAndRead(query);
    await c.key("ArrowDown");
    await sleep(80);
    const chosen = (await state()).activeUid;
    await c.key("Enter");
    const picked = await readBack();
    const empty = await typeAndRead("((");
    const active = empty.rows.findIndex((r) => r.active);
    await c.key("Escape");
    await readBack();
    out.recent = { first: first.rows, chosen, picked: picked.string, firstUid: empty.firstUid, phase: empty.phase, active, rows: empty.rows.map((r) => r.text) };
    // (b) Three picks of the same row, whichever place it is in, and the
    // query again: it comes first.
    out.frecency = { target: chosen, rounds: [] };
    await c.evaluate(() => window.__BURROW.frecency.clear());
    const base = await typeAndRead(query);
    out.frecency.before = base.firstUid;
    const target = base.firstUid === chosen ? (await c.evaluate(() => window.__BURROW.state.rows.map((r) => r.uid)))[1] : chosen;
    out.frecency.target = target;
    for (let i = 0; i < 3; i++) {
      const round = i === 0 ? base : await typeAndRead(query);
      const uids = await c.evaluate(() => window.__BURROW.state.rows.map((r) => r.uid));
      const at = uids.indexOf(target);
      for (let k = 0; k < Math.max(0, at); k++) { await c.key("ArrowDown"); await sleep(60); }
      await c.key("Enter");
      await readBack();
      out.frecency.rounds.push({ at, rows: round.rows.length });
    }
    const again = await typeAndRead(query);
    await c.key("Escape");
    await readBack();
    out.frecency.afterFirst = again.firstUid;
    // (c) Forget: the history is gone, and so are its rows.
    await c.evaluate(() => window.__BURROW.forgetPicks());
    const gone = await typeAndRead("((");
    const kinds = await c.evaluate(() => ({ recent: window.__BURROW.state.rows.map((r) => r.recent ?? null), size: window.__BURROW.frecency.size }));
    await c.key("Escape");
    await readBack();
    out.forget = { rows: gone.rows.length, kinds: kinds.recent, size: kinds.size };
    return out;
  });
}

// One recent pick in the store, an empty ((: the pick is Burrow's first row,
// nothing is highlighted, and Enter does what Roam alone does (compared with
// the off and gone arms by the byte cases' verdict).
const RECENT_CASE = {
  name: "(( with nothing typed: the recent pick is the first row, nothing selected, Enter is Roam's",
  query: "((", seedPick: () => fx.drill.pickA, keys: ["snap", "Enter"],
  check: ({ before, snaps: [a] }) => {
    if (before?.firstUid !== fx.drill.pickA) return `first row ${JSON.stringify(before?.firstUid)} != ${fx.drill.pickA} ${JSON.stringify(before?.rows?.map((r) => r.text))}`;
    if (before.phase !== "ARMED" || before.rows.some((r) => r.active) || a?.rows.some((r) => r.active)) return `selected: phase ${before.phase} rows ${JSON.stringify(before.rows.map((r) => r.active))}`;
    return null;
  },
};

// Fast typing: Enter lands before Burrow's post-paint ranking has run, so
// the keydown must flush it and still commit the original.
async function runFastCase() {
  const primed = await prime(SEED);
  if (!primed.ok) return { error: "focus failed", primed };
  await c.type(q, 0);
  await c.key("Enter");
  return readBack();
}

const childUids = (pageUid) => c.evaluate((pageUid) => (window.roamAlphaAPI.pull("[{:block/children [:block/uid]}]", [":block/uid", pageUid])?.[":block/children"] || []).map((k) => k[":block/uid"]), pageUid);

// Roam keeps its preview open/closed across popups; put it back as found.
async function restorePreviewState(initial) {
  const primed = await prime(SEED);
  if (!primed.ok) return;
  await c.type(config.listed.query, TYPE_MS);
  await settle("on");
  if ((await isExpanded()) !== initial) await ctrlO();
  await c.key("Escape");
  await readBack();
}

async function runAliasCase(kase) {
  return withSettings("on", kase.settings, async () => {
    misses = [];
    wheelSteps = 0;
    const primed = await prime(SEED);
    if (!primed.ok) return { error: "focus failed", primed };
    if (kase.query) {
      await c.type(kase.query, TYPE_MS);
      // A "noRows" case expects no Burrow row; give roam-aliases time to draw.
      await settle(kase.noRows ? "gone" : "on");
    }
    if (kase.waitAliases) {
      for (let t0 = Date.now(); Date.now() - t0 < 2000;) {
        if (await c.evaluate(() => document.querySelectorAll(".rm-aliases .rm-autocomplete-result").length)) break;
        await sleep(50);
      }
      await sleep(300);
    }
    await sleep(150);
    const before = await state();
    before.roamAliasesRows = await c.evaluate(() => document.querySelectorAll(".rm-aliases .rm-autocomplete-result").length);
    const snaps = [];
    const initialPreview = kase.restorePreview ? await isExpanded() : null;
    const t0 = kase.created ? await pageNow(c) : null;
    let after;
    try {
      await runKeys(kase.keys, snaps);
      after = await readBack();
    } finally {
      if (kase.restorePreview) await restorePreviewState(initialPreview);
    }
    // Blocks created anywhere in the graph while the keys ran (a footnote, a
    // block below), besides the new blocks on the fixture page readBack counts.
    const created = kase.created ? await createdSince(c, t0) : undefined;
    return { before, snaps, ...after, created, misses, wheelSteps };
  });
}

// Roam itself very rarely drops a trusted key under scripted typing (seen
// once in ~300 runs, at 15 ms per key, never at a human pace and never tied
// to Burrow, which consumes no printable key). The typed text is checked
// before the case keys, and the case retypes once if Roam dropped a key.
let retypes = 0;

async function runCase(arm, kase) {
  if (kase.seedPick && arm === "on") return withPickStore(async () => { await seedPick(kase.seedPick()); return withSettings(arm, kase.settings, () => runCaseBody(arm, kase)); });
  return withSettings(arm, kase.settings, () => runCaseBody(arm, kase));
}

async function runCaseBody(arm, kase) {
  const query = kase.query ?? q;
  // An empty query types nothing: the block just holds the seed.
  const typedOpen = query === "" ? SEED : `${SEED}${query}${query.startsWith("((") ? "))" : "]]"}`;
  if (kase.pre === "break" && arm !== "gone") {
    await c.evaluate(() => { const i = window.__BURROW.indexes; i.__saved = i.refs; Object.defineProperty(i, "refs", { configurable: true, get: () => ({ entries: null }) }); });
  }
  misses = [];
  wheelSteps = 0;
  let before = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const primed = await prime(SEED);
    if (!primed.ok) return { error: "focus failed", primed };
    if (query !== "") {
      await c.type(query, TYPE_MS);
      await settle(kase.pre === "break" || kase.loose || arm === "drilloff" ? "gone" : arm);
    }
    before = await state();
    if (before.value === typedOpen) break;
    retypes += 1;
    await c.key("Escape");
    await sleep(200);
  }
  if (before.value !== typedOpen) return { error: `typed text ${JSON.stringify(before.value)} != ${JSON.stringify(typedOpen)}` };
  const snaps = [];
  await runKeys(kase.keys, snaps);
  const after = await readBack();
  if (kase.pre === "break" && arm !== "gone") {
    await c.evaluate(() => { const i = window.__BURROW?.indexes; if (i) { delete i.refs; } });
  }
  return { before, snaps, ...after, misses, wheelSteps };
}

// ---- overlap ----

const ctrlO = async () => {
  const base = { key: "o", code: "KeyO", windowsVirtualKeyCode: 79, nativeVirtualKeyCode: 79, modifiers: 2 };
  await c.call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await c.call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(300);
};
const isExpanded = () => c.evaluate(() => Boolean(document.querySelector(".rm-autocomplete__results--expanded")));

// Rects of what is drawn in the picker, by group; two groups must not overlap.
const collectRects = () => c.evaluate(() => {
  const shown = (el) => {
    if (!el.getClientRects().length) return false;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
    }
    return true;
  };
  const items = [];
  const add = (group, el, box = el.getBoundingClientRect()) => {
    const r = { l: box.left, t: box.top, r: box.right, b: box.bottom };
    if (r.r - r.l > 0 && r.b - r.t > 0) items.push({ group, text: (el.textContent || "").trim().slice(0, 30), ...r });
  };
  for (const el of document.querySelectorAll(".burrow-strip:not([hidden]) .burrow-row, .burrow-strip:not([hidden]) .burrow-chips, .burrow-hints:not([hidden])")) add("burrow", el);
  for (const el of document.querySelectorAll(".rm-aliases .dont-focus-block.alias")) if (shown(el)) add("aliases", el);
  const scroll = document.querySelector(".rm-autocomplete__results-scroll");
  if (scroll) {
    const clip = scroll.getBoundingClientRect();
    for (const el of scroll.querySelectorAll(":scope > div")) {
      const box = el.getBoundingClientRect();
      add("native", el, { left: Math.max(box.left, clip.left), top: Math.max(box.top, clip.top), right: Math.min(box.right, clip.right), bottom: Math.min(box.bottom, clip.bottom) });
    }
  }
  const expanded = document.querySelector(".rm-autocomplete__results--expanded");
  const nativePreview = expanded?.querySelector(".rm-autocomplete__preview");
  if (nativePreview && shown(nativePreview)) add("preview", nativePreview);
  for (const el of document.querySelectorAll(".burrow-preview:not([hidden])")) add("preview", el);
  for (const el of document.querySelectorAll(".rm-autocomplete-footer")) if (shown(el)) add("footer", el);
  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]; const b = items[j];
      if (a.group === b.group) continue;
      if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2) pairs.push(`${a.group}:${JSON.stringify(a.text)} x ${b.group}:${JSON.stringify(b.text)}`);
    }
  }
  return pairs;
});

// Text boxes (0.6.0 gate): every text drawn in the picker (Roam's popover and
// roam-aliases' rows in it, Burrow's rows, hint line, previews, drill panel,
// key list, hover tip) and the edited text, each text node's line boxes from
// the DOM, cut to what its scrolling or clipping ancestors show (and, in a
// pane with a sticky header, to below that header). No two boxes of
// different text nodes may intersect. Small overlaps between lines of one
// paragraph (inline boxes taller than the line height) do not count.
const textOverlaps = () => c.evaluate(() => {
  const roots = [...document.querySelectorAll(".rm-autocomplete__results, .burrow-preview:not([hidden]), .burrow-scope:not([hidden]), .burrow-help:not([hidden]), .burrow-tip:not([hidden])")];
  const shownCache = new Map();
  const shown = (el) => {
    if (shownCache.has(el)) return shownCache.get(el);
    let ok = true;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") { ok = false; break; }
    }
    shownCache.set(el, ok);
    return ok;
  };
  // The text's own element clips too (an ellipsized span).
  const clipOf = (el) => {
    let r = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity };
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        const b = n.getBoundingClientRect();
        let top = b.top;
        // A sticky header covers what scrolls under it.
        const sticky = [...n.children].find((k) => getComputedStyle(k).position === "sticky" && !k.contains(el));
        if (sticky) top = Math.max(top, sticky.getBoundingClientRect().bottom);
        r = { l: Math.max(r.l, b.left), t: Math.max(r.t, top), r: Math.min(r.r, b.right), b: Math.min(r.b, b.bottom) };
      }
    }
    return r;
  };
  const items = [];
  const range = document.createRange();
  for (const root of roots) {
    if (!shown(root)) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || !node.parentElement || !shown(node.parentElement)) continue;
      const clip = clipOf(node.parentElement);
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        const r = { l: Math.max(box.left, clip.l), t: Math.max(box.top, clip.t), r: Math.min(box.right, clip.r), b: Math.min(box.bottom, clip.b) };
        if (r.r - r.l > 1 && r.b - r.t > 1) items.push({ node, text: node.textContent.trim().slice(0, 32), h: box.height, ...r });
      }
    }
  }
  // The text being edited: its line(s), inside its padding.
  const ta = document.activeElement?.tagName === "TEXTAREA" ? document.activeElement : null;
  if (ta) {
    const b = ta.getBoundingClientRect();
    const cs = getComputedStyle(ta);
    items.push({ node: ta, text: `[text] ${ta.value.slice(-24)}`, h: b.height, l: b.left, t: b.top + parseFloat(cs.paddingTop), r: b.right, b: b.bottom - parseFloat(cs.paddingBottom) });
  }
  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]; const b = items[j];
      if (a.node === b.node) continue;
      const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (w > 2 && h > Math.max(3, 0.3 * Math.min(a.b - a.t, b.b - b.t))) pairs.push(`${JSON.stringify(a.text)} x ${JSON.stringify(b.text)}`);
    }
  }
  return { boxes: items.length, pairs: [...new Set(pairs)] };
});

// Every picker state, both of Roam's preview layouts where it applies; Roam's
// preview is left as it was found.
async function runTextOverlap() {
  const states = [];
  const problems = [];
  let initial = null;
  const visit = async (label, query, keys, { settings = null, preview = null } = {}) => {
    await withSettings("on", settings, async () => {
      const primed = await prime(SEED);
      if (!primed.ok) { problems.push(`${label}: focus failed`); return; }
      await c.type(query, TYPE_MS);
      await settle(query.startsWith("((") || settings?.aliasInline === false ? "gone" : "on");
      initial ??= await isExpanded();
      if (preview != null && (await isExpanded()) !== preview) await ctrlO();
      await runKeys(keys);
      await sleep(250);
      const r = await textOverlaps();
      states.push({ label, boxes: r.boxes, pairs: r.pairs.length });
      for (const pair of r.pairs) problems.push(`${label}: ${pair}`);
      await c.key("Escape");
      await sleep(120);
      if (await c.evaluate(() => Boolean(document.querySelector(".burrow-scope:not([hidden]), .burrow-help:not([hidden])")))) await c.key("Escape");
      await readBack();
    });
  };
  try {
    for (const preview of [false, true]) {
      const p = preview ? "preview open" : "preview closed";
      await visit(`(( rows, ${p}`, config.ref.query, [], { preview });
      await visit(`(( rows, a tip on a row, ${p}`, config.ref.query, ["hover:.burrow-strip .burrow-row", "wait:700"], { preview });
      await visit(`(( Roam's row highlighted, ${p}`, config.ref.query, ["down-past-strip"], { preview });
      await visit(`(( tasks, ${p}`, "((zebra task", [], { preview });
      await visit(`(( rich rows, ${p}`, "((zebra rich", [], { preview });
      await visit(`(( code row, ${p}`, "((zebra_plot", [], { preview });
      await visit(`(( a cut long row, ${p}`, "((zebra snippet", [], { preview });
      // The preview scrolls to a line far down its siblings: its header stays on top.
      await visit(`(( preview scrolled to its highlighted line, ${p}`, "((many 50", ["wait:400"], { preview });
      await visit(`(( ⇧⇥ up to the parent, ${p}`, "((never grok", ["shift+Tab", "wait:300"], { preview });
      await visit(`(( Tab into a block, ${p}`, "((never grok", ["Tab", "wait:300"], { preview });
      await visit(`[[ alias row and chips, ${p}`, config.chips.query, ["alt+ArrowDown"], { preview });
      await visit(`[[ alias row, roam-aliases' own rows, ${p}`, config.listed.query, [], { preview, settings: { aliasInline: false } });
      await visit(`[[ drill-down, ${p}`, DRILL_Q, [], { preview });
      await visit(`[[ Tab drill panel, ${p}`, `[[${DRILL_PAGE}`, ["Tab", "wait:300"], { preview });
      await visit(`key list, ${p}`, config.preselect.query, ["alt+slash", "wait:200"], { preview });
      await visit(`alias field, ${p}`, `[[${FIXTURE_PAGE} Empty`, ["alt+a", "type:zq field"], { preview, settings: { aliasCreate: true } });
    }
  } finally {
    const primed = await prime(SEED);
    if (primed.ok) {
      await c.type(config.listed.query, TYPE_MS);
      await settle("on");
      if (initial != null && (await isExpanded()) !== initial) await ctrlO();
      await c.key("Escape");
      await readBack();
    }
  }
  return { states, problems };
}
// Write cases change the graph: edits are measured from just after priming,
// and whatever the case wrote is put back in a finally.
async function runWriteCase(kase) {
  return withSettings("on", kase.settings, async () => {
    try {
      const primed = await prime(SEED);
      if (!primed.ok) return { error: "focus failed", primed };
      const t0 = await pageNow(c);
      const beforeResult = await kase.before?.();
      await c.type(kase.query, TYPE_MS);
      await settle("on");
      await sleep(150);
      const before = await state();
      const snaps = [];
      await runKeys(kase.keys, snaps);
      const after = await readBack();
      await sleep(300);
      const edited = await editedSince(c, t0);
      const read = await kase.read?.();
      return { before, snaps, ...after, edited, read, beforeResult };
    } finally {
      await kase.restore?.();
      // The restore is an edit outside Burrow: its alias watch carries it
      // into the index (0.5.0), so the next case only waits for that.
      if (kase.restore) await sleep(600);
    }
  });
}

// ---- popup above the text ----

const hits = (a, b) => Boolean(a && b) && Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
const inside = (a, b) => Boolean(a && b) && a.l >= b.l - 2 && a.r <= b.r + 2 && a.t >= b.t - 2 && a.b <= b.b + 2;

async function runAbove() {
  const low = async () => {
    const { taTop, innerHeight } = await placeLow(c);
    if (!(taTop >= innerHeight - 200)) throw new Error(`above: placement did not take, text top ${taTop} of ${innerHeight}`);
  };
  const problems = [];
  const mine = [];
  try {
    // (a) the [[ results with Burrow's strip and hints
    let primed = await prime(SEED);
    if (!primed.ok) throw new Error("above: focus failed");
    await low();
    await c.type(config.listed.query, TYPE_MS);
    await settle("on");
    await sleep(300);
    const a = await state();
    const g = a.geometry;
    if (!g.pop || !g.ta) problems.push(`(a) no popover or textarea ${JSON.stringify(g)}`);
    else {
      if (g.pop.b > g.ta.t + 2) problems.push(`(a) popover not above the text: bottom ${g.pop.b} > text top ${g.ta.t}`);
      if (g.strip && !inside(g.strip, g.pop)) problems.push(`(a) strip outside the popover ${JSON.stringify([g.strip, g.pop])}`);
      if (g.hints && !inside(g.hints, g.pop)) problems.push(`(a) hints outside the popover ${JSON.stringify([g.hints, g.pop])}`);
      for (const name of ["strip", "hints", "preview"]) if (hits(g[name], g.ta)) problems.push(`(a) ${name} covers the text`);
    }
    for (const pair of await collectRects()) problems.push(`(a) overlap ${pair}`);
    for (const pair of (await textOverlaps()).pairs) problems.push(`(a) text overlap ${pair}`);
    mine.push(a);
    await c.key("Escape");
    await readBack();
    // (b) the Tab drill panel
    primed = await prime(SEED);
    if (!primed.ok) throw new Error("above: focus failed");
    await low();
    await c.type(`[[${DRILL_PAGE}`, TYPE_MS);
    await settle("gone");
    await c.key("Tab");
    await sleep(500);
    const b = await state();
    const h = b.geometry;
    if (!h.scope || !h.ta) problems.push(`(b) no scope panel or textarea ${JSON.stringify(h)}`);
    else {
      if (h.scope.b > h.ta.t + 2) problems.push(`(b) scope panel not above the text: bottom ${h.scope.b} > text top ${h.ta.t}`);
      for (const name of ["scope", "preview"]) if (hits(h[name], h.ta)) problems.push(`(b) ${name} covers the text`);
    }
    mine.push(b);
    await c.key("Escape");
    await sleep(120);
    await c.key("Escape");
    await readBack();
  } finally {
    await placeNormal(c);
  }
  return { problems, snaps: mine };
}

// ---- main ----

const report = { window: c.page.title, config: configName, theme, themeSet, arms: {}, failures: [], lines: [] };
const note = (name, r, before) => report.lines.push(`${report.failures.length > before ? "FAIL" : "PASS"} ${name}${r?.string != null ? `: ${JSON.stringify(r.string)}` : ""}`);
const ALIAS_RUN_CASES = [...ALIAS_CASES, ...REFSEARCH_CASES, ...BLOCK_CASES];
const BYTE_CASES = [...CASES, ...DRILL_CASES, ...PASS_CASES, RECENT_CASE, ...ALIAS_USAGE_CASES];
const ABOVE = "popup above the text: panes stay in the popover, off the text";
const PICKS = "recent and frequent picks: pick then empty ((, 3 picks reorder, forget";
const TEXT = "text boxes: no text overlaps another in any picker state";
if (only) {
  const names = [...BYTE_CASES, ...ALIAS_RUN_CASES, ...WRITE_CASES, ...TAB_CASES].map((k) => k.name).concat(ABOVE, TEXT, PICKS);
  if (!names.includes(only)) throw new Error(`unknown case ${JSON.stringify(only)}; names: ${names.map((n) => JSON.stringify(n)).join(", ")}`);
}
// One cleanup for the finally path and for SIGINT / SIGTERM / a crash, so the
// arm is unloaded, the fixture deleted, the installed Burrow put back and the
// theme override dropped exactly once.
let cleaning = null;
const cleanup = () => (cleaning ||= (async () => {
  try {
    await restoreFocus();
    await setArm("gone");
    report.cleanup = await cleanupFixture(c, { keep });
  } catch (error) {
    console.error("cleanup:", error);
  } finally {
    try {
      report.restored = await unparkInstalled(c);
      if (theme) report.themeRestored = await c.setTheme(null);
    } catch (error) {
      console.error("cleanup:", error);
    }
    c.close();
  }
})());
onAbort(cleanup);
// Start from a fresh module, never one left by an earlier dev-load, and park
// an installed Burrow before the leftover checks (setArm's, and the one below).
await c.evaluate(async () => {
  const dev = window.__burrowDev;
  if (dev?.module) { await dev.module.default.onunload(); dev.module = null; }
  document.getElementById("burrow-dev-css")?.remove();
});
report.installed = await parkInstalled(c);
if (report.installed.error) throw new Error(report.installed.error);
await setArm("gone").catch(async (error) => { await unparkInstalled(c); throw error; });
const leaks = await c.evaluate(() => document.querySelectorAll(".burrow-strip").length);
if (leaks) {
  await unparkInstalled(c);
  throw new Error(`${leaks} Burrow strip node(s) from a leaked instance; reload this window first`);
}
const fx = await setupFixture(c, { drillTree: true }).catch(async (error) => { await unparkInstalled(c); throw error; });
report.fixture = fx;
const sameResult = (a, b) => a.string === b.string && JSON.stringify(a.extraStrings) === JSON.stringify(b.extraStrings) && JSON.stringify(a.newPages) === JSON.stringify(b.newPages);
// Verdicts return failure strings; the full run and --only share them.
const byteVerdict = (kase, { on, off, gone, drilloff }) => {
  const failures = [];
  if (!sameResult(off, gone)) failures.push(`${kase.name}: off ${JSON.stringify(off.string)} != gone ${JSON.stringify(gone.string)}`);
  if (drilloff && !sameResult(drilloff, gone)) failures.push(`${kase.name}: drilloff ${JSON.stringify(drilloff.string)}/${JSON.stringify(drilloff.newPages)} != gone ${JSON.stringify(gone.string)}/${JSON.stringify(gone.newPages)}`);
  const expected = typeof kase.on === "function" ? kase.on(fx.drill) : kase.on;
  if (kase.preview) {
    const p = on.before?.preview;
    if (!p || p.trail !== kase.preview.trail || p.target !== kase.preview.target || !p.targetVisible || !p.nativeHidden) {
      failures.push(`${kase.name}: preview ${JSON.stringify(p)}`);
    }
  }
  if (kase.previewMore && on.before?.preview?.previewMore !== kase.previewMore) {
    failures.push(`${kase.name}: preview more ${JSON.stringify(on.before?.preview?.previewMore)} != ${JSON.stringify(kase.previewMore)}`);
  }
  if (expected) {
    if (on.string !== expected || on.extraStrings.length || on.newPages.length) failures.push(`${kase.name}: on ${JSON.stringify(on.string)}/${JSON.stringify(on.extraStrings)}/${JSON.stringify(on.newPages)} != ${JSON.stringify(expected)}`);
  } else if (!sameResult(on, gone)) {
    failures.push(`${kase.name}: on ${JSON.stringify(on.string)}/${JSON.stringify(on.extraStrings)} != gone ${JSON.stringify(gone.string)}/${JSON.stringify(gone.extraStrings)}`);
  }
  const problem = kase.check?.(on);
  if (problem) failures.push(`${kase.name}: ${problem}`);
  return failures;
};
const aliasVerdict = (kase, r) => {
  const failures = [];
  if (r.error) failures.push(`${kase.name}: ${r.error}`);
  else {
    if (r.newPages?.length && !kase.mayCreatePage) failures.push(`${kase.name}: created ${r.newPages}`);
    if (kase.created && (r.extraStrings?.length || r.created?.length)) failures.push(`${kase.name}: blocks created ${JSON.stringify([...r.extraStrings, ...r.created])}`);
    if (kase.on && (r.string !== kase.on || (r.newPages.length && !kase.mayCreatePage))) failures.push(`${kase.name}: ${JSON.stringify(r.string)} != ${JSON.stringify(kase.on)} rows ${JSON.stringify(r.before?.rows)}`);
    for (const miss of r.misses ?? []) failures.push(`${kase.name}: ${miss}`);
    const failure = kase.check?.(r);
    if (failure) failures.push(`${kase.name}: ${failure}`);
  }
  return failures;
};
const pickVerdict = ({ recent, frecency, forget }) => {
  const failures = [];
  // The two rows tie, so either may come first; the other one is picked.
  if (recent.first?.length !== 2 || !recent.chosen || recent.picked !== `${SEED}((${recent.chosen}))` || recent.firstUid !== recent.chosen || recent.phase !== "ARMED" || recent.active !== -1) {
    failures.push(`recent rows: ${JSON.stringify(recent)}`);
  }
  if (!frecency.target || frecency.afterFirst !== frecency.target || frecency.rounds.length !== 3) failures.push(`frequent first: ${JSON.stringify(frecency)}`);
  if (forget.size !== 0 || forget.kinds.includes("pick")) failures.push(`forget recent picks: ${JSON.stringify(forget)}`);
  return failures;
};
const tabVerdict = (kase, on, gone, refChild) => {
  const failures = [];
  if (on.error || gone.error) failures.push(`${kase.name}: ${on.error || gone.error}`);
  else {
    const expected = typeof kase.on === "function" ? kase.on(fx.drill, { refChild }) : kase.on;
    if (expected) {
      if (on.string !== expected || on.extraStrings.length || on.newPages.length) failures.push(`${kase.name}: on ${JSON.stringify(on.string)}/${JSON.stringify(on.newPages)} != ${JSON.stringify(expected)}`);
    } else if (!sameResult(on, gone)) {
      failures.push(`${kase.name}: on ${JSON.stringify(on.string)}/${JSON.stringify(on.extraStrings)} != gone ${JSON.stringify(gone.string)}/${JSON.stringify(gone.extraStrings)}`);
    }
    for (const miss of on.misses ?? []) failures.push(`${kase.name}: ${miss}`);
    const failure = kase.expect?.(on.snaps);
    if (failure) failures.push(`${kase.name}: ${failure}`);
  }
  return failures;
};
const getRefChild = () => config.refHasChildren ? c.evaluate((uid) => {
  const kids = window.roamAlphaAPI.pull("[{:block/children [:block/uid :block/order]}]", [":block/uid", uid])?.[":block/children"] || [];
  return kids.sort((a, b) => a[":block/order"] - b[":block/order"])[0]?.[":block/uid"] ?? null;
}, config.ref.uid) : null;
const armLine = (arm, r) => r.error ? `  ${arm}: ERROR ${r.error} ${JSON.stringify(r.primed)}` : `  ${arm}: ${JSON.stringify(r.string)} pages ${JSON.stringify(r.newPages)}`;
try {
  const cases = CASES;
  if (only) {
    // One case of any kind with its verdict.
    const kind = BYTE_CASES.some((k) => k.name === only) ? "byte"
      : ALIAS_RUN_CASES.some((k) => k.name === only) ? "alias"
      : WRITE_CASES.some((k) => k.name === only) ? "write"
      : only === ABOVE ? "above" : only === TEXT ? "text" : only === PICKS ? "picks" : "tab";
    report.only = { name: only, kind, runs: [] };
    if (kind === "byte") {
      const kase = BYTE_CASES.find((k) => k.name === only);
      const results = {};
      for (let i = 0; i < repeat; i++) {
        for (const arm of arms.filter((a) => a !== "drilloff" || DRILL_CASES.includes(kase))) {
          const loaded = await setArm(arm);
          if (arm !== "gone" && !loaded.refs) throw new Error(`arm ${arm}: index not built`);
          const r = await runCase(arm, kase);
          results[arm] = r;
          report.only.runs.push({ arm, ...r });
          if (r.guarded) report.failures.push(`${arm} ${only}: stray keys ${r.guarded}`);
          if (r.error) report.failures.push(`${arm} ${only}: ${r.error} ${JSON.stringify(r.primed)}`);
          if (kase.pre === "break" || kase.keys.includes("unload")) await setArm("gone");
        }
      }
      if (results.on && results.off && results.gone) report.failures.push(...byteVerdict(kase, results));
    } else if (kind === "picks") {
      for (let i = 0; i < repeat; i++) {
        await setArm("on");
        const r = await runPickCases();
        report.only.runs.push({ arm: "on", ...r });
        report.failures.push(...pickVerdict(r));
      }
    } else if (kind === "alias" || kind === "write") {
      const kase = [...ALIAS_RUN_CASES, ...WRITE_CASES].find((k) => k.name === only);
      for (let i = 0; i < repeat; i++) {
        await setArm("on");
        const r = await (kind === "write" ? runWriteCase(kase) : runAliasCase(kase));
        report.only.runs.push({ arm: "on", ...r });
        report.failures.push(...aliasVerdict(kase, r));
      }
    } else if (kind === "text") {
      for (let i = 0; i < repeat; i++) {
        await setArm("on");
        const r = await runTextOverlap();
        report.overlap = r;
        report.only.runs.push({ arm: "on", string: `${r.states.length} states, ${r.states.reduce((n, st) => n + st.boxes, 0)} boxes: ${r.problems.length ? r.problems.join("; ") : "ok"}` });
        for (const problem of r.problems) report.failures.push(`${TEXT}: ${problem}`);
      }
    } else if (kind === "above") {
      for (let i = 0; i < repeat; i++) {
        await setArm("on");
        const r = await runAbove();
        report.only.runs.push({ arm: "on", string: r.problems.length ? r.problems.join("; ") : "ok" });
        for (const problem of r.problems) report.failures.push(`${ABOVE}: ${problem}`);
      }
    } else {
      const kase = TAB_CASES.find((k) => k.name === only);
      const refChild = kase.refCase ? await getRefChild() : null;
      for (let i = 0; i < repeat; i++) {
        const results = {};
        for (const arm of ["on", "gone"]) {
          await setArm(arm);
          results[arm] = await runCase(arm, kase);
          report.only.runs.push({ arm, ...results[arm] });
        }
        report.failures.push(...tabVerdict(kase, results.on, results.gone, refChild));
      }
    }
  } else {
  for (const arm of arms) {
    report.arms[arm] = {};
    for (const kase of arm === "drilloff" ? DRILL_CASES : arm === "on" || arm === "off" || arm === "gone" ? [...cases, ...DRILL_CASES, ...PASS_CASES, RECENT_CASE, ...ALIAS_USAGE_CASES] : [...cases, ...DRILL_CASES]) {
      // Unload and break both damage the runtime: reload the module per case.
      const loaded = await setArm(arm);
      if (arm !== "gone" && !loaded.refs) throw new Error(`arm ${arm}: index not built`);
      report.arms[arm][kase.name] = await runCase(arm, kase);
      // Unload and break both damage the runtime: unload it fully (a no-op
      // when the case already unloaded) so the next case loads a fresh one.
      if (kase.pre === "break" || kase.keys.includes("unload")) await setArm("gone");
    }
  }
  for (const [arm, results] of Object.entries(report.arms)) {
    for (const [name, r] of Object.entries(results)) if (r.guarded) report.failures.push(`${arm} ${name}: stray keys ${r.guarded}`);
  }
  for (const [arm, results] of Object.entries(report.arms)) {
    for (const [name, r] of Object.entries(results)) if (r.error) report.failures.push(`${arm} ${name}: ${r.error} ${JSON.stringify(r.primed)}`);
  }
  for (const kase of BYTE_CASES) {
    const at = (arm) => report.arms[arm]?.[kase.name];
    const before = report.failures.length;
    report.failures.push(...byteVerdict(kase, { on: at("on"), off: at("off"), gone: at("gone"), drilloff: at("drilloff") }));
    if (kase.line) note(kase.name, at("on"), before);
  }
  await setArm("on");
  report.alias = {};
  for (const kase of ALIAS_RUN_CASES) {
    const before = report.failures.length;
    const r = await runAliasCase(kase);
    report.alias[kase.name] = r;
    report.failures.push(...aliasVerdict(kase, r));
    note(kase.name, r, before);
  }
  // Writes to the fixture's pages, each put back afterwards.
  report.write = {};
  for (const kase of WRITE_CASES) {
    const before = report.failures.length;
    const r = await runWriteCase(kase);
    report.write[kase.name] = r;
    report.failures.push(...aliasVerdict(kase, r));
    note(kase.name, r, before);
  }
  // Tab drill: Burrow on against Roam alone.
  report.tab = {};
  const refChild = await getRefChild();
  for (const arm of ["on", "gone"]) {
    for (const kase of TAB_CASES) {
      await setArm(arm);
      (report.tab[kase.name] ||= {})[arm] = await runCase(arm, kase);
    }
  }
  for (const kase of TAB_CASES) {
    const before = report.failures.length;
    const { on, gone } = report.tab[kase.name];
    report.failures.push(...tabVerdict(kase, on, gone, refChild));
    note(kase.name, report.tab[kase.name].on, before);
  }
  await setArm("on");
  report.overlap = await runTextOverlap();
  for (const problem of report.overlap.problems) report.failures.push(`text overlap ${problem}`);
  {
    const before = report.failures.length;
    report.above = await runAbove();
    for (const problem of report.above.problems) report.failures.push(`${ABOVE}: ${problem}`);
    report.lines.push(`${report.failures.length > before ? "FAIL" : "PASS"} ${ABOVE}`);
  }
  report.pick = await runPickCases();
  report.failures.push(...pickVerdict(report.pick));
  // Real pages, read-only: the spec's drill example resolves and inserts.
  report.realDrill = await runCase("on", { name: "real drill", query: config.drill.query, keys: ["Enter"] });
  if (report.realDrill.string !== `${SEED}((${config.drill.uid}))` || report.realDrill.newPages?.length) {
    report.failures.push(`real drill ${config.drill.query}: ${JSON.stringify(report.realDrill.string)} != ((${config.drill.uid}))`);
  }
  report.fast = await runFastCase();
  if (report.fast.string !== committed) report.failures.push(`fast typing then Enter: ${JSON.stringify(report.fast.string)} != ${JSON.stringify(committed)}`);
  // Acceptance: first Burrow row is the expected original and starts selected.
  const acc = report.arms.on.Enter.before;
  report.acceptance = {
    query: q, expected: config.ref.uid, firstUid: acc.firstUid, firstActive: acc.rows[0]?.active ?? false, rows: acc.rows,
    pass: acc.firstUid === config.ref.uid && acc.rows[0]?.active === true && report.arms.on.Enter.string === committed,
  };
  if (!report.acceptance.pass) report.failures.push(`acceptance: ${JSON.stringify(report.acceptance)}`);
  report.open = open;
  report.retypes = retypes;
  report.qBody = qBody;
  }
} finally {
  await cleanup();
}
if (report.installed.parked && !report.restored?.restored) report.failures.push(`installed Burrow ${report.installed.version} not restored`);
if (themeSet?.flippedFrom && !report.themeRestored?.restored) report.failures.push(`svy-theme's ${themeSet.flippedFrom} classes not put back`);
const label = `${configName}${theme ? ` (${theme})` : ""}`;
const themeLine = themeSet ? `  theme ${theme}: ${themeSet.flippedFrom ? `svy-theme's fixed ${themeSet.flippedFrom} switched for the run (<html> classes, setting untouched), put back: ${report.themeRestored?.restored ? "yes" : "no"}` : "emulated prefers-color-scheme"}; body ${themeSet.body}` : null;
if (flags.includes("--json")) {
  console.log(JSON.stringify(report, null, 1));
} else if (only) {
  console.log(`live gate ${label} --only ${JSON.stringify(only)}: ${report.failures.length ? "FAIL" : "PASS"}`);
  if (themeLine) console.log(themeLine);
  console.log(`  installed Burrow: ${report.installed.parked ? `parked ${report.installed.version} for the run, restored: ${report.restored?.restored ? "yes" : "no"}` : "none in this window"}`);
  for (const r of report.only.runs) console.log(armLine(r.arm, r));
  for (const f of report.failures) console.log(`  FAIL ${f}`);
} else if (!only) {
  const caseCount = Object.values(report.arms).reduce((n, a) => n + Object.keys(a).length, 0);
  console.log(`live gate ${label}: ${report.failures.length ? "FAIL" : "PASS"}`);
  if (themeLine) console.log(themeLine);
  console.log(`  installed Burrow: ${report.installed.parked ? `parked ${report.installed.version} for the run, restored: ${report.restored?.restored ? "yes" : "no"}` : "none in this window"}`);
  console.log(`  acceptance ${q} -> ((${config.ref.uid})) first and selected: ${report.acceptance?.pass ? "yes" : "no"}`);
  console.log(`  byte-for-byte: ${caseCount} case runs (on / off / gone / drilloff), ${DRILL_CASES.length} of them drill cases, ${PASS_CASES.length} pass-through; retyped after a Roam key drop: ${retypes}`);
  const drillPages = (arm, commits) => DRILL_CASES.filter((k) => Boolean(k.on) === commits)
    .reduce((n, k) => n + (report.arms[arm]?.[k.name]?.newPages?.length || 0), 0);
  console.log(`  drill pages created: by Burrow commits ${drillPages("on", true)}; by Roam in the pass-through cases on ${drillPages("on", false)} = gone ${drillPages("gone", false)}`);
  console.log(`  real drill ${config.drill.query} -> ${JSON.stringify(report.realDrill?.string)}`);
  console.log(`  recent rows: picked row first, not selected: ${report.pick?.recent?.firstUid === report.pick?.recent?.chosen && report.pick?.recent?.active === -1}; frequent first after 3 picks: ${report.pick?.frecency?.afterFirst === report.pick?.frecency?.target}; forget: ${report.pick?.forget?.size === 0}`);
  const p = report.arms.on?.[DRILL_CASES[0].name]?.before?.preview;
  console.log(`  drill preview: trail ${JSON.stringify(p?.trail)}, highlighted ${JSON.stringify(p?.target)}, in view ${p?.targetVisible}`);
  console.log(`  fast typing then Enter: ${JSON.stringify(report.fast?.string)}`);
  for (const line of report.lines || []) console.log(`  ${line}`);
  console.log(`  text boxes: ${report.overlap?.states.length} picker states, ${report.overlap?.states.reduce((n, st) => n + st.boxes, 0)} text boxes, ${report.overlap?.problems.length} intersecting pairs`);
  for (const f of report.failures) console.log(`  FAIL ${f}`);
}
process.exitCode = report.failures.length ? 1 : 0;
