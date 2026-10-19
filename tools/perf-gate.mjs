#!/usr/bin/env node
// Cost budget gate (spec §6) on a live Roam Desktop window over CDP.
// Types ~200 trusted keys with Roam's (( popup open into one block on
// `Burrow/Fixtures` (typing a query, then deleting it again), per arm:
//   gone - Burrow not loaded; on - Burrow loaded, every feature on.
// Per key: keydown timeStamp -> end of the next frame (a MessageChannel task
// posted from requestAnimationFrame). Burrow's own handler time comes from
// window.__BURROW_PERF. Datalog queries and pulls per key must be zero.
// --drill types into a drill expression on the fixture's heading tree instead
// (`[[Burrow/Fixtures#alpha > ` then the query), with the preview open; data
// fetched by the drill (one pull per node it visits) is reported separately.
//   node tools/perf-gate.mjs <window-title-prefix> [--runs 3] [--query "ant man"] [--drill] [--json]
import { readFile } from "node:fs/promises";
import { connect, sleep } from "./cdp.mjs";
import { FIXTURE_PAGE, cleanupFixture, deleteNewPages, guardReport, primeFixture, setupFixture, snapshotTitles } from "./fixture.mjs";

const args = process.argv.slice(2);
const title = args[0];
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const runs = Number(flag("--runs", 3));
const drill = args.includes("--drill");
const query = flag("--query", drill ? "never > grand" : "ant man");
const opener = drill ? `[[${FIXTURE_PAGE}#alpha > ` : "((";
const cycles = Math.ceil(200 / (query.length * 2));
const root = new URL("..", import.meta.url);
const c = await connect(title);

const code = await readFile(new URL("extension.js", root), "utf8");
const css = await readFile(new URL("extension.css", root), "utf8");

async function setArm(arm) {
  return c.evaluate(async ({ arm, code, css }) => {
    const dev = window.__burrowDev || (window.__burrowDev = { values: {} });
    if (dev.module) { await dev.module.default.onunload(); dev.module = null; }
    document.getElementById("burrow-dev-css")?.remove();
    if (arm === "gone") return { arm };
    for (const f of ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pageBoost", "aliasInline", "aliasPreselect", "aliasChips", "tabDrill", "paneLayout", "keyHints"]) dev.values[f] = true;
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
      queries: perf ? perf.counters.queries : null,
      drillFetches: perf ? (perf.counters.drillPulls || 0) + (perf.counters.drillQueries || 0) : null,
      previewShown: Boolean(document.querySelector(".burrow-preview:not([hidden]) .burrow-target")),
      builds: perf ? perf.counters.builds : null,
      popup: Boolean(document.querySelector(".rm-autocomplete__results")),
    };
  });
}

const pct = (list, p) => {
  if (!list?.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
};

const report = { window: c.page.title, query: opener + query, runs, results: [] };
await setupFixture(c, { drillTree: drill });
await snapshotTitles(c);
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
      for (let i = 0; i < cycles; i++) {
        await c.type(query, 60);
        await sleep(120);
        for (let j = 0; j < query.length; j++) { await c.key("Backspace"); await sleep(60); }
      }
      // The preview is checked before the last Backspaces close it.
      const r = await endRun();
      r.aborted = await guardReport(c);
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
      report.results.push({
        run, arm, keys: r.keys, strayKeys: r.aborted, popupAtEnd: r.popup, build: loaded.build,
        paintP50: pct(r.latency, 0.5), paintP95: pct(r.latency, 0.95),
        burrowP50: pct(r.burrowInput, 0.5), burrowP95: pct(r.burrowInput, 0.95), burrowMax: pct(r.burrowInput, 1),
        renderP95: pct(r.burrowRender, 0.95), burrowSamples: r.burrowInput?.length ?? 0,
        queriesDuringRun: r.queries, buildsDuringRun: r.builds, drillFetches: r.drillFetches, previewAtEnd: r.previewShown,
        pagesDeleted: r.pages?.deleted,
      });
    }
  }
} catch (error) {
  console.error("perf gate failed:", error);
  report.error = String(error?.message || error);
  process.exitCode = 1;
} finally {
  await setArm("gone");
  report.cleanup = await cleanupFixture(c);
  c.close();
}
const by = (arm, key) => report.results.filter((r) => r.arm === arm).map((r) => r[key]);
report.summary = {
  paintP50: { gone: by("gone", "paintP50"), on: by("on", "paintP50") },
  paintP95: { gone: by("gone", "paintP95"), on: by("on", "paintP95") },
  burrowP50: by("on", "burrowP50"),
  burrowP95: by("on", "burrowP95"),
  queriesPerKey: by("on", "queriesDuringRun"),
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
const verdict = {
  burrowP95Max: Math.max(...report.summary.burrowP95),
  paintP50Delta: +median(report.summary.paintP50Deltas).toFixed(2),
  paintP95Delta: +median(report.summary.paintP95Deltas).toFixed(2),
  queries: Math.max(...report.summary.queriesPerKey),
  strayKeys: report.results.reduce((n, r) => n + (r.strayKeys?.length || 0), 0),
};
// A run that recorded no keys (or no Burrow samples with Burrow on) measured
// nothing, so it can never count as a pass.
verdict.emptyRuns = report.results.filter((r) => !r.keys || (r.arm === "on" && !r.burrowSamples)).length
  + Math.max(0, runs * 2 - report.results.length);
verdict.pass = !report.error && verdict.emptyRuns === 0 && verdict.burrowP95Max <= 4 && verdict.paintP95Delta <= 5 && verdict.queries === 0 && verdict.strayKeys === 0;
report.verdict = verdict;
if (args.includes("--json")) {
  console.log(JSON.stringify(report, null, 1));
} else {
  console.log(`cost gate ${title}${drill ? " (drill)" : ""}: ${verdict.pass ? "PASS" : "FAIL"} (${runs} interleaved runs per arm)${report.error ? `; error: ${report.error}` : ""}`);
  console.log(`  Burrow JS per input p95: ${report.summary.burrowP95.join(" / ")} ms (budget <= 4)`);
  console.log(`  input-to-paint median delta p50 ${verdict.paintP50Delta} ms, p95 ${verdict.paintP95Delta} ms (budget <= +5)`);
  console.log(`  per-run p95 deltas: ${report.summary.paintP95Deltas.join(" / ")} ms; Burrow-absent paint p50 ${report.summary.paintP50.gone.join(" / ")} ms`);
  console.log(`  queries per key: ${verdict.queries}; stray keys: ${verdict.strayKeys}${verdict.emptyRuns ? `; runs that measured nothing: ${verdict.emptyRuns}` : ""}`);
  if (drill) {
    const on = report.results.filter((r) => r.arm === "on");
    console.log(`  drill: ${on.map((r) => r.keys).join(" / ")} keys per run, data fetches ${on.map((r) => r.drillFetches).join(" / ")} per run, preview open at the end: ${on.every((r) => r.previewAtEnd)}`);
  }
}
process.exitCode = process.exitCode || (verdict.pass ? 0 : 1);
