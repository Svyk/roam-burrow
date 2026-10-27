import assert from "node:assert/strict";
import test from "node:test";

import { createPickInfo, filterCandidates, latestEdits, mergeCandidates, pullBlocks } from "../src/recents.js";

test("latestEdits: the newest blocks, and pages by their newest block", () => {
  const rows = [];
  for (let i = 0; i < 50; i++) rows.push([`blk${String(i).padStart(6, "0")}`, 1000 + i, `pg${i % 5}`, `Page ${i % 5}`]);
  const out = latestEdits(rows, { blocks: 3, pages: 2 });
  assert.deepEqual(out.blocks.map((b) => b.t), [1049, 1048, 1047]);
  assert.equal(out.blocks[0].page, "Page 4");
  assert.deepEqual(out.pages.map((p) => p.title), ["Page 4", "Page 3"]);
  assert.equal(out.pages[0].t, 1049);
  assert.deepEqual(latestEdits(null), { blocks: [], pages: [] });
});

test("mergeCandidates: picks first, edited after, deduped, the current block and page left out", () => {
  const out = mergeCandidates({
    picks: [{ uid: "a", text: "A" }, { uid: "cur", text: "current" }, null],
    edited: [{ uid: "b", text: "B" }, { uid: "a", text: "A again" }, { uid: "c", text: "  " }, { uid: "d", text: "D" }],
    skipUid: "cur",
  });
  assert.deepEqual(out.map((c) => [c.uid, c.recent]), [["a", "pick"], ["b", "edit"], ["d", "edit"]]);
  const pages = mergeCandidates({ picks: [{ uid: "p1", text: "Here" }, { uid: "p2", text: "There" }], skipText: "Here" });
  assert.deepEqual(pages.map((c) => c.uid), ["p2"]);
});

test("filterCandidates: nothing typed takes the first rows; one or two characters need a word that starts with them", () => {
  const cands = [
    { uid: "1", text: "Zebra crossing notes" },
    { uid: "2", text: "Ant-Man review" },
    { uid: "3", text: "The quokka appears" },
    { uid: "4", text: "Another page" },
    { uid: "5", text: "Quarterly report" },
  ];
  assert.deepEqual(filterCandidates(cands, "", 3).map((c) => c.uid), ["1", "2", "3"]);
  assert.deepEqual(filterCandidates(cands, "a", 3).map((c) => c.uid), ["2", "3", "4"]);
  assert.deepEqual(filterCandidates(cands, "QU", 3).map((c) => c.uid), ["3", "5"]);
  assert.deepEqual(filterCandidates(cands, "ma", 3).map((c) => c.uid), ["2"], "a word start, not a middle");
  assert.deepEqual(filterCandidates(cands, "q", 1).map((c) => c.uid), ["3"]);
  assert.deepEqual(filterCandidates(cands, "zz", 3), []);
});

test("pullBlocks drops empty strings and uses pull_many when present", () => {
  const blocks = [{ uid: "a", t: 3, page: "P" }, { uid: "b", t: 2, page: "P" }, { uid: "c", t: 1, page: "P" }];
  const strings = { a: "text a", b: "   ", c: "text c" };
  const seen = [];
  const many = { data: { pull_many: (pattern, eids) => { seen.push(eids.length); return eids.map(([, u]) => ({ ":block/string": strings[u] })); } } };
  assert.deepEqual(pullBlocks(many, blocks).map((b) => b.uid), ["a", "c"]);
  assert.deepEqual(seen, [3]);
  const single = { pull: (pattern, [, u]) => ({ ":block/string": strings[u] }) };
  assert.deepEqual(pullBlocks(single, blocks).map((b) => b.string), ["text a", "text c"]);
});

test("pickInfo reads a picked block the indexes do not know once, at idle, and skips a deleted one", () => {
  let queue = [];
  const pulls = [];
  const api = { pull: (pattern, [, u]) => { pulls.push(u); return u === "gone" ? null : { ":block/string": "picked text", ":block/page": { ":node/title": "Some page" } }; } };
  const recent = ["known", "gone", "live"];
  const info = createPickInfo({ api, idle: (fn) => queue.push(fn), frecency: { recent: () => recent }, known: (u) => u === "known" });
  info.refresh();
  info.refresh();
  assert.equal(queue.length, 1);
  assert.deepEqual(pulls, [], "nothing is read on the call itself");
  queue.shift()();
  assert.deepEqual(pulls, ["gone", "live"]);
  assert.deepEqual(info.get("live"), { string: "picked text", page: "Some page" });
  assert.equal(info.get("gone"), null);
  info.refresh();
  queue.shift()();
  assert.deepEqual(pulls, ["gone", "live"], "each uid is read once");
  info.clear();
  assert.equal(info.get("live"), null);
});
