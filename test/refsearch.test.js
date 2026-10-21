import assert from "node:assert/strict";
import test from "node:test";

import { insertOpener, isRefSearchHotkey, parseInputId } from "../src/refsearch.js";

test("insertOpener puts (()) at the caret and leaves the caret inside", () => {
  assert.deepEqual(insertOpener("hello world", 5), { value: "hello(()) world", caret: 7 });
  assert.deepEqual(insertOpener("", 0), { value: "(())", caret: 2 });
  assert.deepEqual(insertOpener("abc", 3), { value: "abc(())", caret: 5 });
});

test("parseInputId reads the window and the 9-char uid, uids may hold - and _", () => {
  assert.deepEqual(parseInputId("block-input-main-window-AbCdEfGhI"), { windowId: "main-window", uid: "AbCdEfGhI" });
  assert.deepEqual(parseInputId("block-input-win1-a-b_c-d_e"), { windowId: "win1", uid: "a-b_c-d_e" });
  assert.deepEqual(parseInputId("block-input-sidebar-_-_-_-_-_"), { windowId: "sidebar", uid: "_-_-_-_-_" });
  assert.equal(parseInputId("block-input-main-short"), null);
  assert.equal(parseInputId("something-else"), null);
  assert.equal(parseInputId(undefined), null);
});

test("isRefSearchHotkey wants Alt+Shift+9 and nothing more", () => {
  const ev = (extra) => ({ code: "Digit9", altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, ...extra });
  assert.equal(isRefSearchHotkey(ev()), true);
  assert.equal(isRefSearchHotkey(ev({ ctrlKey: true })), false);
  assert.equal(isRefSearchHotkey(ev({ metaKey: true })), false);
  assert.equal(isRefSearchHotkey(ev({ shiftKey: false })), false);
  assert.equal(isRefSearchHotkey(ev({ altKey: false })), false);
  assert.equal(isRefSearchHotkey(ev({ code: "Digit8" })), false);
});
