import assert from "node:assert/strict";
import test from "node:test";

import { createFrecency } from "../src/frecency.js";

const DAY = 24 * 3600 * 1000;
const T0 = 1_800_000_000_000;

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k), map };
}
const clock = (start = T0) => {
  const c = { t: start, now: () => c.t };
  return c;
};
const uid = (n) => `uid${String(n).padStart(6, "0")}`;

test("a pick scores 1, a repeat adds 1 after decay, the score halves every 14 days", () => {
  const c = clock();
  const f = createFrecency({ storage: memoryStorage(), key: "k", now: c.now });
  f.record("block", uid(1));
  assert.equal(f.score("block", uid(1)), 1);
  c.t += 14 * DAY;
  f.record("block", uid(9));
  assert.ok(Math.abs(f.score("block", uid(1)) - 0.5) < 1e-9);
  f.record("block", uid(1));
  assert.ok(Math.abs(f.score("block", uid(1)) - 1.5) < 1e-9);
  assert.equal(f.score("page", uid(1)), 0, "kinds are kept apart");
});

test("more and more recent picks order higher; scores() is one Map until the next change", () => {
  const c = clock();
  const f = createFrecency({ storage: memoryStorage(), key: "k", now: c.now });
  f.record("block", uid(1));
  c.t += 30 * DAY;
  f.record("block", uid(2));
  f.record("block", uid(3));
  f.record("block", uid(3));
  const scores = f.scores("block");
  assert.equal(f.scores("block"), scores);
  assert.ok(scores.get(uid(3)) > scores.get(uid(2)));
  assert.ok(scores.get(uid(2)) > scores.get(uid(1)));
  f.record("block", uid(2));
  assert.notEqual(f.scores("block"), scores);
  assert.deepEqual(f.recent("block", 2), [uid(2), uid(3)]);
});

test("recent lists the latest picks of a kind, most recent first", () => {
  const c = clock();
  const f = createFrecency({ storage: memoryStorage(), key: "k", now: c.now });
  for (let i = 1; i <= 4; i++) { f.record(i % 2 ? "block" : "page", uid(i)); c.t += 1000; }
  assert.deepEqual(f.recent("block", 10), [uid(3), uid(1)]);
  assert.deepEqual(f.recent("page", 1), [uid(4)]);
});

test("at most 500 entries, the least recently picked go first; it persists", () => {
  const c = clock();
  const storage = memoryStorage();
  const f = createFrecency({ storage, key: "k", now: c.now });
  for (let i = 0; i < 520; i++) { f.record("block", uid(i)); c.t += 1000; }
  assert.equal(f.size, 500);
  assert.equal(f.score("block", uid(0)), 0);
  assert.ok(f.score("block", uid(519)) > 0);
  assert.equal(JSON.parse(storage.map.get("k")).length, 500);
  const again = createFrecency({ storage, key: "k", now: c.now });
  assert.equal(again.size, 500);
  assert.ok(again.score("block", uid(519)) > 0);
});

test("clear empties the store and the storage key", () => {
  const storage = memoryStorage();
  const f = createFrecency({ storage, key: "k" });
  f.record("page", uid(1));
  assert.ok(storage.map.has("k"));
  f.clear();
  assert.equal(f.size, 0);
  assert.equal(storage.map.has("k"), false);
  assert.deepEqual(f.recent("page", 5), []);
});

test("broken storage, broken JSON and junk entries never throw", () => {
  const denied = () => { throw new Error("denied"); };
  const f = createFrecency({ storage: { getItem: denied, setItem: denied, removeItem: denied }, key: "k" });
  f.record("block", uid(1));
  assert.ok(f.score("block", uid(1)) > 0);
  f.clear();
  const junk = memoryStorage();
  junk.setItem("k", "{not json");
  assert.equal(createFrecency({ storage: junk, key: "k" }).size, 0);
  junk.setItem("k", JSON.stringify([{ k: "block", id: uid(1), s: 2, t: T0, text: "secret" }, { k: "x", id: "a", s: 1, t: 1 }, null, { k: "page", id: "", s: 1, t: 1 }]));
  const g = createFrecency({ storage: junk, key: "k" });
  assert.equal(g.size, 1);
  g.record("block", uid(2));
  for (const e of JSON.parse(junk.map.get("k"))) assert.deepEqual(Object.keys(e).sort(), ["id", "k", "s", "t"]);
});

test("the store holds only k, id, s and t: no block text or query", () => {
  const storage = memoryStorage();
  const f = createFrecency({ storage, key: "k" });
  f.record("block", "3XSu0IJ8f");
  f.record("page", "pageUid01");
  const raw = storage.map.get("k");
  for (const e of JSON.parse(raw)) assert.deepEqual(Object.keys(e).sort(), ["id", "k", "s", "t"]);
});

test("pick memory of 0.8.0 and before folds in once, without query or alias text, and is removed", () => {
  const c = clock();
  const storage = memoryStorage();
  storage.setItem("old", JSON.stringify([
    { kind: "ref", q: "ant man", uid: uid(1), t: T0 - 20 * DAY },
    { kind: "alias", q: "lori", uid: "page00001:Lori Boyd", t: T0 - 2 * DAY },
    { kind: "ref", q: "ant man", uid: uid(1), t: T0 - 1 * DAY },
    { kind: "ref", q: "x", uid: "", t: T0 },
  ]));
  const f = createFrecency({ storage, key: "new", legacyKey: "old", now: c.now });
  f.load();
  assert.equal(storage.map.has("old"), false);
  assert.equal(f.size, 2);
  assert.ok(f.score("block", uid(1)) > 1, "two picks at their own times");
  assert.ok(f.score("page", "page00001") > 0, "the alias pick is a page pick");
  const raw = storage.map.get("new");
  assert.doesNotMatch(raw, /ant man|lori|Lori Boyd/i);
  for (const e of JSON.parse(raw)) assert.deepEqual(Object.keys(e).sort(), ["id", "k", "s", "t"]);
});

test("a broken legacy value is just removed", () => {
  const storage = memoryStorage();
  storage.setItem("old", "<<<");
  const f = createFrecency({ storage, key: "new", legacyKey: "old" });
  f.load();
  assert.equal(f.size, 0);
  assert.equal(storage.map.has("old"), false);
});
