import assert from "node:assert/strict";
import test from "node:test";

import { ordinalQuery, startsWithOrdinal } from "../src/ordinal.js";

test("ordinalQuery reads numbers, letters and roman numerals, with optional marks", () => {
  for (const [q, token] of [["1", "1"], ["2.", "2"], ["(b)", "b"], ["b)", "b"], ["(b", "b"], ["iii", "iii"], ["(iv)", "iv"], [" XII ", "xii"], ["i", "i"], ["123", "123"], ["B", "b"]]) {
    assert.equal(ordinalQuery(q), token, q);
  }
});

test("ordinalQuery rejects words, other letter pairs, mixed tokens and empties", () => {
  for (const q of ["mix", "dim", "civil", "ab", "1a", "", "  ", "1234", "xl", "((", null, undefined, "1.5"]) {
    assert.equal(ordinalQuery(q), null, String(q));
  }
});

test("startsWithOrdinal accepts parentheses and the . ) : forms", () => {
  assert.ok(startsWithOrdinal("(b) cool", "b"));
  assert.ok(startsWithOrdinal("(1) x", "1"));
  assert.ok(startsWithOrdinal("(iii) y", "iii"));
  assert.ok(startsWithOrdinal("  2. bake", "2"));
  assert.ok(startsWithOrdinal("B) later", "b"));
  assert.ok(startsWithOrdinal("iii. serve", "iii"));
  assert.ok(startsWithOrdinal("1: x", "1"));
  assert.ok(startsWithOrdinal("2.", "2"));
});

test("digits also match a bare number, but never a longer number or a decimal", () => {
  assert.ok(startsWithOrdinal("1 cup flour", "1"));
  assert.ok(startsWithOrdinal("2", "2"));
  assert.equal(startsWithOrdinal("10. x", "1"), false);
  assert.equal(startsWithOrdinal("1.5 cups", "1"), false);
  assert.equal(startsWithOrdinal("12 eggs", "1"), false);
});

test("letters and roman numerals need the dot, paren or colon", () => {
  assert.equal(startsWithOrdinal("b something", "b"), false);
  assert.equal(startsWithOrdinal("iii something", "iii"), false);
  assert.equal(startsWithOrdinal("bake", "b"), false);
  assert.equal(startsWithOrdinal("intro mentions 2 things", "2"), false);
  assert.equal(startsWithOrdinal("x", null), false);
});
