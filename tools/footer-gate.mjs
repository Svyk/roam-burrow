#!/usr/bin/env node
// Live gate for Burrow's Related footer (BRW-17): up to 4 semantic hits for the
// highlighted block, drawn at the bottom of the preview pane, on Roam Desktop
// over CDP (:9223). Keys are trusted CDP input events into one block of the
// `Burrow/Fixtures` page in the right sidebar. The gate loads the build itself
// per arm; an installed Burrow is parked for the run and put back afterwards.
// Roam's expanded-preview state (Ctrl-O) is put back to what it was at the
// start. It never reloads a window.
//
//   node tools/footer-gate.mjs <window-title-prefix> <svy|notes> [--theme light|dark] [--only "<case name or part of it>"]
//
// Arms: "on" (every switch on), "off" (semanticRelated off, semanticRows on),
// "nosem" (on, but roamAlphaAPI.data.semanticSearchEnabled stubbed to false for
// the run) and "gone" (module unloaded). Burrow's Related and footer caches are
// cleared before every case run. A semanticSearch call sends the text of a
// block (or the typed text) to the graph's embedding provider (approved in
// both graphs).
// Page-side instrumentation, installed once and removed afterwards (also on
// SIGINT / SIGTERM / a crash): a wrapper on api.data.async.semanticSearch that
// records the search strings, and wrappers on console.warn/error/log/debug.
// Exit code 1 on any FAIL.
import { readFile } from "node:fs/promises";
import { connect, sleep } from "./cdp.mjs";
import { parkInstalled, unparkInstalled } from "./installed.mjs";
import { cleanupFixture, guardReport, onAbort, placeNormal, primeFixture, setupFixture } from "./fixture.mjs";

// The queries live here, in one place. subject: the block Burrow's row preselects
// (null: whichever Burrow ref row is active after typing, recorded per run).
const CONFIGS = {
  notes: {
    query: "((real time pcr",
    // Roam's own list for "real time pcr" holds the blocks that say "real-time
    // PCR", and the footer leaves out what Roam's list shows; this query reaches
    // the same Burrow row while Roam's list holds none of them.
    acceptQuery: "((3. real-time pcr screen",
    subject: "6ZtlGN-Np",
    subjectPage: "iJg2hcFz2",
    expect: /PCR|Salmonella|qPCR/i,
    footerMs: 15000,
  },
  svy: {
    // A referenced block Burrow's row preselects (live-gate's svy ant man case).
    query: "((ant man",
    subject: null,
    footerMs: 25000,
  },
};
const SEED = "seed αβ 🙂 ";
const TYPE_MS = 35;
const FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pageBoost",
  "aliasInline", "aliasPreselect", "aliasChips", "tabDrill", "paneLayout", "keyHints",
  "rowPreview", "aliasCreate", "aliasDelete", "drillOrdinals", "drillEmpty", "drillCap", "refSearch", "refSearchHotkey",
  "helpTips", "helpSheet", "helpNudge", "refProse", "richRows", "recentRows", "frecency", "queryFilters", "aliasUsage", "aliasPrefix",
  "refContext", "refOutline", "previewImages", "previewTables", "insertVariants", "openInSidebar", "semanticRows", "semanticRelated"];
const REF_COMMAND = "Burrow: block reference search";
const ARMS = ["on", "off", "nosem", "gone"];

const [title, graph, ...flags] = process.argv.slice(2);
const config = CONFIGS[graph];
if (!title || !config) throw new Error("usage: footer-gate.mjs <window-title-prefix> <svy|notes> [--theme light|dark] [--only <case>]");
const flagValue = (name) => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : null; };
const theme = flagValue("--theme");
if (theme && theme !== "light" && theme !== "dark") throw new Error("--theme must be light or dark");
const only = flagValue("--only");
const root = new URL("..", import.meta.url);
const c = await connect(title);
const themeSet = theme ? await c.setTheme(theme) : null;
const QUERY = config.query;

// ---- page-side helpers ----

// Records semanticSearch search strings and console lines.
const instrument = () => c.evaluate(() => {
  const api = window.roamAlphaAPI;
  if (window.__footGate) return "already";
  const gate = { calls: [], console: [], origSearch: api.data.async.semanticSearch, origEnabled: api.data.semanticSearchEnabled, origConsole: {} };
  api.data.async.semanticSearch = function gateSearch(...args) {
    gate.calls.push(String(args[0]?.["search-str"] ?? ""));
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
  window.__footGate = gate;
  return "installed";
});

const uninstrument = () => c.evaluate(() => {
  const gate = window.__footGate;
  if (!gate) return "none";
  const api = window.roamAlphaAPI;
  api.data.async.semanticSearch = gate.origSearch;
  if (gate.origEnabled) api.data.semanticSearchEnabled = gate.origEnabled;
  for (const [m, fn] of Object.entries(gate.origConsole)) console[m] = fn;
  window.__footGate = null;
  return "removed";
});

const callCount = () => c.evaluate(() => window.__footGate?.calls.length ?? 0);
const callsSince = (from) => c.evaluate((from) => (window.__footGate?.calls || []).slice(from), from);
const consoleCount = () => c.evaluate(() => window.__footGate?.console.length ?? 0);
const consoleSince = (from) => c.evaluate((from) => (window.__footGate?.console || []).slice(from), from);
const burrowLines = (lines) => lines.filter((l) => /burrow/i.test(l.text));
const allowedDebug = (l) => l.m === "debug" && l.text.startsWith("[burrow] related");

// Clears both of Burrow's caches before every run.
async function prime(seed) {
  let primed = await primeFixture(c, seed);
  if (!primed.ok) {
    await sleep(800);
    primed = await primeFixture(c, seed);
  }
  await c.evaluate(() => {
    const g = window.__burrowFixture;
    g.titleSet = new Set(window.roamAlphaAPI.q("[:find [?t ...] :where [?p :node/title ?t]]"));
    window.__BURROW?.related?.clear?.();
    window.__BURROW?.related?.footer?.clear?.();
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

// One compact look at the picker: phase, Burrow's active row, the footer.
const shot = () => c.evaluate(() => {
  const b = window.__BURROW;
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const shown = (sel) => [...document.querySelectorAll(sel)].filter((n) => n.getClientRects().length);
  const pop = document.querySelector(".rm-autocomplete__results");
  const foot = shown(".burrow-preview-related .burrow-row");
  const row = b?.state.rows?.[b.state.active];
  const f = b?.related?.footer;
  return {
    popup: Boolean(pop), phase: b?.state.phase ?? "gone", active: b?.state.active ?? null,
    activeUid: row?.uid ?? null, activeKind: row?.kind ?? null, foot: b?.state.foot ?? null,
    footRows: foot.map((n) => ({ text: n.textContent.slice(0, 80), active: n.classList.contains("burrow-active"), rect: box(n) })),
    footAll: document.querySelectorAll(".burrow-preview-related .burrow-row").length,
    footer: f ? { enabled: f.enabled, available: f.available, subject: f.subject, rows: f.rows.map((r) => ({ uid: r.uid, insertion: r.insertion })), active: f.active, lastQuery: f.lastQuery, inFlight: f.inFlight, cacheSize: f.cacheSize } : null,
    value: document.activeElement?.tagName === "TEXTAREA" ? document.activeElement.value : null,
    focusedInput: document.activeElement?.id === window.__burrowFixture?.inputId,
  };
});

// Rects of the pane(s), the popover, the strip and the drill panel, plus the
// number of footer rows on screen; polled every 40 ms by the height case.
const sampleRects = () => c.evaluate(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const shown = (sel) => [...document.querySelectorAll(sel)].filter((n) => n.getClientRects().length);
  const one = (sel) => { const n = shown(sel)[0]; return n ? box(n) : null; };
  return {
    n: shown(".burrow-preview-related .burrow-row").length,
    pane: shown(".burrow-preview:not([hidden])").map(box),
    pop: one(".rm-autocomplete__results"),
    strip: one(".burrow-strip:not([hidden])"),
    scope: one(".burrow-scope:not([hidden])"),
    phase: window.__BURROW?.state.phase ?? "gone",
  };
});

// The footer's rows with the page and text each lives on.
const describeRows = (rows) => c.evaluate((rows) => {
  const api = window.roamAlphaAPI;
  return rows.map((r) => {
    const page = api.q(`[:find [?pu ?pt] :where [?b :block/uid ${JSON.stringify(r.uid)}] [?b :block/page ?p] [?p :block/uid ?pu] [?p :node/title ?pt]]`);
    const string = api.q(`[:find ?s . :where [?b :block/uid ${JSON.stringify(r.uid)}] [?b :block/string ?s]]`);
    return { uid: r.uid, insertion: r.insertion, pageUid: page?.[0] ?? null, pageTitle: page?.[1] ?? null, string: string ?? "" };
  });
}, rows);

const subjectInfo = (uid) => c.evaluate((uid) => {
  const api = window.roamAlphaAPI;
  const page = api.q(`[:find [?pu ?pt] :where [?b :block/uid ${JSON.stringify(uid)}] [?b :block/page ?p] [?p :block/uid ?pu] [?p :node/title ?pt]]`);
  const string = api.q(`[:find ?s . :where [?b :block/uid ${JSON.stringify(uid)}] [?b :block/string ?s]]`);
  return { uid, pageUid: page?.[0] ?? null, pageTitle: page?.[1] ?? null, string: string ?? "" };
}, uid);

// Burrow's row with the subject uid is active (OWNED), or 12 s have passed.
// With no uid wanted, any Burrow ref row counts; the active one is recorded.
async function waitSubject(want, limit = 12000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < limit) {
    last = await c.evaluate(() => {
      const s = window.__BURROW?.state;
      const r = s?.rows?.[s.active];
      return { phase: s?.phase ?? "gone", uid: r?.uid ?? null, kind: r?.kind ?? null, rows: (s?.rows || []).map((x) => x.uid) };
    });
    if (last.phase === "OWNED" && last.uid && (want ? last.uid === want : last.kind == null || last.kind === "ref")) return { ...last, ms: Date.now() - t0 };
    await sleep(40);
  }
  console.log(`  no active subject row${want ? ` ${want}` : ""} after ${limit} ms; last state: ${JSON.stringify(last)}`);
  return null;
}

// Footer rows on screen and in the debug object, or `limit` ms have passed.
async function waitFooter(limit) {
  const max = limit ?? config.footerMs;
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const seen = await c.evaluate(() => {
      const n = [...document.querySelectorAll(".burrow-preview-related .burrow-row")].filter((x) => x.getClientRects().length).length;
      return n > 0 && (window.__BURROW?.related?.footer?.rows.length ?? 0) > 0;
    });
    if (seen) return Date.now() - t0;
    await sleep(40);
  }
  const why = await c.evaluate(() => {
    const f = window.__BURROW?.related?.footer;
    return f ? { enabled: f.enabled, available: f.available, subject: f.subject, rows: f.rows.length, lastQuery: f.lastQuery, inFlight: f.inFlight, cacheSize: f.cacheSize } : null;
  });
  console.log(`  no footer after ${max} ms; footer: ${JSON.stringify(why)}`);
  return null;
}

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

// Alt+R as the task gives it: key "r", code KeyR, typed text "®".
const altR = async () => {
  const base = { key: "r", code: "KeyR", windowsVirtualKeyCode: 82, nativeVirtualKeyCode: 82, modifiers: 1 };
  await c.call("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: "®", unmodifiedText: "®" });
  await c.call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(150);
};

const key = async (k) => { await c.key(k); await sleep(120); };

// ⇧↵ / ⌥↵ with a window capture listener behind Burrow's that stops the key
// when Burrow did not take it (other svy extensions act on ⌥↵); returns how
// often the key got past Burrow.
async function chord(mods) {
  await c.evaluate(() => {
    const g = window.__footGateSwallow = { seen: 0 };
    g.fn = (e) => { if (e.key === "Enter") { g.seen += 1; e.preventDefault(); e.stopImmediatePropagation(); } };
    window.addEventListener("keydown", g.fn, true);
  });
  await c.key("Enter", mods);
  await sleep(120);
  return c.evaluate(() => {
    const g = window.__footGateSwallow;
    window.removeEventListener("keydown", g.fn, true);
    window.__footGateSwallow = null;
    return g.seen;
  });
}

// Roam's expanded preview (Ctrl-O): recorded the first time it is seen, put back at the end.
let initialExpanded = null;
const ctrlO = async () => {
  const base = { key: "o", code: "KeyO", windowsVirtualKeyCode: 79, nativeVirtualKeyCode: 79, modifiers: 2 };
  await c.call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await c.call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(300);
};
const isExpanded = () => c.evaluate(() => Boolean(document.querySelector(".rm-autocomplete__results--expanded")));
async function ensureExpanded() {
  const now = await isExpanded();
  initialExpanded ??= now;
  if (!now) await ctrlO();
}
async function restoreExpanded() {
  if (initialExpanded == null) return;
  const primed = await prime(SEED);
  if (!primed.ok) return;
  await c.type("((ant", TYPE_MS);
  for (let t0 = Date.now(); Date.now() - t0 < 2000 && !(await c.evaluate(() => Boolean(document.querySelector(".rm-autocomplete__results")))); ) await sleep(30);
  await sleep(100);
  if ((await isExpanded()) !== initialExpanded) await ctrlO();
  await c.key("Escape");
  await readBack();
}

// Opens the popup on the fixture block and types the query with Roam's preview expanded.
async function openQuery(query = QUERY, { expand = true } = {}) {
  const primed = await prime(SEED);
  if (!primed.ok) return { error: "focus failed" };
  const last = await typeQuery(query);
  if (expand) {
    await settleStrip();
    await ensureExpanded();
  }
  return { last };
}

// Subject active, then the footer: { subject, ms } or { error }.
async function toFooter({ footerMs } = {}) {
  const sub = await waitSubject(config.subject);
  if (!sub) return { error: "no active subject row" };
  const ms = await waitFooter(footerMs);
  if (ms == null) return { error: "no footer", subject: sub };
  return { subject: sub, ms };
}

async function setArm(arm) {
  const code = await readFile(new URL("extension.js", root), "utf8");
  const css = await readFile(new URL("extension.css", root), "utf8");
  const result = await c.evaluate(async ({ arm, code, css, features, refCommand }) => {
    const dev = window.__burrowDev || (window.__burrowDev = { values: {} });
    const gate = window.__footGate;
    const api = window.roamAlphaAPI;
    // The semantic-search stub lives only in the nosem arm.
    if (gate && gate.origEnabled) api.data.semanticSearchEnabled = gate.origEnabled;
    if (arm === "gone") {
      if (dev.module) await dev.module.default.onunload();
      dev.module = null;
      document.getElementById("burrow-dev-css")?.remove();
      const leftovers = document.querySelectorAll(".burrow-strip, .burrow-hints, .burrow-hud, .burrow-related, .burrow-preview-related, .burrow-owning, .rm-autocomplete__results [class*=burrow-]").length;
      if (leftovers) throw new Error(`${leftovers} Burrow node(s) left after unload`);
      return { arm, leftovers };
    }
    for (const f of features) dev.values[f] = true;
    if (arm === "off") dev.values.semanticRelated = false;
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
    return { arm, refs: window.__BURROW?.indexes?.refs?.entries.length, related: related ? { enabled: related.enabled, available: related.available, footer: Boolean(related.footer) } : null };
  }, { arm, code, css, features: FEATURES, refCommand: REF_COMMAND });
  if (arm === "on") {
    if (!result.related) throw new Error("window.__BURROW.related is missing: this build has no Related band");
    if (!result.related.footer) throw new Error("window.__BURROW.related.footer is missing: this build has no Related footer");
    if (!result.related.available) throw new Error("Roam's semantic search is not enabled for this graph (related.available is false)");
  }
  return result;
}

const sameResult = (a, b) => a.string === b.string && JSON.stringify(a.extraStrings) === JSON.stringify(b.extraStrings) && JSON.stringify(a.newPages) === JSON.stringify(b.newPages);
const show = (r) => `${JSON.stringify(r.string)}/${JSON.stringify(r.extraStrings)}/${JSON.stringify(r.newPages)}`;
const errors = (results) => Object.entries(results).filter(([, r]) => r?.error).map(([arm, r]) => `${arm}: ${r.error}`);
const rectEq = (a, b) => (a == null || b == null ? a === b : a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 0.5));
const rectsEq = (a, b) => a.length === b.length && a.every((r, i) => rectEq(r, b[i]));
const clean = (r) => r.extraStrings.length === 0 && r.newPages.length === 0;
const brief = (t, n = 60) => (t || "").replace(/\s+/g, " ").slice(0, n);

// ---- cases ----
// Each case: { name, graphs, arms, run(arm) -> result, verdict(resultsByArm) -> { failures, detail } }.

const NAMES = {
  acceptance: `acceptance: ${config.acceptQuery ?? QUERY} → 1-4 footer rows, none the subject or on its page`,
  dedupe: `dedupe: ${QUERY} → no footer row is a row Roam's list shows`,
  height: "height: the pane and the popover keep their size when the footer arrives",
  switchOff: "switch off removes it",
  keys: "⌥R / ↑↓ / Esc / Enter",
  variants: "⇧↵ embed, ⌥↵ labelled ref",
  click: "click inserts",
  hidden: "hidden-row Enter",
  bytes: "byte-for-byte",
  noise: "no console noise",
};

async function acceptanceRun() {
  const opened = await openQuery(config.acceptQuery ?? QUERY);
  if (opened.error) return opened;
  const c0 = await callCount();
  const got = await toFooter();
  if (got.error) { await c.key("Escape"); await readBack(); return got; }
  const s = await shot();
  const subject = await subjectInfo(got.subject.uid);
  const rows = await describeRows(s.footer?.rows ?? []);
  const result = { ms: got.ms, calls: (await callCount()) - c0, subject, rows, domRows: s.footRows.length, foot: s.foot };
  await c.key("Escape");
  await readBack();
  return result;
}

function acceptanceVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const rows = on.rows.map((r) => `${r.uid} [${brief(r.pageTitle, 30)}] ${JSON.stringify(brief(r.string))}`);
  const detail = `subject ${on.subject.uid} on [${on.subject.pageTitle}] (${JSON.stringify(brief(on.subject.string))}); footer after ${on.ms} ms, ${on.calls} call(s), ${on.rows.length} row(s): ${rows.join("; ")}`;
  if (on.rows.length < 1 || on.rows.length > 4) failures.push(`want 1-4 rows, got ${on.rows.length}: ${detail}`);
  if (on.domRows !== on.rows.length) failures.push(`${on.domRows} footer row(s) drawn, ${on.rows.length} in the debug object`);
  if (on.rows.some((r) => r.uid === on.subject.uid)) failures.push(`the subject ${on.subject.uid} is a footer row`);
  const same = on.rows.filter((r) => r.pageUid && r.pageUid === on.subject.pageUid);
  if (same.length) failures.push(`footer row(s) on the subject's page ${on.subject.pageUid}: ${same.map((r) => r.uid).join(", ")}`);
  if (config.subjectPage && on.subject.pageUid !== config.subjectPage) failures.push(`subject's page is ${on.subject.pageUid}, expected ${config.subjectPage}`);
  if (config.expect && !on.rows.some((r) => config.expect.test(r.string))) failures.push(`no footer row matches ${config.expect}: ${detail}`);
  return { failures, detail };
}

// Roam's list for QUERY: the footer must not repeat a block it shows (a native
// row's title attribute holds the block's raw string).
async function dedupeRun() {
  const opened = await openQuery();
  if (opened.error) return opened;
  const got = await toFooter();
  if (got.error) { await c.key("Escape"); await readBack(); return got; }
  const s = await shot();
  const out = await c.evaluate((uids) => {
    const api = window.roamAlphaAPI;
    const titles = new Set([...document.querySelectorAll(".rm-autocomplete__results-scroll > div[title]")].map((n) => n.getAttribute("title")));
    const strings = uids.map((u) => api.pull("[:block/string]", [":block/uid", u])?.[":block/string"] ?? "");
    return { native: titles.size, repeated: uids.filter((u, i) => titles.has(strings[i])) };
  }, (s.footer?.rows ?? []).map((r) => r.uid));
  await c.key("Escape");
  await readBack();
  return { rows: (s.footer?.rows ?? []).map((r) => r.uid), ...out };
}

function dedupeVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const detail = `${on.native} native row title(s), footer ${JSON.stringify(on.rows)}`;
  if (!on.rows.length) failures.push(`no footer: ${detail}`);
  if (!on.native) failures.push(`read no native row titles: ${detail}`);
  if (on.repeated.length) failures.push(`footer repeats Roam's row(s) ${on.repeated.join(", ")}: ${detail}`);
  return { failures, detail };
}

// Last sample before the footer exists and the first after, in the row preview
// ("row", Roam's preview expanded and docked) or the drill panel ("scope", Shift+Tab).
async function heightRun(mode) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const opened = await openQuery();
    if (opened.error) return opened;
    const sub = await waitSubject(config.subject);
    if (!sub) { await c.key("Escape"); await readBack(); return { error: "no active subject row" }; }
    if (mode === "scope") {
      await c.key("Tab", 8);
      let phase = null;
      for (let t0 = Date.now(); Date.now() - t0 < 3000;) {
        phase = await c.evaluate(() => window.__BURROW?.state.phase);
        if (phase === "SCOPE") break;
        await sleep(40);
      }
      if (phase !== "SCOPE") { await c.key("Escape"); await readBack(); return { error: `Shift+Tab: phase ${phase}, not SCOPE` }; }
      let pane = 0;
      for (let t0 = Date.now(); Date.now() - t0 < 3000;) {
        pane = (await sampleRects()).pane.length;
        if (pane) break;
        await sleep(40);
      }
      if (!pane) { await c.key("Escape"); await readBack(); return { error: "no scope preview (.burrow-preview) beside the popover" }; }
    }
    let before = null;
    let after = null;
    for (let t0 = Date.now(); Date.now() - t0 < config.footerMs;) {
      const s = await sampleRects();
      if (s.n > 0) { after = s; break; }
      if (s.pane.length) before = s;
      await sleep(40);
    }
    const phaseAfter = await c.evaluate(() => window.__BURROW?.state.phase);
    await c.key("Escape");
    await c.key("Escape");
    await readBack();
    if (!after) return { error: "no footer" };
    if (before) return { before, after, phaseAfter, mode };
    // The footer was there before the first sample: ask again.
  }
  return { error: "the footer was already there at the first sample twice" };
}

function heightVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const detail = [];
  for (const r of [on.row, on.scope]) {
    if (r.error) { failures.push(`${r.label}: ${r.error}`); continue; }
    const { before: b, after: a } = r;
    const bad = [];
    if (!rectsEq(b.pane, a.pane)) bad.push(`the pane moved or resized ${JSON.stringify(b.pane)} → ${JSON.stringify(a.pane)}`);
    if (!rectEq(b.pop, a.pop)) bad.push(`the popover ${JSON.stringify(b.pop)} → ${JSON.stringify(a.pop)}`);
    if (!rectEq(b.strip, a.strip)) bad.push(`the strip ${JSON.stringify(b.strip)} → ${JSON.stringify(a.strip)}`);
    if (!rectEq(b.scope, a.scope)) bad.push(`the drill panel ${JSON.stringify(b.scope)} → ${JSON.stringify(a.scope)}`);
    if (r.mode === "scope" && r.phaseAfter !== "SCOPE") bad.push(`phase ${r.phaseAfter} after the footer arrived`);
    detail.push(`${r.mode === "scope" ? "drill panel (SCOPE)" : "row preview (expanded)"}: ${bad.length ? bad.join(", ") : `equal (${b.pane.length} pane rect(s), footer ${a.n} row(s))`}`);
    if (bad.length) failures.push(`${r.mode}: ${bad.join(", ")}`);
  }
  return { failures, detail: detail.join("; ") };
}

// Switch flipped live: the footer goes; a reopened popup asks nothing for the subject's text.
async function switchOffRun() {
  try {
    const opened = await openQuery();
    if (opened.error) return opened;
    const got = await toFooter();
    if (got.error) { await c.key("Escape"); await readBack(); return got; }
    const subject = await subjectInfo(got.subject.uid);
    const calls0 = await callCount();
    await c.evaluate(() => { window.__burrowDev.values.semanticRelated = false; });
    await c.type(" ", TYPE_MS);
    await key("Backspace");
    await sleep(300);
    const gone = await shot();
    await c.key("Escape");
    await readBack();
    const reopened = await openQuery();
    if (reopened.error) return { error: `${reopened.error} on reopen` };
    const again = await waitSubject(null);
    await sleep(3000);
    const s = await shot();
    const subjectCalls = (await callsSince(calls0)).filter((x) => x.startsWith(brief(subject.string, 30).trim()));
    const result = { ms: got.ms, subject, goneRows: gone.footAll, goneDebug: gone.footer?.rows.length ?? null, reopenRows: s.footAll, reopenDebug: s.footer?.rows.length ?? null, subjectCalls, reopenSubject: again?.uid ?? null };
    await c.key("Escape");
    await readBack();
    return result;
  } finally {
    await c.evaluate(() => { window.__burrowDev.values.semanticRelated = true; });
  }
}

function switchOffVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const detail = `footer after ${on.ms} ms; after switch off + space/Backspace: ${on.goneRows} drawn / ${on.goneDebug} debug row(s); reopened: ${on.reopenRows} / ${on.reopenDebug}, ${on.subjectCalls.length} call(s) with the subject's text`;
  if (on.goneRows || on.goneDebug) failures.push(`footer still there after the switch went off: ${detail}`);
  if (on.reopenRows || on.reopenDebug) failures.push(`footer on the reopened popup: ${detail}`);
  if (on.subjectCalls.length) failures.push(`${on.subjectCalls.length} semanticSearch call(s) for the subject's text with the switch off: ${JSON.stringify(on.subjectCalls.map((x) => brief(x)))}`);
  if (!on.reopenSubject) failures.push("no subject row on the reopened popup, so the 3 s wait proved nothing");
  return { failures, detail };
}

async function keysRun() {
  const opened = await openQuery();
  if (opened.error) return opened;
  const got = await toFooter();
  if (got.error) { await c.key("Escape"); await readBack(); return got; }
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
  const n = s0.footRows.length;
  const act = (s) => s.footRows.findIndex((r) => r.active);
  const detail = `${n} footer row(s); ⌥R → foot ${s1.foot}/row ${act(s1)}, ↓ → foot ${s2.foot}, Esc → foot ${s3.foot}, ⌥R, Enter → ${JSON.stringify(out.string)}`;
  if (s1.foot !== 0 || act(s1) !== 0) failures.push(`⌥R: state.foot ${s1.foot}, active footer row ${act(s1)} (want 0, 0)`);
  const want1 = Math.min(1, n - 1);
  if (s2.foot !== want1 || act(s2) !== want1) failures.push(`↓: state.foot ${s2.foot}, active footer row ${act(s2)} (want ${want1})`);
  if (s3.foot !== -1 || act(s3) !== -1 || !s3.popup) failures.push(`Esc: state.foot ${s3.foot}, active footer row ${act(s3)}, popup ${s3.popup} (want -1, none, open)`);
  if (s3.activeUid !== s0.activeUid || s3.active !== s0.active) failures.push(`Esc: Burrow's row ${s0.active}/${s0.activeUid} → ${s3.active}/${s3.activeUid}`);
  if (s3.value !== s0.value) failures.push(`Esc changed the text ${JSON.stringify(s0.value)} → ${JSON.stringify(s3.value)}`);
  if (s4.foot !== 0 || act(s4) !== 0) failures.push(`second ⌥R: state.foot ${s4.foot}, active footer row ${act(s4)} (want 0, 0)`);
  const want = `${SEED}${s0.footer?.rows[0]?.insertion}`;
  if (out.string !== want || !clean(out)) failures.push(`Enter: ${show(out)} != ${JSON.stringify(want)}`);
  return { failures, detail };
}

async function variantRun(variant) {
  const opened = await openQuery();
  if (opened.error) return opened;
  const got = await toFooter();
  if (got.error) { await c.key("Escape"); await readBack(); return got; }
  await sleep(150);
  const s0 = await shot();
  await altR();
  const s1 = await shot();
  const swallowed = await chord(variant === "embed" ? 8 : 1);
  const out = await readBack();
  return { s0, s1, swallowed, out };
}

async function variantsRun() {
  return { embed: await variantRun("embed"), label: await variantRun("label") };
}

function variantsVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const detail = [];
  for (const [name, r] of Object.entries({ embed: on.embed, label: on.label })) {
    if (r.error) { failures.push(`${name}: ${r.error}`); continue; }
    const uid = r.s0.footer?.rows[0]?.uid;
    if (r.s1.foot !== 0) failures.push(`${name}: ⌥R did not enter the footer (state.foot ${r.s1.foot})`);
    const rest = r.out.string.startsWith(SEED) ? r.out.string.slice(SEED.length) : null;
    const ok = name === "embed" ? rest === `{{[[embed]]: ((${uid}))}}` : rest != null && rest.endsWith(`](((${uid})))`) && rest.startsWith("[");
    if (!ok || !clean(r.out)) failures.push(`${name}: ${show(r.out)} (want ${name === "embed" ? `${SEED}{{[[embed]]: ((${uid}))}}` : `${SEED}[…](((${uid})))`})`);
    if (r.swallowed) failures.push(`${name}: the key got past Burrow ${r.swallowed} time(s)`);
    detail.push(`${name}: ${JSON.stringify(r.out.string)}`);
  }
  return { failures, detail: detail.join("; ") };
}

async function clickRun() {
  const opened = await openQuery();
  if (opened.error) return opened;
  const got = await toFooter();
  if (got.error) { await c.key("Escape"); await readBack(); return got; }
  await sleep(150);
  const s0 = await shot();
  const point = await c.evaluate(() => {
    const el = [...document.querySelectorAll(".burrow-preview-related .burrow-row")].find((n) => n.getClientRects().length);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!point) { await c.key("Escape"); await readBack(); return { error: "no footer row to click" }; }
  await c.click(point.x, point.y);
  await sleep(250);
  const s1 = await shot();
  const out = await readBack();
  return { s0, s1, out };
}

function clickVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const { s0, s1, out } = on;
  const want = `${SEED}${s0.footer?.rows[0]?.insertion}`;
  const detail = `click on footer row 0 → ${JSON.stringify(out.string)}; fixture block focused ${s1.focusedInput}, popup ${s1.popup}`;
  if (out.string !== want || !clean(out)) failures.push(`click: ${show(out)} != ${JSON.stringify(want)}`);
  if (!s1.focusedInput) failures.push("the fixture block lost focus after the click");
  return { failures, detail };
}

// (a) Enter within 150 ms of the last key, (b) Enter once the footer is there but ⌥R not pressed.
async function hiddenRun(variant) {
  const opened = await openQuery(QUERY, { expand: variant === "b" });
  if (opened.error) return opened;
  let pre;
  let sinceLast = null;
  if (variant === "a") {
    await sleep(40);
    pre = await shot();
    sinceLast = Date.now() - opened.last;
  } else {
    const got = await toFooter();
    if (got.error) { await c.key("Escape"); await readBack(); return got; }
    await sleep(150);
    pre = await shot();
  }
  await c.key("Enter");
  const out = await readBack();
  return { ...out, preUid: pre.activeUid, phase: pre.phase, foot: pre.foot, footRows: pre.footRows.length, sinceLast };
}

async function hiddenCase() {
  return { a: await hiddenRun("a"), b: await hiddenRun("b") };
}

function hiddenVerdict({ on }) {
  const failures = errors({ on });
  if (failures.length) return { failures };
  const detail = [];
  for (const label of ["a", "b"]) {
    const r = on[label];
    if (r.error) { failures.push(`${label}: ${r.error}`); continue; }
    const want = `${SEED}((${r.preUid}))`;
    if (r.phase !== "OWNED" || !r.preUid) failures.push(`${label}: no Burrow row active before Enter (phase ${r.phase})`);
    if (config.subject && r.preUid !== config.subject) failures.push(`${label}: Burrow's preselected row is ${r.preUid}, expected ${config.subject}`);
    if (r.string !== want || !clean(r)) failures.push(`${label}: ${show(r)} != ${JSON.stringify(want)}`);
    if (r.foot !== -1) failures.push(`${label}: state.foot ${r.foot} before Enter`);
    if (label === "a" && r.footRows) failures.push(`a: ${r.footRows} footer row(s) already drawn ${r.sinceLast} ms after the last key`);
    detail.push(`${label}${label === "a" ? ` (${r.sinceLast} ms after the last key)` : ` (${r.footRows} footer row(s) at Enter)`}: ${JSON.stringify(r.string)}`);
  }
  return { failures, detail: detail.join("; ") };
}

// Arms differ only in the footer: 3 s after the last key, then Escape or Enter.
async function bytesCase(arm) {
  const out = {};
  for (const name of ["Escape", "Enter"]) {
    const opened = await openQuery(QUERY, { expand: false });
    if (opened.error) { out[name] = opened; continue; }
    const c0 = await callCount();
    await sleep(3000);
    const s = await shot();
    await c.key(name);
    const res = await readBack();
    out[name] = { ...res, footAll: s.footAll, footDebug: s.footer?.rows.length ?? 0, calls: (await callCount()) - c0 };
  }
  return out;
}

function bytesVerdict(results) {
  const failures = errors(results);
  const detail = [];
  for (const name of ["Escape", "Enter"]) {
    const arms = name === "Escape" ? ["on", "off", "nosem", "gone"] : ["on", "off", "nosem"];
    const r = Object.fromEntries(arms.map((arm) => [arm, results[arm]?.[name]]).filter(([, v]) => v));
    const bad = Object.entries(r).filter(([, v]) => v.error).map(([arm, v]) => `${arm}: ${v.error}`);
    if (bad.length) { failures.push(`${name}: ${bad.join("; ")}`); continue; }
    for (const arm of arms.filter((a) => a !== "on")) {
      if (r.on && r[arm] && !sameResult(r.on, r[arm])) failures.push(`${name}: on ${show(r.on)} != ${arm} ${show(r[arm])}`);
    }
    for (const arm of ["off", "nosem", "gone"]) if (r[arm]?.footAll || r[arm]?.footDebug) failures.push(`${name}: footer rows in arm ${arm}`);
    for (const [arm, v] of Object.entries(r)) if (v.newPages.length) failures.push(`${name}: arm ${arm} created pages ${JSON.stringify(v.newPages)}`);
    if (r.nosem?.calls) failures.push(`${name}: ${r.nosem.calls} semanticSearch call(s) in arm nosem`);
    detail.push(`${name}: ${r.on ? JSON.stringify(r.on.string) : "-"}${r.on ? ` (${r.on.footAll} footer row(s) in arm on)` : ""}`);
  }
  return { failures, detail: detail.join("; ") };
}

async function noiseRun() {
  const log0 = await consoleCount();
  let popups = 0;
  for (const query of [QUERY, QUERY, "((ant"]) {
    const opened = await openQuery(query);
    if (opened.error) return opened;
    if (query === QUERY) await toFooter();
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
  if (wholeBad.length) failures.push(`Burrow console output outside the allowed debug line during the run: ${JSON.stringify(wholeBad)}`);
  return { failures, detail };
}

const CASES = [
  { name: NAMES.acceptance, graphs: ["svy", "notes"], arms: ["on"], run: acceptanceRun, verdict: acceptanceVerdict },
  { name: NAMES.dedupe, graphs: ["notes"], arms: ["on"], run: dedupeRun, verdict: dedupeVerdict },
  {
    name: NAMES.height, graphs: ["svy", "notes"], arms: ["on"],
    run: async () => {
      const row = await heightRun("row");
      const scope = await heightRun("scope");
      return { row: { label: "row preview", ...row }, scope: { label: "drill panel", ...scope } };
    },
    verdict: heightVerdict,
  },
  { name: NAMES.switchOff, graphs: ["svy", "notes"], arms: ["on"], run: switchOffRun, verdict: switchOffVerdict },
  { name: NAMES.keys, graphs: ["svy", "notes"], arms: ["on"], run: keysRun, verdict: keysVerdict },
  { name: NAMES.variants, graphs: ["svy", "notes"], arms: ["on"], run: variantsRun, verdict: variantsVerdict },
  { name: NAMES.click, graphs: ["svy", "notes"], arms: ["on"], run: clickRun, verdict: clickVerdict },
  { name: NAMES.hidden, graphs: ["svy", "notes"], arms: ["on"], run: hiddenCase, verdict: hiddenVerdict },
  { name: NAMES.bytes, graphs: ["svy", "notes"], arms: ARMS, run: bytesCase, verdict: bytesVerdict },
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
    await restoreExpanded().catch((error) => console.error("cleanup (preview state):", error));
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
  console.error("footer gate failed:", error);
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
console.log(`footer-gate ${graph}${theme ? ` (${theme})` : ""}: ${ok ? "PASS" : "FAIL"} (${passed}/${wanted.length})${fatal ? `; error: ${fatal}` : ""}`);
console.log(`  ${report.installed.parked ? `installed Burrow: parked ${report.installed.version} for the run, ${report.restored?.restored ? "restored" : "NOT restored"}` : "installed Burrow: none in this window"}`);
process.exitCode = ok ? 0 : 1;
