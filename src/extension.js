import { createFrecency } from "./frecency.js";
import { createIndexes } from "./indexes.js";
import { createLifecycle } from "./lifecycle.js";
import { createPerf } from "./perf.js";
import { createRefSearch } from "./refsearch.js";
import { createSettingsPanel, createSettingsReader, initializeSettings } from "./settings.js";
import { createStrip } from "./strip.js";

export const VERSION = "0.9.1";

let activeLifecycle = null;

const FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "recentRows", "frecency", "pageBoost", "aliasInline", "aliasPreselect", "aliasChips", "aliasUsage", "aliasPrefix", "tabDrill", "paneLayout", "keyHints", "rowPreview", "aliasCreate", "aliasDelete", "drillOrdinals", "drillEmpty", "drillCap", "refSearch", "refSearchHotkey", "helpTips", "helpSheet", "helpNudge", "refContext", "refOutline"];

function safeLocalStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function idleScheduler(lifecycle) {
  let pending = null;
  lifecycle.add(() => { if (pending) pending.cancel(); });
  return (callback) => {
    const run = () => { pending = null; if (!lifecycle.disposed) callback(); };
    if (typeof globalThis.requestIdleCallback === "function") {
      const id = globalThis.requestIdleCallback(run, { timeout: 4000 });
      pending = { cancel: () => globalThis.cancelIdleCallback(id) };
    } else {
      const id = globalThis.setTimeout(run, 50);
      pending = { cancel: () => globalThis.clearTimeout(id) };
    }
  };
}

function installPerfHud({ lifecycle, perf, setting }) {
  const hud = document.createElement("div");
  hud.className = "burrow-hud";
  hud.hidden = true;
  lifecycle.node(hud, document.body);
  const fmt = (v) => (v == null ? "–" : v.toFixed(1));
  lifecycle.interval(() => {
    hud.hidden = !setting("perfHud");
    if (hud.hidden) return;
    const s = perf.summary("input");
    hud.textContent = `burrow ${s.n} keys · p50 ${fmt(s.p50)} ms · p95 ${fmt(s.p95)} ms`;
  }, 1000);
}

// The live instance, kept on the window: Roam can load the extension a
// second time without unloading the first (svy ran two 0.5.0 instances side
// by side, each drawing rows and taking keys), and a module-level variable
// does not reach across module instances. A new load disposes the old one,
// unless the dev tools have parked it on purpose (tools/installed.mjs).
const LIVE = "__burrowLive";

async function disposePrevious() {
  const win = globalThis.window;
  const prior = win?.[LIVE];
  if (!prior || win.__burrowParked) return;
  win[LIVE] = null;
  try { await prior.dispose(); } catch (error) { console.error("[burrow] could not unload the previous instance", error); }
}

export async function onload({ extensionAPI, extension }) {
  if (!extensionAPI) throw new TypeError("Roam did not provide extensionAPI");
  if (activeLifecycle) await activeLifecycle.dispose();
  await disposePrevious();

  const lifecycle = createLifecycle();
  activeLifecycle = lifecycle;
  if (globalThis.window) {
    globalThis.window[LIVE] = lifecycle;
    lifecycle.add(() => { if (globalThis.window[LIVE] === lifecycle) globalThis.window[LIVE] = null; });
  }
  try {
    const api = globalThis.window?.roamAlphaAPI;
    const setting = createSettingsReader(extensionAPI);
    const perf = createPerf();
    await initializeSettings(extensionAPI);
    let indexes = null;
    let refSearch = null;
    let frecency = null;
    let strip = null;
    let added = false;
    const commandApi = extensionAPI.ui.commandPalette;
    const refLabel = "Burrow: block reference search";
    const syncRefCommand = async (on = setting("refSearch")) => {
      if (lifecycle.disposed) return;
      if (on && !added) {
        added = true;
        await commandApi.addCommand({ label: refLabel, callback: () => refSearch?.open() });
      } else if (!on && added) {
        added = false;
        await commandApi.removeCommand({ label: refLabel });
      }
    };
    await lifecycle.settingsPanel(extensionAPI, createSettingsPanel({
      onChange: (id, event) => {
        if (id === "aliasKeyword") indexes?.schedule();
        if (id === "aliasUsage") {
          const on = typeof event === "boolean" ? event : event?.target?.checked;
          if (on !== false && indexes && !indexes.usesRead) indexes.schedule();
        }
        if (id !== "refSearch") return;
        const value = typeof event === "boolean" ? event : event?.target?.checked;
        if (typeof value === "boolean") void syncRefCommand(value);
        else lifecycle.timeout(() => { void syncRefCommand(); }, 0);
      },
    }));
    lifecycle.add(async () => {
      if (added) { added = false; await commandApi.removeCommand({ label: refLabel }); }
    });
    await syncRefCommand();
    // Clears this graph's pick history, stored and in memory.
    const forgetPicks = () => { frecency?.clear(); strip?.forget(); };
    if (api && globalThis.document) {
      indexes = createIndexes({ api, perf, setting, idle: idleScheduler(lifecycle), lifecycle, win: globalThis.window });
      const graph = api.graph?.name ?? "graph";
      frecency = createFrecency({ storage: safeLocalStorage(), key: `burrow:frecency:${graph}`, legacyKey: `burrow:picks:${graph}` });
      frecency.load();
      strip = createStrip({ setting, indexes, perf, lifecycle, api, frecency, saveSetting: (id, value) => extensionAPI.settings.set(id, value) });
      refSearch = createRefSearch({ api, lifecycle, setting });
      installPerfHud({ lifecycle, perf, setting });
      indexes.schedule();
      globalThis.window.__BURROW_PERF = perf;
      globalThis.window.__BURROW = { version: VERSION, state: strip.state, debug: strip.debug, indexes, tree: strip.tree, frecency, forgetPicks, refSearch };
      lifecycle.add(() => {
        delete globalThis.window.__BURROW_PERF;
        delete globalThis.window.__BURROW;
      });
    }
    await lifecycle.command(extensionAPI.ui.commandPalette, {
      label: "Burrow: Disable all features",
      callback: async () => {
        for (const id of FEATURES) {
          await extensionAPI.settings.set(id, false);
        }
        await syncRefCommand();
      },
    });
    await lifecycle.command(extensionAPI.ui.commandPalette, { label: "Burrow: forget recent picks", callback: forgetPicks });
    console.info(`[burrow] Loaded v${extension?.version || VERSION}`);
  } catch (error) {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose().catch((cleanupError) => console.error(cleanupError));
    throw error;
  }

  // Roam invokes this cleanup immediately before onunload.
  return async () => {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose();
  };
}

export async function onunload() {
  const lifecycle = activeLifecycle;
  activeLifecycle = null;
  if (lifecycle) await lifecycle.dispose();
  console.info("[burrow] Unloaded");
}

export default { onload, onunload };
