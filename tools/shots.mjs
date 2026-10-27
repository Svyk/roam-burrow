#!/usr/bin/env node
// Before/after screenshots of the picker for a human report, on a live Roam
// Desktop window over CDP (:9223). Loads a build with every switch on, sets
// the fixture up, and for each scenario primes the fixture block, runs its
// keys, waits, and saves a PNG clipped to the textarea, the popover and every
// visible Burrow node. It never presses Enter on a write prompt, so no alias
// is ever written. Roam's preview is put back as found; an installed Burrow
// is parked and restored; the theme override, the fixture and any page the
// typing caused are removed, also on SIGINT / SIGTERM / a crash.
//
//   node tools/shots.mjs <window> <svy|notes> --label <before|after> --theme <light|dark> [--code <extension.js>] [--css <extension.css>] [--out <dir>] [--only 16,21]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connect, sleep } from "./cdp.mjs";
import { parkInstalled, unparkInstalled } from "./installed.mjs";
import { CHIP_ALIASES, FIXTURE_PAGE, cleanupFixture, deleteNewPages, guardReport, onAbort, placeLow, placeNormal, primeFixture, setupFixture, snapshotTitles } from "./fixture.mjs";

const GRAPHS = {
  // block: Svy's 0.5.0 test query (2026-10-22), on a page of TODO/DONE blocks in svy.
  svy: { alias: "[[lorina", listed: "[[lorinator", ref: "ant man", block: "agents of s", black: "black pan", filtered: "watch is:todo" },
  notes: { alias: "[[mike kh", listed: "[[mike khi", ref: "real time pcr", block: "real time pcr", filtered: "pcr in:PhD/Cronobacter & Spore Control in PIF" },
};
// 0.5.0 help switches and 0.6.0 block navigation; the first-run line is marked seen except in its own shot.
const HELP = ["helpTips", "helpSheet", "helpNudge", "refContext", "refOutline"];
const SEED = "seed αβ 🙂 ";
const TYPE_MS = 35;
const REF_COMMAND = "Burrow: block reference search";
const FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pageBoost",
  "aliasInline", "aliasPreselect", "aliasChips", "tabDrill", "paneLayout", "keyHints",
  "rowPreview", "aliasCreate", "aliasDelete", "drillOrdinals", "drillEmpty", "drillCap", "refSearch", "refSearchHotkey", ...HELP, "refProse", "richRows", "queryFilters"];

const [title, graph, ...flags] = process.argv.slice(2);
const config = GRAPHS[graph];
if (!title || !config) throw new Error("usage: shots.mjs <window> <svy|notes> --label <before|after> --theme <light|dark> [--code <file>] [--css <file>] [--out <dir>]");
const flagValue = (name) => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : null; };
const label = flagValue("--label") || "after";
const theme = flagValue("--theme");
if (theme && theme !== "light" && theme !== "dark") throw new Error("--theme must be light or dark");
const root = new URL("..", import.meta.url);
const codePath = flagValue("--code") ? resolve(flagValue("--code")) : new URL("extension.js", root).pathname;
const cssPath = flagValue("--css") ? resolve(flagValue("--css")) : new URL("extension.css", root).pathname;
const outDir = resolve(flagValue("--out") || join(tmpdir(), "burrow-shots"));
const chipsQuery = `[[${CHIP_ALIASES[0].slice(0, 9)}`;
// --only 16,21: the scenarios whose id starts with one of these.
const only = flagValue("--only")?.split(",").filter(Boolean) ?? null;

const SCENARIOS = [
  { id: "01-alias-row", query: config.alias, keys: [] },
  { id: "02-chips", query: config.alias, keys: ["alt+ArrowDown"] },
  { id: "03-chips-wheel", query: chipsQuery, keys: ["wheel:chips:600"] },
  { id: "04-long-alias", query: chipsQuery, keys: ["alt+ArrowDown", ...Array(8).fill("ArrowRight")] },
  { id: "05-row-preview", query: config.alias, keys: ["preview-open"] },
  { id: "06-tab-drill", query: `[[${FIXTURE_PAGE}`, keys: ["Tab"], loose: true },
  { id: "07-ordinal", query: `[[${FIXTURE_PAGE}`, keys: ["Tab", "type:steps", "Tab", "type:2"], loose: true },
  { id: "08-empty", query: `[[${FIXTURE_PAGE}`, keys: ["Tab", "type:hollow", "Tab"], loose: true },
  { id: "09-more", query: `[[${FIXTURE_PAGE}`, keys: ["Tab", "type:many", "Tab"], loose: true },
  { id: "10-alias-prompt", query: chipsQuery, keys: ["alt+a", "type:zq chip kilo"] },
  { id: "11-delete-confirm", query: chipsQuery, keys: ["alt+ArrowDown", "ArrowRight", "alt+Backspace"] },
  { id: "12-column-band", query: config.listed, keys: [], settings: { aliasInline: false } },
  { id: "13-above", query: config.alias, keys: [], low: true },
  { id: "14-above-drill", query: `[[${FIXTURE_PAGE}`, keys: ["Tab"], low: true, loose: true },
  { id: "15-ref-search", query: "", keys: [`palette:${REF_COMMAND}`, "wait:500", `type:${config.ref}`] },
  // 0.5.0 hint states, key list, first-run line and hover tips.
  { id: "16-hint-roam-page-drill", query: `[[${FIXTURE_PAGE}`, keys: [], loose: true },
  { id: "17-hint-roam-page-leaf", query: `[[${FIXTURE_PAGE} Empty`, keys: [], loose: true, settings: { aliasCreate: false } },
  { id: "18-hint-ref-row", query: `((${config.ref}`, keys: [] },
  { id: "19-hint-drill-row", query: `[[${FIXTURE_PAGE}#alpha > never`, keys: [] },
  { id: "20-hint-rows-above", query: `((${config.ref}`, keys: ["ArrowDown", "ArrowUp"] },
  { id: "21-key-list", query: config.alias, keys: ["alt+slash"] },
  { id: "22-key-list-writes-off", query: config.alias, keys: ["alt+slash"], settings: { aliasCreate: false, aliasDelete: false } },
  { id: "23-key-list-in-drill", query: `[[${FIXTURE_PAGE}`, keys: ["Tab", "alt+slash"], loose: true },
  { id: "24-first-run-line", query: config.alias, keys: [], settings: { helpNudgeSeen: false } },
  { id: "25-tip-alias-row", query: config.alias, keys: ["hover:.burrow-strip .burrow-row", "wait:700"] },
  { id: "26-tip-chip", query: config.alias, keys: ["alt+ArrowDown", "hover:.burrow-chips .burrow-chip", "wait:700"] },
  { id: "27-tip-preview", query: config.alias, keys: ["preview-open", "wait:500", "hover:.burrow-preview .burrow-trail", "wait:700"] },
  { id: "28-tip-hint", query: config.alias, keys: ["hover:.burrow-hints .burrow-hint", "wait:700"] },
  { id: "29-tip-help-button", query: config.alias, keys: ["hover:.burrow-hints .burrow-help-button", "wait:700"] },
  { id: "30-prompt-refused", query: chipsQuery, keys: ["alt+a", "type:issue #42", "Enter"] },
  { id: "31-tip-scope-row", query: `[[${FIXTURE_PAGE}`, keys: ["Tab", "hover:.burrow-scope-list .burrow-row", "wait:700"], loose: true },
  // 0.6.0: (( rows in Roam's list column, tasks, where the block lives, up and down the outline.
  { id: "32-block-rows", query: `((${config.block}`, keys: ["preview-closed"] },
  { id: "33-block-rows-preview", query: `((${config.block}`, keys: ["preview-open", "wait:500"] },
  { id: "34-roam-row-highlighted", query: `((${config.block}`, keys: ["preview-open", "ArrowDown", "ArrowDown", "ArrowDown", "wait:400"] },
  { id: "35-tip-block-row", query: `((${config.block}`, keys: ["preview-closed", "hover:.burrow-strip .burrow-row", "wait:700"] },
  { id: "36-tasks", query: "((zebra task", keys: ["preview-open", "wait:500"] },
  { id: "37-context-line", query: "((never grok", keys: ["preview-closed"] },
  { id: "38-outline-up", query: "((never grok", keys: ["preview-open", "shift+Tab", "wait:400"] },
  { id: "39-outline-up-twice", query: "((never grok", keys: ["preview-open", "shift+Tab", "shift+Tab", "wait:400"] },
  { id: "40-tab-block-children", query: "((never grok", keys: ["preview-open", "Tab", "wait:400"] },
  { id: "41-preview-scrolled", query: "((many 50", keys: ["preview-open", "wait:600"] },
  { id: "42-caret-inside-token", query: `((${config.ref}`, keys: ["preview-closed", "ArrowLeft", "wait:300"] },
  { id: "43-key-list-f1", query: `((${config.ref}`, keys: ["F1"] },
  { id: "44-smartblock-child", query: "((zebra smart", keys: ["preview-open", "wait:500"] },
  { id: "45-smartblock-tab", query: "((zebra smart", keys: ["preview-open", "Tab", "wait:400"] },
  // 0.6.1: the key list over Roam's highlighted row; Enter only closes it.
  { id: "46-roam-row-before-key-list", query: `((${config.ref}`, keys: ["preview-closed", "down-past-strip", "wait:300"] },
  { id: "47-key-list-over-roam-row", query: `((${config.ref}`, keys: ["preview-closed", "down-past-strip", "alt+slash", "wait:300"] },
  { id: "48-key-list-enter-closes", query: `((${config.ref}`, keys: ["preview-closed", "down-past-strip", "alt+slash", "Enter", "wait:400"] },
  // 0.7.0: prose before code in (( (Svy's `((black pan`, svy only), then rows drawn like Roam on the fixture's rich blocks.
  ...(config.black ? [{ id: "49-black-pan", query: `((${config.black}`, keys: ["preview-closed"] }] : []),
  { id: "50-rich-rows", query: "((zebra rich", keys: ["preview-closed"] },
  { id: "51-rich-code", query: "((zebra_plot", keys: ["preview-closed"] },
  { id: "52-rich-macros", query: "((zebra macros", keys: ["preview-closed"] },
  { id: "53-rich-media", query: "((zebra media", keys: ["preview-closed"] },
  { id: "54-rich-snippet", query: "((zebra snippet", keys: ["preview-closed"] },
  { id: "55-rich-preview", query: "((zebra rich", keys: ["preview-open", "wait:500"] },
  { id: "56-rich-scope", query: `[[${FIXTURE_PAGE}`, keys: ["Tab", "wait:400"], loose: true },
  { id: "57-rich-html", query: "((zebra html", keys: ["preview-closed"] },
  // 0.8.0: query filters. The filter line sits above the rows.
  { id: "58-filter-is-todo", query: "((zebra task is:todo", keys: ["preview-closed"] },
  { id: "59-filter-quoted-phrase", query: "((zebra \"quilt pattern\"", keys: ["preview-closed"] },
  { id: "60-filter-real-data", query: `((${config.filtered}`, keys: ["preview-closed"] },
];

const c = await connect(title);

async function setArm(arm) {
  const code = await readFile(codePath, "utf8");
  const css = await readFile(cssPath, "utf8");
  return c.evaluate(async ({ arm, code, css, features, refCommand }) => {
    const dev = window.__burrowDev || (window.__burrowDev = { values: {} });
    if (dev.module) { await dev.module.default.onunload(); dev.module = null; }
    document.getElementById("burrow-dev-css")?.remove();
    if (arm === "gone") return { arm };
    for (const f of features) dev.values[f] = true;
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
      // Only the ref-search entry reaches Roam's palette (see live-gate.mjs).
      ui: {
        commandPalette: {
          addCommand: async (cmd) => (cmd?.label === refCommand ? window.roamAlphaAPI.ui.commandPalette.addCommand(cmd) : null),
          removeCommand: async (cmd) => (cmd?.label === refCommand ? window.roamAlphaAPI.ui.commandPalette.removeCommand(cmd) : null),
        },
      },
    };
    await dev.module.default.onload({ extensionAPI, extension: { version: "shots" } });
    const t0 = performance.now();
    while (!window.__BURROW?.indexes?.refs && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 100));
    return { arm, refs: window.__BURROW?.indexes?.refs?.entries.length };
  }, { arm, code, css, features: FEATURES, refCommand: REF_COMMAND });
}

// ⌥/ as a mac sends it: the key is the typed character "÷".
const altSlash = async () => {
  const base = { key: "÷", code: "Slash", windowsVirtualKeyCode: 191, nativeVirtualKeyCode: 191, modifiers: 1 };
  await c.call("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: "÷", unmodifiedText: "÷" });
  await c.call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
};

const ctrlO = async () => {
  const base = { key: "o", code: "KeyO", windowsVirtualKeyCode: 79, nativeVirtualKeyCode: 79, modifiers: 2 };
  await c.call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await c.call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(300);
};
const isExpanded = () => c.evaluate(() => Boolean(document.querySelector(".rm-autocomplete__results--expanded")));

async function settle(loose) {
  for (let t0 = Date.now(); Date.now() - t0 < 2500;) {
    const ready = await c.evaluate((loose) => {
      if (!document.querySelector(".rm-autocomplete__results")) return false;
      if (loose) return true;
      const b = window.__BURROW;
      return Boolean(b && b.state.phase !== "IDLE" && document.querySelector(".burrow-strip:not([hidden]) .burrow-row"));
    }, loose);
    if (ready) break;
    await sleep(40);
  }
  await sleep(200);
}

async function point(selector, text, exact = false) {
  return c.evaluate(({ selector, text, exact }) => {
    const el = [...document.querySelectorAll(selector)].find((n) => (text == null ? true : exact ? n.textContent.trim() === text : n.textContent.includes(text)));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { selector, text, exact });
}

// The palette input is not the fixture's textarea, so the key guard steps aside while it is open.
async function palette(name) {
  await c.evaluate(() => { window.__burrowFixture.guard.armed = false; });
  try {
    const base = { key: "p", code: "KeyP", windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80, modifiers: 4 };
    await c.call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    await c.call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    for (let t0 = Date.now(); Date.now() - t0 < 3000;) {
      if (await c.evaluate(() => document.activeElement?.tagName === "INPUT")) break;
      await sleep(50);
    }
    await c.type(name, 25);
    await sleep(400);
    await c.key("Enter");
    await sleep(300);
  } finally {
    await c.evaluate(() => { if (window.__burrowFixture) window.__burrowFixture.guard.armed = true; });
  }
}

async function runKeys(keys) {
  for (const k of keys) {
    const modified = k.match(/^(alt|shift)\+(.+)$/);
    if (k === "preview-open") { if (!(await isExpanded())) await ctrlO(); }
    else if (k === "preview-closed") { if (await isExpanded()) await ctrlO(); }
    else if (k === "alt+slash") await altSlash();
    else if (k === "down-past-strip") {
      const rows = await c.evaluate(() => document.querySelectorAll(".burrow-strip:not([hidden]) .burrow-row").length);
      for (let i = 0; i < rows; i++) { await c.key("ArrowDown"); await sleep(60); }
    } else if (k.startsWith("hover:")) {
      const p = await point(k.slice(6), null);
      // From a little to the left, as a hand would come: a jump onto a node
      // that just appeared under a still pointer may fire no mouseover.
      if (p) for (const dx of [-20, 0]) await c.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x + dx, y: p.y });
    }
    else if (k.startsWith("wheel:chips:")) {
      const p = await point(".burrow-chips", null);
      if (p) await c.wheel(p.x, p.y, 0, Number(k.slice(12)));
    } else if (k.startsWith("palette:")) await palette(k.slice(8));
    else if (k.startsWith("wait:")) await sleep(Number(k.slice(5)));
    else if (k.startsWith("type:")) await c.type(k.slice(5), TYPE_MS);
    else if (modified) await c.key(modified[2], modified[1] === "alt" ? 1 : 8);
    else await c.key(k);
    if (!k.startsWith("wait:")) await sleep(120);
  }
}

// Textarea + popover + every visible Burrow node, plus 16 px, inside the viewport.
async function captureRect() {
  return c.evaluate(() => {
    const g = window.__burrowFixture;
    const els = [document.getElementById(g?.inputId), document.querySelector(".rm-autocomplete__results"),
      ...document.querySelectorAll(".burrow-strip:not([hidden]), .burrow-hints:not([hidden]), .burrow-preview:not([hidden]), .burrow-scope:not([hidden]), .burrow-help:not([hidden]), .burrow-tip:not([hidden])")]
      .filter((el) => el?.getClientRects().length);
    if (!els.length) return null;
    const boxes = els.map((el) => el.getBoundingClientRect());
    const left = Math.max(0, Math.min(...boxes.map((b) => b.left)) - 16);
    const top = Math.max(0, Math.min(...boxes.map((b) => b.top)) - 16);
    const right = Math.min(window.innerWidth, Math.max(...boxes.map((b) => b.right)) + 16);
    const bottom = Math.min(window.innerHeight, Math.max(...boxes.map((b) => b.bottom)) + 16);
    return { left, top, width: right - left, height: bottom - top };
  });
}

// Out of the popup, block cleared, and any page the typing made deleted.
async function reset() {
  await c.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  for (let i = 0; i < 3; i++) { await c.key("Escape"); await sleep(150); }
  await guardReport(c);
  await c.evaluate(async () => {
    const g = window.__burrowFixture;
    if (document.activeElement?.tagName === "TEXTAREA") document.activeElement.blur();
    await window.roamAlphaAPI.data.block.update({ block: { uid: g.blockUid, string: "" } });
    await new Promise((r) => setTimeout(r, 400));
  });
  await deleteNewPages(c);
}

const files = [];
let initialPreview = null;
let cleaning = null;
const cleanup = () => (cleaning ||= (async () => {
  try {
    await placeNormal(c).catch(() => {});
    await setArm("gone");
    await cleanupFixture(c);
  } catch (error) {
    console.error("cleanup:", error);
  } finally {
    try {
      await unparkInstalled(c);
      if (theme) await c.setTheme(null);
    } catch (error) {
      console.error("cleanup:", error);
    }
    c.close();
  }
})());
onAbort(cleanup);

if (theme) await c.setTheme(theme);
await c.evaluate(async () => {
  const dev = window.__burrowDev;
  if (dev?.module) { await dev.module.default.onunload(); dev.module = null; }
  document.getElementById("burrow-dev-css")?.remove();
});
const installed = await parkInstalled(c);
if (installed.error) { await cleanup(); throw new Error(installed.error); }
try {
  await mkdir(outDir, { recursive: true });
  await setArm("gone");
  await setupFixture(c, { drillTree: true });
  const loaded = await setArm("on");
  if (!loaded.refs) throw new Error("index not built");
  const stamp = `${label}-${theme || "default"}`;
  for (const scenario of SCENARIOS.filter((x) => !only || only.some((id) => x.id.startsWith(id)))) {
    await c.evaluate((settings) => {
      const values = window.__burrowDev.values;
      for (const f of ["aliasInline", "aliasCreate", "aliasDelete"]) values[f] = true;
      values.helpNudgeSeen = true;
      Object.assign(values, settings || {});
    }, scenario.settings);
    await snapshotTitles(c);
    let primed = await primeFixture(c, SEED);
    if (!primed.ok) { await sleep(800); primed = await primeFixture(c, SEED); }
    if (!primed.ok) { console.error(`${scenario.id}: focus failed, skipped`); continue; }
    if (scenario.low) await placeLow(c);
    try {
      if (scenario.query) {
        await c.type(scenario.query, TYPE_MS);
        await settle(scenario.loose);
        initialPreview ??= await isExpanded();
      }
      await runKeys(scenario.keys);
      await sleep(400);
      const rect = await captureRect();
      if (!rect) { console.error(`${scenario.id}: nothing on screen, skipped`); continue; }
      const file = join(outDir, `${stamp}-${scenario.id}.png`);
      await writeFile(file, await c.screenshot(rect));
      files.push(file);
      console.log(file);
    } finally {
      if (scenario.low) await placeNormal(c);
      await reset();
    }
  }
  // Roam's preview state, as found.
  if (initialPreview != null) {
    const primed = await primeFixture(c, SEED);
    if (primed.ok) {
      await c.type(config.listed, TYPE_MS);
      await settle(true);
      if ((await isExpanded()) !== initialPreview) await ctrlO();
      await reset();
    }
  }
} finally {
  await cleanup();
}
console.log(`${files.length} screenshot(s) in ${outDir}`);
