import assert from "node:assert/strict";
import test from "node:test";

import { buildAliasIndex } from "../src/aliases.js";
import { bestMatch, parseDrill, parseSteps, resolveDrill } from "../src/drill.js";
import { createTreeSource } from "../src/pagetree.js";
import { previewModel } from "../src/preview.js";
import { buildTitleIndex } from "../src/titles.js";

const TITLES = [
  ["Systems/Executor Lanes and LaunchAgents", "OO4YiEAEv"],
  ["Concepts/Executor Lanes", "cEL"],
  ["C", "pc"],
  ["C#", "pcsharp"],
  ["C# Notes", "pcnotes"],
  ["a > b", "pab"],
  ["a", "pa"],
  ["Ant-Man", "pant"],
  ["MCU", "pmcu1"],
  ["mcu", "pmcu2"],
];
const aliases = buildAliasIndex([["Aliases:: lanes doc, Shared", "Systems/Executor Lanes and LaunchAgents", "OO4YiEAEv"],
  ["Aliases:: Shared", "Ant-Man", "pant"]], "Aliases");
const titles = buildTitleIndex(TITLES, aliases);

test("parseSteps splits # heading and > steps; # inside a > step is text", () => {
  assert.deepEqual(parseSteps("#grok lane > never"), { heading: "grok lane", steps: ["never"] });
  assert.deepEqual(parseSteps("#"), { heading: "", steps: [] });
  assert.deepEqual(parseSteps("> a > b#c >"), { heading: null, steps: ["a", "b#c", ""] });
  assert.equal(parseSteps("plain"), null);
});

test("title index resolves exact, case-, separator-insensitive and alias spellings", () => {
  assert.equal(titles.resolve("Systems/Executor Lanes and LaunchAgents").uid, "OO4YiEAEv");
  assert.equal(titles.resolve("systems/executor lanes and launchagents").uid, "OO4YiEAEv");
  assert.equal(titles.resolve("systems executor lanes and launchagents").uid, "OO4YiEAEv");
  assert.equal(titles.resolve("ant man").uid, "pant");
  assert.equal(titles.resolve("Lanes Doc").uid, "OO4YiEAEv");
  assert.equal(titles.resolve("Executor Lanes"), null, "not an exact title");
  assert.equal(titles.resolve("Shared"), null, "alias of two pages guesses none");
  assert.equal(titles.resolve("MCU").uid, "pmcu1", "exact case wins over a case-insensitive tie");
  assert.equal(titles.resolve("Mcu"), null, "ambiguous without exact case");
  assert.equal(titles.hasPrefix("c# n"), true);
  assert.equal(titles.hasPrefix("c# x"), false);
});

test("parseDrill: drill only after an exact title, titles with # or > stay native", () => {
  const d = parseDrill("Systems/Executor Lanes and LaunchAgents#grok lane > never", titles);
  assert.equal(d.page.uid, "OO4YiEAEv");
  assert.equal(d.heading, "grok lane");
  assert.deepEqual(d.steps, ["never"]);
  assert.equal(parseDrill("Executor Lanes#grok lane", titles), null, "spec §5 counter-example");
  assert.equal(parseDrill("Systems/Executor Lanes and LaunchAgents", titles), null, "no separator");
  // `C#` and `C# Notes` are real titles: typing them is typing a title.
  assert.equal(parseDrill("C#", titles), null);
  assert.equal(parseDrill("C# No", titles), null);
  // Past every title that starts with the text, the longest title wins.
  const csharp = parseDrill("C# Notes > first", titles);
  assert.equal(csharp.page.uid, "pcnotes");
  assert.deepEqual(csharp.steps, ["first"]);
  const ab = parseDrill("a > b > c", titles);
  assert.equal(ab.page.uid, "pab", "the page named `a > b`, not page `a`");
  assert.deepEqual(ab.steps, ["c"]);
  assert.equal(parseDrill("C#x", titles).page.uid, "pc", "C then heading x: no title starts with c#x");
  assert.equal(parseDrill("lanes doc > x", titles).page.uid, "OO4YiEAEv", "alias starts a drill");
  assert.equal(parseDrill("#x", titles), null, "empty title");
});

test("an empty page Roam made from an Escaped drill neither blocks drill nor becomes its target", () => {
  const rows = [["Burrow/Fixtures", "fx"], ["Burrow/Fixtures#alpha > ", "junk"], ["C#", "cs"], ["C", "c"]];
  const index = buildTitleIndex(rows, null, new Set(["C#"]));
  const d = parseDrill("Burrow/Fixtures#alpha > ", index);
  assert.equal(d.page.uid, "fx");
  assert.equal(d.heading, "alpha");
  assert.equal(index.resolve("Burrow/Fixtures#alpha >"), null);
  assert.equal(parseDrill("C#", index), null, "C# has content, so it stays native");
});

// A small fake graph for the resolver and the tree cache.
function fakeGraph() {
  const page = { uid: "P", title: "Page", children: [
    { uid: "intro", string: "Intro text" },
    { uid: "h1", string: "Grok lane (since [[October 17th, 2026]])", heading: 2, children: [
      { uid: "c1", string: "What: Grok 4.7" },
      { uid: "c2", string: "Never Grok for: document writing", children: [{ uid: "g1", string: "grandchild one", children: [{ uid: "gg", string: "deep" }] }] },
      { uid: "c3", string: "Harness: use Herdr" },
    ] },
    { uid: "sec", string: "Other", children: [{ uid: "h2", string: "Grok notes lane", heading: 3 }, { uid: "h3", string: "Same", heading: 2 }] },
    { uid: "h4", string: "Same", heading: 2 },
  ] };
  const byUid = new Map();
  const parent = new Map();
  const walk = (n, order, up) => {
    n.order = order;
    byUid.set(n.uid, n);
    if (up) parent.set(n.uid, up);
    (n.children || []).forEach((c, i) => walk(c, i, n));
  };
  walk(page, 0, null);
  const raw = (n, depth) => {
    const out = { ":block/uid": n.uid, ":block/order": n.order };
    if (n.title) out[":node/title"] = n.title;
    if (n.string != null) out[":block/string"] = n.string;
    if (n.heading) out[":block/heading"] = n.heading;
    if (n.children?.length) out[":block/children"] = [...n.children].reverse().map((c) => (depth > 0 ? raw(c, depth - 1) : { ":block/uid": c.uid }));
    return out;
  };
  const up = (n) => {
    const out = raw(n, -1);
    delete out[":block/children"];
    const p = parent.get(n.uid);
    if (p) out[":block/_children"] = [up(p)];
    return out;
  };
  const calls = { pull: 0, query: 0 };
  // Refs come as [":block/uid", uid] or, for the heading pulls, as the bare
  // id the heading query returned (here the uid itself).
  const pull = (pattern, ref) => {
    calls.pull += 1;
    const n = byUid.get(Array.isArray(ref) ? ref[1] : ref);
    if (!n) return null;
    if (pattern === "[:db/id]") return { ":db/id": n.uid };
    return pattern.includes("_children") ? up(n) : raw(n, pattern.includes(":block/children") ? 2 : -1);
  };
  const q = (_query, pageId) => {
    calls.query += 1;
    // Every block of the page with a heading datom, unordered, as datalog
    // returns it; 0 means "not a heading" (svy has 17k of those).
    return [...byUid.values()].filter((n) => pageId === "P" && n.uid !== "P").reverse().map((n) => [n.uid, n.heading || 0]);
  };
  return { pull, q, calls, page };
}

test("resolveDrill walks # heading then > children; ties go to outline order", () => {
  const g = fakeGraph();
  const tree = createTreeSource({ pull: g.pull, q: g.q });
  const page = { uid: "P", title: "Page" };
  const run = (heading, steps) => resolveDrill({ page, heading, steps }, tree);
  assert.equal(run("grok lane", ["never"]).target.uid, "c2");
  assert.equal(run("grok lane", ["never"]).insertion, "((c2))");
  assert.equal(run("grok lane", []).target.uid, "h1", "a phrase beats scattered words (`Grok notes lane`)");
  assert.equal(run("", []).target.uid, "h1", "empty # is the first heading in outline order");
  assert.equal(run("same", []).target.uid, "h3", "tie: h3 (under Other) comes before h4");
  assert.equal(run("grok lane", [""]).target.uid, "c1", "empty > is the first child");
  assert.equal(run(null, ["other", ""]).target.uid, "h2", "> from the page top level");
  const miss = run("zzzz", ["never"]);
  assert.equal(miss.target, null);
  assert.equal(miss.failedAt, 0);
  assert.equal(miss.insertion, "[[Page]]", "nothing below the page resolved: a page link, never a new page");
  const partial = run("grok lane", ["zzzz"]);
  assert.equal(partial.target.uid, "h1", "the deepest resolved node is kept");
  assert.equal(partial.failedAt, 1);
});

test("tree source pulls each node once and only what the drill visits", () => {
  const g = fakeGraph();
  const tree = createTreeSource({ pull: g.pull, q: g.q });
  assert.deepEqual(tree.children("h1").map((n) => n.uid), ["c1", "c2", "c3"], "children come in :block/order");
  const pulls = g.calls.pull;
  tree.children("h1");
  tree.children("c2");
  assert.equal(g.calls.pull, pulls, "children and grandchildren arrive with one pull");
  assert.deepEqual(tree.children("c3"), [], "a leaf grandchild needs no pull");
  assert.equal(g.calls.pull, pulls);
  tree.headings("P");
  tree.headings("P");
  assert.equal(g.calls.query, 1);
  assert.deepEqual(tree.trail("c2").map((n) => n.uid), ["P", "h1"]);
  tree.trail("c2");
  tree.clear();
  assert.equal(tree.size, 0);
});

test("bestMatch: separator-insensitive, strict mode skips typos", () => {
  const nodes = [{ uid: "a", string: "Real-time PCR screen" }, { uid: "b", string: "Never Grok for writing" }];
  assert.equal(bestMatch(nodes, "real time pcr").uid, "a");
  assert.equal(bestMatch(nodes, "nevr grok").uid, "b");
  assert.equal(bestMatch(nodes, "nevr grok", { strict: true }), null);
  assert.equal(bestMatch([], "x"), null);
});

test("preview model: trail, siblings, highlighted target and two levels of children", () => {
  const g = fakeGraph();
  const tree = createTreeSource({ pull: g.pull, q: g.q });
  const page = { uid: "P", title: "Page" };
  const result = resolveDrill({ page, heading: "grok lane", steps: ["never"] }, tree);
  const model = previewModel(result, tree, (s) => s.replace(/\[\[|\]\]/g, ""));
  assert.deepEqual(model.trail, ["Page", "Grok lane (since October 17th, 2026)"]);
  assert.deepEqual(model.items.map((i) => [i.uid, i.depth, i.target]), [
    ["c1", 0, false], ["c2", 0, true], ["g1", 1, false], ["gg", 2, false], ["c3", 0, false],
  ]);
  const top = previewModel(resolveDrill({ page, heading: "zzzz", steps: [] }, tree), tree, (s) => s);
  assert.equal(top.key, "page:P");
  assert.deepEqual(top.trail, ["Page"]);
  assert.equal(top.items.some((i) => i.target), false, "an unresolved drill highlights nothing");
});

test("bestMatch: ordinal steps pick the numbered block first", () => {
  const kids = () => [
    { uid: "n", string: "intro mentions 2 things" },
    { uid: "a", string: "1. mix" },
    { uid: "b", string: "2. bake" },
    { uid: "p", string: "(b) cool" },
    { uid: "r", string: "iii. serve" },
  ];
  assert.equal(bestMatch(kids(), "2", { ordinals: true }).uid, "b");
  assert.equal(bestMatch(kids(), "(b)", { ordinals: true }).uid, "p");
  assert.equal(bestMatch(kids(), "iii", { ordinals: true }).uid, "r");
  const second = bestMatch([{ uid: "x", string: "2. a" }, { uid: "y", string: "2. b" }], "2", { ordinals: true, first: (list) => list[1] });
  assert.equal(second.uid, "y");
});

test("resolveDrill passes ordinals and hideEmpty to every step", () => {
  const tree = { P: [{ uid: "s", string: "Steps", kids: [{}] }], s: [{ uid: "e", string: "" }, { uid: "i", string: "intro 2" }, { uid: "t", string: "2. bake" }] };
  const source = { headings: (uid) => tree[uid], children: (uid) => tree[uid] || [] };
  const parsed = { page: { uid: "P", title: "P" }, heading: "Steps", steps: ["2"] };
  assert.equal(resolveDrill(parsed, source, { ordinals: true }).target.uid, "t");
});

test("bestMatch: hideEmpty skips empty leaves and blank queries prefer real text", () => {
  const list = [{ uid: "e", string: "" }, { uid: "ek", string: " ", kids: [{}] }, { uid: "t", string: "text" }];
  assert.equal(bestMatch(list, "", { hideEmpty: true }).uid, "t");
  assert.equal(bestMatch(list, "", {}).uid, "e");
  assert.equal(bestMatch([{ uid: "e", string: "" }, { uid: "ek", string: "", kids: [{}] }], "", { hideEmpty: true }).uid, "ek");
  assert.equal(bestMatch([{ uid: "e", string: "" }], "", { hideEmpty: true }), null);
  const parsed = { page: { uid: "P", title: "P" }, heading: null, steps: [""] };
  const tree = { P: [{ uid: "e", string: "" }, { uid: "t", string: "real" }] };
  const source = { headings: () => [], children: (uid) => tree[uid] || [] };
  assert.equal(resolveDrill(parsed, source, { hideEmpty: true }).target.uid, "t");
});
