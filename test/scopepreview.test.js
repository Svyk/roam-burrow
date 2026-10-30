import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { createLifecycle } from "../src/lifecycle.js";
import { createPerf } from "../src/perf.js";
import { buildRefIndex } from "../src/refindex.js";
import { DEFAULTS } from "../src/settings.js";

// The drill panel's ↓ moves the highlight in the key; its preview is drawn in the next frame.
const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;
for (const name of ["HTMLTextAreaElement", "MutationObserver", "Event", "KeyboardEvent", "getComputedStyle"]) globalThis[name] = win[name];
const { createStrip } = await import("../src/strip.js");
after(() => win.close());

const POPOVER = '<div class="rm-autocomplete__results"><div class="rm-autocomplete__results-main"><div class="rm-autocomplete__results-scroll">'
  + '<div title="ant man" style="background-color: rgb(225, 232, 237)"><div class="rm-autocomplete-result">ant man</div><div class="bp3-text-overflow-ellipsis">Create as block below</div></div></div>'
  + '<div class="rm-autocomplete-footer">Block search</div></div></div>';
const frames = () => new Promise((resolve) => win.requestAnimationFrame(() => setTimeout(resolve, 0)));
const settle = async () => { for (let i = 0; i < 4; i += 1) await frames(); };
const kid = (uid, order) => ({ ":block/uid": uid, ":block/string": `kid ${uid}`, ":block/order": order, ":block/heading": 0, ":block/children": [] });

async function withScope(fn) {
  doc.body.innerHTML = `<textarea class="rm-block-input" id="block-input-uuid-x-fixtureU1"></textarea>${POPOVER}`;
  const ta = doc.querySelector("textarea");
  ta.value = "((ant man))";
  ta.focus();
  ta.setSelectionRange(9, 9);
  const parent = { ":block/uid": "3XSu0IJ8f", ":block/string": "Watch", ":block/order": 0, ":block/heading": 0, ":block/_children": [{ ":block/uid": "pg", ":node/title": "MCU Watch Order" }], ":block/children": [kid("k1", 0), kid("k2", 1), kid("k3", 2)] };
  const indexes = { refs: buildRefIndex([["3XSu0IJ8f", "{{[[TODO]]}} Watch [[Ant-Man]]", 1, "MCU Watch Order"]]), aliases: null, titles: null, refreshIfStale() {} };
  const api = {
    ui: { getFocusedBlock: () => ({ "block-uid": "fixtureU1" }) },
    pull: (pattern, eid) => (Array.isArray(eid) && eid[1] === "3XSu0IJ8f" ? parent : null),
    q: () => [],
  };
  const perf = createPerf();
  const lifecycle = createLifecycle();
  const strip = createStrip({ setting: (id) => DEFAULTS[id], indexes, perf, lifecycle, api, doc, win });
  ta.dispatchEvent(new win.Event("input", { bubbles: true }));
  await settle();
  const key = (init) => ta.dispatchEvent(new win.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  try {
    key({ key: "Tab" });
    await settle();
    assert.equal(strip.state.phase, "SCOPE");
    await fn({ key, perf, strip, target: () => [...doc.querySelectorAll(".burrow-preview .burrow-target")].map((n) => n.textContent).join("|") });
  } finally { await lifecycle.dispose(); }
}

test("two ↓ in a row draw the scope preview once, in the next frame, for the second row", () => withScope(async ({ key, perf, target }) => {
  const before = (perf.samples["scope.preview"] || []).length;
  const real = win.requestAnimationFrame;
  let scheduled = 0;
  win.requestAnimationFrame = (fn) => { scheduled += 1; return real.call(win, fn); };
  try {
    key({ key: "ArrowDown" });
    key({ key: "ArrowDown" });
  } finally { win.requestAnimationFrame = real; }
  assert.equal(scheduled, 1);
  assert.equal(perf.samples["scope.key"].length >= 2, true);
  assert.equal((perf.samples["scope.preview"] || []).length, before, "not drawn in the key");
  assert.match(target(), /kid k1/, "still the first row's preview");
  await settle();
  assert.equal((perf.samples["scope.preview"] || []).length, before + 1);
  assert.match(target(), /kid k3/);
}));

test("reset() cancels a pending scope preview frame", () => withScope(async ({ key, perf, strip }) => {
  const before = (perf.samples["scope.preview"] || []).length;
  key({ key: "ArrowDown" });
  key({ key: "ArrowLeft" });
  await settle();
  assert.equal(strip.state.phase, "IDLE");
  assert.equal((perf.samples["scope.preview"] || []).length, before);
}));
