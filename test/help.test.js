import assert from "node:assert/strict";
import test from "node:test";

import { helpGroups } from "../src/help.js";
import { DEFAULTS } from "../src/settings.js";

const reader = (over = {}) => (id) => (id in over ? over[id] : DEFAULTS[id]);
const flat = (groups) => groups.flatMap((g) => g.items.map(([k, what]) => `${g.title}: ${k} ${what}`));
const notes = (groups) => groups.flatMap((g) => g.notes);

test("the key list groups Pick, Aliases, Drill, Preview with the defaults", () => {
  const groups = helpGroups(reader(), true);
  assert.deepEqual(groups.map((g) => g.title), ["Pick", "Aliases", "Drill", "Preview"]);
  const lines = flat(groups);
  for (const want of ["Pick: ↵ insert", "Aliases: [[alias ↵ inserts [alias]([[Page]])", "Aliases: ⌥↓", "Drill: ⇥ or >", "Drill: ⇧⇥ or ⌫", "Drill: 1 (b) iii", "Drill: # >", "Preview: ⌃O"]) {
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
  const off = helpGroups(reader({ tabDrill: false, drill: false, aliasChips: false, drillPreview: false, rowPreview: false }), true);
  assert.deepEqual(off.map((g) => g.title), ["Pick", "Aliases", "Preview"]);
  assert.ok(!flat(off).some((l) => l.includes("⌥↓") || l.includes("in a drill")));
  assert.match(flat(helpGroups(reader({ aliasLinkFormat: "[[Page]]" }), true)).join(" "), /\[\[alias ↵ inserts \[\[Page\]\]/);
});
