import assert from "node:assert/strict";
import test from "node:test";

import { CACHE_LIMIT, CACHE_TTL_MS, DEBOUNCE_MS, SYNC_RETRIES, SYNC_RETRY_MS, candidates, createSemantic, eligibleQuery } from "../src/semantic.js";

// Fake timers and a fake Roam: each semanticSearch call waits for the test to settle it.
function harness({ enabled = true, graph = "g" } = {}) {
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
  const calls = [];
  const state = { enabled };
  const api = { data: {
    semanticSearchEnabled: () => { if (state.enabled === "throw") throw new Error("nope"); return state.enabled; },
    async: { semanticSearch: (args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })) },
  } };
  const replies = [];
  const traces = [];
  const samples = [];
  const semantic = createSemantic({
    api, win, perf: { push: (name, ms) => samples.push([name, ms]) }, trace: (e) => traces.push(e), graph: () => graph, now: () => clock,
    onReply: (token, list) => replies.push({ query: token.query, list }),
  });
  const token = (query, kind = "((", start = 0) => ({ kind, start, query, caret: start + 2 + query.length });
  const flush = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };
  return { semantic, calls, replies, traces, samples, tick, token, state, flush, advance: (ms) => { clock += ms; }, timers };
}

const chunk = (uid, tops = [uid]) => ({ type: "chunk", uid, topUids: tops });

test("eligibility: two words and eight characters, trimmed", () => {
  assert.equal(eligibleQuery("black panther"), true);
  assert.equal(eligibleQuery("  black panther  "), true);
  assert.equal(eligibleQuery("blackpanther"), false, "one word");
  assert.equal(eligibleQuery("a b c d"), false, "seven characters");
  assert.equal(eligibleQuery("ab cd efg"), true);
  assert.equal(eligibleQuery("ab cd e"), false);
});

test("a burst of keys makes one request, 400 ms after the last", async () => {
  const h = harness();
  for (const q of ["black pa", "black pan", "black pant", "black panther"]) { h.semantic.schedule(h.token(q)); h.tick(100); }
  assert.equal(h.calls.length, 0);
  h.tick(DEBOUNCE_MS - 101);
  assert.equal(h.calls.length, 0, "400 ms since the first is not 400 ms since the last");
  h.tick(1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args["search-str"], "black panther");
});

test("k is 10; (( asks blocks only, [[ asks pages too", async () => {
  const h = harness();
  h.semantic.schedule(h.token("black panther", "(("));
  h.tick(DEBOUNCE_MS);
  assert.deepEqual(h.calls[0].args, { "search-str": "black panther", k: 10, "search-blocks": true, "search-pages": false });
  h.calls[0].resolve([]);
  await h.flush();
  h.semantic.schedule(h.token("black panther", "[["));
  h.tick(DEBOUNCE_MS);
  assert.deepEqual(h.calls[1].args, { "search-str": "black panther", k: 10, "search-blocks": true, "search-pages": true });
});

test("an ineligible query asks nothing and clears the pause", async () => {
  const h = harness();
  h.semantic.schedule(h.token("black panther"));
  h.semantic.schedule(h.token("black"));
  h.tick(DEBOUNCE_MS * 2);
  assert.equal(h.calls.length, 0);
});

test("a chunk hit uses its first topUid; pages are left out in ((; no uid twice", () => {
  const hits = [chunk("c1", ["t1", "t2"]), { type: "block", uid: "b1", topUids: ["b1"] }, { type: "page", uid: "p1" }, chunk("c2", ["b1"]), { type: "block", uid: "t1" }, null, { type: "chunk", uid: "x" }];
  assert.deepEqual(candidates(hits, "(("), [{ kind: "block", uid: "t1" }, { kind: "block", uid: "b1" }]);
  assert.deepEqual(candidates(hits, "[["), [{ kind: "block", uid: "t1" }, { kind: "block", uid: "b1" }, { kind: "page", uid: "p1" }]);
  assert.deepEqual(candidates(undefined, "(("), []);
});

test("the reply reaches onReply as candidates and is timed", async () => {
  const h = harness();
  h.semantic.schedule(h.token("black panther"));
  h.tick(DEBOUNCE_MS);
  assert.equal(h.semantic.inFlight, true);
  h.advance(250);
  h.calls[0].resolve([chunk("c1", ["t1"])]);
  await h.flush();
  assert.equal(h.semantic.inFlight, false);
  assert.deepEqual(h.replies, [{ query: "black panther", list: [{ kind: "block", uid: "t1" }] }]);
  assert.deepEqual(h.samples, [["related.request", 250]]);
  assert.equal(h.semantic.lastMs, 250);
  assert.equal(h.semantic.lastQuery, "black panther");
});

test("the cache answers the same graph, kind and query without a request", async () => {
  const h = harness();
  const ask = () => { h.semantic.schedule(h.token("black panther")); h.tick(DEBOUNCE_MS); };
  ask();
  h.calls[0].resolve([chunk("c1")]);
  await h.flush();
  ask();
  assert.equal(h.calls.length, 1, "no second request");
  assert.equal(h.replies.length, 2, "but a second reply");
  h.semantic.schedule(h.token("black panther", "[["));
  h.tick(DEBOUNCE_MS);
  assert.equal(h.calls.length, 2, "another kind is another entry");
  assert.equal(h.semantic.cacheSize, 1);
});

test("the cache is a 50-entry LRU", async () => {
  const h = harness();
  const ask = async (q) => { h.semantic.schedule(h.token(q)); h.tick(DEBOUNCE_MS); if (h.semantic.inFlight) { h.calls.at(-1).resolve([]); await h.flush(); } };
  for (let i = 0; i < CACHE_LIMIT; i += 1) await ask(`query number ${i}`);
  assert.equal(h.semantic.cacheSize, CACHE_LIMIT);
  await ask("query number 0");               // used again: now the newest
  assert.equal(h.calls.length, CACHE_LIMIT, "served from the cache");
  await ask("one more query");               // evicts the oldest, which is 1
  assert.equal(h.semantic.cacheSize, CACHE_LIMIT);
  const before = h.calls.length;
  await ask("query number 0");
  assert.equal(h.calls.length, before, "0 survived");
  await ask("query number 1");
  assert.equal(h.calls.length, before + 1, "1 was evicted");
});

test("an entry older than five minutes is asked again", async () => {
  const h = harness();
  h.semantic.schedule(h.token("black panther"));
  h.tick(DEBOUNCE_MS);
  h.calls[0].resolve([chunk("c1")]);
  await h.flush();
  h.advance(CACHE_TTL_MS - DEBOUNCE_MS - 1);
  h.semantic.schedule(h.token("black panther"));
  h.tick(DEBOUNCE_MS);
  assert.equal(h.calls.length, 1, "four minutes fifty-nine: cached");
  h.advance(CACHE_TTL_MS);
  h.semantic.schedule(h.token("black panther"));
  h.tick(DEBOUNCE_MS);
  assert.equal(h.calls.length, 2);
});

test("a newer pause waits for the request in flight; the older reply is cached, not drawn", async () => {
  const h = harness();
  h.semantic.schedule(h.token("black panther"));
  h.tick(DEBOUNCE_MS);
  h.semantic.schedule(h.token("black panther wakanda"));
  h.tick(DEBOUNCE_MS);
  assert.equal(h.calls.length, 1, "at most one in flight");
  h.calls[0].resolve([chunk("old")]);
  await h.flush();
  assert.equal(h.calls.length, 2, "the newer one fires when the first settles");
  assert.equal(h.calls[1].args["search-str"], "black panther wakanda");
  assert.deepEqual(h.replies, [], "the superseded reply is not drawn");
  assert.equal(h.semantic.cacheSize, 1, "but it is cached");
  h.calls[1].resolve([chunk("new")]);
  await h.flush();
  assert.deepEqual(h.replies.map((r) => r.query), ["black panther wakanda"]);
  // Only the latest pending query is held.
  h.semantic.schedule(h.token("second phrase here"));
  h.tick(DEBOUNCE_MS);
  h.semantic.schedule(h.token("third phrase here"));
  h.tick(DEBOUNCE_MS);
  h.semantic.schedule(h.token("fourth phrase here"));
  h.tick(DEBOUNCE_MS);
  h.calls[2].resolve([]);
  await h.flush();
  assert.equal(h.calls.length, 4);
  assert.equal(h.calls[3].args["search-str"], "fourth phrase here");
});

test("a throw: one console.debug, no more requests until the popup reopens", async () => {
  const h = harness();
  const logged = [];
  const original = console.debug;
  console.debug = (...args) => logged.push(args);
  try {
    h.semantic.schedule(h.token("black panther"));
    h.tick(DEBOUNCE_MS);
    h.calls[0].reject(new Error("embedding provider down"));
    await h.flush();
    assert.equal(h.semantic.failed, true);
    h.semantic.schedule(h.token("black panther wakanda"));
    h.tick(DEBOUNCE_MS);
    assert.equal(h.calls.length, 1, "no more requests");
    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], "[burrow] related rows: semantic search failed");
    assert.equal(logged[0][1], "embedding provider down");
    h.semantic.reset();
    h.semantic.schedule(h.token("black panther wakanda"));
    h.tick(DEBOUNCE_MS);
    assert.equal(h.calls.length, 2, "asks again after reset");
    h.calls[1].reject(new Error("again"));
    await h.flush();
    assert.equal(logged.length, 2, "one per popup");
  } finally {
    console.debug = original;
  }
  assert.deepEqual(h.replies, []);
});

test("an empty reply is cached: not asked again", async () => {
  const h = harness();
  const ask = () => { h.semantic.schedule(h.token("black panther")); h.tick(DEBOUNCE_MS); };
  ask();
  h.calls[0].resolve([]);
  await h.flush();
  ask();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.replies.map((r) => r.list), [[], []]);
});

test("unavailable (off, throws, or no async API): no request", async () => {
  for (const enabled of [false, "throw"]) {
    const h = harness({ enabled });
    h.semantic.schedule(h.token("black panther"));
    h.tick(DEBOUNCE_MS);
    assert.equal(h.calls.length, 0, String(enabled));
    assert.equal(h.semantic.available(), false);
  }
  const bare = createSemantic({ api: { data: { semanticSearchEnabled: () => true } }, win: { setTimeout: (fn) => fn(), clearTimeout() {} } });
  assert.equal(bare.available(), false);
  bare.schedule({ kind: "((", start: 0, query: "black panther", caret: 15 });
});

test("a reply that outlives its popup is cached and never drawn", async () => {
  const h = harness();
  h.semantic.schedule(h.token("black panther"));
  h.tick(DEBOUNCE_MS);
  h.semantic.reset();
  h.calls[0].resolve([chunk("c1")]);
  await h.flush();
  assert.deepEqual(h.replies, []);
  assert.equal(h.semantic.cacheSize, 1);
  h.semantic.clear();
  assert.equal(h.semantic.cacheSize, 0);
});

test("a closed popup's request that fails still lets the new popup's queued query through", async () => {
  const h = harness();
  h.semantic.schedule(h.token("first popup query"));
  h.tick(DEBOUNCE_MS);
  h.semantic.reset();
  h.semantic.schedule(h.token("second popup query"));
  h.tick(DEBOUNCE_MS);
  assert.equal(h.calls.length, 1, "queued behind the request in flight");
  h.calls[0].reject(new Error("provider down"));
  await h.flush();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].args["search-str"], "second popup query");
  assert.equal(h.semantic.failed, false);
  h.calls[1].resolve([chunk("c2")]);
  await h.flush();
  assert.deepEqual(h.replies.map((r) => r.query), ["second popup query"]);
});

test("Initial sync in progress: asked again after a wait, no failure, no console line", async () => {
  const h = harness();
  const logged = [];
  const original = console.debug;
  console.debug = (...args) => logged.push(args);
  try {
    h.semantic.schedule(h.token("black panther"));
    h.tick(DEBOUNCE_MS);
    h.calls[0].reject(new Error("Initial sync in progress"));
    await h.flush();
    assert.equal(h.semantic.failed, false);
    h.tick(SYNC_RETRY_MS);
    assert.equal(h.calls.length, 2, "asked again");
    h.calls[1].resolve([chunk("a")]);
    await h.flush();
    assert.deepEqual(h.replies.map((r) => r.list), [[{ kind: "block", uid: "a" }]]);
    assert.equal(logged.length, 0);
    // A newer pause wins over the wait; a reset cancels it.
    h.semantic.schedule(h.token("black panther two"));
    h.tick(DEBOUNCE_MS);
    h.calls[2].reject(new Error("Initial sync in progress"));
    await h.flush();
    h.semantic.reset();
    h.tick(SYNC_RETRY_MS);
    assert.equal(h.calls.length, 3, "no retry after reset");
    // Past the retries it is a failure like any other.
    h.semantic.schedule(h.token("black panther three"));
    h.tick(DEBOUNCE_MS);
    for (let i = 0; i <= SYNC_RETRIES; i += 1) {
      h.calls.at(-1).reject(new Error("Initial sync in progress"));
      await h.flush();
      h.tick(SYNC_RETRY_MS);
    }
    assert.equal(h.calls.length, 4 + SYNC_RETRIES);
    assert.equal(h.semantic.failed, true);
    assert.equal(logged.length, 1);
  } finally {
    console.debug = original;
  }
});
