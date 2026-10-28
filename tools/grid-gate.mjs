#!/usr/bin/env node
// Roam Grid keyboard ownership next to Burrow's table preview (BRW-20), on a
// live Roam Desktop window over CDP (:9223). svy only (the graph with Roam Grid
// tables). Loads the build with every switch on and checks, in order:
//   1. an enhanced Roam Grid table (default: the first native one named in the
//      roam/grid/metadata blocks, preferring page "test sandbox") is read:
//      its page, subtree and metadata strings are the BEFORE state;
//   2. it is open in the right sidebar and Roam Grid draws .rg-cell elements;
//   3. grid keys work: a click on a body cell makes it active, ArrowRight moves
//      one cell right, ArrowDown one down, then Escape leaves edit mode;
//   4. a Burrow popup resolving to that table draws .burrow-table, Escape
//      closes the popup, the fixture block goes back to "";
//   5. the same grid keys work again with the popup closed;
//   6. AFTER equals BEFORE byte for byte and no page was left behind.
// Step 4 reaches the table through the Tab list ([[Page, Tab, ↓ and Tab down
// its ancestors, ↓ onto the table): a drill step cannot name a table with
// text siblings, since stripRoamMarkup drops the {{[[table]]}} macro. The gate
// accepts the run only when the Tab list's highlighted block is the table.
// No graph writes except the fixture's own scratch page and block. The window is
// never reloaded; an installed Burrow is parked for the run and put back.
//   node tools/grid-gate.mjs "Svy -" [--table <uid>]
import { readFile } from "node:fs/promises";
import { connect, sleep } from "./cdp.mjs";
import { parkInstalled, unparkInstalled } from "./installed.mjs";
import { clearSelection, cleanupFixture, deleteNewPages, guardReport, neutralClick, onAbort, primeFixture, setupFixture, snapshotTitles } from "./fixture.mjs";

const FEATURES = ["aliasPages", "aliasExpand", "refRanking", "refPreselect", "betterMatch", "drill", "drillPreview", "pageBoost",
  "aliasInline", "aliasPreselect", "aliasChips", "tabDrill", "paneLayout", "keyHints",
  "rowPreview", "aliasCreate", "aliasDelete", "drillOrdinals", "drillEmpty", "drillCap", "refSearch", "refSearchHotkey",
  "helpTips", "helpSheet", "helpNudge", "refProse", "richRows", "recentRows", "frecency", "queryFilters", "previewTables", "semanticRelated"];
const REF_COMMAND = "Burrow: block reference search";
const METADATA_PAGE = "roam/grid/metadata";
const TYPE_MS = 35;

const [title, ...flags] = process.argv.slice(2);
if (!title) throw new Error('usage: grid-gate.mjs "Svy -" [--table <uid>]');
const flagValue = (name) => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : null; };
const wanted = flagValue("--table");
const root = new URL("..", import.meta.url);
const c = await connect(title);

const steps = [];
const step = (name, pass, detail) => steps.push({ name, pass: Boolean(pass), detail });

async function setArm(arm) {
  const code = await readFile(new URL("extension.js", root), "utf8");
  const css = await readFile(new URL("extension.css", root), "utf8");
  return c.evaluate(async ({ arm, code, css, features, refCommand }) => {
    const dev = window.__burrowDev || (window.__burrowDev = { values: {} });
    if (arm === "gone") {
      if (dev.module) await dev.module.default.onunload();
      dev.module = null;
      document.getElementById("burrow-dev-css")?.remove();
      return { arm };
    }
    for (const f of features) dev.values[f] = true;
    dev.values.helpNudgeSeen = true;
    if (!dev.module) {
      const style = document.createElement("style");
      style.id = "burrow-dev-css";
      style.textContent = css;
      document.head.append(style);
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      dev.module = await import(url);
      URL.revokeObjectURL(url);
      const extensionAPI = {
        settings: {
          canSet: true, get: (k) => (k in dev.values ? dev.values[k] : null),
          set: async (k, v) => { dev.values[k] = v; }, panel: { create: async () => null },
        },
        ui: {
          commandPalette: {
            addCommand: async (cmd) => (cmd?.label === refCommand ? window.roamAlphaAPI.ui.commandPalette.addCommand(cmd) : null),
            removeCommand: async (cmd) => (cmd?.label === refCommand ? window.roamAlphaAPI.ui.commandPalette.removeCommand(cmd) : null),
          },
        },
      };
      await dev.module.default.onload({ extensionAPI, extension: { version: "gate" } });
    }
    const t0 = performance.now();
    while (!window.__BURROW?.indexes?.refs && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 100));
    return { arm, refs: window.__BURROW?.indexes?.refs?.entries.length };
  }, { arm, code, css, features: FEATURES, refCommand: REF_COMMAND });
}

// ---- reads (no writes) ----

// Native tables named by the metadata blocks whose block still holds {{[[table]]}}.
const findTables = () => c.evaluate(({ metadataPage }) => {
  const api = window.roamAlphaAPI;
  const isTable = (uid) => api.q(`[:find ?s . :where [?b :block/uid "${uid}"] [?b :block/string ?s]]`) === "{{[[table]]}}";
  const strings = (uid) => api.q(`[:find [?s ...] :where [?b :block/uid "${uid}"] [?b :block/string ?s]]`) || [];
  const blocks = api.q(`[:find ?u ?s :where [?p :node/title ${JSON.stringify(metadataPage)}] [?b :block/page ?p] [?b :block/uid ?u] [?b :block/string ?s]]`) || [];
  const out = new Map();
  for (const [uid, string] of blocks) {
    if (!/"mode"\s*:\s*"native"/.test(string)) continue;
    const near = [string];
    const parent = api.q(`[:find ?pu . :where [?b :block/uid "${uid}"] [?p :block/children ?b] [?p :block/uid ?pu]]`);
    if (parent) near.push(...strings(parent), parent);
    for (const k of api.q(`[:find [?ku ...] :where [?b :block/uid "${uid}"] [?b :block/children ?k] [?k :block/uid ?ku]]`) || []) near.push(...strings(k));
    const candidates = new Set();
    for (const text of near) for (const m of String(text).matchAll(/"([A-Za-z0-9_-]{9})"/g)) candidates.add(m[1]);
    candidates.add(parent);
    for (const cand of candidates) if (cand && isTable(cand) && !out.has(cand)) out.set(cand, uid);
  }
  return [...out.keys()].map((uid) => ({
    uid, metadataUid: out.get(uid),
    page: api.q(`[:find ?t . :where [?b :block/uid "${uid}"] [?b :block/page ?p] [?p :node/title ?t]]`),
  }));
}, { metadataPage: METADATA_PAGE });

// The table's page, its subtree (uid / string / order, children sorted) and the metadata strings: BEFORE / AFTER.
const readState = (uid, metadataUids) => c.evaluate(({ uid, metadataUids }) => {
  const api = window.roamAlphaAPI;
  const norm = (n) => ({
    uid: n[":block/uid"], string: n[":block/string"] ?? null, order: n[":block/order"] ?? null,
    children: (n[":block/children"] || []).slice().sort((a, b) => a[":block/order"] - b[":block/order"]).map(norm),
  });
  const pulled = api.pull("[:block/uid :block/string :block/order {:block/children ...}]", [":block/uid", uid]);
  return {
    page: api.q(`[:find ?t . :where [?b :block/uid "${uid}"] [?b :block/page ?p] [?p :node/title ?t]]`),
    subtree: pulled ? JSON.stringify(norm(pulled)) : null,
    metadata: JSON.stringify(metadataUids.map((m) => [m, api.q(`[:find ?s . :where [?b :block/uid "${m}"] [?b :block/string ?s]]`)])),
  };
}, { uid, metadataUids });

// ---- Roam Grid keys ----

// The active cell's identity: position among the window's .rg-cell elements (distinct row tops and column lefts), text and data-* attributes.
const activeCell = () => c.evaluate(() => {
  const side = document.getElementById("roam-right-sidebar-content") || document;
  const cells = [...side.querySelectorAll(".rg-cell")];
  const shown = cells.filter((n) => n.getClientRects().length);
  const keys = (list, f) => [...new Set(list.map((n) => Math.round(f(n.getBoundingClientRect()))))].sort((a, b) => a - b);
  const tops = keys(shown, (r) => r.top);
  const lefts = keys(shown, (r) => r.left);
  const ident = (n) => {
    const r = n.getBoundingClientRect();
    return {
      row: tops.indexOf(Math.round(r.top)), col: lefts.indexOf(Math.round(r.left)), text: n.textContent,
      data: Object.fromEntries([...n.attributes].filter((a) => a.name.startsWith("data-")).map((a) => [a.name, a.value])),
    };
  };
  const active = shown.filter((n) => n.classList.contains("rg-cell--active"));
  return {
    cells: cells.length, rows: tops.length, cols: lefts.length,
    active: active.map(ident),
    editing: document.activeElement?.tagName === "TEXTAREA" || document.activeElement?.tagName === "INPUT" ? document.activeElement.tagName : null,
  };
});

// Centre of the body cell at (row, col), in viewport pixels.
const cellPoint = (row, col) => c.evaluate(({ row, col }) => {
  const side = document.getElementById("roam-right-sidebar-content") || document;
  const shown = [...side.querySelectorAll(".rg-cell")].filter((n) => n.getClientRects().length);
  const keys = (f) => [...new Set(shown.map((n) => Math.round(f(n.getBoundingClientRect()))))].sort((a, b) => a - b);
  const tops = keys((r) => r.top);
  const lefts = keys((r) => r.left);
  const cell = shown.find((n) => {
    const r = n.getBoundingClientRect();
    return tops.indexOf(Math.round(r.top)) === row && lefts.indexOf(Math.round(r.left)) === col && !/head/i.test(n.className);
  });
  if (!cell) return null;
  cell.scrollIntoView({ block: "nearest" });
  const r = cell.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { row, col });

const same = (a, b) => a && b && a.row === b.row && a.col === b.col && a.text === b.text && JSON.stringify(a.data) === JSON.stringify(b.data);
const show = (a) => (a ? `r${a.row}c${a.col} ${JSON.stringify(a.text)}${Object.keys(a.data).length ? ` ${JSON.stringify(a.data)}` : ""}` : "none");

async function gridKeys(label) {
  await c.evaluate(() => { const g = window.__burrowFixture; if (g) g.guard.armed = false; });
  const notes = [];
  try {
    const before = await activeCell();
    if (!before.cells) return step(`${label}: Roam Grid keys`, false, "no .rg-cell in the sidebar");
    if (before.rows < 3 || before.cols < 3) return step(`${label}: Roam Grid keys`, false, `grid too small: ${before.rows} rows x ${before.cols} cols`);
    const point = await cellPoint(1, 1);
    if (!point) return step(`${label}: Roam Grid keys`, false, "no body cell at row 1 col 1");
    // Approach from a few px away, as a hand would.
    await c.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x - 6, y: point.y - 4 });
    await sleep(60);
    await c.click(point.x, point.y);
    await sleep(250);
    const clicked = await activeCell();
    const a0 = clicked.active[0];
    await c.key("ArrowRight");
    await sleep(250);
    const right = await activeCell();
    const a1 = right.active[0];
    await c.key("ArrowDown");
    await sleep(250);
    const down = await activeCell();
    const a2 = down.active[0];
    for (let i = 0; i < 2; i++) { await c.key("Escape"); await sleep(150); }
    const end = await activeCell();
    const ok = clicked.active.length === 1 && a0.row === 1 && a0.col === 1
      && right.active.length === 1 && a1.row === 1 && a1.col === 2 && !same(a0, a1)
      && down.active.length === 1 && a2.row === 2 && a2.col === 2 && !same(a1, a2)
      && !end.editing;
    notes.push(`click ${show(a0)}; ArrowRight ${show(a1)}; ArrowDown ${show(a2)}; after Escape x2 ${end.editing ? `editing in ${end.editing}` : "not editing"}, active ${end.active.map(show).join(", ") || "none"}`);
    step(`${label}: Roam Grid keys`, ok, notes.join("; "));
  } finally {
    await c.evaluate(() => { const g = window.__burrowFixture; if (g) g.guard.armed = true; });
    await guardReport(c);
  }
}

// ---- run ----

const ctrlO = async () => {
  const base = { key: "o", code: "KeyO", windowsVirtualKeyCode: 79, nativeVirtualKeyCode: 79, modifiers: 2 };
  await c.call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await c.call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(300);
};
const isExpanded = () => c.evaluate(() => Boolean(document.querySelector(".rm-autocomplete__results--expanded")));

let table = null;
let addedWindow = false;
let cleaning = null;
const cleanup = () => (cleaning ||= (async () => {
  try {
    await c.evaluate(() => { const g = window.__burrowFixture; if (g) g.guard.armed = false; }).catch(() => {});
    await setArm("gone");
    if (addedWindow && table) {
      await c.evaluate(async (uid) => {
        try { await window.roamAlphaAPI.ui.rightSidebar.removeWindow({ window: { type: "block", "block-uid": uid } }); } catch { /* already gone */ }
      }, table.uid);
    }
    await cleanupFixture(c);
  } catch (error) {
    console.error("cleanup:", error);
  } finally {
    try {
      await unparkInstalled(c);
    } catch (error) {
      console.error("cleanup:", error);
    }
    c.close();
  }
})());
onAbort(cleanup);

await c.evaluate(async () => {
  const dev = window.__burrowDev;
  if (dev?.module) { await dev.module.default.onunload(); dev.module = null; }
  document.getElementById("burrow-dev-css")?.remove();
});
const installed = await parkInstalled(c);
if (installed.error) throw new Error(installed.error);
let preview = null;
try {
  await setArm("gone");
  await setupFixture(c);
  await snapshotTitles(c);
  const loaded = await setArm("on");
  if (!loaded.refs) throw new Error("index not built");

  // 1. the table and its BEFORE state
  const tables = await findTables();
  const chosen = wanted
    ? { uid: wanted, metadataUid: tables.find((t) => t.uid === wanted)?.metadataUid ?? null, page: null }
    : tables.find((t) => /^test sandbox$/i.test(t.page || "")) ?? tables[0];
  if (!chosen) {
    step("1 find an enhanced table", false, `no native Roam Grid table on ${METADATA_PAGE} (${tables.length} candidate(s))`);
  } else {
    table = chosen;
    const metadataUids = [...new Set(tables.filter((t) => t.uid === chosen.uid).map((t) => t.metadataUid).filter(Boolean))];
    const before = await readState(chosen.uid, metadataUids);
    const isTable = before.subtree && JSON.parse(before.subtree).string === "{{[[table]]}}";
    step("1 find an enhanced table", isTable, `${chosen.uid} on ${JSON.stringify(before.page)}; subtree ${before.subtree?.length ?? 0} bytes; metadata ${metadataUids.join(",") || "none"}`);
    if (isTable) {
      // 2. open it in the right sidebar
      const opened = await c.evaluate(async (uid) => {
        const api = window.roamAlphaAPI;
        const has = () => api.ui.rightSidebar.getWindows().some((w) => w.type === "block" && w["block-uid"] === uid);
        const wasOpen = has();
        if (!wasOpen) await api.ui.rightSidebar.addWindow({ window: { type: "block", "block-uid": uid } });
        let cells = 0;
        for (const t0 = performance.now(); performance.now() - t0 < 8000;) {
          cells = (document.getElementById("roam-right-sidebar-content") || document).querySelectorAll(".rg-cell").length;
          if (cells) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        return { wasOpen, cells };
      }, chosen.uid);
      addedWindow = !opened.wasOpen;
      step("2 sidebar window with Roam Grid cells", opened.cells > 0, opened.cells ? `${opened.cells} .rg-cell element(s)${opened.wasOpen ? " (window was already open)" : ""}` : "Roam Grid drew no .rg-cell within 8 s");
      if (opened.cells) {
        await sleep(400);
        // 3. grid keys before the popup
        await gridKeys("3 before the popup");

        // 4. Burrow's popup with the table preview. A drill step cannot name a
        // table that has siblings with text (stripRoamMarkup drops the macro, and
        // an empty step takes the first block with text), so the gate goes there
        // with Tab: [[Page, Tab lists the page's blocks, ↓ onto each ancestor and
        // Tab, then ↓ onto the table; the Tab list's preview highlights it.
        const path = await c.evaluate((uid) => {
          const raw = window.roamAlphaAPI.pull("[:block/uid {:block/_children ...}]", [":block/uid", uid]);
          const chain = [];
          for (let at = raw?.[":block/_children"]?.[0]; at; at = at[":block/_children"]?.[0]) if (at[":block/uid"]) chain.unshift(at[":block/uid"]);
          return chain.slice(1).concat(uid);
        }, chosen.uid);
        const pageTitle = before.page;
        const query = `[[${pageTitle}`;
        // Leave the grid first: its active cell keeps the keys, and Roam may hold the table block selected.
        await neutralClick(c);
        await sleep(200);
        const primed = await primeFixture(c, "");
        if (!primed.ok) {
          const held = await c.evaluate(() => [...document.querySelectorAll(".block-highlight-blue, .rm-block--selected, .block-highlight")]
            .map((n) => `${n.tagName}.${String(n.className).split(/\s+/).slice(0, 4).join(".")}#${n.id || ""}`).slice(0, 6));
          throw new Error(`fixture block not focused: ${JSON.stringify(primed)}; selected ${JSON.stringify(held)}`);
        }
        await c.type(query, TYPE_MS);
        for (let t0 = Date.now(); Date.now() - t0 < 2500;) {
          if (await c.evaluate(() => Boolean(document.querySelector(".rm-autocomplete__results")))) break;
          await sleep(40);
        }
        await sleep(400);
        preview = await isExpanded();
        if (!preview) await ctrlO();
        const activeUid = () => c.evaluate(() => {
          const sc = window.__BURROW?.state.scope;
          if (!sc || window.__BURROW.state.phase !== "SCOPE") return null;
          const row = sc.rows[sc.levels.at(-1).active];
          return row?.node?.uid ?? row?.uid ?? null;
        });
        const moves = [];
        await c.key("Tab");
        await sleep(400);
        for (const [i, uid] of path.entries()) {
          let at = await activeUid();
          for (let n = 0; n < 80 && at !== uid; n++) { await c.key("ArrowDown"); await sleep(50); at = await activeUid(); }
          moves.push(`${uid}:${at === uid ? "ok" : `stuck at ${at}`}`);
          if (at !== uid) break;
          if (i < path.length - 1) { await c.key("Tab"); await sleep(400); }
        }
        await sleep(900);
        const seen = await c.evaluate(() => {
          const grid = document.querySelector(".burrow-preview:not([hidden]) .burrow-table");
          return {
            target: (() => { const sc = window.__BURROW?.state.scope; const row = sc?.rows[sc.levels.at(-1).active]; return row?.node?.uid ?? row?.uid ?? null; })(),
            cells: grid ? grid.querySelectorAll(".burrow-cell").length : 0,
            texts: grid ? [...grid.querySelectorAll(".burrow-cell")].map((n) => n.textContent) : [],
            footer: document.querySelector(".burrow-preview:not([hidden]) .burrow-table-more")?.textContent ?? null,
            onAttrs: [...document.querySelectorAll(".burrow-preview *")].filter((n) => [...n.attributes].some((a) => a.name.startsWith("on"))).length,
          };
        });
        if (!preview) await ctrlO();
        for (let i = 0; i < 4 && (await c.evaluate(() => Boolean(document.querySelector(".rm-autocomplete__results")))); i++) {
          await c.key("Escape");
          await sleep(250);
        }
        const closed = !(await c.evaluate(() => Boolean(document.querySelector(".rm-autocomplete__results"))));
        await c.evaluate(async () => {
          const g = window.__burrowFixture;
          if (document.activeElement?.tagName === "TEXTAREA") document.activeElement.blur();
          await window.roamAlphaAPI.data.block.update({ block: { uid: g.blockUid, string: "" } });
          await new Promise((r) => setTimeout(r, 400));
        });
        await clearSelection(c);
        const pages = await deleteNewPages(c);
        const resolved = seen.target === chosen.uid;
        step("4 Burrow table preview (Tab list)", resolved && seen.cells > 0 && seen.onAttrs === 0 && closed,
          `${query}, Tab, ${moves.join(" ")} -> highlighted ${seen.target ?? "none"}; preview cells ${seen.cells} ${JSON.stringify(seen.texts)}, footer ${JSON.stringify(seen.footer)}, on* attributes ${seen.onAttrs}; popup closed by Escape: ${closed}; pages removed ${JSON.stringify(pages.deleted)}`);

        // 5. grid keys after the popup
        await gridKeys("5 after the popup");

        // 6. AFTER equals BEFORE
        const after = await readState(chosen.uid, metadataUids);
        step("6 table subtree unchanged", after.subtree === before.subtree && after.page === before.page, after.subtree === before.subtree ? `${before.subtree.length} bytes identical` : "subtree differs");
        step("6 metadata unchanged", after.metadata === before.metadata, after.metadata === before.metadata ? "identical" : `before ${before.metadata} after ${after.metadata}`);
        const left = await c.evaluate(() => window.roamAlphaAPI.q("[:find [?t ...] :where [?p :node/title ?t]]").filter((t) => !window.__burrowTitles.has(t)));
        step("6 no new pages", left.length === 0, left.length ? JSON.stringify(left) : "none");
      }
    }
  }
} catch (error) {
  step("run", false, String(error?.stack || error));
} finally {
  await cleanup();
}

const failed = steps.filter((s) => !s.pass);
console.log(`grid gate ${title}: ${failed.length ? "FAIL" : "PASS"}`);
console.log(`  table ${table?.uid ?? "none"}${installed.parked ? `; installed Burrow ${installed.version} parked for the run` : ""}`);
for (const s of steps) console.log(`  ${s.pass ? "PASS" : "FAIL"} ${s.name}: ${s.detail}`);
process.exitCode = failed.length ? 1 : 0;
