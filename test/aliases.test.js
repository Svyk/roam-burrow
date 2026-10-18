import assert from "node:assert/strict";
import test from "node:test";

import { aliasInsertion, buildAliasIndex, keywordTitles, matchAliases, parseAliasBlock } from "../src/aliases.js";
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
