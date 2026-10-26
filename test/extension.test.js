import assert from "node:assert/strict";
import test from "node:test";

import extension, { VERSION } from "../src/extension.js";
import { DEFAULTS, createSettingsPanel } from "../src/settings.js";

function fakeExtensionApi() {
  const values = new Map();
  const calls = [];
  return {
    calls,
    settings: {
      canSet: true,
      get: (key) => values.get(key) ?? null,
      set: async (key, value) => { values.set(key, value); calls.push(["setting:set", key, value]); return null; },
      panel: {
        create: async (config) => { calls.push(["panel:create", config.tabTitle]); return null; },
      },
    },
    ui: {
      commandPalette: {
        addCommand: async ({ label }) => { calls.push(["command:add", label]); return null; },
        removeCommand: async ({ label }) => { calls.push(["command:remove", label]); return null; },
      },
    },
  };
}

test("extension exports the Roam lifecycle contract and survives repeated unload", async () => {
  assert.equal(typeof extension.onload, "function");
  assert.equal(typeof extension.onunload, "function");

  const api = fakeExtensionApi();
  const cleanup = await extension.onload({ extensionAPI: api, extension: { version: "test" } });
  assert.equal(typeof cleanup, "function");
  await cleanup();
  await extension.onunload();
  await extension.onunload();

  assert.equal(api.calls.filter(([name]) => name === "command:add").length, 2);
  assert.equal(api.calls.filter(([name]) => name === "command:remove").length, 2);
  const sets = api.calls.filter(([name]) => name === "setting:set").map(([, key, value]) => [key, value]);
  assert.deepEqual(Object.fromEntries(sets), { ...DEFAULTS });
  assert.deepEqual(api.calls.filter(([name]) => name !== "setting:set").slice(0, 3), [
    ["panel:create", "Burrow"],
    ["command:add", "Burrow: block reference search"],
    ["command:add", "Burrow: Disable all features"],
  ]);
});

test("a second load disposes the previous runtime before registering again", async () => {
  const firstApi = fakeExtensionApi();
  const secondApi = fakeExtensionApi();

  await extension.onload({ extensionAPI: firstApi, extension: { version: "one" } });
  const cleanup = await extension.onload({ extensionAPI: secondApi, extension: { version: "two" } });

  assert.equal(firstApi.calls.filter(([name]) => name === "command:remove").length, 2);
  assert.equal(secondApi.calls.filter(([name]) => name === "command:add").length, 2);
  await cleanup();
});


test("every feature has its own switch in the settings panel", () => {
  const ids = createSettingsPanel().settings.filter((s) => s.action.type === "switch").map((s) => s.id);
  assert.deepEqual(ids.sort(), ["aliasChips", "aliasExpand", "aliasInline", "aliasPages", "aliasPreselect", "betterMatch", "drill", "drillPreview", "aliasCreate", "aliasDelete", "drillCap", "drillEmpty", "drillOrdinals", "helpNudge", "helpSheet", "helpTips", "keyHints", "pageBoost", "paneLayout", "perfHud", "pickMemory", "refContext", "refOutline", "refPreselect", "refRanking", "refSearch", "refSearchHotkey", "rowPreview", "tabDrill"].sort());
  assert.equal(DEFAULTS.refPreselect, true);
  assert.equal(DEFAULTS.pickMemory, false);
});

test("0.6.1 defaults: writes and the hotkey are off, the help and block navigation switches on, the tip not yet seen", () => {
  assert.equal(VERSION, "0.6.1");
  for (const id of ["rowPreview", "drillOrdinals", "drillEmpty", "drillCap", "refSearch", "helpTips", "helpSheet", "helpNudge", "refContext", "refOutline"]) assert.equal(DEFAULTS[id], true, id);
  for (const id of ["aliasCreate", "aliasDelete", "refSearchHotkey", "helpNudgeSeen"]) assert.equal(DEFAULTS[id], false, id);
  // The seen flag is stored, not shown as a switch.
  assert.equal(createSettingsPanel().settings.some((s) => s.id === "helpNudgeSeen"), false);
});

test("the block reference search command exists only while refSearch is on", async () => {
  const on = fakeExtensionApi();
  const offCleanup = await extension.onload({ extensionAPI: on, extension: { version: "t" } });
  assert.ok(on.calls.some((c) => c[0] === "command:add" && c[1] === "Burrow: block reference search"));
  await offCleanup();

  const off = fakeExtensionApi();
  off.settings.set("refSearch", false);
  await off.settings.get && null;
  const values = new Map([["refSearch", false]]);
  off.settings.get = (key) => values.get(key) ?? null;
  off.settings.set = async (key, value) => { values.set(key, value); off.calls.push(["setting:set", key, value]); return null; };
  const cleanup = await extension.onload({ extensionAPI: off, extension: { version: "t" } });
  assert.equal(off.calls.some((c) => c[0] === "command:add" && c[1] === "Burrow: block reference search"), false);
  await cleanup();
  assert.equal(off.calls.some((c) => c[0] === "command:remove" && c[1] === "Burrow: block reference search"), false);
});
