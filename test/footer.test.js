import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { helpGroups } from "../src/help.js";
import { keyLabel, pickerHints } from "../src/hints.js";
import { createLifecycle } from "../src/lifecycle.js";
import { createPreview } from "../src/preview.js";
import { FOOTER_CHILDREN, FOOTER_K, FOOTER_POOL, FOOTER_ROWS, FOOTER_TEXT, K, createSemantic, footerKeep, footerPick, footerText } from "../src/semantic.js";
import { DEFAULTS, createSettingsPanel } from "../src/settings.js";

// The "Related to the highlighted block" footer: the lookup options, the pure
// text and pick rules, the pane's footer, the hint line, the key list and the switch.

function lookup(options = {}) {
  const calls = [];
  const replies = [];
  const samples = [];
  const api = { data: {
    semanticSearchEnabled: () => true,
    async: { semanticSearch: (args) => new Promise((resolve) => calls.push({ args, resolve })) },
  } };
  const win = { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  const semantic = createSemantic({ api, win, perf: { push: (name, ms) => samples.push(name) }, graph: () => "g", onReply: (token, list) => replies.push({ token, list }), ...options });
  const flush = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };
  return { semantic, calls, replies, samples, flush };
}
const token = (uid, query = "some block text here") => ({ kind: "((", query, uid, subjectKey: `preview:block:${uid}` });

test("k and keyOf reach semanticSearch and the cache; the default stays K", async () => {
  const plain = lookup();
  plain.semantic.ask(token("u1"));
  assert.equal(plain.calls[0].args.k, K);
  const foot = lookup({ k: FOOTER_K, keyOf: (t) => `foot\u0000${t.uid}`, perfName: "related.footer.request" });
  foot.semantic.ask(token("u1"));
  assert.deepEqual(foot.calls[0].args, { "search-str": "some block text here", k: 30, "search-blocks": true, "search-pages": false });
  foot.calls[0].resolve([{ type: "block", uid: "b1" }]);
  await foot.flush();
  assert.equal(foot.replies.length, 1);
  assert.deepEqual(foot.samples, ["related.footer.request"]);
});

test("ask is immediate (no debounce) and the cache is per uid: a second ask of the same uid makes no call", async () => {
  const h = lookup({ k: FOOTER_K, keyOf: (t) => `foot\u0000${t.uid}` });
  h.semantic.ask(token("u1", "first words of the block"));
  assert.equal(h.calls.length, 1, "asked at once");
  h.calls[0].resolve([{ type: "block", uid: "b1" }]);
  await h.flush();
  h.semantic.ask(token("u1", "other words, same block uid"));
  assert.equal(h.calls.length, 1, "served from the cache");
  assert.equal(h.replies.length, 2);
  assert.equal(h.replies[1].list[0].uid, "b1");
  h.semantic.ask(token("u2"));
  assert.equal(h.calls.length, 2, "another uid asks again");
});

test("footerText: a block's text is cut at 600; a page is its title and first ten children", () => {
  assert.equal(footerText({ string: "  plain text " }), "plain text");
  assert.equal(footerText({ string: "x".repeat(900) }).length, FOOTER_TEXT);
  const children = Array.from({ length: 14 }, (_, i) => `child ${i}`);
  const page = footerText({ title: "Title", children });
  assert.deepEqual(page.split("\n"), ["Title", ...children.slice(0, FOOTER_CHILDREN)]);
  assert.equal(footerText({ title: "T", children: ["", "a"] }), "T\na");
  assert.equal(footerText({ title: "T", children: ["y".repeat(700)] }).length, FOOTER_TEXT);
  assert.equal(footerText({ string: "   " }), "");
});

test("footerPick leaves out the subject, its page, pages, empty blocks and shown uids, and keeps six", () => {
  const info = { subjectUid: "subj", pageUid: "pg" };
  const hit = (uid, extra = {}) => ({ uid, string: `text ${uid}`, title: null, pageUid: "other", ...extra });
  const hits = [
    hit("subj"), hit("sibling", { pageUid: "pg" }), hit("page1", { title: "A page", string: null }), hit("empty", { string: "  " }),
    hit("shown"), hit("a"), hit("b"), hit("a"), hit("c"), hit("d"), hit("e"), hit("f"), hit("g"), hit("h"),
  ];
  const picked = footerPick(hits, info, new Set(["shown"]));
  assert.deepEqual(picked.map((h) => h.uid), ["a", "b", "c", "d", "e", "f"]);
  assert.equal(picked.length, FOOTER_POOL);
  assert.equal(FOOTER_ROWS, 4);
  assert.equal(footerKeep(hit("x"), info, new Set()), true);
  assert.equal(footerKeep(null, info, new Set()), false);
  // A page subject: its own uid is the page, so every block on it goes.
  assert.equal(footerKeep(hit("onpage", { pageUid: "subjpage" }), { subjectUid: "subjpage", pageUid: "subjpage" }, new Set()), false);
});

const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;
after(() => win.close());

const popover = doc.createElement("div");
popover.className = "rm-autocomplete__results";
doc.body.append(popover);
const model = (key) => ({ key, trail: ["Page"], items: [{ uid: "a", text: "line", string: "line", depth: 0, heading: 0, target: true }] });
const rowNodes = () => ["r1", "r2"].map((uid, i) => {
  const node = Object.assign(doc.createElement("div"), { className: "burrow-row", textContent: uid });
  node.dataset.index = String(i);
  return node;
});
const stubHeight = (node, value) => Object.defineProperty(node, "offsetHeight", { configurable: true, get: () => value });

test("docked: the pane's height is the same before and after the footer, and hide() removes it", () => {
  const preview = createPreview({ doc, win, lifecycle: createLifecycle() });
  const native = doc.createElement("div");
  native.className = "rm-autocomplete__preview";
  native.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 240 });
  const docked = doc.createElement("div");
  docked.className = "rm-autocomplete__results rm-autocomplete__results--expanded";
  docked.append(native);
  doc.body.append(docked);
  preview.show(model("k1"), docked);
  const before = preview.node.style.height;
  assert.equal(before, "240px");
  preview.setFooter(rowNodes());
  assert.equal(preview.node.style.height, before);
  assert.equal(preview.footerRows, 2);
  assert.equal(preview.node.lastElementChild.className, "burrow-preview-related");
  assert.equal(preview.node.querySelector(".burrow-preview-related .burrow-related-label").textContent, "Related");
  preview.show(model("k2"), docked);
  assert.equal(preview.node.style.height, before, "a new model does not touch it");
  assert.equal(preview.footerRows, 2, "and does not remove the footer by itself");
  preview.hide();
  assert.equal(preview.footerRows, 0);
  assert.equal(preview.node.querySelector(".burrow-preview-related"), null);
  docked.remove();
});

test("beside: the height is pinned to what it was while the footer is there, and released with it", () => {
  const preview = createPreview({ doc, win, lifecycle: createLifecycle() });
  stubHeight(preview.node, 187);
  preview.show(model("b1"), popover, { beside: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } });
  assert.equal(preview.node.style.height, "", "beside, the pane sizes to its content");
  preview.setFooter(rowNodes());
  assert.equal(preview.node.style.height, "187px", "pinned to the height it had");
  preview.show(model("b1"), popover, { beside: { left: 5, top: 5, right: 105, bottom: 105, width: 100, height: 100 } });
  assert.equal(preview.node.style.height, "187px", "placing again keeps the pin");
  preview.setFooter(null);
  assert.equal(preview.node.style.height, "");
  assert.equal(preview.footerRows, 0);
  preview.setFooter(rowNodes());
  preview.hide();
  assert.equal(preview.node.style.height, "", "hide releases the pin too");
  assert.equal(preview.node.querySelector(".burrow-preview-related"), null);
});

test("hint line: the footer's ⌥R item, its own line while a row holds the selection", () => {
  const keys = (items) => items.map(([k, label]) => `${k} ${label}`).join(" · ");
  const base = { kind: "((", row: null, native: null, rowsAbove: false, on: {} };
  assert.equal(keys(pickerHints({ ...base, footer: "available" }, true)), "⌥R related");
  assert.equal(keys(pickerHints({ ...base, footer: "available", related: "available" }, true)), "⌥R related", "one item for both");
  assert.equal(keys(pickerHints({ ...base, footer: "active" }, true)), "↵ insert · ↑↓ move · esc back");
  assert.equal(keys(pickerHints({ ...base, footer: "available", prompt: "add" }, true)), "↵ save alias · esc cancel");
  assert.equal(keys(pickerHints({ ...base, footer: "available", held: true }, true)), "");
  assert.match(pickerHints({ ...base, footer: "available" }, true)[0][2], /related to the highlighted one/);
  assert.equal(keys(pickerHints({ ...base, footer: null }, true)), "");
  assert.equal(keyLabel("altR", true), "⌥R");
});

test("key list: the footer line is there with semanticRelated on, absent with it off", () => {
  const reader = (over = {}) => (id) => (id in over ? over[id] : DEFAULTS[id]);
  const lines = (groups) => groups.flatMap((g) => g.items.map(([k, what]) => `${g.title}: ${k} ${what}`));
  const on = lines(helpGroups(reader({ semanticRows: false }), true));
  assert.ok(on.some((l) => l === "Related: ⌥R the blocks related to the highlighted one, under its preview"), on.join("\n"));
  assert.ok(on.some((l) => l.startsWith("Related: ⇧↵ ⌥↵ ⌘⇧↵ act on them")));
  assert.deepEqual(helpGroups(reader({ semanticRows: false }), true).map((g) => g.title).filter((t) => t === "Related"), ["Related"], "the group is created");
  const both = lines(helpGroups(reader(), true));
  assert.ok(both.some((l) => l.startsWith("Related: ⌥R move into the Related rows")));
  assert.ok(both.some((l) => l.includes("under its preview")));
  const off = helpGroups(reader({ semanticRows: false, semanticRelated: false }), true);
  assert.ok(!off.some((g) => g.title === "Related"));
  const rowsOnly = lines(helpGroups(reader({ semanticRelated: false }), true));
  assert.ok(!rowsOnly.some((l) => l.includes("under its preview")));
});

test("settings: semanticRelated is on by default, has a switch after semanticRows, and names the provider", () => {
  assert.equal(DEFAULTS.semanticRelated, true);
  const ids = createSettingsPanel().settings.map((s) => s.id);
  assert.equal(ids.indexOf("semanticRelated"), ids.indexOf("semanticRows") + 1);
  const entry = createSettingsPanel().settings.find((s) => s.id === "semanticRelated");
  assert.equal(entry.name, "Related to the highlighted block");
  assert.equal(entry.action.type, "switch");
  assert.match(entry.description, /embedding provider/);
  assert.match(entry.description, /encrypted graph/);
  assert.match(entry.description, /first ten blocks, up to 600 characters/);
  assert.match(entry.description, /kept per graph/);
});
