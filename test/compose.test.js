import assert from "node:assert/strict";
import test from "node:test";

import { createPromptComposer, inserted } from "../src/compose.js";

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

function event(target, { cancelable = true, ...extra } = {}) {
  const e = { target, stopped: 0, prevented: 0, defaultPrevented: false, stopImmediatePropagation() { e.stopped++; }, preventDefault() { e.prevented++; if (cancelable) e.defaultPrevented = true; }, ...extra };
  return e;
}

const block = { value: "block", start: 3, end: 3 };
const withBlock = (p) => setup({ kind: "add", page: { title: "P" }, text: "zq", fresh: false, saving: false, error: null, block: { ...block }, ...p });

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

test("inserted() is what a change put in, by code points", () => {
  assert.equal(inserted("ab", "a🙂b"), "🙂");
  assert.equal(inserted("", "x"), "x");
  assert.equal(inserted("aa", "aaa"), "a");
  assert.equal(inserted("same", "same"), "");
  assert.equal(inserted("x🙂", "x🙂🙃"), "🙃");
});

test("insert() takes text typed without a key into the field and leaves the textarea alone", () => {
  const { composer, ta, prompt, log } = withBlock();
  const e = event(ta, { inputType: "insertText", data: "🙂" });
  assert.equal(composer.insert(e), true);
  assert.equal(e.stopped, 1);
  assert.equal(e.prevented, 1);
  assert.equal(prompt.text, "zq🙂");
  assert.equal(log.renders, 1);
  assert.equal(ta.value, "block");
  assert.deepEqual(log.set, []);
});

test("insert() replaces a fresh seeded text", () => {
  const { composer, ta, prompt } = withBlock({ text: "Page", fresh: true });
  composer.insert(event(ta, { inputType: "insertText", data: "é" }));
  assert.equal(prompt.text, "é");
  assert.equal(prompt.fresh, false);
});

test("insert() of a drop takes the first line and puts the caret back", () => {
  const { composer, ta, prompt, log } = withBlock();
  ta.selectionStart = ta.selectionEnd = 0;
  const e = event(ta, { inputType: "insertFromDrop", data: null, dataTransfer: { getData: () => "dropped\nsecond" } });
  assert.equal(composer.insert(e), true);
  assert.equal(prompt.text, "zqdropped");
  assert.deepEqual(log.carets.at(-1), [3, 3]);
});

test("insert() of a delete or an undo changes nothing", () => {
  for (const inputType of ["deleteContentBackward", "historyUndo"]) {
    const { composer, ta, prompt } = withBlock({ fresh: true });
    const e = event(ta, { inputType, data: null });
    assert.equal(composer.insert(e), true, inputType);
    assert.equal(e.prevented, 1, inputType);
    assert.equal(e.stopped, 1, inputType);
    assert.equal(prompt.text, "zq", inputType);
    assert.equal(prompt.fresh, true, inputType);
  }
});

test("insert() while saving stops the event and adds nothing", () => {
  const { composer, ta, prompt } = withBlock({ saving: true });
  const e = event(ta, { inputType: "insertText", data: "x" });
  assert.equal(composer.insert(e), true);
  assert.equal(e.prevented, 1);
  assert.equal(e.stopped, 1);
  assert.equal(prompt.text, "zq");
});

test("a beforeinput that cannot be cancelled is left to stray()", () => {
  const { composer, ta, prompt, log } = withBlock();
  const e = event(ta, { cancelable: false, inputType: "insertText", data: "🙂" });
  assert.equal(composer.insert(e), true);
  assert.equal(e.stopped, 1);
  assert.equal(prompt.text, "zq");
  ta.value = "bl🙂ock";
  ta.selectionStart = ta.selectionEnd = 5;
  const i = event(ta, { inputType: "insertText" });
  assert.equal(composer.stray(i), true);
  assert.equal(i.stopped, 1);
  assert.deepEqual(log.set, ["block"]);
  assert.deepEqual(log.carets.at(-1), [3, 3]);
  assert.equal(prompt.text, "zq🙂");
});

test("stray() takes an input that came with no beforeinput", () => {
  const { composer, ta, prompt, log } = withBlock();
  ta.value = "bl🙂ock";
  ta.selectionStart = ta.selectionEnd = 5;
  const e = event(ta, { inputType: "insertText" });
  assert.equal(composer.stray(e), true);
  assert.equal(e.stopped, 1);
  assert.equal(ta.value, "block");
  assert.deepEqual(log.set, ["block"]);
  assert.deepEqual(log.carets.at(-1), [3, 3]);
  assert.equal(prompt.text, "zq🙂");
});

test("stray() of an undo restores the textarea and leaves the text", () => {
  const { composer, ta, prompt, log } = withBlock();
  ta.value = "bloc";
  const e = event(ta, { inputType: "historyUndo" });
  assert.equal(composer.stray(e), true);
  assert.equal(ta.value, "block");
  assert.deepEqual(log.set, ["block"]);
  assert.equal(prompt.text, "zq");
});

test("insert() and stray() ignore a closed field, the delete confirm, another element and a composition", () => {
  const closed = withBlock();
  closed.close();
  const del = setup({ kind: "delete", text: "", block: { ...block } });
  const other = withBlock();
  const composing = withBlock({ compose: { value: "block", start: 3, end: 3, text: "" } });
  const cases = [
    [closed, closed.ta, {}],
    [del, del.ta, {}],
    [other, { value: "" }, {}],
    [composing, composing.ta, {}],
    [withBlock(), null, { isComposing: true }],
  ];
  for (const [s, target, extra] of cases) {
    for (const name of ["insert", "stray"]) {
      const e = event(target ?? s.ta, { inputType: "insertText", data: "x", ...extra });
      assert.equal(s.composer[name](e), false, name);
      assert.equal(e.stopped, 0, name);
      assert.equal(e.prevented, 0, name);
    }
    assert.equal(s.log.renders, 0);
  }
});

test("after start(), insert() returns false and input() takes the composition text", () => {
  const { composer, ta } = withBlock();
  composer.start(event(ta));
  assert.equal(composer.insert(event(ta, { inputType: "insertText", data: "x" })), false);
  assert.equal(composer.input(event(ta, { inputType: "insertCompositionText" })), true);
});
