import assert from "node:assert/strict";
import test from "node:test";

import { createTreeSource, PAUSE } from "../src/pagetree.js";
import { previewModel } from "../src/preview.js";

// A page "P" with `top` blocks, each with `kids` children; eids are numbers.
function bigGraph(top = 500, kids = 3) {
  const nodes = new Map();
  let next = 1;
  const make = (uid, string, order, parent, title = null) => {
    const n = { eid: next++, uid, string, order, parent, title, children: [] };
    nodes.set(uid, n);
    nodes.set(n.eid, n);
    parent?.children.push(n);
    return n;
  };
  const page = make("P", null, 0, null, "Page");
  for (let i = 0; i < top; i++) {
    const b = make(`b${i}`, `block ${i}`, i, page);
    for (let j = 0; j < kids; j++) make(`b${i}k${j}`, `kid ${i}.${j}`, j, b);
  }
  // Children come back in an order that is not the outline order.
  const kidsOf = (n) => [...n.children].reverse();
  const raw = (n, depth) => {
    const out = { ":block/uid": n.uid, ":block/order": n.order };
    if (n.title) out[":node/title"] = n.title;
    if (n.string != null) out[":block/string"] = n.string;
    if (n.children.length) out[":block/children"] = kidsOf(n).map((c) => (depth > 0 ? raw(c, depth - 1) : { ":block/uid": c.uid }));
    return out;
  };
  const calls = { pull: 0, slots: 0, orders: 0, brief: 0, entities: 0, biggestRead: 0 };
  const pull = (pattern, ref) => {
    calls.pull += 1;
    const n = nodes.get(Array.isArray(ref) ? ref[1] : ref);
    if (!n) return null;
    if (pattern === "[:db/id]") return { ":db/id": n.eid };
    if (pattern === "[:db/id :block/order]") { calls.entities += 1; return { ":db/id": n.eid, ":block/order": n.order }; }
    if (pattern.includes("_children")) {
      const up = (m) => {
        const out = raw(m, -1);
        delete out[":block/children"];
        if (m.parent) out[":block/_children"] = [up(m.parent)];
        return out;
      };
      return up(n);
    }
    if (pattern.startsWith("[:db/id {(limit :block/children ")) {
      const limit = Number(pattern.match(/limit :block\/children (\d+)/)[1]);
      const kids = kidsOf(n).slice(0, limit);
      calls.slots += 1;
      calls.entities += kids.length;
      calls.biggestRead = Math.max(calls.biggestRead, kids.length);
      return { ":db/id": n.eid, ":block/children": kids.map((c) => ({ ":db/id": c.eid, ":block/order": c.order })) };
    }
    if (pattern.includes("(limit :block/children 1)")) {
      calls.brief += 1;
      calls.entities += 1;
      const out = raw(n, -1);
      out[":block/children"] = n.children.length ? [{ ":db/id": n.children[0].eid }] : undefined;
      if (!n.children.length) delete out[":block/children"];
      return out;
    }
    // The drill reads: the node, two levels below it, and uids under those.
    const count = (m, depth) => 1 + (depth > 0 ? m.children.reduce((s, c) => s + count(c, depth - 1), 0) : m.children.length);
    calls.entities += count(n, 2);
    return raw(n, 2);
  };
  // The child-id query (ids in an order that is not the outline order), and
  // pull_many for their orders, a batch at a time.
  const q = (query, eid) => {
    if (!query.includes(":block/children ?c")) return [];
    const n = nodes.get(eid);
    calls.ids = (calls.ids || 0) + 1;
    calls.entities += n?.children.length ?? 0;
    calls.biggestRead = Math.max(calls.biggestRead, n?.children.length ?? 0);
    return n ? kidsOf(n).map((c) => c.eid) : [];
  };
  const pullMany = (pattern, eids) => {
    calls.orders += 1;
    calls.entities += eids.length;
    calls.biggestRead = Math.max(calls.biggestRead, eids.length);
    return eids.map((eid) => ({ ":db/id": eid, ":block/order": nodes.get(eid).order }));
  };
  const source = () => createTreeSource({ pull, q, pullMany });
  return { pull, q, pullMany, source, calls, nodes };
}

const text = (s) => s;
const page = { uid: "P", title: "Page" };
const shape = (model) => model.items.map((i) => (i.more != null ? `+${i.more}@${i.depth}` : `${i.uid}@${i.depth}${i.target ? "*" : ""}`));

test("a page preview reads only the blocks it shows, and matches the full read", () => {
  const big = bigGraph(500, 3);
  const bounded = previewModel({ page, target: null }, big.source().bounded(), text);
  assert.equal(big.calls.slots, 17, "a limited pull of the page's ids, then of the ids under each of the 16 blocks shown");
  assert.equal(big.calls.ids, 1, "the page has more than 151 blocks: its ids come from one query");
  assert.equal(big.calls.brief, 16 + 16 * 3);
  // 151 ids from the first pull, the page's 500 ids and their orders, 48 ids under the 16 shown, then the 64 blocks shown.
  assert.equal(big.calls.entities, 151 + 2 * 500 + 48 + 64);
  assert.equal(big.calls.orders, 4, "the page's 500 orders in batches of 150; small nodes need none");
  const full = bigGraph(500, 3);
  const whole = previewModel({ page, target: null }, createTreeSource({ pull: full.pull, q: () => [] }).full, text);
  assert.deepEqual(shape(bounded), shape(whole));
  assert.ok(full.calls.entities > 1500, "the drill read takes the whole level");
  assert.equal(shape(bounded).at(-1), "+484@0");
});

test("a block preview reads a window of 24 siblings around the target", () => {
  const big = bigGraph(300, 2);
  const tree = big.source();
  const read = tree.bounded();
  read.trail("b150");
  const model = previewModel({ page, target: tree.get("b150") }, read, text);
  const items = shape(model);
  assert.equal(items[0], "+138@0");
  assert.ok(items.includes("b150@0*"));
  assert.equal(items.at(-1), "+138@0");
  assert.equal(items.filter((i) => /^b\d+@0/.test(i)).length, 24);
  assert.deepEqual(items.slice(items.indexOf("b150@0*") + 1, items.indexOf("b150@0*") + 3), ["b150k0@1", "b150k1@1"]);
  assert.ok(big.calls.brief <= 24 + 2 + 2, `${big.calls.brief} brief pulls`);
});

test("a used-up slice stops before a read with PAUSE; the next slice goes on from there", () => {
  const big = bigGraph(200, 2);
  const tree = big.source();
  let slices = 0;
  let model = null;
  while (!model) {
    slices += 1;
    let budget = 5;
    try {
      model = previewModel({ page, target: null }, tree.bounded(() => budget-- <= 0), text);
    } catch (error) {
      if (error !== PAUSE) throw error;
    }
    assert.ok(slices < 40, "every slice makes progress");
  }
  assert.ok(slices > 3);
  const once = bigGraph(200, 2);
  assert.deepEqual(shape(model), shape(previewModel({ page, target: null }, once.source().bounded(), text)));
  assert.equal(big.calls.slots, once.calls.slots, "no read is repeated across slices");
  assert.equal(big.calls.orders, once.calls.orders);
  assert.equal(big.calls.brief, once.calls.brief);
});

test("bounded reads share the drill cache: a level read in full is not read again", () => {
  const big = bigGraph(40, 2);
  const tree = big.source();
  tree.children("P");
  const before = big.calls.pull;
  previewModel({ page, target: null }, tree.bounded(), text);
  assert.equal(big.calls.pull, before, "the two levels are already known");
  tree.clear();
  assert.equal(tree.size, 0);
});

test("a node with 2,600 children is read in pages: no read takes more than 150 orders, slices go on where they stopped", () => {
  const big = bigGraph(2600, 0);
  const tree = big.source();
  let slices = 0;
  let model = null;
  while (!model) {
    slices += 1;
    let budget = 2;
    try {
      model = previewModel({ page, target: null }, tree.bounded(() => budget-- <= 0), text);
    } catch (error) {
      if (error !== PAUSE) throw error;
    }
    assert.ok(slices < 60, "every slice makes progress");
  }
  assert.ok(slices >= 9, `${slices} slices`);
  assert.equal(big.calls.orders, Math.ceil(2600 / 150), "each batch of orders read once");
  assert.equal(big.calls.ids, 1);
  assert.equal(big.calls.biggestRead, 2600, "the one id query lists them all (1.2 ms at 966 in svy); the orders come in batches");
  assert.equal(shape(model).at(-1), "+2584@0");
  assert.deepEqual(shape(model).slice(0, 2), ["b0@0", "b1@0"]);
});

test("without pull_many the orders are read one pull each, in the same batches", () => {
  const big = bigGraph(400, 1);
  const tree = createTreeSource({ pull: big.pull, q: big.q });
  const model = previewModel({ page, target: null }, tree.bounded(), text);
  assert.deepEqual(shape(model).slice(0, 2), ["b0@0", "b0k0@1"]);
  assert.equal(big.calls.orders, 0);
  assert.equal(big.calls.ids, 1);
});
