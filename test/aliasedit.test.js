import assert from "node:assert/strict";
import test from "node:test";

import { addAliasToPage, appendAlias, deleteAliasFromPage, findAliasBlocks, isAliasBlock, removeAlias, validAlias } from "../src/aliasedit.js";

// blocks: [{ uid, string, top }] on page "P". The alias attribute page is id 1.
function fakeApi(blocks, { failWrite = false } = {}) {
  const strings = new Map(blocks.map((b) => [b.uid, b.string]));
  const log = { q: [], pull: [], update: [], create: [] };
  return {
    log,
    strings,
    q(query, ...args) {
      log.q.push(query);
      if (query.includes(":node/title")) return [1];
      return blocks.map((b) => [b.uid, strings.get(b.uid)]);
    },
    pull(selector, ident) {
      log.pull.push(ident);
      if (selector.includes("children")) return { ":block/children": blocks.filter((b) => b.top).map((b) => ({ ":block/uid": b.uid })) };
      return { ":block/string": strings.get(ident[1]) };
    },
    util: { generateUID: () => "NEWUID123" },
    data: {
      block: {
        update: async ({ block }) => { if (failWrite) throw new Error("boom"); log.update.push(block); strings.set(block.uid, block.string); },
        create: async (args) => { log.create.push(args); },
      },
    },
  };
}

const noAliasesApi = () => ({ ...fakeApi([]), q: (query) => (query.includes(":node/title") ? [] : []) });

test("validAlias trims and gives the exact reasons", () => {
  assert.deepEqual(validAlias("  Lori  "), { ok: true, alias: "Lori" });
  assert.deepEqual(validAlias("  "), { ok: false, reason: "type an alias" });
  assert.deepEqual(validAlias("a, b"), { ok: false, reason: "no commas: Roam splits aliases on them" });
  for (const bad of ["a\nb", "[x]", "a]b", "a ((b", "a)) b"]) assert.deepEqual(validAlias(bad), { ok: false, reason: "no brackets or line breaks" }, bad);
  assert.equal(validAlias("a (b) c").ok, true);
});

test("isAliasBlock reads the keyword without case", () => {
  assert.equal(isAliasBlock("Aliases:: a", "Aliases"), true);
  assert.equal(isAliasBlock("aliases:: a", "Aliases"), true);
  assert.equal(isAliasBlock("Alias:: a", "Aliases"), false);
  assert.equal(isAliasBlock("Aliases:: a", ""), true);
  assert.equal(isAliasBlock("hello", "Aliases"), false);
});

test("appendAlias keeps the block's own casing and never duplicates", () => {
  assert.deepEqual(appendAlias("Aliases:: a, b", "Aliases", "c"), { string: "Aliases:: a, b, c", changed: true });
  assert.deepEqual(appendAlias("aliases::", "Aliases", "c"), { string: "aliases:: c", changed: true });
  assert.deepEqual(appendAlias("Aliases::   ", "Aliases", "c"), { string: "Aliases:: c", changed: true });
  assert.deepEqual(appendAlias("Aliases:: a, b  ", "Aliases", "c"), { string: "Aliases:: a, b, c", changed: true });
  assert.deepEqual(appendAlias("Aliases:: a, B", "Aliases", "b"), { string: "Aliases:: a, B", changed: false });
  assert.equal(appendAlias("Notes:: a", "Aliases", "c"), null);
});

test("removeAlias removes exactly one part and leaves every other byte", () => {
  const s = "Aliases:: Lori, lori, lorinator";
  assert.equal(removeAlias(s, "Aliases", "Lori"), "Aliases:: lori, lorinator");
  assert.equal(removeAlias(s, "Aliases", "lori"), "Aliases:: Lori, lorinator");
  assert.equal(removeAlias(s, "Aliases", "lorinator"), "Aliases:: Lori, lori");
  assert.equal(removeAlias("Aliases:: only", "Aliases", "only"), "Aliases::");
  assert.equal(removeAlias("Aliases:: [[A]], #b", "Aliases", "A"), "Aliases:: #b");
  assert.equal(removeAlias("Aliases:: a, b", "Aliases", "B"), "Aliases:: a");
  assert.equal(removeAlias(s, "Aliases", "nope"), null);
  assert.equal(removeAlias("Notes:: a", "Aliases", "a"), null);
});

test("findAliasBlocks lists alias blocks, top-level first, then by uid", () => {
  const api = fakeApi([
    { uid: "zzz", string: "Aliases:: z", top: false },
    { uid: "bbb", string: "Aliases:: b", top: true },
    { uid: "aaa", string: "Aliases:: a", top: false },
    { uid: "nnn", string: "not an alias", top: true },
  ]);
  assert.deepEqual(findAliasBlocks(api, "P", "Aliases"), [
    { uid: "bbb", string: "Aliases:: b", top: true },
    { uid: "aaa", string: "Aliases:: a", top: false },
    { uid: "zzz", string: "Aliases:: z", top: false },
  ]);
  assert.deepEqual(findAliasBlocks(noAliasesApi(), "P", "Aliases"), []);
});

test("addAliasToPage appends to the existing block with one update", async () => {
  const api = fakeApi([{ uid: "other", string: "Aliases:: x", top: false }, { uid: "main", string: "Aliases:: a", top: true }]);
  const result = await addAliasToPage(api, { pageUid: "P", keyword: "Aliases", alias: "b" });
  assert.deepEqual(result, { ok: true, changed: true, created: false, blockUid: "main", before: "Aliases:: a", after: "Aliases:: a, b" });
  assert.deepEqual(api.log.update, [{ uid: "main", string: "Aliases:: a, b" }]);
  assert.equal(api.log.create.length, 0);
});

test("addAliasToPage creates the block at the top of the page when none exists", async () => {
  const api = fakeApi([]);
  api.q = (query) => (query.includes(":node/title") ? [] : []);
  const result = await addAliasToPage(api, { pageUid: "P", keyword: "Aliases", alias: "b" });
  assert.deepEqual(result, { ok: true, changed: true, created: true, blockUid: "NEWUID123", before: null, after: "Aliases:: b" });
  assert.deepEqual(api.log.create, [{ location: { "parent-uid": "P", order: 0 }, block: { string: "Aliases:: b", uid: "NEWUID123" } }]);
  assert.equal(api.log.update.length, 0);
});

test("addAliasToPage writes nothing when any block already holds the alias", async () => {
  const api = fakeApi([{ uid: "main", string: "Aliases:: a", top: true }, { uid: "second", string: "Aliases:: Beta", top: false }]);
  const result = await addAliasToPage(api, { pageUid: "P", keyword: "Aliases", alias: "beta" });
  assert.deepEqual(result, { ok: true, changed: false, blockUid: "second" });
  assert.equal(api.log.update.length + api.log.create.length, 0);
});

test("addAliasToPage re-reads the block before writing and reports a throw", async () => {
  const api = fakeApi([{ uid: "main", string: "Aliases:: a", top: true }]);
  const origQ = api.q;
  api.q = (query, ...args) => { const rows = origQ(query, ...args); api.strings.set("main", "Aliases:: a, fresh"); return rows; };
  const result = await addAliasToPage(api, { pageUid: "P", keyword: "Aliases", alias: "b" });
  assert.equal(result.after, "Aliases:: a, fresh, b");
  const failing = await addAliasToPage(fakeApi([{ uid: "main", string: "Aliases:: a", top: true }], { failWrite: true }), { pageUid: "P", keyword: "Aliases", alias: "b" });
  assert.deepEqual(failing, { ok: false, error: "boom" });
});

test("deleteAliasFromPage removes only the matching alias from the one block holding it", async () => {
  const api = fakeApi([{ uid: "a1", string: "Aliases:: x, y", top: true }, { uid: "a2", string: "Aliases:: Lori, lori", top: false }]);
  const result = await deleteAliasFromPage(api, { pageUid: "P", keyword: "Aliases", alias: "lori" });
  assert.deepEqual(result, { ok: true, blockUid: "a2", before: "Aliases:: Lori, lori", after: "Aliases:: Lori" });
  assert.deepEqual(api.log.update, [{ uid: "a2", string: "Aliases:: Lori" }]);
  assert.equal(api.strings.get("a1"), "Aliases:: x, y");
});

test("deleteAliasFromPage reports a missing alias without writing", async () => {
  const api = fakeApi([{ uid: "a1", string: "Aliases:: x", top: true }]);
  assert.deepEqual(await deleteAliasFromPage(api, { pageUid: "P", keyword: "Aliases", alias: "nope" }), { ok: false, error: "alias not found on the page" });
  assert.equal(api.log.update.length, 0);
  assert.equal((await deleteAliasFromPage(fakeApi([{ uid: "a1", string: "Aliases:: x", top: true }], { failWrite: true }), { pageUid: "P", keyword: "Aliases", alias: "x" })).error, "boom");
});

test("alias values live on the block's first line only", () => {
  assert.deepEqual(appendAlias("Aliases:: a\nnote", "Aliases", "c"), { string: "Aliases:: a, c\nnote", changed: true });
  assert.equal(appendAlias("Aliases::\nnote", "Aliases", "c").string, "Aliases:: c\nnote");
  assert.equal(appendAlias("Aliases:: a\nnote", "Aliases", "note").changed, true);
  assert.equal(removeAlias("Aliases:: a, b\nnote", "Aliases", "b"), "Aliases:: a\nnote");
  assert.equal(removeAlias("Aliases:: a, b\nnote", "Aliases", "note"), null);
});

test("validAlias rejects # right before text", () => {
  for (const a of ["#word", "  #word", "issue #42", "c#x", "a #b", "C#/F#"]) {
    assert.equal(validAlias(a).ok, false, a);
    assert.equal(validAlias(a).reason, "no # right before text: Roam reads it as a tag", a);
  }
  for (const a of ["C#", "C# lang", "F#", "a (b) c"]) assert.equal(validAlias(a).ok, true, a);
});
