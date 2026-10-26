import assert from "node:assert/strict";
import test from "node:test";

import { codeLine, createRichCache, plainText, renderParts, richParts, snippet } from "../src/rich.js";

const L = (text) => ({ text, cls: "burrow-label" });
const P = (text, cls = "") => ({ text, cls });
const SVY_CODE = "```r\n# Load required libraries\nlibrary(ggplot2)\nlibrary(dplyr)\n# panel\ntheme(panel.grid = element_blank())\n```";

function fakeDoc() {
  const made = [];
  const node = (tag) => ({
    tag, className: "", attrs: {}, kids: [], _text: "",
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...k) { this.kids.push(...k); },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text + this.kids.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); },
  });
  return {
    made,
    createElement: (tag) => { const el = node(tag); made.push(el); return el; },
    createDocumentFragment: () => node("#fragment"),
  };
}

test("the svy code block is a language label and its first code line", () => {
  const parts = richParts(SVY_CODE);
  assert.deepEqual(parts, [L("R"), P("library(ggplot2)", "burrow-code")]);
  assert.ok(!plainText(parts).includes("```") && !plainText(parts).includes("#"));
  assert.equal(plainText(parts), "R library(ggplot2)");
});

test("prose before a fence, then label and line; codeLine and needle pick the matching line", () => {
  assert.deepEqual(richParts("Plot it:\n" + SVY_CODE), [P("Plot it: "), L("R"), P("library(ggplot2)", "burrow-code")]);
  const body = "# c\nlibrary(ggplot2)\ntheme(panel.grid = 1)\n";
  assert.equal(codeLine(body), "library(ggplot2)");
  assert.equal(codeLine(body, /panel/gi), "theme(panel.grid = 1)");
  assert.equal(codeLine("# a\n\n# b"), "# a");
  assert.equal(codeLine("  \n"), "");
  assert.deepEqual(richParts(SVY_CODE, { needle: /panel\.grid/gi }), [L("R"), P("theme(panel.grid = element_blank())", "burrow-code")]);
});

test("code block labels and edge cases", () => {
  assert.deepEqual(richParts("```\nx <- 1\n```"), [L("code"), P("x <- 1", "burrow-code")]);
  assert.deepEqual(richParts("```javascript\nlet a\n```")[0], L("JS"));
  assert.deepEqual(richParts("```rust\nfn main\n```")[0], L("Rust"));
  assert.deepEqual(richParts("```go\nfunc\n```")[0], L("GO"));
  assert.deepEqual(richParts("```r\nlibrary(a)"), [L("R"), P("library(a)", "burrow-code")]);
  assert.deepEqual(richParts("```r\n```"), [L("R")]);
});

test("a task macro is a task part where it sits", () => {
  assert.deepEqual(richParts("{{[[TODO]]}} Watch [[Black Panther]]"), [{ task: "todo" }, P("Watch "), P("Black Panther", "burrow-ref")]);
  assert.deepEqual(richParts("{{[[DONE]]:((4Szp96jw2))}} read"), [{ task: "done" }, P("read")]);
});

test("bold, italic, highlight, strike, inline code; styles combine; unmatched marker is text", () => {
  assert.deepEqual(richParts("**bold** __it__ ^^hl^^ ~~gone~~ `x()`"), [
    P("bold", "burrow-b"), P(" "), P("it", "burrow-i"), P(" "), P("hl", "burrow-hl"), P(" "), P("gone", "burrow-s"), P(" "), P("x()", "burrow-code"),
  ]);
  assert.deepEqual(richParts("**[[Page]]**"), [P("Page", "burrow-ref burrow-b")]);
  assert.deepEqual(richParts("a ** b"), [P("a ** b")]);
  assert.deepEqual(richParts("**#tag**"), [P("#tag", "burrow-tag burrow-b")]);
  assert.deepEqual(richParts("$$x^2$$"), [P("x^2", "burrow-code")]);
  assert.deepEqual(richParts("a `open"), [P("a `open")]);
});

test("tags and nested refs", () => {
  assert.deepEqual(richParts("#tag"), [P("#tag", "burrow-tag")]);
  assert.deepEqual(richParts("#[[Long Tag]]"), [P("#Long Tag", "burrow-tag")]);
  assert.deepEqual(richParts("(#tag)"), [P("("), P("#tag", "burrow-tag"), P(")")]);
  assert.deepEqual(richParts("C#"), [P("C#")]);
  assert.deepEqual(richParts("issue#4"), [P("issue#4")]);
  assert.deepEqual(richParts("#42."), [P("#42", "burrow-tag"), P(".")]);
  assert.deepEqual(richParts("[[a [[b]] c]]"), [P("a b c", "burrow-ref")]);
});

test("block refs resolve one level; links, files and images", () => {
  const resolve = (uid) => ({ abcdefghi: "see **it** ((zzzzzzzzz))" })[uid] ?? null;
  assert.deepEqual(richParts("((abcdefghi))", { resolve }), [P("see it ((zzzzzzzzz))", "burrow-bref")]);
  assert.deepEqual(richParts("((abcdefghi))"), [P("((abcdefghi))", "burrow-bref")]);
  assert.deepEqual(richParts("[alias]([[Page]])"), [P("alias", "burrow-ref")]);
  assert.deepEqual(richParts("[alias](((abcdefghi)))"), [P("alias", "burrow-bref")]);
  assert.deepEqual(richParts("[site](https://x.org)"), [P("site", "burrow-link")]);
  assert.deepEqual(richParts("[report.pdf](https://firebasestorage.googleapis.com/x.pdf)"), [L("file"), P("report.pdf", "burrow-link")]);
  assert.deepEqual(richParts("![a](https://e.com/z.png)"), [L("image")]);
  assert.deepEqual(richParts("a [b c"), [P("a [b c")]);
});

test("macros become labels", () => {
  const resolve = (uid) => (uid === "abcdefghi" ? "inner {{[[embed]]: ((abcdefghi))}} and ((qqqqqqqqq))" : null);
  const parts = richParts("{{embed: ((abcdefghi))}}", { resolve });
  assert.deepEqual(parts, [L("embed"), P("inner "), L("embed"), P(" and "), P("((qqqqqqqqq))", "burrow-bref")]);
  assert.deepEqual(richParts('{{[[roam/render]]:((roam-render-Nautilus-Log-cljs)) 22 15 5 "" 21}}'), [L("render")]);
  assert.deepEqual(richParts("{{[[query]]: {and: [[a]] [[b]]}}}"), [L("query")]);
  assert.deepEqual(richParts("{{⇥🕞:SmartBlock:Elapsed time}}"), [L("⇥🕞")]);
  assert.deepEqual(richParts("{{TODO today:SmartBlock:TODO today}}"), [L("TODO today")]);
  assert.deepEqual(richParts("{{[[table]]}}"), [L("table")]);
  assert.deepEqual(richParts("{{word-count}}"), [L("word-count")]);
  assert.deepEqual(richParts("{{[[∆]]:1+2}}"), [L("∆")]);
  assert.deepEqual(richParts("{{[[youtube]]: https://y}} x"), [L("video"), P(" x")]);
  assert.deepEqual(richParts("{{abc"), [P("{{abc")]);
  assert.deepEqual(richParts(":hiccup [:div]"), [L("hiccup")]);
});

test("attributes and block quotes", () => {
  assert.deepEqual(richParts("Status:: active"), [P("Status:", "burrow-attr"), P("active")]);
  assert.equal(plainText(richParts("Status:: active")), "Status: active");
  assert.deepEqual(richParts("> quoted  \n text"), [P("quoted text")]);
});

test("rendering is text nodes in spans only; HTML stays text", () => {
  const doc = fakeDoc();
  const frag = renderParts(doc, richParts("<img src=x onerror=alert(1)> <script>x</script> {{[[TODO]]}} **b** {{[[table]]}}"));
  assert.ok(frag.textContent.includes("<img"));
  assert.ok(doc.made.every((el) => el.tag === "span"));
  for (const el of doc.made) for (const k of Object.keys(el.attrs)) assert.ok(["class", "role", "aria-label"].includes(k), k);
  assert.equal(doc.made.length, 3);
});

test("renderParts highlights plain and styled text, not labels", () => {
  const doc = fakeDoc();
  const seen = [];
  renderParts(doc, [P("a"), P("b", "burrow-ref"), L("R")], (t) => { seen.push(t); return t; });
  assert.deepEqual(seen, ["a", "b"]);
});

test("snippet cuts around a late match and leaves early ones", () => {
  const words = Array.from({ length: 60 }, (_, i) => `w${String(i).padStart(2, "0")}`).join(" ");
  const parts = [{ task: "todo" }, L("R"), P(words)];
  const at = words.indexOf("w40");
  const out = snippet(parts, /w40/gi);
  assert.deepEqual(out[0], { task: "todo" });
  assert.equal(out[1].text, "…");
  assert.ok(!out.some((p) => p.cls === "burrow-label"));
  const rest = out[2].text;
  assert.ok(rest.indexOf("w40") < 44 && rest.indexOf("w40") >= 0);
  assert.ok(at > 100);
  assert.equal(snippet(parts, /w01/gi), parts);
  assert.equal(snippet(parts, null), parts);
});

test("cache makes once per uid+string, evicts the oldest, clears", () => {
  const cache = createRichCache(2);
  let made = 0;
  const make = () => ++made;
  assert.equal(cache.get("u", "a", make), 1);
  assert.equal(cache.get("u", "a", make), 1);
  assert.equal(cache.get("u", "b", make), 2);
  assert.equal(cache.get("v", "a", make), 3);
  assert.equal(cache.size, 2);
  assert.equal(cache.get("u", "a", make), 4);
  cache.clear();
  assert.equal(cache.size, 0);
});

test("cost guard: a 90 KB code block parses in under 5 ms", () => {
  const body = "# Load required libraries\n" + "library(ggplot2)\nlibrary(dplyr)\n".repeat(3000);
  const big = "```r\n" + body + "```";
  assert.ok(big.length >= 90000);
  const times = [];
  for (let i = 0; i < 20; i++) { const t = performance.now(); richParts(big); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  const median = times[10];
  const t = performance.now();
  for (let i = 0; i < 1000; i++) richParts("{{[[TODO]]}} Watch [[Black Panther]] with **friends** #movie ((abcdefghi)) now");
  console.log(`90KB median ${median.toFixed(3)} ms; 80-char block ${((performance.now() - t) / 1000).toFixed(4)} ms`);
  assert.ok(median < 5, `median ${median}`);
});
