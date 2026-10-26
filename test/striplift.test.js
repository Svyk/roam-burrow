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
  + '<div title="ant man" style="background-color: rgb(225, 232, 237)"><div class="rm-autocomplete-result">ant man</div></div></div>'
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


// jsdom has no layout: the rects are stubbed, and a style write on the
// popover wakes Burrow's observer the way Popper's flip does.
async function lifted(h, { style, pop, text }) {
  const el = doc.querySelector(".rm-autocomplete__results");
  const rect = (top, bottom) => () => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top });
  // Layout would move the popover up by its margin.
  el.getBoundingClientRect = () => {
    const up = parseFloat(el.style.marginBottom) || 0;
    return rect(pop[0] - up, pop[1] - up)();
  };
  h.ta.style.paddingTop = "0px";
  h.ta.getBoundingClientRect = rect(text, text + 50);
  Object.assign(el.style, style);
  await settle();
  return el;
}
const FLIPPED = { top: "auto", bottom: "0px" };

test("a flipped popover over a wrapped block lifts off its text", () => withHarness(async (h) => {
  const el = await lifted(h, { style: FLIPPED, pop: [78, 378], text: 354 });
  assert.equal(el.style.marginBottom, "24px");
}));

test("a flipped popover clear of the text is not lifted", () => withHarness(async (h) => {
  const el = await lifted(h, { style: FLIPPED, pop: [78, 378], text: 378 });
  assert.equal(el.style.marginBottom, "");
}));

test("a popover below the caret is not lifted", () => withHarness(async (h) => {
  const el = await lifted(h, { style: { top: "0px", bottom: "auto" }, pop: [78, 378], text: 354 });
  assert.equal(el.style.marginBottom, "");
}));

test("the lift never goes above the window top", () => withHarness(async (h) => {
  const el = await lifted(h, { style: FLIPPED, pop: [10, 378], text: 354 });
  assert.equal(el.style.marginBottom, "10px");
}));

test("the lift is cleared when the popover closes", () => withHarness(async (h) => {
  const el = await lifted(h, { style: FLIPPED, pop: [78, 378], text: 354 });
  assert.equal(el.style.marginBottom, "24px");
  h.ta.blur();
  el.remove();
  await settle();
  assert.equal(el.style.marginBottom, "");
}));
