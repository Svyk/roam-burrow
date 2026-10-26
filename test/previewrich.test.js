import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { createLifecycle } from "../src/lifecycle.js";
import { createPreview } from "../src/preview.js";
import { richParts } from "../src/rich.js";
import { createScopePanel } from "../src/scopeview.js";

const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;
after(() => win.close());

const rich = (item) => richParts(item.string);
const popover = doc.createElement("div");
doc.body.append(popover);
const item = (uid, string, extra = {}) => ({ uid, text: string, string, depth: 0, heading: 0, target: false, ...extra });
const lines = (preview) => [...preview.node.querySelectorAll(".burrow-node")];

test("preview lines with markup get spans, plain lines stay one text node", () => {
  const preview = createPreview({ doc, win, lifecycle: createLifecycle(), rich });
  preview.show({ key: "k", trail: ["P"], items: [item("a", "plain words"), item("b", "see **bold** and [[Page]]")] }, popover);
  const [plain, marked] = lines(preview);
  assert.equal(plain.childNodes.length, 1);
  assert.equal(plain.firstChild.nodeType, 3);
  assert.ok(marked.querySelector(".burrow-b"));
  assert.equal(marked.querySelector(".burrow-ref").textContent, "Page");
});

test("budgetMs 0 writes only up to the target; more() writes the rest", () => {
  const preview = createPreview({ doc, win, lifecycle: createLifecycle(), rich });
  const items = Array.from({ length: 10 }, (_, i) => item(`u${i}`, `line **${i}**`, { target: i === 3 }));
  preview.show({ key: "k2", trail: ["P"], items }, popover, { budgetMs: 0 });
  assert.equal(lines(preview).filter((n) => !n.hidden).length, 4);
  assert.equal(preview.pending, true);
  preview.more(Infinity);
  assert.equal(lines(preview).filter((n) => !n.hidden).length, 10);
  assert.equal(preview.pending, false);
});

test("an unchanged line is not rewritten", () => {
  const preview = createPreview({ doc, win, lifecycle: createLifecycle(), rich });
  preview.show({ key: "k3", trail: ["P"], items: [item("a", "x **y**"), item("b", "z **w**")] }, popover);
  const before = [...lines(preview)[0].childNodes];
  preview.show({ key: "k4", trail: ["P"], items: [item("a", "x **y**"), item("c", "other **w**")] }, popover);
  const [first, second] = lines(preview);
  assert.deepEqual([...first.childNodes], before);
  assert.ok(before.every((n, i) => first.childNodes[i] === n));
  assert.equal(second.textContent, "other w");
});

test("scope panel: the first 12 rows are rich at once, the rest after the idle upgrade", async () => {
  const panel = createScopePanel({ doc, win, lifecycle: createLifecycle(), highlight: (t) => t, rich: (row) => richParts(row.node.string), onSlice() {} });
  const rows = Array.from({ length: 30 }, (_, i) => {
    const string = `row **${i}**`;
    return { uid: `u${i}`, text: `row ${i}`, parts: null, node: { uid: `u${i}`, string }, drillable: false };
  });
  const level = { uid: "p", label: "Page", query: "", active: 0, isPage: true };
  panel.show({ levels: [level], rows, rootLabel: "Root" }, false);
  const bold = () => panel.node.querySelectorAll(".burrow-row .burrow-b").length;
  assert.equal(bold(), 12);
  for (let i = 0; i < 20 && bold() < 30; i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(bold(), 30);
});
