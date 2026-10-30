#!/usr/bin/env node
// Live gate for "filters search every block" (filterAllBlocks, src/allblocks.js)
// on Roam Desktop over CDP (:9223). Keys are trusted CDP input events into one
// block of the `Burrow/Fixtures` page in the right sidebar. The gate loads the
// build itself per arm; an installed Burrow is parked for the run and put back
// afterwards. It never reloads a window.
//
//   node tools/wide-gate.mjs <window-title-prefix> <svy|notes> [--theme light|dark] [--only "<case name or part of it>"] [--json]
//
// Arms: "on" (every switch on, filterAllBlocks too), "off" (filterAllBlocks
// off) and "gone" (module unloaded). Burrow's wide cache is cleared before every
// case. The fixture page gets four UNREFERENCED blocks (wTodo, wDone, wNote,
// wTask); the gate deletes them at the end and on abort.
// Page-side instrumentation, installed once and removed afterwards (also on
// SIGINT / SIGTERM / a crash): wrappers on api.data.async.search (counts calls,
// can delay replies, can throw once) and api.data.async.pull (counts the
// `:block/_page` page reads), and wrappers on console.warn/error/log/debug.
// Exit code 1 on any FAIL.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect, sleep } from "./cdp.mjs";
import { parkInstalled, unparkInstalled } from "./installed.mjs";
import { cleanupFixture, FIXTURE_PAGE, guardReport, onAbort, placeNormal, primeFixture, setupFixture } from "./fixture.mjs";

const CONFIGS = {
  notes: { real: "((pcr is:todo" },
  // `((watch is:todo` alone ranks 3 referenced TODOs first (refs break ties);
  // `watch logan` reaches the unreferenced `{{[[TODO]]}} Watch [[Logan]]`.
  svy: { real: "((watch logan is:todo", expect: "OWz0k3v1r" },
};
const SEED = "seed αβ 🙂 ";
const TYPE_MS = 35;
const FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pageBoost",
  "aliasInline", "aliasPreselect", "aliasChips", "tabDrill", "paneLayout", "keyHints",
  "rowPreview", "aliasCreate", "aliasDelete", "drillOrdinals", "drillEmpty", "drillCap", "refSearch", "refSearchHotkey",
  "helpTips", "helpSheet", "helpNudge", "refProse", "richRows", "recentRows", "frecency", "queryFilters", "aliasUsage", "aliasPrefix", "semanticRows", "semanticRelated",
  "filterAllBlocks"];
const REF_COMMAND = "Burrow: block reference search";
const ARMS = ["on", "off", "gone"];
const DEBOUNCE_MS = 250;

const [title, graph, ...flags] = process.argv.slice(2);
const config = CONFIGS[graph];
if (!title || !config) throw new Error("usage: wide-gate.mjs <window-title-prefix> <svy|notes> [--theme light|dark] [--only <case>] [--json]");
const flagValue = (name) => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : null; };
const theme = flagValue("--theme");
if (theme && theme !== "light" && theme !== "dark") throw new Error("--theme must be light or dark");
const only = flagValue("--only");
const asJson = flags.includes("--json");
const root = new URL("..", import.meta.url);
const c = await connect(title);
const themeSet = theme ? await c.setTheme(theme) : null;

// The gate's own blocks. Uids are made here so cleanup can delete them even
// when the run dies before they exist.
const UID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const newUid = () => Array.from(randomBytes(9), (b) => UID_CHARS[b % UID_CHARS.length]).join("");
const W = {
  wTodo: { uid: newUid(), string: "{{[[TODO]]}} zebra wombat errand" },
  wDone: { uid: newUid(), string: "{{[[DONE]]}} zebra wombat chore" },
  wNote: { uid: newUid(), string: "zebra wombat note" },
  wTask: { uid: newUid(), string: "{{[[TODO]]}} zebra task wombat" },
};
const WIDE_UIDS = Object.values(W).map((w) => w.uid);
const wUid = (k) => W[k].uid;
let taskTodo = null;

// ---- page-side helpers ----

// Counts search calls (delays or fails them on request), counts the page
// reads, and records console lines.
const instrument = () => c.evaluate(() => {
  const api = window.roamAlphaAPI;
  if (window.__wideGate) return "already";
  const gate = { calls: [], pulls: [], delayMs: 0, throwNext: 0, console: [], origSearch: api.data.async.search, origPull: api.data.async.pull, origConsole: {} };
  api.data.async.search = async function gateSearch(...args) {
    gate.calls.push(String(args[0]?.["search-str"] ?? ""));
    if (gate.throwNext > 0) { gate.throwNext -= 1; throw new Error("wide-gate: forced failure"); }
    if (gate.delayMs) await new Promise((r) => setTimeout(r, gate.delayMs));
    return gate.origSearch.apply(this, args);
  };
  // Burrow's page read is `[:node/title {:block/_page [:block/uid :block/string]}]`.
  // Roam's own pulls with other shapes are not counted.
  api.data.async.pull = function gatePull(...args) {
    const pattern = String(args[0] ?? "");
    if (pattern.includes(":block/_page") && pattern.includes(":block/uid :block/string")) gate.pulls.push(pattern);
    return gate.origPull.apply(this, args);
  };
  for (const m of ["warn", "error", "log", "debug"]) {
    gate.origConsole[m] = console[m];
    console[m] = function gateConsole(...args) {
      if (gate.console.length < 3000) {
        gate.console.push({ m, text: args.map((a) => { try { return typeof a === "string" ? a : JSON.stringify(a); } catch { return String(a); } }).join(" ").slice(0, 300) });
      }
      return gate.origConsole[m].apply(this, args);
    };
  }
  window.__wideGate = gate;
  return "installed";
});

const uninstrument = () => c.evaluate(() => {
  const gate = window.__wideGate;
  if (!gate) return "none";
  const api = window.roamAlphaAPI;
  api.data.async.search = gate.origSearch;
  api.data.async.pull = gate.origPull;
  for (const [m, fn] of Object.entries(gate.origConsole)) console[m] = fn;
  window.__wideGate = null;
  return "removed";
});

const callCount = () => c.evaluate(() => window.__wideGate?.calls.length ?? 0);
const pullCount = () => c.evaluate(() => window.__wideGate?.pulls.length ?? 0);
const consoleCount = () => c.evaluate(() => window.__wideGate?.console.length ?? 0);
const consoleSince = (from) => c.evaluate((from) => (window.__wideGate?.console || []).slice(from), from);
const burrowLines = (lines) => lines.filter((l) => /burrow/i.test(l.text));
const allowedDebug = (l) => l.m === "debug" && l.text.startsWith("[burrow] all-blocks");
const setGate = (field, value) => c.evaluate(({ field, value }) => { if (window.__wideGate) window.__wideGate[field] = value; }, { field, value });

async function prime(seed) {
  let primed = await primeFixture(c, seed);
  if (!primed.ok) {
    await sleep(800);
    primed = await primeFixture(c, seed);
  }
  await c.evaluate(() => {
    const g = window.__burrowFixture;
    g.titleSet = new Set(window.roamAlphaAPI.q("[:find [?t ...] :where [?p :node/title ?t]]"));
    window.__BURROW?.wide?.clear();
  });
  return primed;
}

// The case's stored string, blocks and pages (live-gate's readBack): wait for
// the save, delete what the run made, empty the fixture block. The gate's own
// blocks are in keepAll, so they stay.
async function readBack() {
  await sleep(150);
  const guarded = await guardReport(c);
  const result = await c.evaluate(async () => {
    const api = window.roamAlphaAPI;
    const g = window.__burrowFixture;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (document.activeElement?.tagName === "TEXTAREA") document.activeElement.blur();
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
    const all = api.q(`[:find [?u ...] :where [?p :block/uid "${g.pageUid}"] [?b :block/page ?p] [?b :block/uid ?u]]`) || [];
    const extra = all.filter((u) => u !== g.blockUid && !g.keepAll.includes(u));
    const extraStrings = extra.map((u) => api.q(`[:find ?s . :where [?b :block/uid "${u}"] [?b :block/string ?s]]`)).sort();
    for (const u of extra) string = string.split(`((${u}))`).join("((<new>))");
    for (const u of extra) await api.data.block.delete({ block: { uid: u } });
    await api.data.block.update({ block: { uid: g.blockUid, string: "" } });
    for (let t0 = performance.now(); performance.now() - t0 < 1500;) {
      if (api.q(`[:find ?s . :where [?b :block/uid "${g.blockUid}"] [?b :block/string ?s]]`) === "") break;
      await sleep(40);
    }
    const titles = new Set(api.q("[:find [?t ...] :where [?p :node/title ?t]]"));
    const newPages = [...titles].filter((t) => !g.titleSet.has(t)).filter(Boolean);
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

// One compact look at the picker: Burrow's rows (as drawn), phase, the active
// row, the filter label and the wide debug object. The Related band is not
// counted: it has its own rows.
const look = () => c.evaluate(() => {
  const b = window.__BURROW;
  const drawn = [...document.querySelectorAll(".burrow-strip:not([hidden]) .burrow-row")].filter((n) => !n.closest(".burrow-related"));
  const rows = drawn.length ? (b?.state.rows || []) : [];
  const owned = b?.state.phase === "OWNED";
  const w = b?.wide;
  return {
    popup: Boolean(document.querySelector(".rm-autocomplete__results")),
    phase: b?.state.phase ?? "gone",
    drawn: drawn.length,
    uids: rows.map((r) => r.uid),
    wideUids: rows.filter((r) => r.wide).map((r) => r.uid),
    activeIndex: drawn.findIndex((n) => n.classList.contains("burrow-active")),
    activeUid: owned ? rows[b.state.active]?.uid ?? null : null,
    filters: document.querySelector(".burrow-strip:not([hidden]) .burrow-filters")?.textContent ?? null,
    wide: w ? { enabled: w.enabled, inFlight: w.inFlight, lastKey: w.lastKey, cacheSize: w.cacheSize, lastMs: w.lastMs, failed: w.failed } : null,
  };
});

// Types a query; returns the time of its last character.
async function typeQuery(query) {
  await c.type(query.slice(0, -1), TYPE_MS);
  await c.type(query.slice(-1), 0);
  return Date.now();
}

async function settleStrip() {
  for (let t0 = Date.now(); Date.now() - t0 < 2000;) {
    const ready = await c.evaluate(() => Boolean(document.querySelector(".rm-autocomplete__results")
      && window.__BURROW && window.__BURROW.state.phase !== "IDLE" && document.querySelector(".burrow-strip:not([hidden]) .burrow-row")));
    if (ready) break;
    await sleep(30);
  }
  await sleep(60);
}

// The wide reply: at least 300 ms after the last key (the pause is 250 ms),
// nothing in flight, and the rows unchanged for 400 ms. Returns false when the
// limit ran out first.
async function waitWide(tLastKey, limit = 4000) {
  const t0 = Date.now();
  let sig = null;
  let changed = Date.now();
  while (Date.now() - t0 < limit) {
    const s = await c.evaluate(() => {
      const b = window.__BURROW;
      return { inFlight: Boolean(b?.wide?.inFlight), sig: JSON.stringify([b?.state.phase, b?.state.active, (b?.state.rows || []).map((r) => r.uid)]) };
    });
    if (s.sig !== sig) { sig = s.sig; changed = Date.now(); }
    const now = Date.now();
    if (now - tLastKey >= DEBOUNCE_MS + 50 && !s.inFlight && now - changed >= 400) return true;
    await sleep(60);
  }
  return false;
}

const key = async (k) => { await c.key(k); await sleep(120); };

async function setArm(arm) {
  const code = await readFile(new URL("extension.js", root), "utf8");
  const css = await readFile(new URL("extension.css", root), "utf8");
  const result = await c.evaluate(async ({ arm, code, css, features, refCommand }) => {
    const dev = window.__burrowDev || (window.__burrowDev = { values: {} });
    if (arm === "gone") {
      if (dev.module) await dev.module.default.onunload();
      dev.module = null;
      document.getElementById("burrow-dev-css")?.remove();
      const leftovers = document.querySelectorAll(".burrow-strip, .burrow-hints, .burrow-hud, .burrow-related, .burrow-owning, .rm-autocomplete__results [class*=burrow-]").length;
      if (leftovers) throw new Error(`${leftovers} Burrow node(s) left after unload`);
      return { arm, leftovers };
    }
    for (const f of features) dev.values[f] = true;
    if (arm === "off") dev.values.filterAllBlocks = false;
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
    return { arm, refs: window.__BURROW?.indexes?.refs?.entries.length, wide: window.__BURROW?.wide ? { enabled: window.__BURROW.wide.enabled } : null };
  }, { arm, code, css, features: FEATURES, refCommand: REF_COMMAND });
  if (arm !== "gone" && !result.wide) throw new Error("window.__BURROW.wide is missing: this build has no filterAllBlocks");
  if (arm === "on" && !result.wide.enabled) throw new Error("filterAllBlocks is not on in arm on");
  if (arm === "off" && result.wide.enabled) throw new Error("filterAllBlocks is still on in arm off");
  return result;
}

// The gate's unreferenced blocks, under the fixture page; kept by readBack.
async function createWideBlocks() {
  await c.evaluate(async ({ blocks }) => {
    const api = window.roamAlphaAPI;
    const g = window.__burrowFixture;
    for (const { uid, string } of blocks) {
      await api.data.block.create({ location: { "parent-uid": g.pageUid, order: "last" }, block: { string, uid } });
      g.keepAll.push(uid);
    }
  }, { blocks: Object.values(W) });
  // Burrow reads through Roam's search: wait until it can see the newest block.
  const found = await c.evaluate(async ({ uid, string }) => {
    const gate = window.__wideGate;
    const query = string.replace(/\{\{\[\[TODO\]\]\}\}\s*/, "");
    for (let t0 = performance.now(); performance.now() - t0 < 15000;) {
      const hits = await gate.origSearch.call(window.roamAlphaAPI.data.async, { "search-str": query, "search-pages": false, "search-blocks": true, limit: 100 });
      if ((hits || []).some((h) => h?.[":block/uid"] === uid)) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }, W.wTodo);
  if (!found) throw new Error("Roam's search did not return the gate's block within 15 s");
}

const deleteWideBlocks = () => c.evaluate(async (uids) => {
  const api = window.roamAlphaAPI;
  for (const uid of uids) {
    if (api.q(`[:find ?e . :where [?e :block/uid "${uid}"]]`)) await api.data.block.delete({ block: { uid } });
  }
}, WIDE_UIDS).catch(() => {});

const sameResult = (a, b) => a.string === b.string && JSON.stringify(a.extraStrings) === JSON.stringify(b.extraStrings) && JSON.stringify(a.newPages) === JSON.stringify(b.newPages);
const show = (r) => `${JSON.stringify(r.string)}/${JSON.stringify(r.extraStrings)}/${JSON.stringify(r.newPages)}`;
const errors = (results) => Object.entries(results).filter(([, r]) => r?.error).map(([arm, r]) => `${arm}: ${r.error}`);
const wideOf = (uids) => uids.filter((u) => WIDE_UIDS.includes(u));

// One popup: prime, type, wait for the wide reply, look, close and read back.
// Returns the look, the search calls and page reads it caused, and the stored string.
async function popup(query, { limit, keys = ["Escape"] } = {}) {
  const primed = await prime(SEED);
  if (!primed.ok) return { error: "focus failed" };
  const calls0 = await callCount();
  const pulls0 = await pullCount();
  const t = await typeQuery(query);
  const settled = await waitWide(t, limit);
  const s = await look();
  const result = { s, settled, calls: (await callCount()) - calls0, pulls: (await pullCount()) - pulls0 };
  for (const k of keys) await key(k);
  result.out = await readBack();
  return result;
}

// ---- cases ----
// Each case: { name, graphs, arms, run(arm) -> result, verdict(resultsByArm) -> { failures, detail } }.

const NAMES = {
  todo: "wide: is:todo finds an unreferenced task",
  done: "wide: is:done",
  page: "wide: in:<FIXTURE_PAGE> reads the page, not search",
  here: "wide: in:here",
  ns: "wide: ns:Burrow/",
  none: "wide: no filter reads nothing",
  late: "wide: referenced first, the reply keeps the highlight",
  enter: "wide: a wide row is never pre-selected; Enter is Roam's",
  escape: "wide: Escape byte-for-byte",
  failure: "wide: a failed read stops reads until the popup closes",
  real: `wide: ${config.real} (real data)`,
  noise: "wide: no console noise",
};

const detailOf = (r) => `rows ${JSON.stringify(r.s.uids)}, ${r.calls} search call(s), ${r.pulls} page read(s)${r.settled ? "" : ", reply not settled"}`;

async function todoRun(arm) {
  return popup("((zebra wombat is:todo");
}
function todoVerdict(results) {
  const failures = errors(results);
  const detail = [];
  const { on, off } = results;
  if (on && !on.error) {
    const w = wideOf(on.s.uids);
    detail.push(`on: ${detailOf(on)}, filter label ${JSON.stringify(on.s.filters)}`);
    if (!w.includes(wUid("wTodo"))) failures.push(`on: wTodo is not a row: ${detailOf(on)}`);
    if (w.includes(wUid("wDone")) || w.includes(wUid("wNote"))) failures.push(`on: wDone or wNote is a row: ${detailOf(on)}`);
    if (!on.s.filters) failures.push("on: no filter label shown");
    if (on.calls < 1) failures.push(`on: no search call: ${detailOf(on)}`);
  }
  if (off && !off.error) {
    detail.push(`off: ${detailOf(off)}`);
    if (off.s.uids.length) failures.push(`off: Burrow rows ${JSON.stringify(off.s.uids)}`);
    if (off.calls) failures.push(`off: ${off.calls} search call(s)`);
  }
  return { failures, detail: detail.join("; ") };
}

async function doneRun() { return popup("((zebra wombat is:done"); }
function doneVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const w = wideOf(on.s.uids);
  if (w.length !== 1 || w[0] !== wUid("wDone")) failures.push(`want wDone only among the gate's blocks, got ${JSON.stringify(w)}: ${detailOf(on)}`);
  return { failures, detail: detailOf(on) };
}

// Three of the four blocks fit (3 rows at most); wTask matches the words too, so
// which three the ranking keeps is not judged.
function threeVerdict({ on }, expectSearch) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const w = wideOf(on.s.uids);
  if (w.length !== 3) failures.push(`want 3 of the gate's blocks as rows, got ${JSON.stringify(w)}: ${detailOf(on)}`);
  if (!expectSearch) {
    if (on.calls) failures.push(`${on.calls} search call(s); the page is read, not searched`);
    if (on.pulls < 1) failures.push("no page read (:block/_page pull)");
  }
  const named = [wUid("wTodo"), wUid("wDone"), wUid("wNote")].filter((u) => !w.includes(u));
  const detail = `${detailOf(on)}${named.length ? `; of wTodo/wDone/wNote missing: ${named.length} (wTask took the place)` : ""}`;
  if (named.length && !w.includes(wUid("wTask"))) failures.push(`wTodo/wDone/wNote not all rows and wTask is not either: ${detail}`);
  return { failures, detail };
}
async function pageRun() { return popup(`((zebra wombat in:${FIXTURE_PAGE}`); }
async function hereRun() { return popup("((zebra wombat in:here"); }

async function nsRun() { return popup("((zebra wombat note ns:Burrow/"); }
function nsVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  if (!wideOf(on.s.uids).includes(wUid("wNote"))) failures.push(`wNote is not a row: ${detailOf(on)}`);
  return { failures, detail: detailOf(on) };
}

async function noneRun() {
  return { plain: await popup("((zebra wombat"), exclusion: await popup("((zebra wombat -chore") };
}
function noneVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  for (const [label, r] of Object.entries(on)) {
    if (r.error) { failures.push(`${label}: ${r.error}`); continue; }
    if (r.calls) failures.push(`${label}: ${r.calls} search call(s)`);
    if (label === "plain" && r.pulls) failures.push(`${label}: ${r.pulls} page read(s)`);
    if (label === "plain" && wideOf(r.s.uids).length) failures.push(`${label}: rows from the gate's blocks ${JSON.stringify(wideOf(r.s.uids))}`);
  }
  return { failures, detail: `plain: ${detailOf(on.plain)}; -chore: ${on.exclusion.calls} search call(s)` };
}

// The reply is held back 1500 ms, so the strip can be looked at before and after.
async function lateRun() {
  const primed = await prime(SEED);
  if (!primed.ok) return { error: "focus failed" };
  await setGate("delayMs", 1500);
  try {
    const t = await typeQuery("((zebra task is:todo");
    await settleStrip();
    const before = await look();
    const settled = await waitWide(t, 8000);
    const after = await look();
    let walked = 0;
    let at = after;
    while (at.activeUid !== wUid("wTask") && walked < 6) {
      await key("ArrowDown");
      walked += 1;
      at = await look();
    }
    await key("Enter");
    const out = await readBack();
    return { before, after, at, settled, walked, out };
  } finally {
    await setGate("delayMs", 0);
  }
}
function lateVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const { before, after, at, out } = on;
  const detail = `before: ${JSON.stringify(before.uids)} active ${before.activeIndex}; after: ${JSON.stringify(after.uids)} active ${after.activeIndex}; stored ${JSON.stringify(out.string)}`;
  if (before.activeUid !== taskTodo || before.activeIndex !== 0 || before.uids[0] !== taskTodo) failures.push(`before the reply taskTodo is not the pre-selected row 0: ${detail}`);
  if (before.wideUids.length) failures.push(`wide rows before the reply: ${detail}`);
  if (after.uids[0] !== taskTodo) failures.push(`taskTodo is not row 0 after the reply: ${detail}`);
  if (!after.uids.includes(wUid("wTask")) || after.uids.indexOf(wUid("wTask")) < 1) failures.push(`wTask is not a row after taskTodo: ${detail}`);
  if (after.activeUid !== taskTodo || after.activeIndex !== 0 || after.phase !== "OWNED") failures.push(`the reply moved the highlight (phase ${after.phase}): ${detail}`);
  if (at.activeUid !== wUid("wTask")) failures.push(`ArrowDown never reached wTask: ${detail}`);
  const want = `${SEED}((${wUid("wTask")}))`;
  if (out.string !== want || out.extraStrings.length || out.newPages.length) failures.push(`Enter: ${show(out)} != ${JSON.stringify(want)}`);
  return { failures, detail };
}

async function enterRun() { return popup("((zebra wombat errand is:todo", { keys: ["Enter"] }); }
function enterVerdict(results) {
  const failures = errors(results);
  const detail = [];
  const { on } = results;
  if (on && !on.error) {
    detail.push(`on: ${detailOf(on)}, phase ${on.s.phase}`);
    if (!wideOf(on.s.uids).includes(wUid("wTodo"))) failures.push(`on: wTodo is not a row, so the case did not exercise a wide row: ${detailOf(on)}`);
    if (on.s.phase === "OWNED" || on.s.activeUid != null) failures.push(`on: a Burrow row is active (phase ${on.s.phase}, ${on.s.activeUid})`);
  }
  for (const peer of ["off", "gone"]) {
    if (on && results[peer] && !on.error && !results[peer].error && !sameResult(on, results[peer])) failures.push(`on ${show(on)} != ${peer} ${show(results[peer])}`);
  }
  if (results.off && results.gone && !results.off.error && !results.gone.error && !sameResult(results.off, results.gone)) failures.push(`off ${show(results.off)} != gone ${show(results.gone)}`);
  detail.push(Object.entries(results).filter(([, r]) => !r.error).map(([arm, r]) => `${arm} ${JSON.stringify(r.out.string)}`).join(", "));
  return { failures, detail: detail.join("; ") };
}

async function escapeRun() { return popup("((zebra wombat is:todo", { keys: ["Escape"] }); }
function escapeVerdict(results) {
  const failures = errors(results);
  const { on } = results;
  for (const peer of ["off", "gone"]) {
    if (on && results[peer] && !on.error && !results[peer].error && !sameResult(on.out, results[peer].out)) failures.push(`on ${show(on.out)} != ${peer} ${show(results[peer].out)}`);
  }
  if (on && !on.error && !wideOf(on.s.uids).includes(wUid("wTodo"))) failures.push(`on: wTodo is not a row, so Escape did not close a wide row: ${detailOf(on)}`);
  return { failures, detail: Object.entries(results).filter(([, r]) => !r.error).map(([arm, r]) => `${arm} ${JSON.stringify(r.out.string)}`).join(", ") };
}

async function failureRun() {
  try {
    let primed = await prime(SEED);
    if (!primed.ok) return { error: "focus failed" };
    const base = await callCount();
    const log0 = await consoleCount();
    await setGate("throwNext", 1);
    const t = await typeQuery("((zebra wombat is:todo");
    await waitWide(t);
    const s1 = await look();
    const calls1 = (await callCount()) - base;
    await c.type(" x", TYPE_MS);
    await sleep(900);
    const s2 = await look();
    const calls2 = (await callCount()) - base;
    const debug = burrowLines(await consoleSince(log0));
    await c.key("Escape");
    await readBack();
    primed = await prime(SEED);
    if (!primed.ok) return { error: "focus failed on reopen" };
    const t2 = await typeQuery("((zebra wombat is:todo");
    await waitWide(t2);
    const s3 = await look();
    await c.key("Escape");
    const out = await readBack();
    return { s1, s2, s3, calls1, calls2, debug, out };
  } finally {
    await setGate("throwNext", 0);
  }
}
function failureVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const detail = `calls ${on.calls1} then ${on.calls2}, failed ${on.s1.wide?.failed}, debug ${JSON.stringify(on.debug.map((l) => l.text))}; reopened rows ${JSON.stringify(on.s3.uids)}`;
  if (wideOf(on.s1.uids).length || wideOf(on.s2.uids).length) failures.push(`wide rows after the failed read: ${detail}`);
  if (!on.s1.wide?.failed) failures.push(`__BURROW.wide.failed is not true: ${detail}`);
  if (on.calls1 !== 1 || on.calls2 !== 1) failures.push(`want one search call in the popup, got ${on.calls1} then ${on.calls2}`);
  if (on.debug.length !== 1 || !allowedDebug(on.debug[0]) || !on.debug[0].text.includes("all-blocks read failed")) failures.push(`want exactly one console.debug "[burrow] all-blocks read failed" line, got ${JSON.stringify(on.debug)}`);
  if (!wideOf(on.s3.uids).includes(wUid("wTodo"))) failures.push(`a new popup did not read again (wTodo missing): ${detail}`);
  if (on.out.extraStrings.length || on.out.newPages.length) failures.push(`block/page created: ${show(on.out)}`);
  return { failures, detail };
}

// Real data, read-only: every row must be an open TODO; unreferenced ones are the point.
async function realRun() {
  const r = await popup(config.real, { limit: 8000, keys: [] });
  if (r.error) return r;
  const facts = await c.evaluate((uids) => {
    const api = window.roamAlphaAPI;
    return uids.map((uid) => {
      const string = api.q(`[:find ?s . :where [?b :block/uid "${uid}"] [?b :block/string ?s]]`) ?? "";
      const refs = api.q("[:find (count ?r) . :in $ ?u :where [?b :block/uid ?u] [?r :block/refs ?b]]", uid) || 0;
      // The first task macro decides, as Burrow's taskState does.
      const m = /\{\{(?:\[\[)?(TODO|DONE)(?:\]\])?\}\}/.exec(string);
      return { uid, open: m?.[1] === "TODO", refs, head: string.slice(0, 60) };
    });
  }, r.s.uids);
  await c.key("Escape");
  r.out = await readBack();
  return { ...r, facts };
}
function realVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const bad = on.facts.filter((f) => !f.open);
  const unref = on.facts.filter((f) => f.refs === 0);
  const detail = `${on.facts.length} row(s), ${unref.length} unreferenced, ${on.calls} search call(s)${on.settled ? "" : ", reply not settled"}`;
  if (bad.length) failures.push(`not open TODOs: ${JSON.stringify(bad)}`);
  if (graph === "svy" && !unref.length) failures.push(`no unreferenced row: ${detail}`);
  if (config.expect && !on.facts.some((f) => f.uid === config.expect)) failures.push(`${config.expect} is not a row: ${detail}`);
  return { failures, detail };
}

async function noiseRun() {
  const log0 = await consoleCount();
  let popups = 0;
  for (const query of ["((zebra wombat is:todo", "((zebra wombat", "((zebra wombat in:here"]) {
    const primed = await prime(SEED);
    if (!primed.ok) return { error: "focus failed" };
    const t = await typeQuery(query);
    await waitWide(t);
    await c.key("Escape");
    await readBack();
    popups += 1;
  }
  return { popups, mine: await consoleSince(log0), whole: await consoleSince(0) };
}
function noiseVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const mineBurrow = burrowLines(on.mine);
  const wholeBurrow = burrowLines(on.whole);
  // Only the failure case may print: one line per run of it.
  const allowedMax = wanted.some((k) => k.name === NAMES.failure) ? 1 : 0;
  const detail = `${on.popups} popups, ${mineBurrow.length} Burrow line(s) in them; ${wholeBurrow.length} Burrow line(s) in the whole run (${on.mine.length - mineBurrow.length} other line(s) in the popups are Roam's, not judged)`;
  if (mineBurrow.length) failures.push(`Burrow console output in the quiet popups: ${JSON.stringify(mineBurrow)}`);
  const stray = wholeBurrow.filter((l) => !allowedDebug(l));
  if (stray.length) failures.push(`Burrow console output other than the all-blocks debug line: ${JSON.stringify(stray)}`);
  if (wholeBurrow.filter(allowedDebug).length > allowedMax) failures.push(`more than ${allowedMax} all-blocks debug line(s) in the run: ${JSON.stringify(wholeBurrow)}`);
  return { failures, detail };
}

const CASES = [
  { name: NAMES.todo, graphs: ["svy", "notes"], arms: ["on", "off"], run: todoRun, verdict: todoVerdict },
  { name: NAMES.done, graphs: ["svy", "notes"], arms: ["on"], run: doneRun, verdict: doneVerdict },
  { name: NAMES.page, graphs: ["svy", "notes"], arms: ["on"], run: pageRun, verdict: (r) => threeVerdict(r, false) },
  { name: NAMES.here, graphs: ["svy", "notes"], arms: ["on"], run: hereRun, verdict: (r) => threeVerdict(r, false) },
  { name: NAMES.ns, graphs: ["svy", "notes"], arms: ["on"], run: nsRun, verdict: nsVerdict },
  { name: NAMES.none, graphs: ["svy", "notes"], arms: ["on"], run: noneRun, verdict: noneVerdict },
  { name: NAMES.late, graphs: ["svy", "notes"], arms: ["on"], run: lateRun, verdict: lateVerdict },
  { name: NAMES.enter, graphs: ["svy", "notes"], arms: ["on", "off", "gone"], run: enterRun, verdict: enterVerdict },
  { name: NAMES.escape, graphs: ["svy", "notes"], arms: ["on", "off", "gone"], run: escapeRun, verdict: escapeVerdict },
  { name: NAMES.failure, graphs: ["svy", "notes"], arms: ["on"], run: failureRun, verdict: failureVerdict },
  { name: NAMES.real, graphs: ["svy", "notes"], arms: ["on"], run: realRun, verdict: realVerdict },
  { name: NAMES.noise, graphs: ["svy", "notes"], arms: ["on"], run: noiseRun, verdict: noiseVerdict },
];

const wanted = CASES.filter((k) => k.graphs.includes(graph)).filter((k) => !only || k.name.toLowerCase().includes(only.toLowerCase()));
if (only && !wanted.length) {
  throw new Error(`unknown case ${JSON.stringify(only)}; names: ${CASES.filter((k) => k.graphs.includes(graph)).map((k) => JSON.stringify(k.name)).join(", ")}`);
}

// ---- run ----

const report = { window: c.page.title, graph, theme, themeSet };
let cleaning = null;
const cleanup = () => (cleaning ||= (async () => {
  try {
    await placeNormal(c).catch(() => {});
    await setArm("gone");
    await deleteWideBlocks();
    report.cleanup = await cleanupFixture(c);
  } catch (error) {
    console.error("cleanup:", error);
  } finally {
    try {
      await uninstrument();
      report.restored = await unparkInstalled(c);
      if (theme) report.themeRestored = await c.setTheme(null);
    } catch (error) {
      console.error("cleanup:", error);
    }
    c.close();
  }
})());
onAbort(cleanup);

await c.evaluate(async () => {
  const dev = window.__burrowDev;
  if (dev?.module) { await dev.module.default.onunload(); dev.module = null; }
  document.getElementById("burrow-gate-low")?.remove();
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
await instrument();
// The drill tree brings the referenced task `taskTodo` ("zebra task open").
const fixture = await setupFixture(c, { drillTree: true }).catch(async (error) => { await uninstrument(); await unparkInstalled(c); throw error; });
taskTodo = fixture.drill.taskTodo;

const results = new Map(wanted.map((k) => [k.name, {}]));
let fatal = null;
try {
  await createWideBlocks();
  for (const arm of ARMS) {
    const here = wanted.filter((k) => k.arms.includes(arm));
    if (!here.length) continue;
    await setArm(arm);
    for (const kase of here) {
      process.stderr.write(`arm ${arm}: ${kase.name}\n`);
      try {
        results.get(kase.name)[arm] = await kase.run(arm);
      } catch (error) {
        results.get(kase.name)[arm] = { error: String(error?.message || error) };
      }
    }
  }
} catch (error) {
  console.error("wide gate failed:", error);
  fatal = String(error?.message || error);
} finally {
  await cleanup();
}

let passed = 0;
const lines = [];
const summary = [];
for (const kase of wanted) {
  const { failures, detail } = fatal && !Object.keys(results.get(kase.name)).length
    ? { failures: [`not run: ${fatal}`], detail: "" }
    : kase.verdict(results.get(kase.name));
  if (!failures.length) passed += 1;
  summary.push({ name: kase.name, ok: !failures.length, detail: detail || "", failures });
  lines.push(`${failures.length ? "FAIL" : "PASS"} ${kase.name}${detail ? `: ${detail}` : ""}`);
  for (const f of failures) lines.push(`    ${f}`);
}
const ok = passed === wanted.length && !fatal && (!report.installed.parked || report.restored?.restored);
const installedLine = report.installed.parked ? `installed Burrow: parked ${report.installed.version} for the run, ${report.restored?.restored ? "restored" : "NOT restored"}` : "installed Burrow: none in this window";
if (asJson) {
  console.log(JSON.stringify({ gate: "wide-gate", graph, theme, ok, passed, total: wanted.length, fatal, installed: installedLine, cases: summary }, null, 2));
} else {
  for (const line of lines) console.log(line);
  console.log(`wide-gate ${graph}${theme ? ` (${theme})` : ""}: ${ok ? "PASS" : "FAIL"} (${passed}/${wanted.length})${fatal ? `; error: ${fatal}` : ""}`);
  console.log(`  ${installedLine}`);
}
process.exitCode = ok ? 0 : 1;
