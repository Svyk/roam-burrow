import assert from "node:assert/strict";
import test from "node:test";

import { buildRefIndex, buildRefIndexSliced, rankRefs } from "../src/refindex.js";
import { searchPlan } from "../src/search.js";

const uid = (n) => `uid${String(n).padStart(6, "0")}`;

test("svy shape: the referenced Ant-Man original ranks first", () => {
  const rows = [
    [uid(1), "Antibody manual for the lab", 9],
    [uid(2), "{{[[TODO]]}} Watch [[Ant-Man]]", 1],
    [uid(3), "important manual steps", 30],
    [uid(4), "Man and ant colonies", 4],
  ];
  const ranked = rankRefs(buildRefIndex(rows), searchPlan("ant man"));
  assert.equal(ranked[0].uid, uid(2));
  assert.equal(ranked[0].level, 2);
  assert.ok(!ranked.some((r) => r.uid === uid(3)));
});

test("notes shape: Real-time PCR screen first among look-alikes", () => {
  const rows = [
    [uid(1), "3. Real-time PCR screen", 5],
    [uid(2), "confirmed by real-time PCR and genomic analysis, a long highlight", 1],
    [uid(3), "realtime pcr", 0],
  ];
  const ranked = rankRefs(buildRefIndex(rows), searchPlan("real time pcr"));
  assert.equal(ranked[0].uid, uid(1));
});

test("originals before quoters; a pure quote folds into its original", () => {
  const rows = [
    [uid(1), "Ant-Man notes", 1],
    [uid(2), `((${uid(1)}))`, 12],
    [uid(3), `About ((${uid(1)})) and more`, 7],
  ];
  const ranked = rankRefs(buildRefIndex(rows), searchPlan("ant man"));
  assert.deepEqual(ranked.map((r) => r.uid), [uid(1), uid(3)]);
  assert.equal(ranked[1].quoter, true);
});

test("more inbound refs rank higher inside a level, ties break by length then uid", () => {
  const rows = [
    [uid(2), "Watch Ant-Man", 1],
    [uid(1), "Watch Ant-Man", 1],
    [uid(3), "Watch Ant-Man again", 8],
  ];
  assert.deepEqual(rankRefs(buildRefIndex(rows), searchPlan("ant man")).map((r) => r.uid), [uid(3), uid(1), uid(2)]);
});

test("alias expansion finds blocks that link the aliased page", () => {
  const rows = [[uid(1), "Call with [[Entities/Michael Khieu]] about pricing", 2]];
  const aliases = new Map([["Entities/Michael Khieu", ["Mike Khieu", "king_khieu"]]]);
  const index = buildRefIndex(rows, aliases);
  assert.equal(rankRefs(index, searchPlan("mike khieu"))[0].viaAlias, true);
  assert.equal(rankRefs(index, searchPlan("mike khieu"), { aliasExpand: false }).length, 0);
});

test("betterMatch off keeps typos out", () => {
  const index = buildRefIndex([[uid(1), "Watch Ant-Man and the Wasp", 2]]);
  assert.equal(rankRefs(index, searchPlan("wasp antman"), { recall: false }).length, 0);
  assert.equal(rankRefs(index, searchPlan("ant man wsap")).length, 1);
});

test("per-key cost stays small on a 6k-block pool", () => {
  const words = ["alpha", "beta", "gamma", "delta", "sample", "swab", "zone", "line", "pcr", "real", "time", "ant", "man", "report", "audit"];
  const rows = [];
  for (let i = 0; i < 6000; i++) {
    const n = 4 + (i % 30);
    const text = Array.from({ length: n }, (_, j) => words[(i * 7 + j * 3) % words.length]).join(" ");
    rows.push([uid(i), text, i % 9]);
  }
  const index = buildRefIndex(rows);
  const plan = searchPlan("ant man");
  rankRefs(index, plan);
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) rankRefs(index, searchPlan(["an", "ant", "ant m", "ant ma", "ant man"][i % 5]));
  const per = (performance.now() - t0) / 10;
  assert.ok(per < 25, `rank took ${per.toFixed(1)} ms per key`);
});

test("close matches (a query word missing) never reach the strip", () => {
  const index = buildRefIndex([[uid(1), "Real-time biosensor pilot (no matrix validation)", 1]]);
  assert.equal(rankRefs(index, searchPlan("real time pcr")).length, 0);
});

test("the sliced build equals the one-shot build", async () => {
  const rows = Array.from({ length: 500 }, (_, i) => [uid(i), `Block ${i} about ((${uid((i + 1) % 500)})) [[Page]]`, i % 4]);
  const aliases = new Map([["Page", ["Alias"]]]);
  let yields = 0;
  const sliced = await buildRefIndexSliced(rows, aliases, { sliceMs: 0.05, yieldTo: async () => { yields += 1; } });
  const whole = buildRefIndex(rows, aliases);
  assert.ok(yields > 0);
  assert.deepEqual(sliced.entries.map((e) => [e.uid, e.key.spaced, e.pureQuote, e.aliasKey?.spaced]),
    whole.entries.map((e) => [e.uid, e.key.spaced, e.pureQuote, e.aliasKey?.spaced]));
});

test("prefix-only word matches stay out of the strip; typo matches need one exact word", () => {
  const index = buildRefIndex([
    [uid(1), "For remaining antibiotics, management of the strains", 3],
    [uid(2), "Watch Agents of S.H.I.E.L.D. S3", 1],
  ]);
  assert.equal(rankRefs(index, searchPlan("ant man")).length, 0);
  assert.equal(rankRefs(index, searchPlan("sheild s3"))[0].uid, uid(2));
  assert.equal(rankRefs(index, searchPlan("sheild")).length, 0);
});

test("cached prefilter sets give the same ranking as a cold index", () => {
  const rows = [
    [uid(1), "Watch [[Ant-Man]]", 1], [uid(2), "Ant-Man and the Wasp", 4], [uid(3), "antibody plan", 2],
    [uid(4), "MCU: Marvel Cinematic Universe", 3], [uid(5), "real-time PCR screen", 5],
  ];
  const warm = buildRefIndex(rows);
  const typed = ["an", "ant", "ant ", "ant m", "ant ma", "ant man", "ant ma", "ant m", "ant", "mcu", "real", "real time pcr"];
  for (const q of typed) {
    const cold = buildRefIndex(rows);
    assert.deepEqual(rankRefs(warm, searchPlan(q)).map((r) => r.uid), rankRefs(cold, searchPlan(q)).map((r) => r.uid), q);
  }
});
