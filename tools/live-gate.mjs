#!/usr/bin/env node
// Live gates for Burrow on Roam Desktop over CDP (:9223). Keys are trusted
// CDP input events into one block on a `Burrow/Fixtures` page opened in the
// right sidebar. Requires the build to be loaded with tools/dev-load.mjs.
//
//   node tools/live-gate.mjs <window-title-prefix> <graph-config> [--keep]
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
import { cleanupFixture, guardReport, primeFixture, setupFixture } from "./fixture.mjs";

const CONFIGS = {
  svy: {
    ref: { query: "((ant man", uid: "3XSu0IJ8f" },
    alias: { query: "[[lorinatr", insert: "[lorinator]([[Lori Boyd]])" },
    listed: { query: "[[lorinator" },
    drill: { query: "[[MCU Watch Order > watch order > ant man", uid: "3XSu0IJ8f" },
  },
  notes: {
    ref: { query: "((real time pcr", uid: "6ZtlGN-Np" },
    alias: { query: "[[holy gost", insert: "[Holy Ghost]([[Concepts/Holy Spirit]])" },
    listed: { query: "[[mike khi" },
    drill: { query: "[[Systems/Executor Lanes and LaunchAgents#grok lane > never", uid: "-EeRGLF5U" },
  },
};
const SEED = "seed αβ 🙂 ";
const TYPE_MS = 35;
const FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pageBoost"];

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
  { name: "Tab", keys: ["Tab"], on: committed },
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
const DRILL_PAGE = "Burrow/Fixtures";
const DRILL_Q = `[[${DRILL_PAGE}#alpha > never`;
const DRILL_CASES = [
  { name: "drill: Enter inserts the resolved block", query: DRILL_Q, keys: ["Enter"], on: (d) => `${SEED}((${d.never}))`, preview: { trail: `${DRILL_PAGE} › Alpha section`, target: "never grok for writing" } },
  { name: "drill: Tab inserts the resolved block", query: DRILL_Q, keys: ["Tab"], on: (d) => `${SEED}((${d.never}))` },
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

async function runKeys(keys) {
  for (const k of keys) {
    if (k.startsWith("type:")) await c.type(k.slice(5), TYPE_MS);
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
    await sleep(120);
  }
}

// [[ alias cases, on arm only: Enter in Roam's own [[ could create a page.
const ALIAS_CASES = [
  { name: "alias row: ArrowUp into the strip, Enter", query: config.alias.query, keys: ["ArrowUp", "Enter"], on: `${SEED}${config.alias.insert}` },
  { name: "alias listed by roam-aliases: no Burrow row", query: config.listed.query, keys: ["Escape"], expectRows: 0, mayCreatePage: true },
];

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
  const primed = await prime(SEED);
  if (!primed.ok) return { error: "focus failed", primed };
  await c.type(kase.query, TYPE_MS);
  // The "listed" case expects no Burrow row; give roam-aliases time to draw.
  await settle(kase.expectRows === 0 ? "gone" : "on");
  if (kase.expectRows === 0) {
    for (let t0 = Date.now(); Date.now() - t0 < 2000;) {
      if (await c.evaluate(() => document.querySelectorAll(".rm-aliases .rm-autocomplete-result").length)) break;
      await sleep(50);
    }
  }
  await sleep(150);
  const before = await state();
  before.roamAliasesRows = await c.evaluate(() => document.querySelectorAll(".rm-aliases .rm-autocomplete-result").length);
  await runKeys(kase.keys);
  return { before, ...(await readBack()) };
}

// Roam itself very rarely drops a trusted key under scripted typing (seen
// once in ~300 runs, at 15 ms per key, never at a human pace and never tied
// to Burrow, which consumes no printable key). The typed text is checked
// before the case keys, and the case retypes once if Roam dropped a key.
let retypes = 0;

async function runCase(arm, kase) {
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
    await settle(kase.pre === "break" || arm === "drilloff" ? "gone" : arm);
    before = await state();
    if (before.value === typedOpen) break;
    retypes += 1;
    await c.key("Escape");
    await sleep(200);
  }
  if (before.value !== typedOpen) return { error: `typed text ${JSON.stringify(before.value)} != ${JSON.stringify(typedOpen)}` };
  await runKeys(kase.keys);
  const after = await readBack();
  if (kase.pre === "break" && arm !== "gone") {
    await c.evaluate(() => { const i = window.__BURROW?.indexes; if (i) { delete i.refs; } });
  }
  return { before, ...after };
}

// ---- main ----

const report = { window: c.page.title, config: configName, arms: {}, failures: [] };
// Start from a fresh module, never one left by an earlier dev-load.
await setArm("gone");
const leaks = await c.evaluate(() => document.querySelectorAll(".burrow-strip").length);
if (leaks) throw new Error(`${leaks} Burrow strip node(s) from a leaked instance; reload this window first`);
const fx = await setupFixture(c, { drillTree: true });
report.fixture = fx;
try {
  const cases = only ? CASES.filter((k) => k.name === only) : CASES;
  if (only) {
    // Diagnostic mode: one case, chosen arms, repeated; no pass/fail.
    for (const arm of arms) {
      report.arms[arm] = [];
      for (let i = 0; i < repeat; i++) {
        await setArm(arm);
        const r = await runCase(arm, cases[0]);
        report.arms[arm].push(r.error ? `ERROR ${r.error} ${JSON.stringify(r.primed)}` : r.string + " | " + JSON.stringify(r.extraStrings));
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
    const on = report.arms.on[kase.name];
    const off = report.arms.off[kase.name];
    const gone = report.arms.gone[kase.name];
    const same = (a, b) => a.string === b.string && JSON.stringify(a.extraStrings) === JSON.stringify(b.extraStrings) && JSON.stringify(a.newPages) === JSON.stringify(b.newPages);
    if (!same(off, gone)) report.failures.push(`${kase.name}: off ${JSON.stringify(off.string)} != gone ${JSON.stringify(gone.string)}`);
    const drilloff = report.arms.drilloff?.[kase.name];
    if (drilloff && !same(drilloff, gone)) report.failures.push(`${kase.name}: drilloff ${JSON.stringify(drilloff.string)}/${JSON.stringify(drilloff.newPages)} != gone ${JSON.stringify(gone.string)}/${JSON.stringify(gone.newPages)}`);
    const expected = typeof kase.on === "function" ? kase.on(fx.drill) : kase.on;
    if (kase.preview) {
      const p = on.before?.preview;
      if (!p || p.trail !== kase.preview.trail || p.target !== kase.preview.target || !p.targetVisible || !p.nativeHidden) {
        report.failures.push(`${kase.name}: preview ${JSON.stringify(p)}`);
      }
    }
    if (expected) {
      if (on.string !== expected || on.extraStrings.length || on.newPages.length) report.failures.push(`${kase.name}: on ${JSON.stringify(on.string)}/${JSON.stringify(on.newPages)} != ${JSON.stringify(expected)}`);
    } else if (!same(on, gone)) {
      report.failures.push(`${kase.name}: on ${JSON.stringify(on.string)}/${JSON.stringify(on.extraStrings)} != gone ${JSON.stringify(gone.string)}/${JSON.stringify(gone.extraStrings)}`);
    }
  }
  await setArm("on");
  report.alias = {};
  for (const kase of ALIAS_CASES) {
    const r = await runAliasCase(kase);
    report.alias[kase.name] = r;
    if (r.newPages?.length && !kase.mayCreatePage) report.failures.push(`${kase.name}: created ${r.newPages}`);
    if (kase.on && (r.string !== kase.on || r.newPages.length)) report.failures.push(`${kase.name}: ${JSON.stringify(r.string)} != ${JSON.stringify(kase.on)} rows ${JSON.stringify(r.before?.rows)}`);
    if (kase.expectRows != null && (r.before.rows.length !== kase.expectRows || !r.before.roamAliasesRows)) {
      report.failures.push(`${kase.name}: burrow rows ${r.before.rows.length}, roam-aliases rows ${r.before.roamAliasesRows}`);
    }
  }
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
  await setArm("gone");
  report.cleanup = await cleanupFixture(c, { keep });
  c.close();
}
if (flags.includes("--json")) {
  console.log(JSON.stringify(report, null, 1));
} else if (!only) {
  const caseCount = Object.values(report.arms).reduce((n, a) => n + Object.keys(a).length, 0);
  console.log(`live gate ${configName}: ${report.failures.length ? "FAIL" : "PASS"}`);
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
  for (const [name, r] of Object.entries(report.alias || {})) console.log(`  ${name}: ${JSON.stringify(r.string)}`);
  for (const f of report.failures) console.log(`  FAIL ${f}`);
} else {
  console.log(JSON.stringify(report.arms, null, 1));
}
process.exitCode = report.failures.length ? 1 : 0;
