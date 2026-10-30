import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { createLifecycle } from "../src/lifecycle.js";
import { createPerf } from "../src/perf.js";
import { buildRefIndex } from "../src/refindex.js";
import { DEFAULTS } from "../src/settings.js";

// One window for the file: strip.js takes its textarea value setter from
// globalThis.HTMLTextAreaElement at import, so a commit only works on
// textareas of that window (a missing global would make every commit throw
// and cases a-d would pass for the wrong reason; case e proves it does not).
const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;
for (const name of ["HTMLTextAreaElement", "MutationObserver", "Event", "KeyboardEvent", "getComputedStyle"]) globalThis[name] = win[name];
const { createStrip } = await import("../src/strip.js");
after(() => win.close());

const POPOVER = '<div class="rm-autocomplete__results"><div class="rm-autocomplete__results-main"><div class="rm-autocomplete__results-scroll">'
  + '<div title="ant man" style="background-color: rgb(225, 232, 237)"><div class="rm-autocomplete-result">ant man</div><div class="bp3-text-overflow-ellipsis">Create as block below</div></div></div>'
  + '<div class="rm-autocomplete-footer">Block search</div></div></div>';
const VALUE = "((ant man))";
const CARET = 9;

const frames = () => new Promise((resolve) => win.requestAnimationFrame(() => setTimeout(resolve, 0)));
// Burrow ranks one message after a frame and draws in the next one.
const settle = async () => { for (let i = 0; i < 4; i += 1) await frames(); };

async function harness() {
  doc.body.innerHTML = `<textarea class="rm-block-input" id="block-input-uuid-x-fixtureU1"></textarea>${POPOVER}`;
  const ta = doc.querySelector("textarea");
  ta.value = VALUE;
  ta.focus();
  ta.setSelectionRange(CARET, CARET);
  const calls = { q: 0, pull: 0 };
  // refs is the only index a (( query reads; aliases/titles stay null (the [[ side is not on this path).
  const indexes = { refs: buildRefIndex([["3XSu0IJ8f", "{{[[TODO]]}} Watch [[Ant-Man]]", 1, "MCU Watch Order"]]), aliases: null, titles: null, refreshIfStale() {} };
  const api = {
    ui: { getFocusedBlock: () => ({ "block-uid": "fixtureU1" }) },
    pull: () => { calls.pull += 1; return null; },
    q: () => { calls.q += 1; return []; },
  };
  const lifecycle = createLifecycle();
  const strip = createStrip({ setting: (id) => DEFAULTS[id], indexes, perf: createPerf(), lifecycle, api, doc, win });
  ta.dispatchEvent(new win.Event("input", { bubbles: true }));
  await settle();
  const key = (init) => {
    const event = new win.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    ta.dispatchEvent(event);
    return event;
  };
  const sheet = () => doc.querySelector(".burrow-help");
  const rows = () => [...doc.querySelectorAll(".burrow-strip .burrow-row")];
  const active = () => [...doc.querySelectorAll(".burrow-strip .burrow-row.burrow-active")];
  const openHelp = async () => {
    const event = key({ key: "/", altKey: true });
    await settle();
    return event;
  };
  return {
    ta, strip, key, sheet, rows, active, openHelp, calls,
    state: strip.state, debug: strip.debug,
    dispose: () => lifecycle.dispose(),
  };
}

async function withHarness(fn) {
  const h = await harness();
  try { await fn(h); } finally { await h.dispose(); }
}

function assertPicked(h) {
  assert.equal(h.ta.value, VALUE, "the text is untouched");
  assert.equal(h.debug.commits, 0, "no row ran");
  assert.equal(h.rows().length, 1, "Burrow's row is still there");
  assert.equal(h.active().length, 1, "and still active");
  assert.equal(h.state.phase, "OWNED");
}

test("harness: Burrow shows one pre-selected row for the block", () => withHarness(async (h) => {
  assert.equal(h.state.phase, "OWNED");
  assert.equal(h.rows().length, 1);
  assert.equal(h.active().length, 1);
  assert.equal(h.state.rows[0].uid, "3XSu0IJ8f");
}));

test("⌥/ opens the key list and it is visible", () => withHarness(async (h) => {
  const event = await h.openHelp();
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.state.help, true);
  assert.equal(h.sheet().hidden, false);
}));

test("with the key list open, Enter only closes it: no row runs", () => withHarness(async (h) => {
  await h.openHelp();
  const event = h.key({ key: "Enter" });
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.state.help, false);
  assert.equal(h.sheet().hidden, true);
  await settle();
  assertPicked(h);
}));

for (const [name, init] of [
  ["Tab", { key: "Tab" }],
  ["Shift+Enter", { key: "Enter", shiftKey: true }],
  ["Meta+Enter", { key: "Enter", metaKey: true }],
  ["Ctrl+Enter", { key: "Enter", ctrlKey: true }],
  ["Shift+Tab", { key: "Tab", shiftKey: true }],
]) {
  test(`with the key list open, ${name} only closes it: no row runs`, () => withHarness(async (h) => {
    await h.openHelp();
    const reads = h.calls.q + h.calls.pull;
    const event = h.key(init);
    assert.equal(event.defaultPrevented, true);
    assert.equal(h.state.help, false);
    await settle();
    assertPicked(h);
    assert.equal(h.calls.q + h.calls.pull, reads, "Tab did not drill (no read after the key)");
  }));
}

test("with the key list open, Escape closes it and is consumed", () => withHarness(async (h) => {
  await h.openHelp();
  const event = h.key({ key: "Escape" });
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.state.help, false);
  await settle();
  assertPicked(h);
}));

test("with the key list open, a typed key closes it and goes on", () => withHarness(async (h) => {
  await h.openHelp();
  const event = h.key({ key: "x" });
  assert.equal(event.defaultPrevented, false);
  assert.equal(h.state.help, false);
  assert.equal(h.ta.value, VALUE);
}));

test("control: with the list closed, Enter on the pre-selected row commits it", () => withHarness(async (h) => {
  const event = h.key({ key: "Enter" });
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.ta.value, "((3XSu0IJ8f))");
  assert.equal(h.debug.commits, 1);
}));
