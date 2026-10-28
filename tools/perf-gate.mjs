#!/usr/bin/env node
// Cost budget gate (spec §6) on a live Roam Desktop window over CDP.
// Types ~200 trusted keys with Roam's (( popup open into one block on
// `Burrow/Fixtures` (typing a query, then deleting it again), per arm:
//   gone - Burrow not loaded; on - Burrow loaded, every feature on.
// Per key: keydown timeStamp -> end of the next frame (a MessageChannel task
// posted from requestAnimationFrame). Burrow's own handler time comes from
// window.__BURROW_PERF. Datalog queries and pulls per key must be zero.
// --filters types the three-filter query of the graph (by window title).
// --drill types into a drill expression on the fixture's heading tree instead
// (`[[Burrow/Fixtures#alpha > ` then the query), with the preview open; data
// fetched by the drill (one pull per node it visits) is reported separately.
// --preview: Roam's preview open, so Burrow's selected row draws its own
// preview at idle; every idle slice of that draw is a "preview" sample and its
// p95 is held to the same 4 ms budget.
// With Burrow on, every run also times the alias refresh an alias edit outside
// Burrow sets off (src/indexes.js refreshAliases; read only, 8 refreshes 250
// ms apart, as the watch's settle spaces them, each re-keying the most linked
// alias page): the p95 of each kind of its idle tasks is held to 4 ms too.
// Docking the preview over Roam's (a frame callback, src/strip.js
// placePanes) is reported as well: its read meets the frame's own layout.
// --cold "[[plexus": first draws only. Opens that popup --runs x 4 times with
// Roam's preview open (each popup starts with nothing read), selects the alias
// row and times every slice of its preview draw and the time until it shows.
// An installed Burrow is parked for the run and put back afterwards.
//   node tools/perf-gate.mjs <window-title-prefix> [--runs 3] [--query "ant man"] [--drill] [--preview] [--cold "[[plexus"] [--theme light|dark] [--json]
import { readFile } from "node:fs/promises";
import { connect, sleep } from "./cdp.mjs";
import { parkInstalled, unparkInstalled } from "./installed.mjs";
import { FIXTURE_PAGE, cleanupFixture, deleteNewPages, guardReport, onAbort, primeFixture, setupFixture, snapshotTitles } from "./fixture.mjs";

const args = process.argv.slice(2);
const title = args[0];
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const runs = Number(flag("--runs", 3));
const drill = args.includes("--drill");
// --preview: Roam's preview open (Ctrl-O) on both arms, where Burrow's rows
// draw their own preview; Roam's choice is put back afterwards.
const withPreview = args.includes("--preview");
const cold = flag("--cold", null);
// --filters: three query filters on real data, rows still shown (BRW-18):
// svy's ant man TODO on MCU Watch Order, notes' PCR screen on the PhD page.
const FILTERED = {
  svy: "ant man is:todo -wakanda in:MCU Watch Order",
  notes: "\"pcr screen\" -wgs in:PhD/Cronobacter & Spore Control in PIF",
};
const filtered = args.includes("--filters") ? FILTERED[/^svy/i.test(title) ? "svy" : "notes"] : null;
const query = flag("--query", filtered ?? (drill ? "never > grand" : "ant man"));
// The (( opener and the first two characters of the query are the recent rows' keys (BRW-14).
const opener = drill ? `[[${FIXTURE_PAGE}#alpha > ` : "((";
const cycles = Math.ceil(200 / (query.length * 2));
const root = new URL("..", import.meta.url);
const theme = flag("--theme", null);
if (theme && theme !== "light" && theme !== "dark") throw new Error("--theme must be light or dark");
const c = await connect(title);
if (theme) await c.setTheme(theme);

const code = await readFile(new URL("extension.js", root), "utf8");
const css = await readFile(new URL("extension.css", root), "utf8");

async function setArm(arm) {
  return c.evaluate(async ({ arm, code, css }) => {
    const dev = window.__burrowDev || (window.__burrowDev = { values: {} });
    if (dev.module) { await dev.module.default.onunload(); dev.module = null; }
    document.getElementById("burrow-dev-css")?.remove();
    if (arm === "gone") return { arm };
    for (const f of ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pageBoost", "aliasInline", "aliasPreselect", "aliasChips", "tabDrill", "paneLayout", "keyHints",
      "rowPreview", "aliasCreate", "aliasDelete", "drillOrdinals", "drillEmpty", "drillCap", "refSearch", "refSearchHotkey", "helpTips", "helpSheet", "helpNudge", "refProse", "richRows", "recentRows", "frecency", "queryFilters"]) dev.values[f] = true;
    dev.values.helpNudgeSeen = true;
    const style = document.createElement("style");
    style.id = "burrow-dev-css";
    style.textContent = css;
    document.head.append(style);
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    dev.module = await import(url);
    URL.revokeObjectURL(url);
    await dev.module.default.onload({
      extensionAPI: {
        settings: { canSet: true, get: (k) => (k in dev.values ? dev.values[k] : null), set: async (k, v) => { dev.values[k] = v; }, panel: { create: async () => null } },
        ui: { commandPalette: { addCommand: async () => null, removeCommand: async () => null } },
      },
      extension: { version: "perf" },
    });
    const t0 = performance.now();
    while (!window.__BURROW?.indexes?.refs && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1500));
    return { arm, refs: window.__BURROW.indexes.refs.entries.length, build: { query: window.__BURROW_PERF.samples.buildQuery, keys: window.__BURROW_PERF.samples.buildKeys } };
  }, { arm, code, css });
}

async function startRun() {
  const primed = await primeFixture(c, "");
  if (!primed.ok) return { ok: false };
  return c.evaluate(() => {
    const g = window.__burrowFixture;
    const probe = { records: [], armed: true };
    const channel = new MessageChannel();
    const pending = [];
    channel.port1.onmessage = () => { const r = pending.shift(); if (r) r.end = performance.now(); };
    probe.onKeyDown = (e) => {
      if (!probe.armed || e.target?.id !== g.inputId) return;
      const record = { start: e.timeStamp, end: 0 };
      probe.records.push(record);
      requestAnimationFrame(() => { pending.push(record); channel.port2.postMessage(0); });
    };
    window.addEventListener("keydown", probe.onKeyDown, true);
    window.__burrowPerfProbe = probe;
    window.__BURROW_PERF?.reset();
    return { ok: true };
  });
}

async function endRun() {
  return c.evaluate(async () => {
    const probe = window.__burrowPerfProbe;
    probe.armed = false;
    window.removeEventListener("keydown", probe.onKeyDown, true);
    await new Promise((r) => setTimeout(r, 300));
    const lat = probe.records.filter((r) => r.end).map((r) => r.end - r.start);
    const perf = window.__BURROW_PERF;
    return {
      keys: probe.records.length, latency: lat,
      burrowInput: perf ? [...perf.samples.input] : null,
      burrowRender: perf ? [...perf.samples.render] : null,
      place: perf?.summary ? perf.summary("place") : null,
      queries: perf ? perf.counters.queries : null,
      drillFetches: perf ? (perf.counters.drillPulls || 0) + (perf.counters.drillQueries || 0) : null,
      previewShown: Boolean(document.querySelector(".burrow-preview:not([hidden]) .burrow-target")),
      builds: perf ? perf.counters.builds : null,
      // Burrow's deferred (idle) preview draw: one sample per idle slice.
      preview: perf?.summary ? perf.summary("preview") : null,
      previewKinds: perf?.summary ? Object.fromEntries(["read", "draw", "rest", "scroll"].map((k) => [k, perf.summary(`preview.${k}`)])) : null,
      // The context line's idle read (page, parent, child count) per block highlighted.
      context: perf?.summary ? perf.summary("context") : null,
      // Has-children checks for the hint line (one small pull per page or block highlighted).
      kidChecks: perf ? perf.counters.kidChecks || 0 : null,
      popup: Boolean(document.querySelector(".rm-autocomplete__results")),
    };
  });
}

// What an alias edit outside Burrow costs: the refresh its watch runs, idle
// tasks (the read, the swap, then the re-key in slices). Before each one the alias page that
// the most indexed blocks link is made to look edited, in memory only (its
// aliases leave the current index and its block leaves the parse memo), so
// the swap parses and keys that block again and re-keys every block linking
// the page, as a real edit there would. Nothing is written to the graph.
const timeAliasRefresh = () => c.evaluate(async () => {
  const perf = window.__BURROW_PERF;
  const indexes = window.__BURROW.indexes;
  const counts = new Map();
  for (const entry of indexes.refs.entries) {
    for (const title of entry.linked || []) if (indexes.aliases.byPage.has(title)) counts.set(title, (counts.get(title) || 0) + 1);
  }
  const [page, linked] = [...counts].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const read = [];
  const swap = [];
  const rekey = [];
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const aliases = indexes.aliases;
    if (page) {
      const names = new Set(aliases.byPage.get(page) || []);
      aliases.byPage.delete(page);
      for (const name of names) aliases.memo?.keys.delete(name);
      for (const [string, list] of aliases.memo?.parsed || []) if (list.some((name) => names.has(name))) aliases.memo.parsed.delete(string);
    }
    const n = perf.counters.aliasRefreshes || 0;
    const r0 = perf.samples.aliasRead?.length || 0;
    const s0 = perf.samples.aliasRefresh?.length || 0;
    const k0 = perf.samples.aliasRekey?.length || 0;
    indexes.refreshAliases({ force: true });
    const t0 = performance.now();
    while ((perf.counters.aliasRefreshes || 0) === n && performance.now() - t0 < 5000) await new Promise((resolve) => setTimeout(resolve, 10));
    read.push(...(perf.samples.aliasRead || []).slice(r0));
    swap.push(...(perf.samples.aliasRefresh || []).slice(s0));
    rekey.push(...(perf.samples.aliasRekey || []).slice(k0));
  }
  return { read, swap, rekey, page, linked };
});

const isExpanded = () => c.evaluate(() => Boolean(document.querySelector(".rm-autocomplete__results--expanded")));
const ctrlO = async () => {
  const base = { key: "o", code: "KeyO", windowsVirtualKeyCode: 79, nativeVirtualKeyCode: 79, modifiers: 2 };
  await c.call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await c.call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(400);
};
let previewInitial = null;
async function restorePreview() {
  if ((!withPreview && !cold) || previewInitial == null) return;
  const primed = await primeFixture(c, "");
  if (!primed.ok) return;
  await c.type(cold || opener, 60);
  await sleep(500);
  if ((await isExpanded()) !== previewInitial) await ctrlO();
  await c.key("Escape");
  await sleep(300);
  await c.evaluate(async () => {
    await window.roamAlphaAPI.data.block.update({ block: { uid: window.__burrowFixture.blockUid, string: "" } });
  });
  await deleteNewPages(c);
}

const pct = (list, p) => {
  if (!list?.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
};

const report = { window: c.page.title, query: opener + query, runs, results: [] };
await setArm("gone");
report.installed = await parkInstalled(c);
if (report.installed.error) throw new Error(report.installed.error);
// One cleanup for the finally path and for SIGINT / SIGTERM / a crash.
let cleaning = null;
const cleanup = () => (cleaning ||= (async () => {
  try {
    await setArm("gone");
    await restorePreview();
    report.cleanup = await cleanupFixture(c);
  } catch (error) {
    console.error("cleanup:", error);
  } finally {
    try {
      report.restored = await unparkInstalled(c);
      if (theme) await c.setTheme(null);
    } catch (error) {
      console.error("cleanup:", error);
    }
    c.close();
  }
})());
onAbort(cleanup);
await setupFixture(c, { drillTree: drill }).then(() => snapshotTitles(c)).catch(async (error) => { await unparkInstalled(c); throw error; });

// First draws (--cold): every popup starts with nothing read, so each one's
// first preview is a cold read of the page.
async function runCold() {
  await setArm("on");
  const popups = [];
  for (let i = 0; i < runs * 4; i++) {
    const primed = await primeFixture(c, "");
    if (!primed.ok) throw new Error("fixture block not focused");
    await c.evaluate(() => window.__BURROW_PERF.reset());
    await c.type(cold, 60);
    await sleep(400);
    previewInitial ??= await isExpanded();
    if (!(await isExpanded())) await ctrlO();
    if ((await c.evaluate(() => window.__BURROW?.state.phase)) !== "OWNED") await c.key("ArrowUp");
    const r = await c.evaluate(async () => {
      const t0 = performance.now();
      let shown = null;
      while (performance.now() - t0 < 3000) {
        const pane = document.querySelector(".burrow-preview.burrow-preview-docked:not([hidden])");
        if (pane?.querySelector(".burrow-node")) { shown = { trail: pane.querySelector(".burrow-trail")?.textContent, lines: pane.querySelectorAll(".burrow-node").length }; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      const perf = window.__BURROW_PERF;
      return { shown, waited: Math.round(performance.now() - t0), slices: [...(perf.samples.preview || [])], pulls: perf.counters.drillPulls || 0, row: window.__BURROW.state.rows[window.__BURROW.state.active]?.title ?? null };
    });
    await c.key("Escape");
    await sleep(300);
    await c.evaluate(async () => {
      await window.roamAlphaAPI.data.block.update({ block: { uid: window.__burrowFixture.blockUid, string: "" } });
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    r.pages = (await deleteNewPages(c)).deleted;
    popups.push(r);
    process.stderr.write(`cold popup ${i}: ${r.slices.length} slices, max ${Math.max(0, ...r.slices).toFixed(1)} ms\n`);
  }
  const slices = popups.flatMap((p) => p.slices);
  const firsts = popups.map((p) => Math.max(0, ...p.slices));
  return {
    query: cold, popups: popups.length, shown: popups.filter((p) => p.shown).length, row: popups[0]?.row, lines: popups[0]?.shown?.lines,
    slices: slices.length, sliceP50: pct(slices, 0.5), sliceP95: pct(slices, 0.95), sliceMax: pct(slices, 1),
    worstSlicePerPopup: firsts.map((v) => +v.toFixed(1)), pullsPerPopup: popups.map((p) => p.pulls),
  };
}

if (cold) {
  try {
    report.cold = await runCold();
  } catch (error) {
    console.error("perf gate failed:", error);
    report.error = String(error?.message || error);
  } finally {
    await cleanup();
  }
  const k = report.cold;
  const pass = !report.error && k && k.shown === k.popups && k.sliceP95 <= 4;
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 1));
  else {
    console.log(`cold preview ${title} ${cold}${theme ? ` (${theme})` : ""}: ${pass ? "PASS" : "FAIL"}${report.error ? `; error: ${report.error}` : ""}`);
    if (k) {
      console.log(`  ${k.popups} popups, preview shown in ${k.shown}: ${k.row} (${k.lines} lines)`);
      console.log(`  idle slices: ${k.slices}, p50 ${k.sliceP50} ms, p95 ${k.sliceP95} ms (budget <= 4), max ${k.sliceMax} ms`);
      console.log(`  worst slice per popup: ${k.worstSlicePerPopup.join(" / ")} ms; pulls per popup: ${k.pullsPerPopup.join(" / ")}`);
    }
    console.log(`  ${report.installed.parked ? `installed Burrow: parked ${report.installed.version} for the run, ${report.restored?.restored ? "restored" : "NOT restored"}` : "installed Burrow: none in this window"}`);
  }
  process.exit(pass && (!report.installed.parked || report.restored?.restored) ? 0 : 1);
}

try {
  for (let run = 0; run < runs; run++) {
    // Interleave arms so drift in Roam's own cost hits both equally.
    for (const arm of run % 2 ? ["on", "gone"] : ["gone", "on"]) {
      const loaded = await setArm(arm);
      const start = await startRun();
      if (!start.ok) throw new Error("fixture block not focused");
      process.stderr.write(`run ${run} arm ${arm}\n`);
      await c.type(opener, 60);
      await sleep(600);
      // The index falls due for its rebuild (as after the 60 s TTL) with the
      // popup open: it must wait until the typing stops and the popup closes.
      await c.evaluate(() => window.__BURROW?.indexes?.schedule());
      if (withPreview) {
        previewInitial ??= await isExpanded();
        if (!(await isExpanded())) await ctrlO();
      }
      for (let i = 0; i < cycles; i++) {
        await c.type(query, 60);
        await sleep(120);
        for (let j = 0; j < query.length; j++) { await c.key("Backspace"); await sleep(60); }
      }
      // The preview is checked before the last Backspaces close it.
      const r = await endRun();
      r.aborted = await guardReport(c);
      if (arm === "on") r.aliasRefresh = await timeAliasRefresh();
      await c.key("Escape");
      await sleep(300);
      // Roam saved the typed `[[…]]` on Escape; empty the block so a page it
      // made has no reference left, then delete that page.
      await c.evaluate(async () => {
        const g = window.__burrowFixture;
        await window.roamAlphaAPI.data.block.update({ block: { uid: g.blockUid, string: "" } });
        await new Promise((resolve) => setTimeout(resolve, 400));
      });
      r.pages = await deleteNewPages(c);
      // The rebuild that was due all through the typing: it runs now, at the
      // first quiet moment, and its long task falls outside any typing.
      if (arm === "on") {
        r.quiet = await c.evaluate(async () => {
          const perf = window.__BURROW_PERF;
          const longs = [];
          const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) longs.push(Math.round(e.duration)); });
          po.observe({ type: "longtask" });
          const t0 = performance.now();
          while (!perf.counters.builds && performance.now() - t0 < 10000) await new Promise((resolve) => setTimeout(resolve, 50));
          const after = Math.round(performance.now() - t0);
          await new Promise((resolve) => setTimeout(resolve, 300));
          po.disconnect();
          return { built: perf.counters.builds, after, longest: Math.max(0, ...longs), deferred: perf.counters.rebuildsDeferred || 0 };
        });
      }
      report.results.push({
        run, arm, keys: r.keys, strayKeys: r.aborted, popupAtEnd: r.popup, build: loaded.build,
        paintP50: pct(r.latency, 0.5), paintP95: pct(r.latency, 0.95),
        burrowP50: pct(r.burrowInput, 0.5), burrowP95: pct(r.burrowInput, 0.95), burrowMax: pct(r.burrowInput, 1),
        renderP95: pct(r.burrowRender, 0.95), previewP95: r.preview?.p95 ?? null, previewMax: r.preview?.max ?? null, previewSamples: r.preview?.n ?? 0, burrowSamples: r.burrowInput?.length ?? 0,
        contextP95: r.context?.n ? r.context.p95 : null, contextMax: r.context?.n ? r.context.max : null, contextSamples: r.context?.n ?? 0,
        previewKinds: r.previewKinds ? Object.fromEntries(Object.entries(r.previewKinds).map(([k, v]) => [k, v?.n ? `${v.n}× p95 ${v.p95.toFixed(1)}` : "none"])) : null,
        kidChecks: r.kidChecks,
        aliasReadP95: pct(r.aliasRefresh?.read, 0.95), aliasSwapP95: pct(r.aliasRefresh?.swap, 0.95), aliasRekeyP95: pct(r.aliasRefresh?.rekey, 0.95), aliasPage: r.aliasRefresh?.page ?? null, aliasLinked: r.aliasRefresh?.linked ?? 0,
        placeP95: r.place?.p95 ?? null, placeMax: r.place?.max ?? null,
        aliasRefreshMax: pct([...(r.aliasRefresh?.read || []), ...(r.aliasRefresh?.swap || []), ...(r.aliasRefresh?.rekey || [])], 1),
        queriesDuringRun: r.queries, buildsDuringRun: r.builds, drillFetches: r.drillFetches, previewAtEnd: r.previewShown,
        quietRebuild: r.quiet ?? null,
        pagesDeleted: r.pages?.deleted,
      });
    }
  }
} catch (error) {
  console.error("perf gate failed:", error);
  report.error = String(error?.message || error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
const notRestored = report.installed.parked && !report.restored?.restored;
if (notRestored) process.exitCode = 1;
const by = (arm, key) => report.results.filter((r) => r.arm === arm).map((r) => r[key]);
report.summary = {
  paintP50: { gone: by("gone", "paintP50"), on: by("on", "paintP50") },
  paintP95: { gone: by("gone", "paintP95"), on: by("on", "paintP95") },
  burrowP50: by("on", "burrowP50"),
  burrowP95: by("on", "burrowP95"),
  previewP95: by("on", "previewP95"),
  previewMax: by("on", "previewMax"),
  kidChecks: by("on", "kidChecks"),
  aliasReadP95: by("on", "aliasReadP95"),
  aliasSwapP95: by("on", "aliasSwapP95"),
  aliasRekeyP95: by("on", "aliasRekeyP95"),
  aliasRefreshMax: by("on", "aliasRefreshMax"),
  aliasLinked: by("on", "aliasLinked"),
  placeP95: by("on", "placeP95"),
  placeMax: by("on", "placeMax"),
  queriesPerKey: by("on", "queriesDuringRun"),
  rebuildsWhileTyping: by("on", "buildsDuringRun"),
  contextP95: by("on", "contextP95"),
  contextMax: by("on", "contextMax"),
  contextSamples: by("on", "contextSamples"),
  quietRebuild: by("on", "quietRebuild"),
};
// Budget (spec §6): Burrow JS <= 4 ms p95 per input, input-to-paint p95
// within +5 ms of Burrow absent, 0 queries per key. Each run pairs its two
// adjacent arms; the verdict takes the median of the per-run deltas, so one
// burst of Roam's own work (sync, GC) in a single arm cannot decide it.
// Every run's delta is printed, so such a burst stays visible.
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const runDeltas = (key) => [...Array(runs).keys()].map((run) => {
  const arm = (name) => report.results.find((r) => r.run === run && r.arm === name)?.[key];
  return +(arm("on") - arm("gone")).toFixed(2);
}).filter((d) => Number.isFinite(d));
report.summary.paintP50Deltas = runDeltas("paintP50");
report.summary.paintP95Deltas = runDeltas("paintP95");
const previews = report.summary.previewP95.filter((v) => v != null);
const verdict = {
  burrowP95Max: Math.max(...report.summary.burrowP95),
  // The row preview's idle slices: the same 4 ms budget (spec §14).
  previewP95Max: previews.length ? Math.max(...previews) : null,
  // The alias refresh after an outside edit: one idle task, same budget.
  aliasRefreshP95Max: Math.max(...report.summary.aliasReadP95, ...report.summary.aliasSwapP95, ...report.summary.aliasRekeyP95),
  paintP50Delta: +median(report.summary.paintP50Deltas).toFixed(2),
  paintP95Delta: +median(report.summary.paintP95Deltas).toFixed(2),
  queries: Math.max(...report.summary.queriesPerKey),
  strayKeys: report.results.reduce((n, r) => n + (r.strayKeys?.length || 0), 0),
  // A due rebuild never runs while typing in an open popup (spec §15).
  rebuildsWhileTyping: Math.max(0, ...report.summary.rebuildsWhileTyping),
  // The context line's idle reads: the same 4 ms budget.
  contextP95Max: Math.max(0, ...report.summary.contextP95.filter((v) => v != null)),
};
// A run that recorded no keys (or no Burrow samples with Burrow on) measured
// nothing, so it can never count as a pass.
verdict.emptyRuns = report.results.filter((r) => !r.keys || (r.arm === "on" && !r.burrowSamples)).length
  + Math.max(0, runs * 2 - report.results.length);
verdict.pass = !report.error && verdict.emptyRuns === 0 && verdict.burrowP95Max <= 4 && verdict.paintP95Delta <= 5 && verdict.queries === 0 && verdict.strayKeys === 0
  && verdict.rebuildsWhileTyping === 0 && verdict.contextP95Max <= 4
  && verdict.aliasRefreshP95Max <= 4
  && (!withPreview || (verdict.previewP95Max != null && verdict.previewP95Max <= 4));
report.verdict = verdict;
if (args.includes("--json")) {
  console.log(JSON.stringify(report, null, 1));
} else {
  console.log(`cost gate ${title}${drill ? " (drill)" : ""}${withPreview ? " (preview open)" : ""}${theme ? ` (${theme})` : ""}: ${verdict.pass ? "PASS" : "FAIL"} (${runs} interleaved runs per arm)${report.error ? `; error: ${report.error}` : ""}`);
  console.log(`  Burrow JS per input p95: ${report.summary.burrowP95.join(" / ")} ms (budget <= 4)`);
  console.log(`  preview draw (idle slices) p95: ${report.summary.previewP95.map((v) => v ?? "none").join(" / ")} ms, max ${report.summary.previewMax.map((v) => v ?? "none").join(" / ")} ms${withPreview ? " (budget <= 4)" : ""}`);
  if (withPreview) console.log(`  preview slices by kind: ${report.results.filter((r) => r.arm === "on").map((r) => Object.entries(r.previewKinds || {}).map(([k, v]) => `${k} ${v}`).join(", ")).join(" / ")}`);
  console.log(`  has-children checks for the hint line: ${report.summary.kidChecks.join(" / ")} per run`);
  console.log(`  context line reads (idle): ${report.summary.contextSamples.join(" / ")} per run, p95 ${report.summary.contextP95.map((v) => v ?? "none").join(" / ")} ms, max ${report.summary.contextMax.map((v) => v ?? "none").join(" / ")} ms (budget <= 4)`);
  console.log(`  alias refresh after an outside edit, idle tasks p95: read ${report.summary.aliasReadP95.join(" / ")} ms, swap ${report.summary.aliasSwapP95.join(" / ")} ms, re-key slices ${report.summary.aliasRekeyP95.join(" / ")} ms (budget <= 4); max ${report.summary.aliasRefreshMax.join(" / ")} ms; the edited page is linked by ${report.summary.aliasLinked.join(" / ")} indexed blocks`);
  console.log(`  docking the preview in the frame (the strip and hint line sit in Roam's column, nothing to place) p95: ${report.summary.placeP95.map((v) => v ?? "none").join(" / ")} ms, max ${report.summary.placeMax.map((v) => v ?? "none").join(" / ")} ms`);
  console.log(`  input-to-paint median delta p50 ${verdict.paintP50Delta} ms, p95 ${verdict.paintP95Delta} ms (budget <= +5)`);
  console.log(`  per-run p95 deltas: ${report.summary.paintP95Deltas.join(" / ")} ms; Burrow-absent paint p50 ${report.summary.paintP50.gone.join(" / ")} ms`);
  console.log(`  queries per key: ${verdict.queries}; stray keys: ${verdict.strayKeys}${verdict.emptyRuns ? `; runs that measured nothing: ${verdict.emptyRuns}` : ""}`);
  console.log(`  due index rebuild: ${report.summary.rebuildsWhileTyping.join(" / ")} while typing (must be 0); ran ${report.summary.quietRebuild.map((q) => (q?.built ? `${(q.after / 1000).toFixed(1)} s after the popup closed (long task ${q.longest} ms)` : "not yet")).join(" / ")}`);
  console.log(`  ${notRestored ? `installed Burrow ${report.installed.version} not restored` : report.installed.parked ? `installed Burrow: parked ${report.installed.version} for the run, restored` : "installed Burrow: none in this window"}`);
  if (drill) {
    const on = report.results.filter((r) => r.arm === "on");
    console.log(`  drill: ${on.map((r) => r.keys).join(" / ")} keys per run, data fetches ${on.map((r) => r.drillFetches).join(" / ")} per run, preview open at the end: ${on.every((r) => r.previewAtEnd)}`);
  }
}
process.exitCode = process.exitCode || (verdict.pass ? 0 : 1);
