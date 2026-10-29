import assert from "node:assert/strict";
import test from "node:test";

import { helpGroups, helpKeyAction } from "../src/help.js";
import { DEFAULTS, createSettingsPanel } from "../src/settings.js";

const reader = (over = {}) => (id) => (id in over ? over[id] : DEFAULTS[id]);
const flat = (groups) => groups.flatMap((g) => g.items.map(([k, what]) => `${g.title}: ${k} ${what}`));
const notes = (groups) => groups.flatMap((g) => g.notes);

test("the key list groups Pick, Aliases, Drill, Preview with the defaults", () => {
  const groups = helpGroups(reader(), true);
  assert.deepEqual(groups.map((g) => g.title), ["Pick", "Aliases", "Drill", "Related", "Preview", "Filters"]);
  const lines = flat(groups);
  for (const want of ["Pick: ↵ insert", "Aliases: [[alias ↵ inserts [alias]([[Page]])", "Aliases: ⌥↓", "Drill: ⇥ or >", "Drill: ⇧⇥ or ⌫", "Drill: 1 (b) iii", "Drill: # >", "Related: ⌥R", "Preview: ⌃O"]) {
    assert.ok(lines.some((l) => l.startsWith(want)), `${want} in ${JSON.stringify(lines)}`);
  }
  // The two write switches are off by default: named, with where to turn them on.
  assert.ok(!lines.some((l) => l.includes("⌥A") || l.includes("⌥⌫")));
  assert.equal(notes(groups).join(" "), "Off, they write to your graph: ⌥A add (Create aliases), ⌥⌫ delete (Delete aliases). Settings → Burrow turns them on.");
});

test("keys of switches that are off are left out; the write keys appear once on", () => {
  const on = helpGroups(reader({ aliasCreate: true, aliasDelete: true, refSearchHotkey: true }), false);
  const lines = flat(on);
  assert.ok(lines.some((l) => l.startsWith("Aliases: Alt+A")));
  assert.ok(lines.some((l) => l.startsWith("Aliases: Alt+⌫")));
  assert.ok(lines.some((l) => l.startsWith("Pick: Alt+Shift+9")));
  assert.deepEqual(notes(on), []);
  const off = helpGroups(reader({ tabDrill: false, drill: false, refOutline: false, aliasChips: false, drillPreview: false, rowPreview: false, semanticRows: false, semanticRelated: false }), true);
  assert.deepEqual(off.map((g) => g.title), ["Pick", "Aliases", "Preview", "Filters"]);
  assert.ok(!flat(off).some((l) => l.includes("⌥↓") || l.includes("in a drill")));
  assert.match(flat(helpGroups(reader({ aliasLinkFormat: "[[Page]]" }), true)).join(" "), /\[\[alias ↵ inserts \[\[Page\]\]/);
});

test("Delete aliases on with Alias chips off: the key list says ⌥⌫ needs the chips", () => {
  const groups = helpGroups(reader({ aliasCreate: true, aliasDelete: true, aliasChips: false }), true);
  assert.ok(!flat(groups).some((l) => l.includes("⌥⌫")), "not listed as a key that works");
  assert.equal(notes(groups).join(" "), "⌥⌫ deletes the selected alias chip: turn on Alias chips (Settings → Burrow) to use it.");
  const noRows = helpGroups(reader({ aliasDelete: true, aliasPages: false }), true);
  assert.match(notes(noRows).join(" "), /turn on Alias rows in \[\[ and Alias chips/);
  assert.deepEqual(notes(helpGroups(reader({ aliasCreate: true, aliasDelete: true }), true)), [], "with the chips on there is nothing to say");
});

test("the outline key is listed with Up and down the outline on, and gone with it off", () => {
  assert.ok(flat(helpGroups(reader(), true)).some((l) => l.startsWith("Drill: ⇧⇥ on a block row")));
  assert.ok(!flat(helpGroups(reader({ refOutline: false }), true)).some((l) => l.startsWith("Drill: ⇧⇥ on a block row")));
});

test("with the key list open, Enter and Tab only close it, whatever the modifiers", () => {
  const key = (k, mods = {}) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });
  // The list covers the picker: no row under it may run (BRW-9).
  for (const k of ["Enter", "Tab"]) {
    for (const mods of [{}, { shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      assert.equal(helpKeyAction(key(k, mods)), "close", `${k} ${JSON.stringify(mods)}`);
    }
  }
  assert.equal(helpKeyAction(key("Escape")), "close");
  assert.equal(helpKeyAction(key("F1")), "close");
  assert.equal(helpKeyAction(key("÷", { altKey: true })), "close", "⌥/ on a Mac");
  for (const k of ["Shift", "Alt", "Meta", "Control", "CapsLock"]) assert.equal(helpKeyAction(key(k)), "keep", k);
  // Anything else closes the list and goes on: typing types, arrows move.
  for (const k of ["x", "ArrowDown", "ArrowUp", "Backspace"]) assert.equal(helpKeyAction(key(k)), "pass", k);
  assert.equal(helpKeyAction(key("Escape", { shiftKey: true })), "pass");
  const setting = createSettingsPanel().settings.find((s) => s.id === "helpSheet").description;
  assert.match(setting, /Enter or Tab only closes it/);
});
