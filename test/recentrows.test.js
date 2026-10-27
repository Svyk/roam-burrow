import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { createFrecency } from "../src/frecency.js";
import { createLifecycle } from "../src/lifecycle.js";
import { createPerf } from "../src/perf.js";
import { buildRefIndex } from "../src/refindex.js";
import { DEFAULTS } from "../src/settings.js";
import { buildTitleIndex } from "../src/titles.js";

// Same harness pattern as test/richrows.test.js and test/stripkeys.test.js.
const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;
for (const name of ["HTMLTextAreaElement", "MutationObserver", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle"]) globalThis[name] = win[name];
const { createStrip } = await import("../src/strip.js");
after(() => win.close());

const popover = (placeholder, ...titles) => '<div class="rm-autocomplete__results"><div class="rm-autocomplete__results-main"><div class="rm-autocomplete__results-scroll">'
  + (titles.length ? titles : [placeholder]).map((t, i) => `<div title="${t}" style="${i ? "" : "background-color: rgb(225, 232, 237)"}"><div class="rm-autocomplete-result">${t}</div></div>`).join("")
  + '</div><div class="rm-autocomplete-footer">search</div></div></div>';

const frames = () => new Promise((resolve) => win.requestAnimationFrame(() => setTimeout(resolve, 0)));
const settle = async () => { for (let i = 0; i < 5; i += 1) await frames(); };

const ENTRIES = [
  ["picked001", "The picked block about zebras", 2, "Zoo"],
  ["other0002", "Another block about apples", 1, "Fruit"],
  ["fixtureU1", "The block being edited", 1, "Here"],
];
const EDITED = { blocks: [
  { uid: "edit00001", string: "Edited just now: banana bread", page: "Kitchen", t: 3 },
  { uid: "fixtureU1", string: "The block being edited", page: "Here", t: 2 },
  { uid: "other0002", string: "Another block about apples", page: "Fruit", t: 1 },
], pages: [{ uid: "pgEdit001", title: "Kitchen", t: 3 }, { uid: "pgHere001", title: "Here", t: 2 }, { uid: "pgNative1", title: "Native page", t: 1 }], builtAt: 1 };

async function harness({ value = "(())", caret = 2, settings = {}, picks = [], placeholder = "Search for a Block", natives = [], pageTitle = "Here", edited = EDITED } = {}) {
  doc.body.innerHTML = `<div data-page-title="${pageTitle}"><textarea class="rm-block-input" id="block-input-uuid-x-fixtureU1"></textarea></div>${popover(placeholder, ...natives)}`;
  const ta = doc.querySelector("textarea");
  ta.value = value;
  ta.focus();
  ta.setSelectionRange(caret, caret);
  const store = new Map();
  const frecency = createFrecency({ storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, key: "k" });
  for (const [kind, uid] of picks) frecency.record(kind, uid);
  const calls = { pull: 0, q: 0 };
  const indexes = {
    refs: buildRefIndex(ENTRIES), aliases: null, recent: edited,
    titles: buildTitleIndex([["Kitchen", "pgEdit001"], ["Here", "pgHere001"], ["Native page", "pgNative1"], ["Zoo", "pgZoo0001"]], null),
    refreshIfStale() {},
  };
  const api = { ui: { getFocusedBlock: () => ({ "block-uid": "fixtureU1" }) }, pull: () => { calls.pull += 1; return null; }, q: () => { calls.q += 1; return []; } };
  const lifecycle = createLifecycle();
  const strip = createStrip({ setting: (id) => (id in settings ? settings[id] : DEFAULTS[id]), indexes, perf: createPerf(), lifecycle, api, frecency, doc, win });
  ta.dispatchEvent(new win.Event("input", { bubbles: true }));
  await settle();
  const key = (init) => {
    const event = new win.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    ta.dispatchEvent(event);
    return event;
  };
  const type = async (text) => {
    ta.value = text;
    ta.setSelectionRange(text.length - 2, text.length - 2);
    ta.dispatchEvent(new win.Event("input", { bubbles: true }));
    await settle();
  };
  const rows = () => [...doc.querySelectorAll(".burrow-strip .burrow-row")];
  return { ta, state: strip.state, strip, key, type, rows, frecency, calls, store, dispose: () => lifecycle.dispose() };
}

async function with_(options, fn) {
  const h = await harness(options);
  try { await fn(h); } finally { await h.dispose(); }
}

test("empty (( shows the recent pick, then edits; nothing is selected and Enter is Roam's", () => with_({ picks: [["block", "picked001"]] }, async (h) => {
  const texts = h.rows().map((r) => r.title);
  assert.deepEqual(texts, ["The picked block about zebras", "Edited just now: banana bread", "Another block about apples"]);
  assert.equal(h.state.phase, "ARMED");
  assert.equal(h.state.active, -1);
  assert.equal(doc.querySelectorAll(".burrow-row.burrow-active").length, 0);
  assert.equal(h.rows()[0].querySelector("sup").textContent, "2");
  assert.equal(h.rows()[1].querySelector("sup"), null, "no count for a block nothing references");
  const enter = h.key({ key: "Enter" });
  assert.equal(enter.defaultPrevented, false);
  assert.equal(h.ta.value, "(())");
  assert.equal(h.calls.q + h.calls.pull, 0, "no query and no pull on the way");
}));

test("with the switch off an empty (( shows no rows", () => with_({ settings: { recentRows: false }, picks: [["block", "picked001"]] }, async (h) => {
  assert.equal(h.rows().length, 0);
}));

test("the block being edited is never offered", () => with_({}, async (h) => {
  assert.equal(h.rows().some((r) => r.title.includes("being edited")), false);
}));

test("one or two characters keep the rows with a word that starts with them; three leave it to the normal ranking", () => with_({ picks: [["block", "picked001"]] }, async (h) => {
  await h.type("((ba))");
  assert.deepEqual(h.rows().map((r) => r.title), ["Edited just now: banana bread"]);
  assert.equal(h.state.active, -1);
  await h.type("((zeb))");
  assert.equal(h.rows().some((r) => r.title.includes("banana")), false, "more than two characters: no recent rows");
}));

test("a recent row is never auto-selected, even with every preselect on", () => with_({ settings: { refPreselect: true, aliasPreselect: true } }, async (h) => {
  assert.ok(h.rows().length > 0);
  assert.equal(h.state.phase, "ARMED");
  assert.equal(h.state.auto, false);
}));

test("up from Roam's first row (the placeholder) moves onto the last Burrow row, and Enter inserts it and records the pick", () => with_({}, async (h) => {
  const up = h.key({ key: "ArrowUp" });
  assert.equal(up.defaultPrevented, true);
  assert.equal(h.state.phase, "OWNED");
  assert.equal(h.state.active, h.rows().length - 1);
  const enter = h.key({ key: "Enter" });
  assert.equal(enter.defaultPrevented, true);
  assert.equal(h.ta.value, "((other0002))");
  assert.deepEqual(h.frecency.recent("block", 5), ["other0002"]);
}));

test("[[ with nothing typed: page rows (picks, then edits), not the page being edited, not Roam's own rows", () => with_({ value: "[[]]", placeholder: "Search for a Page", picks: [["page", "pgZoo0001"]] }, async (h) => {
  assert.deepEqual(h.rows().map((r) => r.title), ["Zoo", "Kitchen", "Native page"]);
  assert.equal(h.state.phase, "ARMED");
  assert.equal(h.state.active, -1);
}));

test("[[ rows leave out a page Roam already lists, and Roam's placeholder title is not a page", () => with_({ value: "[[]]", placeholder: "Search for a Page", natives: ["Native page", "Kitchen"] }, async (h) => {
  assert.deepEqual(h.rows().map((r) => r.title), []);
}));

test("a page row inserts [[Title]] and records a page pick", () => with_({ value: "[[]]", placeholder: "Search for a Page" }, async (h) => {
  h.key({ key: "ArrowUp" });
  const row = h.state.active;
  h.rows()[row].dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  assert.equal(h.ta.value, "[[Native page]]");
  assert.deepEqual(h.frecency.recent("page", 3), ["pgNative1"]);
}));

test("a row Roam's own list picked is read back and recorded", () => with_({}, async (h) => {
  h.key({ key: "Enter" });
  h.ta.value = "((zzzzzzzz1)) tail";
  h.ta.dispatchEvent(new win.Event("input", { bubbles: true }));
  await settle();
  assert.deepEqual(h.frecency.recent("block", 3), ["zzzzzzzz1"]);
}));

test("a Roam pick that left no reference at the token records nothing", () => with_({}, async (h) => {
  h.key({ key: "Enter" });
  h.ta.value = "plain text";
  await settle();
  assert.deepEqual(h.frecency.recent("block", 3), []);
}));

test("with both switches off nothing is recorded", () => with_({ settings: { recentRows: false, frecency: false } }, async (h) => {
  h.key({ key: "Enter" });
  h.ta.value = "((zzzzzzzz1))";
  h.ta.dispatchEvent(new win.Event("input", { bubbles: true }));
  await settle();
  assert.equal(h.frecency.size, 0);
}));

test("forget drops the picks and the rows come back as edits only", () => with_({ picks: [["block", "picked001"]] }, async (h) => {
  assert.equal(h.rows()[0].title, "The picked block about zebras");
  h.frecency.clear();
  h.strip.forget();
  await settle();
  assert.equal(h.rows().some((r) => r.title.includes("zebras")), false);
  assert.equal(h.store.has("k"), false);
}));
