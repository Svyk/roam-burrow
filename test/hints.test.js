import assert from "node:assert/strict";
import test from "node:test";

import { hintsKey, keyLabel, pickerHints, renderHints } from "../src/hints.js";

function fakeDoc() {
  const make = () => {
    const el = {
      className: "",
      dataset: {},
      children: [],
      _text: "",
      append(...kids) { this.children.push(...kids); },
      replaceChildren(...kids) { this.children = kids; this._text = ""; },
      get textContent() { return this._text + this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); },
      set textContent(value) { this._text = value; this.children = []; },
    };
    return el;
  };
  return { createElement: make };
}

test("keyLabel names the Mac and non-Mac forms; other strings pass through", () => {
  assert.equal(keyLabel("altA", true), "⌥A");
  assert.equal(keyLabel("altA", false), "Alt+A");
  assert.equal(keyLabel("altDown", true), "⌥↓");
  assert.equal(keyLabel("altDown", false), "Alt+↓");
  assert.equal(keyLabel("altBackspace", true), "⌥⌫");
  assert.equal(keyLabel("altBackspace", false), "Alt+⌫");
  assert.equal(keyLabel("ctrlO", true), "⌃O");
  assert.equal(keyLabel("ctrlO", false), "Ctrl+O");
  assert.equal(keyLabel("⇥/>", true), "⇥/>");
});

test("renderHints writes keys, labels and separators", () => {
  const doc = fakeDoc();
  const node = doc.createElement("div");
  renderHints(doc, node, [[keyLabel("altA", true), "alias"], [keyLabel("altDown", true), "pick alias"], ["⇥/>", "drill"], [keyLabel("ctrlO", true), "preview"], ["↵", "insert"]]);
  assert.equal(node.textContent, "⌥A alias · ⌥↓ pick alias · ⇥/> drill · ⌃O preview · ↵ insert");
  assert.equal(node.children.length, 9);
  assert.equal(node.children[1].className, "burrow-hint-sep");
  assert.equal(node.children[0].className, "burrow-hint");
  assert.equal(node.children[0].children[0].className, "burrow-hint-key");
  renderHints(doc, node, [["esc", "results"]]);
  assert.equal(node.textContent, "esc results");
});

test("hintsKey is stable and changes with the items", () => {
  const items = [["↵", "insert"], ["esc", "results"]];
  assert.equal(hintsKey(items), hintsKey([["↵", "insert"], ["esc", "results"]]));
  assert.notEqual(hintsKey(items), hintsKey([["↵", "more"], ["esc", "results"]]));
});

const ON = { tabDrill: true, drill: true, aliasDelete: false, pageOnly: false };
const keys = (items) => items.map(([k, label]) => `${k} ${label}`).join(" · ");

test("pickerHints: the drill key only where Tab drills", () => {
  const alias = (drill) => ({ kind: "[[", row: { kind: "alias", chips: true, drill, aliasNew: true }, on: ON });
  assert.equal(keys(pickerHints(alias(true), true)), "↵ pick alias · ⌥↓ more aliases · ⇥ drill · ⌥A add alias");
  assert.equal(keys(pickerHints(alias(false), true)), "↵ pick alias · ⌥↓ more aliases · ⌥A add alias");
  assert.equal(keys(pickerHints({ ...alias(true), on: { ...ON, tabDrill: false } }, true)), "↵ pick alias · ⌥↓ more aliases · ⌥A add alias");
  const native = (drill, aliasNew = false) => ({ kind: "[[", row: null, native: { drill, aliasNew }, on: ON });
  assert.equal(keys(pickerHints(native(true), true)), "⇥ drill");
  assert.deepEqual(pickerHints(native(false), true), []);
  assert.equal(keys(pickerHints(native(false, true), false)), "Alt+A add alias");
  assert.equal(keys(pickerHints({ kind: "((", row: { kind: "ref", drill: false }, on: ON }, true)), "↵ insert ref");
  assert.equal(keys(pickerHints({ kind: "((", row: { kind: "ref", drill: true }, on: ON }, true)), "↵ insert ref · ⇥ drill");
  assert.equal(keys(pickerHints({ kind: "[[", row: { kind: "drill", drill: true }, on: ON }, true)), "↵ insert block · ⇥/> drill");
  assert.equal(keys(pickerHints({ kind: "[[", row: { kind: "drill", drill: true }, on: { ...ON, tabDrill: false } }, true)), "↵ insert block · > next level");
  assert.equal(keys(pickerHints({ kind: "[[", row: { kind: "drill", drill: false }, on: ON }, true)), "↵ insert block");
});

test("pickerHints: chips, prompts, rows above, link format; every item carries a tip", () => {
  const chips = { kind: "[[", chips: true, row: { kind: "alias", chips: true, drill: false }, on: { ...ON, aliasDelete: true } };
  assert.equal(keys(pickerHints(chips, true)), "←→ alias · ⌥⌫ delete · ↵ insert · esc rows");
  assert.equal(keys(pickerHints({ ...chips, row: { ...chips.row, drill: true } }, true)), "←→ alias · ⌥⌫ delete · ↵ insert · ⇥ drill · esc rows");
  assert.equal(keys(pickerHints({ ...chips, on: ON }, true)), "←→ alias · ↵ insert · esc rows");
  assert.equal(keys(pickerHints({ kind: "[[", prompt: "add", row: null, on: ON }, true)), "↵ save alias · esc cancel");
  assert.equal(keys(pickerHints({ kind: "[[", prompt: "delete", row: null, on: ON }, true)), "↵ delete · esc keep");
  assert.equal(keys(pickerHints({ kind: "((", row: null, rowsAbove: true, on: ON }, true)), "↑ referenced");
  assert.equal(keys(pickerHints({ kind: "[[", row: null, rowsAbove: true, native: { drill: true }, on: ON }, true)), "↑ alias rows · ⇥ drill");
  assert.equal(pickerHints({ kind: "[[", row: { kind: "alias" }, on: { ...ON, pageOnly: true } }, true)[0][2], "Insert [[Page]]");
  const all = [chips, { kind: "[[", row: { kind: "alias", chips: true, drill: true, aliasNew: true }, on: ON }, { kind: "((", row: { kind: "ref", drill: true }, on: ON }];
  for (const s of all) for (const item of pickerHints(s, true)) assert.ok(item[2] && item[2].length > 8, JSON.stringify(item));
});

test("renderHints numbers its items for the hover tips", () => {
  const doc = fakeDoc();
  const node = doc.createElement("div");
  renderHints(doc, node, [["↵", "insert"], ["esc", "rows"]]);
  assert.deepEqual(node.children.filter((c) => c.className === "burrow-hint").map((c) => c.dataset.hint), ["0", "1"]);
});
