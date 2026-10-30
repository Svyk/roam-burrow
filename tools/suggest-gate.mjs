#!/usr/bin/env node
// Live gate for Burrow's Suggested links (spec §29) on Roam Desktop over CDP
// (:9223). Same way of working as tag-gate.mjs: trusted keys into one block of
// `Burrow/Fixtures`, the build loaded per arm, an installed Burrow parked for
// the run, no window reloaded. A wrapper on data.ai.suggestLinks counts calls
// and is removed afterwards.
//
//   node tools/suggest-gate.mjs <window-title-prefix> <svy|notes> [--only "<case>"] [--json] [--theme light|dark] [--shots <dir>]
//
// Arms: "on", "off" (suggestRows off), "gone" (module unloaded).
// Exit code 1 on any FAIL.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { connect, sleep } from "./cdp.mjs";
import { parkInstalled, unparkInstalled } from "./installed.mjs";
import { FIXTURE_PAGE, cleanupFixture, guardReport, onAbort, placeNormal, primeFixture, setupFixture } from "./fixture.mjs";

const SEED = "seed αβ 🙂 ";
const TYPE_MS = 30;
const FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pageBoost",
  "aliasInline", "aliasPreselect", "aliasChips", "tabDrill", "paneLayout", "keyHints",
  "rowPreview", "aliasCreate", "aliasDelete", "drillOrdinals", "drillEmpty", "drillCap", "refSearch", "refSearchHotkey",
  "helpTips", "helpSheet", "helpNudge", "refProse", "richRows", "recentRows", "frecency", "queryFilters", "aliasUsage", "aliasPrefix", "semanticRows", "semanticRelated",
  "filterAllBlocks", "tagRows", "suggestRows", "insertVariants", "openInSidebar", "previewImages", "previewTables"];
const REF_COMMAND = "Burrow: block reference search";
const ARMS = ["on", "off", "gone"];

const [title, graph, ...flags] = process.argv.slice(2);
if (!title || !["svy", "notes"].includes(graph)) throw new Error("usage: suggest-gate.mjs <window-title-prefix> <svy|notes> [--only <case>] [--json] [--theme light|dark] [--shots <dir>]");
const flagValue = (name) => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : null; };
const only = flagValue("--only");
const asJson = flags.includes("--json");
const root = new URL("..", import.meta.url);
const theme = flagValue("--theme");
const shotsDir = flagValue("--shots");
const c = await connect(title);
const themeSet = theme ? await c.setTheme(theme) : null;

// A title in the block's words, for Roam's matcher to find.
const WORDS = `${FIXTURE_PAGE} Chips and notes `;

const prime = async () => {
  let primed = await primeFixture(c, SEED);
  for (let i = 0; i < 3 && !primed.ok; i += 1) { await sleep(1000); primed = await primeFixture(c, SEED); }
  await c.evaluate(() => { const g = window.__burrowFixture; g.titleSet = new Set(window.roamAlphaAPI.q("[:find [?t ...] :where [?p :node/title ?t]]")); });
  return primed;
};

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
    dev.values.suggestRows = arm !== "off";
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
      dev.api = extensionAPI;
      await dev.module.default.onload({ extensionAPI, extension: { version: "gate" } });
    }
    const t0 = performance.now();
    if (arm === "on" || arm === "off") { await dev.module.default.onunload(); dev.module = await import(URL.createObjectURL(new Blob([code], { type: "text/javascript" }))); await dev.module.default.onload({ extensionAPI: dev.api, extension: { version: "gate" } }); }
    while (!window.__BURROW?.indexes?.aliases?.entries.length && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 100));
    return { arm, refs: window.__BURROW?.indexes?.refs?.entries.length, version: window.__BURROW?.version };
  }, { arm, code, css, features: FEATURES, refCommand: REF_COMMAND });
  return result;
}

const resetCalls = () => c.evaluate(() => { window.__burrowSuggestCalls = 0; });

const look = () => c.evaluate(() => {
  const b = window.__BURROW;
  const drawn = [...document.querySelectorAll(".burrow-strip:not([hidden]) .burrow-row")];
  const rows = drawn.length ? (b?.state.rows || []) : [];
  const native = [...document.querySelectorAll(".rm-autocomplete__results-scroll > div")];
  return {
    popup: Boolean(document.querySelector(".rm-autocomplete__results")),
    phase: b?.state.phase ?? "gone",
    titles: rows.map((r) => r.title),
    label: document.querySelector(".burrow-related:not([hidden]) .burrow-related-label")?.textContent ?? null,
    band: [...document.querySelectorAll(".burrow-related:not([hidden]) .burrow-row")].map((n) => n.textContent),
    bandActive: document.querySelector(".burrow-related .burrow-active")?.textContent ?? null,
    calls: window.__burrowSuggestCalls ?? 0,
    native: native.map((n) => n.getAttribute("title")),
    nativeActive: native.findIndex((n) => n.style.backgroundColor),
  };
});

// One popup: type, wait for `ready`, look, press the keys, read back.
async function popup(words, keys, { ready, shot } = {}) {
  const primed = await prime();
  if (!primed.ok) return { error: `focus failed: ${JSON.stringify(primed)}` };
  await c.type(words, TYPE_MS);
  let s = null;
  for (let t0 = Date.now(); Date.now() - t0 < 3000; await sleep(60)) {
    s = await look();
    if (s.popup && (!ready || ready(s))) break;
  }
  await sleep(300);
  s = await look();
  const steps = [];
  const snap = async () => {
    if (!shot || !shotsDir) return;
    const rect = await c.evaluate(() => { const r = document.querySelector(".rm-autocomplete__results")?.getBoundingClientRect(); return r ? { left: Math.max(0, r.left - 60), top: Math.max(0, r.top - 50), width: r.width + 120, height: r.height + 90 } : null; });
    if (rect) { await mkdir(shotsDir, { recursive: true }); await writeFile(join(shotsDir, `${graph}-${theme ?? "default"}-${shot}.png`), await c.screenshot(rect)); }
  };
  for (const [i, k] of keys.entries()) {
    if (i === keys.length - 1) await snap();
    if (Array.isArray(k)) await c.key(k[0], k[1]); else await c.key(k);
    await sleep(140);
    steps.push(await look());
  }
  const value = await c.evaluate(() => document.activeElement?.value ?? null);
  await sleep(150);
  const out = await readBack();
  return { s, steps, value, out };
}

const failed = (ok, detail) => (ok ? [] : [detail]);
const show = (r) => JSON.stringify({ phase: r?.s?.phase, label: r?.s?.label, band: r?.s?.band, calls: r?.s?.calls, steps: r?.steps?.map((t) => [t.phase, t.bandActive, t.popup]), out: r?.out, error: r?.error });
const arrived = (s) => s.phase === "gone" || s.band.length > 0;
const text = `${SEED}${WORDS}`;
const same = (a, b) => a?.out?.string === b?.out?.string && !a?.out?.extraStrings?.length;
const isSuggested = (r) => r?.s?.label === "Suggested" && r.s.band.length >= 1 && r.s.band.length <= 3;
const altR = ["r", 1];

const CASES = [
  { name: "an empty [[ with words in the block: up to three pages under Suggested, nothing selected, Enter is Roam's", arms: ["on", "off", "gone"],
    run: () => popup(`${WORDS}[[`, ["Enter"], { ready: arrived, shot: "band" }),
    verdict: ({ on, off, gone }) => [
      ...failed(isSuggested(on) && on.s.phase === "ARMED" && on.s.bandActive === null && on.s.calls >= 1, show(on)),
      ...failed(same(on, gone) && same(off, gone), `${show(on)} / ${show(off)} / ${show(gone)}`),
    ] },
  { name: "⌥R, Enter inserts [[Page]] in place of the token; the block's other bytes stay", arms: ["on"],
    run: () => popup(`${WORDS}[[`, [altR, "Enter"], { ready: arrived, shot: "picked" }),
    verdict: ({ on }) => failed(isSuggested(on) && on.steps[0].bandActive === on.s.band[0] && on.out?.string === `${text}[[${on.s.band[0]}]]` && !on.out.extraStrings.length && !on.out.newPages.length, show(on)) },
  { name: "⌥R, ↓, Tab inserts the second row", arms: ["on"],
    run: () => popup(`${WORDS}[[`, [altR, "ArrowDown", "Tab"], { ready: arrived }),
    verdict: ({ on }) => {
      const want = on?.s?.band[Math.min(1, (on?.s?.band.length ?? 1) - 1)];
      return failed(isSuggested(on) && on.out?.string === `${text}[[${want}]]`, show(on));
    } },
  { name: "text after the caret stays, and the band still asks about it", arms: ["on"],
    run: async () => {
      const primed = await prime();
      if (!primed.ok) return { error: JSON.stringify(primed) };
      await c.type(`${WORDS}`, TYPE_MS);
      await c.type("tail", TYPE_MS);
      for (let i = 0; i < 4; i += 1) await c.key("ArrowLeft");
      await c.type("[[", TYPE_MS);
      let s = null;
      for (let t0 = Date.now(); Date.now() - t0 < 3000; await sleep(60)) { s = await look(); if (arrived(s)) break; }
      await c.key(...altR);
      await sleep(140);
      await c.key("Enter");
      await sleep(140);
      return { s, steps: [], out: await readBack() };
    },
    verdict: ({ on }) => failed(on?.s?.band.length >= 1 && on.out?.string === `${text}[[${on.s.band[0]}]]tail`, show(on)) },
  { name: "⌥R, Esc goes back and the popup stays; a second Esc closes as Roam does: bytes unchanged", arms: ["on", "gone"],
    run: (arm) => popup(`${WORDS}[[`, arm === "on" ? [altR, "Escape", "Escape"] : ["Escape"], { ready: arrived }),
    verdict: ({ on, gone }) => [
      ...failed(on?.steps?.[0]?.bandActive !== null && on?.steps?.[1]?.phase === "ARMED" && on?.steps?.[1]?.popup === true, show(on)),
      ...failed(same(on, gone), `${show(on)} / ${show(gone)}`),
    ] },
  { name: "typing after [[ drops the band, and nothing more is asked", arms: ["on", "gone"],
    run: async (arm) => {
      const r = await popup(`${WORDS}[[`, [], { ready: arrived });
      const primed = await prime();
      if (!primed.ok) return { error: JSON.stringify(primed) };
      await c.type(`${WORDS}[[`, TYPE_MS);
      for (let t0 = Date.now(); Date.now() - t0 < 3000; await sleep(60)) if (arrived(await look())) break;
      const before = await look();
      await c.type("zq", TYPE_MS);
      await sleep(900);
      const after = await look();
      return { ...r, before, after, out: await readBack(), arm };
    },
    verdict: ({ on, gone }) => failed(on?.before?.band.length >= 1 && on.after.band.length === 0 && on.after.calls === on.before.calls && on.out?.string === gone?.out?.string, `${JSON.stringify([on?.before, on?.after])} / ${show(on)} / ${show(gone)}`) },
  { name: "#[[ and an empty block get no band and no call", arms: ["on"],
    run: async () => {
      const a = await popup(`${WORDS}#[[`, ["Escape"]);
      const before = await look();
      const b = await popup("[[", ["Escape"]);
      return { ...a, b, before };
    },
    verdict: ({ on }) => {
      const after = on?.b?.s;
      return failed(on?.s?.band.length === 0 && on.b?.s?.band.length === 0 && after.calls === on.s.calls, show(on));
    } },
  { name: "switch off: no band and no call", arms: ["off"],
    run: () => popup(`${WORDS}[[`, ["Escape"], { ready: () => true }),
    verdict: ({ off }) => failed(off?.s?.band.length === 0 && off.s.calls === 0, show(off)) },
  { name: "⌥R with no band stays Roam's: same bytes on, off and gone", arms: ["on", "off", "gone"],
    run: () => popup("[[", [altR, "Escape"], { ready: () => true }),
    verdict: ({ on, off, gone }) => failed(same(on, gone) && same(off, gone), `${show(on)} / ${show(off)} / ${show(gone)}`) },
];
const wanted = CASES.filter((k) => !only || k.name.toLowerCase().includes(only.toLowerCase()));
if (!wanted.length) throw new Error(`unknown case ${JSON.stringify(only)}`);

const report = { window: c.page.title, graph };
let cleaning = null;
const cleanup = () => (cleaning ||= (async () => {
  try {
    await placeNormal(c).catch(() => {});
    await setArm("gone");
    await c.evaluate(() => { const real = window.__burrowSuggestReal; if (real) window.roamAlphaAPI.data.ai.suggestLinks = real; delete window.__burrowSuggestReal; delete window.__burrowSuggestCalls; });
    report.cleanup = await cleanupFixture(c);
  } catch (error) {
    console.error("cleanup:", error);
  } finally {
    try { if (themeSet !== null) await c.setTheme(null); } catch (error) { console.error("cleanup:", error); }
    try { report.restored = await unparkInstalled(c); } catch (error) { console.error("cleanup:", error); }
    c.close();
  }
})());
onAbort(cleanup);

await c.evaluate(async () => {
  const dev = window.__burrowDev;
  if (dev?.module) { await dev.module.default.onunload(); dev.module = null; }
  document.getElementById("burrow-dev-css")?.remove();
});
report.installed = await parkInstalled(c);
if (report.installed.error) throw new Error(report.installed.error);
await setupFixture(c);
await c.evaluate(() => {
  const ai = window.roamAlphaAPI.data.ai;
  const real = ai.suggestLinks;
  window.__burrowSuggestReal = real;
  ai.suggestLinks = (...args) => { window.__burrowSuggestCalls = (window.__burrowSuggestCalls ?? 0) + 1; return real.apply(ai, args); };
});

const results = new Map(wanted.map((k) => [k.name, {}]));
let fatal = null;
try {
  // A pointer resting over the new rows can open a hover popover (svy) that takes the focus from the block.
  await c.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 400, y: 2 });
  await c.evaluate(() => { if (document.activeElement?.tagName === "A") document.activeElement.blur(); });
  await sleep(2500);
  for (const arm of ARMS) {
    const here = wanted.filter((k) => k.arms.includes(arm));
    if (!here.length) continue;
    await setArm(arm);
    await resetCalls();
    for (const kase of here) {
      process.stderr.write(`arm ${arm}: ${kase.name}\n`);
      try { results.get(kase.name)[arm] = await kase.run(arm); } catch (error) { results.get(kase.name)[arm] = { error: String(error?.message || error) }; }
    }
  }
} catch (error) {
  console.error("suggest gate failed:", error);
  fatal = String(error?.message || error);
} finally {
  await cleanup();
}

let passed = 0;
const summary = [];
for (const kase of wanted) {
  const failures = kase.verdict(results.get(kase.name));
  if (!failures.length) passed += 1;
  summary.push({ name: kase.name, ok: !failures.length, failures });
}
const ok = passed === wanted.length && !fatal && (!report.installed.parked || report.restored?.restored);
const installedLine = report.installed.parked ? `installed Burrow: parked ${report.installed.version}, ${report.restored?.restored ? "restored" : "NOT restored"}` : "installed Burrow: none in this window";
if (asJson) console.log(JSON.stringify({ gate: "suggest-gate", graph, ok, passed, total: wanted.length, fatal, installed: installedLine, cases: summary }, null, 2));
else {
  for (const k of summary) { console.log(`${k.ok ? "PASS" : "FAIL"} ${k.name}`); for (const f of k.failures) console.log(`    ${f}`); }
  console.log(`suggest-gate ${graph}: ${ok ? "PASS" : "FAIL"} (${passed}/${wanted.length})${fatal ? `; error: ${fatal}` : ""}`);
  console.log(`  ${installedLine}`);
}
process.exitCode = ok ? 0 : 1;
