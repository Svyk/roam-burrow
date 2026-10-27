import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { helpGroups } from "../src/help.js";
import { IS_MAC, pickerHints } from "../src/hints.js";
import { createLifecycle } from "../src/lifecycle.js";
import { createPerf } from "../src/perf.js";
import { buildRefIndex } from "../src/refindex.js";
import { DEFAULTS } from "../src/settings.js";
import { blockLabel, lastStep, sidebarWindow, variantInsertion, variantOf } from "../src/variants.js";

// The strip on a real DOM: set up before any test() (top-level await).

const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;
for (const name of ["HTMLTextAreaElement", "MutationObserver", "Event", "KeyboardEvent", "getComputedStyle"]) globalThis[name] = win[name];
const { createStrip } = await import("../src/strip.js");
after(() => win.close());

const on = (id) => DEFAULTS[id];
const block = { type: "block", uid: "3XSu0IJ8f", text: "Watch Ant-Man [[MCU]] and then **Ant-Man and the Wasp** before Endgame" };
const page = { type: "page", uid: "pg1", title: "Lori Boyd", alias: "lorinator" };

test("which variant a key is: ⇧↵ embed, ⌥↵ label, ⌘⇧↵ sidebar (Ctrl+Shift+↵ off a Mac)", () => {
  assert.equal(variantOf({ key: "Enter", shiftKey: true }, on, true), "embed");
  assert.equal(variantOf({ key: "Enter", altKey: true }, on, true), "label");
  assert.equal(variantOf({ key: "Enter", metaKey: true, shiftKey: true }, on, true), "sidebar");
  assert.equal(variantOf({ key: "Enter", ctrlKey: true, shiftKey: true }, on, false), "sidebar");
  assert.equal(variantOf({ key: "Enter", ctrlKey: true, shiftKey: true }, on, true), null);
  assert.equal(variantOf({ key: "Enter" }, on, true), null);
  assert.equal(variantOf({ key: "Enter", metaKey: true }, on, true), null, "⌘↵ stays Roam's TODO");
  assert.equal(variantOf({ key: "Enter", altKey: true, shiftKey: true }, on, true), null);
  assert.equal(variantOf({ key: "Tab", shiftKey: true }, on, true), null);
  const off = (id) => (id === "insertVariants" || id === "openInSidebar" ? false : DEFAULTS[id]);
  for (const init of [{ shiftKey: true }, { altKey: true }, { metaKey: true, shiftKey: true }]) assert.equal(variantOf({ key: "Enter", ...init }, off, true), null);
});

test("what each variant inserts", () => {
  assert.equal(variantInsertion("embed", block, "ant man"), "{{[[embed]]: ((3XSu0IJ8f))}}");
  assert.equal(variantInsertion("embed", page, ""), "{{[[embed]]: [[Lori Boyd]]}}");
  assert.equal(variantInsertion("label", block, "ant man"), "[ant man](((3XSu0IJ8f)))");
  assert.equal(variantInsertion("label", block, ""), "[Watch Ant-Man MCU and then Ant-Man and t](((3XSu0IJ8f)))");
  assert.equal(variantInsertion("label", block, "  "), "[Watch Ant-Man MCU and then Ant-Man and t](((3XSu0IJ8f)))");
  // The alias, whatever was typed and whatever the alias link format says.
  assert.equal(variantInsertion("label", page, "lorinatr"), "[lorinator]([[Lori Boyd]])");
  assert.equal(variantInsertion("label", { ...page, alias: null }, "lori"), "[lori]([[Lori Boyd]])");
  assert.equal(variantInsertion("label", { ...page, alias: null }, ""), "[Lori Boyd]([[Lori Boyd]])");
  // A ] would end the label early.
  assert.equal(variantInsertion("label", block, "a]b [c"), "[ab c](((3XSu0IJ8f)))");
  assert.equal(variantInsertion("label", { type: "block", uid: "x", text: "![](https://img)" }, ""), "[x](((x)))");
});

test("label helpers", () => {
  assert.equal([...blockLabel("🙂".repeat(50))].length, 40, "40 characters, not UTF-16 units");
  assert.equal(blockLabel("{{[[TODO]]}} call [[Lori Boyd]] about `x`"), "call Lori Boyd about `x`");
  assert.equal(lastStep("MCU Watch Order > watch order > ant man"), "ant man");
  assert.equal(lastStep("Page#"), "");
  assert.deepEqual(sidebarWindow(page), { type: "outline", "block-uid": "pg1" });
  assert.deepEqual(sidebarWindow(block), { type: "block", "block-uid": "3XSu0IJ8f" });
});

test("holding a modifier turns the hint line into the variants; the key list names them while their switches are on", () => {
  const state = (vars, held = true) => ({ kind: "((", held, row: { kind: "ref", drill: false }, on: { refOutline: true, ...vars } });
  const keys = (items) => items.map(([k, l]) => `${k} ${l}`);
  const both = { insertVariants: true, openInSidebar: true };
  // A modifier held: the variants are the line.
  assert.deepEqual(keys(pickerHints(state(both), true)), ["⇧↵ embed", "⌥↵ label", "⌘⇧↵ sidebar"]);
  assert.deepEqual(keys(pickerHints(state(both), false)), ["Shift+↵ embed", "Alt+↵ label", "Ctrl+Shift+↵ sidebar"]);
  assert.deepEqual(keys(pickerHints(state({ openInSidebar: true }), true)), ["⌘⇧↵ sidebar"]);
  // Not held: the line as in 0.7.0.
  assert.deepEqual(keys(pickerHints(state(both, false), true)), ["↵ insert ref", "⇧⇥ parent"]);
  // Both switches off: holding changes nothing.
  assert.deepEqual(keys(pickerHints(state({}), true)), ["↵ insert ref", "⇧⇥ parent"]);
  // Roam's row highlighted: none.
  assert.equal(keys(pickerHints({ kind: "((", held: true, row: null, rowsAbove: true, on: both }, true)).some((k) => /embed|sidebar/.test(k)), false);
  const sheet = (vals) => helpGroups((id) => (id in vals ? vals[id] : DEFAULTS[id]), true)[0].items.map(([k]) => k);
  assert.ok(sheet({}).includes("⇧↵") && sheet({}).includes("⌥↵") && sheet({}).includes("⌘⇧↵, ⇧click"));
  assert.ok(!sheet({ insertVariants: false, openInSidebar: false }).some((k) => /⇧↵|⌥↵/.test(k)));
});

const POPOVER = '<div class="rm-autocomplete__results"><div class="rm-autocomplete__results-main"><div class="rm-autocomplete__results-scroll">'
  + '<div title="ant man" style="background-color: rgb(225, 232, 237)"><div class="rm-autocomplete-result">ant man</div></div></div>'
  + '<div class="rm-autocomplete-footer">Block search</div></div></div>';
const VALUE = "seed ((ant man)) tail";
const CARET = 14;
const frames = () => new Promise((resolve) => win.requestAnimationFrame(() => setTimeout(resolve, 0)));
const settle = async () => { for (let i = 0; i < 4; i += 1) await frames(); };
const PRIMARY = IS_MAC ? { metaKey: true } : { ctrlKey: true };

async function withStrip(values, fn) {
  doc.body.innerHTML = `<textarea class="rm-block-input" id="block-input-uuid-x-fixtureU1"></textarea>${POPOVER}`;
  const ta = doc.querySelector("textarea");
  ta.value = VALUE;
  ta.focus();
  ta.setSelectionRange(CARET, CARET);
  const windows = [];
  const indexes = { refs: buildRefIndex([["3XSu0IJ8f", "{{[[TODO]]}} Watch [[Ant-Man]]", 1, "MCU Watch Order"]]), aliases: null, titles: null, refreshIfStale() {} };
  const api = {
    ui: { getFocusedBlock: () => ({ "block-uid": "fixtureU1" }), rightSidebar: { addWindow: async (w) => { windows.push(w.window); } } },
    pull: () => null,
    q: () => [],
  };
  const lifecycle = createLifecycle();
  const strip = createStrip({ setting: (id) => (id in values ? values[id] : DEFAULTS[id]), indexes, perf: createPerf(), lifecycle, api, doc, win });
  ta.dispatchEvent(new win.Event("input", { bubbles: true }));
  await settle();
  const key = (init) => {
    const event = new win.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", ...init });
    ta.dispatchEvent(event);
    return event;
  };
  try {
    assert.equal(strip.state.phase, "OWNED", "the referenced original starts selected");
    await fn({ ta, key, windows, strip });
  } finally {
    await lifecycle.dispose();
  }
}

test("⇧↵ on a Burrow row inserts the embed; only the token changes", () => withStrip({}, async ({ ta, key }) => {
  assert.equal(key({ shiftKey: true }).defaultPrevented, true);
  assert.equal(ta.value, "seed {{[[embed]]: ((3XSu0IJ8f))}} tail");
}));

test("⌥↵ inserts [what was typed](((uid)))", () => withStrip({}, async ({ ta, key }) => {
  assert.equal(key({ altKey: true }).defaultPrevented, true);
  assert.equal(ta.value, "seed [ant man](((3XSu0IJ8f))) tail");
}));

test("⌘⇧↵ opens the block in the sidebar; the text, caret and popup stay", () => withStrip({}, async ({ ta, key, windows, strip }) => {
  assert.equal(key({ ...PRIMARY, shiftKey: true }).defaultPrevented, true);
  await settle();
  assert.deepEqual(windows, [{ type: "block", "block-uid": "3XSu0IJ8f" }]);
  assert.equal(ta.value, VALUE);
  assert.equal(ta.selectionStart, CARET);
  assert.equal(strip.state.phase, "OWNED");
  assert.equal(strip.debug.commits, 0);
}));

test("switches off: the keys are not Burrow's", () => withStrip({ insertVariants: false, openInSidebar: false }, async ({ ta, key, windows }) => {
  for (const init of [{ shiftKey: true }, { altKey: true }, { ...PRIMARY, shiftKey: true }]) assert.equal(key(init).defaultPrevented, false);
  assert.equal(ta.value, VALUE);
  assert.equal(windows.length, 0);
}));

test("the text before the caret changed: refused, nothing written or opened", () => withStrip({}, async ({ ta, key, windows, strip }) => {
  for (const init of [{ shiftKey: true }, { altKey: true }, { ...PRIMARY, shiftKey: true }]) {
    ta.value = "seed ((ant mab)) tail";
    ta.setSelectionRange(CARET, CARET);
    assert.equal(key(init).defaultPrevented, true, "the key is consumed, never a Roam row's");
    assert.equal(ta.value, "seed ((ant mab)) tail");
    ta.value = VALUE;
    ta.setSelectionRange(CARET, CARET);
    ta.dispatchEvent(new win.Event("input", { bubbles: true }));
    await settle();
  }
  assert.equal(windows.length, 0);
  assert.equal(strip.debug.commits, 0);
}));

test("Roam's row highlighted (↓ past Burrow's): the keys stay Roam's", () => withStrip({}, async ({ ta, key, windows }) => {
  key({ key: "ArrowDown" });
  for (const init of [{ shiftKey: true }, { altKey: true }, { ...PRIMARY, shiftKey: true }]) assert.equal(key(init).defaultPrevented, false);
  assert.equal(ta.value, VALUE);
  assert.equal(windows.length, 0);
}));

test("⇧+click on a Burrow row opens the sidebar before Roam's own shift+mousedown sees it", () => withStrip({}, async ({ ta, windows, strip }) => {
  const roamSaw = [];
  const roam = (event) => { if (event.shiftKey) roamSaw.push(event.type); };
  for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) doc.addEventListener(type, roam, true);
  try {
    const row = doc.querySelector(".burrow-strip .burrow-row");
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      row.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, shiftKey: true }));
    }
    await settle();
    assert.deepEqual(roamSaw, []);
    assert.deepEqual(windows, [{ type: "block", "block-uid": "3XSu0IJ8f" }]);
    assert.equal(ta.value, VALUE);
    assert.equal(strip.state.phase, "OWNED");
  } finally {
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) doc.removeEventListener(type, roam, true);
  }
}));

test("holding ⌥ on a Burrow row shows the variants on the hint line; a key or the release puts the line back", () => withStrip({}, async ({ key }) => {
  const line = () => doc.querySelector(".burrow-hints-list")?.textContent;
  const plain = line();
  assert.ok(!/embed/.test(plain));
  key({ key: "Alt", altKey: true });
  await new Promise((r) => setTimeout(r, 350));
  assert.match(line(), /embed.*label.*sidebar/);
  win.dispatchEvent(new win.KeyboardEvent("keyup", { key: "Alt" }));
  assert.equal(line(), plain);
  // A capital typed with Shift never shows it.
  key({ key: "Shift", shiftKey: true });
  key({ key: "A", shiftKey: true });
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(line(), plain);
}));
