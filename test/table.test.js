import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { createLifecycle } from "../src/lifecycle.js";
import { createTreeSource, PAUSE } from "../src/pagetree.js";
import { createPreview, previewModel } from "../src/preview.js";
import { richParts } from "../src/rich.js";
import { CHAIN, clipParts, isTableBlock, tableChain, tableModel } from "../src/table.js";

const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;
after(() => win.close());

test("isTableBlock: native table macros only", () => {
  for (const s of ["{{[[table]]}}", "{{table}}", " {{ [[table]] }} ", "{{[[TABLE]]}}", "x {{table}} y"]) assert.equal(isTableBlock(s), true, s);
  for (const s of ["{{[[roam/grid]]}}", "table", "[[table]]", "", null]) assert.equal(isTableBlock(s), false, String(s));
});

const cell = (n, string, order, children = []) => ({ ":block/uid": `c${n}`, ":block/string": string, ":block/order": order, ":block/children": children });

test("tableChain picks the smallest-order child per level, maps ' ' to '', counts past 5", () => {
  const deep = { ":db/id": 9, ":block/order": 0, ":block/children": [{ ":db/id": 10, ":block/order": 0 }] };
  const raw = cell(1, "a", 0, [
    cell(9, "decoy", 5),
    cell(2, " ", 1, [cell(3, "c", 4, [cell(4, "d", 0, [])]), cell(7, "x", 9)]),
  ]);
  // the smallest order wins at each level: c2 (1) over decoy (5), then c3 (4) over x (9)
  const chain = tableChain(raw);
  assert.deepEqual(chain.cells.map((c) => c.string), ["a", "", "c", "d"]);
  assert.equal(chain.length, 4);
  const longer = tableChain(cell(1, "a", 0, [cell(2, "b", 0, [cell(3, "c", 0, [cell(4, "d", 0, [cell(5, "e", 0, [deep])])])])]));
  assert.equal(longer.cells.length, 5);
  assert.equal(longer.length, 7);
});

test("tableModel: more rows and columns", () => {
  const a = { cells: [{ uid: "a", string: "1" }, { uid: "b", string: "2" }], length: 2 };
  const b = { cells: [{ uid: "c", string: "3" }], length: 7 };
  const m = tableModel("t", 200, [a, b]);
  assert.equal(m.cols, 2);
  assert.equal(m.moreRows, 194);
  assert.equal(m.moreCols, 2);
  assert.deepEqual(tableModel("t", 3, [a]), { uid: "t", rows: [a.cells], cols: 2, moreRows: 0, moreCols: 0 });
});

test("clipParts cuts at 40 characters with an ellipsis part", () => {
  const out = clipParts([{ text: "x".repeat(30), cls: "" }, { text: "y".repeat(30), cls: "burrow-b" }]);
  assert.equal(out.map((p) => p.text).join(""), `${"x".repeat(30)}${"y".repeat(10)}…`);
  assert.equal(out.at(-1).cls, "burrow-ellipsis");
  assert.equal(out[1].cls, "burrow-b");
  const fits = [{ text: "x".repeat(40), cls: "" }];
  assert.deepEqual(clipParts(fits), fits);
});

// A page P > table T with `rows` rows; each row is a `width`-cell first-child chain.
function tableGraph(rows = 200, width = 7) {
  const byUid = new Map();
  const byEid = new Map();
  let next = 1;
  const make = (uid, string, order, parent) => {
    const n = { eid: next++, uid, string, order, parent, children: [] };
    byUid.set(uid, n);
    byEid.set(n.eid, n);
    parent?.children.push(n);
    return n;
  };
  const page = make("P", null, 0, null);
  const table = make("T", "{{[[table]]}}", 0, page);
  for (let r = 0; r < rows; r++) {
    let at = make(`r${r}`, `r${r}c0`, r, table);
    for (let c = 1; c < width; c++) {
      make(`r${r}x${c}decoy`, "decoy", 9, at);
      at = make(`r${r}c${c}`, c === 1 ? " " : r === 1 && c === 2 ? "**bold** and " + "w".repeat(60) : `r${r}c${c}`, 0, at);
    }
  }
  const calls = { chain: 0, other: 0, kinds: [] };
  const raw = (n, depth) => {
    const out = { ":block/order": n.order };
    if (depth > 0) { out[":block/uid"] = n.uid; out[":block/string"] = n.string; } else out[":db/id"] = n.eid;
    if (n.children.length) out[":block/children"] = [...n.children].reverse().map((c) => raw(c, depth - 1));
    return out;
  };
  const pull = (pattern, ref) => {
    const n = Array.isArray(ref) ? byUid.get(ref[1]) : byEid.get(ref);
    if (!n) return null;
    if (pattern === CHAIN) { calls.chain += 1; return raw(n, 5); }
    calls.other += 1;
    if (pattern.startsWith("[:db/id {(limit :block/children ")) {
      return { ":db/id": n.eid, ":block/children": [...n.children].reverse().slice(0, 151).map((c) => ({ ":db/id": c.eid, ":block/order": c.order })) };
    }
    if (pattern === "[:db/id :block/order]") return { ":db/id": n.eid, ":block/order": n.order };
    if (pattern.includes("_children")) {
      const up = (m) => {
        const out = { ":block/uid": m.uid, ":block/order": m.order };
        if (m.string != null) out[":block/string"] = m.string; else out[":node/title"] = "Page";
        if (m.parent) out[":block/_children"] = [up(m.parent)];
        return out;
      };
      return up(n);
    }
    const out = { ":block/uid": n.uid, ":block/string": n.string, ":block/order": n.order };
    if (n.children.length) out[":block/children"] = [{ ":db/id": n.children[0].eid }];
    return out;
  };
  const q = (query, eid) => [...byEid.get(eid).children].reverse().map((c) => c.eid);
  const fetched = [];
  const source = (opts = {}) => createTreeSource({ pull, q, onFetch: (kind) => fetched.push(kind), ...opts });
  return { calls, fetched, source, byUid };
}

test("a 200-row table costs the id reads plus exactly 6 chain pulls, once", () => {
  const g = tableGraph();
  const tree = g.source();
  const read = tree.bounded();
  const model = read.table("T");
  assert.equal(g.fetched.filter((k) => k === "chain").length, 6);
  assert.equal(g.calls.chain, 6);
  assert.deepEqual(model.rows.map((r) => r[0].string), ["r0c0", "r1c0", "r2c0", "r3c0", "r4c0", "r5c0"]);
  assert.equal(model.rows[0][1].string, "", "a stored ' ' is an empty cell");
  assert.equal(model.cols, 5);
  assert.equal(model.moreRows, 194);
  assert.equal(model.moreCols, 2);
  read.table("T");
  tree.bounded().table("T");
  assert.equal(g.calls.chain, 6);
  tree.clear();
  tree.bounded().table("T");
  assert.equal(g.calls.chain, 12, "clear() drops the cache");
});

test("the full reader reads a table the same way", () => {
  const g = tableGraph(10, 3);
  const model = g.source().full.table("T");
  assert.equal(g.calls.chain, 6);
  assert.equal(model.moreRows, 4);
  assert.equal(model.moreCols, 0);
  assert.equal(model.cols, 3);
});

test("a used-up slice pauses between rows; resuming does not re-pull cached chains", () => {
  const g = tableGraph();
  const tree = g.source();
  let budget = 6; // the ids (a pull, a query, two batches of orders), then two chains
  assert.throws(() => tree.bounded(() => budget-- <= 0).table("T"), (e) => e === PAUSE);
  assert.equal(g.calls.chain, 2);
  const model = tree.bounded().table("T");
  assert.equal(g.calls.chain, 6);
  assert.equal(model.rows.length, 6);
});

const plainReader = (table) => ({
  trail: () => [],
  window: (uid, from, size) => (uid === "P"
    ? { total: 1, kids: [{ uid: "T", string: table.string, kids: [] }].slice(from, from + size) }
    : { total: 2, kids: [{ uid: "k1", string: "kid 1", kids: [] }, { uid: "k2", string: "kid 2", kids: [] }] }),
  indexOf: () => 0,
  ...(table.read ? { table: table.read } : {}),
});
const model = { uid: "T", rows: [[{ uid: "a", string: "A" }]], cols: 1, moreRows: 0, moreCols: 0 };

test("previewModel: tables on gives one table item and no row items; off is the outline", () => {
  const reader = plainReader({ string: "{{[[table]]}}", read: () => model });
  const page = { uid: "P", title: "P" };
  const target = { uid: "T", string: "{{[[table]]}}" };
  const on = previewModel({ page, target }, reader, (s) => s, { tables: true });
  assert.deepEqual(on.items.map((i) => i.uid), ["T", "T"]);
  assert.equal(on.items[1].table, model);
  assert.equal(on.items.filter((i) => i.uid === "k1").length, 0);
  const off = previewModel({ page, target }, reader, (s) => s, { tables: false });
  assert.deepEqual(off.items.map((i) => i.uid), ["T", "k1", "k2"]);
  assert.notEqual(on.key, off.key);
  const adapted = previewModel({ page, target }, { trail: () => [], children: (uid) => (uid === "P" ? [target] : [{ uid: "k1", string: "kid", kids: [] }]) }, (s) => s, { tables: true });
  assert.deepEqual(adapted.items.map((i) => i.uid), ["T", "k1"], "a reader without table() keeps the outline");
});

test("previewModel: a roam/grid target gets no table item", () => {
  const reader = plainReader({ string: "{{[[roam/grid]]}}", read: () => assert.fail("not read") });
  const out = previewModel({ page: { uid: "P", title: "P" }, target: { uid: "T", string: "{{[[roam/grid]]}}" } }, reader, (s) => s, { tables: true });
  assert.equal(out.items.some((i) => i.table), false);
});

test("the preview draws a 6x5 grid, clipped rich cells and a footer, with no handlers", () => {
  const g = tableGraph();
  const tree = g.source();
  const read = tree.bounded();
  const m = previewModel({ page: { uid: "P", title: "Page" }, target: tree.get("T") ?? { uid: "T", string: "{{[[table]]}}" } }, read, (s) => s, { tables: true });
  assert.equal(m.items.filter((i) => i.table).length, 1);
  const preview = createPreview({ doc, win, lifecycle: createLifecycle(), rich: (item) => richParts(item.string) });
  const popover = doc.createElement("div");
  doc.body.append(popover);
  preview.show(m, popover);
  const cells = [...preview.node.querySelectorAll(".burrow-cell")];
  assert.equal(cells.length, 30, "6 rows x 5 columns, rectangular");
  assert.equal(preview.node.querySelector(".burrow-table").style.getPropertyValue("--burrow-cols"), "5");
  const long = cells[7]; // row 1, column 2
  assert.ok(long.textContent.length <= 41, `${long.textContent.length}`);
  assert.ok(long.textContent.endsWith("…"));
  assert.ok(long.querySelector(".burrow-b"));
  assert.equal(preview.node.querySelector(".burrow-table-more").textContent, "+194 rows, +2 cols");
  assert.ok(preview.node.querySelector(".burrow-table-line"));
  for (const el of preview.node.querySelectorAll("*")) for (const a of el.attributes) assert.ok(!a.name.startsWith("on"), a.name);
  // same table again: the line is not rebuilt
  const grid = preview.node.querySelector(".burrow-table");
  preview.show({ ...m, key: "again" }, popover);
  assert.equal(preview.node.querySelector(".burrow-table"), grid);
});

test("plain cells (no rich) are cut at 40 characters", () => {
  const preview = createPreview({ doc, win, lifecycle: createLifecycle() });
  const popover = doc.createElement("div");
  doc.body.append(popover);
  const m = { key: "p", trail: ["P"], items: [{ uid: "T", table: { uid: "T", rows: [[{ uid: "a", string: "z".repeat(60) }, { uid: "b", string: "ok" }], [{ uid: "c", string: "x" }]], cols: 2, moreRows: 0, moreCols: 0 }, depth: 1 }] };
  preview.show(m, popover);
  const cells = [...preview.node.querySelectorAll(".burrow-cell")];
  assert.equal(cells.length, 4, "the short row is padded");
  assert.equal(cells[0].textContent, `${"z".repeat(40)}…`);
  assert.equal(cells[3].textContent, "");
  assert.equal(preview.node.querySelector(".burrow-table-more"), null);
});
