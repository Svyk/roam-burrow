import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { createLifecycle } from "../src/lifecycle.js";
import { createPerf } from "../src/perf.js";
import { buildRefIndex } from "../src/refindex.js";
import { DEFAULTS } from "../src/settings.js";

// Related rows (Roam's semantic search) on a jsdom DOM, driven through
// createStrip like test/richrows.test.js. The 400 ms pause is shortened to 5.
const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const real = dom.window;
const doc = real.document;
for (const name of ["HTMLTextAreaElement", "MutationObserver", "Event", "KeyboardEvent", "getComputedStyle"]) globalThis[name] = real[name];
const win = new Proxy(real, {
  get(target, prop) {
    if (prop === "setTimeout") return (fn, ms, ...args) => target.setTimeout(fn, ms === 400 ? 5 : ms, ...args);
    const value = target[prop];
    return typeof value === "function" ? value.bind(target) : value;
  },
});
const { createStrip } = await import("../src/strip.js");
after(() => real.close());

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frames = () => new Promise((resolve) => real.requestAnimationFrame(() => setTimeout(resolve, 0)));
const settle = async () => { for (let i = 0; i < 4; i += 1) await frames(); };
async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (check()) return true; await sleep(10); }
  return false;
}

const DB = {
  b1: "Wakanda forever opens in cinemas this week",
  b2: "Notes on the Wakanda soundtrack",
  b3: "Why Wakanda matters to the franchise",
  b4: "A fourth block about Wakanda",
  rich00002: "zebra target text",
  fixtureU1: "the block being edited, about Wakanda",
  nat1: "Already listed by Roam: Wakanda trailer",
  huge1: `Huge block ${"word ".repeat(4000)}`,
  long1: "**One Hour Of No-Screen Deep Work** Work for one hour on your calendar with a pen, paper and no screens, so you can stay focused",
};
const PAGES = { pg1: "Wakanda Forever", pg2: "Black Panther" };
const ENTRIES = [["rich00002", "zebra target text", 1]];

const block = (uid) => ({ type: "block", uid, topUids: [uid] });
const popover = (native) => '<div class="rm-autocomplete__results"><div class="rm-autocomplete__results-main"><div class="rm-autocomplete__results-scroll">'
  + native.map((n, i) => `<div ${n.title ? `title="${n.title}" ` : ""}${i === 0 ? 'style="background-color: rgb(225, 232, 237)" ' : ""}><div class="rm-autocomplete-result">${n.text ?? n.title}</div></div>`).join("")
  + '</div><div class="rm-autocomplete-footer">Block search</div></div></div>';

async function withRelated({ query, hits = [], native = [{ text: "x" }], enabled = true, overrides = {}, manual = false }, fn) {
  doc.body.innerHTML = `<textarea class="rm-block-input" id="block-input-uuid-x-fixtureU1"></textarea>${popover(native)}`;
  const ta = doc.querySelector("textarea");
  ta.value = query;
  ta.focus();
  ta.setSelectionRange(query.length, query.length);
  const calls = [];
  const state = { enabled };
  const api = {
    graph: { name: "test-graph" },
    ui: { getFocusedBlock: () => ({ "block-uid": "fixtureU1" }) },
    pull: (pattern, eid) => {
      const uid = eid?.[1];
      if (!String(pattern).includes(":block/string")) return null;
      if (PAGES[uid]) return { ":block/uid": uid, ":node/title": PAGES[uid] };
      return DB[uid] ? { ":block/uid": uid, ":block/string": DB[uid] } : null;
    },
    q: () => [],
    data: {
      semanticSearchEnabled: () => state.enabled,
      async: { semanticSearch: (args) => new Promise((resolve, reject) => {
        const call = { args, resolve, reject, hits };
        calls.push(call);
        if (!manual) resolve(hits);
      }) },
    },
  };
  const indexes = { refs: buildRefIndex(ENTRIES), aliases: null, titles: null, refreshIfStale() {} };
  const lifecycle = createLifecycle();
  const settings = { aliasPages: false, drill: false, ...overrides };
  const strip = createStrip({ setting: (id) => (id in settings ? settings[id] : DEFAULTS[id]), indexes, perf: createPerf(), lifecycle, api, doc, win });
  ta.dispatchEvent(new real.Event("input", { bubbles: true }));
  await settle();
  const key = (init) => {
    const event = new real.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    ta.dispatchEvent(event);
    return event;
  };
  const type = async (value) => {
    ta.value = value;
    ta.setSelectionRange(value.length, value.length);
    ta.dispatchEvent(new real.Event("input", { bubbles: true }));
    await settle();
  };
  const altR = () => key({ key: "®", code: "KeyR", altKey: true });
  const band = () => doc.querySelector(".burrow-related");
  const bandRows = () => [...doc.querySelectorAll(".burrow-related .burrow-row")];
  const shownBand = () => Boolean(band() && !band().hidden && bandRows().length > 0);
  try { await fn({ ta, strip, state, calls, key, type, altR, band, bandRows, shownBand, api }); } finally { await lifecycle.dispose(); }
}

const HITS = [block("b1"), block("b2"), block("b3")];

test("a band that arrives while Roam's row is highlighted changes nothing; Enter does not insert a Related row", () => withRelated({ query: "((wakanda forever", hits: HITS }, async (h) => {
  assert.equal(h.strip.state.phase, "ARMED");
  assert.equal(h.shownBand(), false);
  assert.ok(await until(h.shownBand), "the band arrives");
  assert.equal(h.strip.state.phase, "ARMED");
  assert.equal(h.strip.state.active, -1);
  assert.equal(h.band().querySelector(".burrow-related-label").textContent, "Related");
  assert.equal(h.bandRows().length, 3);
  assert.equal(h.bandRows().filter((r) => r.classList.contains("burrow-active")).length, 0, "no band row highlighted");
  assert.equal(doc.querySelector(".rm-autocomplete__results-scroll > div").style.backgroundColor, "rgb(225, 232, 237)", "Roam's highlight is untouched");
  const enter = h.key({ key: "Enter" });
  assert.equal(enter.defaultPrevented, false, "Enter is Roam's");
  assert.equal(h.ta.value, "((wakanda forever");
  assert.equal(h.strip.debug.commits, 0);
}));

test("the band sits after Roam's list, before the footer and the hint line; the popover carries its height class", () => withRelated({ query: "((wakanda forever", hits: HITS }, async (h) => {
  assert.ok(await until(h.shownBand));
  const main = doc.querySelector(".rm-autocomplete__results-main");
  const order = [...main.children].map((n) => n.className.split(" ")[0]);
  assert.deepEqual(order.filter((c) => /results-scroll|related|footer|hints|strip/.test(c)), ["burrow-strip", "rm-autocomplete__results-scroll", "burrow-related", "rm-autocomplete-footer", "burrow-hints"]);
  assert.ok(doc.querySelector(".rm-autocomplete__results").classList.contains("burrow-related-3"));
  assert.ok(doc.querySelector(".rm-autocomplete__results").classList.contains("burrow-related-open"));
  assert.equal(h.band().style.height, "123px");
}));

test("a popover opened upward gets the band at the top of the column", () => withRelated({ query: "((wakanda forever", hits: HITS }, async (h) => {
  doc.querySelector(".rm-autocomplete__results").style.bottom = "0px";
  await h.type("((wakanda forever ");
  assert.ok(await until(h.shownBand));
  const main = doc.querySelector(".rm-autocomplete__results-main");
  assert.equal(h.band().nextElementSibling, main.querySelector(".burrow-strip"));
  assert.ok(h.band().classList.contains("burrow-related-top"));
}));

test("a band that arrives while a Burrow row is OWNED does not change the highlight; Enter inserts Burrow's row", () => withRelated({ query: "((zebra target", hits: HITS }, async (h) => {
  if (h.strip.state.phase !== "OWNED") { h.key({ key: "ArrowUp" }); await settle(); }
  assert.equal(h.strip.state.phase, "OWNED");
  const before = h.strip.state.active;
  assert.ok(await until(h.shownBand));
  assert.equal(h.strip.state.phase, "OWNED");
  assert.equal(h.strip.state.active, before);
  assert.equal(doc.querySelectorAll(".burrow-strip .burrow-row.burrow-active").length, 1);
  h.key({ key: "Enter" });
  assert.equal(h.ta.value, "((rich00002))", "Burrow's row, not a Related row");
}));

test("⌥R enters the band, ↓ moves, Enter inserts ((uid)); the key is consumed", () => withRelated({ query: "((wakanda forever", hits: HITS }, async (h) => {
  assert.ok(await until(h.shownBand));
  const enter = h.altR();
  assert.equal(enter.defaultPrevented, true);
  assert.equal(h.strip.state.phase, "RELATED");
  assert.equal(h.strip.state.active, -1, "no strip row active");
  assert.equal(h.bandRows()[0].classList.contains("burrow-active"), true);
  assert.ok(doc.querySelector(".rm-autocomplete__results").classList.contains("burrow-related-owning"), "Roam's highlight is muted");
  assert.equal(h.key({ key: "ArrowDown" }).defaultPrevented, true);
  assert.equal(h.bandRows()[1].classList.contains("burrow-active"), true);
  h.key({ key: "ArrowDown" });
  h.key({ key: "ArrowDown" });
  assert.equal(h.bandRows()[2].classList.contains("burrow-active"), true, "clamped at the last row");
  h.key({ key: "ArrowUp" });
  assert.equal(h.bandRows()[1].classList.contains("burrow-active"), true);
  const commit = h.key({ key: "Enter" });
  assert.equal(commit.defaultPrevented, true);
  assert.equal(h.ta.value, "((b2))");
  assert.equal(h.strip.debug.commits, 1);
}));

test("in [[ a page hit inserts [[Title]] and pages show in a link color", () => withRelated({ query: "[[wakanda forever", hits: [{ type: "page", uid: "pg1" }, block("b1")], native: [{ title: "Something Else" }] }, async (h) => {
  assert.ok(await until(h.shownBand));
  assert.equal(h.calls[0].args["search-pages"], true);
  assert.deepEqual(h.bandRows().map((r) => r.querySelector(".burrow-text").classList.contains("burrow-ref")), [true, false]);
  h.altR();
  h.key({ key: "Enter" });
  assert.equal(h.ta.value, "[[Wakanda Forever]]");
}));

test("in (( a page hit is left out and the request asks blocks only", () => withRelated({ query: "((wakanda forever", hits: [{ type: "page", uid: "pg1" }, block("b1")] }, async (h) => {
  assert.ok(await until(h.shownBand));
  assert.equal(h.calls[0].args["search-pages"], false);
  assert.equal(h.bandRows().length, 1);
}));

test("Esc goes back to ARMED, is consumed, and the band stays; ⌥R again does the same", () => withRelated({ query: "((wakanda forever", hits: HITS }, async (h) => {
  assert.ok(await until(h.shownBand));
  h.altR();
  const esc = h.key({ key: "Escape" });
  assert.equal(esc.defaultPrevented, true);
  assert.equal(h.strip.state.phase, "ARMED");
  assert.equal(h.strip.state.active, -1);
  assert.equal(h.shownBand(), true);
  assert.equal(h.bandRows().filter((r) => r.classList.contains("burrow-active")).length, 0);
  h.altR();
  assert.equal(h.strip.state.phase, "RELATED");
  assert.equal(h.altR().defaultPrevented, true);
  assert.equal(h.strip.state.phase, "ARMED");
}));

test("with no band ⌥R passes through untouched", () => withRelated({ query: "((wakanda forever", hits: [] }, async (h) => {
  await sleep(150);
  assert.equal(h.shownBand(), false);
  assert.equal(h.altR().defaultPrevented, false);
  assert.equal(h.strip.state.phase, "ARMED");
}));

test("a reply for an old query is dropped", () => withRelated({ query: "((wakanda forever", hits: HITS, manual: true }, async (h) => {
  assert.ok(await until(() => h.calls.length === 1));
  await h.type("((wakanda forever soundtrack");
  h.calls[0].resolve(HITS);
  await sleep(200);
  assert.equal(h.shownBand(), false, "the old query's rows are not drawn");
  assert.deepEqual(h.strip.related.rows, []);
}));

test("a shown band goes when the query changes, and RELATED goes back to ARMED", () => withRelated({ query: "((wakanda forever", hits: HITS }, async (h) => {
  assert.ok(await until(h.shownBand));
  h.altR();
  assert.equal(h.strip.state.phase, "RELATED");
  await h.type("((wakanda forever s");
  assert.equal(h.strip.state.phase, "ARMED");
  assert.equal(h.shownBand(), false, "removed at the next render");
  assert.equal(h.strip.state.released, `${h.ta.id}:0`);
  // The key list's rule for OWNED holds here: a stale Enter is Burrow's, never Roam's.
}));

test("what Burrow's strip shows, the block being edited and Roam's visible rows are left out; no uid twice", () => withRelated({
  query: "((zebra target",
  hits: [block("rich00002"), block("fixtureU1"), block("nat1"), block("b1"), block("b1"), block("b2"), block("b3"), block("b4")],
  // Roam's (( row carries the raw block string as its title.
  native: [{ text: "x" }, { title: "Already listed by Roam: Wakanda trailer", text: "Already listed by Roam: Wakanda trailer" }],
}, async (h) => {
  assert.ok(await until(h.shownBand));
  assert.deepEqual(h.strip.related.rows.map((r) => r.uid), ["b1", "b2", "b3"]);
}));

test("[[ leaves out a page Roam's list already shows (compared by title)", () => withRelated({
  query: "[[wakanda forever", hits: [{ type: "page", uid: "pg1" }, { type: "page", uid: "pg2" }], native: [{ title: "wakanda forever" }],
}, async (h) => {
  assert.ok(await until(h.shownBand));
  assert.deepEqual(h.strip.related.rows.map((r) => r.insertion), ["[[Black Panther]]"]);
}));

test("with the switch off there is no band and no request", () => withRelated({ query: "((wakanda forever", hits: HITS, overrides: { semanticRows: false } }, async (h) => {
  await sleep(200);
  assert.equal(h.calls.length, 0);
  assert.equal(h.shownBand(), false);
  assert.equal(h.altR().defaultPrevented, false);
}));

test("with Roam's semantic search off there is no band and no request", () => withRelated({ query: "((wakanda forever", hits: HITS, enabled: false }, async (h) => {
  await sleep(200);
  assert.equal(h.calls.length, 0);
  assert.equal(h.shownBand(), false);
  assert.equal(h.strip.related.available, false);
}));

test("a search that throws shows no band, logs once, and stops asking", () => withRelated({ query: "((wakanda forever", hits: HITS, manual: true }, async (h) => {
  const logged = [];
  const original = console.debug;
  console.debug = (...args) => logged.push(args);
  try {
    assert.ok(await until(() => h.calls.length === 1));
    h.calls[0].reject(new Error("no provider"));
    await sleep(50);
    await h.type("((wakanda forever soundtrack");
    await sleep(100);
    assert.equal(h.calls.length, 1, "no more queries until the popup reopens");
    assert.equal(logged.length, 1);
    assert.match(logged[0][0], /^\[burrow\] related rows: /);
    assert.equal(h.shownBand(), false);
  } finally {
    console.debug = original;
  }
}));

test("the debug object and the perf samples report the request, pulls and draw", () => withRelated({ query: "((wakanda forever", hits: HITS }, async (h) => {
  assert.ok(await until(h.shownBand));
  const related = h.strip.related;
  assert.equal(related.enabled, true);
  assert.equal(related.available, true);
  assert.equal(related.inFlight, false);
  assert.equal(related.lastQuery, "wakanda forever");
  assert.equal(related.cacheSize, 1);
  assert.equal(typeof related.lastMs, "number");
  assert.deepEqual(related.rows[0], { uid: "b1", kind: "block", insertion: "((b1))" });
  related.clear();
  assert.equal(related.cacheSize, 0);
}));

test("hovering a band row (a real pointer move) highlights it; mousedown inserts it and the textarea keeps focus", () => withRelated({ query: "((wakanda forever", hits: HITS }, async (h) => {
  assert.ok(await until(h.shownBand));
  const row = h.bandRows()[2];
  row.dispatchEvent(new real.MouseEvent("mousemove", { bubbles: true, clientX: 4, clientY: 9 }));
  assert.equal(h.strip.state.phase, "RELATED");
  assert.equal(h.strip.state.active, -1);
  assert.equal(row.classList.contains("burrow-active"), true);
  const down = new real.MouseEvent("mousedown", { bubbles: true, cancelable: true });
  row.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(h.ta.value, "((b3))");
  assert.equal(doc.activeElement, h.ta);
}));

test("Tab inserts the highlighted Related row; Shift+Enter is left to Roam as in OWNED", () => withRelated({ query: "((wakanda forever", hits: HITS }, async (h) => {
  assert.ok(await until(h.shownBand));
  h.altR();
  assert.equal(h.key({ key: "Enter", shiftKey: true }).defaultPrevented, false);
  assert.equal(h.ta.value, "((wakanda forever");
  assert.equal(h.key({ key: "Tab" }).defaultPrevented, true);
  assert.equal(h.ta.value, "((b1))");
}));

test("the key list covers the band, and its Enter only closes the list", () => withRelated({ query: "((wakanda forever", hits: HITS }, async (h) => {
  assert.ok(await until(h.shownBand));
  h.altR();
  h.key({ key: "/", altKey: true });
  await settle();
  assert.equal(h.strip.state.help, true);
  assert.equal(h.band().classList.contains("burrow-help-covered"), true);
  h.key({ key: "Enter" });
  assert.equal(h.strip.state.help, false);
  assert.equal(h.band().classList.contains("burrow-help-covered"), false);
  assert.equal(h.ta.value, "((wakanda forever", "nothing was inserted under the list");
}));

test("the hint line names ⌥R while the band has rows, and the Related keys inside it", () => withRelated({ query: "((wakanda forever", hits: HITS }, async (h) => {
  const hints = () => doc.querySelector(".burrow-hints-list").textContent;
  assert.ok(await until(h.shownBand));
  await settle();
  assert.match(hints(), /(⌥R|Alt\+R) related/);
  h.altR();
  assert.equal(hints(), "↵ insert · ↑↓ move · esc back");
  h.key({ key: "Escape" });
  assert.match(hints(), /related/);
}));

test("a Related row starts at the block's start, not cut around the typed words", () => withRelated({ query: "((stay focused", hits: [block("long1")] }, async (h) => {
  assert.ok(await until(h.shownBand), "the band arrives");
  const text = h.bandRows()[0].querySelector(".burrow-text").textContent;
  assert.ok(text.startsWith("One Hour Of No-Screen Deep Work"), text);
}));

test("a long Related block draws only its first characters", () => withRelated({ query: "((stay focused", hits: [block("huge1")] }, async (h) => {
  assert.ok(await until(h.shownBand), "the band arrives");
  const text = h.bandRows()[0].querySelector(".burrow-text").textContent;
  assert.ok(text.startsWith("Huge block word"), text.slice(0, 40));
  assert.ok(text.length <= 241, `drawn ${text.length} characters`);
}));
