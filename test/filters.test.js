import assert from "node:assert/strict";
import test from "node:test";

import { hasRun, pageFilter, pageScope, parseFilters, refFilter, taskState } from "../src/filters.js";
import { buildRefIndex, rankRefs } from "../src/refindex.js";
import { searchKey, searchPlan } from "../src/search.js";

test("a query without filter syntax parses to null", () => {
  for (const q of ["black panther", "ant-man", "real time pcr", "a - b", "temp -20", "this: that", "Attr::"]) {
    assert.equal(parseFilters(q), null, q);
  }
});

test("a bare word is never a filter", () => {
  const f = parseFilters("in here is todo -");
  assert.equal(f, null);
  const g = parseFilters("pcr in PIF is:todo");
  assert.equal(g.text, "pcr in PIF");
  assert.deepEqual(g.is, ["todo"]);
});

test("in: runs to the next filter or the end; the words before it are the search", () => {
  const f = parseFilters("pcr in:PhD/Cronobacter & Spore Control in PIF");
  assert.equal(f.text, "pcr");
  assert.deepEqual(f.pages, ["PhD/Cronobacter & Spore Control in PIF"]);
  assert.deepEqual(f.labels, ["in:PhD/Cronobacter & Spore Control in PIF"]);
  const g = parseFilters("watch in:MCU Watch Order is:todo -done");
  assert.deepEqual(g.pages, ["MCU Watch Order"]);
  assert.deepEqual(g.is, ["todo"]);
  assert.equal(g.excludes[0].spaced, "done");
  assert.equal(g.text, "watch");
  assert.deepEqual(parseFilters("x in:\"Two Words\" more").pages, ["Two Words"]);
  assert.equal(parseFilters("x in:\"Two Words\" more").text, "x more");
});

test("in:here, ns: and is: prefixes", () => {
  const f = parseFilters("lane in:here ns:Systems/ is:t");
  assert.equal(f.here, true);
  assert.deepEqual(f.pages, []);
  assert.deepEqual(f.ns, ["Systems"]);
  assert.deepEqual(f.is, ["todo"]);
  assert.deepEqual(parseFilters("x is:d").is, ["done"]);
  assert.deepEqual(parseFilters("x is:task").is, [null]);
});

test("a filter typed without its value is taken out of the text but filters nothing", () => {
  const f = parseFilters("pcr in:");
  assert.equal(f.text, "pcr");
  assert.equal(f.labels.length, 0);
  assert.equal(refFilter(f)({ page: "Any", string: "pcr", key: searchKey("pcr") }), true);
  assert.equal(parseFilters("pcr \"").text, "pcr");
});

test("phrases join the plan text; excluded words do not", () => {
  const f = parseFilters("\"black panther\" -wakanda");
  assert.equal(f.text, "");
  assert.equal(f.planText, "black panther");
  assert.equal(f.phrases[0].open, false);
  assert.deepEqual(f.labels, ["\"black panther\"", "-wakanda"]);
  const open = parseFilters("watch \"black pan");
  assert.equal(open.phrases[0].open, true);
  assert.equal(open.planText, "watch black pan");
  assert.deepEqual(parseFilters("x -\"two words\"").excludes.map((k) => k.spaced), ["two words"]);
});

test("hasRun: whole words in order, the last a prefix only while open", () => {
  const key = searchKey("Watch [[Black Panther]] tonight");
  assert.equal(hasRun(key, searchKey("black panther")), true);
  assert.equal(hasRun(key, searchKey("panther black")), false);
  assert.equal(hasRun(key, searchKey("black pan")), false);
  assert.equal(hasRun(key, searchKey("black pan"), true), true);
  assert.equal(hasRun(key, searchKey("lack panther")), false);
  assert.equal(hasRun(searchKey("black cat, panther"), searchKey("black panther")), false);
});

test("taskState reads the first task macro", () => {
  assert.equal(taskState("{{[[TODO]]}} Watch [[Black Panther]]"), "todo");
  assert.equal(taskState("{{[[DONE]]}} Watch it"), "done");
  assert.equal(taskState("{{[[DONE]]:((abcdefghi))}} Better Tasks"), "done");
  assert.equal(taskState("{{TODO today:SmartBlock:TODO today}}"), null);
  assert.equal(taskState("plain"), null);
});

test("pageScope: in:here, in: by title or alias, ns: by prefix; they add up", () => {
  const resolve = (v) => (v.toLowerCase() === "mcu" ? { title: "MCU Watch Order" } : null);
  const scope = pageScope(parseFilters("x in:here in:mcu ns:Systems/"), { currentPage: "October 27th, 2026", resolve });
  assert.equal(scope("October 27th, 2026"), true);
  assert.equal(scope("MCU Watch Order"), true);
  assert.equal(scope("Systems/Executor Lanes"), true);
  assert.equal(scope("Systems"), true);
  assert.equal(scope("SystemsX/Other"), false);
  assert.equal(scope("Elsewhere"), false);
  assert.equal(pageScope(parseFilters("x is:todo")), null);
  // in:here with no page known matches nothing.
  assert.equal(pageScope(parseFilters("x in:here"))("Anything"), false);
});

const ROWS = [
  ["todo00001", "{{[[TODO]]}} Watch [[Black Panther]]", 1, "MCU Watch Order"],
  ["done00001", "{{[[DONE]]}} Watch [[Black Panther: Wakanda Forever]]", 2, "MCU Watch Order"],
  ["prose0001", "The black cat and the panther", 3, "Zoo"],
  ["pcr000001", "3. Real-time PCR screen", 5, "PhD/Cronobacter & Spore Control in PIF"],
  ["pcr000002", "PCR is fast", 4, "Lab/Methods"],
  ["quote0001", "((pcr000001))", 0, "Elsewhere"],
];

const ranked = (query, opts = {}) => {
  const index = buildRefIndex(ROWS);
  const filters = parseFilters(query);
  const plan = searchPlan(filters ? filters.planText : query);
  return rankRefs(index, plan, { limit: 10, accept: refFilter(filters, opts) }).map((r) => r.uid);
};

test("rankRefs with filters: is:todo, is:done, in:, phrase against scattered words", () => {
  assert.deepEqual(ranked("watch is:todo"), ["todo00001"]);
  assert.deepEqual(ranked("watch is:done"), ["done00001"]);
  assert.deepEqual(ranked("pcr in:PhD/Cronobacter & Spore Control in PIF"), ["pcr000001"]);
  assert.deepEqual(ranked("pcr in:nowhere"), []);
  assert.deepEqual(ranked("pcr ns:Lab"), ["pcr000002"]);
  const plain = ranked("black panther");
  assert.ok(plain.includes("prose0001"));
  const phrase = ranked("\"black panther\"");
  assert.ok(!phrase.includes("prose0001"));
  assert.ok(phrase.includes("todo00001") && phrase.includes("done00001"));
  assert.deepEqual(ranked("\"black panther\" -wakanda"), ["todo00001"]);
  assert.deepEqual(ranked("pcr in:here", { currentPage: "Lab/Methods" }), ["pcr000002"]);
});

test("a quoter folds into its original before the filter is checked", () => {
  // The quoter sits on Elsewhere; the row shown is the original on the PhD page.
  assert.deepEqual(ranked("pcr screen in:Elsewhere"), []);
  assert.deepEqual(ranked("pcr screen in:PhD/Cronobacter & Spore Control in PIF"), ["pcr000001"]);
});

test("pageFilter: phrases and excluded words on alias or title, ns: on the title, is: leaves nothing", () => {
  const entry = { alias: "BP", title: "Black Panther", key: searchKey("BP") };
  assert.equal(pageFilter(parseFilters("bp \"black panther\""))(entry), true);
  assert.equal(pageFilter(parseFilters("bp -panther"))(entry), false);
  assert.equal(pageFilter(parseFilters("bp ns:Movies/"))(entry), false);
  assert.equal(pageFilter(parseFilters("bp ns:\"Black Panther\""))(entry), true);
  assert.equal(pageFilter(parseFilters("bp is:todo"))(entry), false);
  assert.equal(pageFilter(null), null);
});

test("in:here and ns: are one word, so search words may follow them", () => {
  const f = parseFilters("in:here watch -closed is:todo");
  assert.equal(f.here, true);
  assert.deepEqual(f.pages, []);
  assert.equal(f.text, "watch");
  assert.deepEqual(parseFilters("in:here pcr").text, "pcr");
  const g = parseFilters("ns:Systems/ grok");
  assert.deepEqual(g.ns, ["Systems"]);
  assert.equal(g.text, "grok");
  assert.deepEqual(parseFilters("x ns:\"Media Captures/\" y").ns, ["Media Captures"]);
  assert.deepEqual(parseFilters("x in:\"Here Comes the Sun\"").pages, ["Here Comes the Sun"]);
});

test("a colon followed by a space is prose, not a filter", () => {
  assert.equal(parseFilters("what it is: foo"), null);
  assert.equal(parseFilters("look in: the box"), null);
});
