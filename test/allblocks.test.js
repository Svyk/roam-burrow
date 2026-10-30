import assert from "node:assert/strict";
import test from "node:test";

import { CACHE_LIMIT, CACHE_TTL_MS, SEARCH_LIMIT, WIDE_DEBOUNCE_MS, createAllBlocks, mergeRows, sourceFor, wantsAllBlocks } from "../src/allblocks.js";
import { parseFilters } from "../src/filters.js";

const src = (query, opts = {}) => sourceFor(parseFilters(query), opts);

test("wantsAllBlocks: is:, in:here, in:Page and ns: only", () => {
  assert.equal(wantsAllBlocks(null), false);
  assert.equal(wantsAllBlocks(parseFilters("watch is:todo")), true);
  assert.equal(wantsAllBlocks(parseFilters("watch in:here")), true);
  assert.equal(wantsAllBlocks(parseFilters("watch in:MCU")), true);
  assert.equal(wantsAllBlocks(parseFilters("watch ns:Systems/")), true);
  assert.equal(wantsAllBlocks(parseFilters("\"watch order\"")), false);
  assert.equal(wantsAllBlocks(parseFilters("watch -marvel")), false);
});

test("sourceFor: is only asks Roam's search with the state appended", () => {
  assert.deepEqual(src("watch is:todo"), { kind: "search", text: "watch TODO", is: ["todo"], key: "search\u0000watch todo" });
  assert.equal(src("watch is:done").text, "watch DONE");
  assert.equal(src("watch \"order list\" is:t").text, "watch order list TODO");
});

test("sourceFor: page filters without ns: read the pages, titles resolved like pageScope", () => {
  const here = src("watch in:here", { currentPage: "Today" });
  assert.deepEqual([here.kind, here.titles], ["pages", ["Today"]]);
  const resolve = (v) => (v === "mcu" ? { title: "MCU Watch Order" } : null);
  const two = src("watch in:mcu in:Zed", { currentPage: "x", resolve });
  assert.deepEqual(two.titles, ["MCU Watch Order", "Zed"]);
  const reversed = src("watch in:Zed in:mcu", { resolve });
  assert.equal(reversed.key, two.key, "the key does not depend on order");
  assert.equal(src("watch in:here", { currentPage: null }), null, "no page, nothing to read");
});

test("sourceFor: any ns: goes to search; in:X with ns: too", () => {
  assert.equal(src("watch ns:Systems/").kind, "search");
  const both = src("watch in:MCU ns:Systems/");
  assert.equal(both.kind, "search");
  assert.equal(both.text, "watch");
});

test("sourceFor: no words with search -> null; unknown or mixed states -> null", () => {
  assert.equal(src("is:todo"), null);
  assert.equal(src("ns:Systems/"), null);
  assert.equal(src("watch is:zz"), null);
  assert.equal(src("watch is:todo is:done"), null);
  assert.equal(src("watch -marvel"), null);
});

// Fake timers and a fake Roam: each search call waits for the test to settle it.
function harness({ graph = "g", search = true, asyncPull = true, pullMany = true } = {}) {
  let clock = 0;
  let nextId = 1;
  const timers = new Map();
  const win = {
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: clock + ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
  };
  const tick = (ms) => {
    clock += ms;
    for (const [id, t] of [...timers]) if (t.at <= clock) { timers.delete(id); t.fn(); }
  };
  const searches = [];
  const pulls = [];
  const many = [];
  const syncPulls = [];
  const data = { async: {} };
  if (search) data.async.search = (args) => new Promise((resolve, reject) => searches.push({ args, resolve, reject }));
  if (asyncPull) data.async.pull = (pattern, eid) => new Promise((resolve, reject) => pulls.push({ pattern, eid, resolve, reject }));
  if (pullMany) data.async.pull_many = (pattern, eids) => new Promise((resolve) => many.push({ pattern, eids, resolve }));
  const api = { data, pull: (pattern, eid) => { syncPulls.push({ pattern, eid }); return null; } };
  const replies = [];
  const traces = [];
  const samples = [];
  const all = createAllBlocks({
    api, win, perf: { push: (name, ms) => samples.push([name, ms]) }, trace: (e) => traces.push(e), graph: () => graph, now: () => clock,
    onReply: (token, rows) => replies.push({ query: token.query, rows }),
  });
  const token = (query) => ({ kind: "((", start: 0, query, caret: query.length + 2 });
  const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
  return { all, searches, pulls, many, syncPulls, replies, traces, samples, tick, token, flush, advance: (ms) => { clock += ms; } };
}

const hit = (uid, string) => ({ ":block/uid": uid, ":block/string": string });
const owner = (title) => ({ ":block/page": { ":node/title": title } });
const search = (text) => ({ kind: "search", text, is: [], key: `search\u0000${text.toLowerCase()}` });

test("a burst of keys makes one read, 250 ms after the last", async () => {
  const h = harness();
  for (const q of ["wat", "watc", "watch"]) { h.all.schedule(search(q), h.token(q)); h.tick(100); }
  assert.equal(h.searches.length, 0);
  h.tick(WIDE_DEBOUNCE_MS - 101);
  assert.equal(h.searches.length, 0);
  h.tick(1);
  assert.equal(h.searches.length, 1);
  assert.deepEqual(h.searches[0].args, { "search-str": "watch", "search-pages": false, "search-blocks": true, limit: SEARCH_LIMIT });
});

test("search drops is:-failing results before pull_many, then reads page titles", async () => {
  const h = harness();
  const source = { kind: "search", text: "watch TODO", is: ["todo"], key: "search\u0000watch todo" };
  h.all.schedule(source, h.token("watch is:todo"));
  h.tick(WIDE_DEBOUNCE_MS);
  h.searches[0].resolve([hit("a", "{{[[TODO]]}} watch one"), hit("b", "{{[[DONE]]}} watch two"), hit("c", "watch three"), hit("d", "{{[[TODO]]}} watch four")]);
  await h.flush();
  assert.equal(h.many.length, 1);
  assert.deepEqual(h.many[0].eids, [[":block/uid", "a"], [":block/uid", "d"]]);
  assert.match(h.many[0].pattern, /:block\/page/);
  h.many[0].resolve([owner("P1"), owner("P2")]);
  await h.flush();
  assert.deepEqual(h.replies[0].rows, [["a", "{{[[TODO]]}} watch one", "P1"], ["d", "{{[[TODO]]}} watch four", "P2"]]);
  assert.equal(h.samples[0][0], "wide.read");
});

test("without pull_many, each uid is pulled with api.pull", async () => {
  const h = harness({ pullMany: false });
  h.all.schedule(search("watch"), h.token("watch"));
  h.tick(WIDE_DEBOUNCE_MS);
  h.searches[0].resolve([hit("a", "watch one")]);
  await h.flush();
  assert.equal(h.syncPulls.length, 1);
  assert.deepEqual(h.syncPulls[0].eid, [":block/uid", "a"]);
  assert.deepEqual(h.replies[0].rows, [], "a block with no page is left out");
});

test("pages are read with one async pull each", async () => {
  const h = harness();
  const source = { kind: "pages", titles: ["MCU", "Zed"], key: "pages\u0000mcu\u0001zed" };
  h.all.schedule(source, h.token("watch in:MCU in:Zed"));
  h.tick(WIDE_DEBOUNCE_MS);
  assert.equal(h.pulls.length, 2);
  assert.equal(h.pulls[0].pattern, "[:node/title {:block/_page [:block/uid :block/string]}]");
  assert.deepEqual(h.pulls[0].eid, [":node/title", "MCU"]);
  h.pulls[0].resolve({ ":node/title": "MCU", ":block/_page": [{ ":block/uid": "a", ":block/string": "one" }] });
  h.pulls[1].resolve({ ":node/title": "Zed", ":block/_page": [{ ":block/uid": "b", ":block/string": "two" }] });
  await h.flush();
  assert.deepEqual(h.replies[0].rows, [["a", "one", "MCU"], ["b", "two", "Zed"]]);
});

test("pages fall back to api.pull when async pull is missing", async () => {
  const h = harness({ asyncPull: false });
  h.all.schedule({ kind: "pages", titles: ["MCU"], key: "pages\u0000mcu" }, h.token("x in:MCU"));
  h.tick(WIDE_DEBOUNCE_MS);
  await h.flush();
  assert.equal(h.syncPulls.length, 1);
  assert.deepEqual(h.syncPulls[0].eid, [":node/title", "MCU"]);
});

test("one read in flight; a newer key supersedes the pending one; the old reply is cached, not drawn", async () => {
  const h = harness();
  h.all.schedule(search("one"), h.token("one"));
  h.tick(WIDE_DEBOUNCE_MS);
  assert.equal(h.all.inFlight, true);
  h.all.schedule(search("two"), h.token("two"));
  h.tick(WIDE_DEBOUNCE_MS);
  h.all.schedule(search("three"), h.token("three"));
  h.tick(WIDE_DEBOUNCE_MS);
  assert.equal(h.searches.length, 1, "still one in flight");
  h.searches[0].resolve([]);
  await h.flush();
  assert.equal(h.replies.length, 0, "the first reply is not drawn");
  assert.equal(h.searches.length, 2);
  assert.equal(h.searches[1].args["search-str"], "three", "the newest pending key, not two");
  assert.equal(h.all.get(search("one")).length, 0, "but the first reply is cached");
  h.searches[1].resolve([]);
  await h.flush();
  assert.deepEqual(h.replies.map((r) => r.query), ["three"]);
});

test("the same key while its read is in flight does not read twice and is drawn once", async () => {
  const h = harness();
  h.all.schedule(search("one"), h.token("one"));
  h.tick(WIDE_DEBOUNCE_MS);
  h.all.schedule(search("one"), h.token("one"));
  h.tick(WIDE_DEBOUNCE_MS);
  h.searches[0].resolve([]);
  await h.flush();
  assert.equal(h.searches.length, 1);
  assert.equal(h.replies.length, 1);
});

test("a fresh key is served from the cache without a read; the TTL expires it", async () => {
  const h = harness();
  h.all.schedule(search("one"), h.token("one"));
  h.tick(WIDE_DEBOUNCE_MS);
  h.searches[0].resolve([]);
  await h.flush();
  assert.deepEqual(h.all.get(search("one")), []);
  h.advance(CACHE_TTL_MS - 1);
  assert.notEqual(h.all.get(search("one")), null);
  h.advance(2);
  assert.equal(h.all.get(search("one")), null);
});

test("the cache is per graph and keeps the 20 most recently used", async () => {
  const h = harness();
  for (let i = 0; i < CACHE_LIMIT + 1; i += 1) {
    h.all.schedule(search(`q${i}`), h.token(`q${i}`));
    h.tick(WIDE_DEBOUNCE_MS);
    h.searches[i].resolve([]);
    await h.flush();
    h.all.get(search("q0"));
  }
  assert.equal(h.all.cacheSize, CACHE_LIMIT);
  assert.equal(h.all.get(search("q1")), null, "the least recently used went");
  assert.notEqual(h.all.get(search("q0")), null, "a read key was kept");
  const other = harness({ graph: "h" });
  assert.equal(other.all.get(search("q0")), null);
});

test("a failed read logs once and stops reads until reset; the cache survives", async () => {
  const h = harness();
  const logged = [];
  const real = console.debug;
  console.debug = (...args) => logged.push(args);
  try {
    h.all.schedule(search("ok"), h.token("ok"));
    h.tick(WIDE_DEBOUNCE_MS);
    h.searches[0].resolve([]);
    await h.flush();
    h.all.schedule(search("bad"), h.token("bad"));
    h.tick(WIDE_DEBOUNCE_MS);
    h.searches[1].reject(new Error("boom"));
    await h.flush();
  } finally { console.debug = real; }
  assert.equal(h.all.failed, true);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], "[burrow] all-blocks read failed");
  assert.ok(h.traces.some((e) => e.ev === "wide" && e.step === "fail"));
  h.all.schedule(search("later"), h.token("later"));
  h.tick(WIDE_DEBOUNCE_MS * 2);
  assert.equal(h.searches.length, 2, "no further reads");
  h.all.reset();
  assert.equal(h.all.failed, false);
  assert.notEqual(h.all.get(search("ok")), null, "the cache survives reset");
  h.all.schedule(search("later"), h.token("later"));
  h.tick(WIDE_DEBOUNCE_MS);
  assert.equal(h.searches.length, 3);
});

test("reset cancels the pause, and a reply that outlives its popup is cached, never drawn", async () => {
  const h = harness();
  h.all.schedule(search("one"), h.token("one"));
  h.all.reset();
  h.tick(WIDE_DEBOUNCE_MS * 2);
  assert.equal(h.searches.length, 0);
  h.all.schedule(search("two"), h.token("two"));
  h.tick(WIDE_DEBOUNCE_MS);
  h.all.reset();
  h.searches[0].resolve([]);
  await h.flush();
  assert.equal(h.replies.length, 0);
  assert.notEqual(h.all.get(search("two")), null);
  assert.ok(h.traces.some((e) => e.step === "drop" && e.why === "closed"));
});

const row = (uid, level) => ({ uid, level });

test("mergeRows: a band-2 wide row displaces a band-1 referenced row, never a band-2 one", () => {
  const refs = [row("a", 2), row("b", 2), row("c", 1)];
  assert.deepEqual(mergeRows(refs, [row("w", 2)], 3).map((r) => r.uid), ["a", "b", "w"]);
  assert.deepEqual(mergeRows([row("a", 2), row("b", 2), row("c", 2)], [row("w", 2)], 3).map((r) => r.uid), ["a", "b", "c"]);
  assert.deepEqual(mergeRows(refs, [row("w", 1)], 3).map((r) => r.uid), ["a", "b", "c"], "ties go to referenced rows");
  assert.deepEqual(mergeRows([row("a", 2)], [row("w", 1), row("x", 0)], 3).map((r) => r.uid), ["a", "w", "x"]);
  assert.deepEqual(mergeRows([row("a", 3)], [row("w", 2)], 3).map((r) => r.uid), ["a", "w"], "levels 2 and 3 are one band");
});

test("mergeRows: pinned referenced rows stay first, and no uid twice", () => {
  const out = mergeRows([row("a", 1), row("b", 1)], [row("w", 2), row("a", 2)], 3, 1);
  assert.deepEqual(out.map((r) => r.uid), ["a", "w", "b"]);
});

test("cancel drops the pending read", async () => {
  const h = harness();
  h.all.schedule(search("one"), h.token("one"));
  h.tick(WIDE_DEBOUNCE_MS);
  h.all.schedule(search("two"), h.token("two"));
  h.tick(WIDE_DEBOUNCE_MS);
  h.all.cancel();
  h.searches[0].resolve([]);
  await h.flush();
  assert.equal(h.searches.length, 1);
});

test("a same-key read from a closed popup does not swallow the reopened one", async () => {
  const h = harness();
  h.all.schedule(search("one"), h.token("one"));
  h.tick(WIDE_DEBOUNCE_MS);
  h.all.reset();
  h.all.schedule(search("one"), h.token("one"));
  h.tick(WIDE_DEBOUNCE_MS);
  h.searches[0].resolve([]);
  await h.flush();
  assert.equal(h.replies.length, 1, "the new popup is drawn from the cache");
  assert.equal(h.searches.length, 1);
});
