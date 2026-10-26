import assert from "node:assert/strict";
import test from "node:test";

import { isPrecise, looksLikeCode, matchFromKey, searchKey, searchPlan, searchScore, stripRoamMarkup } from "../src/search.js";

// Cases copied from thymer-reference-extravaganza test/plugin.test.cjs and
// test/v453-recall.test.cjs, plus the Roam acceptance shapes.
test("identifier search ignores punctuation, spaces, and letter-number boundaries", () => {
  assert.ok(searchScore("EMP26-002-BHP", "EMP 26") > 0);
  assert.ok(searchScore("QUAL-4507.11-WI", "QUAL 4507 11") > 0);
  assert.ok(searchScore("EMP26-002-BHP", "EMP BHP") > 0);
  assert.ok(searchScore("EMP26-002-BHP corrective action", "EMP 26+BHP") > 0);
  assert.equal(searchScore("EMP26-002-BHP", "EMP 27"), -1);
});

test("compact identifier match outranks loose token matches", () => {
  assert.ok(searchScore("EMP26-002-BHP", "EMP 26") > searchScore("Notes about EMP work in week 26", "EMP 26"));
});

test("season 3 agents matches a Shield S3 line through the recall tier", () => {
  const key = searchKey("33. Watch Agents of S.H.I.E.L.D. S3");
  const match = matchFromKey(key, searchPlan("season 3 agents"));
  assert.ok(match.score >= 0);
  assert.equal(match.tier, "strict");
  assert.equal(matchFromKey(key, searchPlan("season 3 agents"), { strict: true }).score, -1);
});

test("typo plus abbreviation, initialisms, and the close tier", () => {
  assert.ok(searchScore("33. Watch Agents of S.H.I.E.L.D. S3", "sheild s3") >= 0);
  assert.ok(searchScore("Marvel Cinematic Universe watch order", "mcu") >= 0);
  const match = matchFromKey(searchKey("Alpha Beta Gamma protocol"), searchPlan("alpha beta bogus"));
  assert.ok(match.score >= 0);
  assert.equal(match.tier, "close");
});

test("numbers never fuzz", () => {
  assert.equal(searchScore("Budget 2026 plan", "2027"), -1);
});

test("ant man finds Ant-Man inside Roam markup, separator-insensitive", () => {
  const key = searchKey(stripRoamMarkup("{{[[TODO]]}} Watch [[Ant-Man]]"));
  assert.equal(key.spaced, "watch ant man");
  const match = matchFromKey(key, searchPlan("ant man"));
  assert.ok(match.score >= 0);
  assert.equal(match.level, 2);
  assert.ok(searchScore("3. Real-time PCR screen", "real time pcr") > 0);
  assert.ok(searchScore("Ant-Man", "antman") > 0);
});

test("substring hits must start on a word boundary", () => {
  assert.equal(matchFromKey(searchKey("an important manual"), searchPlan("ant man"), { strict: true }).score, -1);
  assert.equal(matchFromKey(searchKey("importantmanual"), searchPlan("antman"), { strict: true }).score, -1);
  assert.ok(matchFromKey(searchKey("the ant-man file"), searchPlan("antman"), { strict: true }).score >= 0);
});

test("match levels separate exact, substring, and token-wise matches", () => {
  assert.equal(matchFromKey(searchKey("Ant-Man"), searchPlan("ant man")).level, 3);
  assert.equal(matchFromKey(searchKey("Watch Ant-Man"), searchPlan("ant man")).level, 2);
  assert.equal(matchFromKey(searchKey("Man of the ant hill"), searchPlan("ant man")).level, 1);
});

test("Roam markup is stripped to visible words", () => {
  assert.equal(stripRoamMarkup("Aliases:: EMP").trim(), "Aliases EMP");
  assert.match(stripRoamMarkup("[Mike]([[Entities/Michael Khieu]]) **bold** ^^hi^^ #tag"), /Mike Entities\/Michael Khieu\s+bold\s+hi\s+tag/);
});

test("the strict prefilter never drops a match the strip would admit", async () => {
  const { isPrecise, strictPrefilter } = await import("../src/search.js");
  const texts = ["Watch [[Ant-Man]]", "Ant-Man", "Man of the ant hill", "EMP26-002-BHP", "QUAL-4507.11-WI",
    "Marvel Cinematic Universe watch order", "3. Real-time PCR screen", "antibiotics management", "the ant-man file"];
  const queries = ["ant man", "antman", "man ant", "emp 26", "emp 26+bhp", "qual 4507 11", "mcu", "real time pcr", "rtp", "ant"];
  for (const q of queries) {
    const plan = searchPlan(q);
    const maybe = strictPrefilter(plan);
    for (const t of texts) {
      const key = searchKey(stripRoamMarkup(t));
      if (isPrecise(matchFromKey(key, plan, { strict: true }))) assert.ok(maybe(key), `${q} -> ${t}`);
    }
  }
});

test("edit distance with transpositions and the early exit", async () => {
  const { editDistance } = await import("../src/search.js");
  assert.equal(editDistance("shield", "sheild", 2), 1);
  assert.equal(editDistance("ghost", "gost", 1), 1);
  assert.equal(editDistance("kitten", "sitting", 3), 3);
  assert.equal(editDistance("kitten", "sitting", 2), 3);
  assert.equal(editDistance("a".repeat(80), "a".repeat(79) + "b", 1), 1);
  assert.equal(editDistance("abc", "abc", 0), 0);
});

test("looksLikeCode: plain words are prose, code punctuation is code", () => {
  for (const q of ["black pan", "real time pcr", "ant man", "Black Panther: Wakanda", "EMP 26"]) assert.equal(looksLikeCode(q), false, q);
  for (const q of ["panel.grid", "library(gg", "zebra_plot", "x <- 1", "fooBar"]) assert.equal(looksLikeCode(q), true, q);
});

test("any-order words score higher the closer together they sit", () => {
  const plan = searchPlan("ant man");
  const near = matchFromKey(searchKey("man and the ant"), plan);
  const far = matchFromKey(searchKey("man of the sea and the land and an ant"), plan);
  assert.equal(near.level, 1);
  assert.equal(far.level, 1);
  assert.ok(searchScore("man and the ant", "ant man") > searchScore("man of the sea and the land and an ant", "ant man"));
});

test("every-word-a-prefix stays level 0 and not precise", () => {
  const match = matchFromKey(searchKey("antibiotics management"), searchPlan("ant man"));
  assert.equal(match.level, 0);
  assert.equal(isPrecise(match), false);
});

test("stripRoamMarkup removes nested macros whole", () => {
  const out = stripRoamMarkup("{{embed: {{[[TODO]]}} x}} y");
  assert.ok(!out.includes("{{") && !out.includes("}}") && !out.includes("embed"), out);
});
