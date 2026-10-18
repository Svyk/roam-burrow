import { aliasInsertion, matchAliases, roamAliasesWillList } from "./aliases.js";
import { parseDrill, resolveDrill } from "./drill.js";
import { createTreeSource } from "./pagetree.js";
import { createPreview, DRILL_CLASS, previewModel } from "./preview.js";
import { rankRefs } from "./refindex.js";
import { searchPlan, stripRoamMarkup } from "./search.js";
import { isDarkHost } from "./theme.js";
import { applyToken, findToken, tokenStillValid } from "./token.js";

const POPUP = ".rm-autocomplete__results";
const NATIVE_ROWS = ".rm-autocomplete__results-scroll > div";
const OWNS = "burrow-owns-selection";
const PAD_CLASSES = ["burrow-pad-1", "burrow-pad-2", "burrow-pad-3"];
const ROW_LIMIT = 3;
const MIN_REF_QUERY = 3;
const MIN_ALIAS_QUERY = 2;
const POPUP_WAIT_FRAMES = 12;
const valueSetter = Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement?.prototype || {}, "value")?.set;

// Keyboard ownership (spec §4):
//   IDLE  - nothing shown, no key consumed.
//   ARMED - strip shown, Roam's popup holds selection, no key consumed except
//           ↑ from Roam's first row, which moves selection into the strip.
//   OWNED - a strip row is active; Burrow consumes ↑ ↓ Enter Tab only.
// Drill (spec §5) is OWNED with one row, the block the expression resolves
// to: Enter and Tab insert it, ↑ and ↓ do nothing (no arrow keys in the
// preview), Esc passes through. Deleting the `#` or `>` ends drill mode.
export function createStrip({ setting, indexes, perf, lifecycle, api, picks = null, doc = document, win = window }) {
  const st = {
    phase: "IDLE", ta: null, token: null, uid: null, rows: [], active: -1, drill: null, pageTitle: null,
    pop: null, composing: false, ignoreNextInput: false, released: null, waitFrame: 0, observers: [],
  };
  const debug = { lastFailure: null, commits: 0, trace: [] };
  const trace = (event) => {
    debug.trace.push({ t: Math.round(performance.now()), ...event });
    if (debug.trace.length > 60) debug.trace.shift();
  };

  const strip = doc.createElement("div");
  strip.className = "burrow-strip";
  strip.setAttribute("role", "listbox");
  strip.hidden = true;
  lifecycle.node(strip, doc.body);
  const preview = createPreview({ doc, win, lifecycle });
  const fast = api.data?.fast?.q ? (query, ...args) => api.data.fast.q(query, ...args) : (query, ...args) => api.q(query, ...args);
  const tree = createTreeSource({
    pull: (pattern, eid) => api.pull(pattern, eid),
    q: fast,
    onFetch: (kind) => { perf.counters[kind === "query" ? "drillQueries" : "drillPulls"] = (perf.counters[kind === "query" ? "drillQueries" : "drillPulls"] || 0) + 1; },
  });

  const anyFeature = () => setting("aliasPages") || setting("refRanking") || setting("drill");
  const isBlockInput = (el) => el?.tagName === "TEXTAREA" && el.classList.contains("rm-block-input");

  // ---- ranking (the per-key cost) ----

  function rank(token) {
    st.drill = null;
    const recall = setting("betterMatch");
    if (token.kind === "[[" && setting("drill") && st.ta?.value[token.start - 1] !== "#") {
      const parsed = parseDrill(token.query, indexes.titles);
      if (parsed) {
        const result = resolveDrill(parsed, tree, { strict: !recall });
        st.drill = { ...result, key: `${result.page.uid}:${result.target?.uid ?? ""}` };
        return [drillRow(result)];
      }
    }
    const plan = searchPlan(token.query);
    if (!plan) return [];
    const compact = plan.clauses.reduce((n, c) => n + c.compact.length, 0);
    const memory = setting("pickMemory") ? picks : null;
    if (token.kind === "((") {
      if (!setting("refRanking") || compact < MIN_REF_QUERY) return [];
      return rankRefs(indexes.refs, plan, {
        limit: ROW_LIMIT, recall, aliasExpand: setting("aliasExpand"),
        picked: memory?.lookup("ref", token.query), currentPage: setting("pageBoost") ? st.pageTitle : null,
      })
        .map((hit) => ({
          kind: "ref", key: `ref:${hit.uid}`, uid: hit.uid, refs: hit.refs, level: hit.level,
          text: displayText(hit.string), insertion: `((${hit.uid}))`, pick: hit.uid,
        }));
    }
    if (!setting("aliasPages") || compact < MIN_ALIAS_QUERY) return [];
    if (st.ta?.value[token.start - 1] === "#") return [];
    const format = setting("aliasLinkFormat");
    // No cut here: visibleRows drops rows Roam or roam-aliases already show,
    // and a cut before that could hide a row nobody else lists.
    return matchAliases(indexes.aliases, plan, { strict: !recall, limit: Infinity, picked: memory?.lookup("alias", token.query) })
      .map((hit) => ({
        kind: "alias", key: `alias:${hit.uid}:${hit.alias}`, uid: hit.uid, alias: hit.alias, title: hit.title,
        level: hit.level, insertion: aliasInsertion(hit, format), seenByRoamAliases: hit.seenByRoamAliases,
        pick: `${hit.uid}:${hit.alias}`,
      }));
  }

  function drillRow(result) {
    const { page, target } = result;
    let crumb = page.title;
    if (target) {
      const parents = tree.trail(target.uid);
      if (parents.length > 1) crumb = readableText(parents[parents.length - 1].string);
    }
    return {
      kind: "drill", key: `drill:${result.insertion}`, uid: target?.uid ?? page.uid, level: 3, insertion: result.insertion,
      crumb: target ? crumb : null, text: target ? readableText(target.string) : page.title,
    };
  }

  // Block text as a reader sees it, for the drill row and the preview:
  // links keep their words, markup goes.
  function readableText(string) {
    const byUid = indexes.refs?.byUid;
    return String(string ?? "")
      .replace(/\(\(([\w-]{9})\)\)/g, (m, uid) => byUid?.get(uid)?.string ?? tree.get(uid)?.string ?? m)
      .replace(/^\s*([^:\n`]{1,80})::/, "$1:")
      .replace(/\{\{\[\[(TODO|DONE)\]\]\}\}\s*/g, "")
      .replace(/\[([^\]]*)\]\(\[\[[^\]]*\]\]\)/g, "$1")
      .replace(/#?\[\[([^\]]*)\]\]/g, "$1")
      .replace(/\*\*|\^\^|__|~~/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function displayText(string) {
    const byUid = indexes.refs?.byUid;
    const resolved = string.replace(/\(\(([\w-]{9})\)\)/g, (m, uid) => byUid?.get(uid)?.string ?? m);
    return stripRoamMarkup(resolved).replace(/\s+/g, " ").trim();
  }

  // Rows Roam or roam-aliases already show are not drawn twice.
  // roam-aliases is detected by its stylesheet (found once, at idle, and
  // trusted only while that node is still in the document, so disabling
  // roam-aliases brings Burrow's rows back) or by a `.rm-aliases` node it
  // has put in the current popover.
  // The same idle pass reads Roam's block-highlight color for the preview.
  let roamAliasesSheet = null;
  let blockHighlight = null;
  const detectRoamAliases = () => {
    for (const sheet of doc.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (!blockHighlight && rule.selectorText === ".block-highlight-blue" && rule.style?.backgroundColor) {
          blockHighlight = rule.style.backgroundColor;
        }
        if (!roamAliasesSheet && rule.selectorText?.includes(".rm-aliases")) roamAliasesSheet = sheet.ownerNode;
      }
    }
  };
  let detectId = null;
  const scheduleDetect = () => {
    if (detectId != null || typeof win.requestIdleCallback !== "function") return;
    detectId = win.requestIdleCallback(() => {
      detectId = null;
      try { detectRoamAliases(); } catch { /* keep DOM fallback */ }
    }, { timeout: 5000 });
  };
  scheduleDetect();
  lifecycle.add(() => { if (detectId != null) win.cancelIdleCallback(detectId); });

  function visibleRows() {
    if (!st.pop) return [];
    if (st.token?.kind !== "[[" || st.drill) return st.rows.slice(0, ROW_LIMIT);
    const nativeTitles = new Set();
    for (const row of st.pop.querySelectorAll(NATIVE_ROWS)) {
      const title = row.getAttribute("title");
      if (title) nativeTitles.add(title.toLowerCase());
    }
    const listed = new Set();
    for (const button of st.pop.querySelectorAll(".rm-aliases .rm-autocomplete-result")) {
      const m = button.textContent.match(/^\[(.*)\]\(\[\[(.*)\]\]\)$/s);
      if (m) listed.add(`${m[1].toLowerCase()}\u0000${m[2].toLowerCase()}`);
    }
    if (roamAliasesSheet && !roamAliasesSheet.isConnected) { roamAliasesSheet = null; scheduleDetect(); }
    const roamAliasesPresent = Boolean(roamAliasesSheet) || Boolean(st.pop.querySelector(".rm-aliases"));
    const query = st.token.query;
    return st.rows.filter((row) => !nativeTitles.has(row.title.toLowerCase())
      && !(roamAliasesPresent && roamAliasesWillList(row, query))
      && !listed.has(`${row.alias.toLowerCase()}\u0000${row.title.toLowerCase()}`)).slice(0, ROW_LIMIT);
  }

  // ---- rendering ----

  let shown = [];
  let shownQuery = null;
  function render() {
    const rows = visibleRows();
    const query = st.token?.query ?? null;
    const same = query === shownQuery && rows.length === shown.length && rows.every((row, i) => row.key === shown[i].key);
    if (!same) {
      strip.replaceChildren(...rows.map((row, i) => rowNode(row, i)));
      shown = rows;
      shownQuery = query;
    }
    if (!rows.length) {
      hideStrip();
      if (st.phase !== "IDLE") st.phase = "ARMED";
      return;
    }
    if (st.phase === "IDLE") st.phase = "ARMED";
    if (st.active >= rows.length) st.active = rows.length - 1;
    const preselect = (rows[0].kind === "drill" || (st.token.kind === "((" && setting("refPreselect") && rows[0].level >= 2))
      && st.released !== releaseKey();
    if (st.phase === "ARMED" && preselect && st.active < 0) own(0);
    place(rows.length);
    paintActive();
    showPreview();
  }

  let model = null;
  function showPreview() {
    if (!st.drill || !setting("drillPreview") || !st.pop) { preview.hide(); return; }
    if (model?.drillKey !== st.drill.key) {
      model = previewModel(st.drill, tree, readableText);
      model.drillKey = st.drill.key;
    }
    preview.show(model, st.pop);
  }

  function rowNode(row, i) {
    const node = doc.createElement("div");
    node.className = "burrow-row";
    node.setAttribute("role", "option");
    node.dataset.index = String(i);
    const text = doc.createElement("span");
    text.className = "burrow-text";
    if (row.kind === "alias") {
      text.append(highlight(row.alias), Object.assign(doc.createElement("span"), { className: "burrow-arrow", textContent: " ↳ " }), row.title);
      node.title = `${row.alias} → ${row.title}`;
    } else if (row.kind === "drill") {
      if (row.crumb) text.append(Object.assign(doc.createElement("span"), { className: "burrow-trail-inline", textContent: `${row.crumb} › ` }));
      text.append(row.text);
      node.title = row.crumb ? `${row.crumb} › ${row.text}` : row.text;
    } else {
      text.append(highlight(row.text));
      node.title = row.text;
    }
    node.append(text);
    if (row.kind === "ref") {
      const count = doc.createElement("sup");
      count.className = "rm-autocomplete__ref-count";
      count.textContent = String(row.refs);
      count.title = `${row.refs} block reference${row.refs === 1 ? "" : "s"}`;
      node.append(count);
    }
    return node;
  }

  function highlight(text) {
    const fragment = doc.createDocumentFragment();
    const words = (st.token?.query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1);
    if (!words.length) { fragment.append(text); return fragment; }
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${words.map(escapeRe).join("|")})`, "giu");
    let at = 0;
    for (const m of text.matchAll(re)) {
      fragment.append(text.slice(at, m.index));
      fragment.append(Object.assign(doc.createElement("span"), { className: "rm-search-match", textContent: m[0] }));
      at = m.index + m[0].length;
    }
    fragment.append(text.slice(at));
    return fragment;
  }

  function paintActive() {
    strip.querySelectorAll(".burrow-row").forEach((node, i) => {
      node.classList.toggle("burrow-active", st.phase === "OWNED" && i === st.active);
      node.setAttribute("aria-selected", String(st.phase === "OWNED" && i === st.active));
    });
    st.pop?.classList.toggle(OWNS, st.phase === "OWNED");
  }

  // The strip overlays the top of Roam's popover; a reversible padding class
  // on the popover makes room so no native row is covered.
  function place(count) {
    const pop = st.pop;
    for (const cls of PAD_CLASSES) pop.classList.toggle(cls, cls === PAD_CLASSES[count - 1]);
    const rect = pop.getBoundingClientRect();
    strip.style.left = `${Math.round(rect.left)}px`;
    strip.style.top = `${Math.round(rect.top)}px`;
    strip.style.width = `${Math.round(rect.width)}px`;
    strip.hidden = false;
  }

  function sampleTheme(pop) {
    const cs = win.getComputedStyle(pop);
    strip.style.setProperty("--burrow-bg", cs.backgroundColor);
    strip.style.setProperty("--burrow-fg", cs.color);
    strip.style.zIndex = String((Number.parseInt(cs.zIndex, 10) || 20) + 1);
    const firstRow = pop.querySelector(`${NATIVE_ROWS} .rm-autocomplete-result`);
    strip.style.font = firstRow ? win.getComputedStyle(firstRow).font : cs.font;
    const activeRow = [...pop.querySelectorAll(NATIVE_ROWS)].find((row) => row.style.backgroundColor);
    if (activeRow) strip.style.setProperty("--burrow-active", win.getComputedStyle(activeRow).backgroundColor);
    else strip.style.removeProperty("--burrow-active");
    const dark = isDarkHost(doc);
    strip.classList.toggle("burrow-dark", dark);
    for (const name of ["--burrow-bg", "--burrow-fg"]) preview.node.style.setProperty(name, strip.style.getPropertyValue(name));
    preview.node.style.zIndex = strip.style.zIndex;
    preview.node.style.font = strip.style.font;
    // Roam's block highlight, as Roam paints a selected block. A dark theme
    // can make it an opaque light blue under light text, so there it is
    // diluted to keep the text readable.
    if (blockHighlight) preview.node.style.setProperty("--burrow-highlight", dark ? `color-mix(in srgb, ${blockHighlight} 28%, transparent)` : blockHighlight);
    else preview.node.style.removeProperty("--burrow-highlight");
    preview.node.classList.toggle("burrow-dark", dark);
  }

  function hideStrip() {
    strip.hidden = true;
    preview.hide();
    if (st.pop) {
      st.pop.classList.remove(OWNS, DRILL_CLASS, ...PAD_CLASSES);
    }
  }

  // ---- popup attach / detach ----

  function attach(pop) {
    if (st.pop === pop) return;
    detach();
    st.pop = pop;
    sampleTheme(pop);
    const mo = new MutationObserver(() => { if (st.pop === pop && st.phase !== "IDLE") frame(); });
    mo.observe(pop, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    // Roam swaps the popover element on some updates (native arrow keys), so a
    // disconnect only means "closed" when no replacement popover exists.
    const gone = new MutationObserver(() => {
      if (pop.isConnected || st.pop !== pop) return;
      if (doc.activeElement === st.ta && doc.querySelector(POPUP)) {
        trace({ ev: "popup-swapped" });
        detach();
        frame();
      } else {
        reset("popup-closed");
      }
    });
    gone.observe(pop.parentNode, { childList: true });
    st.observers = [mo, gone];
    indexes.refreshIfStale();
  }

  function detach() {
    for (const observer of st.observers) observer.disconnect();
    st.observers = [];
    preview.hide();
    if (st.pop) st.pop.classList.remove(OWNS, DRILL_CLASS, ...PAD_CLASSES);
    st.pop = null;
  }

  let frameQueued = false;
  function frame() {
    if (frameQueued) return;
    frameQueued = true;
    win.requestAnimationFrame(() => {
      if (frameQueued) draw();
    });
  }

  function draw() {
    frameQueued = false;
    if (st.phase === "IDLE" && !st.rows.length) return;
    const pop = st.pop?.isConnected ? st.pop : doc.querySelector(POPUP);
    if (!pop) {
      if (st.waitFrame++ < POPUP_WAIT_FRAMES) frame();
      else reset("no-popup");
      return;
    }
    st.waitFrame = 0;
    attach(pop);
    perf.time("render", render);
  }

  // Ranking runs right after the frame that shows the typed character
  // (a message posted from requestAnimationFrame), so it never delays that
  // paint. A key Burrow may act on (Enter, Tab, arrows, Esc) flushes it first.
  let pendingTa = null;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => flush();
  lifecycle.add(() => { pendingTa = null; channel.port1.close(); });

  function scheduleEvaluate(ta) {
    const queued = pendingTa != null;
    pendingTa = ta;
    if (!queued) win.requestAnimationFrame(() => channel.port2.postMessage(0));
  }

  function flush() {
    const ta = pendingTa;
    if (!ta || lifecycle.disposed) return;
    pendingTa = null;
    perf.time("input", () => {
      evaluate(ta);
      if (frameQueued) draw();
    });
  }

  function reset(reason) {
    if (st.phase !== "IDLE" || st.rows.length) trace({ ev: "reset", reason });
    st.phase = "IDLE";
    st.rows = [];
    st.active = -1;
    st.token = null;
    st.released = null;
    st.drill = null;
    model = null;
    tree.clear();
    shown = [];
    shownQuery = null;
    strip.replaceChildren();
    hideStrip();
    detach();
  }

  function own(index) {
    st.phase = "OWNED";
    st.active = index;
    trace({ ev: "own", index });
  }

  function release() {
    st.phase = "ARMED";
    st.active = -1;
    st.released = releaseKey();
    trace({ ev: "release" });
  }

  const releaseKey = () => (st.ta && st.token ? `${st.ta.id}:${st.token.start}` : null);

  // ---- input ----

  function evaluate(ta) {
    if (!anyFeature() || st.composing) return reset("off");
    if (ta.selectionStart !== ta.selectionEnd) return reset("selection");
    const token = findToken(ta.value, ta.selectionStart);
    if (!token) return reset("no-token");
    if (st.ta !== ta || st.token?.start !== token.start) {
      st.uid = api.ui.getFocusedBlock?.()?.["block-uid"] ?? null;
      st.pageTitle = ta.closest?.("[data-page-title]")?.getAttribute("data-page-title") ?? null;
      st.active = -1;
      if (st.phase === "OWNED") st.phase = "ARMED";
    }
    st.ta = ta;
    st.token = token;
    st.rows = rank(token);
    if (!st.rows.length) {
      if (st.phase !== "IDLE") { st.phase = "ARMED"; st.active = -1; shown = []; strip.replaceChildren(); hideStrip(); }
      return;
    }
    if (st.phase === "OWNED") st.active = 0;
    if (st.phase === "IDLE") st.phase = "ARMED";
    frame();
  }

  function onInput(event) {
    const ta = event.target;
    if (!isBlockInput(ta)) return;
    if (st.ignoreNextInput) { st.ignoreNextInput = false; return; }
    if (!anyFeature()) { if (st.phase !== "IDLE") reset("off"); return; }
    scheduleEvaluate(ta);
  }

  // ---- keyboard ----

  function nativeActiveIsFirst() {
    const rows = st.pop?.querySelectorAll(NATIVE_ROWS);
    if (!rows?.length) return true;
    const active = [...rows].findIndex((row) => row.style.backgroundColor);
    return active <= 0;
  }

  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  const ACTION_KEYS = new Set(["Enter", "Tab", "ArrowUp", "ArrowDown", "Escape"]);

  function onKeyDown(event) {
    if (pendingTa && ACTION_KEYS.has(event.key) && event.target === pendingTa) flush();
    if (st.phase === "IDLE") return;
    if (event.isComposing || st.composing || event.keyCode === 229) return;
    const ta = event.target;
    if (ta !== st.ta || !anyFeature()) { reset("foreign-key"); return; }
    if (ta.selectionStart !== ta.selectionEnd) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const count = shown.length;
    const key = event.key;
    if (st.phase === "ARMED") {
      if (key === "ArrowUp" && !event.shiftKey && count && !strip.hidden && nativeActiveIsFirst()) {
        own(count - 1);
        paintActive();
        consume(event);
      }
      return;
    }
    // OWNED
    if (event.shiftKey && key !== "Tab") return;
    if (shown[st.active]?.kind === "drill" && (key === "ArrowDown" || key === "ArrowUp")) {
      consume(event);
      return;
    }
    switch (key) {
      case "ArrowDown":
        if (st.active < count - 1) st.active += 1;
        else release();
        paintActive();
        consume(event);
        return;
      case "ArrowUp":
        if (st.active > 0) st.active -= 1;
        paintActive();
        consume(event);
        return;
      case "Enter":
      case "Tab": {
        if (event.shiftKey) return;
        const row = shown[st.active];
        if (row && commit(row)) consume(event);
        else reset("commit-refused");
        return;
      }
      case "Escape":
        release();
        paintActive();
        return;
      case "ArrowLeft":
      case "ArrowRight":
      case "Home":
      case "End":
      case "PageUp":
      case "PageDown":
        reset("caret-move");
        return;
      default:
    }
  }

  // ---- commit ----

  function commit(row) {
    const ta = st.ta;
    const token = st.token;
    const fail = (reason) => {
      debug.lastFailure = { reason, at: Date.now(), row: row?.key, value: ta?.value, token };
      trace({ ev: "commit-fail", reason });
      return false;
    };
    if (!ta || !token || !ta.isConnected) return fail("textarea-gone");
    if (doc.activeElement !== ta) return fail("not-focused");
    if (!tokenStillValid(ta.value, ta.selectionStart, ta.selectionEnd, token)) return fail("token-changed");
    const focused = api.ui.getFocusedBlock?.()?.["block-uid"] ?? null;
    if (!st.uid || focused !== st.uid) return fail("block-changed");
    const next = applyToken(ta.value, token, row.insertion);
    const caret = token.start + row.insertion.length;
    st.ignoreNextInput = true;
    valueSetter.call(ta, next);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    st.ignoreNextInput = false;
    if (row.pick && setting("pickMemory")) picks?.record(row.kind, token.query, row.pick);
    reset("committed");
    debug.commits += 1;
    trace({ ev: "commit", row: row.key });
    win.requestAnimationFrame(() => {
      if (ta.value !== next) {
        debug.lastFailure = { reason: "post-check", at: Date.now(), expected: next, actual: ta.value };
        return;
      }
      try { ta.setSelectionRange(caret, caret); } catch { /* textarea replaced */ }
    });
    return true;
  }

  // ---- mouse ----

  function onStripMouseDown(event) {
    event.preventDefault();
    event.stopPropagation();
    const node = event.target.closest?.(".burrow-row");
    if (!node) return;
    const row = shown[Number(node.dataset.index)];
    if (row && !commit(row)) reset("click-refused");
  }

  function onCompositionStart(event) {
    if (!isBlockInput(event.target)) return;
    st.composing = true;
    pendingTa = null;
    reset("composition");
  }

  function onCompositionEnd(event) {
    if (!isBlockInput(event.target)) return;
    st.composing = false;
    if (anyFeature()) evaluate(event.target);
  }

  function onFocusOut(event) {
    if (event.target !== st.ta) return;
    win.setTimeout(() => { if (st.ta && doc.activeElement !== st.ta) reset("blur"); }, 0);
  }

  // A Burrow bug must never cost the user a keystroke: on any throw Burrow
  // drops to IDLE and the event continues to Roam untouched.
  const guarded = (name, handler) => (event) => {
    try {
      handler(event);
    } catch (error) {
      debug.lastFailure = { reason: `throw:${name}`, at: Date.now(), message: String(error?.message || error) };
      console.error(`[burrow] ${name} failed; falling back to Roam`, error);
      try { reset("error"); } catch { /* already broken */ }
    }
  };

  lifecycle.event(win, "keydown", guarded("keydown", onKeyDown), true);
  lifecycle.event(win, "input", guarded("input", onInput), true);
  lifecycle.event(win, "compositionstart", guarded("compositionstart", onCompositionStart), true);
  lifecycle.event(win, "compositionend", guarded("compositionend", onCompositionEnd), true);
  lifecycle.event(doc, "focusout", guarded("focusout", onFocusOut), true);
  lifecycle.event(strip, "mousedown", guarded("mousedown", onStripMouseDown));
  lifecycle.add(() => reset("unload"));

  return { state: st, debug, reset, tree };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
