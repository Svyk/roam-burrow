import { createIndexes } from "./indexes.js";
import { createLifecycle } from "./lifecycle.js";
import { createPerf } from "./perf.js";
import { createPickMemory } from "./picks.js";
import { createRefSearch } from "./refsearch.js";
import { createSettingsPanel, createSettingsReader, initializeSettings } from "./settings.js";
import { createStrip } from "./strip.js";

export const VERSION = "0.5.0";

let activeLifecycle = null;

const FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pickMemory", "pageBoost", "aliasInline", "aliasPreselect", "aliasChips", "tabDrill", "paneLayout", "keyHints", "rowPreview", "aliasCreate", "aliasDelete", "drillOrdinals", "drillEmpty", "drillCap", "refSearch", "refSearchHotkey", "helpTips", "helpSheet", "helpNudge"];

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

export async function onload({ extensionAPI, extension }) {
  if (!extensionAPI) throw new TypeError("Roam did not provide extensionAPI");
  if (activeLifecycle) await activeLifecycle.dispose();

  const lifecycle = createLifecycle();
  activeLifecycle = lifecycle;
  try {
    const api = globalThis.window?.roamAlphaAPI;
    const setting = createSettingsReader(extensionAPI);
    const perf = createPerf();
    await initializeSettings(extensionAPI);
    let indexes = null;
    let refSearch = null;
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
    if (api && globalThis.document) {
      indexes = createIndexes({ api, perf, setting, idle: idleScheduler(lifecycle), lifecycle, win: globalThis.window });
      const picks = createPickMemory({ storage: safeLocalStorage(), key: `burrow:picks:${api.graph?.name ?? "graph"}` });
      const strip = createStrip({ setting, indexes, perf, lifecycle, api, picks, saveSetting: (id, value) => extensionAPI.settings.set(id, value) });
      refSearch = createRefSearch({ api, lifecycle, setting });
      installPerfHud({ lifecycle, perf, setting });
      indexes.schedule();
      globalThis.window.__BURROW_PERF = perf;
      globalThis.window.__BURROW = { version: VERSION, state: strip.state, debug: strip.debug, indexes, tree: strip.tree, picks, refSearch };
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
