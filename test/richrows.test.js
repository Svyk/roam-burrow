import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { createLifecycle } from "../src/lifecycle.js";
import { createPerf } from "../src/perf.js";
import { buildRefIndex } from "../src/refindex.js";
import { DEFAULTS } from "../src/settings.js";

// Same harness pattern as test/stripkeys.test.js: strip.js takes the textarea
// value setter from the global at import.
const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;
for (const name of ["HTMLTextAreaElement", "MutationObserver", "Event", "KeyboardEvent", "getComputedStyle"]) globalThis[name] = win[name];
const { createStrip } = await import("../src/strip.js");
after(() => win.close());

const POPOVER = '<div class="rm-autocomplete__results"><div class="rm-autocomplete__results-main"><div class="rm-autocomplete__results-scroll">'
  + '<div title="x" style="background-color: rgb(225, 232, 237)"><div class="rm-autocomplete-result">x</div></div></div>'
  + '<div class="rm-autocomplete-footer">Block search</div></div></div>';

const frames = () => new Promise((resolve) => win.requestAnimationFrame(() => setTimeout(resolve, 0)));
const settle = async () => { for (let i = 0; i < 4; i += 1) await frames(); };

const LONG = `${"filler words that go on ".repeat(12)}and then the quokka appears here`;
const ENTRIES = [
  ["xkeryyXeP", "```r\n# Load required libraries\nlibrary(ggplot2)\nzebra_plot <- function(d) d\n```", 1],
  ["rich00001", "zebra **bold** `x()` [[Burrow/Fixtures]] #[[Burrow/Fixtures]] ((rich00002)) {{embed: ((rich00002))}} {{⇥🕞:SmartBlock:Elapsed time}} <img src=x onerror=alert(1)>", 1],
  ["rich00002", "zebra target text", 1],
  ["rich00003", LONG, 1],
];

async function withQuery(query, overrides, fn) {
  doc.body.innerHTML = `<textarea class="rm-block-input" id="block-input-uuid-x-fixtureU1"></textarea>${POPOVER}`;
  const ta = doc.querySelector("textarea");
  ta.value = query;
  ta.focus();
  ta.setSelectionRange(query.length, query.length);
  const indexes = { refs: buildRefIndex(ENTRIES), aliases: null, titles: null, refreshIfStale() {} };
  const api = { ui: { getFocusedBlock: () => ({ "block-uid": "fixtureU1" }) }, pull: () => null, q: () => [] };
  const lifecycle = createLifecycle();
  createStrip({ setting: (id) => (id in overrides ? overrides[id] : DEFAULTS[id]), indexes, perf: createPerf(), lifecycle, api, doc, win });
  ta.dispatchEvent(new win.Event("input", { bubbles: true }));
  await settle();
  try { await fn(); } finally { await lifecycle.dispose(); }
}

const strip = () => doc.querySelector(".burrow-strip");
const row = (n = 0) => doc.querySelectorAll(".burrow-strip .burrow-row")[n];

test("(( on a code block's line: the language label and the matched line of code, no fences", () => withQuery("((zebra_plot", {}, async () => {
  const r = row();
  assert.equal(r.querySelector(".burrow-label").textContent, "R");
  assert.equal(r.querySelector(".burrow-code").textContent, "zebra_plot <- function(d) d");
  assert.ok(!r.textContent.includes("```"));
}));

test("(( on a marked-up block: styles, refs, tags, block refs and labels; block text never becomes elements", () => withQuery("((zebra bold", {}, async () => {
  const r = row();
  assert.ok(r, "the row is drawn");
  assert.ok(r.querySelector(".burrow-b"));
  assert.ok(r.querySelector(".burrow-code"));
  assert.ok(r.querySelector(".burrow-ref"));
  assert.ok(r.querySelector(".burrow-tag"));
  assert.equal(r.querySelector(".burrow-bref").textContent, "zebra target text");
  const labels = [...r.querySelectorAll(".burrow-label")].map((l) => l.textContent);
  assert.ok(labels.includes("embed"));
  assert.ok(labels.includes("⇥🕞"));
  assert.equal(strip().querySelector("img, script"), null);
  assert.ok(strip().textContent.includes("<img"));
}));

test("with richRows off the same rows are plain text", () => withQuery("((zebra bold", { richRows: false }, async () => {
  const r = row();
  assert.ok(r, "the row is drawn");
  assert.equal(r.querySelector(".burrow-label, .burrow-ref, .burrow-code"), null);
  assert.equal(r.querySelector(".burrow-text").textContent, r.title);
  assert.ok(r.title.startsWith("zebra bold"));
}));

test("a long block whose match is far in shows … and the matched word", () => withQuery("((quokka", {}, async () => {
  const text = row().querySelector(".burrow-text");
  assert.ok(text.querySelector(".burrow-ellipsis"));
  assert.ok(text.textContent.startsWith("…"));
  assert.equal(text.querySelector(".rm-search-match").textContent, "quokka");
}));

const TASKS = [
  ["task00001", "{{[[TODO]]}} watch the zebra crossing", 1],
  ["task00002", "{{[[DONE]]}} watch the zebra herd", 1],
  ["task00003", "watch the zebra stripes", 1],
];

async function withTasks(query, overrides, fn) {
  doc.body.innerHTML = `<textarea class="rm-block-input" id="block-input-uuid-x-fixtureU1"></textarea>${POPOVER}`;
  const ta = doc.querySelector("textarea");
  ta.value = query;
  ta.focus();
  ta.setSelectionRange(query.length, query.length);
  const indexes = { refs: buildRefIndex(TASKS), aliases: null, titles: null, refreshIfStale() {} };
  const api = { ui: { getFocusedBlock: () => ({ "block-uid": "fixtureU1" }) }, pull: () => null, q: () => [] };
  const lifecycle = createLifecycle();
  createStrip({ setting: (id) => (id in overrides ? overrides[id] : DEFAULTS[id]), indexes, perf: createPerf(), lifecycle, api, doc, win });
  ta.dispatchEvent(new win.Event("input", { bubbles: true }));
  await settle();
  try { await fn(); } finally { await lifecycle.dispose(); }
}

test("(( with is:todo: only the open task, one label line reading is:todo, not a row", () => withTasks("((watch is:todo", {}, async () => {
  const rows = doc.querySelectorAll(".burrow-strip .burrow-row");
  assert.equal(rows.length, 1);
  assert.ok(rows[0].textContent.includes("zebra crossing"));
  const label = strip().querySelector(".burrow-filters");
  assert.equal(label.textContent, "is:todo");
  assert.equal(strip().firstChild, label);
  assert.equal(label.title, "Query filters: is:todo");
  assert.equal(label.classList.contains("burrow-row"), false);
  assert.equal(strip().querySelector(".rm-search-match + .rm-search-match, .burrow-row .rm-search-match")?.textContent.toLowerCase(), "watch", "the filter value is not highlighted");
}));

test("with queryFilters off, is:todo is plain search text and no label line is drawn", () => withTasks("((watch is:todo", { queryFilters: false }, async () => {
  assert.equal(doc.querySelectorAll(".burrow-strip .burrow-row").length, 0, "no block contains the words is:todo");
  assert.equal(strip().querySelector(".burrow-filters"), null);
}));

test("(( with a -word and a phrase leave out and require, and the label lists both", () => withTasks('((watch "zebra stripes" -herd', {}, async () => {
  const rows = doc.querySelectorAll(".burrow-strip .burrow-row");
  assert.equal(rows.length, 1);
  assert.ok(rows[0].textContent.includes("zebra stripes"));
  assert.equal(strip().querySelector(".burrow-filters").textContent, '"zebra stripes" · -herd');
}));
