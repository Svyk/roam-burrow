import assert from "node:assert/strict";
import test from "node:test";

import { luminance, parseRgb } from "../src/theme.js";

test("body background luminance separates Roam light and dark", () => {
  assert.ok(luminance(parseRgb("rgb(32, 43, 51)")) < 0.2);
  assert.ok(luminance(parseRgb("rgb(255, 255, 255)")) > 0.9);
  assert.equal(parseRgb("transparent"), null);
  assert.equal(parseRgb("rgba(0, 0, 0, 0)").a, 0);
});
