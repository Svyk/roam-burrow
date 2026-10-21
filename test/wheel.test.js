import assert from "node:assert/strict";
import test from "node:test";

import { wheelPlan } from "../src/wheel.js";

const chips = (left, max) => ({ left, max });

test("a vertical wheel scrolls the chip line while it can move that way", () => {
  assert.deepEqual(wheelPlan({ deltaY: 100 }, chips(0, 300)), { to: "chips", left: 100 });
  assert.deepEqual(wheelPlan({ deltaY: 100 }, chips(250, 300)), { to: "chips", left: 300 });
  assert.deepEqual(wheelPlan({ deltaY: -100 }, chips(50, 300)), { to: "chips", left: 0 });
  assert.deepEqual(wheelPlan({ deltaY: 3, deltaMode: 1 }, chips(0, 300)), { to: "chips", left: 48 });
});

test("at either end of the chip line the wheel goes to Roam's list", () => {
  assert.deepEqual(wheelPlan({ deltaY: 100 }, chips(300, 300)), { to: "list", by: 100 });
  assert.deepEqual(wheelPlan({ deltaY: 100 }, chips(299.7, 300)), { to: "list", by: 100 });
  assert.deepEqual(wheelPlan({ deltaY: -100 }, chips(0, 300)), { to: "list", by: -100 });
  // Chips that all fit never take the wheel.
  assert.deepEqual(wheelPlan({ deltaY: 100 }, chips(0, 0)), { to: "list", by: 100 });
});

test("over Burrow's rows the wheel scrolls Roam's list", () => {
  assert.deepEqual(wheelPlan({ deltaY: 40 }, null), { to: "list", by: 40 });
  assert.deepEqual(wheelPlan({ deltaY: -2, deltaMode: 1 }, null), { to: "list", by: -32 });
});

test("horizontal swipes and Shift+wheel are the browser's", () => {
  assert.deepEqual(wheelPlan({ deltaX: 80, deltaY: 10 }, chips(0, 300)), { to: "native" });
  assert.deepEqual(wheelPlan({ deltaY: 100, shiftKey: true }, chips(0, 300)), { to: "native" });
  assert.deepEqual(wheelPlan({ deltaX: 80 }, null), { to: "native" });
  assert.deepEqual(wheelPlan({ deltaX: 0, deltaY: 0 }, chips(0, 300)), { to: "native" });
});
