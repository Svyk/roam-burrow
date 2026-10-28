#!/usr/bin/env node
// Live gate for Burrow 0.8.0's Related band (Roam's semantic search under the
// (( and [[ results) on Roam Desktop over CDP (:9223). Keys are trusted CDP
// input events into one block of the `Burrow/Fixtures` page in the right
// sidebar. The gate loads the build itself per arm; an installed Burrow is
// parked for the run and put back afterwards. It never reloads a window.
//
//   node tools/related-gate.mjs <window-title-prefix> <svy|notes> [--theme light|dark] [--only "<case name or part of it>"]
//
// Arms: "on" (every switch on), "off" (every switch on, semanticRows off),
// "nosem" (on, but roamAlphaAPI.data.semanticSearchEnabled stubbed to false
// for the run) and "gone" (module unloaded). Burrow's Related cache is cleared
// before every case. A semanticSearch call sends the typed text to the graph's
// embedding provider (approved in both graphs).
// Page-side instrumentation, installed once and removed afterwards (also on
// SIGINT / SIGTERM / a crash): a wrapper on api.data.async.semanticSearch that
// counts calls and can throw once, and wrappers on console.warn/error/log/debug.
// Exit code 1 on any FAIL.
import { readFile } from "node:fs/promises";
import { connect, sleep } from "./cdp.mjs";
import { parkInstalled, unparkInstalled } from "./installed.mjs";
import { cleanupFixture, guardReport, onAbort, placeLow, placeNormal, primeFixture, setupFixture } from "./fixture.mjs";

const CONFIGS = {
  notes: {
    query: "((how to stay focused",
    cases: ["acceptance", "dedupe"],
    acceptUid: "755V-VCRJ",
    dedupe: { query: "((real time pcr", uid: "6ZtlGN-Np" },
  },
  svy: {
    query: "((marvel movies in order",
    cases: ["acceptance", "switch off"],
    acceptUids: ["6L3YF9sMB", "1pf_KNjUm"],
  },
};
const SEED = "seed αβ 🙂 ";
const TYPE_MS = 35;
const FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pageBoost",
  "aliasInline", "aliasPreselect", "aliasChips", "tabDrill", "paneLayout", "keyHints",
  "rowPreview", "aliasCreate", "aliasDelete", "drillOrdinals", "drillEmpty", "drillCap", "refSearch", "refSearchHotkey",
  "helpTips", "helpSheet", "helpNudge", "refProse", "richRows", "recentRows", "frecency", "queryFilters", "aliasUsage", "aliasPrefix", "semanticRows"];
const REF_COMMAND = "Burrow: block reference search";
const ARMS = ["on", "off", "nosem", "gone"];

const [title, graph, ...flags] = process.argv.slice(2);
const config = CONFIGS[graph];
if (!title || !config) throw new Error("usage: related-gate.mjs <window-title-prefix> <svy|notes> [--theme light|dark] [--only <case>]");
const flagValue = (name) => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : null; };
const theme = flagValue("--theme");
if (theme && theme !== "light" && theme !== "dark") throw new Error("--theme must be light or dark");
const only = flagValue("--only");
const root = new URL("..", import.meta.url);
const c = await connect(title);
const themeSet = theme ? await c.setTheme(theme) : null;
const QUERY = config.query;
const BODY = QUERY.slice(2);

// ---- page-side helpers ----

// Counts semanticSearch calls (and can throw once) and records console lines.
const instrument = () => c.evaluate(() => {
  const api = window.roamAlphaAPI;
  if (window.__relGate) return "already";
  const gate = { calls: [], throwNext: 0, console: [], origSearch: api.data.async.semanticSearch, origEnabled: api.data.semanticSearchEnabled, origConsole: {} };
  api.data.async.semanticSearch = function gateSearch(...args) {
    gate.calls.push(String(args[0]?.["search-str"] ?? ""));
    if (gate.throwNext > 0) { gate.throwNext -= 1; return Promise.reject(new Error("related-gate: forced failure")); }
    return gate.origSearch.apply(this, args);
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
  window.__relGate = gate;
  return "installed";
});

const uninstrument = () => c.evaluate(() => {
  const gate = window.__relGate;
  if (!gate) return "none";
  const api = window.roamAlphaAPI;
  api.data.async.semanticSearch = gate.origSearch;
  if (gate.origEnabled) api.data.semanticSearchEnabled = gate.origEnabled;
  for (const [m, fn] of Object.entries(gate.origConsole)) console[m] = fn;
  window.__relGate = null;
  return "removed";
});

const callCount = () => c.evaluate(() => window.__relGate?.calls.length ?? 0);
const consoleCount = () => c.evaluate(() => window.__relGate?.console.length ?? 0);
const consoleSince = (from) => c.evaluate((from) => (window.__relGate?.console || []).slice(from), from);
const burrowLines = (lines) => lines.filter((l) => /burrow/i.test(l.text));
const allowedDebug = (l) => l.m === "debug" && l.text.startsWith("[burrow] related");

async function prime(seed) {
  let primed = await primeFixture(c, seed);
  if (!primed.ok) {
    await sleep(800);
    primed = await primeFixture(c, seed);
  }
  await c.evaluate(() => {
    const g = window.__burrowFixture;
    g.titleSet = new Set(window.roamAlphaAPI.q("[:find [?t ...] :where [?p :node/title ?t]]"));
    window.__BURROW?.related?.clear();
  });
  return primed;
}

// The case's stored string, blocks and pages (live-gate's readBack): wait for
// the save, delete what the run made, empty the fixture block.
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

// One compact look at the picker: Roam's rows, Burrow's strip, the Related band.
const shot = () => c.evaluate(() => {
  const b = window.__BURROW;
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const pop = document.querySelector(".rm-autocomplete__results");
  const roam = [...document.querySelectorAll(".rm-autocomplete__results-scroll > div")];
  const strip = [...document.querySelectorAll(".burrow-strip:not([hidden]) .burrow-row")];
  const band = [...document.querySelectorAll(".burrow-related:not([hidden]) .burrow-row")];
  const clear = (n) => { const bg = getComputedStyle(n).backgroundColor; return bg === "rgba(0, 0, 0, 0)" || bg === "transparent"; };
  return {
    popup: Boolean(pop), flipped: pop ? pop.style.bottom === "0px" : null,
    phase: b?.state.phase ?? "gone", active: b?.state.active ?? null, rel: b?.state.rel ?? null,
    roamActive: roam.findIndex((n) => n.style.backgroundColor),
    roamMuted: roam.length > 0 && roam.every(clear),
    roamRects: roam.map(box), stripRects: strip.map(box), roamTexts: roam.map((n) => n.textContent),
    stripUids: (b?.state.rows || []).map((r) => r.uid),
    band: band.map((n) => ({ text: n.textContent.slice(0, 80), active: n.classList.contains("burrow-active") })),
    related: b?.related ? { rows: b.related.rows, inFlight: b.related.inFlight, enabled: b.related.enabled, available: b.related.available, lastQuery: b.related.lastQuery } : null,
    value: document.activeElement?.tagName === "TEXTAREA" ? document.activeElement.value : null,
  };
});

// Wait for the first query of a run: cold (12 s); later ones 6 s. svy: 20 s,
// because Roam re-embeds it often (the gate's own edits too) and Burrow waits
// out "Initial sync in progress" (src/semantic.js, up to 6 x 2 s).
let firstQuery = true;
async function waitBand(ms) {
  const limit = ms ?? (graph === "svy" ? 20000 : firstQuery ? 12000 : 6000);
  firstQuery = false;
  const t0 = Date.now();
  while (Date.now() - t0 < limit) {
    if ((await c.evaluate(() => document.querySelectorAll(".burrow-related:not([hidden]) .burrow-row").length)) > 0) return Date.now() - t0;
    await sleep(40);
  }
  // Why: Burrow's last Related trace events.
  const why = await c.evaluate(() => (window.__BURROW?.debug?.trace || []).filter((e) => e.ev === "related" || e.ev === "reset").slice(-8));
  console.log(`  no band after ${limit} ms; trace: ${JSON.stringify(why)}`);
  return null;
}

// Types a query; returns the time of its last character.
async function typeQuery(query) {
  await c.type(query.slice(0, -1), TYPE_MS);
  await c.type(query.slice(-1), 0);
  return Date.now();
}

async function settleStrip(loose) {
  for (let t0 = Date.now(); Date.now() - t0 < 2000;) {
    const ready = await c.evaluate((loose) => {
      if (!document.querySelector(".rm-autocomplete__results")) return false;
      if (loose) return true;
      return Boolean(window.__BURROW && window.__BURROW.state.phase !== "IDLE" && document.querySelector(".burrow-strip:not([hidden]) .burrow-row"));
    }, loose);
    if (ready) break;
    await sleep(30);
  }
  await sleep(60);
}

// Alt+R as the task gives it: key "r", code KeyR, typed text "®".
const altR = async () => {
  const base = { key: "r", code: "KeyR", windowsVirtualKeyCode: 82, nativeVirtualKeyCode: 82, modifiers: 1 };
  await c.call("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: "®", unmodifiedText: "®" });
  await c.call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(150);
};

const key = async (k) => { await c.key(k); await sleep(120); };

// A case's own settings, put back after.
async function withSettings(arm, settings, fn) {
  if (!settings || arm === "gone") return fn();
  const saved = await c.evaluate((next) => {
    const values = window.__burrowDev.values;
    const old = {};
    for (const [id, value] of Object.entries(next)) { old[id] = values[id]; values[id] = value; }
    return old;
  }, settings);
  try {
    return await fn();
  } finally {
    await c.evaluate((old) => { Object.assign(window.__burrowDev.values, old); }, saved);
  }
}

async function setArm(arm) {
  const code = await readFile(new URL("extension.js", root), "utf8");
  const css = await readFile(new URL("extension.css", root), "utf8");
  const result = await c.evaluate(async ({ arm, code, css, features, refCommand }) => {
    const dev = window.__burrowDev || (window.__burrowDev = { values: {} });
    const gate = window.__relGate;
    const api = window.roamAlphaAPI;
    // The semantic-search stub lives only in the nosem arm.
    if (gate && gate.origEnabled) api.data.semanticSearchEnabled = gate.origEnabled;
    if (arm === "gone") {
      if (dev.module) await dev.module.default.onunload();
      dev.module = null;
      document.getElementById("burrow-dev-css")?.remove();
      const leftovers = document.querySelectorAll(".burrow-strip, .burrow-hints, .burrow-hud, .burrow-related, .burrow-owning, .rm-autocomplete__results [class*=burrow-]").length;
      if (leftovers) throw new Error(`${leftovers} Burrow node(s) left after unload`);
      return { arm, leftovers };
    }
    for (const f of features) dev.values[f] = true;
    if (arm === "off") dev.values.semanticRows = false;
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
    if (arm === "nosem") {
      try { api.data.semanticSearchEnabled = () => false; } catch { /* checked below */ }
      if (api.data.semanticSearchEnabled() !== false) {
        try { Object.defineProperty(api.data, "semanticSearchEnabled", { configurable: true, value: () => false }); } catch { /* checked below */ }
      }
      if (api.data.semanticSearchEnabled() !== false) throw new Error("nosem: could not stub roamAlphaAPI.data.semanticSearchEnabled");
    }
    const related = window.__BURROW?.related;
    return { arm, refs: window.__BURROW?.indexes?.refs?.entries.length, related: related ? { enabled: related.enabled, available: related.available } : null };
  }, { arm, code, css, features: FEATURES, refCommand: REF_COMMAND });
  if (arm === "on") {
    if (!result.related) throw new Error("window.__BURROW.related is missing: this build has no Related band");
    if (!result.related.available) throw new Error("Roam's semantic search is not enabled for this graph (related.available is false)");
  }
  return result;
}

const sameResult = (a, b) => a.string === b.string && JSON.stringify(a.extraStrings) === JSON.stringify(b.extraStrings) && JSON.stringify(a.newPages) === JSON.stringify(b.newPages);
const show = (r) => `${JSON.stringify(r.string)}/${JSON.stringify(r.extraStrings)}/${JSON.stringify(r.newPages)}`;
const errors = (results) => Object.entries(results).filter(([, r]) => r?.error).map(([arm, r]) => `${arm}: ${r.error}`);
const rectsEqual = (a, b) => a.length === b.length && a.every((r, i) => r.every((v, j) => Math.abs(v - b[i][j]) <= 0.5));

// ---- cases ----
// Each case: { name, graphs, arms, run(arm) -> result, verdict(resultsByArm) -> { failures, detail } }.

const NAMES = {
  acceptance: graph === "notes" ? `acceptance: ${QUERY} → Related ${config.acceptUid} within 5 s` : `acceptance: ${QUERY} → band shows`,
  dedupe: "dedupe: ((real time pcr — 6ZtlGN-Np is Burrow's row and not in Related",
  switchOff: "switch off removes it",
  keys: "⌥R / ↑↓ / Esc / Enter",
  late: "late band keeps the highlight",
  hidden: "hidden-row Enter",
  bytes: "byte-for-byte",
  free: "⌥R is free in Roam",
  noise: "no console noise",
  failure: "failure",
};

async function acceptanceRun() {
  const primed = await prime(SEED);
  if (!primed.ok) return { error: "focus failed" };
  const cold = firstQuery;
  const c0 = await callCount();
  await typeQuery(QUERY);
  const ms = await waitBand();
  const s = await shot();
  const result = { ms, cold, calls: (await callCount()) - c0, rows: s.related?.rows ?? [], band: s.band };
  await c.key("Escape");
  await readBack();
  return result;
}

function acceptanceVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const uids = on.rows.map((r) => r.uid);
  const detail = `band after ${on.ms} ms${on.cold ? " (cold, first query of the run)" : ""}, ${on.calls} call(s), rows ${JSON.stringify(on.rows.map((r) => `${r.kind}:${r.uid}`))}`;
  if (on.ms == null) failures.push(`no band: ${detail}`);
  else if (graph === "notes") {
    if (on.ms > 5000) failures.push(`band took ${on.ms} ms (> 5 s): ${detail}`);
    if (!uids.includes(config.acceptUid)) failures.push(`${config.acceptUid} not in the band: ${detail}`);
  } else if (!config.acceptUids.some((u) => uids.includes(u))) {
    failures.push(`none of ${config.acceptUids.join(", ")} in the band: ${detail}`);
  }
  return { failures, detail };
}

async function dedupeRun() {
  const primed = await prime(SEED);
  if (!primed.ok) return { error: "focus failed" };
  const c0 = await callCount();
  await typeQuery(config.dedupe.query);
  const ms = await waitBand();
  await sleep(300);
  const s = await shot();
  const result = { ms, calls: (await callCount()) - c0, stripUids: s.stripUids, rows: s.related?.rows ?? [] };
  await c.key("Escape");
  await readBack();
  return result;
}

function dedupeVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const uid = config.dedupe.uid;
  const detail = `Burrow rows ${JSON.stringify(on.stripUids)}, band ${on.ms == null ? "none" : JSON.stringify(on.rows.map((r) => r.uid))}, ${on.calls} call(s)`;
  if (!on.stripUids.includes(uid)) failures.push(`${uid} is not among Burrow's rows: ${detail}`);
  if (on.rows.some((r) => r.uid === uid)) failures.push(`${uid} is in the Related band too: ${detail}`);
  if (!on.calls) failures.push(`no semanticSearch call: ${detail}`);
  return { failures, detail };
}

// svy: acceptance's second half. The switch is read live.
async function switchOffRun() {
  const setSwitch = (v) => c.evaluate((v) => { window.__burrowDev.values.semanticRows = v; }, v);
  try {
    let primed = await prime(SEED);
    if (!primed.ok) return { error: "focus failed" };
    await typeQuery(QUERY);
    const ms = await waitBand();
    if (ms == null) return { error: "no band to switch off" };
    const calls0 = await callCount();
    await setSwitch(false);
    await c.type(" ", TYPE_MS);
    await key("Backspace");
    await sleep(300);
    const gone = await shot();
    await c.key("Escape");
    await readBack();
    primed = await prime(SEED);
    if (!primed.ok) return { error: "focus failed on reopen" };
    await typeQuery(QUERY);
    await sleep(3000);
    const reopened = await shot();
    const result = { ms, goneBand: gone.band.length, goneRows: gone.related?.rows.length ?? null, reopenBand: reopened.band.length, newCalls: (await callCount()) - calls0 };
    await c.key("Escape");
    await readBack();
    return result;
  } finally {
    await setSwitch(true);
  }
}

function switchOffVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const detail = `band after ${on.ms} ms; after switch off + space/Backspace: ${on.goneBand} band row(s); reopened: ${on.reopenBand} band row(s), ${on.newCalls} new call(s)`;
  if (on.goneBand || on.goneRows) failures.push(`band still there after the switch went off: ${detail}`);
  if (on.reopenBand) failures.push(`band on the reopened popup: ${detail}`);
  if (on.newCalls) failures.push(`${on.newCalls} semanticSearch call(s) with the switch off: ${detail}`);
  return { failures, detail };
}

async function keysRun() {
  const primed = await prime(SEED);
  if (!primed.ok) return { error: "focus failed" };
  await typeQuery(QUERY);
  if ((await waitBand()) == null) return { error: "no band" };
  await sleep(150);
  const s0 = await shot();
  await altR();
  const s1 = await shot();
  await key("ArrowDown");
  const s2 = await shot();
  await key("Escape");
  const s3 = await shot();
  await altR();
  const s4 = await shot();
  await key("Enter");
  const out = await readBack();
  return { s0, s1, s2, s3, s4, out };
}

function keysVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const { s0, s1, s2, s3, s4, out } = on;
  const n = s0.band.length;
  const at = (s) => s.band.findIndex((r) => r.active);
  const detail = `${n} band row(s); ⌥R → ${s1.phase}/row ${at(s1)}, ↓ → row ${at(s2)}, Esc → ${s3.phase}, ⌥R, Enter → ${JSON.stringify(out.string)}`;
  if (s1.phase !== "RELATED" || at(s1) !== 0) failures.push(`⌥R: phase ${s1.phase}, active band row ${at(s1)} (want RELATED, 0)`);
  if (!s1.roamMuted) failures.push("⌥R: Roam's highlight is not muted");
  if (s2.phase !== "RELATED" || at(s2) !== Math.min(1, n - 1)) failures.push(`↓: phase ${s2.phase}, active band row ${at(s2)} (want RELATED, ${Math.min(1, n - 1)})`);
  if (s3.phase !== "ARMED" || !s3.popup || at(s3) !== -1) failures.push(`Esc: phase ${s3.phase}, popup ${s3.popup}, active band row ${at(s3)} (want ARMED, open, none)`);
  if (s3.value !== s0.value) failures.push(`Esc changed the text ${JSON.stringify(s0.value)} → ${JSON.stringify(s3.value)}`);
  if (s4.phase !== "RELATED" || at(s4) !== 0) failures.push(`second ⌥R: phase ${s4.phase}, active band row ${at(s4)} (want RELATED, 0)`);
  const want = `${SEED}${s0.related?.rows[0]?.insertion}`;
  if (out.string !== want || out.extraStrings.length || out.newPages.length) failures.push(`Enter: ${show(out)} != ${JSON.stringify(want)}`);
  return { failures, detail };
}

// Snapshots right before and right after the band arrives.
async function lateRun(arm, low) {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const primed = await prime(SEED);
      if (!primed.ok) return { error: "focus failed" };
      if (low) {
        const { taTop, innerHeight } = await placeLow(c);
        if (!(taTop >= innerHeight - 200)) return { error: `placement did not take: text top ${taTop} of ${innerHeight}` };
      }
      await typeQuery(QUERY);
      // Only the popup: waiting for a strip row (up to 2 s) can outlast a cold
      // reply. The last snapshot before the band is 15 ms before it anyway.
      await settleStrip(true);
      let before = null;
      let after = null;
      for (let t0 = Date.now(); Date.now() - t0 < (graph === "svy" ? 20000 : firstQuery ? 12000 : 6000);) {
        const s = await shot();
        if (s.band.length) { after = s; break; }
        before = s;
        await sleep(15);
      }
      firstQuery = false;
      await c.key("Escape");
      await readBack();
      if (low) await placeNormal(c);
      if (before && after) return { before, after, low };
      if (!after) return { error: "no band" };
      // The band came before the first snapshot: ask again.
    }
    return { error: "the band arrived before the first snapshot twice" };
  } finally {
    if (low) await placeNormal(c);
  }
}

function lateVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const detail = [];
  for (const r of [on.normal, on.low]) {
    const label = r.low ? "popover flipped above the caret" : "popover below";
    if (r.error) { failures.push(`${label}: ${r.error}`); continue; }
    const { before: b, after: a } = r;
    const bad = [];
    if (!rectsEqual(b.roamRects, a.roamRects)) bad.push("Roam's rows moved");
    if (!rectsEqual(b.stripRects, a.stripRects)) bad.push("Burrow's strip rows moved");
    if (b.phase !== a.phase) bad.push(`phase ${b.phase} → ${a.phase}`);
    if (b.active !== a.active) bad.push(`active ${b.active} → ${a.active}`);
    if (b.roamActive !== a.roamActive) bad.push(`Roam's active row ${b.roamActive} → ${a.roamActive}`);
    if (r.low && !a.flipped) bad.push("the popover was not flipped above the caret");
    detail.push(`${label}: ${bad.length ? bad.join(", ") : `equal (${b.roamRects.length} Roam, ${b.stripRects.length} Burrow rows, phase ${b.phase}, active ${b.active}, Roam row ${b.roamActive})`}`);
    if (bad.length) failures.push(`${label}: ${bad.join(", ")}`);
  }
  return { failures, detail: detail.join("; ") };
}

// (a) Enter while the request is in flight, (b) Enter once the band is there.
async function hiddenRun(arm, variant, preselect) {
  return withSettings(arm, { refPreselect: preselect }, async () => {
    const primed = await prime(SEED);
    if (!primed.ok) return { error: "focus failed" };
    await typeQuery(QUERY);
    if (variant === "a") await sleep(450);
    else if (arm === "on") await waitBand();
    else { firstQuery = false; await sleep(5000); }
    const pre = await shot();
    await c.key("Enter");
    const out = await readBack();
    return { ...out, bandUids: (pre.related?.rows ?? []).map((r) => r.uid), bandShown: pre.band.length, phase: pre.phase };
  });
}

async function hiddenCase(arm) {
  const out = {};
  for (const preselect of [false, true]) {
    if (preselect && arm === "gone") continue;
    for (const variant of ["a", "b"]) out[`${variant}${preselect ? "+pre" : ""}`] = await hiddenRun(arm, variant, preselect);
  }
  return out;
}

function hiddenVerdict(results) {
  const failures = errors(results);
  const detail = [];
  const labels = ["a", "b", "a+pre", "b+pre"];
  for (const label of labels) {
    const r = Object.fromEntries(ARMS.map((arm) => [arm, results[arm]?.[label]]).filter(([, v]) => v));
    const bad = Object.entries(r).filter(([, v]) => v.error).map(([arm, v]) => `${arm}: ${v.error}`);
    if (bad.length) { failures.push(`${label}: ${bad.join("; ")}`); continue; }
    const pre = label.endsWith("+pre");
    const peers = pre ? ["off"] : ["off", "gone"];
    for (const peer of peers) {
      if (!r.on || !r[peer]) continue;
      if (!sameResult(r.on, r[peer])) failures.push(`${label}: on ${show(r.on)} != ${peer} ${show(r[peer])}`);
    }
    if (!pre && r.off && r.gone && !sameResult(r.off, r.gone)) failures.push(`${label}: off ${show(r.off)} != gone ${show(r.gone)}`);
    if (r.on) {
      const offString = r.off?.string ?? "";
      const stray = r.on.bandUids.filter((u) => r.on.string.includes(u) && !offString.includes(u));
      if (stray.length) failures.push(`${label}: band row uid ${stray.join(", ")} appears in the stored block ${JSON.stringify(r.on.string)}`);
    }
    detail.push(`${label}${r.on ? ` (band ${r.on.bandShown} row(s) at Enter)` : ""}: ${r.on ? JSON.stringify(r.on.string) : "-"}`);
  }
  return { failures, detail: detail.join("; ") };
}

const BYTE_SEQUENCES = [
  { name: "Enter", keys: ["Enter"] },
  { name: "Escape", keys: ["Escape"] },
  { name: "Tab (tabDrill false)", keys: ["Tab"], settings: { tabDrill: false } },
  { name: "ArrowDown ArrowDown Escape", keys: ["ArrowDown", "ArrowDown", "Escape"] },
  { name: "ArrowUp Escape", keys: ["ArrowUp", "Escape"] },
  { name: "ArrowLeft Escape", keys: ["ArrowLeft", "Escape"] },
  { name: "ArrowRight Escape", keys: ["ArrowRight", "Escape"] },
];

async function bytesCase(arm) {
  const out = {};
  for (const seq of BYTE_SEQUENCES) {
    out[seq.name] = await withSettings(arm, seq.settings, async () => {
      const primed = await prime(SEED);
      if (!primed.ok) return { error: "focus failed" };
      const c0 = await callCount();
      await typeQuery(QUERY);
      let bandSeen = null;
      if (arm === "on") bandSeen = (await waitBand()) != null;
      else { firstQuery = false; await sleep(5000); }
      for (const k of seq.keys) await key(k);
      const res = await readBack();
      return { ...res, bandSeen, calls: (await callCount()) - c0 };
    });
  }
  return out;
}

function bytesVerdict(results) {
  const failures = errors(results);
  const detail = [];
  for (const seq of BYTE_SEQUENCES) {
    const r = Object.fromEntries(["on", "off", "nosem"].map((arm) => [arm, results[arm]?.[seq.name]]).filter(([, v]) => v));
    const bad = Object.entries(r).filter(([, v]) => v.error).map(([arm, v]) => `${arm}: ${v.error}`);
    if (bad.length) { failures.push(`${seq.name}: ${bad.join("; ")}`); continue; }
    for (const arm of ["off", "nosem"]) {
      if (r.on && r[arm] && !sameResult(r.on, r[arm])) failures.push(`${seq.name}: on ${show(r.on)} != ${arm} ${show(r[arm])}`);
      if (r[arm]?.calls) failures.push(`${seq.name}: ${r[arm].calls} semanticSearch call(s) in arm ${arm}`);
    }
    for (const [arm, v] of Object.entries(r)) if (v.newPages.length) failures.push(`${seq.name}: arm ${arm} created pages ${JSON.stringify(v.newPages)}`);
    if (r.on && !r.on.bandSeen) failures.push(`${seq.name}: no band in arm on, so the comparison did not exercise it`);
    detail.push(`${seq.name}: ${r.on ? JSON.stringify(r.on.string) : "-"}`);
  }
  return { failures, detail: detail.join("; ") };
}

async function freeRun() {
  const primed = await prime(SEED);
  if (!primed.ok) return { error: "focus failed" };
  await typeQuery(QUERY);
  await sleep(1500);
  const s0 = await shot();
  await altR();
  await sleep(300);
  const s1 = await shot();
  const out = await readBack();
  return { s0, s1, out };
}

function freeVerdict({ gone }) {
  const failures = errors({ gone });
  if (failures.length) return { failures };
  const { s0, s1, out } = gone;
  const typed = (s1.value?.match(/®/g) || []).length;
  const detail = `text ${JSON.stringify(s0.value)} → ${JSON.stringify(s1.value)}, ${typed} "®", Roam rows ${s0.roamTexts.length} → ${s1.roamTexts.length}, stored ${JSON.stringify(out.string)}`;
  if (typed > 1 || s1.value?.replace(/®/g, "") !== s0.value) failures.push(`the block gained more than one "®": ${detail}`);
  if (!typed && JSON.stringify(s0.roamTexts) !== JSON.stringify(s1.roamTexts)) failures.push(`Roam's rows changed: ${detail}`);
  if (out.extraStrings.length || out.newPages.length) failures.push(`block/page created: ${show(out)}`);
  return { failures, detail: typed ? `${detail} (rows not compared: the query changed)` : detail };
}

async function failureRun() {
  const set = (n) => c.evaluate((n) => { window.__relGate.throwNext = n; }, n);
  try {
    let primed = await prime(SEED);
    if (!primed.ok) return { error: "focus failed" };
    const base = await callCount();
    const log0 = await consoleCount();
    await set(1);
    await typeQuery(QUERY);
    await sleep(1800);
    const s1 = await shot();
    const calls1 = (await callCount()) - base;
    const debug1 = burrowLines(await consoleSince(log0));
    await c.type(" more", TYPE_MS);
    await sleep(1500);
    const s2 = await shot();
    const calls2 = (await callCount()) - base;
    const debug2 = burrowLines(await consoleSince(log0));
    await c.key("Escape");
    await readBack();
    primed = await prime(SEED);
    if (!primed.ok) return { error: "focus failed on reopen" };
    const before = await callCount();
    await typeQuery(QUERY);
    const ms = await waitBand();
    const result = { band1: s1.band.length, band2: s2.band.length, calls1, calls2, debug1, debug2, reopenCalls: (await callCount()) - before, reopenBand: ms != null };
    await c.key("Escape");
    await readBack();
    return result;
  } finally {
    await set(0);
  }
}

function failureVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const detail = `calls ${on.calls1} then ${on.calls2}, debug lines ${on.debug2.length}, band rows ${on.band1}/${on.band2}; reopened: ${on.reopenCalls} call(s), band ${on.reopenBand}`;
  if (on.band1 || on.band2) failures.push(`a band after the failed call: ${detail}`);
  if (on.calls1 !== 1 || on.calls2 !== 1) failures.push(`want one call in the popup, got ${on.calls1} then ${on.calls2}`);
  if (on.debug2.length !== 1 || !allowedDebug(on.debug2[0])) failures.push(`want exactly one console.debug "[burrow] related…" line, got ${JSON.stringify(on.debug2)}`);
  if (on.reopenCalls < 1) failures.push(`no new call after reopening the popup: ${detail}`);
  return { failures, detail };
}

async function noiseRun() {
  const log0 = await consoleCount();
  let popups = 0;
  for (const query of [QUERY, QUERY, config.dedupe?.query ?? QUERY, "((ant"]) {
    const primed = await prime(SEED);
    if (!primed.ok) return { error: "focus failed" };
    await typeQuery(query);
    if (query.split(" ").length > 2) await waitBand();
    else await sleep(800);
    await c.key("Escape");
    await readBack();
    popups += 1;
  }
  const mine = await consoleSince(log0);
  const whole = await consoleSince(0);
  return { popups, mine, whole };
}

function noiseVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const mineBurrow = burrowLines(on.mine);
  const wholeBad = burrowLines(on.whole).filter((l) => !allowedDebug(l));
  const detail = `${on.popups} popups, ${mineBurrow.length} Burrow line(s) in them, ${on.mine.length - mineBurrow.length} other line(s) (Roam's, not judged); ${burrowLines(on.whole).length} Burrow line(s) in the whole run`;
  if (mineBurrow.filter((l) => !allowedDebug(l)).length) failures.push(`Burrow console output: ${JSON.stringify(mineBurrow)}`);
  if (mineBurrow.length > on.popups) failures.push(`more than one "[burrow] related" debug line per popup: ${JSON.stringify(mineBurrow)}`);
  if (wholeBad.length) failures.push(`Burrow console output outside the allowed debug line during the run: ${JSON.stringify(wholeBad)}`);
  return { failures, detail };
}

const CASES = [
  { name: NAMES.acceptance, graphs: ["svy", "notes"], arms: ["on"], run: acceptanceRun, verdict: acceptanceVerdict },
  { name: NAMES.dedupe, graphs: ["notes"], arms: ["on"], run: dedupeRun, verdict: dedupeVerdict },
  { name: NAMES.switchOff, graphs: ["svy"], arms: ["on"], run: switchOffRun, verdict: switchOffVerdict },
  { name: NAMES.keys, graphs: ["svy", "notes"], arms: ["on"], run: keysRun, verdict: keysVerdict },
  {
    name: NAMES.late, graphs: ["svy", "notes"], arms: ["on"],
    run: async (arm) => ({ normal: await lateRun(arm, false), low: await lateRun(arm, true) }), verdict: lateVerdict,
  },
  { name: NAMES.hidden, graphs: ["svy", "notes"], arms: ["on", "off", "gone"], run: hiddenCase, verdict: hiddenVerdict },
  { name: NAMES.bytes, graphs: ["svy", "notes"], arms: ["on", "off", "nosem"], run: bytesCase, verdict: bytesVerdict },
  { name: NAMES.free, graphs: ["svy", "notes"], arms: ["gone"], run: freeRun, verdict: freeVerdict },
  { name: NAMES.failure, graphs: ["svy", "notes"], arms: ["on"], run: failureRun, verdict: failureVerdict },
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
await setupFixture(c, { drillTree: false }).catch(async (error) => { await uninstrument(); await unparkInstalled(c); throw error; });

const results = new Map(wanted.map((k) => [k.name, {}]));
let fatal = null;
try {
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
  console.error("related gate failed:", error);
  fatal = String(error?.message || error);
} finally {
  await cleanup();
}

let passed = 0;
for (const kase of wanted) {
  const { failures, detail } = fatal && !Object.keys(results.get(kase.name)).length
    ? { failures: [`not run: ${fatal}`], detail: "" }
    : kase.verdict(results.get(kase.name));
  if (!failures.length) passed += 1;
  console.log(`${failures.length ? "FAIL" : "PASS"} ${kase.name}${detail ? `: ${detail}` : ""}`);
  for (const f of failures) console.log(`    ${f}`);
}
const ok = passed === wanted.length && !fatal && (!report.installed.parked || report.restored?.restored);
console.log(`related-gate ${graph}${theme ? ` (${theme})` : ""}: ${ok ? "PASS" : "FAIL"} (${passed}/${wanted.length})${fatal ? `; error: ${fatal}` : ""}`);
console.log(`  ${report.installed.parked ? `installed Burrow: parked ${report.installed.version} for the run, ${report.restored?.restored ? "restored" : "NOT restored"}` : "installed Burrow: none in this window"}`);
process.exitCode = ok ? 0 : 1;
