import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { buildAliasIndex } from "../src/aliases.js";
import { createFrecency } from "../src/frecency.js";
import { createLifecycle } from "../src/lifecycle.js";
import { createPerf } from "../src/perf.js";
import { buildRefIndex } from "../src/refindex.js";
import { DEFAULTS } from "../src/settings.js";
import { buildTitleIndex } from "../src/titles.js";

// Same harness pattern as test/preselectexact.test.js, with Roam's # popup as
// measured 2026-10-30: the same popover, no row highlighted.
const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;
for (const name of ["HTMLTextAreaElement", "MutationObserver", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle"]) globalThis[name] = win[name];
const { createStrip } = await import("../src/strip.js");
after(() => win.close());

const frames = () => new Promise((resolve) => win.requestAnimationFrame(() => setTimeout(resolve, 0)));
const settle = async () => { for (let i = 0; i < 5; i += 1) await frames(); };

const row = (title) => `<div title="${title}" class="dont-unfocus-block"><div class="rm-autocomplete-result"><span>${title}</span></div></div>`;
const popover = (inner) => `<div class="rm-autocomplete__results"><div class="rm-aliases"></div><div class="rm-autocomplete__results-main"><div class="rm-autocomplete__results-scroll">${inner}</div></div></div>`;

const TITLES = [["Systems/Lanes", "pgLanes01"], ["Systems/Roam", "pgRoam001"], ["Systems/Zed", "pgZed0001"], ["Other", "pgOther01"], ["Environmental Monitoring Program", "pgEmp0001"]];
const ALIAS_ROWS = [["Aliases:: enviro watch, EMP", "Environmental Monitoring Program", "pgEmp0001"]];

async function harness({ value, caret = value.length, settings = {}, natives = row("No pages found."), picks = [], before }) {
  doc.body.innerHTML = `<div data-page-title="Here"><textarea class="rm-block-input" id="block-input-uuid-x-fixtureU1"></textarea></div>${popover(natives)}`;
  const ta = doc.querySelector("textarea");
  ta.value = value;
  ta.focus();
  ta.setSelectionRange(caret, caret);
  const store = new Map();
  const frecency = createFrecency({ storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, key: "k" });
  for (const uid of picks) frecency.record("page", uid);
  const aliases = buildAliasIndex(ALIAS_ROWS, "Aliases");
  const indexes = {
    refs: buildRefIndex([]), aliases, recent: { blocks: [], pages: [], builtAt: 1 },
    titles: buildTitleIndex(TITLES, aliases), refreshIfStale() {},
  };
  before?.(indexes);
  const api = { ui: { getFocusedBlock: () => ({ "block-uid": "fixtureU1" }) }, pull: () => null, q: () => [] };
  const lifecycle = createLifecycle();
  const strip = createStrip({ setting: (id) => (id in settings ? settings[id] : DEFAULTS[id]), indexes, perf: createPerf(), lifecycle, api, frecency, doc, win });
  ta.dispatchEvent(new win.Event("input", { bubbles: true }));
  await settle();
  const key = (name, init = {}) => { const e = new win.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }); ta.dispatchEvent(e); return e; };
  return { ta, state: strip.state, frecency, key, rows: () => [...doc.querySelectorAll(".burrow-strip:not([hidden]) .burrow-row")], dispose: () => lifecycle.dispose() };
}

async function with_(options, fn) {
  const h = await harness(options);
  try { await fn(h); } finally { await h.dispose(); }
}

test("an alias in # shows its page, nothing selected, and Enter stays Roam's", () => with_({ value: "x #enviro" }, async (h) => {
  assert.equal(h.rows().length, 1);
  assert.equal(h.state.rows[0].uid, "pgEmp0001");
  assert.equal(h.state.phase, "ARMED");
  assert.equal(h.key("Enter").defaultPrevented, false);
  assert.equal(h.ta.value, "x #enviro");
}));

test("↑ moves onto the row and Enter inserts #[[Page]], not an alias label", () => with_({ value: "x #enviro" }, async (h) => {
  assert.equal(h.key("ArrowUp").defaultPrevented, true);
  assert.equal(h.state.phase, "OWNED");
  assert.equal(h.key("Enter").defaultPrevented, true);
  assert.equal(h.ta.value, "x #[[Environmental Monitoring Program]]");
}));

test("in #[[ the # stays and the row inserts [[Page]]", () => with_({ value: "x #[[enviro]]", caret: 11 }, async (h) => {
  h.key("ArrowUp");
  h.key("Enter");
  assert.equal(h.ta.value, "x #[[Environmental Monitoring Program]]");
}));

test("a forgiving match reaches the alias row", () => with_({ value: "#eviro" }, async (h) => {
  assert.equal(h.state.rows[0]?.uid, "pgEmp0001");
}));

test("no alias: prefix and no drill in a tag", async () => {
  await with_({ value: "#[[alias:enviro]]", caret: 15 }, async (h) => { assert.equal(h.state.aliasOnly, null); });
  await with_({ value: "#[[Other#x]]", caret: 10 }, async (h) => { assert.equal(h.state.drill, null); });
});

test("#ns:Systems/ lists pages under it, picked first, each inserting #[[Page]]", () => with_({ value: "#ns:Systems/", picks: ["pgZed0001"] }, async (h) => {
  assert.deepEqual(h.state.rows.map((r) => r.title), ["Systems/Zed", "Systems/Lanes", "Systems/Roam"]);
  h.key("ArrowUp");
  h.key("ArrowUp");
  h.key("ArrowUp");
  h.key("Enter");
  assert.equal(h.ta.value, "#[[Systems/Zed]]");
}));

test("#ns:Systems/la narrows to titles going on that way, without case", () => with_({ value: "#ns:systems/la" }, async (h) => {
  assert.deepEqual(h.state.rows.map((r) => r.title), ["Systems/Lanes"]);
}));

test("a recent page in # inserts #[[Page]]", () => with_({ value: "#ot", picks: ["pgOther01"] }, async (h) => {
  assert.equal(h.state.rows[0]?.title, "Other");
  h.key("ArrowUp");
  h.key("Enter");
  assert.equal(h.ta.value, "#[[Other]]");
}));

test("no chips, no embed, no label, no Tab drill on a # row", () => with_({ value: "#enviro" }, async (h) => {
  h.key("ArrowUp");
  assert.equal(doc.querySelector(".burrow-chip"), null);
  assert.equal(h.key("Enter", { shiftKey: true }).defaultPrevented, false);
  assert.equal(h.key("Enter", { altKey: true }).defaultPrevented, false);
  assert.equal(h.ta.value, "#enviro");
  h.key("Tab");
  assert.notEqual(h.state.phase, "SCOPE");
  assert.equal(h.ta.value, "#[[Environmental Monitoring Program]]");
}));

test("Esc on a # row gives the selection back; the text stays", () => with_({ value: "#enviro" }, async (h) => {
  h.key("ArrowUp");
  h.key("Escape");
  assert.equal(h.state.phase, "ARMED");
  assert.equal(h.ta.value, "#enviro");
}));

test("with the switch off the popup is Roam's: no row in # or #[[", async () => {
  await with_({ value: "#enviro", settings: { tagRows: false } }, async (h) => {
    assert.equal(h.state.token, null);
    assert.equal(h.key("ArrowUp").defaultPrevented, false);
  });
  await with_({ value: "#[[enviro]]", caret: 9, settings: { tagRows: false } }, async (h) => {
    assert.equal(h.rows().length, 0);
  });
});

test("a page Roam's # list already holds gets no second row", () => with_({ value: "#ns:systems/", natives: row("Systems/Lanes"), }, async (h) => {
  assert.deepEqual(h.rows().map((n) => n.title), ["Systems/Roam", "Systems/Zed"]);
}));
