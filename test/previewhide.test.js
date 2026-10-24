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

test("a sibling or child holding a macro that only starts like a task draws as text, never throws", () => {
  // svy: emTmVEQNG under the TODO ssK8TddXh on Patterns.
  const smart = { uid: "sb", string: "{{TODO today:SmartBlock:TODO today}}", kids: [] };
  const done = { uid: "d", string: "{{[[DONE]]}} done", kids: [] };
  const tree2 = {
    children: (uid) => (uid === "p" ? [{ uid: "t", string: "{{[[TODO]]}} [[Tasks/today]]", kids: [smart] }, smart, done] : uid === "t" ? [smart] : []),
    twoLevels: (uid) => tree2.children(uid),
    trail: () => [{ uid: "p", title: "P" }],
  };
  const items = previewModel({ page, target: { uid: "t", string: "{{[[TODO]]}} [[Tasks/today]]" } }, tree2, text).items;
  assert.deepEqual(items.map((i) => [i.uid, i.task]), [["t", "todo"], ["sb", null], ["sb", null], ["d", "done"]]);
  assert.deepEqual(previewModel({ page, target: null }, tree2, text).items.map((i) => i.task), ["todo", null, null, "done"]);
});
