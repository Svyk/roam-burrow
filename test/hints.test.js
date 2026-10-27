import assert from "node:assert/strict";
import test from "node:test";

import { hintsKey, isAltSlash, isHelpKey, keyLabel, pickerHints, renderHints } from "../src/hints.js";
import { createSettingsPanel } from "../src/settings.js";

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
  assert.equal(keys(pickerHints(alias(true), true)), "↵ pick alias · ⌥↓ more aliases · ⇥ blocks on this page · ⌥A add alias");
  assert.equal(keys(pickerHints(alias(false), true)), "↵ pick alias · ⌥↓ more aliases · ⌥A add alias");
  assert.equal(keys(pickerHints({ ...alias(true), on: { ...ON, tabDrill: false } }, true)), "↵ pick alias · ⌥↓ more aliases · ⌥A add alias");
  const native = (drill, aliasNew = false) => ({ kind: "[[", row: null, native: { drill, aliasNew }, on: ON });
  assert.equal(keys(pickerHints(native(true), true)), "⇥ blocks on this page");
  assert.deepEqual(pickerHints(native(false), true), []);
  assert.equal(keys(pickerHints(native(false, true), false)), "Alt+A add alias");
  assert.equal(keys(pickerHints({ kind: "((", row: { kind: "ref", drill: false }, on: ON }, true)), "↵ insert ref");
  assert.equal(keys(pickerHints({ kind: "((", row: { kind: "ref", drill: true }, on: ON }, true)), "↵ insert ref · ⇥ children of this block");
  assert.equal(keys(pickerHints({ kind: "((", row: { kind: "ref", drill: true }, on: { ...ON, refOutline: true } }, true)), "↵ insert ref · ⇥ children of this block · ⇧⇥ parent");
  assert.equal(keys(pickerHints({ kind: "((", row: { kind: "ref", drill: false }, on: { ...ON, refOutline: true } }, true)), "↵ insert ref · ⇧⇥ parent");
  assert.equal(keys(pickerHints({ kind: "[[", row: { kind: "drill", drill: true }, on: ON }, true)), "↵ insert block · ⇥/> children of this block");
  assert.equal(keys(pickerHints({ kind: "[[", row: { kind: "drill", drill: true, block: true }, on: { ...ON, refOutline: true } }, true)), "↵ insert block · ⇥/> children of this block · ⇧⇥ parent");
  assert.equal(keys(pickerHints({ kind: "[[", row: { kind: "drill", drill: true, block: false }, on: { ...ON, refOutline: true } }, true)), "↵ insert block · ⇥/> children of this block");
  assert.equal(keys(pickerHints({ kind: "[[", row: { kind: "drill", drill: true }, on: { ...ON, tabDrill: false } }, true)), "↵ insert block · > next level");
  assert.equal(keys(pickerHints({ kind: "[[", row: { kind: "drill", drill: false }, on: ON }, true)), "↵ insert block");
});

test("pickerHints: chips, prompts, rows above, link format; every item carries a tip", () => {
  const chips = { kind: "[[", chips: true, row: { kind: "alias", chips: true, drill: false }, on: { ...ON, aliasDelete: true } };
  assert.equal(keys(pickerHints(chips, true)), "←→ alias · ⌥⌫ delete · ↵ insert · esc rows");
  assert.equal(keys(pickerHints({ ...chips, row: { ...chips.row, drill: true } }, true)), "←→ alias · ⌥⌫ delete · ↵ insert · ⇥ blocks on this page · esc rows");
  assert.equal(keys(pickerHints({ ...chips, on: ON }, true)), "←→ alias · ↵ insert · esc rows");
  assert.equal(keys(pickerHints({ kind: "[[", prompt: "add", row: null, on: ON }, true)), "↵ save alias · esc cancel");
  assert.equal(keys(pickerHints({ kind: "[[", prompt: "delete", row: null, on: ON }, true)), "↵ delete · esc keep");
  assert.equal(keys(pickerHints({ kind: "((", row: null, rowsAbove: true, on: ON }, true)), "↑ referenced");
  assert.equal(keys(pickerHints({ kind: "[[", row: null, rowsAbove: true, native: { drill: true }, on: ON }, true)), "↑ alias rows · ⇥ blocks on this page");
  assert.equal(pickerHints({ kind: "[[", row: { kind: "alias" }, on: { ...ON, pageOnly: true } }, true)[0][2], "Insert [[Page]]");
  const all = [chips, { kind: "[[", row: { kind: "alias", chips: true, drill: true, aliasNew: true }, on: ON }, { kind: "((", row: { kind: "ref", drill: true }, on: { ...ON, refOutline: true } }];
  for (const s of all) for (const item of pickerHints(s, true)) assert.ok(item[2] && item[2].length > 8, JSON.stringify(item));
});

test("renderHints numbers its items for the hover tips", () => {
  const doc = fakeDoc();
  const node = doc.createElement("div");
  renderHints(doc, node, [["↵", "insert"], ["esc", "rows"]]);
  assert.deepEqual(node.children.filter((c) => c.className === "burrow-hint").map((c) => c.dataset.hint), ["0", "1"]);
});

test("isAltSlash goes by the typed character, not the key's position", () => {
  const alt = (key, code = "Slash", more = {}) => ({ key, code, altKey: true, ctrlKey: false, metaKey: false, ...more });
  assert.equal(isAltSlash(alt("÷")), true); // mac US ⌥/
  assert.equal(isAltSlash(alt("¿")), true); // mac US ⌥⇧/
  assert.equal(isAltSlash(alt("/")), true); // Alt+/ elsewhere
  assert.equal(isAltSlash(alt("/", "Digit7")), true); // / on another key
  assert.equal(isAltSlash(alt("–")), false); // mac German ⌥ and the key at the US / position
  assert.equal(isAltSlash(alt("÷", "Slash", { altKey: false })), false);
  assert.equal(isAltSlash(alt("÷", "Slash", { metaKey: true })), false);
  assert.equal(isAltSlash(alt("/", "Slash", { ctrlKey: true })), false);
});

test("F1 opens the key list on any layout; ⌥/ as before", () => {
  const key = (k, more = {}) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...more });
  assert.equal(isHelpKey(key("F1")), true);
  assert.equal(isHelpKey(key("F1", { shiftKey: true })), false);
  assert.equal(isHelpKey(key("F1", { metaKey: true })), false);
  assert.equal(isHelpKey(key("÷", { altKey: true })), true);
  assert.equal(isHelpKey(key("–", { altKey: true })), false, "German ⌥- still types its en dash");
  assert.equal(isHelpKey(key("/")), false, "a plain / types");
});

test("hover tips go beside the picker, then under it, then above it and the text; never over its text", async () => {
  const { placeTip } = await import("../src/tips.js");
  const view = { width: 1600, height: 900 };
  const box = { width: 200, height: 60 };
  const area = { left: 600, top: 200, right: 1000, bottom: 500 };
  const row = { left: 610, top: 240, right: 990, bottom: 273 };
  const ta = { left: 600, top: 170, right: 1200, bottom: 190 };
  assert.deepEqual(placeTip(row, box, area, ta, view), { left: 1006, top: 240 }, "right of the picker, level with the row");
  const wide = { left: 300, top: 200, right: 1500, bottom: 500 };
  assert.deepEqual(placeTip(row, box, wide, ta, view), { left: 94, top: 240 }, "no room right: left of it");
  const full = { left: 50, top: 200, right: 1550, bottom: 500 };
  assert.deepEqual(placeTip(row, box, full, ta, view), { left: 610, top: 506 }, "no room either side: under it");
  // Notes' window (1095 px) with the preview open: under the picker is off-screen, above it the text.
  const low = { left: 150, top: 400, right: 950, bottom: 880 };
  const text = { left: 150, top: 370, right: 1000, bottom: 392 };
  assert.deepEqual(placeTip({ ...row, top: 420, bottom: 453 }, box, low, text, { width: 1095, height: 900 }), { left: 610, top: 304 }, "above the picker and the edited text");
  // Nothing free around it but a narrow side: a narrower tip there.
  const tall = { left: 120, top: 10, right: 950, bottom: 890 };
  const big = { width: 400, height: 60 };
  assert.deepEqual(placeTip({ ...row, top: 420, bottom: 453 }, big, tall, null, { width: 1300, height: 900 }), { left: 956, top: 420, width: 340 }, "a 340 px side");
  assert.deepEqual(placeTip({ ...row, top: 420, bottom: 453 }, big, tall, null, { width: 1095, height: 900 }), null, "no side of 160 px: no tip");
});

test("the Key hints setting names the labels the hint line shows", () => {
  const description = createSettingsPanel().settings.find((s) => s.id === "keyHints").description;
  const parts = (items) => items.map(([keys, label]) => `${keys} ${label}`);
  const alias = pickerHints({ kind: "[[", row: { kind: "alias", chips: true, drill: true, aliasNew: true }, on: { tabDrill: true } }, true);
  const ref = pickerHints({ kind: "((", row: { kind: "ref", drill: true }, on: { tabDrill: true, refOutline: true } }, true);
  // The drill panel's line (src/scopeview.js).
  const drill = ["↵ insert", "⇥/> children", "⇧⇥ up", "esc results", "⌃O preview"];
  for (const part of [...parts(alias), ...parts(ref), ...drill]) assert.ok(description.includes(part), `${part} in ${description}`);
  assert.doesNotMatch(description, /⇥ drill|⇥\/> drill/);
});

test("pickerHints: ⌥R names the Related rows while the band has rows; inside it the three band keys", () => {
  const base = { kind: "((", row: null, native: null, rowsAbove: false, on: ON };
  assert.equal(keys(pickerHints({ ...base, related: "available" }, true)), "⌥R related");
  assert.equal(keys(pickerHints({ ...base, related: null }, true)), "");
  assert.equal(keys(pickerHints({ ...base, related: "active" }, true)), "↵ insert · ↑↓ move · esc back");
  assert.equal(keyLabel("altR", false), "Alt+R");
  const ref = { kind: "((", row: { kind: "ref", drill: false }, on: { ...ON, refOutline: false }, related: "available" };
  assert.equal(keys(pickerHints(ref, true)), "↵ insert ref · ⌥R related");
  assert.equal(keys(pickerHints({ ...ref, prompt: "add" }, true)), "↵ save alias · esc cancel");
});
