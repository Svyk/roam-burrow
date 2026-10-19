#!/usr/bin/env node
// Live gates for Burrow on Roam Desktop over CDP (:9223). Keys are trusted
// CDP input events into one block on a `Burrow/Fixtures` page opened in the
// right sidebar. The gate loads the build itself per arm; an installed Burrow
// is parked for the run and put back afterwards.
//
//   node tools/live-gate.mjs <window-title-prefix> <graph-config> [--keep]
//   node tools/live-gate.mjs <window> <svy|notes> --only "<case name>" [--arms on,gone] [--repeat N]
//     one case with its verdict, about 30 s
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
import { FIXTURE_PAGE, cleanupFixture, guardReport, primeFixture, setupFixture } from "./fixture.mjs";

const CONFIGS = {
  svy: {
    ref: { query: "((ant man", uid: "3XSu0IJ8f" },
    alias: { query: "[[lorinatr", insert: "[lorinator]([[Lori Boyd]])" },
    listed: { query: "[[lorinator" },
    drill: { query: "[[MCU Watch Order > watch order > ant man", uid: "3XSu0IJ8f" },
    preselect: { query: "[[lorina", insert: "[lorinator]([[Lori Boyd]])" },
    chips: { query: "[[lorina", keys: ["alt+ArrowDown", "ArrowLeft", "Enter"], insert: "[lori]([[Lori Boyd]])" },
    refHasChildren: true,
  },
  notes: {
    ref: { query: "((real time pcr", uid: "6ZtlGN-Np" },
    alias: { query: "[[holy gost", insert: "[Holy Ghost]([[Concepts/Holy Spirit]])" },
    listed: { query: "[[mike khi" },
    drill: { query: "[[Systems/Executor Lanes and LaunchAgents#grok lane > never", uid: "-EeRGLF5U" },
    preselect: { query: "[[mike kh", insert: "[Mike Khieu]([[Entities/Michael Khieu]])" },
    chips: { query: "[[mike kh", keys: ["alt+ArrowDown", "ArrowLeft", "Enter"], insert: "[king_khieu]([[Entities/Michael Khieu]])" },
  },
};
const SEED = "seed αβ 🙂 ";
const TYPE_MS = 35;
const FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pageBoost",
  "aliasInline", "aliasPreselect", "aliasChips", "tabDrill", "paneLayout", "keyHints"];

const [title, configName, ...flags] = process.argv.slice(2);
const config = CONFIGS[configName];
if (!title || !config) throw new Error("usage: live-gate.mjs <window-title-prefix> <svy|notes> [--keep]");
const keep = flags.includes("--keep");
const flagValue = (name) => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : null; };
const only = flagValue("--only");
const arms = (flagValue("--arms") || "on,off,gone,drilloff").split(",");
const repeat = Number(flagValue("--repeat") || 1);
const root = new URL("..", import.meta.url);
const c = await connect(title);

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
    // to delete, but only while it is empty and nothing else links to it.
    for (const t of newPages) {
      const p = api.pull("[:block/uid {:block/children [:db/id]} {:block/_refs [:db/id]}]", [":node/title", t]);
      if (p && !p[":block/children"]?.length && !p[":block/_refs"]?.length) await api.data.page.delete({ page: { uid: p[":block/uid"] } });
    }
    return { string, extraStrings, newPages };
  });
  if (guarded.length) result.guarded = guarded;
  return result;
}

async function state() {
  return c.evaluate(() => {
    const b = window.__BURROW;
    return {
      phase: b?.state.phase ?? "gone",
      rows: [...document.querySelectorAll(".burrow-strip:not([hidden]) .burrow-row")].map((r) => ({
        text: r.textContent, active: r.classList.contains("burrow-active"),
      })),
      firstUid: b?.state.rows?.[0]?.uid ?? null,
      popup: Boolean(document.querySelector(".rm-autocomplete__results")),
      preview: (() => {
        const pane = document.querySelector(".burrow-preview:not([hidden])");
        if (!pane) return null;
        return {
          trail: pane.querySelector(".burrow-trail")?.textContent,
          target: pane.querySelector(".burrow-target")?.textContent ?? null,
          targetVisible: (() => {
            const t = pane.querySelector(".burrow-target");
            if (!t) return null;
            const a = t.getBoundingClientRect(); const b = pane.getBoundingClientRect();
            return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
          })(),
          nativeHidden: [...document.querySelectorAll(".rm-autocomplete__results.burrow-drill .rm-autocomplete__preview > *")].every((n) => getComputedStyle(n).visibility === "hidden"),
        };
      })(),
      value: document.activeElement?.value,
      ...(() => {
        const shown = (el) => {
          if (!el.getClientRects().length) return false;
          for (let n = el; n && n !== document.body; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.display === "none" || cs.visibility === "hidden") return false;
          }
          return true;
        };
        const panel = document.querySelector(".burrow-scope:not([hidden])");
        const scopeRowsList = panel ? [...panel.querySelectorAll(".burrow-scope-list .burrow-row")] : [];
        const column = document.querySelector(".rm-aliases");
        const items = [...document.querySelectorAll(".rm-aliases .dont-focus-block.alias")];
        return {
          scope: panel ? {
            crumb: panel.querySelector(".burrow-scope-crumb")?.textContent ?? "",
            rows: scopeRowsList.map((r) => r.textContent),
            active: scopeRowsList.find((r) => r.classList.contains("burrow-active"))?.textContent ?? null,
            filter: panel.querySelector(".burrow-scope-filter")?.textContent ?? "",
          } : null,
          chips: [...document.querySelectorAll(".burrow-chips .burrow-chip")].map((n) => ({ text: n.textContent, active: n.classList.contains("burrow-active") })),
          hints: document.querySelector(".burrow-hints:not([hidden])")?.textContent ?? null,
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
  return c.evaluate(async ({ arm, code, css, features }) => {
    const dev = window.__burrowDev || (window.__burrowDev = { values: {} });
    if (arm === "gone") {
      if (dev.module) await dev.module.default.onunload();
      dev.module = null;
      document.getElementById("burrow-dev-css")?.remove();
      const leftovers = document.querySelectorAll(".burrow-strip, .burrow-hud, .burrow-owns-selection, [class*=burrow-pad]").length;
      if (leftovers) throw new Error(`${leftovers} Burrow node(s) left after unload`);
      return { arm, leftovers };
    }
    for (const f of features) dev.values[f] = arm === "on" || arm === "drilloff";
    if (arm === "drilloff") { dev.values.drill = false; dev.values.drillPreview = false; }
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
        ui: { commandPalette: { addCommand: async () => null, removeCommand: async () => null } },
      };
      await dev.module.default.onload({ extensionAPI, extension: { version: "gate" } });
    }
    const t0 = performance.now();
    while (!window.__BURROW?.indexes?.refs && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 100));
    return { arm, refs: window.__BURROW?.indexes?.refs?.entries.length };
  }, { arm, code, css, features: FEATURES });
}

// ---- cases ----

const q = config.ref.query;
const qBody = q.slice(2);
const open = `${SEED}${q}${q.startsWith("((") ? "))" : "]]"}`;
const committed = `${SEED}((${config.ref.uid}))`;

const pageClick = async () => {
  const { x, y } = await c.evaluate(() => {
    const r = document.querySelector(".roam-article h1, .rm-title-display")?.getBoundingClientRect();
    return r ? { x: r.left + 20, y: r.top + r.height / 2 } : { x: 400, y: 120 };
  });
  for (const type of ["mousePressed", "mouseReleased"]) {
    await c.call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
};

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

async function runKeys(keys, snaps = []) {
  for (const k of keys) {
    const modified = k.match(/^(alt|shift)\+(.+)$/);
    if (k === "snap") snaps.push(await state());
    else if (modified) await c.key(modified[2], modified[1] === "alt" ? 1 : 8);
    else if (k.startsWith("type:")) await c.type(k.slice(5), TYPE_MS);
    else if (k === "click") await pageClick();
    else if (k === "down-past-strip") {
      const rows = (await state()).rows.length;
      for (let i = 0; i < rows; i++) { await c.key("ArrowDown"); await sleep(60); }
    }
    else if (k === "ime") {
      await c.call("Input.imeSetComposition", { text: "ni", selectionStart: 2, selectionEnd: 2 });
      await sleep(150);
      await c.call("Input.insertText", { text: "你" });
    } else if (k === "caret-move") {
      await c.evaluate(() => { const ta = document.activeElement; ta.setSelectionRange(ta.selectionStart - 1, ta.selectionStart - 1); });
    } else if (k === "unload") {
      await c.evaluate(async () => { const d = window.__burrowDev; if (d?.module) await d.module.default.onunload(); });
    } else await c.key(k);
    if (k !== "snap") await sleep(120);
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
    check: (r) => (r.snaps[0]?.rows[0]?.active ? null : `first row not active ${JSON.stringify(r.snaps[0]?.rows)}`),
  },
  {
    name: "alias chips: ⌥↓, ←, Enter", query: config.chips.query,
    keys: ["snap", ...config.chips.keys.flatMap((k) => (k === "alt+ArrowDown" ? [k, "snap"] : [k]))], on: `${SEED}${config.chips.insert}`,
    check: (r) => {
      const chips = r.snaps[1]?.chips || [];
      return chips.length >= 2 && chips.filter((chip) => chip.active).length === 1 ? null : `chips after ⌥↓ ${JSON.stringify(chips)}`;
    },
  },
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
].filter((kase) => !kase.refCase || config.refHasChildren);

// Pick memory, on arm only: pick the second of two equal rows, type the same
// query again, and that row must come first. The browser's pick store is
// put back exactly as it was.
async function runPickCase() {
  const saved = await c.evaluate(() => {
    const key = `burrow:picks:${window.roamAlphaAPI.graph?.name ?? "graph"}`;
    const value = localStorage.getItem(key);
    window.__burrowDev.values.pickMemory = true;
    return { key, value };
  });
  const query = "((zebra burrow";
  const typeAndRead = async () => {
    const primed = await prime(SEED);
    if (!primed.ok) return { error: "focus failed" };
    await c.type(query, TYPE_MS);
    await settle("on");
    return state();
  };
  try {
    const first = await typeAndRead();
    await c.key("ArrowDown");
    await sleep(80);
    await c.key("Enter");
    const picked = await readBack();
    const second = await typeAndRead();
    await c.key("Escape");
    await readBack();
    return { first: first.rows, firstUids: [first.firstUid], picked: picked.string, second: second.rows, secondFirst: second.firstUid };
  } finally {
    await c.evaluate(({ key, value }) => {
      window.__burrowDev.values.pickMemory = false;
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }, saved);
  }
}

// Fast typing: Enter lands before Burrow's post-paint ranking has run, so
// the keydown must flush it and still commit the original.
async function runFastCase() {
  const primed = await prime(SEED);
  if (!primed.ok) return { error: "focus failed", primed };
  await c.type(q, 0);
  await c.key("Enter");
  return readBack();
}

async function runAliasCase(kase) {
  return withSettings("on", kase.settings, async () => {
    const primed = await prime(SEED);
    if (!primed.ok) return { error: "focus failed", primed };
    await c.type(kase.query, TYPE_MS);
    // A "noRows" case expects no Burrow row; give roam-aliases time to draw.
    await settle(kase.noRows ? "gone" : "on");
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
    await runKeys(kase.keys, snaps);
    return { before, snaps, ...(await readBack()) };
  });
}

// Roam itself very rarely drops a trusted key under scripted typing (seen
// once in ~300 runs, at 15 ms per key, never at a human pace and never tied
// to Burrow, which consumes no printable key). The typed text is checked
// before the case keys, and the case retypes once if Roam dropped a key.
let retypes = 0;

async function runCase(arm, kase) {
  return withSettings(arm, kase.settings, () => runCaseBody(arm, kase));
}

async function runCaseBody(arm, kase) {
  const query = kase.query ?? q;
  const typedOpen = `${SEED}${query}${query.startsWith("((") ? "))" : "]]"}`;
  if (kase.pre === "break" && arm !== "gone") {
    await c.evaluate(() => { const i = window.__BURROW.indexes; i.__saved = i.refs; Object.defineProperty(i, "refs", { configurable: true, get: () => ({ entries: null }) }); });
  }
  let before = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const primed = await prime(SEED);
    if (!primed.ok) return { error: "focus failed", primed };
    await c.type(query, TYPE_MS);
    await settle(kase.pre === "break" || kase.loose || arm === "drilloff" ? "gone" : arm);
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
  return { before, snaps, ...after };
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

// Four layouts: Roam's preview closed and open, default settings and
// aliasInline off. Roam's preview is left as it was found.
async function runOverlap() {
  const pairs = [];
  let initial = null;
  const open = async (want) => {
    const primed = await prime(SEED);
    if (!primed.ok) throw new Error("overlap: focus failed");
    await c.type(config.listed.query, TYPE_MS);
    await settle("on");
    initial ??= await isExpanded();
    if (want != null && (await isExpanded()) !== want) await ctrlO();
  };
  const close = async () => { await c.key("Escape"); await readBack(); };
  try {
    for (const settings of [{}, { aliasInline: false }]) {
      await withSettings("on", settings, async () => {
        for (const expanded of [false, true]) {
          await open(expanded);
          await sleep(300);
          for (const pair of await collectRects()) pairs.push(`${JSON.stringify(settings)} preview ${expanded ? "open" : "closed"}: ${pair}`);
          await close();
        }
      });
    }
  } finally {
    await open(null);
    if ((await isExpanded()) !== initial) await ctrlO();
    await close();
  }
  return { layouts: 4, pairs };
}
// ---- main ----

const report = { window: c.page.title, config: configName, arms: {}, failures: [] };
if (only) {
  const names = [...CASES, ...DRILL_CASES, ...ALIAS_CASES, ...TAB_CASES].map((k) => k.name);
  if (!names.includes(only)) throw new Error(`unknown case ${JSON.stringify(only)}; names: ${names.map((n) => JSON.stringify(n)).join(", ")}`);
}
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
  if (expected) {
    if (on.string !== expected || on.extraStrings.length || on.newPages.length) failures.push(`${kase.name}: on ${JSON.stringify(on.string)}/${JSON.stringify(on.newPages)} != ${JSON.stringify(expected)}`);
  } else if (!sameResult(on, gone)) {
    failures.push(`${kase.name}: on ${JSON.stringify(on.string)}/${JSON.stringify(on.extraStrings)} != gone ${JSON.stringify(gone.string)}/${JSON.stringify(gone.extraStrings)}`);
  }
  return failures;
};
const aliasVerdict = (kase, r) => {
  const failures = [];
  if (r.error) failures.push(`${kase.name}: ${r.error}`);
  else {
    if (r.newPages?.length && !kase.mayCreatePage) failures.push(`${kase.name}: created ${r.newPages}`);
    if (kase.on && (r.string !== kase.on || r.newPages.length)) failures.push(`${kase.name}: ${JSON.stringify(r.string)} != ${JSON.stringify(kase.on)} rows ${JSON.stringify(r.before?.rows)}`);
    const failure = kase.check?.(r);
    if (failure) failures.push(`${kase.name}: ${failure}`);
  }
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
    const kind = CASES.some((k) => k.name === only) || DRILL_CASES.some((k) => k.name === only) ? "byte"
      : ALIAS_CASES.some((k) => k.name === only) ? "alias" : "tab";
    report.only = { name: only, kind, runs: [] };
    if (kind === "byte") {
      const kase = [...CASES, ...DRILL_CASES].find((k) => k.name === only);
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
    } else if (kind === "alias") {
      const kase = ALIAS_CASES.find((k) => k.name === only);
      for (let i = 0; i < repeat; i++) {
        await setArm("on");
        const r = await runAliasCase(kase);
        report.only.runs.push({ arm: "on", ...r });
        report.failures.push(...aliasVerdict(kase, r));
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
    for (const kase of arm === "drilloff" ? DRILL_CASES : [...cases, ...DRILL_CASES]) {
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
  for (const kase of [...CASES, ...DRILL_CASES]) {
    const at = (arm) => report.arms[arm]?.[kase.name];
    report.failures.push(...byteVerdict(kase, { on: at("on"), off: at("off"), gone: at("gone"), drilloff: at("drilloff") }));
  }
  await setArm("on");
  report.alias = {};
  report.lines = [];
  const note = (name, r, before) => report.lines.push(`${report.failures.length > before ? "FAIL" : "PASS"} ${name}: ${JSON.stringify(r.string)}`);
  for (const kase of ALIAS_CASES) {
    const before = report.failures.length;
    const r = await runAliasCase(kase);
    report.alias[kase.name] = r;
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
  report.overlap = await runOverlap();
  for (const pair of report.overlap.pairs) report.failures.push(`overlap ${pair}`);
  report.pick = await runPickCase();
  // The two rows tie, so either may come first; the other one is picked.
  report.pick.expected = report.pick.firstUids?.[0] === fx.drill.pickA ? fx.drill.pickB : fx.drill.pickA;
  if (report.pick.first?.length !== 2 || report.pick.picked !== `${SEED}((${report.pick.expected}))` || report.pick.secondFirst !== report.pick.expected) {
    report.failures.push(`pick memory: ${JSON.stringify(report.pick)}`);
  }
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
  try {
    await setArm("gone");
    report.cleanup = await cleanupFixture(c, { keep });
  } finally {
    report.restored = await unparkInstalled(c);
    c.close();
  }
}
if (report.installed.parked && !report.restored?.restored) report.failures.push(`installed Burrow ${report.installed.version} not restored`);
if (flags.includes("--json")) {
  console.log(JSON.stringify(report, null, 1));
} else if (only) {
  console.log(`live gate ${configName} --only ${JSON.stringify(only)}: ${report.failures.length ? "FAIL" : "PASS"}`);
  console.log(`  installed Burrow: ${report.installed.parked ? `parked ${report.installed.version} for the run, restored: ${report.restored?.restored ? "yes" : "no"}` : "none in this window"}`);
  for (const r of report.only.runs) console.log(armLine(r.arm, r));
  for (const f of report.failures) console.log(`  FAIL ${f}`);
} else if (!only) {
  const caseCount = Object.values(report.arms).reduce((n, a) => n + Object.keys(a).length, 0);
  console.log(`live gate ${configName}: ${report.failures.length ? "FAIL" : "PASS"}`);
  console.log(`  installed Burrow: ${report.installed.parked ? `parked ${report.installed.version} for the run, restored: ${report.restored?.restored ? "yes" : "no"}` : "none in this window"}`);
  console.log(`  acceptance ${q} -> ((${config.ref.uid})) first and selected: ${report.acceptance?.pass ? "yes" : "no"}`);
  console.log(`  byte-for-byte: ${caseCount} case runs (on / off / gone / drilloff), ${DRILL_CASES.length} of them drill cases; retyped after a Roam key drop: ${retypes}`);
  const drillPages = (arm, commits) => DRILL_CASES.filter((k) => Boolean(k.on) === commits)
    .reduce((n, k) => n + (report.arms[arm]?.[k.name]?.newPages?.length || 0), 0);
  console.log(`  drill pages created: by Burrow commits ${drillPages("on", true)}; by Roam in the pass-through cases on ${drillPages("on", false)} = gone ${drillPages("gone", false)}`);
  console.log(`  real drill ${config.drill.query} -> ${JSON.stringify(report.realDrill?.string)}`);
  console.log(`  pick memory: picked the second row, then it came first: ${report.pick?.secondFirst === report.pick?.expected}`);
  const p = report.arms.on?.[DRILL_CASES[0].name]?.before?.preview;
  console.log(`  drill preview: trail ${JSON.stringify(p?.trail)}, highlighted ${JSON.stringify(p?.target)}, in view ${p?.targetVisible}`);
  console.log(`  fast typing then Enter: ${JSON.stringify(report.fast?.string)}`);
  for (const line of report.lines || []) console.log(`  ${line}`);
  console.log(`  overlap: ${report.overlap?.layouts} layouts, ${report.overlap?.pairs.length} overlapping pairs`);
  for (const f of report.failures) console.log(`  FAIL ${f}`);
}
process.exitCode = report.failures.length ? 1 : 0;
