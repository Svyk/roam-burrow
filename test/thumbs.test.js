import assert from "node:assert/strict";
import test, { after } from "node:test";

import { JSDOM } from "jsdom";

import { createLifecycle } from "../src/lifecycle.js";
import { createPreview, previewModel } from "../src/preview.js";
import { createThumbs, firstImage, isEncryptedUrl } from "../src/thumbs.js";

const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const doc = dom.window.document;
after(() => dom.window.close());

// A win whose timers run when the test says so, and whose object URLs are counted.
function stubWin() {
  const timers = new Map();
  let id = 0;
  const w = {
    made: 0, revoked: [],
    setTimeout(fn) { timers.set(++id, fn); return id; },
    clearTimeout(n) { timers.delete(n); },
    fire() { const all = [...timers.values()]; timers.clear(); all.forEach((fn) => fn()); },
    get pending() { return timers.size; },
    URL: { createObjectURL: () => `blob:${++w.made}`, revokeObjectURL: (u) => w.revoked.push(u) },
  };
  return w;
}
const blob = (size = 10) => ({ size });
const tick = () => new Promise((r) => setImmediate(r));
const host = () => { const el = doc.createElement("div"); doc.body.append(el); return el; };

function setup(over = {}) {
  const win = stubWin();
  const perf = { counters: {} };
  const gets = [];
  const api = { graph: { isEncrypted: true }, file: { get: over.get || (async ({ url }) => { gets.push(url); return blob(); }) } };
  const thumbs = createThumbs({ doc, win, api, perf, lifecycle: createLifecycle(), ...over.opts });
  return { win, perf, gets, thumbs, api };
}
const img = (url, alt = "", more = 0) => ({ url, alt, more });
const mount = (thumbs, image) => { const box = thumbs.box(image); host().append(box); return box; };

test("firstImage: first image, alt, further count", () => {
  assert.deepEqual(firstImage("a ![one](https://x/1.png) b ![two](http://x/2.png) ![](data:image/png;base64,AA)"), { url: "https://x/1.png", alt: "one", more: 2 });
  assert.equal(firstImage("no image [link](https://x)"), null);
  assert.equal(firstImage(null), null);
});

test("firstImage skips code, other schemes and relative urls", () => {
  assert.equal(firstImage("```\n![a](https://x/a.png)\n```"), null);
  assert.equal(firstImage("`![a](https://x/a.png)`"), null);
  assert.equal(firstImage("![a](javascript:alert(1)) ![b](/rel.png) ![c](rel.png)"), null);
  assert.deepEqual(firstImage("`![a](https://x/a.png)` ![b](https://x/b.png) ![c](javascript:x)"), { url: "https://x/b.png", alt: "b", more: 0 });
});

test("isEncryptedUrl looks at the path only", () => {
  assert.equal(isEncryptedUrl("https://f/o/foo.png.enc?alt=media&token=x"), true);
  assert.equal(isEncryptedUrl("https://f/o/foo%2Epng.ENC#h"), true);
  assert.equal(isEncryptedUrl("https://f/o/foo.png?x=.enc"), false);
});

test("box is reserved with +N", () => {
  const { thumbs } = setup();
  const box = thumbs.box(img("https://x/a.png", "a", 3));
  assert.equal(box.className, "burrow-thumb");
  assert.equal(box.dataset.state, "wait");
  assert.equal(box.querySelector(".burrow-thumb-more").textContent, "+3");
  assert.equal(thumbs.box(img("https://x/a.png")).querySelector(".burrow-thumb-more"), null);
});

test("dwell: nothing before 150 ms, a second want() replaces the first", () => {
  const { win, perf, thumbs } = setup({ opts: { encrypted: () => false } });
  const a = mount(thumbs, img("https://x/a.png"));
  const b = mount(thumbs, img("https://x/b.png"));
  thumbs.want(a, img("https://x/a.png"), "p");
  assert.equal(a.querySelector("img"), null);
  assert.equal(perf.counters.thumbLoads, undefined);
  thumbs.want(b, img("https://x/b.png"), "p");
  win.fire();
  assert.equal(perf.counters.thumbLoads, 1);
  assert.equal(a.querySelector("img"), null);
  assert.equal(b.querySelector("img").src, "https://x/b.png");
});

test("plain path: lazy img with src = url, loaded and failed states", () => {
  const { win, thumbs } = setup({ opts: { encrypted: () => false } });
  const a = mount(thumbs, img("https://x/a.png", "alt a", 1));
  thumbs.want(a, img("https://x/a.png", "alt a", 1), "p");
  win.fire();
  const el = a.querySelector("img.burrow-thumb-img");
  assert.equal(el.getAttribute("loading"), "lazy");
  assert.equal(el.getAttribute("src"), "https://x/a.png");
  assert.equal(a.dataset.state, "loading");
  el.dispatchEvent(new dom.window.Event("load"));
  assert.equal(a.dataset.state, "ok");
  el.dispatchEvent(new dom.window.Event("error"));
  assert.equal(a.dataset.state, "failed");
  assert.equal(a.querySelector(".burrow-label").textContent, "image alt a");
  assert.equal(a.querySelector(".burrow-thumb-more").textContent, "+1");
  assert.equal(a.querySelector("img"), null);
});

test("encrypted path: file.get, object URL, img shown", async () => {
  const { win, perf, gets, thumbs } = setup();
  const a = mount(thumbs, img("https://x/a.png"));
  thumbs.want(a, img("https://x/a.png"), "p");
  win.fire();
  await tick();
  assert.deepEqual(gets, ["https://x/a.png"]);
  assert.equal(a.querySelector("img").getAttribute("src"), "blob:1");
  assert.equal(perf.counters.thumbLoads, 1);
  assert.equal(perf.counters.thumbUrls, 1);
  const again = mount(thumbs, img("https://x/a.png"));
  thumbs.want(again, img("https://x/a.png"), "p");
  assert.equal(again.querySelector("img").getAttribute("src"), "blob:1");
  assert.equal(win.pending, 0);
  assert.equal(gets.length, 1);
});

test(".enc url takes the encrypted path in an unencrypted graph", async () => {
  const { win, gets, thumbs } = setup({ opts: { encrypted: () => false } });
  const a = mount(thumbs, img("https://x/a.png.enc?t=1"));
  thumbs.want(a, img("https://x/a.png.enc?t=1"), "p");
  win.fire();
  await tick();
  assert.equal(gets.length, 1);
  assert.equal(a.querySelector("img").getAttribute("src"), "blob:1");
});

test("a file over 5 MB fails with the label, no object URL", async () => {
  const { win, thumbs } = setup({ get: async () => blob(5 * 1024 * 1024 + 1) });
  const a = mount(thumbs, img("https://x/a.png", "big"));
  thumbs.want(a, img("https://x/a.png", "big"), "p");
  win.fire();
  await tick();
  assert.equal(a.dataset.state, "failed");
  assert.equal(a.querySelector(".burrow-label").textContent, "image big");
  assert.equal(win.made, 0);
  assert.equal(thumbs.live, 0);
});

test("a stale result is cached but not shown", async () => {
  let release;
  const { win, thumbs } = setup({ get: ({ url }) => (url.endsWith("a.png") ? new Promise((r) => { release = r; }) : Promise.resolve(blob())) });
  const a = mount(thumbs, img("https://x/a.png"));
  const b = mount(thumbs, img("https://x/b.png"));
  thumbs.want(a, img("https://x/a.png"), "p");
  win.fire();
  thumbs.want(b, img("https://x/b.png"), "p");
  release(blob());
  await tick();
  assert.equal(a.querySelector("img"), null);
  assert.equal(thumbs.live, 1);
  win.fire();
  await tick();
  assert.equal(thumbs.live, 2);
  assert.ok(b.querySelector("img"));
});

test("LRU of 8: the ninth url revokes the oldest", async () => {
  const { win, perf, thumbs } = setup();
  for (let i = 0; i < 9; i++) {
    const image = img(`https://x/${i}.png`);
    thumbs.want(mount(thumbs, image), image, "p");
    win.fire();
    await tick();
  }
  assert.equal(thumbs.live, 8);
  assert.deepEqual(win.revoked, ["blob:1"]);
  assert.equal(perf.counters.thumbUrls, 8);
});

test("clear() revokes everything and drops a late result", async () => {
  let release;
  const { win, perf, thumbs } = setup({ get: () => new Promise((r) => { release = r; }) });
  const a = mount(thumbs, img("https://x/a.png"));
  thumbs.want(a, img("https://x/a.png"), "p");
  win.fire();
  thumbs.clear();
  release(blob());
  await tick();
  assert.equal(win.made, 0);
  assert.equal(thumbs.live, 0);
  const c = setup();
  const b = mount(c.thumbs, img("https://x/b.png"));
  c.thumbs.want(b, img("https://x/b.png"), "p");
  c.win.fire();
  await tick();
  c.thumbs.clear();
  assert.deepEqual(c.win.revoked, ["blob:1"]);
  assert.equal(c.thumbs.live, 0);
  assert.equal(c.perf.counters.thumbUrls, 0);
  assert.equal(perf.counters.thumbUrls, 0);
});

test("file.get rejecting fails an .enc url and falls back to plain otherwise", async () => {
  const { win, thumbs } = setup({ get: async () => { throw new Error("nope"); } });
  const a = mount(thumbs, img("https://x/a.png.enc", "e"));
  thumbs.want(a, img("https://x/a.png.enc", "e"), "p");
  win.fire();
  await tick();
  assert.equal(a.dataset.state, "failed");
  assert.equal(a.querySelector(".burrow-label").textContent, "image e");
  const b = mount(thumbs, img("https://x/b.png"));
  thumbs.want(b, img("https://x/b.png"), "p");
  win.fire();
  await tick();
  assert.equal(b.querySelector("img").getAttribute("src"), "https://x/b.png");
});

test("cancel(owner) stops only that owner's pending request", () => {
  const { win, perf, thumbs } = setup({ opts: { encrypted: () => false } });
  const a = mount(thumbs, img("https://x/a.png"));
  thumbs.want(a, img("https://x/a.png"), "p");
  thumbs.cancel("q");
  assert.equal(win.pending, 1);
  thumbs.cancel("p");
  assert.equal(win.pending, 0);
  win.fire();
  assert.equal(perf.counters.thumbLoads, undefined);
});

test("previewModel: image only on the target, only with images:true", () => {
  const kids = { p: [{ uid: "a", string: "![x](https://x/a.png)", kids: [] }, { uid: "t", string: "see ![y](https://x/t.png) ![z](https://x/z.png)", kids: [{ uid: "c", string: "![k](https://x/k.png)", kids: [] }] }] };
  const tree = { children: (uid) => kids[uid] || [], trail: (uid) => (uid === "t" ? [{ uid: "p", title: "P" }] : []) };
  const result = { page: { uid: "p", title: "P" }, target: kids.p[1] };
  const on = previewModel(result, tree, (s) => s, { images: true });
  assert.deepEqual(on.items.filter((i) => i.image).map((i) => [i.uid, i.image.url, i.image.more]), [["t", "https://x/t.png", 1]]);
  assert.equal(previewModel(result, tree, (s) => s).items.some((i) => i.image), false);
});

test("preview: the box is reserved under the target, moves with it, hide() cancels", () => {
  const { win, perf, thumbs } = setup({ opts: { encrypted: () => false } });
  const preview = createPreview({ doc, win: dom.window, lifecycle: createLifecycle(), thumbs });
  const pop = host();
  const item = (uid, target, image) => ({ uid, text: uid, string: uid, depth: 0, heading: 0, target, ...(image ? { image } : {}) });
  const m1 = { key: "k1", trail: ["P"], items: [item("a", false), item("b", true, img("https://x/b.png", "b", 2)), item("c", false)] };
  preview.show(m1, pop);
  const boxes = () => [...preview.node.querySelectorAll(".burrow-thumb")];
  assert.equal(preview.node.querySelectorAll(".burrow-target .burrow-thumb").length, 1);
  assert.equal(boxes()[0].dataset.state, "wait");
  assert.equal(boxes()[0].querySelector(".burrow-thumb-more").textContent, "+2");
  assert.equal(win.pending, 1);
  const m2 = { key: "k2", trail: ["P"], items: [item("a", true, img("https://x/a.png")), item("b", false, img("https://x/b.png")), item("c", false)] };
  preview.show(m2, pop);
  const rows = [...preview.node.querySelectorAll(".burrow-node")];
  assert.equal(boxes().length, 1);
  assert.ok(rows[0].querySelector(".burrow-thumb"));
  assert.equal(rows[1].querySelector(".burrow-thumb"), null);
  assert.equal(win.pending, 1);
  preview.show({ key: "k3", trail: ["P"], items: [item("a", false), item("b", false)] }, pop);
  assert.equal(boxes().length, 0);
  assert.equal(win.pending, 0);
  preview.show(m1, pop);
  assert.equal(win.pending, 1);
  preview.hide();
  assert.equal(win.pending, 0);
  assert.equal(boxes().length, 0);
  assert.equal(perf.counters.thumbLoads, undefined);
});

// Drives createPreview + createThumbs the way strip.js does: a row change cancels, then the same model is shown again.
function previewRig(over = {}) {
  const rig = setup(over);
  const preview = createPreview({ doc, win: dom.window, lifecycle: createLifecycle(), thumbs: rig.thumbs });
  const pop = host();
  const model = { key: "kA", trail: ["P"], items: [{ uid: "a", text: "a", string: "a", depth: 0, heading: 0, target: true, image: img("https://x/a.png", "a") }] };
  const box = () => preview.node.querySelector(".burrow-thumb");
  return { ...rig, preview, pop, model, box };
}

test("re-show of the same model after cancel() re-arms the plain thumbnail", () => {
  const { win, perf, thumbs, preview, pop, model, box } = previewRig({ opts: { encrypted: () => false } });
  preview.show(model, pop);
  assert.equal(box().dataset.state, "wait");
  thumbs.cancel();
  assert.equal(win.pending, 0);
  preview.show(model, pop);
  assert.equal(win.pending, 1);
  win.fire();
  assert.equal(box().querySelector("img").getAttribute("src"), "https://x/a.png");
  assert.equal(perf.counters.thumbLoads, 1);
  preview.show(model, pop);
  assert.equal(win.pending, 0, "a drawn box is left alone");
});

test("re-show while pending does not restart the dwell", () => {
  const { win, preview, pop, model } = previewRig({ opts: { encrypted: () => false } });
  preview.show(model, pop);
  preview.show(model, pop);
  preview.fill(model, pop);
  assert.equal(win.pending, 1);
});

test("encrypted: cancel() during file.get, then re-show, shows the one download", async () => {
  let release;
  let calls = 0;
  const { win, perf, thumbs, preview, pop, model, box } = previewRig({ get: () => { calls++; return new Promise((r) => { release = r; }); } });
  preview.show(model, pop);
  win.fire();
  assert.equal(calls, 1);
  assert.equal(box().dataset.state, "loading");
  thumbs.cancel();
  preview.show(model, pop);
  win.fire();
  assert.equal(calls, 1, "attached to the download in flight");
  release(blob());
  await tick();
  assert.equal(box().querySelector("img").getAttribute("src"), "blob:1");
  assert.equal(calls, 1);
  assert.equal(perf.counters.thumbLoads, 1);
  assert.equal(thumbs.live, 1);
  assert.equal(win.made, 1);
});

test("encrypted: the result lands in the re-armed box before its dwell fires", async () => {
  let release;
  const { win, thumbs, preview, pop, model, box } = previewRig({ get: () => new Promise((r) => { release = r; }) });
  preview.show(model, pop);
  win.fire();
  thumbs.cancel();
  preview.show(model, pop);
  release(blob());
  await tick();
  assert.equal(box().querySelector("img").getAttribute("src"), "blob:1");
  assert.equal(win.pending, 0, "the dwell is stopped once the image shows");
});

test("clear() with a download in flight: no object URL, and a new request downloads again", async () => {
  const releases = [];
  let calls = 0;
  const { win, thumbs } = setup({ get: () => { calls++; return new Promise((r) => releases.push(r)); } });
  const a = mount(thumbs, img("https://x/a.png"));
  thumbs.want(a, img("https://x/a.png"), "p");
  win.fire();
  thumbs.clear();
  const b = mount(thumbs, img("https://x/a.png"));
  thumbs.want(b, img("https://x/a.png"), "p");
  win.fire();
  assert.equal(calls, 2);
  releases[0](blob());
  await tick();
  assert.equal(win.made, 0);
  releases[1](blob());
  await tick();
  assert.equal(win.made, 1);
  assert.ok(b.querySelector("img"));
});

test("file.get rejecting on a plain url counts one download for the highlight", async () => {
  const { win, perf, thumbs } = setup({ get: async () => { throw new Error("nope"); } });
  const a = mount(thumbs, img("https://x/a.png"));
  thumbs.want(a, img("https://x/a.png"), "p");
  win.fire();
  await tick();
  assert.equal(a.querySelector("img").getAttribute("src"), "https://x/a.png");
  assert.equal(perf.counters.thumbLoads, 1);
});
