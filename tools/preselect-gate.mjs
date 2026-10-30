#!/usr/bin/env node
// Live gate for `((` pre-select and exact hits (spec §27) on Roam Desktop over
// CDP (:9223). Same way of working as wide-gate.mjs: trusted keys into one block
// of `Burrow/Fixtures`, the build loaded per arm, an installed Burrow parked for
// the run, no window reloaded.
//
//   node tools/preselect-gate.mjs <window-title-prefix> <svy|notes> [--only "<case>"] [--json]
//
// Arms: "on", "off" (refPreselect off), "gone" (module unloaded). The gate's own
// blocks live on the fixture page and are deleted at the end and on abort. A
// plain fixture: the drill tree is ~570 blocks, and setup plus cleanup of it in
// one minute hits Roam's limit of 1,500 writes a minute.
// Exit code 1 on any FAIL.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect, sleep } from "./cdp.mjs";
import { parkInstalled, unparkInstalled } from "./installed.mjs";
import { cleanupFixture, guardReport, onAbort, placeNormal, primeFixture, setupFixture } from "./fixture.mjs";

const SEED = "seed αβ 🙂 ";
const TYPE_MS = 30;
const FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pageBoost",
  "aliasInline", "aliasPreselect", "aliasChips", "tabDrill", "paneLayout", "keyHints",
  "rowPreview", "aliasCreate", "aliasDelete", "drillOrdinals", "drillEmpty", "drillCap", "refSearch", "refSearchHotkey",
  "helpTips", "helpSheet", "helpNudge", "refProse", "richRows", "recentRows", "frecency", "queryFilters", "aliasUsage", "aliasPrefix", "semanticRows", "semanticRelated",
  "filterAllBlocks"];
const REF_COMMAND = "Burrow: block reference search";
const ARMS = ["on", "off", "gone"];

const [title, graph, ...flags] = process.argv.slice(2);
if (!title || !["svy", "notes"].includes(graph)) throw new Error("usage: preselect-gate.mjs <window-title-prefix> <svy|notes> [--only <case>] [--json]");
const flagValue = (name) => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : null; };
const only = flagValue("--only");
const asJson = flags.includes("--json");
const root = new URL("..", import.meta.url);
const c = await connect(title);

const UID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const newUid = () => Array.from(randomBytes(9), (b) => UID_CHARS[b % UID_CHARS.length]).join("");
const tag = newUid().replace(/[^a-z]/gi, "").slice(0, 5).toLowerCase() || "gate";
const EXACT = `quokka ${tag} lantern`;
const ELSEWHERE = `walrus ${tag} compass`;
const B = { exact: newUid(), more: newUid(), plain: newUid(), near: newUid(), target: newUid(), r1: newUid(), r2: newUid(), r3: newUid(), r4: newUid(), r5: newUid() };
const BLOCKS = [
  [B.exact, EXACT], // referenced most: Burrow's top row
  [B.more, `${EXACT} and more`],
  [B.plain, ELSEWHERE], // unreferenced: only Roam lists it
  [B.near, `${ELSEWHERE} notes`], // referenced: Burrow's top row for ELSEWHERE
  [B.target, `ibis ${tag} target`], // unreferenced, reached by its uid
  [B.r1, `see ((${B.exact}))`], [B.r2, `also ((${B.exact}))`], [B.r3, `and ((${B.exact}))`], [B.r4, `see ((${B.more}))`], [B.r5, `see ((${B.near}))`],
];
const UIDS = BLOCKS.map(([uid]) => uid);

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
    if (arm === "off") dev.values.refPreselect = false;
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
    while (!window.__BURROW?.indexes?.refs && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 100));
    return { arm, refs: window.__BURROW?.indexes?.refs?.entries.length, version: window.__BURROW?.version };
  }, { arm, code, css, features: FEATURES, refCommand: REF_COMMAND });
  return result;
}

const look = () => c.evaluate(() => {
  const b = window.__BURROW;
  const drawn = [...document.querySelectorAll(".burrow-strip:not([hidden]) .burrow-row")];
  const rows = drawn.length ? (b?.state.rows || []) : [];
  const native = [...document.querySelectorAll(".rm-autocomplete__results-scroll > div")];
  return {
    popup: Boolean(document.querySelector(".rm-autocomplete__results")),
    phase: b?.state.phase ?? "gone",
    uids: rows.map((r) => r.uid),
    activeUid: b?.state.phase === "OWNED" ? rows[b.state.active]?.uid ?? null : null,
    native: native.map((n) => n.getAttribute("title")),
    nativeActive: native.findIndex((n) => n.style.backgroundColor),
  };
});

// One popup: type, wait for `ready`, look, press the keys, read back.
async function popup(query, keys, { ready, fast } = {}) {
  const primed = await prime();
  if (!primed.ok) return { error: `focus failed: ${JSON.stringify(primed)} ${JSON.stringify(await c.evaluate(() => ({ active: document.activeElement?.tagName, id: document.activeElement?.id, hasFocus: document.hasFocus(), visible: document.visibilityState, selected: document.querySelectorAll(".block-highlight-blue").length, input: Boolean(document.getElementById(window.__burrowFixture.inputId)) })))}` };
  await c.type("((", TYPE_MS);
  await c.type(query, TYPE_MS);
  let s = null;
  if (!fast) {
    for (let t0 = Date.now(); Date.now() - t0 < 4000; await sleep(60)) {
      s = await look();
      if (!ready || ready(s)) break;
    }
    await sleep(300);
    s = await look();
  }
  for (const k of keys) { await c.key(k); await sleep(fast ? 0 : 120); }
  const value = await c.evaluate(() => document.activeElement?.value ?? null);
  await sleep(150);
  const out = await readBack();
  return { s, value, out };
}

const listed = (text) => (s) => s.native.filter((t) => t === text).length >= 1 && s.native.length > 2;
const stored = (uid) => `${SEED}((${uid}))`;
const newBlock = `${SEED}((<new>))`;
const failed = (ok, detail) => (ok ? [] : [detail]);
const show = (r) => JSON.stringify({ phase: r?.s?.phase, rows: r?.s?.uids, active: r?.s?.activeUid, out: r?.out, error: r?.error });
const clean = (r, string) => r?.out?.string === string && !r.out.extraStrings.length && !r.out.newPages.length;
const created = (r, text) => r?.out?.string === newBlock && r.out.extraStrings.length === 1 && r.out.extraStrings[0] === text;

const CASES = [
  { name: "uid: the block is Burrow's first row, selected; Enter inserts it, nothing created", arms: ["on"],
    run: () => popup(B.target, ["Enter"], { ready: (s) => s.uids.length }),
    verdict: ({ on }) => failed(on?.s?.activeUid === B.target && clean(on, stored(B.target)), show(on)) },
  { name: "uid: Enter at once, before Roam's list arrives", arms: ["on"],
    run: () => popup(B.target, ["Enter"], { fast: true }),
    verdict: ({ on }) => failed(clean(on, stored(B.target)), show(on)) },
  { name: "uid: pre-select off and Burrow gone: Roam's Enter creates its block (baseline)", arms: ["off", "gone"],
    run: () => popup(B.target, ["Enter"], { ready: listed(`ibis ${tag} target`) }),
    verdict: ({ off, gone }) => [...failed(created(off, B.target), `off ${show(off)}`), ...failed(created(gone, B.target), `gone ${show(gone)}`)] },
  { name: "uid: Esc leaves the text byte for byte", arms: ["on", "gone"],
    run: () => popup(B.target, ["Escape"], { ready: listed(`ibis ${tag} target`) }),
    verdict: ({ on, gone }) => failed(clean(on, `${SEED}((${B.target}))`) && clean(gone, `${SEED}((${B.target}))`), `${show(on)} / ${show(gone)}`) },
  { name: "uid: ↓ past the row, then Esc: the text stays", arms: ["on"],
    run: async () => { const r = await popup(B.target, ["ArrowDown", "Escape"], { ready: (s) => s.uids.length && s.native.length > 2 }); return r; },
    verdict: ({ on }) => failed(on?.s?.activeUid === B.target && clean(on, stored(B.target)), show(on)) },
  { name: "page uid: no row, Esc byte for byte", arms: ["on"],
    run: async () => { const uid = await c.evaluate(() => window.__burrowFixture.pageUid); return { uid, ...(await popup(uid, ["Escape"], { ready: (s) => s.native.length >= 2 })) }; },
    verdict: ({ on }) => failed(on?.s?.uids.length === 0 && clean(on, `${SEED}((${on.uid}))`), show(on)) },
  { name: "exact text, top row is that block: stays selected, Enter inserts it", arms: ["on"],
    run: () => popup(EXACT, ["Enter"], { ready: listed(EXACT) }),
    verdict: ({ on }) => failed(on?.s?.activeUid === B.exact && clean(on, stored(B.exact)), show(on)) },
  { name: "exact text in a block only Roam lists: nothing selected, Enter is Roam's", arms: ["on", "gone"],
    run: () => popup(ELSEWHERE, ["Enter"], { ready: listed(ELSEWHERE) }),
    verdict: ({ on, gone }) => [
      ...failed(on?.s?.uids[0] === B.near && on.s.phase === "ARMED" && created(on, ELSEWHERE), show(on)),
      ...failed(created(gone, ELSEWHERE), `gone ${show(gone)}`),
    ] },
  { name: "partial text: the referenced original stays selected", arms: ["on"],
    run: () => popup(ELSEWHERE.slice(0, -2), ["Enter"], { ready: (s) => s.uids.length && s.native.length > 2 }),
    verdict: ({ on }) => failed(on?.s?.activeUid === B.near && clean(on, stored(B.near)), show(on)) },
];
const wanted = CASES.filter((k) => !only || k.name.toLowerCase().includes(only.toLowerCase()));
if (!wanted.length) throw new Error(`unknown case ${JSON.stringify(only)}`);

const report = { window: c.page.title, graph };
const deleteBlocks = () => c.evaluate(async (uids) => {
  const api = window.roamAlphaAPI;
  for (const uid of uids) if (api.q(`[:find ?e . :where [?e :block/uid "${uid}"]]`)) await api.data.block.delete({ block: { uid } });
}, UIDS).catch(() => {});
let cleaning = null;
const cleanup = () => (cleaning ||= (async () => {
  try {
    await placeNormal(c).catch(() => {});
    await setArm("gone");
    await deleteBlocks();
    report.cleanup = await cleanupFixture(c);
  } catch (error) {
    console.error("cleanup:", error);
  } finally {
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

const results = new Map(wanted.map((k) => [k.name, {}]));
let fatal = null;
try {
  await c.evaluate(async (blocks) => {
    const api = window.roamAlphaAPI;
    const g = window.__burrowFixture;
    for (const [uid, string] of blocks) {
      await api.data.block.create({ location: { "parent-uid": g.pageUid, order: "last" }, block: { uid, string } });
      g.keepAll.push(uid);
    }
  }, BLOCKS);
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
  console.error("preselect gate failed:", error);
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
if (asJson) console.log(JSON.stringify({ gate: "preselect-gate", graph, ok, passed, total: wanted.length, fatal, installed: installedLine, cases: summary }, null, 2));
else {
  for (const k of summary) { console.log(`${k.ok ? "PASS" : "FAIL"} ${k.name}`); for (const f of k.failures) console.log(`    ${f}`); }
  console.log(`preselect-gate ${graph}: ${ok ? "PASS" : "FAIL"} (${passed}/${wanted.length})${fatal ? `; error: ${fatal}` : ""}`);
  console.log(`  ${installedLine}`);
}
process.exitCode = ok ? 0 : 1;
