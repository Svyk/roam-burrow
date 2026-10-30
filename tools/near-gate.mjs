#!/usr/bin/env node
// Live gate for Drill from a near title (spec §30) on Roam Desktop over CDP
// (:9223). Same way of working as suggest-gate.mjs: trusted keys into one block
// of `Burrow/Fixtures`, the build loaded per arm, an installed Burrow parked
// for the run, no window reloaded. Reads other pages only.
//
//   node tools/near-gate.mjs <window-title-prefix> <svy|notes> [--only "<case>"] [--json] [--theme light|dark] [--shots <dir>]
//
// Arms: "on", "off" (drillNearTitle off), "gone" (module unloaded).
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
  "filterAllBlocks", "tagRows", "drillNearTitle", "insertVariants", "openInSidebar", "previewImages", "previewTables"];
const REF_COMMAND = "Burrow: block reference search";
const ARMS = ["on", "off", "gone"];

const [title, graph, ...flags] = process.argv.slice(2);
if (!title || !["svy", "notes"].includes(graph)) throw new Error("usage: near-gate.mjs <window-title-prefix> <svy|notes> [--only <case>] [--json] [--theme light|dark] [--shots <dir>]");
const flagValue = (name) => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : null; };
const only = flagValue("--only");
const asJson = flags.includes("--json");
const root = new URL("..", import.meta.url);
const theme = flagValue("--theme");
const shotsDir = flagValue("--shots");
const c = await connect(title);
const themeSet = theme ? await c.setTheme(theme) : null;

// `Burrow/Fixtures` has too many sibling pages to win, so the gate makes two
// pages of its own and deletes them afterwards. Only the first has the heading.
const NEAR = "Near Zq Title";
const NEAR_PAGE = `Burrow/${NEAR}`;
const NEAR_TWIN = `${NEAR_PAGE} Two`;

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
    dev.values.drillNearTitle = arm !== "off";
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

const look = () => c.evaluate(() => {
  const b = window.__BURROW;
  return {
    popup: Boolean(document.querySelector(".rm-autocomplete__results")),
    phase: b?.state.phase ?? "gone",
    drill: b?.state.drill?.page.title ?? null,
    named: document.querySelector(".burrow-strip:not([hidden])")?.textContent ?? "",
  };
});

// One popup: type, wait for `ready`, look, press the keys, read back.
async function popup(words, keys, { ready, shot } = {}) {
  const primed = await prime();
  if (!primed.ok) return { error: `focus failed: ${JSON.stringify(primed)}` };
  await c.type(`[[${words}`, TYPE_MS);
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
const show = (r) => JSON.stringify({ phase: r?.s?.phase, drill: r?.s?.drill, row: r?.s?.named, steps: r?.steps?.map((t) => [t.phase, t.drill, t.popup]), out: r?.out, error: r?.error });
const drilled = (s) => s.phase === "gone" || Boolean(s.drill);

const onRow = (r, title) => r?.s?.drill === title && r.s.named.includes(title);
const noDrill = (r) => r?.s?.drill === null && r?.s?.popup === true;
const uidOf = () => c.evaluate(() => window.roamAlphaAPI.q('[:find ?u . :where [?b :block/string "Alpha section"] [?b :block/page ?p] [?p :node/title "Burrow/Near Zq Title"] [?b :block/uid ?u]]'));
const dropNearPages = () => c.evaluate(async (titles) => {
  const api = window.roamAlphaAPI;
  for (const title of titles) { const uid = api.q(`[:find ?u . :where [?p :node/title ${JSON.stringify(title)}] [?p :block/uid ?u]]`); if (uid) await api.data.page.delete({ page: { uid } }); }
}, [NEAR_PAGE, NEAR_TWIN]);
const makeNearPages = () => c.evaluate(async ({ page, twin }) => {
  const api = window.roamAlphaAPI;
  const add = async (parent, string, heading) => { const uid = api.util.generateUID(); await api.data.block.create({ location: { "parent-uid": parent, order: "last" }, block: { uid, string, heading } }); return uid; };
  const make = async (title) => { const uid = api.util.generateUID(); await api.data.page.create({ page: { title, uid } }); return uid; };
  const alpha = await add(await make(page), "Alpha section", 2);
  await add(alpha, "alpha child");
  await add(await make(twin), "Other section", 2);
}, { page: NEAR_PAGE, twin: NEAR_TWIN });
// A real title that holds # past its start, and how much of it to type so that
// no title starts with the text (the case parseDrill's prefix check misses).
const hashTitle = () => c.evaluate(() => (window.__burrowFixture.titleSet ? [...window.__burrowFixture.titleSet] : []).find((t) => /^[\p{L}\d][^#>[\]]{3,}#/u.test(t) && t.indexOf("#") < 40) ?? null);

const CASES = [
  { name: "a near title drills: the row names the page, Enter inserts the block", arms: ["on"],
    run: async () => ({ ...await popup(`${NEAR}#alpha`, ["Enter"], { ready: drilled, shot: "row" }), uid: await uidOf() }),
    verdict: ({ on }) => failed(onRow(on, NEAR_PAGE) && on.uid && on.out?.string === `${SEED}((${on.uid}))` && !on.out.newPages.length, show(on)) },
  { name: "> steps walk down from a near title", arms: ["on"],
    run: async () => ({ ...await popup(`${NEAR}#alpha > `, ["Enter"], { ready: drilled }), uid: await uidOf() }),
    verdict: ({ on }) => failed(onRow(on, NEAR_PAGE) && /^seed αβ 🙂 \(\([^)]+\)\)$/.test(on.out?.string ?? "") && on.out.string !== `${SEED}((${on.uid}))`, show(on)) },
  { name: "the page stays while a step stops matching: Enter inserts [[Page]], no page is created", arms: ["on"],
    run: () => popup(`${NEAR}#alpha zqzq`, ["Enter"], { ready: drilled }),
    verdict: ({ on }) => failed(onRow(on, NEAR_PAGE) && on.out?.string === `${SEED}[[${NEAR_PAGE}]]` && !on.out.newPages.length, show(on)) },
  { name: "the page that is the only match drills with an empty #", arms: ["on"],
    run: () => popup(`${NEAR} Two#`, ["Escape"], { ready: drilled }),
    verdict: ({ on }) => failed(onRow(on, NEAR_TWIN), show(on)) },
  { name: "two pages match and # has no text yet: no winner, Roam's", arms: ["on"],
    run: () => popup(`${NEAR}#`, ["Escape"], { ready: () => true }),
    verdict: ({ on }) => failed(noDrill(on), show(on)) },
  { name: "Tab on the row lists the block's children, Enter inserts one", arms: ["on"],
    run: () => popup(`${NEAR}#alpha`, ["Tab", "Enter"], { ready: drilled }),
    verdict: ({ on }) => failed(on?.steps?.[0]?.phase === "SCOPE" && /^seed αβ 🙂 \(\([^)]+\)\)$/.test(on.out?.string ?? ""), show(on)) },
  { name: "Esc leaves the text as typed: same bytes as without Burrow", arms: ["on", "gone"],
    run: () => popup(`${NEAR}#alpha`, ["Escape"], { ready: (s) => s.phase === "gone" || drilled(s) }),
    verdict: ({ on, gone }) => failed(on?.out?.string === gone?.out?.string, `${show(on)} / ${show(gone)}`) },
  { name: "switch off: no drill, same bytes as without Burrow", arms: ["off", "gone"],
    run: () => popup(`${NEAR}#alpha`, ["Escape"], { ready: () => true }),
    verdict: ({ off, gone }) => failed(noDrill(off) && off.out?.string === gone?.out?.string, `${show(off)} / ${show(gone)}`) },
  { name: "without # or > nothing changes", arms: ["on"],
    run: () => popup(NEAR, ["Escape"], { ready: () => true }),
    verdict: ({ on }) => failed(noDrill(on), show(on)) },
  { name: "Name #12 is a name being typed", arms: ["on"],
    run: () => popup(`${NEAR} #12`, ["Escape"], { ready: () => true }),
    verdict: ({ on }) => failed(noDrill(on), show(on)) },
  { name: "a real title holding # stays Roam's, typed from its middle too", arms: ["on"],
    run: async () => {
      const title = await hashTitle();
      if (!title) return { skipped: true };
      return { title, ...await popup(title.slice(1), ["Escape"], { ready: () => true }) };
    },
    verdict: ({ on }) => failed(on?.skipped || noDrill(on), show(on)) },
  ...(graph === "notes" ? [
    { name: "[[Executor Lanes#grok lane > never reaches the block on the page that has the heading", arms: ["on"],
      run: () => popup("Executor Lanes#grok lane > never", ["Enter"], { ready: drilled, shot: "lanes" }),
      verdict: ({ on }) => failed(onRow(on, "Systems/Executor Lanes and LaunchAgents") && on.out?.string === `${SEED}((-EeRGLF5U))` && !on.out.newPages.length, show(on)) },
    { name: "[[Executor Lanes# alone: two pages, no winner, Roam's", arms: ["on"],
      run: () => popup("Executor Lanes#", ["Escape"], { ready: () => true }),
      verdict: ({ on }) => failed(noDrill(on), show(on)) },
  ] : []),
];
const wanted = CASES.filter((k) => !only || k.name.toLowerCase().includes(only.toLowerCase()));
if (!wanted.length) throw new Error(`unknown case ${JSON.stringify(only)}`);

const report = { window: c.page.title, graph };
let cleaning = null;
const cleanup = () => (cleaning ||= (async () => {
  try {
    await placeNormal(c).catch(() => {});
    await setArm("gone");
    await dropNearPages();
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
await dropNearPages();
await makeNearPages();
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
    for (const kase of here) {
      process.stderr.write(`arm ${arm}: ${kase.name}\n`);
      try { results.get(kase.name)[arm] = await kase.run(arm); } catch (error) { results.get(kase.name)[arm] = { error: String(error?.message || error) }; }
    }
  }
} catch (error) {
  console.error("near gate failed:", error);
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
if (asJson) console.log(JSON.stringify({ gate: "near-gate", graph, ok, passed, total: wanted.length, fatal, installed: installedLine, cases: summary }, null, 2));
else {
  for (const k of summary) { console.log(`${k.ok ? "PASS" : "FAIL"} ${k.name}`); for (const f of k.failures) console.log(`    ${f}`); }
  console.log(`near-gate ${graph}: ${ok ? "PASS" : "FAIL"} (${passed}/${wanted.length})${fatal ? `; error: ${fatal}` : ""}`);
  console.log(`  ${installedLine}`);
}
process.exitCode = ok ? 0 : 1;
