import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { createFrecency } from "../src/frecency.js";
import { createLifecycle } from "../src/lifecycle.js";
import { createPerf } from "../src/perf.js";
import { buildRefIndex } from "../src/refindex.js";
import { DEFAULTS } from "../src/settings.js";
import { buildTitleIndex } from "../src/titles.js";

// Same harness pattern as test/recentrows.test.js, with Roam's real `((` rows.
const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;
for (const name of ["HTMLTextAreaElement", "MutationObserver", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle"]) globalThis[name] = win[name];
const { createStrip } = await import("../src/strip.js");
after(() => win.close());

const frames = () => new Promise((resolve) => win.requestAnimationFrame(() => setTimeout(resolve, 0)));
const settle = async () => { for (let i = 0; i < 5; i += 1) await frames(); };

// As measured 2026-10-30: two Create rows titled with the typed text, then real blocks.
const createRows = (typed) => `<div class="dont-unfocus-block create-footnote" title="${typed}"><div class="rm-autocomplete-result"><span>${typed}</span></div><div class="bp3-text-overflow-ellipsis">Create as footnote</div></div>`
  + `<div title="${typed}" class="dont-unfocus-block" style="background-color: rgb(213, 218, 223)"><div class="rm-autocomplete-result"><span>${typed}</span></div><div class="bp3-text-overflow-ellipsis">Create as block below</div></div>`;
const realRow = (text) => `<div title="${text}" class="dont-unfocus-block"><div class="rm-autocomplete-result"><span>${text}</span></div></div>`;
const popover = (inner) => `<div class="rm-autocomplete__results"><div class="rm-autocomplete__results-main"><div class="rm-autocomplete__results-scroll">${inner}</div><div class="rm-autocomplete-footer">search</div></div></div>`;

const ENTRIES = [
  ["refUid001", "quokka lantern", 5, "Zoo"],
  ["refUid002", "quokka lantern and more", 2, "Zoo"],
  ["refUid004", "ibis ledger", 2, "Zoo"],
  ["refUid005", "ibis ledger and more", 5, "Zoo"],
  ["refUid003", "walrus compass", 1, "Zoo"],
];
const BLOCKS = {
  plainUid1: { ":block/string": "An unreferenced block", ":block/page": { ":node/title": "Notes" } },
  refUid001: { ":block/string": "quokka lantern", ":block/page": { ":node/title": "Zoo" } },
  emptyUid1: { ":block/string": "" },
  fixtureU1: { ":block/string": "The block being edited" },
  pageUid01: { ":node/title": "A page" },
};

async function harness({ query, settings = {}, natives = "" }) {
  doc.body.innerHTML = `<div data-page-title="Here"><textarea class="rm-block-input" id="block-input-uuid-x-fixtureU1"></textarea></div>${popover(createRows(query) + natives)}`;
  const ta = doc.querySelector("textarea");
  const value = `((${query}))`;
  ta.value = value;
  ta.focus();
  ta.setSelectionRange(value.length - 2, value.length - 2);
  const store = new Map();
  const frecency = createFrecency({ storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, key: "k" });
  const calls = { pull: 0 };
  const indexes = {
    refs: buildRefIndex(ENTRIES), aliases: null, recent: { blocks: [], pages: [], builtAt: 1 },
    titles: buildTitleIndex([["Zoo", "pgZoo0001"]], null), refreshIfStale() {},
  };
  const api = {
    ui: { getFocusedBlock: () => ({ "block-uid": "fixtureU1" }) },
    pull: (pattern, eid) => {
      if (!String(pattern).includes(":block/string {:block/page")) return null;
      calls.pull += 1;
      return BLOCKS[eid[1]] ?? null;
    },
    q: () => [],
  };
  const lifecycle = createLifecycle();
  const strip = createStrip({ setting: (id) => (id in settings ? settings[id] : DEFAULTS[id]), indexes, perf: createPerf(), lifecycle, api, frecency, doc, win });
  ta.dispatchEvent(new win.Event("input", { bubbles: true }));
  await settle();
  const rows = () => [...doc.querySelectorAll(".burrow-strip .burrow-row")];
  const enter = () => { const e = new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }); ta.dispatchEvent(e); return e; };
  return { ta, state: strip.state, rows, enter, calls, dispose: () => lifecycle.dispose() };
}

async function with_(options, fn) {
  const h = await harness(options);
  try { await fn(h); } finally { await h.dispose(); }
}

test("a full uid makes that block the first row, selected, and Enter inserts it", () => with_({ query: "plainUid1" }, async (h) => {
  assert.equal(h.state.rows[0].uid, "plainUid1");
  assert.equal(h.rows()[0].title, "An unreferenced block");
  assert.equal(h.state.phase, "OWNED");
  assert.equal(h.state.active, 0);
  assert.equal(h.enter().defaultPrevented, true);
  assert.equal(h.ta.value, "((plainUid1))");
}));

test("no uid row: another case, a page, an empty block, the block being edited, no such block", async () => {
  for (const query of ["PLAINUID1", "pageUid01", "emptyUid1", "fixtureU1", "nosuchuid"]) {
    await with_({ query }, async (h) => {
      assert.equal(h.state.rows.length, 0, query);
      assert.equal(h.enter().defaultPrevented, false, query);
    });
  }
});

test("a query that cannot be a uid pulls nothing", () => with_({ query: "quokka lantern" }, async (h) => {
  assert.equal(h.calls.pull, 0);
}));

test("with the pre-select switch off a uid adds no row", () => with_({ query: "plainUid1", settings: { refPreselect: false } }, async (h) => {
  assert.equal(h.state.rows.length, 0);
  assert.equal(h.calls.pull, 0);
}));

test("Roam's Create rows carry the typed text but are no exact hit: the partial match stays selected", () => with_({ query: "walrus comp" }, async (h) => {
  assert.equal(h.state.rows[0].uid, "refUid003");
  assert.equal(h.state.phase, "OWNED");
}));

test("exact text: the top row that is that block stays selected, also with Roam's copy of it listed", () => with_({ query: "Quokka Lantern", natives: realRow("quokka lantern") }, async (h) => {
  assert.equal(h.state.rows[0].uid, "refUid001");
  assert.equal(h.state.phase, "OWNED");
  h.enter();
  assert.equal(h.ta.value, "((refUid001))");
}));

test("exact text in a block only Roam lists: nothing is selected and Enter is Roam's", () => with_({ query: "walrus comp", natives: realRow("walrus compass") + realRow("walrus comp") }, async (h) => {
  assert.equal(h.state.rows[0].uid, "refUid003");
  assert.equal(h.state.phase, "ARMED");
  assert.equal(h.state.active, -1);
  assert.equal(h.enter().defaultPrevented, false);
  assert.equal(h.ta.value, "((walrus comp))");
}));

test("Roam's exact row arriving late gives the selection back", () => with_({ query: "walrus comp" }, async (h) => {
  assert.equal(h.state.phase, "OWNED");
  doc.querySelector(".rm-autocomplete__results-scroll").insertAdjacentHTML("beforeend", realRow("walrus comp"));
  await settle();
  assert.equal(h.state.phase, "ARMED");
  assert.equal(h.state.active, -1);
}));

test("exact text in a lower Burrow row: nothing is selected, also before Roam's list arrives", () => with_({ query: "ibis ledger" }, async (h) => {
  assert.deepEqual(h.state.rows.map((row) => row.uid), ["refUid005", "refUid004"]);
  assert.equal(h.state.phase, "ARMED");
}));
