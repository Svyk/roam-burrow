import assert from "node:assert/strict";
import test from "node:test";

import { buildTitleIndex } from "../src/titles.js";

const uid = (n) => `uid${String(n).padStart(6, "0")}`;

test("byUid maps a page uid to its title", () => {
  const titles = buildTitleIndex([["Ant-Man", "p1"], ["Wasp", "p2"]], null);
  assert.equal(titles.byUid("p2"), "Wasp");
  assert.equal(titles.byUid("nope"), null);
});

test("title index for 7k titles builds in well under a frame budget per call", () => {
  const rows = Array.from({ length: 7000 }, (_, i) => [`Page ${i} about Topic-${i % 97}`, uid(i)]);
  const t0 = performance.now();
  const titles = buildTitleIndex(rows, null);
  const built = performance.now() - t0;
  assert.equal(titles.size, 7000);
  const t1 = performance.now();
  for (let i = 0; i < 1000; i++) titles.resolve(`page ${i} about topic ${i % 97}`);
  const per = (performance.now() - t1) / 1000;
  assert.ok(per < 0.2, `resolve ${per.toFixed(3)} ms`);
  assert.ok(built < 400, `build ${built.toFixed(1)} ms`);
});
