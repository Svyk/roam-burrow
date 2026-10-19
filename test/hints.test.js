import assert from "node:assert/strict";
import test from "node:test";

import { hintsKey, keyLabel, renderHints } from "../src/hints.js";

function fakeDoc() {
  const make = () => {
    const el = {
      className: "",
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
