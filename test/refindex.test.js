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
  // Process CPU time, not wall time: another process on a loaded machine or
  // CI runner stretches wall time 4x but this process's CPU time barely moves.
  // The median of 9 rounds drops the rounds that pay for JIT and GC threads.
  const rounds = [];
  for (let r = 0; r < 9; r++) {
    const c0 = process.cpuUsage();
    for (let i = 0; i < 10; i++) rankRefs(index, searchPlan(["an", "ant", "ant m", "ant ma", "ant man"][i % 5]));
    const { user, system } = process.cpuUsage(c0);
    rounds.push((user + system) / 1000 / 10);
  }
  const per = rounds.sort((a, b) => a - b)[4];
  assert.ok(per < 25, `rank took ${per.toFixed(1)} ms CPU per key (median of 9 rounds: ${rounds.map((x) => x.toFixed(1)).join(", ")})`);
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

const RCODE = "```r\n# Load required libraries\nlibrary(ggplot2)\nlibrary(dplyr)\n" +
  "p <- ggplot(df, aes(x = Date, y = Count)) +\n  theme(axis.text = element_text(size = 10, color = \"black\"),\n" +
  "        panel.grid = element_blank())\nzebra_plot <- function(d) d\n" + "x <- 1\n".repeat(80) + "```";
const WATCH = "{{[[TODO]]}} Watch [[Black Panther]]";
const uids = (ranked) => ranked.map((r) => r.uid);

test("svy 0.7: code blocks do not match a prose query, the Black Panther task does", () => {
  const rows = [["xkeryyXeP", RCODE, 1], ["dLpZ2t-lA", RCODE, 1], ["cs1PFq5go", WATCH, 1]];
  assert.deepEqual(uids(rankRefs(buildRefIndex(rows), searchPlan("black pan"))), ["cs1PFq5go"]);
});

test("svy 0.7: only code blocks in the pool give nothing, prose off gives the 0.6.1 hits", () => {
  const index = buildRefIndex([["xkeryyXeP", RCODE, 1], ["dLpZ2t-lA", RCODE, 1]]);
  assert.deepEqual(rankRefs(index, searchPlan("black pan")), []);
  assert.deepEqual(uids(rankRefs(index, searchPlan("black pan"), { prose: false })).sort(), ["dLpZ2t-lA", "xkeryyXeP"]);
});

test("prose off lets a many-ref code block win; default hides it", () => {
  const index = buildRefIndex([["xkeryyXeP", RCODE, 9], ["cs1PFq5go", WATCH, 1]]);
  assert.equal(rankRefs(index, searchPlan("black pan"), { prose: false })[0].uid, "xkeryyXeP");
  assert.deepEqual(uids(rankRefs(index, searchPlan("black pan"))), ["cs1PFq5go"]);
});

test("a code-looking query finds code blocks and marks them inCode", () => {
  const index = buildRefIndex([["xkeryyXeP", RCODE, 1], ["dLpZ2t-lA", RCODE, 1]]);
  const found = rankRefs(index, searchPlan("zebra_plot"), { code: true });
  assert.deepEqual(uids(found).sort(), ["dLpZ2t-lA", "xkeryyXeP"]);
  assert.ok(found.every((r) => r.inCode === true));
  assert.deepEqual(rankRefs(index, searchPlan("zebra_plot"), { code: false }), []);
});

test("a long block ranks after a short one for the same words, unless prose is off", () => {
  const index = buildRefIndex([["long0001x", "We talked about black panther " + "and more words ".repeat(40), 7], ["cs1PFq5go", WATCH, 1]]);
  const ranked = rankRefs(index, searchPlan("black pan"));
  assert.deepEqual(uids(ranked), ["cs1PFq5go", "long0001x"]);
  assert.equal(ranked[1].long, true);
  assert.equal(rankRefs(index, searchPlan("black pan"), { prose: false })[0].uid, "long0001x");
});

test("a match in a linked page title comes first among equals", () => {
  const index = buildRefIndex([["shed00001", "black panels for the shed", 1], ["cs1PFq5go", WATCH, 1]]);
  const ranked = rankRefs(index, searchPlan("black pan"));
  assert.deepEqual(uids(ranked), ["cs1PFq5go", "shed00001"]);
  assert.ok(ranked[1].score > ranked[0].score);
  assert.equal(rankRefs(index, searchPlan("black pan"), { prose: false })[0].uid, "shed00001");
});

test("a contiguous phrase beats scattered words whatever the refs", () => {
  const index = buildRefIndex([["scatter01", "panther in the black forest", 30], ["phrase001", "black panther notes", 1]]);
  const ranked = rankRefs(index, searchPlan("black panther"));
  assert.deepEqual(uids(ranked), ["phrase001", "scatter01"]);
  assert.equal(ranked[1].level, 1);
});

test("closer scattered words rank first", () => {
  const index = buildRefIndex([["far000001", "ant " + "x ".repeat(10) + "man", 1], ["near00001", "ant big man", 1]]);
  assert.equal(rankRefs(index, searchPlan("ant man"))[0].uid, "near00001");
});

test("a # or [[ inside code is not a linked page", () => {
  const index = buildRefIndex([["c00000001", "```js\nconst a = '#tag [[Page]]'\n```", 1]]);
  assert.equal(index.entries[0].linked, null);
});
