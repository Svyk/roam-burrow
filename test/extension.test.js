import assert from "node:assert/strict";
import test from "node:test";

import extension from "../src/extension.js";
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

  assert.equal(api.calls.filter(([name]) => name === "command:add").length, 1);
  assert.equal(api.calls.filter(([name]) => name === "command:remove").length, 1);
  const sets = api.calls.filter(([name]) => name === "setting:set").map(([, key, value]) => [key, value]);
  assert.deepEqual(Object.fromEntries(sets), { ...DEFAULTS });
  assert.deepEqual(api.calls.filter(([name]) => name !== "setting:set").slice(0, 2), [
    ["panel:create", "Burrow"],
    ["command:add", "Burrow: Disable all features"],
  ]);
});

test("a second load disposes the previous runtime before registering again", async () => {
  const firstApi = fakeExtensionApi();
  const secondApi = fakeExtensionApi();

  await extension.onload({ extensionAPI: firstApi, extension: { version: "one" } });
  const cleanup = await extension.onload({ extensionAPI: secondApi, extension: { version: "two" } });

  assert.equal(firstApi.calls.filter(([name]) => name === "command:remove").length, 1);
  assert.equal(secondApi.calls.filter(([name]) => name === "command:add").length, 1);
  await cleanup();
});


test("every feature has its own switch in the settings panel", () => {
  const ids = createSettingsPanel().settings.filter((s) => s.action.type === "switch").map((s) => s.id);
  assert.deepEqual(ids.sort(), ["aliasChips", "aliasExpand", "aliasInline", "aliasPages", "aliasPreselect", "betterMatch", "drill", "drillPreview", "keyHints", "pageBoost", "paneLayout", "perfHud", "pickMemory", "refPreselect", "refRanking", "tabDrill"]);
  assert.equal(DEFAULTS.refPreselect, true);
  assert.equal(DEFAULTS.pickMemory, false);
});
