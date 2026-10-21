import { test } from "node:test";
import assert from "node:assert/strict";
import { previewModel } from "../src/preview.js";

const nodes = {
  p: [
    { uid: "a", string: "one", kids: [] },
    { uid: "e1", string: "", kids: [] },
    { uid: "e2", string: "  ", kids: null },
    { uid: "t", string: "", kids: [] },
    { uid: "b", string: "two", kids: [] },
  ],
};
const tree = {
  children: (uid) => nodes[uid] || [],
  twoLevels: (uid) => nodes[uid] || [],
  trail: () => [{ uid: "p", title: "P" }],
};
const text = (s) => s;
const page = { uid: "p", title: "P" };

test("hideEmpty drops empty leaves from the page preview", () => {
  const all = previewModel({ page, target: null }, tree, text).items.length;
  const hid = previewModel({ page, target: null }, tree, text, { hideEmpty: true }).items.map((i) => i.uid);
  assert.equal(all, 5);
  assert.deepEqual(hid, ["a", "e2", "t", "b"].filter((u) => u !== "t"));
});

test("hideEmpty keeps an empty target but drops empty siblings", () => {
  const ids = previewModel({ page, target: { uid: "t" } }, tree, text, { hideEmpty: true }).items.map((i) => i.uid);
  assert.deepEqual(ids, ["a", "e2", "t", "b"]);
});
