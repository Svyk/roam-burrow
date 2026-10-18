import assert from "node:assert/strict";
import test from "node:test";

import { buildAliasIndex, matchAliases } from "../src/aliases.js";
import { createPickMemory } from "../src/picks.js";
import { buildRefIndex, rankRefs } from "../src/refindex.js";
import { searchPlan } from "../src/search.js";
import { buildTitleIndex } from "../src/titles.js";

const uid = (n) => `uid${String(n).padStart(6, "0")}`;

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), map };
}

test("pick memory: a picked row wins among equal matches, for the query and its prefixes", () => {
  const rows = [
    [uid(1), "Ant-Man notes", 3],
    [uid(2), "Ant-Man review", 3],
  ];
  const index = buildRefIndex(rows);
  assert.equal(rankRefs(index, searchPlan("ant man"))[0].uid, uid(1));
  const picks = createPickMemory({ storage: memoryStorage(), key: "k" });
  picks.record("ref", "ant man r", uid(2));
  const ranked = rankRefs(index, searchPlan("ant man"), { picked: picks.lookup("ref", "ant man") });
  assert.equal(ranked[0].uid, uid(2));
  assert.equal(ranked[0].picked, true);
  assert.equal(picks.lookup("ref", "ant woman").size, 0);
  assert.equal(picks.lookup("alias", "ant man").size, 0, "kinds are kept apart");
});

test("pick memory never lifts a row out of a better match band", () => {
  const rows = [
    [uid(1), "Real-time PCR screen", 1],
    [uid(2), "PCR real time later", 1],
  ];
  const picks = createPickMemory({ storage: memoryStorage(), key: "k" });
  picks.record("ref", "real time pcr", uid(2));
  const ranked = rankRefs(buildRefIndex(rows), searchPlan("real time pcr"), { picked: picks.lookup("ref", "real time pcr") });
  assert.equal(ranked[0].uid, uid(1));
});

test("pick memory persists, keeps the most recent 200, and survives broken storage", () => {
  const storage = memoryStorage();
  const a = createPickMemory({ storage, key: "k" });
  for (let i = 0; i < 250; i++) a.record("ref", `query ${i}`, uid(i));
  const b = createPickMemory({ storage, key: "k" });
  assert.equal(b.lookup("ref", "query 249").get(uid(249)) > 0, true);
  assert.equal(b.lookup("ref", "query 10").has(uid(10)), false, "the oldest picks were dropped");
  assert.equal(JSON.parse(storage.map.get("k")).length, 200);
  const broken = createPickMemory({ storage: { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } }, key: "k" });
  broken.record("ref", "ant man", uid(1));
  assert.equal(broken.lookup("ref", "ant man").get(uid(1)) > 0, true);
});

test("alias rows: a picked alias ranks first", () => {
  const index = buildAliasIndex([["Aliases:: Lori, Lorinator", "Lori Boyd", "lb"], ["Aliases:: Lorikeet", "Birds", "bd"]], "Aliases");
  const plain = matchAliases(index, searchPlan("lori"), { limit: 5 });
  assert.equal(plain[0].alias, "Lori");
  const picks = createPickMemory({ storage: memoryStorage(), key: "k" });
  picks.record("alias", "lori", "bd:Lorikeet");
  const ranked = matchAliases(index, searchPlan("lori"), { limit: 5, picked: picks.lookup("alias", "lori") });
  assert.equal(ranked[0].alias, "Lorikeet");
});

test("current-page boost breaks ties only after refs and alias", () => {
  const rows = [
    [uid(1), "Ant-Man notes", 3, "Other"],
    [uid(2), "Ant-Man notes", 3, "Here"],
    [uid(3), "Ant-Man notes", 9, "Other"],
  ];
  const ranked = rankRefs(buildRefIndex(rows), searchPlan("ant man"), { currentPage: "Here" });
  assert.deepEqual(ranked.map((r) => r.uid), [uid(3), uid(2), uid(1)]);
  assert.equal(ranked[1].onPage, true);
});

test("title index for 7k titles builds in well under a frame budget per call", () => {
  const rows = Array.from({ length: 7000 }, (_, i) => [`Page ${i} about Topic-${i % 97}`, uid(i)]);
  const t0 = performance.now();
  const titles = buildTitleIndex(rows, null);
  const built = performance.now() - t0;
  assert.equal(titles.size, 7000);
  const t1 = performance.now();
  for (let i = 0; i < 1000; i++) titles.resolve(`page ${i} about topic ${i % 97}`);
  const per = (performance.now() - t1) / 1000;
  assert.ok(per < 0.2, `resolve ${per.toFixed(3)} ms`);
  assert.ok(built < 400, `build ${built.toFixed(1)} ms`);
});
