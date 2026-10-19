import assert from "node:assert/strict";
import test from "node:test";

import { scopeRows } from "../src/scope.js";

const nodes = () => [
  { uid: "a", string: "Weekly sanitation plan", heading: 2, kids: [{ uid: "a1" }] },
  { uid: "b", string: "**Sanitation** checklist for the line", heading: 0, kids: [] },
  { uid: "c", string: "Budget notes", heading: 0, kids: null },
  { uid: "d", string: "Sanitation", heading: 0, kids: [] },
];

test("a blank query keeps every node in outline order", () => {
  const rows = scopeRows(nodes(), "  ");
  assert.deepEqual(rows.map((r) => r.uid), ["a", "b", "c", "d"]);
  assert.equal(scopeRows(nodes(), "")[0].node.uid, "a");
});

test("filtering drops non-matches and ranks the better match first, ties in outline order", () => {
  const rows = scopeRows(nodes(), "sanitation");
  assert.deepEqual(rows.map((r) => r.uid).sort(), ["a", "b", "d"]);
  assert.equal(rows[0].uid, "d");
  assert.deepEqual(rows.map((r) => r.uid), ["d", "b", "a"]);
  const tied = scopeRows([{ uid: "x", string: "sanitation", kids: [] }, { uid: "y", string: "sanitation", kids: [] }], "sanitation");
  assert.deepEqual(tied.map((r) => r.uid), ["x", "y"]);
});

test("drillable is true only for nodes with children; heading is carried", () => {
  const rows = scopeRows(nodes(), "");
  assert.deepEqual(rows.map((r) => r.drillable), [true, false, false, false]);
  assert.equal(rows[0].heading, 2);
});

test("strict drops typo matches that forgiving matching keeps", () => {
  assert.equal(scopeRows(nodes(), "sanitaton", { strict: true }).length, 0);
  assert.ok(scopeRows(nodes(), "sanitaton").length > 0);
});

test("markup is stripped for matching and text() shapes the display text", () => {
  const rows = scopeRows(nodes(), "checklist", { text: (s) => s.replace(/\*\*/g, "") });
  assert.deepEqual(rows.map((r) => r.text), ["Sanitation checklist for the line"]);
  assert.equal(scopeRows([{ uid: "x", string: "[[Plan]] review", kids: [] }], "plan review").length, 1);
});

import { CAP, capRows, firstReal } from "../src/scope.js";

test("rows carry empty and ord flags", () => {
  const rows = scopeRows([{ uid: "e", string: "  ", kids: [] }, { uid: "f", string: "text", kids: [] }], "");
  assert.deepEqual(rows.map((r) => [r.empty, r.ord]), [[true, false], [false, false]]);
});

test("hideEmpty drops empty blocks without children, with or without a query", () => {
  const list = () => [
    { uid: "e1", string: "", kids: [] },
    { uid: "e2", string: " ", kids: [{ uid: "k" }] },
    { uid: "e3", string: "**", kids: null },
    { uid: "t", string: "text", kids: [] },
  ];
  const text = (s) => s.replace(/\*\*/g, "");
  assert.deepEqual(scopeRows(list(), "", { hideEmpty: true, text }).map((r) => r.uid), ["e2", "t"]);
  assert.deepEqual(scopeRows(list(), "", { text }).map((r) => r.uid), ["e1", "e2", "e3", "t"]);
  assert.deepEqual(scopeRows(list(), "text", { hideEmpty: true, text }).map((r) => r.uid), ["t"]);
});

test("ordinals rank a numbered block above a better text match and rescue scorer misses", () => {
  const list = [
    { uid: "a", string: "intro mentions 2 things", kids: [] },
    { uid: "b", string: "2. bake", kids: [] },
    { uid: "c", string: "(2) later", kids: [] },
    { uid: "d", string: "unrelated", kids: [] },
  ];
  const on = scopeRows(list, "2", { ordinals: true });
  assert.deepEqual(on.map((r) => r.uid), ["b", "c", "a"]);
  assert.deepEqual(on.map((r) => r.ord), [true, true, false]);
  assert.ok(scopeRows(list, "2").every((r) => !r.ord));
  const letters = scopeRows([{ uid: "x", string: "(b) cool", kids: [] }, { uid: "y", string: "other", kids: [] }], "(b)", { ordinals: true });
  assert.deepEqual(letters.map((r) => r.uid), ["x"]);
});

test("capRows slices and adds a +N more row", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ uid: `u${i}`, text: "t", empty: false }));
  assert.equal(CAP, 50);
  assert.equal(capRows(rows, Infinity), rows);
  assert.equal(capRows(rows, 120), rows);
  const capped = capRows(rows, 50);
  assert.equal(capped.length, 51);
  assert.deepEqual(capped[50], { more: 70, key: "more", uid: null, text: "", drillable: false });
  assert.equal(capped[49].uid, "u49");
});

test("firstReal skips empty rows and more rows", () => {
  assert.equal(firstReal([{ empty: true }, { empty: false }]), 1);
  assert.equal(firstReal([{ empty: true }, { empty: true }]), 0);
  assert.equal(firstReal([{ more: 3, empty: false }, { empty: false }]), 1);
  assert.equal(firstReal([]), 0);
});
