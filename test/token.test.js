import assert from "node:assert/strict";
import test from "node:test";

import { applyToken, findToken, tokenStillValid } from "../src/token.js";

test("finds the open (( or [[ token at the caret, with Roam's auto-paired closer", () => {
  const value = "x ((real time pcr)) tail";
  const token = findToken(value, 17);
  assert.deepEqual(token, { kind: "((", start: 2, end: 19, caret: 17, query: "real time pcr", closed: true });
  assert.equal(findToken("see [[mike", 10).kind, "[[");
  assert.equal(findToken("see [[mike", 10).end, 10);
});

test("no token outside syntax, after a closer, or across lines", () => {
  assert.equal(findToken("plain text", 5), null);
  assert.equal(findToken("[[done]] more", 13), null);
  assert.equal(findToken("((a\nb", 5), null);
  assert.equal(findToken("", 0), null);
});

test("the innermost opener wins", () => {
  assert.equal(findToken("[[a ((b", 7).kind, "((");
  assert.equal(findToken("((a [[b", 7).kind, "[[");
});

test("applyToken changes only the token span", () => {
  const value = "αβ ((real time pcr)) tail 🙂";
  const token = findToken(value, value.indexOf("))"));
  const next = applyToken(value, token, "((6ZtlGN-Np))");
  assert.equal(next, "αβ ((6ZtlGN-Np)) tail 🙂");
  assert.equal(next.slice(0, token.start), value.slice(0, token.start));
  assert.equal(next.slice(token.start + "((6ZtlGN-Np))".length), value.slice(token.end));
});

test("tokenStillValid refuses a moved caret, edited query, removed closer, or a selection", () => {
  const value = "x ((ant man))";
  const token = findToken(value, 11);
  assert.equal(tokenStillValid(value, 11, 11, token), true);
  assert.equal(tokenStillValid(value, 10, 10, token), false);
  assert.equal(tokenStillValid(value, 11, 12, token), false);
  assert.equal(tokenStillValid("x ((ant mam))", 11, 11, token), false);
  assert.equal(tokenStillValid("x ((ant man", 11, 11, token), false);
});
