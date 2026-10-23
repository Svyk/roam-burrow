// Sets an installed Burrow (e.g. svy's Depot URL install) aside in memory for a
// dev load or a gate run, and puts it back afterwards. Nothing persists, no
// window reload: the instance is made idle, its nodes and stylesheets are
// detached, and window.__BURROW is held in window.__burrowParked.
// Roam can have loaded the extension twice (svy ran two 0.5.0 instances on
// 2026-10-22, only one of them reachable as window.__BURROW), so every
// Burrow key and input listener on the window and the document is taken off
// for the run too, and put back as found.

// Burrow's own listeners: its guarded wrapper and the ref-search hotkey.
const BURROW_LISTENER = /debug\.lastFailure|setting\("refSearchHotkey"\)/;

// getEventListeners is DevTools' command-line API, so this runs with it.
async function listeners(c, expression) {
  const result = await c.call("Runtime.evaluate", { expression, includeCommandLineAPI: true, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(String(result.exceptionDetails.exception?.description || "listener call failed").slice(0, 500));
  return result.result.value;
}

async function detachListeners(c) {
  return listeners(c, `(() => {
    if (window.__burrowDetached) return window.__burrowDetached.length;
    const re = ${BURROW_LISTENER};
    const out = [];
    for (const target of [window, document]) {
      for (const [type, list] of Object.entries(getEventListeners(target))) {
        for (const l of list) if (re.test(String(l.listener))) out.push({ target, type, listener: l.listener, capture: l.useCapture, passive: l.passive });
      }
    }
    for (const l of out) l.target.removeEventListener(l.type, l.listener, l.capture);
    window.__burrowDetached = out;
    return out.length;
  })()`);
}

async function attachListeners(c) {
  return listeners(c, `(() => {
    const list = window.__burrowDetached || [];
    for (const l of list) l.target.addEventListener(l.type, l.listener, { capture: l.capture, passive: l.passive });
    window.__burrowDetached = null;
    return list.length;
  })()`);
}

export async function parkInstalled(c) {
  const parked = await parkState(c);
  if (parked.parked && !parked.already) parked.listeners = await detachListeners(c);
  return parked;
}

async function parkState(c) {
  return c.evaluate(() => {
    if (window.__burrowParked) return { parked: true, already: true, version: window.__burrowParked.inst.version };
    const inst = window.__BURROW;
    if (!inst) return { parked: false };
    if (window.__burrowDev?.module) return { parked: false, error: "a dev module is loaded; unload it first" };
    // Every Burrow evaluate bails while composing.
    Object.defineProperty(inst.state, "composing", { configurable: true, get: () => true, set: () => {} });
    const nodes = [...document.querySelectorAll(".burrow-strip, .burrow-preview, .burrow-hud, .burrow-scope, .burrow-hints, .burrow-tip, .burrow-help")]
      .map((node) => ({ node, parent: node.parentNode }));
    for (const { node } of nodes) node.remove();
    const sheets = [...document.styleSheets].filter((sheet) => {
      if (sheet.ownerNode?.id === "burrow-dev-css") return false;
      try {
        return [...sheet.cssRules].some((rule) => rule.selectorText?.includes(".burrow-"));
      } catch { return false; }
    });
    for (const sheet of sheets) sheet.disabled = true;
    window.__burrowParked = { inst, perf: window.__BURROW_PERF, nodes, sheets, live: window.__burrowLive ?? null };
    delete window.__BURROW;
    delete window.__BURROW_PERF;
    return { parked: true, version: inst.version, nodes: nodes.length, sheets: sheets.length };
  });
}

export async function unparkInstalled(c) {
  const restored = await unparkState(c);
  if (restored.restored) restored.listeners = await attachListeners(c);
  return restored;
}

async function unparkState(c) {
  return c.evaluate(() => {
    const p = window.__burrowParked;
    if (!p) return { restored: false };
    if (window.__burrowDev?.module) return { restored: false, error: "a dev module is loaded; unload it first" };
    delete p.inst.state.composing;
    p.inst.state.composing = false;
    // appendChild only: a recorded sibling can be detached by now.
    for (const { node, parent } of p.nodes) {
      if (!node.isConnected) (parent?.isConnected ? parent : document.body).appendChild(node);
    }
    for (const sheet of p.sheets) sheet.disabled = false;
    window.__BURROW = p.inst;
    window.__BURROW_PERF = p.perf;
    window.__burrowLive = p.live;
    window.__burrowParked = null;
    return { restored: true, version: p.inst.version, nodes: p.nodes.length };
  });
}
