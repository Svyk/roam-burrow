import assert from "node:assert/strict";
import test from "node:test";

import { createPromptComposer } from "../src/compose.js";

function setup(p = { kind: "add", page: { title: "P" }, text: "zq", fresh: false, saving: false, error: null }, { value = "block", caret = [3, 3] } = {}) {
  const log = { set: [], carets: [], renders: 0 };
  const ta = { value, selectionStart: caret[0], selectionEnd: caret[1], setSelectionRange(s, e) { log.carets.push([s, e]); this.selectionStart = s; this.selectionEnd = e; } };
  let current = p;
  const composer = createPromptComposer({
    prompt: () => current,
    textarea: () => ta,
    setValue: (el, v) => { el.value = v; log.set.push(v); },
    render: () => { log.renders++; },
  });
  return { composer, ta, log, prompt: p, close: () => { current = null; } };
}

function event(target, extra = {}) {
  const e = { target, stopped: 0, prevented: 0, stopImmediatePropagation() { e.stopped++; }, preventDefault() { e.prevented++; }, ...extra };
  return e;
}

test("compositionstart while the add field is open snapshots the textarea", () => {
  const { composer, ta, prompt, log } = setup();
  assert.equal(composer.start(event(ta)), true);
  assert.deepEqual(prompt.compose, { value: "block", start: 3, end: 3, text: "" });
  assert.equal(log.renders, 1);
});

test("an IME sequence ends up in the field and the textarea is restored", () => {
  const { composer, ta, prompt, log } = setup();
  composer.start(event(ta));
  const down = event(ta, { keyCode: 229, isComposing: true });
  assert.equal(composer.key(down), true);
  assert.equal(down.stopped, 1);
  assert.equal(down.prevented, 0);
  ta.value = "blockni";
  ta.selectionStart = ta.selectionEnd = 7;
  const input = event(ta);
  assert.equal(composer.input(input), true);
  assert.equal(input.stopped, 1);
  assert.equal(input.prevented, 0);
  assert.equal(composer.update(event(ta, { data: "ni" })), true);
  assert.equal(prompt.compose.text, "ni");
  assert.equal(composer.end(event(ta, { data: "你" })), true);
  assert.deepEqual(log.set, ["block"]);
  assert.equal(ta.value, "block");
  assert.deepEqual(log.carets.at(-1), [3, 3]);
  assert.equal(prompt.text, "zq你");
  assert.equal(prompt.compose, null);
});

test("a fresh seeded text is replaced by the composition", () => {
  const { composer, ta, prompt } = setup({ kind: "add", text: "Page", fresh: true });
  composer.start(event(ta));
  assert.equal(prompt.fresh, false);
  composer.end(event(ta, { data: "é" }));
  assert.equal(prompt.text, "é");
  assert.equal(prompt.fresh, false);
});

test("a dead key is stopped but not prevented", () => {
  const { composer, ta } = setup();
  const e = event(ta, { key: "Dead", keyCode: 69, isComposing: false });
  assert.equal(composer.key(e), true);
  assert.equal(e.stopped, 1);
  assert.equal(e.prevented, 0);
});

test("a cancelled composition changes nothing", () => {
  const { composer, ta, prompt } = setup();
  composer.start(event(ta));
  ta.value = "blockni";
  composer.end(event(ta, { data: "" }));
  assert.equal(prompt.text, "zq");
  assert.equal(ta.value, "block");
});

test("composed data keeps only its first line", () => {
  const { composer, ta, prompt } = setup();
  composer.start(event(ta));
  composer.update(event(ta, { data: "a\nb" }));
  assert.equal(prompt.compose.text, "a");
  composer.end(event(ta, { data: "x\r\ny" }));
  assert.equal(prompt.text, "zqx");
});

test("nothing is handled without an add field, for the delete confirm, or on another element", () => {
  const closed = setup();
  closed.close();
  const del = setup({ kind: "delete", text: "" });
  const other = setup();
  const cases = [
    [closed, closed.ta],
    [del, del.ta],
    [other, { value: "" }],
  ];
  for (const [s, target] of cases) {
    for (const name of ["start", "update", "end", "key", "input"]) {
      const e = event(target, { data: "x", key: "Dead", keyCode: 229, isComposing: true });
      assert.equal(s.composer[name](e), false, name);
      assert.equal(e.stopped, 0, name);
    }
    assert.equal(s.log.renders, 0);
  }
});

test("input, update and end before any start return false", () => {
  const { composer, ta, prompt } = setup();
  for (const name of ["input", "update", "end"]) {
    const e = event(ta, { data: "x" });
    assert.equal(composer[name](e), false, name);
    assert.equal(e.stopped, 0, name);
  }
  assert.equal(prompt.text, "zq");
});

test("restore mid-composition puts the snapshot back, and a second restore does nothing", () => {
  const { composer, ta, prompt, log } = setup();
  composer.start(event(ta));
  ta.value = "blockni";
  composer.restore(prompt, ta);
  assert.equal(ta.value, "block");
  assert.equal(prompt.compose, null);
  const sets = log.set.length;
  const carets = log.carets.length;
  composer.restore(prompt, ta);
  assert.equal(log.set.length, sets);
  assert.equal(log.carets.length, carets);
});
