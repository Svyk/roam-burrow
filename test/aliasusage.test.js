import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { aliasUses, buildAliasIndex, countAliasUses, groupAliasHits, matchAliases, setAliasRefs, setAliasUses } from "../src/aliases.js";
import { createFrecency } from "../src/frecency.js";
import { createLifecycle } from "../src/lifecycle.js";
import { createPerf } from "../src/perf.js";
import { buildRefIndex } from "../src/refindex.js";
import { searchPlan } from "../src/search.js";
import { DEFAULTS } from "../src/settings.js";
import { buildTitleIndex } from "../src/titles.js";

const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;
for (const name of ["HTMLTextAreaElement", "MutationObserver", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle"]) globalThis[name] = win[name];
const { createStrip } = await import("../src/strip.js");
after(() => win.close());

const ROWS = [
  ["Aliases:: zq one, zq two, zq three", "Burrow/Fixtures Alias", "pg1"],
  ["Aliases:: zq twin shared", "Burrow/Fixtures Twin A", "pgA"],
  ["Aliases:: zq twin shared", "Burrow/Fixtures Twin B", "pgB"],
];
const L = "Burrow/Fixtures Alias";
const usesRows = [
  ["pg1", "b1", `see [zq three]([[${L}]]) and [ZQ Three]([[${L}]])`],
  ["pg1", "b2", `[zq three]([[${L}]])`],
  ["pg1", "b3", `[zq two]([[${L}]]) [zq nope]([[${L}]]) [zq one]([[Other Page]]) [plain](url) [x]([[${L}]])`],
  ["pg1", "b4", `[zq three]([[${L}]])`],
  ["pgA", "b5", "[zq twin shared]([[Burrow/Fixtures Twin A]])"],
  ["pgB", "b6", "[zq twin shared]([[Burrow/Fixtures Twin B]]) [zq twin shared]([[Burrow/Fixtures Twin B]])"],
];

test("countAliasUses counts per page and alias, case-insensitive, only exact page links", () => {
  const index = buildAliasIndex(ROWS);
  const uses = countAliasUses(index, usesRows);
  assert.equal(aliasUses({ usesByAlias: uses }, "pg1", "zq three"), 4);
  assert.equal(aliasUses({ usesByAlias: uses }, "pg1", "ZQ TWO"), 1);
  assert.equal(aliasUses({ usesByAlias: uses }, "pg1", "zq one"), 0);
  assert.equal(aliasUses({ usesByAlias: uses }, "pg1", "zq nope"), 0);
  assert.equal(aliasUses({ usesByAlias: uses }, "pgB", "zq twin shared"), 2);
  assert.equal(aliasUses({ usesByAlias: uses }, "pgA", "zq twin shared"), 1);
});

test("setAliasUses orders most used first and keeps the block's order on ties", () => {
  const index = buildAliasIndex(ROWS);
  assert.deepEqual(index.pageAliases.get("pg1"), ["zq one", "zq two", "zq three"]);
  setAliasUses(index, countAliasUses(index, usesRows));
  assert.deepEqual(index.aliasesByUse.get("pg1"), ["zq three", "zq two", "zq one"]);
  setAliasUses(index, new Map([[`pg1\u0000zq one`, 2], [`pg1\u0000zq two`, 2]]));
  assert.deepEqual(index.aliasesByUse.get("pg1"), ["zq one", "zq two", "zq three"]);
  setAliasUses(index, new Map());
  assert.equal(index.aliasesByUse.size, 0);
});

test("groupAliasHits takes the use order only when asked", () => {
  const index = buildAliasIndex(ROWS);
  setAliasUses(index, countAliasUses(index, usesRows));
  const hits = matchAliases(index, searchPlan("zq one"));
  assert.deepEqual(groupAliasHits(hits, index, { byUse: true })[0].aliases, ["zq three", "zq two", "zq one"]);
  assert.deepEqual(groupAliasHits(hits, index, { byUse: false })[0].aliases, ["zq one", "zq two", "zq three"]);
  assert.deepEqual(groupAliasHits(hits, index)[0].aliases, ["zq one", "zq two", "zq three"]);
});

test("a shared alias gives one row per page, each with its own refs and uses", () => {
  const index = buildAliasIndex(ROWS);
  setAliasRefs(index, [["pgA", 3], ["pgB", 7]]);
  setAliasUses(index, countAliasUses(index, usesRows));
  const hits = matchAliases(index, searchPlan("zq twin"), { limit: Infinity });
  assert.equal(hits.length, 2);
  const rows = groupAliasHits(hits, index, { byUse: true });
  assert.equal(rows.length, 2);
  const by = Object.fromEntries(rows.map((r) => [r.uid, r]));
  assert.equal(by.pgA.title, "Burrow/Fixtures Twin A");
  assert.equal(by.pgA.refs, 3);
  assert.equal(by.pgB.title, "Burrow/Fixtures Twin B");
  assert.equal(by.pgB.refs, 7);
  assert.equal(aliasUses(index, "pgA", "zq twin shared"), 1);
  assert.equal(aliasUses(index, "pgB", "zq twin shared"), 2);
});

const popover = (...titles) => '<div class="rm-autocomplete__results"><div class="rm-autocomplete__results-main"><div class="rm-autocomplete__results-scroll">'
  + (titles.length ? titles : ["Search for a Page"]).map((t, i) => `<div title="${t}" style="${i ? "" : "background-color: rgb(225, 232, 237)"}"><div class="rm-autocomplete-result">${t}</div></div>`).join("")
  + '</div><div class="rm-autocomplete-footer">search</div></div></div>';
const frames = () => new Promise((resolve) => win.requestAnimationFrame(() => setTimeout(resolve, 0)));
const settle = async () => { for (let i = 0; i < 5; i += 1) await frames(); };

async function withStrip({ value, settings = {} }, fn) {
  doc.body.innerHTML = `<div data-page-title="Here"><textarea class="rm-block-input" id="block-input-uuid-x-fixtureU1"></textarea></div>${popover()}`;
  const ta = doc.querySelector("textarea");
  ta.value = value;
  ta.focus();
  ta.setSelectionRange(value.length - 2, value.length - 2);
  const store = new Map();
  const frecency = createFrecency({ storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, key: "k" });
  frecency.record("page", "pgHere001");
  const aliases = buildAliasIndex(ROWS);
  setAliasRefs(aliases, [["pg1", 5], ["pgA", 3], ["pgB", 7]]);
  setAliasUses(aliases, countAliasUses(aliases, usesRows));
  const indexes = {
    refs: buildRefIndex([]), aliases, recent: { blocks: [], pages: [{ uid: "pgHere001", title: "Here", t: 1 }, { uid: "pgZeb0001", title: "Zebra", t: 1 }], builtAt: 1 },
    titles: buildTitleIndex([["Here", "pgHere001"], ["Zebra", "pgZeb0001"]], aliases), refreshIfStale() {},
  };
  const api = { ui: { getFocusedBlock: () => ({ "block-uid": "fixtureU1" }) }, pull: () => null, q: () => [] };
  const lifecycle = createLifecycle();
  const strip = createStrip({ setting: (id) => (id in settings ? settings[id] : DEFAULTS[id]), indexes, perf: createPerf(), lifecycle, api, frecency, doc, win });
  try {
    ta.dispatchEvent(new win.Event("input", { bubbles: true }));
    await settle();
    await fn({ ta, state: strip.state, rows: () => [...doc.querySelectorAll(".burrow-strip .burrow-row")], key: (init) => ta.dispatchEvent(new win.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })) });
  } finally { await lifecycle.dispose(); }
}

const chips = () => [...doc.querySelectorAll(".burrow-chip")];

test("chips follow the use order, with ×N in their tip; off keeps the block's order", async () => {
  await withStrip({ value: "[[zq one]]" }, async (h) => {
    assert.equal(h.state.phase, "OWNED");
    assert.deepEqual(chips().map((c) => c.textContent), ["zq three", "zq two", "zq one"]);
    assert.deepEqual(chips().map((c) => c.title), ["zq three ×4", "zq two ×1", "zq one"]);
  });
  await withStrip({ value: "[[zq one]]", settings: { aliasUsage: false } }, async () => {
    assert.deepEqual(chips().map((c) => c.title), ["zq one", "zq two", "zq three"]);
  });
});

test("⌥↓ enters chip mode on the matched alias in the new order", async () => {
  await withStrip({ value: "[[zq one]]" }, async (h) => {
    h.key({ key: "ArrowDown", altKey: true });
    await settle();
    assert.equal(h.state.chip, 2);
    assert.equal(chips()[2].textContent, "zq one");
  });
});

test("[[alias:zq lists only alias rows, no recent rows, and is preselected", async () => {
  await withStrip({ value: "[[alias:zq]]" }, async (h) => {
    const rows = h.rows();
    assert.ok(rows.length > 0 && rows.length <= 3);
    assert.ok(rows.every((r) => r.querySelector(".burrow-arrow")), "alias rows only");
    assert.equal(h.state.aliasOnly, "zq");
  });
  await withStrip({ value: "[[Alias: zq twin]]" }, async (h) => {
    assert.equal(h.rows().length, 2, "one row per page for a shared alias");
    assert.equal(h.state.phase, "OWNED");
  });
  await withStrip({ value: "[[alias:]]" }, async (h) => {
    assert.equal(h.rows().length, 0);
  });
  await withStrip({ value: "[[alias:z]]" }, async (h) => {
    assert.ok(h.rows().length > 0, "one character is enough");
  });
});

test("aliasPrefix off: [[alias:zq is an ordinary search", async () => {
  await withStrip({ value: "[[alias:zq]]", settings: { aliasPrefix: false } }, async (h) => {
    assert.equal(h.state.aliasOnly, null);
    assert.equal(h.rows().length, 0);
  });
});

test("Enter on a prefix row replaces the whole [[alias:zq]] token", async () => {
  await withStrip({ value: "go [[alias:zq one]] now" }, async (h) => {
    h.ta.setSelectionRange(h.ta.value.indexOf("]]"), h.ta.value.indexOf("]]"));
    h.ta.dispatchEvent(new win.Event("input", { bubbles: true }));
    await settle();
    assert.equal(h.state.phase, "OWNED");
    h.key({ key: "Enter" });
    await settle();
    assert.equal(h.ta.value, "go [zq one]([[Burrow/Fixtures Alias]]) now");
  });
});
