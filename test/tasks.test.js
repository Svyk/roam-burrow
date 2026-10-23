import assert from "node:assert/strict";
import test from "node:test";

import { hasTask, taskParts, taskStatus } from "../src/tasks.js";

test("TODO and DONE macros become task parts where they sit; the rest stays text", () => {
  assert.deepEqual(taskParts("{{[[DONE]]}} Watch [[Agents of S.H.I.E.L.D.]] S6"), [{ task: "done" }, { text: " Watch [[Agents of S.H.I.E.L.D.]] S6" }]);
  assert.deepEqual(taskParts("{{[[TODO]]}}Buy milk"), [{ task: "todo" }, { text: "Buy milk" }]);
  assert.deepEqual(taskParts("20:24 - 22:37 {{[[DONE]]}}Watch"), [{ text: "20:24 - 22:37 " }, { task: "done" }, { text: "Watch" }]);
  assert.deepEqual(taskParts("{{TODO}} a"), [{ task: "todo" }, { text: " a" }]);
  assert.deepEqual(taskParts("{{DONE}}"), [{ task: "done" }]);
  // Better Tasks' DONE with an argument.
  assert.deepEqual(taskParts("{{[[DONE]]:((4Szp96jw2))}} read"), [{ task: "done" }, { text: " read" }]);
  assert.deepEqual(taskParts("plain text"), [{ text: "plain text" }]);
  assert.deepEqual(taskParts("{{todo-progress-bar}} and {{query block:TodoPage}}"), [{ text: "{{todo-progress-bar}} and {{query block:TodoPage}}" }]);
});

test("hasTask finds a task macro and nothing else", () => {
  assert.equal(hasTask("{{[[TODO]]}} x"), true);
  assert.equal(hasTask("x {{DONE}}"), true);
  assert.equal(hasTask("{{TODO today:SmartBlock:TODO today}}"), true);
  assert.equal(hasTask("{{todo-progress-bar}}"), false);
  assert.equal(hasTask("[[TODO]] page link"), false);
  assert.equal(hasTask(null), false);
});

test("taskStatus reads Better Tasks' status tag as its stylesheet's attributes", () => {
  assert.deepEqual(taskStatus("{{[[TODO]]}} x #[[task-status/In Review]]"), { status: "IN_REVIEW", shape: "in-review" });
  assert.deepEqual(taskStatus("{{[[TODO]]}} x #task-status/Active"), { status: "ACTIVE", shape: "active" });
  assert.equal(taskStatus("{{[[TODO]]}} plain"), null);
});
