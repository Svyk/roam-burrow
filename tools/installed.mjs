// Sets an installed Burrow (e.g. svy's Depot URL install) aside in memory for a
// dev load or a gate run, and puts it back afterwards. Nothing persists, no
// window reload: the instance is made idle, its nodes and stylesheets are
// detached, and window.__BURROW is held in window.__burrowParked.

export async function parkInstalled(c) {
  return c.evaluate(() => {
    if (window.__burrowParked) return { parked: true, already: true, version: window.__burrowParked.inst.version };
    const inst = window.__BURROW;
    if (!inst) return { parked: false };
    if (window.__burrowDev?.module) return { parked: false, error: "a dev module is loaded; unload it first" };
    // Every Burrow evaluate bails while composing.
    Object.defineProperty(inst.state, "composing", { configurable: true, get: () => true, set: () => {} });
    const nodes = [...document.querySelectorAll(".burrow-strip, .burrow-preview, .burrow-hud, .burrow-scope")]
      .map((node) => ({ node, parent: node.parentNode }));
    for (const { node } of nodes) node.remove();
    const sheets = [...document.styleSheets].filter((sheet) => {
      if (sheet.ownerNode?.id === "burrow-dev-css") return false;
      try {
        return [...sheet.cssRules].some((rule) => rule.selectorText?.includes(".burrow-"));
      } catch { return false; }
    });
    for (const sheet of sheets) sheet.disabled = true;
    window.__burrowParked = { inst, perf: window.__BURROW_PERF, nodes, sheets };
    delete window.__BURROW;
    delete window.__BURROW_PERF;
    return { parked: true, version: inst.version, nodes: nodes.length, sheets: sheets.length };
  });
}

export async function unparkInstalled(c) {
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
    window.__burrowParked = null;
    return { restored: true, version: p.inst.version, nodes: p.nodes.length };
  });
}
