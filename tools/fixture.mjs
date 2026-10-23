// Shared fixture for the live gates: a `Burrow/Fixtures` page with one fresh
// block created for this run, opened in the right sidebar, plus a key guard.
// The guard swallows every trusted key whose target is not that block's
// textarea (after Escape Roam leaves the block *selected*, and a stray
// Backspace would delete it). Cleanup deletes only what the run created. A
// ledger file in the OS temp dir records what a run created, so a crashed run
// is cleaned up exactly by the next one.
import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A small heading tree for the drill gates, created on the fixture page:
//   Alpha section (h2) > first child note, never grok for writing > grandchild one, third item
//   Beta section (h2) > beta child
export const DRILL_TREE = [
  { key: "alpha", string: "Alpha section", heading: 2, children: [
    { key: "first", string: "first child note" },
    { key: "never", string: "never grok for writing", children: [{ key: "grand", string: "grandchild one" }] },
    { key: "third", string: "third item" },
  ] },
  { key: "beta", string: "Beta section", heading: 2, children: [{ key: "betaChild", string: "beta child" }] },
  // Two referenced blocks that rank the same in (( (the pick-memory case).
  { key: "pickA", string: "zebra burrow pick one" },
  { key: "pickB", string: "zebra burrow pick two" },
  // Referenced tasks, drawn as Roam's checkboxes in Burrow's rows (0.6.0).
  { key: "taskTodo", string: "{{[[TODO]]}} zebra task open" },
  { key: "taskDone", string: "{{[[DONE]]}} zebra task closed" },
  // A macro that only starts like a task (svy's SmartBlock button under a TODO on Patterns).
  { key: "taskSmart", string: "{{[[TODO]]}} zebra smart parent", children: [{ key: "smartButton", string: "{{TODO today:SmartBlock:TODO today}}" }] },
  { key: "steps", string: "Steps section", children: [
    { key: "intro", string: "B-side" },
    { key: "one", string: "1. mix" }, { key: "two", string: "2. bake" },
    { key: "bee", string: "(b) cool" }, { key: "roman", string: "iii. serve" },
  ] },
  { key: "hollow", string: "Hollow section", children: [
    { key: "hollowNode", string: "", children: [{ key: "insideHollow", string: "inside hollow" }] },
    { key: "blank", string: "" },
    { key: "afterHollow", string: "after hollow" },
  ] },
  { key: "many", string: "Many section", children: Array.from({ length: 55 }, (_, i) => ({ key: `many${i + 1}`, string: `many ${String(i + 1).padStart(2, "0")}` })) },
];

// Aliases of the `<fixture> Chips` page: more than one chip line holds.
export const CHIP_ALIASES = ["zq chip alpha long alias", "zq chip bravo long alias", "zq chip charlie long alias", "zq chip delta long alias",
  "zq chip echo long alias", "zq chip foxtrot long alias", "zq chip golf long alias", "zq chip hotel long alias"];
export const CHIP_LONG = "zq chip juliet alias that runs past three quarters of the chip line";
export const CHIPS_ALIAS_STRING = `Aliases:: ${[...CHIP_ALIASES, CHIP_LONG].join(", ")}`;

// The gates use this page; BURROW_FIXTURE_PAGE picks another when a crashed run left a stale tree.
export const FIXTURE_PAGE = process.env.BURROW_FIXTURE_PAGE || "Burrow/Fixtures";

const newUid = () => randomBytes(9).toString("base64url").slice(0, 9);

const ledgerPath = (c) => {
  const prefix = String(c.page.title || "").split(" - ")[0].replace(/[^A-Za-z0-9_-]/g, "_") || "window";
  return join(tmpdir(), `burrow-gate-ledger-${prefix}.json`);
};

const readLedger = async (c) => {
  try { return JSON.parse(await readFile(ledgerPath(c), "utf8")); } catch { return null; }
};

// Deletes exactly what a ledger lists: blocks by uid, the sidebar window, and
// pages by uid only when this tooling created them and the title still matches.
async function cleanFromLedger(c, ledger) {
  return c.evaluate(async ({ ledger, prefix }) => {
    const api = window.roamAlphaAPI;
    const exists = (uid) => Boolean(api.q(`[:find ?e . :where [?e :block/uid "${uid}"]]`));
    const done = { blocks: 0, pages: 0 };
    if (ledger.sidebar && ledger.pageUid) {
      try { await api.ui.rightSidebar.removeWindow({ window: { type: "outline", "block-uid": ledger.pageUid } }); } catch { /* window already gone */ }
    }
    for (const uid of [ledger.blockUid, ...(ledger.drillUids || [])].filter(Boolean)) {
      if (exists(uid)) { await api.data.block.delete({ block: { uid } }); done.blocks += 1; }
    }
    const pages = [[ledger.chipsUid, ledger.createdChips], [ledger.emptyUid, ledger.createdEmpty], [ledger.pageUid, ledger.createdPage]];
    for (const [uid, created] of pages) {
      if (!uid || !created) continue;
      const t = api.q(`[:find ?t . :where [?p :block/uid "${uid}"] [?p :node/title ?t]]`);
      if (t && t.startsWith(prefix)) { await api.data.page.delete({ page: { uid } }); done.pages += 1; }
    }
    document.getElementById("burrow-gate-low")?.remove();
    return done;
  }, { ledger, prefix: FIXTURE_PAGE });
}

export async function setupFixture(c, { drillTree = false } = {}) {
  const path = ledgerPath(c);
  const stale = await readLedger(c);
  if (stale) {
    const done = await cleanFromLedger(c, stale);
    console.error(`fixture ledger ${path}: cleaned ${done.blocks} block(s) and ${done.pages} page(s) a crashed run left`);
    await rm(path, { force: true });
  }
  // What exists now (read-only); the stale-tree check runs after the ledger cleanup.
  const found = await c.evaluate(({ title, drillTree }) => {
    const api = window.roamAlphaAPI;
    const uidOf = (t) => api.q(`[:find ?u . :where [?p :node/title ${JSON.stringify(t)}] [?p :block/uid ?u]]`);
    const pageUid = uidOf(title);
    if (drillTree && pageUid && api.q(`[:find ?b . :where [?p :block/uid "${pageUid}"] [?p :block/children ?b] [?b :block/string "Alpha section"]]`)) {
      throw new Error(`stale fixture tree on ${title}: rerun with BURROW_FIXTURE_PAGE=<other title>`);
    }
    const chipsUid = uidOf(`${title} Chips`);
    const chipsAliasUid = chipsUid ? api.q(`[:find ?u . :where [?p :block/uid "${chipsUid}"] [?p :block/children ?b] [?b :block/string ?s] [(clojure.string/starts-with? ?s "Aliases::")] [?b :block/uid ?u]]`) : null;
    return { pageUid, emptyUid: uidOf(`${title} Empty`), chipsUid, chipsAliasUid };
  }, { title: FIXTURE_PAGE, drillTree });

  // Every uid is chosen here so the ledger can be written before anything is created.
  const drill = {};
  const drillUids = [];
  const assign = (nodes, top) => {
    for (const n of nodes) {
      drill[n.key] = newUid();
      if (top) drillUids.push(drill[n.key]);
      if (n.children) assign(n.children, false);
    }
  };
  if (drillTree) assign(DRILL_TREE, true);
  const refsUid = drillTree ? newUid() : null;
  if (refsUid) drillUids.push(refsUid);
  const plan = {
    title: String(c.page.title || "").split(" - ")[0],
    pageUid: found.pageUid || newUid(), emptyUid: found.emptyUid || newUid(), chipsUid: found.chipsUid || newUid(),
    chipsAliasUid: found.chipsAliasUid || newUid(), blockUid: newUid(), drillUids,
    createdPage: !found.pageUid, createdEmpty: !found.emptyUid, createdChips: !found.chipsUid, sidebar: false, at: Date.now(),
  };
  await writeFile(path, JSON.stringify(plan));
  try {
    const fx = await c.evaluate(async ({ plan, drillTree, tree, drill, refsUid, title, aliasString }) => {
      const api = window.roamAlphaAPI;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const created = { page: plan.createdPage, sidebar: false, emptyPage: plan.createdEmpty, chipsPage: plan.createdChips, drill: [] };
      const { pageUid, emptyUid, chipsUid, chipsAliasUid, blockUid } = plan;
      if (created.page) await api.data.page.create({ page: { title, uid: pageUid } });
      // An empty page for the "nothing to drill into" Tab case.
      if (created.emptyPage) await api.data.page.create({ page: { title: `${title} Empty`, uid: emptyUid } });
      // A page with more aliases than one chip line holds, for the chip scroll cases.
      if (created.chipsPage) {
        await api.data.page.create({ page: { title: `${title} Chips`, uid: chipsUid } });
        await api.data.block.create({ location: { "parent-uid": chipsUid, order: 0 }, block: { string: aliasString, uid: chipsAliasUid } });
      }
      // The drill tree goes in before the typing block and before keepAll, so
      // the gates never count it as a block Roam created.
      if (drillTree) {
        const make = async (nodes, parent) => {
          for (const n of nodes) {
            await api.data.block.create({ location: { "parent-uid": parent, order: "last" }, block: { string: n.string, uid: drill[n.key], ...(n.heading ? { heading: n.heading } : {}) } });
            if (parent === pageUid) created.drill.push(drill[n.key]);
            if (n.children) await make(n.children, drill[n.key]);
          }
        };
        await make(tree, pageUid);
        // The referenced blocks the (( cases find: the pick-memory pair, the
        // tasks, and a nested block (outline and context cases).
        await api.data.block.create({ location: { "parent-uid": pageUid, order: "last" }, block: { string: `refs ((${drill.pickA})) ((${drill.pickB})) ((${drill.taskTodo})) ((${drill.taskDone})) ((${drill.taskSmart})) ((${drill.never})) ((${drill.many50}))`, uid: refsUid } });
        created.drill.push(refsUid);
      }
      await api.data.block.create({ location: { "parent-uid": pageUid, order: "last" }, block: { string: "", uid: blockUid } });
      const windowId = `sidebar-outline-${pageUid}`;
      if (!api.ui.rightSidebar.getWindows().some((w) => w["window-id"] === windowId)) {
        await api.ui.rightSidebar.addWindow({ window: { type: "outline", "block-uid": pageUid } });
        created.sidebar = true;
      }
      await sleep(900);
      const keepAll = api.q(`[:find [?u ...] :where [?p :block/uid "${pageUid}"] [?b :block/page ?p] [?b :block/uid ?u]]`) || [];
      const inputId = `block-input-${windowId}-${blockUid}`;
      const guard = { aborted: [], armed: true };
      guard.onKeyDown = (e) => {
        if (!guard.armed || !e.isTrusted) return;
        // Backspace into an empty block would merge it into its sibling.
        if (e.target?.id === inputId && !(e.key === "Backspace" && e.target.value === "")) return;
      // Burrow's alias prompt is its own input; its keys never reach the block.
      if (e.target?.closest?.(".burrow-prompt")) return;
        // Escape only clears Roam's block selection; it is how the harness
        // gets out of the selected state, so it may pass.
        if (e.key === "Escape") return;
        e.preventDefault();
        e.stopImmediatePropagation();
        guard.aborted.push(`${e.key} on ${e.target?.tagName}#${e.target?.id || ""}`);
      };
      // A run that died before cleanup leaves its guard armed, and that guard
      // would swallow every key aimed at this run's block. Guards live in one
      // registry, so a new fixture removes any left over.
      for (const old of window.__burrowGuards || []) window.removeEventListener("keydown", old, true);
      window.__burrowGuards = [guard.onKeyDown];
      window.addEventListener("keydown", guard.onKeyDown, true);
      window.__burrowFixture = { pageUid, blockUid, windowId, inputId, created, keepAll, guard, drill, emptyTitle: `${title} Empty`, emptyUid, chipsTitle: `${title} Chips`, chipsUid, chipsAliasUid };
      return { pageUid, blockUid, windowId, created, drill, chipsTitle: `${title} Chips`, chipsAliasUid, emptyUid, chipsUid };
    }, { plan, drillTree, tree: DRILL_TREE, drill, refsUid, title: FIXTURE_PAGE, aliasString: CHIPS_ALIAS_STRING });
    await writeFile(path, JSON.stringify({ ...plan, sidebar: fx.created.sidebar }));
    return fx;
  } catch (error) {
    // Roll back what the ledger lists right away; the ledger stays if that fails.
    try {
      await cleanFromLedger(c, { ...plan, sidebar: true });
      await rm(path, { force: true });
    } catch { /* the next run's ledger cleanup retries */ }
    throw error;
  }
}

// Registers SIGINT / SIGTERM / uncaughtException handlers that run fn once
// (awaited, errors logged) and then exit 130.
export function onAbort(fn) {
  let started = false;
  const run = async (why, error) => {
    if (started) return;
    started = true;
    console.error(`aborted (${why})${error ? `: ${error?.stack || error}` : ""}; cleaning up`);
    try { await fn(); } catch (e) { console.error("abort cleanup failed:", e); }
    process.exit(130);
  };
  process.on("SIGINT", () => run("SIGINT"));
  process.on("SIGTERM", () => run("SIGTERM"));
  process.on("uncaughtException", (error) => run("uncaughtException", error));
}

// After Escape Roam keeps the block *selected*, and that selection survives
// a programmatic focus: the next Backspace then deletes the whole block
// (checked with Burrow unloaded; it is Roam's behavior). Clear it first.
const selectedCount = (c) => c.evaluate(() => {
  const api = window.roamAlphaAPI;
  const dom = document.querySelectorAll(".block-highlight-blue, .rm-block--selected, .block-highlight").length;
  return dom + (api.ui.multiselect?.getSelected?.().length || 0) + (api.ui.individualMultiselect?.getSelectedUids?.().length || 0);
});

export async function clearSelection(c) {
  for (let i = 0; i < 4; i++) {
    if (!(await selectedCount(c))) return true;
    await c.evaluate(() => { if (document.activeElement?.tagName === "TEXTAREA") document.activeElement.blur(); });
    await c.key("Escape");
    await new Promise((r) => setTimeout(r, 120));
  }
  return !(await selectedCount(c));
}

// Blur, set the fixture string, focus it with the caret at the end.
export async function primeFixture(c, seed) {
  if (!(await clearSelection(c))) return { ok: false, reason: "block selection would not clear" };
  return c.evaluate(async (seed) => {
    const api = window.roamAlphaAPI;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (cond, ms) => {
      const t0 = performance.now();
      while (!cond() && performance.now() - t0 < ms) await sleep(30);
      return cond();
    };
    const g = window.__burrowFixture;
    const stored = () => api.q(`[:find ?s . :where [?b :block/uid "${g.blockUid}"] [?b :block/string ?s]]`);
    if (document.activeElement?.tagName === "TEXTAREA") document.activeElement.blur();
    await sleep(60);
    await api.data.block.update({ block: { uid: g.blockUid, string: seed } });
    await until(() => stored() === seed, 1500);
    const focused = () => document.activeElement?.id === g.inputId && document.activeElement.value === seed;
    // The encrypted graph can take a moment longer to mount the editor.
    for (let i = 0; i < 6 && !focused(); i++) {
      await api.ui.setBlockFocusAndSelection({ location: { "block-uid": g.blockUid, "window-id": g.windowId }, selection: { start: seed.length } });
      await until(focused, 1200);
    }
    const ta = document.activeElement;
    return { ok: focused(), value: ta?.value, caret: ta?.selectionStart };
  }, seed);
}

export async function guardReport(c) {
  return c.evaluate(() => window.__burrowFixture?.guard.aborted.splice(0) || []);
}

export async function cleanupFixture(c, { keep = false } = {}) {
  const result = await cleanupFixtureInPage(c, { keep });
  if (!keep && result) await rm(ledgerPath(c), { force: true });
  return result;
}

async function cleanupFixtureInPage(c, { keep }) {
  return c.evaluate(async ({ keep }) => {
    const api = window.roamAlphaAPI;
    const g = window.__burrowFixture;
    if (!g) return null;
    g.guard.armed = false;
    window.removeEventListener("keydown", g.guard.onKeyDown, true);
    window.__burrowGuards = (window.__burrowGuards || []).filter((h) => h !== g.guard.onKeyDown);
    document.getElementById("burrow-gate-low")?.remove();
    if (document.activeElement?.tagName === "TEXTAREA") document.activeElement.blur();
    await new Promise((r) => setTimeout(r, 300));
    const exists = api.q(`[:find ?e . :where [?e :block/uid "${g.blockUid}"]]`);
    if (keep) {
      if (exists) await api.data.block.update({ block: { uid: g.blockUid, string: "" } });
      return { kept: true, blockExists: Boolean(exists) };
    }
    if (exists) await api.data.block.delete({ block: { uid: g.blockUid } });
    for (const uid of g.created.drill || []) await api.data.block.delete({ block: { uid } });
    if (g.created.sidebar) await api.ui.rightSidebar.removeWindow({ window: { type: "outline", "block-uid": g.pageUid } });
    if (g.created.page) {
      const left = api.q(`[:find (count ?b) . :where [?p :block/uid "${g.pageUid}"] [?b :block/page ?p]]`) || 0;
      if (!left) await api.data.page.delete({ page: { uid: g.pageUid } });
    }
    if (g.created.emptyPage) {
      const p = api.pull("[:block/uid {:block/children [:db/id]} {:block/_refs [:db/id]}]", [":block/uid", g.emptyUid]);
      if (p && !p[":block/children"]?.length && !p[":block/_refs"]?.length) await api.data.page.delete({ page: { uid: g.emptyUid } });
    }
    if (g.created.chipsPage) {
      const p = api.pull("[:block/uid {:block/children [:block/string]} {:block/_refs [:db/id]}]", [":block/uid", g.chipsUid]);
      const kids = p?.[":block/children"] || [];
      if (p && kids.length === 1 && kids[0][":block/string"].startsWith("Aliases:: zq chip") && !p[":block/_refs"]?.length) {
        await api.data.page.delete({ page: { uid: g.chipsUid } });
      }
    }
    window.__burrowFixture = null;
    return { blockExists: Boolean(exists) };
  }, { keep });
}

// Titles that exist now, so a run can delete exactly the pages it caused.
export async function snapshotTitles(c) {
  return c.evaluate(() => {
    window.__burrowTitles = new Set(window.roamAlphaAPI.q("[:find [?t ...] :where [?p :node/title ?t]]"));
    return window.__burrowTitles.size;
  });
}

// Pages created since snapshotTitles: an unclosed `[[x` saved by Roam. Only
// pages that are empty, that nothing links to and whose title this connection
// typed are deleted: an outside write in the meantime (notes' daily-plan job)
// is left alone.
export async function deleteNewPages(c) {
  return c.evaluate(async (typed) => {
    const api = window.roamAlphaAPI;
    const before = window.__burrowTitles || new Set();
    const created = api.q("[:find [?t ...] :where [?p :node/title ?t]]").filter((t) => !before.has(t));
    const deleted = [];
    for (const t of created) {
      const p = api.pull("[:block/uid {:block/children [:db/id]} {:block/_refs [:db/id]}]", [":node/title", t]);
      if (p && typed.includes(t) && !p[":block/children"]?.length && !p[":block/_refs"]?.length) {
        await api.data.page.delete({ page: { uid: p[":block/uid"] } });
        deleted.push(t);
      }
    }
    return { created, deleted };
  }, c.typed());
}

// A click that blurs the block without navigating anything: a point on the
// top bar that is the bar itself or a plain classless DIV child of it.
export async function neutralClick(c) {
  const point = await c.evaluate(() => {
    const bar = document.querySelector(".rm-topbar");
    if (!bar) return null;
    const r = bar.getBoundingClientRect();
    const y = r.top + r.height / 2;
    for (let x = r.left + r.width * 0.6; x <= r.left + r.width * 0.95; x += 6) {
      const el = document.elementFromPoint(x, y);
      if (el === bar || (el && el.tagName === "DIV" && !el.className && el.parentElement === bar)) return { x, y };
    }
    return null;
  });
  if (point) await c.click(point.x, point.y);
  else await c.evaluate(() => document.activeElement?.blur());
  return Boolean(point);
}

// Pushes the fixture window down so Roam opens its popup above the text.
// Run it after the block is focused (Roam scrolls a focused block towards the
// middle). DOM only; no graph writes.
export async function placeLow(c) {
  return c.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    document.getElementById("burrow-gate-low")?.remove();
    const style = document.createElement("style");
    style.id = "burrow-gate-low";
    style.textContent = `#roam-right-sidebar-content { padding-top: ${window.innerHeight}px !important; }`;
    document.head.append(style);
    await frame();
    const box = document.getElementById("roam-right-sidebar-content");
    const ta = document.getElementById(window.__burrowFixture.inputId);
    if (box && ta) {
      window.__burrowFixture.lowScroll ??= box.scrollTop;
      box.scrollTop += ta.getBoundingClientRect().top - (window.innerHeight - 80);
    }
    await frame();
    await frame();
    return { taTop: ta ? ta.getBoundingClientRect().top : null, innerHeight: window.innerHeight };
  });
}

export async function placeNormal(c) {
  await c.evaluate(async () => {
    document.getElementById("burrow-gate-low")?.remove();
    const g = window.__burrowFixture;
    const box = document.getElementById("roam-right-sidebar-content");
    if (g && g.lowScroll != null) {
      if (box) box.scrollTop = g.lowScroll;
      g.lowScroll = null;
    }
    for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
  });
}

// The page's clock, for editedSince (Roam stamps :edit/time from the window).
export const pageNow = (c) => c.evaluate(() => Date.now());

export const aliasBlockString = (c, pageUid) => c.evaluate((pageUid) => window.roamAlphaAPI.q(
  `[:find ?s . :where [?p :block/uid "${pageUid}"] [?p :block/children ?b] [?b :block/string ?s] [(clojure.string/starts-with? ?s "Aliases::")]]`) ?? null, pageUid);

export const setAliasBlock = (c, uid, string) => c.evaluate(async ({ uid, string }) => {
  await window.roamAlphaAPI.data.block.update({ block: { uid, string } });
  await new Promise((r) => setTimeout(r, 200));
}, { uid, string });

export const childStrings = (c, pageUid) => c.evaluate((pageUid) => {
  const kids = window.roamAlphaAPI.pull("[{:block/children [:block/string :block/order]}]", [":block/uid", pageUid])?.[":block/children"] || [];
  return kids.sort((a, b) => a[":block/order"] - b[":block/order"]).map((k) => k[":block/string"]);
}, pageUid);

export const editedSince = (c, t0) => c.evaluate((t0) => window.roamAlphaAPI.q(
  "[:find [?u ...] :in $ ?t0 :where [?b :edit/time ?t] [(> ?t ?t0)] [?b :block/uid ?u]]", t0) || [], t0);

export const deleteBlock = (c, uid) => c.evaluate(async (uid) => {
  if (window.roamAlphaAPI.q(`[:find ?e . :where [?e :block/uid "${uid}"]]`)) await window.roamAlphaAPI.data.block.delete({ block: { uid } });
}, uid);
