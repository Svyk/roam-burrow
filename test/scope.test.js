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
