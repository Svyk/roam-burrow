import assert from "node:assert/strict";
import test from "node:test";

import { wheelPlan } from "../src/wheel.js";

const chips = (left, max) => ({ left, max });
const list = (top, max) => ({ top, max });
const mid = list(200, 600);

test("a vertical wheel scrolls the chip line while it can move that way", () => {
  assert.deepEqual(wheelPlan({ deltaY: 100 }, chips(0, 300)), { to: "chips", left: 100 });
  assert.deepEqual(wheelPlan({ deltaY: 100 }, chips(250, 300)), { to: "chips", left: 300 });
  assert.deepEqual(wheelPlan({ deltaY: -100 }, chips(50, 300)), { to: "chips", left: 0 });
  assert.deepEqual(wheelPlan({ deltaY: 3, deltaMode: 1 }, chips(0, 300)), { to: "chips", left: 48 });
});

test("at either end of the chip line the wheel goes to Roam's list", () => {
  assert.deepEqual(wheelPlan({ deltaY: 100 }, chips(300, 300), mid), { to: "list", by: 100 });
  assert.deepEqual(wheelPlan({ deltaY: 100 }, chips(299.7, 300), mid), { to: "list", by: 100 });
  assert.deepEqual(wheelPlan({ deltaY: -100 }, chips(0, 300), mid), { to: "list", by: -100 });
  // Chips that all fit never take the wheel.
  assert.deepEqual(wheelPlan({ deltaY: 100 }, chips(0, 0), mid), { to: "list", by: 100 });
});

test("over Burrow's rows the wheel scrolls Roam's list", () => {
  assert.deepEqual(wheelPlan({ deltaY: 40 }, null, mid), { to: "list", by: 40 });
  assert.deepEqual(wheelPlan({ deltaY: -2, deltaMode: 1 }, null, mid), { to: "list", by: -32 });
});

test("a wheel Roam's list cannot take is the browser's", () => {
  assert.deepEqual(wheelPlan({ deltaY: 40 }, null, list(600, 600)), { to: "native" });
  assert.deepEqual(wheelPlan({ deltaY: -40 }, null, list(0, 600)), { to: "native" });
  assert.deepEqual(wheelPlan({ deltaY: 40 }, null, list(0, 0)), { to: "native" });
  assert.deepEqual(wheelPlan({ deltaY: 40 }, chips(300, 300), list(599.8, 600)), { to: "native" });
  assert.deepEqual(wheelPlan({ deltaY: 40 }, null, null), { to: "native" });
  // The chips still take it while they can move, whatever the list can do.
  assert.deepEqual(wheelPlan({ deltaY: 40 }, chips(0, 300), list(600, 600)), { to: "chips", left: 40 });
});

test("horizontal swipes and Shift+wheel are the browser's", () => {
  assert.deepEqual(wheelPlan({ deltaX: 80, deltaY: 10 }, chips(0, 300)), { to: "native" });
  assert.deepEqual(wheelPlan({ deltaY: 100, shiftKey: true }, chips(0, 300)), { to: "native" });
  assert.deepEqual(wheelPlan({ deltaX: 80 }, null), { to: "native" });
  assert.deepEqual(wheelPlan({ deltaX: 0, deltaY: 0 }, chips(0, 300)), { to: "native" });
});
