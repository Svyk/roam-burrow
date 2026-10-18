#!/usr/bin/env node
// Inner-loop loader: injects the built extension.js/extension.css into a live
// Roam Desktop window over CDP and runs onload with an in-memory extensionAPI.
// Not an install path (that is the GitHub Pages URL). Nothing persists: a
// window reload drops it. Never reload the svy window (encrypted graph).
//   node tools/dev-load.mjs <window-title-prefix> [load|unload|status] [key=value ...]
import { readFile } from "node:fs/promises";
import { connect } from "./cdp.mjs";

const [title = "Readwisenotes", action = "load", ...pairs] = process.argv.slice(2);
const settings = Object.fromEntries(pairs.map((p) => {
  const [k, v] = p.split("=");
  return [k, v === "true" ? true : v === "false" ? false : v];
}));
const root = new URL("..", import.meta.url);
const c = await connect(title);
try {
  const result = await c.evaluate(async ({ action, code, css, settings }) => {
    const dev = window.__burrowDev || (window.__burrowDev = { values: {} });
    if (dev.module) {
      await dev.module.default.onunload();
      dev.module = null;
      document.getElementById("burrow-dev-css")?.remove();
    }
    if (action === "unload") return { unloaded: true, leftovers: document.querySelectorAll(".burrow-strip, .burrow-hud").length };
    if (action === "status") return { loaded: false };
    Object.assign(dev.values, settings);
    const style = document.createElement("style");
    style.id = "burrow-dev-css";
    style.textContent = css;
    document.head.append(style);
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    dev.module = await import(url);
    URL.revokeObjectURL(url);
    const extensionAPI = {
      settings: {
        canSet: true,
        get: (key) => (key in dev.values ? dev.values[key] : null),
        set: async (key, value) => { dev.values[key] = value; },
        getAll: () => ({ ...dev.values }),
        panel: { create: async () => null },
      },
      ui: { commandPalette: { addCommand: async () => null, removeCommand: async () => null } },
    };
    await dev.module.default.onload({ extensionAPI, extension: { version: "dev" } });
    const t0 = performance.now();
    while (!window.__BURROW?.indexes?.refs && performance.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 100));
    const perf = window.__BURROW_PERF;
    return {
      version: window.__BURROW?.version, settings: dev.values,
      refs: window.__BURROW?.indexes?.refs?.entries.length, aliases: window.__BURROW?.indexes?.aliases?.entries.length,
      buildQuery: perf?.samples.buildQuery, buildKeys: perf?.samples.buildKeys,
    };
  }, {
    action,
    code: await readFile(new URL("extension.js", root), "utf8"),
    css: await readFile(new URL("extension.css", root), "utf8"),
    settings,
  });
  console.log(JSON.stringify(result, null, 1));
} finally {
  c.close();
}
