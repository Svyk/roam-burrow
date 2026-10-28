import assert from "node:assert/strict";
import test from "node:test";

import { aliasInsertion, buildAliasIndex, groupAliasHits, keywordTitles, matchAliases, parseAliasBlock, setAliasRefs } from "../src/aliases.js";
import { searchPlan } from "../src/search.js";

test("alias blocks are read case-insensitively, split on commas, links unwrapped", () => {
  assert.deepEqual(parseAliasBlock("Aliases:: king_khieu, Mike Khieu"), ["king_khieu", "Mike Khieu"]);
  assert.deepEqual(parseAliasBlock("aliases:: EMP"), ["EMP"]);
  assert.deepEqual(parseAliasBlock("Aliases:: [[Holy Ghost]], #HG, ,"), ["Holy Ghost", "HG"]);
  assert.deepEqual(parseAliasBlock("Alias:: nope"), []);
  assert.deepEqual(parseAliasBlock("AKA:: x, y", "aka"), ["x", "y"]);
  assert.deepEqual(keywordTitles("Aliases"), ["Aliases", "aliases", "ALIASES"]);
});

const rows = [
  ["Aliases:: king_khieu, Mike Khieu", "Entities/Michael Khieu", "u1"],
  ["aliases:: EMP", "Environmental Monitoring Program", "u2"],
  ["Aliases:: EMP", "Emergency Medical Plan", "u3"],
  ["Aliases:: Holy Ghost", "Concepts/Holy Spirit", "u4"],
];

test("an alias naming two pages yields two rows; Burrow never guesses", () => {
  const index = buildAliasIndex(rows);
  const hits = matchAliases(index, searchPlan("emp"));
  assert.deepEqual(hits.map((h) => h.title).sort(), ["Emergency Medical Plan", "Environmental Monitoring Program"]);
  assert.deepEqual(index.byPage.get("Entities/Michael Khieu"), ["king_khieu", "Mike Khieu"]);
});

test("alias matching uses the same forgiving scorer", () => {
  const index = buildAliasIndex(rows);
  assert.equal(matchAliases(index, searchPlan("mike"))[0].alias, "Mike Khieu");
  assert.equal(matchAliases(index, searchPlan("king khieu"))[0].alias, "king_khieu");
  assert.equal(matchAliases(index, searchPlan("holy gost"), { strict: true }).length, 0);
  assert.equal(matchAliases(index, searchPlan("holy gost"))[0].title, "Concepts/Holy Spirit");
});

test("alias commit text matches roam-aliases, or a plain page link", () => {
  const entry = { alias: "Mike Khieu", title: "Entities/Michael Khieu" };
  assert.equal(aliasInsertion(entry, "[alias]([[Page]])"), "[Mike Khieu]([[Entities/Michael Khieu]])");
  assert.equal(aliasInsertion(entry, "[[Page]]"), "[[Entities/Michael Khieu]]");
});

test("a one-word typo still finds its alias", () => {
  const index = buildAliasIndex([["Aliases:: Lori, lorinator", "Lori Boyd", "u9"]]);
  assert.equal(matchAliases(index, searchPlan("lorinatr"))[0].alias, "lorinator");
  assert.equal(matchAliases(index, searchPlan("lorinatr"), { strict: true }).length, 0);
});

test("Burrow predicts which aliases roam-aliases will list", async () => {
  const { roamAliasesWillList } = await import("../src/aliases.js");
  const index = buildAliasIndex([
    ["Aliases:: Mike Khieu", "Entities/Michael Khieu", "a"],
    ["aliases:: EMP", "Environmental Monitoring Program", "b"],
  ]);
  const [mike, emp] = index.entries;
  assert.equal(roamAliasesWillList(mike, "mike khi"), true);
  assert.equal(roamAliasesWillList(mike, "mke"), false);
  // roam-aliases misses the lowercase keyword, so Burrow keeps that row.
  assert.equal(roamAliasesWillList(emp, "emp"), false);
});

test("rows roam-aliases lists never push an unlisted alias out", async () => {
  const { roamAliasesWillList } = await import("../src/aliases.js");
  const rows = ["one", "two", "three", "four", "five", "six", "seven"].map((n) => [`Aliases:: maintenance`, `Page ${n}`, n]);
  rows.push(["Aliases:: maintenence", "Typo Page", "t"]);
  const index = buildAliasIndex(rows);
  const hits = matchAliases(index, searchPlan("maintenance"), { limit: Infinity });
  const unlisted = hits.filter((hit) => !roamAliasesWillList(hit, "maintenance"));
  assert.deepEqual(unlisted.map((hit) => hit.title), ["Typo Page"]);
});

test("pageAliases keeps the order written, drops exact duplicates and the title itself", () => {
  const index = buildAliasIndex([
    ["Aliases:: Lori, lori, Lori, Boyd", "Lori Boyd", "p1"],
    ["Aliases:: lori boyd, LB", "Lori Boyd", "p1"],
    ["Aliases:: EMP", "Environmental Monitoring Program", "p2"],
  ]);
  assert.deepEqual(index.pageAliases.get("p1"), ["Lori", "lori", "Boyd", "LB"]);
  assert.deepEqual(index.pageAliases.get("p2"), ["EMP"]);
  assert.deepEqual(index.byPage.get("Lori Boyd"), ["Lori", "lori", "Lori", "Boyd", "LB"]);
  assert.equal(index.entries[0].refs, null);
});

test("setAliasRefs fills every entry of a page", () => {
  const index = buildAliasIndex(rows);
  setAliasRefs(index, [["u1", 7], ["u2", 2]]);
  assert.deepEqual(index.entries.filter((e) => e.uid === "u1").map((e) => e.refs), [7, 7]);
  assert.equal(index.entries.find((e) => e.uid === "u2").refs, 2);
  assert.equal(index.entries.find((e) => e.uid === "u3").refs, null);
  assert.equal(index.refsByPage.get("u1"), 7);
});

test("groupAliasHits keeps one row per page, best alias first, in hit order", () => {
  const index = buildAliasIndex([
    ["Aliases:: Mike Khieu, king_khieu, Mikey", "Entities/Michael Khieu", "u1"],
    ["Aliases:: Mike", "Mike Other", "u2"],
  ]);
  setAliasRefs(index, [["u1", 4]]);
  const hits = matchAliases(index, searchPlan("mike"), { limit: Infinity });
  const grouped = groupAliasHits(hits, index);
  assert.equal(grouped.filter((r) => r.uid === "u1").length, 1);
  assert.deepEqual(grouped.map((r) => r.uid), [...new Set(hits.map((h) => h.uid))]);
  const khieu = grouped.find((r) => r.uid === "u1");
  assert.equal(khieu.alias, hits.find((h) => h.uid === "u1").alias);
  assert.deepEqual(khieu.aliases, ["Mike Khieu", "king_khieu", "Mikey"]);
  assert.equal(khieu.refs, 4);
  assert.equal(grouped.find((r) => r.uid === "u2").refs, null);
});

test("an ambiguous alias stays two rows, one per page", () => {
  const index = buildAliasIndex(rows);
  const grouped = groupAliasHits(matchAliases(index, searchPlan("emp"), { limit: Infinity }), index);
  assert.deepEqual(grouped.map((r) => r.uid).sort(), ["u2", "u3"]);
});

test("parseAliasBlock reads the first line only", () => {
  assert.deepEqual(parseAliasBlock("Aliases:: a, b\nnote"), ["a", "b"]);
});

test("buildAliasIndex with the last index's memo parses only changed blocks, same result", () => {
  const rows = [["Aliases:: lori, lorinator", "Lori Boyd", "LB"], ["Aliases:: mcu", "Marvel Cinematic Universe", "MCU"]];
  const first = buildAliasIndex(rows, "Aliases");
  const changed = [["Aliases:: lori, lorinator, lb", "Lori Boyd", "LB"], rows[1]];
  const memoized = buildAliasIndex(changed, "Aliases", first.memo);
  const plain = buildAliasIndex(changed, "Aliases");
  const strip = (index) => index.entries.map(({ alias, title, uid, key, seenByRoamAliases }) => ({ alias, title, uid, key: key.spaced, seenByRoamAliases }));
  assert.deepEqual(strip(memoized), strip(plain));
  assert.deepEqual([...memoized.byPage], [...plain.byPage]);
  // The unchanged block's aliases keep their keys; the old block string is dropped from the memo.
  assert.equal(memoized.entries.find((e) => e.alias === "mcu").key, first.entries.find((e) => e.alias === "mcu").key);
  assert.equal(memoized.entries.find((e) => e.alias === "lori").key, first.entries.find((e) => e.alias === "lori").key);
  assert.equal(memoized.memo.parsed.has("Aliases:: lori, lorinator"), false);
  assert.equal(memoized.memo.parsed.size, 2);
});

test("alias rows: a frequently picked page ranks first among equal scores, never over a better score", () => {
  const index = buildAliasIndex([["Aliases:: Zed", "Alpha", "pa"], ["Aliases:: Zed", "Beta", "pb"], ["Aliases:: Zedd", "Gamma", "pg"]], "Aliases");
  const plain = matchAliases(index, searchPlan("zed"), { limit: 5 });
  assert.deepEqual(plain.map((h) => h.uid).slice(0, 2), ["pa", "pb"]);
  const ranked = matchAliases(index, searchPlan("zed"), { limit: 5, picked: new Map([["pb", 3]]) });
  assert.deepEqual(ranked.map((h) => h.uid).slice(0, 2), ["pb", "pa"]);
  const lifted = matchAliases(index, searchPlan("zed"), { limit: 5, picked: new Map([["pg", 99]]) });
  assert.equal(lifted.at(-1).uid, "pg", "a worse match stays below equal-or-better ones");
});
