import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { createLifecycle } from "../src/lifecycle.js";
import { createPerf } from "../src/perf.js";
import { buildRefIndex } from "../src/refindex.js";
import { DEFAULTS } from "../src/settings.js";

// Suggested links (an empty [[, Roam's data.ai.suggestLinks) on a jsdom DOM, driven through
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

const PAGES = { "Deep Work": "pg1", distraction: "pg2", Notes: "pg3", Focus: "pg4", Phone: "pg5" };
const ENTRIES = [["rich00002", "zebra target text", 1]];

const popover = (native) => '<div class="rm-autocomplete__results"><div class="rm-autocomplete__results-main"><div class="rm-autocomplete__results-scroll">'
  + native.map((n, i) => `<div ${n.title ? `title="${n.title}" ` : ""}${i === 0 ? 'style="background-color: rgb(225, 232, 237)" ' : ""}><div class="rm-autocomplete-result">${n.text ?? n.title}</div></div>`).join("")
  + '</div><div class="rm-autocomplete-footer">Block search</div></div></div>';

const REPLY = { suggestions: ["Deep Work", "distraction", "Notes", "notes", "Focus"].map((title) => ({ title, matchType: "exact" })), queriedAt: "now" };

async function withSuggest({ value, reply = REPLY, native = [{ text: "x", title: "Search for a Page" }], overrides = {}, api: more = {}, pageTitle = null }, fn) {
  doc.body.innerHTML = `<div ${pageTitle ? `data-page-title="${pageTitle}"` : ""}><textarea class="rm-block-input" id="block-input-uuid-x-fixtureU1"></textarea></div>${popover(native)}`;
  const ta = doc.querySelector("textarea");
  const caret = value.indexOf("|");
  ta.value = value.replace("|", "");
  ta.focus();
  ta.setSelectionRange(caret, caret);
  const calls = [];
  const api = {
    graph: { name: "test-graph" },
    ui: { getFocusedBlock: () => ({ "block-uid": "fixtureU1" }) },
    pull: (pattern, eid) => (PAGES[eid?.[1]] ? { ":block/uid": PAGES[eid[1]], ":node/title": eid[1] } : null),
    q: () => [],
    data: { semanticSearchEnabled: () => false, ai: { suggestLinks: async (args) => { calls.push(args); return reply; } } },
    ...more,
  };
  const indexes = { refs: buildRefIndex(ENTRIES), aliases: null, titles: null, refreshIfStale() {} };
  const lifecycle = createLifecycle();
  const settings = { aliasPages: false, drill: false, recentRows: false, suggestRows: true, ...overrides };
  const strip = createStrip({ setting: (id) => (id in settings ? settings[id] : DEFAULTS[id]), indexes, perf: createPerf(), lifecycle, api, doc, win });
  ta.dispatchEvent(new real.Event("input", { bubbles: true }));
  await settle();
  const key = (init) => {
    const event = new real.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    ta.dispatchEvent(event);
    return event;
  };
  const type = async (next) => {
    ta.value = next;
    ta.setSelectionRange(next.length, next.length);
    ta.dispatchEvent(new real.Event("input", { bubbles: true }));
    await settle();
  };
  const altR = () => key({ key: "®", code: "KeyR", altKey: true });
  const band = () => doc.querySelector(".burrow-related");
  const bandRows = () => [...doc.querySelectorAll(".burrow-related .burrow-row")];
  const shownBand = () => Boolean(band() && !band().hidden && bandRows().length > 0);
  try { await fn({ ta, strip, calls, key, type, altR, band, bandRows, shownBand, api }); } finally { await lifecycle.dispose(); }
}

const label = () => doc.querySelector(".burrow-related-label")?.textContent;
const texts = (h) => h.bandRows().map((r) => r.textContent);

test("an empty [[ asks about the block's text without the token and shows three pages under Suggested", () => withSuggest({ value: "deep work and distraction [[|]]" }, async (h) => {
  assert.ok(await until(h.shownBand), "the band arrives");
  assert.deepEqual(h.calls, [{ text: "deep work and distraction" }]);
  assert.equal(label(), "Suggested");
  assert.deepEqual(texts(h), ["Deep Work", "distraction", "Notes"], "three rows, Notes and notes are one");
  assert.equal(h.strip.state.phase, "ARMED", "the band takes nothing");
  assert.equal(h.strip.state.active, -1);
  const enter = h.key({ key: "Enter" });
  assert.equal(enter.defaultPrevented, false, "Enter is Roam's");
  assert.equal(h.ta.value, "deep work and distraction [[]]");
  assert.equal(h.strip.debug.commits, 0);
}));

test("text on both sides of the caret is asked about, and a pick leaves it byte for byte", () => withSuggest({ value: "seed αβ 🙂 [[|]] tail" }, async (h) => {
  assert.ok(await until(h.shownBand));
  assert.equal(h.calls[0].text, "seed αβ 🙂  tail");
  h.altR();
  assert.equal(h.strip.state.phase, "RELATED");
  h.key({ key: "ArrowDown" });
  const enter = h.key({ key: "Enter" });
  assert.equal(enter.defaultPrevented, true);
  assert.equal(h.ta.value, "seed αβ 🙂 [[distraction]] tail");
}));

test("Tab inserts too; Esc goes back and the popup stays", () => withSuggest({ value: "deep work [[|]]" }, async (h) => {
  assert.ok(await until(h.shownBand));
  h.altR();
  assert.equal(h.key({ key: "Escape" }).defaultPrevented, true);
  assert.equal(h.strip.state.phase, "ARMED");
  assert.equal(h.ta.value, "deep work [[]]");
  h.altR();
  h.key({ key: "Tab" });
  assert.equal(h.ta.value, "deep work [[Deep Work]]");
}));

test("typing drops the band; back to the empty [[ the reply comes from the cache", () => withSuggest({ value: "deep work [[|]]" }, async (h) => {
  assert.ok(await until(h.shownBand));
  await h.type("deep work [[z");
  await settle();
  assert.equal(h.shownBand(), false);
  await sleep(30);
  assert.equal(h.calls.length, 1, "a word after [[ asks nothing");
  await h.type("deep work [[");
  assert.ok(await until(h.shownBand));
  assert.equal(h.calls.length, 1);
}));

test("off by default, and off means no call and no band", () => withSuggest({ value: "deep work [[|]]", overrides: { suggestRows: undefined } }, async (h) => {
  assert.equal(DEFAULTS.suggestRows, false);
  await sleep(40);
  assert.equal(h.calls.length, 0);
  assert.equal(h.shownBand(), false);
}));

test("no band for an empty block, #[[, a word after [[ or ((", async () => {
  for (const value of ["[[|]]", "ab [[|]]", "deep work #[[|]]", "deep work [[z|]]", "deep work ((|))"]) {
    await withSuggest({ value }, async (h) => {
      await sleep(40);
      assert.equal(h.calls.length, 0, value);
      assert.equal(h.shownBand(), false, value);
    });
  }
});

test("the page being edited, a page that is gone and Burrow's own rows are left out", () => withSuggest({ value: "deep work [[|]]", pageTitle: "deep work", reply: { suggestions: [{ title: "Deep Work" }, { title: "Gone Page" }, { title: "Focus" }] } }, async (h) => {
  assert.ok(await until(h.shownBand));
  assert.deepEqual(texts(h), ["Focus"]);
}));

test("a reply with no usable title, or none at all, draws nothing", async () => {
  for (const reply of [{ suggestions: [] }, {}, null, { suggestions: [{ title: 3 }, null] }]) {
    await withSuggest({ value: "deep work [[|]]", reply }, async (h) => {
      await sleep(40);
      assert.equal(h.calls.length, 1);
      assert.equal(h.shownBand(), false);
    });
  }
});

test("without the API, or when it throws, nothing shows and the keys stay Roam's", async () => {
  await withSuggest({ value: "deep work [[|]]", api: { data: { semanticSearchEnabled: () => false } } }, async (h) => {
    await sleep(40);
    assert.equal(h.shownBand(), false);
  });
  const lines = [];
  const debug = console.debug;
  console.debug = (...args) => lines.push(args.join(" "));
  try {
    await withSuggest({ value: "deep work [[|]]", api: { data: { semanticSearchEnabled: () => false, ai: { suggestLinks: async () => { throw new Error("no"); } } } } }, async (h) => {
      await sleep(40);
      assert.equal(h.shownBand(), false);
      assert.equal(h.altR().defaultPrevented, false);
    });
  } finally { console.debug = debug; }
  assert.deepEqual(lines, ["[burrow] suggested links failed no"]);
});

test("the hint line and the tip say suggested", () => withSuggest({ value: "deep work [[|]]" }, async (h) => {
  assert.ok(await until(h.shownBand));
  await settle();
  assert.match(doc.querySelector(".burrow-hints")?.textContent ?? "", /suggested/);
  assert.doesNotMatch(doc.querySelector(".burrow-hints")?.textContent ?? "", /related/);
}));

test("the switch going off during the pause asks nothing", async () => {
  const overrides = { suggestRows: true };
  await withSuggest({ value: "deep work [[|]]", overrides }, async (h) => {
    assert.ok(await until(h.shownBand));
  });
  const later = {};
  await withSuggest({ value: "deep work [[|]]", overrides: later, api: {} }, async (h) => {
    h.calls.length = 0;
    await h.type("deep word [[");
    later.suggestRows = false;
    await sleep(40);
    assert.equal(h.calls.length, 0);
  });
});
