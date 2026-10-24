import assert from "node:assert/strict";
import test from "node:test";

import { aliasRowsFromPull, buildAliasIndex } from "../src/aliases.js";
import { ALIAS_PULL, createIndexes } from "../src/indexes.js";
import { createLifecycle } from "../src/lifecycle.js";
import { createPerf } from "../src/perf.js";
import { aliasKeyTargets, buildRefIndex, refreshAliasKeys, rekeyAliases } from "../src/refindex.js";
import { buildTitleIndex } from "../src/titles.js";

// A graph with one alias page "Aliases" whose refs are `aliasBlocks`.
function fakeApi() {
  const graph = {
    aliasBlocks: [{ uid: "a1", string: "Aliases:: lori, lorinator", page: { title: "Lori Boyd", uid: "LB" } }],
    refs: [["r1", "met [[Lori Boyd]] today", 2, "Daily"], ["r2", "plain text", 1, "Daily"]],
    titles: [["Lori Boyd", "LB"], ["Daily", "D"], ["Aliases", "AL"]],
  };
  const watches = [];
  const calls = { q: 0, pull: 0 };
  const api = {
    graph,
    watches,
    calls,
    pull(pattern, eid) {
      calls.pull += 1;
      const title = eid?.[1];
      if (pattern === "[:db/id]") return title === "Aliases" ? { ":db/id": 1 } : null;
      if (pattern === ALIAS_PULL) {
        if (title !== "Aliases") return null;
        return { ":block/_refs": graph.aliasBlocks.map((b) => ({ ":block/uid": b.uid, ":block/string": b.string, ":block/page": { ":node/title": b.page.title, ":block/uid": b.page.uid } })) };
      }
      return null;
    },
    data: {
      fast: { q: () => [] },
      async: {
        fast: {
          q: async (query) => {
            calls.q += 1;
            if (query.includes("(count ?r) ?pt")) return graph.refs;
            if (query.includes("?t ?u")) return graph.titles;
            if (query.includes("(count ?r)")) return [["LB", 526]];
            return [];
          },
        },
      },
      addPullWatch: (pattern, entity, cb) => watches.push({ pattern, entity, cb }),
      removePullWatch: (pattern, entity, cb) => { const i = watches.findIndex((w) => w.entity === entity && w.cb === cb); if (i >= 0) watches.splice(i, 1); },
    },
  };
  return api;
}

// Roam calls a pull watch with the pull before and after the change.
const fire = (api, i = 0) => {
  const watch = api.watches[i];
  const title = JSON.parse(watch.entity.slice("[:node/title ".length, -1));
  watch.cb(null, api.pull(watch.pattern, [":node/title", title]));
};

const timers = () => {
  const pending = new Set();
  return {
    setTimeout: (fn, ms) => { const t = { fn, ms }; pending.add(t); return t; },
    clearTimeout: (t) => pending.delete(t),
    flush() { for (const t of [...pending]) { pending.delete(t); t.fn(); } },
    get size() { return pending.size; },
  };
};

test("aliasRowsFromPull skips refs without a page (an orphan block)", () => {
  const rows = aliasRowsFromPull({ ":block/_refs": [
    { ":block/string": "Aliases:: a", ":block/page": { ":node/title": "P", ":block/uid": "p" } },
    { ":block/string": "Aliases:: hunter" },
  ] });
  assert.deepEqual(rows, [["Aliases:: a", "P", "p"]]);
  assert.deepEqual(aliasRowsFromPull(null), []);
});

test("an alias edited outside Burrow reaches the index through the watch, without a rebuild", async () => {
  const api = fakeApi();
  const lifecycle = createLifecycle();
  const win = timers();
  const settings = { aliasKeyword: "Aliases" };
  const indexes = createIndexes({ api, perf: createPerf(), setting: (id) => settings[id], idle: (fn) => fn(), lifecycle, win });
  await indexes.build();
  const queries = api.calls.q;
  // Every spelling of the keyword is watched, whether its page exists or not.
  assert.deepEqual(indexes.watched, ["Aliases", "aliases", "ALIASES"]);
  assert.equal(api.watches.length, 3);
  assert.equal(api.watches[0].entity, '[:node/title "Aliases"]');
  assert.equal(indexes.titles.resolve("lorinator")?.uid, "LB");
  let heard = 0;
  indexes.listen(() => { heard += 1; });

  // By hand: a new alias on the page; Roam's watch fires (several times in a burst).
  api.graph.aliasBlocks[0].string = "Aliases:: lori, lorinator, lb";
  fire(api);
  fire(api);
  assert.equal(win.size, 1, "a burst of edits coalesces into one refresh");
  const pulls = api.calls.pull;
  win.flush();
  assert.equal(api.calls.q, queries, "no datalog query, no rebuild");
  assert.equal(api.calls.pull, pulls, "no pull either: the rows come from the watch's own");
  assert.equal(heard, 1);
  assert.ok(indexes.aliases.entries.some((e) => e.alias === "lb"));
  assert.equal(indexes.titles.resolve("lb")?.uid, "LB");
  // The page's reference count is kept from the last build.
  assert.equal(indexes.aliases.entries.find((e) => e.alias === "lb").refs, 526);
  // (( alias expansion follows: the block linking Lori Boyd now carries the new alias.
  assert.match(indexes.refs.byUid.get("r1").aliasKey.spaced, /\blb\b/);

  // Removed (roam-aliases, an undo): gone from every index.
  api.graph.aliasBlocks[0].string = "Aliases:: lori";
  fire(api);
  win.flush();
  assert.equal(indexes.titles.resolve("lorinator"), null);
  assert.doesNotMatch(indexes.refs.byUid.get("r1").aliasKey.spaced, /lorinator/);

  await lifecycle.dispose();
  assert.equal(api.watches.length, 0, "the watch goes with the extension");
});

test("a watch firing with the aliases unchanged reads them and swaps nothing", async () => {
  const api = fakeApi();
  const lifecycle = createLifecycle();
  const win = timers();
  const perf = createPerf();
  const indexes = createIndexes({ api, perf, setting: () => "Aliases", idle: (fn) => fn(), lifecycle, win });
  await indexes.build();
  const before = indexes.aliases;
  let heard = 0;
  indexes.listen(() => { heard += 1; });
  fire(api);
  win.flush();
  assert.equal(indexes.aliases, before, "same rows: the index is kept");
  assert.equal(heard, 0, "and no popup re-ranks");
  assert.equal(perf.counters.aliasRefreshes || 0, 0);
  // perf-gate's forced refresh swaps anyway.
  indexes.refreshAliases({ force: true });
  assert.notEqual(indexes.aliases, before);
  assert.equal(heard, 1);
  await lifecycle.dispose();
});

test("an alias edited outside Burrow while a rebuild runs survives the rebuild", async () => {
  const api = fakeApi();
  const lifecycle = createLifecycle();
  const win = timers();
  const indexes = createIndexes({ api, perf: createPerf(), setting: () => "Aliases", idle: (fn) => fn(), lifecycle, win });
  await indexes.build();
  // The rebuild's queries are held open while the edit lands.
  const q = api.data.async.fast.q;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  api.data.async.fast.q = async (...args) => { await held; return q(...args); };
  const rebuild = indexes.build();
  api.graph.aliasBlocks[0].string = "Aliases:: lori, lorinator, lb";
  fire(api);
  win.flush();
  assert.equal(indexes.titles.resolve("lb")?.uid, "LB", "the watch's refresh has it");
  release();
  await rebuild;
  assert.equal(indexes.titles.resolve("lb")?.uid, "LB", "and the rebuild that read the aliases first does not drop it");
  assert.ok(indexes.aliases.entries.some((e) => e.alias === "lb"));
  await lifecycle.dispose();
});

test("no alias row is listed twice when two spellings or blocks repeat a tuple", async () => {
  const api = fakeApi();
  api.graph.aliasBlocks.push({ uid: "a2", string: "Aliases:: lori, lorinator", page: { title: "Lori Boyd", uid: "LB" } });
  const lifecycle = createLifecycle();
  const indexes = createIndexes({ api, perf: createPerf(), setting: () => "Aliases", idle: (fn) => fn(), lifecycle, win: timers() });
  await indexes.build();
  assert.deepEqual(indexes.aliases.entries.map((e) => e.alias), ["lori", "lorinator"]);
  await lifecycle.dispose();
});

test("refreshAliasKeys re-keys only blocks whose linked pages' aliases changed", () => {
  const index = buildRefIndex([["r1", "met [[P]]", 3, "D"], ["r2", "about #Q", 1, "D"], ["r3", "nothing", 1, "D"]], new Map([["P", ["pea"]]]));
  assert.equal(index.byUid.get("r1").aliasKey.spaced, "pea");
  assert.equal(index.byUid.get("r2").aliasKey, null);
  index.prefilter = new Map([["x", []]]);
  assert.equal(refreshAliasKeys(index, new Map([["P", ["pea"]], ["Q", ["queue"]]])), 1);
  assert.equal(index.byUid.get("r2").aliasKey.spaced, "queue");
  assert.ok(index.words.get("queue").includes(index.byUid.get("r2")));
  assert.equal(index.prefilter, null, "cached prefilter sets are dropped");
  assert.equal(refreshAliasKeys(index, new Map([["Q", ["queue"]]])), 1);
  assert.equal(index.byUid.get("r1").aliasKey, null);
  assert.equal(index.words.has("pea"), false);
});

test("refreshAliasKeys with the previous map touches only the changed pages' blocks", () => {
  const before = new Map([["P", ["pea"]], ["R", ["arr"]]]);
  const index = buildRefIndex([["r1", "met [[P]]", 3, "D"], ["r2", "about [[R]]", 1, "D"]], before);
  // A key no rebuild would write: it stays only if r2 is never looked at.
  const marker = index.byUid.get("r2").aliasKey;
  marker.marked = true;
  index.prefilter = new Map();
  assert.equal(refreshAliasKeys(index, new Map(before), before), 0, "nothing changed: nothing re-keyed");
  assert.notEqual(index.prefilter, null, "and the prefilter cache is kept");
  const after = new Map([["P", ["pea", "pod"]], ["R", ["arr"]]]);
  assert.equal(refreshAliasKeys(index, after, before), 1);
  assert.equal(index.byUid.get("r1").aliasKey.spaced, "pea pod");
  assert.equal(index.byUid.get("r2").aliasKey.marked, true, "R's blocks were not touched");
  // A page that lost all its aliases counts as changed.
  assert.equal(refreshAliasKeys(index, new Map([["R", ["arr"]]]), after), 1);
  assert.equal(index.byUid.get("r1").aliasKey, null);
});

test("an alias page that does not exist yet is watched: the first alias typed by hand arrives through it", async () => {
  const api = fakeApi();
  let exists = false;
  const pull = api.pull;
  api.pull = (pattern, eid) => (!exists && eid?.[1] === "Aliases" ? null : pull(pattern, eid));
  const lifecycle = createLifecycle();
  const win = timers();
  const indexes = createIndexes({ api, perf: createPerf(), setting: () => "Aliases", idle: (fn) => fn(), lifecycle, win });
  await indexes.build();
  assert.deepEqual(indexes.watched, ["Aliases", "aliases", "ALIASES"], "watched before any of them exists");
  assert.equal(indexes.titles.resolve("lorinator"), null);
  const queries = api.calls.q;
  // The first alias typed by hand creates the page; Roam fires its watch (checked live).
  exists = true;
  fire(api, 0);
  win.flush();
  assert.equal(indexes.titles.resolve("lorinator")?.uid, "LB");
  assert.equal(api.calls.q, queries, "read by the watch, no rebuild");
  await lifecycle.dispose();
});

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

// A window whose listeners the test can fire, and a clock it moves.
function quietWorld() {
  const win = timers();
  const listeners = new Map();
  win.addEventListener = (type, fn) => listeners.set(type, fn);
  win.removeEventListener = (type) => listeners.delete(type);
  const world = { win, t: 100_000, popup: false };
  world.key = () => listeners.get("keydown")?.({});
  world.doc = { querySelector: () => (world.popup ? {} : null) };
  world.now = () => world.t;
  return world;
}

test("a rebuild waits for a quiet moment: never while a popup is open or within 2 s of a key", async () => {
  const api = fakeApi();
  const lifecycle = createLifecycle();
  const w = quietWorld();
  const perf = createPerf();
  const indexes = createIndexes({ api, perf, setting: () => "Aliases", idle: (fn) => fn(), lifecycle, win: w.win, doc: w.doc, now: w.now });
  indexes.schedule();
  await settle();
  assert.equal(perf.counters.builds, 1, "the first build runs at once, there is no index yet");
  const queries = api.calls.q;
  w.popup = true;
  indexes.schedule();
  assert.equal(api.calls.q, queries, "a popup is open: not now");
  assert.equal(w.win.size, 1, "checked again later");
  w.win.flush();
  assert.equal(api.calls.q, queries, "still open");
  w.popup = false;
  w.key();
  w.t += 500;
  w.win.flush();
  assert.equal(api.calls.q, queries, "a key 0.5 s ago: not now");
  w.t += 2_000;
  w.win.flush();
  await settle();
  assert.equal(perf.counters.builds, 2, "quiet: rebuilt");
  await lifecycle.dispose();
});

test("a rebuild that finds the user typing again before its long query stops there and waits", async () => {
  const api = fakeApi();
  const lifecycle = createLifecycle();
  const w = quietWorld();
  const perf = createPerf();
  const indexes = createIndexes({ api, perf, setting: () => "Aliases", idle: (fn) => fn(), lifecycle, win: w.win, doc: w.doc, now: w.now });
  await indexes.build({ first: true });
  // A key lands while the build awaits its first, small query.
  const q = api.data.async.fast.q;
  api.data.async.fast.q = async (query, ...args) => { if (query.includes("(count ?r)") && !query.includes("?pt")) w.key(); return q(query, ...args); };
  const done = await indexes.build();
  assert.equal(done, false);
  assert.equal(perf.counters.rebuildsDeferred, 1);
  assert.equal(perf.counters.builds, 1, "the referenced-blocks query never ran");
  await lifecycle.dispose();
});

test("rekeyAliases resumes where it paused and ends where one pass would", () => {
  const rows = [["r1", "met [[P]]", 3, "D"], ["r2", "about [[P]] and [[Q]]", 1, "D"], ["r3", "[[Q]] again", 1, "D"], ["r4", "plain", 1, "D"]];
  const before = new Map([["P", ["pea"]]]);
  const after = new Map([["P", ["pea", "pod"]], ["Q", ["queue"]]]);
  const sliced = buildRefIndex(rows, before);
  const whole = buildRefIndex(rows, before);
  const entries = aliasKeyTargets(sliced, after, before);
  assert.deepEqual(entries.map((e) => e.uid), ["r1", "r2", "r3"]);
  let at = 0;
  let steps = 0;
  while (at < entries.length) {
    at = rekeyAliases(sliced, entries, after, { from: at, stop: () => true }).next;
    steps += 1;
  }
  assert.equal(steps, 3, "one block per slice when every slice is out of time");
  refreshAliasKeys(whole, after, before);
  for (const uid of ["r1", "r2", "r3", "r4"]) assert.equal(sliced.byUid.get(uid).aliasKey?.spaced ?? null, whole.byUid.get(uid).aliasKey?.spaced ?? null, uid);
  assert.deepEqual([...sliced.words.keys()].sort(), [...whole.words.keys()].sort());
});

test("a newer alias refresh takes over the blocks an unfinished re-key had not reached", async () => {
  const api = fakeApi();
  api.graph.aliasBlocks.push({ uid: "a2", string: "Aliases:: mcu", page: { title: "Marvel", uid: "MV" } });
  api.graph.refs.push(["r3", "also [[Lori Boyd]]", 1, "Daily"], ["r4", "watched [[Marvel]]", 1, "Daily"]);
  const lifecycle = createLifecycle();
  const win = timers();
  const queue = [];
  let manual = false;
  const idle = (fn) => (manual ? queue.push(fn) : fn());
  const indexes = createIndexes({ api, perf: createPerf(), setting: () => "Aliases", idle, lifecycle, win });
  await indexes.build();
  manual = true;
  let heard = 0;
  indexes.listen(() => { heard += 1; });
  // First edit (Lori Boyd's aliases): read, then swap; its re-key is queued.
  api.graph.aliasBlocks[0].string = "Aliases:: lori, lb";
  fire(api);
  win.flush();
  queue.shift()();
  queue.shift()();
  assert.equal(queue.length, 1);
  const firstStep = queue.shift();
  // Second edit, on another page (Marvel), is read and swapped before that step runs.
  api.graph.aliasBlocks[1].string = "Aliases:: mcu, marvel universe";
  fire(api);
  win.flush();
  queue.shift()();
  queue.shift()();
  firstStep(); // superseded: does nothing
  assert.equal(heard, 0);
  while (queue.length) queue.shift()();
  assert.equal(heard, 1, "one re-rank, when the last re-key is done");
  // Lori Boyd's blocks were the first run's; the second run took them over.
  for (const uid of ["r1", "r3"]) assert.equal(indexes.refs.byUid.get(uid).aliasKey.spaced, "lori lb", uid);
  assert.equal(indexes.refs.byUid.get("r4").aliasKey.spaced, "mcu marvel universe");
  await lifecycle.dispose();
});

test("titles.setAliases swaps the alias spellings alone", () => {
  const titles = buildTitleIndex([["Lori Boyd", "LB"]], buildAliasIndex([["Aliases:: lori", "Lori Boyd", "LB"]]));
  assert.equal(titles.resolve("lori")?.uid, "LB");
  titles.setAliases(buildAliasIndex([["Aliases:: boyd", "Lori Boyd", "LB"]]));
  assert.equal(titles.resolve("lori"), null);
  assert.equal(titles.resolve("boyd")?.uid, "LB");
  assert.equal(titles.resolve("Lori Boyd")?.uid, "LB");
});
