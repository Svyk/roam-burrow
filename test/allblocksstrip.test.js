import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { createLifecycle } from "../src/lifecycle.js";
import { createPerf } from "../src/perf.js";
import { buildRefIndex } from "../src/refindex.js";
import { DEFAULTS } from "../src/settings.js";

// "Filters search every block" through createStrip on a jsdom DOM, like
// test/related.test.js. The 250 ms pause is shortened to 5.
const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const real = dom.window;
const doc = real.document;
for (const name of ["HTMLTextAreaElement", "MutationObserver", "Event", "KeyboardEvent", "getComputedStyle"]) globalThis[name] = real[name];
const win = new Proxy(real, {
  get(target, prop) {
    if (prop === "setTimeout") return (fn, ms, ...args) => target.setTimeout(fn, ms === 250 ? 5 : ms, ...args);
    const value = target[prop];
    return typeof value === "function" ? value.bind(target) : value;
  },
});
const { createStrip } = await import("../src/strip.js");
after(() => real.close());

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frames = () => new Promise((resolve) => real.requestAnimationFrame(() => setTimeout(resolve, 0)));
const settle = async () => { for (let i = 0; i < 4; i += 1) await frames(); };
async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (check()) return true; await sleep(10); }
  return false;
}

const TODO = (text) => `{{[[TODO]]}} ${text}`;
const DB = {
  w1: { string: TODO("watch the old film"), page: "Backlog" },
  w2: { string: "watch the cut scene", page: "Backlog" },
  w3: { string: TODO("watch the edited block"), page: "Backlog" },
  w4: { string: `{{[[DONE]]}} watch the finished film`, page: "Backlog" },
};
const hit = (uid) => ({ ":block/uid": uid, ":block/string": DB[uid].string });
const popover = '<div class="rm-autocomplete__results"><div class="rm-autocomplete__results-main"><div class="rm-autocomplete__results-scroll">'
  + '<div style="background-color: rgb(225, 232, 237)"><div class="rm-autocomplete-result">x</div></div>'
  + '</div><div class="rm-autocomplete-footer">Block search</div></div></div>';

async function withWide({ query, entries = [], reply = ["w1", "w2", "w4"], overrides = {} }, fn) {
  doc.body.innerHTML = `<textarea class="rm-block-input" id="block-input-uuid-x-w3"></textarea>${popover}`;
  const ta = doc.querySelector("textarea");
  ta.value = query;
  ta.focus();
  ta.setSelectionRange(query.length, query.length);
  const searches = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const api = {
    graph: { name: "test-graph" },
    ui: { getFocusedBlock: () => ({ "block-uid": "w3" }) },
    pull: (pattern, eid) => {
      const uid = eid?.[1];
      return String(pattern).includes(":block/string") && DB[uid] ? { ":block/uid": uid, ":block/string": DB[uid].string } : null;
    },
    q: () => [],
    data: {
      async: {
        search: async (args) => { searches.push(args); await gate; return [...reply, "w3"].map(hit); },
        pull_many: (pattern, eids) => Promise.resolve(eids.map(([, uid]) => ({ ":block/page": { ":node/title": DB[uid].page } }))),
      },
    },
  };
  const indexes = { refs: buildRefIndex(entries), aliases: null, titles: null, refreshIfStale() {} };
  const lifecycle = createLifecycle();
  const settings = { aliasPages: false, drill: false, semanticRows: false, ...overrides };
  const strip = createStrip({ setting: (id) => (id in settings ? settings[id] : DEFAULTS[id]), indexes, perf: createPerf(), lifecycle, api, doc, win });
  ta.dispatchEvent(new real.Event("input", { bubbles: true }));
  await settle();
  const uids = () => strip.state.rows.map((row) => row.uid);
  try { await fn({ ta, strip, searches, uids, release }); } finally { await lifecycle.dispose(); }
}

const REF = [["r1", TODO("watch the new film"), 3, "Films"]];

test("referenced rows first, then an unreferenced TODO; the highlight does not move on the reply", () => withWide({ query: "((watch is:todo", entries: REF }, async (h) => {
  assert.deepEqual(h.uids(), ["r1"], "only the referenced block before the read");
  assert.equal(h.strip.state.phase, "OWNED");
  assert.equal(h.strip.state.active, 0);
  assert.ok(await until(() => h.searches.length === 1), "the read starts after the pause");
  assert.deepEqual(h.uids(), ["r1"], "a key never waits for it");
  h.release();
  assert.ok(await until(() => h.uids().length > 1), "the wide row arrives");
  assert.deepEqual(h.uids(), ["r1", "w1"], "the DONE and plain blocks and the block being edited are left out");
  assert.equal(h.strip.state.rows[1].wide, true);
  assert.equal(h.strip.state.rows[1].refs, 0);
  assert.equal(h.strip.state.rows[1].insertion, "((w1))");
  assert.equal(h.strip.state.phase, "OWNED");
  assert.equal(h.strip.state.active, 0, "the highlight stays on the referenced row");
  assert.equal(h.searches.length, 1);
  assert.equal(h.searches[0]["search-str"], "watch TODO");
  assert.equal(h.strip.debug.trace.some((e) => e.ev === "wide" && e.step === "reply"), true);
}));

test("a wide row is never pre-selected", () => withWide({ query: "((watch is:todo" }, async (h) => {
  assert.deepEqual(h.uids(), []);
  h.release();
  assert.ok(await until(() => h.uids().length > 0));
  assert.deepEqual(h.uids(), ["w1"]);
  assert.equal(h.strip.state.phase, "ARMED");
  assert.equal(h.strip.state.active, -1);
  assert.equal(h.strip.state.auto, false);
}));

test("with the switch off no search is made and the rows are the referenced ones", () => withWide({ query: "((watch is:todo", entries: REF, overrides: { filterAllBlocks: false } }, async (h) => {
  await sleep(60);
  await settle();
  assert.equal(h.searches.length, 0);
  assert.deepEqual(h.uids(), ["r1"]);
}));

test("with no qualifying filter no search is made", async () => {
  for (const query of ["((watch the", "((watch -marvel", "((\"watch the\""]) {
    await withWide({ query, entries: REF }, async (h) => {
      await sleep(60);
      await settle();
      assert.equal(h.searches.length, 0, query);
    });
  }
});

test("a full set of referenced rows asks for nothing", () => withWide({
  query: "((watch is:todo",
  entries: ["a", "b", "c"].map((id) => [id, TODO(`watch film ${id}`), 2, "Films"]),
}, async (h) => {
  await sleep(60);
  await settle();
  assert.equal(h.searches.length, 0);
  assert.equal(h.uids().length, 3);
}));
