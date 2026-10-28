import { aliasInsertion, aliasUses, groupAliasHits, matchAliases, roamAliasesWillList } from "./aliases.js";
import { addAliasToPage, deleteAliasFromPage, validAlias } from "./aliasedit.js";
import { createPromptComposer } from "./compose.js";
import { parseDrill, resolveDrill } from "./drill.js";
import { parseFilters, pageFilter, refFilter } from "./filters.js";
import { createHelpSheet, helpGroups, helpKeyAction } from "./help.js";
import { hintsKey, isHelpKey, keyLabel, pickerHints, renderHints } from "./hints.js";
import { createTreeSource, PAUSE } from "./pagetree.js";
import { createPreview, DRILL_CLASS, previewModel } from "./preview.js";
import { createPickInfo, filterCandidates, mergeCandidates } from "./recents.js";
import { rankRefs } from "./refindex.js";
import { createRichCache, renderParts, richParts, snippet } from "./rich.js";
import { CAP, capRows, firstReal, scopeRows } from "./scope.js";
import { createScopePanel } from "./scopeview.js";
import { looksLikeCode, searchKey, searchPlan, stripRoamMarkup } from "./search.js";
import { checkbox, hasTask, taskParts } from "./tasks.js";
import { isDarkHost } from "./theme.js";
import { createThumbs } from "./thumbs.js";
import { createTips } from "./tips.js";
import { applyToken, findToken, tokenStillValid } from "./token.js";
import { wheelPlan } from "./wheel.js";

const POPUP = ".rm-autocomplete__results";
const NATIVE_ROWS = ".rm-autocomplete__results-scroll > div";
// On Burrow's strip while one of its rows holds the selection; the stylesheet
// mutes Roam's active row through :has() on it, so it holds even when Roam
// rewrites the popover's class list.
const OWNING = "burrow-owning";
const FOLD_ALIASES = "burrow-fold-aliases";
const LAYOUT = "burrow-layout";
const SCOPE_OPEN = "burrow-scope-open";
const HELP_OPEN = "burrow-help-open";
const FOLDED = "data-burrow-folded";
const EXPANDED = "rm-autocomplete__results--expanded";
// .burrow-chips side padding in src/extension.css.
const CHIPS_INSET = 8;
const ROW_LIMIT = 3;
// Every class Burrow puts on Roam's popover; each one is removed again on reset.
const POP_CLASSES = [DRILL_CLASS, FOLD_ALIASES, LAYOUT, SCOPE_OPEN, HELP_OPEN];
// One check per highlighted page or block, kept until the popup closes: does
// it have children (so Tab drills, and the hint line says so)? `limit` keeps
// it at 0.1-0.3 ms whatever the size of the page.
const HAS_KIDS = "[(limit :block/children 1)]";
const MIN_REF_QUERY = 3;
const MIN_ALIAS_QUERY = 2;
// `[[alias:lo`: only alias rows for what follows the prefix (spec §20).
const ALIAS_PREFIX = /^alias:\s*(.*)$/is;
// Recent rows show with this many characters typed or fewer (spec §18).
const RECENT_QUERY = 2;
// Roam's own placeholder rows: titles that are not pages.
const PLACEHOLDERS = new Set(["search for a page", "search for a block"]);
// Frames to wait for Roam to apply its own pick before reading it back.
const NATIVE_PICK_FRAMES = 2;
const POPUP_WAIT_FRAMES = 12;
// The row preview's idle slices stay under the per-key budget (4 ms).
const PREVIEW_SLICE_MS = 3;
// Reads that took longer than this leave the draw to the next slice.
const PREVIEW_DRAW_ALONE_MS = 0.5;
// The row preview draws this many lines per idle slice: the first ones hold
// the highlighted block (in the first 13) and its children, what the pane
// shows; the rest follow in further slices. A line inserted (or removed)
// costs about 0.07 ms in svy.
const PREVIEW_FIRST_LINES = 24;
// The context line counts a block's children up to this many.
const CONTEXT_KIDS = 100;
const valueSetter = Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement?.prototype || {}, "value")?.set;

// Keyboard ownership (spec §4):
//   IDLE  - nothing shown, no key consumed.
//   ARMED - strip shown, Roam's popup holds selection, no key consumed except
//           ↑ from Roam's first row, which moves selection into the strip.
//   OWNED - a strip row is active; Burrow consumes ↑ ↓ Enter Tab only.
//   SCOPE - Tab drilled into a page or block: the scope panel replaces the
//           popover, typing filters its rows (nothing reaches the document)
//           and Burrow consumes the keys the panel uses.
// Drill (spec §5) is OWNED with one row, the block the expression resolves
// to: Enter and Tab insert it, ↑ and ↓ do nothing (no arrow keys in the
// preview), Esc passes through. Deleting the `#` or `>` ends drill mode.
export function createStrip({ setting, indexes, perf, lifecycle, api, frecency = null, saveSetting = null, doc = document, win = window }) {
  const st = {
    phase: "IDLE", ta: null, token: null, uid: null, rows: [], active: -1, drill: null, pageTitle: null, filters: null,
    pop: null, composing: false, ignoreNextInput: false, released: null, waitFrame: 0, observers: [],
    auto: false, chip: -1, scope: null, prompt: null, help: false, aliasOnly: null,
  };
  const debug = { lastFailure: null, lastWrite: null, commits: 0, trace: [] };
  const trace = (event) => {
    debug.trace.push({ t: Math.round(performance.now()), ...event });
    if (debug.trace.length > 60) debug.trace.shift();
  };

  // The strip (Burrow's rows) and the hint line sit inside Roam's list
  // column, in its flow: the strip above Roam's results, the line under
  // Roam's footer. They take their own room, so nothing of Roam's is ever
  // under them, and no geometry is read to place them.
  const strip = doc.createElement("div");
  strip.className = "burrow-strip";
  strip.setAttribute("role", "listbox");
  strip.hidden = true;
  lifecycle.add(() => strip.remove());
  const chipsNode = doc.createElement("div");
  chipsNode.className = "burrow-chips";
  // Under the highlighted block row: where the block lives (refContext).
  const contextNode = doc.createElement("div");
  contextNode.className = "burrow-context";
  // Above the rows: the query filters in force (queryFilters).
  const filtersNode = doc.createElement("div");
  filtersNode.className = "burrow-filters";
  const hints = doc.createElement("div");
  hints.className = "burrow-hints";
  hints.hidden = true;
  const hintsList = doc.createElement("span");
  hintsList.className = "burrow-hints-list";
  // The key list's ? (and, the first time, a line that names ⌥/).
  const helpButton = doc.createElement("span");
  helpButton.className = "burrow-help-button";
  helpButton.setAttribute("role", "button");
  helpButton.setAttribute("aria-keyshortcuts", "Alt+/");
  hints.append(hintsList, helpButton);
  lifecycle.add(() => hints.remove());
  const sheet = createHelpSheet({ doc, win, lifecycle });
  const tips = createTips({
    doc, win, lifecycle, enabled: () => setting("helpTips"),
    avoid: () => (st.ta?.isConnected ? st.ta.getBoundingClientRect() : null),
    around: () => pickerArea(),
  });
  // Block text drawn as Roam draws it: parsed once per uid and text, and the
  // cache is dropped with the ref index (a block ref's resolved text may have
  // changed). A block neither referenced nor read stays ((uid)): no pull here.
  const richCache = createRichCache();
  let richRefs = null;
  const resolveRef = (uid) => indexes.refs?.byUid.get(uid)?.string ?? tree.get(uid)?.string ?? null;
  const richFor = (uid, string) => (setting("richRows") ? richCache.get(uid, string, () => richParts(string, { resolve: resolveRef })) : null);
  const previewRich = (item) => (item.string != null ? richFor(item.uid, item.string) : null);
  const thumbs = createThumbs({ doc, win, api, perf, lifecycle });
  const preview = createPreview({ doc, win, lifecycle, rich: previewRich, thumbs });
  const scopePreview = createPreview({ doc, win, lifecycle, rich: previewRich, thumbs });
  const scopePanel = createScopePanel({
    doc, win, lifecycle, highlight: (text, query) => highlight(text, query),
    rich: (row) => (row.node && row.more == null ? richFor(row.node.uid, row.node.string) : null),
    onSlice: (ms) => perf.push("scope.rich", ms),
  });
  const fast = api.data?.fast?.q ? (query, ...args) => api.data.fast.q(query, ...args) : (query, ...args) => api.q(query, ...args);
  const tree = createTreeSource({
    pull: (pattern, eid) => api.pull(pattern, eid),
    pullMany: api.data?.pull_many ? (pattern, eids) => api.data.pull_many(pattern, eids) : null,
    q: fast,
    onFetch: (kind) => { perf.counters[kind === "query" ? "drillQueries" : "drillPulls"] = (perf.counters[kind === "query" ? "drillQueries" : "drillPulls"] || 0) + 1; },
  });

  const anyFeature = () => setting("aliasPages") || setting("recentRows") || setting("refRanking") || setting("drill") || setting("tabDrill")
    || setting("paneLayout") || setting("keyHints") || setting("helpSheet");

  // Has this page or block children? The page tree knows when it has read
  // the node; otherwise one bounded pull, kept until the popup closes.
  const kidsKnown = new Map();
  function hasKids(uid) {
    if (!uid) return false;
    const kids = tree.get(uid)?.kids;
    if (Array.isArray(kids)) return kids.length > 0;
    if (!kidsKnown.has(uid)) {
      perf.counters.kidChecks = (perf.counters.kidChecks || 0) + 1;
      kidsKnown.set(uid, Boolean(api.pull(HAS_KIDS, [":block/uid", uid])?.[":block/children"]?.length));
    }
    return kidsKnown.get(uid);
  }
  const isBlockInput = (el) => el?.tagName === "TEXTAREA" && el.classList.contains("rm-block-input");

  // The picker's whole rect, Roam's popover and Burrow's panes together:
  // hover tips go beside it, never over its text (read on hover only).
  function pickerArea() {
    const rects = [];
    const add = (el) => { if (el && !el.hidden && el.isConnected) { const r = el.getBoundingClientRect(); if (r.width && r.height) rects.push(r); } };
    if (st.phase !== "SCOPE" && !st.help) add(st.pop);
    add(preview.node);
    add(scopePreview.node);
    if (st.phase === "SCOPE") add(scopePanel.node);
    if (!rects.length) return null;
    return {
      left: Math.min(...rects.map((r) => r.left)), top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)), bottom: Math.max(...rects.map((r) => r.bottom)),
    };
  }

  // ---- ranking (the per-key cost) ----

  function rank(token) {
    st.drill = null;
    st.aliasOnly = null;
    st.filters = null;
    if (token.kind === "[[" && setting("aliasPrefix") && setting("aliasPages") && st.ta?.value[token.start - 1] !== "#") {
      const m = ALIAS_PREFIX.exec(token.query);
      if (m) {
        st.aliasOnly = m[1];
        return m[1].trim() ? mainRows(token, setting("betterMatch"), m[1]) : [];
      }
    }
    if (indexes.refs !== richRefs) { richRefs = indexes.refs; richCache.clear(); }
    const recall = setting("betterMatch");
    if (token.kind === "[[" && setting("drill") && st.ta?.value[token.start - 1] !== "#") {
      const parsed = parseDrill(token.query, indexes.titles);
      if (parsed) {
        const result = resolveDrill(parsed, tree, { strict: !recall, ordinals: setting("drillOrdinals"), hideEmpty: setting("drillEmpty") });
        st.drill = { ...result, key: `${result.page.uid}:${result.target?.uid ?? ""}` };
        return [drillRow(result)];
      }
    }
    const rows = mainRows(token, recall);
    // Up to two characters: the recent picks and edits after the matches
    // (alias rows in [[), nothing selected (spec §18).
    if (token.query.length <= RECENT_QUERY && setting("recentRows") && !(token.kind === "[[" && st.ta?.value[token.start - 1] === "#")) {
      return rows.concat(recentRows(token, rows));
    }
    return rows;
  }

  const frequent = (kind) => (setting("frecency") ? frecency?.scores(kind) : null);

  // query: the text ranked on (after `alias:` in prefix mode, spec §20).
  function mainRows(token, recall, query = token.query) {
    const filters = setting("queryFilters") ? parseFilters(query) : null;
    st.filters = filters;
    const searchText = filters ? filters.text : query;
    const planText = filters ? filters.planText : query;
    const plan = searchPlan(planText);
    if (!plan) return [];
    const compact = plan.clauses.reduce((n, c) => n + c.compact.length, 0);
    if (token.kind === "((") {
      if (!setting("refRanking") || compact < MIN_REF_QUERY) return [];
      return rankRefs(indexes.refs, plan, {
        limit: ROW_LIMIT, recall, aliasExpand: setting("aliasExpand"),
        frequent: frequent("block"), currentPage: setting("pageBoost") ? st.pageTitle : null,
        prose: setting("refProse"), code: looksLikeCode(searchText),
        accept: refFilter(filters, {
          currentPage: st.pageTitle, resolve: (v) => indexes.titles?.resolve(v) ?? null,
          withCode: !setting("refProse") || looksLikeCode(searchText),
        }),
      })
        .map((hit) => ({
          kind: "ref", key: `ref:${hit.uid}`, uid: hit.uid, refs: hit.refs, level: hit.level, page: hit.page, inCode: hit.inCode,
          ...rowText(hit.string), insertion: `((${hit.uid}))`,
          // A query that matched inside code shows the code line it matched.
          rich: hit.inCode && setting("richRows") ? richParts(hit.string, { resolve: resolveRef, needle: highlightPattern(planText) }) : richFor(hit.uid, hit.string),
        }));
    }
    if (!setting("aliasPages") || (compact < MIN_ALIAS_QUERY && st.aliasOnly == null)) return [];
    if (st.ta?.value[token.start - 1] === "#") return [];
    const format = setting("aliasLinkFormat");
    // No cut here: visibleRows drops rows Roam or roam-aliases already show,
    // and a cut before that could hide a row nobody else lists.
    const accepted = pageFilter(filters, { currentPage: st.pageTitle, resolve: (v) => indexes.titles?.resolve(v) ?? null });
    const hits = matchAliases(indexes.aliases, plan, {
      strict: !recall, limit: Infinity, picked: frequent("page"),
      skip: accepted ? (entry) => !accepted(entry) : undefined,
    });
    if (setting("aliasInline")) {
      return groupAliasHits(hits, indexes.aliases, { byUse: setting("aliasUsage") }).map((hit) => ({
        kind: "alias", key: `alias:${hit.uid}`, uid: hit.uid, alias: hit.alias, title: hit.title, aliases: hit.aliases,
        refs: hit.refs, level: hit.level, insertion: aliasInsertion(hit, format),
      }));
    }
    return hits
      .map((hit) => ({
        kind: "alias", key: `alias:${hit.uid}:${hit.alias}`, uid: hit.uid, alias: hit.alias, title: hit.title,
        level: hit.level, insertion: aliasInsertion(hit, format), seenByRoamAliases: hit.seenByRoamAliases,
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
      rich: target ? richFor(target.uid, target.string) : null,
    };
  }

  // ---- recent rows (spec §18) ----

  // What the keystroke does: a merge of two short lists that were prepared
  // off the key path, a word-start filter over at most 30 candidates, and a
  // row each for the first few. No query, no pull.
  const pickInfo = frecency ? createPickInfo({
    api, frecency, idle: (run) => idle(() => { if (!lifecycle.disposed) run(); }),
    known: (uid) => Boolean(indexes.refs?.byUid.has(uid) || indexes.recent?.blocks.some((b) => b.uid === uid)),
  }) : null;
  const blockText = (uid) => {
    const entry = indexes.refs?.byUid.get(uid);
    if (entry) return { uid, text: entry.string, page: entry.page };
    const edited = indexes.recent?.blocks.find((b) => b.uid === uid);
    if (edited) return { uid, text: edited.string, page: edited.page };
    const picked = pickInfo?.get(uid);
    return picked ? { uid, text: picked.string, page: picked.page } : null;
  };

  function recentRows(token, existing) {
    const blocks = token.kind === "((";
    let picks;
    let edited;
    if (blocks) {
      picks = (frecency?.recent("block", 10) || []).map(blockText);
      edited = (indexes.recent?.blocks || []).map((b) => ({ uid: b.uid, text: b.string, page: b.page }));
    } else {
      picks = (frecency?.recent("page", 10) || []).map((uid) => ({ uid, text: indexes.titles?.byUid(uid) }));
      edited = (indexes.recent?.pages || []).map((p) => ({ uid: p.uid, text: p.title }));
    }
    const taken = new Set(existing.map((row) => row.uid));
    const merged = mergeCandidates({ picks: picks.filter(Boolean), edited, skipUid: blocks ? st.uid : null, skipText: blocks ? null : st.pageTitle })
      .filter((c) => !taken.has(c.uid));
    // Roam's list may already hold some pages: look past the first three.
    return filterCandidates(merged, token.query, blocks ? ROW_LIMIT : ROW_LIMIT * 2).map((c) => {
      if (!blocks) {
        const refs = indexes.aliases?.refsByPage?.get(c.uid) ?? null;
        return { kind: "page", key: `page:${c.uid}`, uid: c.uid, title: c.text, refs, recent: c.recent, insertion: `[[${c.text}]]` };
      }
      return {
        kind: "ref", key: `ref:${c.uid}`, uid: c.uid, refs: indexes.refs?.byUid.get(c.uid)?.refs ?? 0, level: 0, page: c.page,
        ...rowText(c.text), insertion: `((${c.uid}))`, recent: c.recent, rich: richFor(c.uid, c.text),
      };
    });
  }

  // Burrow: forget recent picks.
  function forget() {
    pickInfo?.clear();
    nativePick = null;
    if (st.phase !== "IDLE" && st.ta?.isConnected) { scheduleEvaluate(st.ta); }
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

  function resolveRefs(string) {
    const byUid = indexes.refs?.byUid;
    return string.replace(/\(\(([\w-]{9})\)\)/g, (m, uid) => byUid?.get(uid)?.string ?? m);
  }

  // A block row's text, once per row: plain (tips, titles) and, when it holds
  // a TODO/DONE macro, its parts (src/tasks.js) with the markup already gone,
  // so a render only highlights them. Spaces next to a box go: it keeps its
  // own margin, as in Roam's rows.
  function rowText(string) {
    const resolved = resolveRefs(string);
    const text = stripRoamMarkup(resolved).replace(/\s+/g, " ").trim();
    if (!hasTask(resolved)) return { text, parts: null };
    const parts = taskParts(resolved.trim().replace(/\s*(\{\{[^{}]*\}\})\s*/g, "$1"))
      .map((part) => (part.task ? { task: part.task } : { text: stripRoamMarkup(part.text).replace(/\s+/g, " ") }));
    return { text, parts };
  }

  // The strip has a fixed height (rows, the line under the active one,
  // padding) and size containment in the stylesheet: what changes inside it
  // as you type never lays out Roam's list column again; only a change in
  // the number of rows or lines does.
  const ROW_HEIGHT = 33;
  const CHIPS_HEIGHT = 28;
  const CONTEXT_HEIGHT = 18;
  const FILTERS_HEIGHT = 18;
  // .burrow-strip padding (4 + 3) and its bottom border.
  const STRIP_FRAME = 8;
  let stripHeight = null;
  function sizeStrip(count = shown.length) {
    const lines = (chipsNode.isConnected && chipsNode.parentNode === strip ? CHIPS_HEIGHT : 0)
      + (contextNode.isConnected && contextNode.parentNode === strip ? CONTEXT_HEIGHT : 0)
      + (filtersNode.isConnected && filtersNode.parentNode === strip ? FILTERS_HEIGHT : 0);
    const promptRow = strip.firstChild === promptNode ? 1 : 0;
    const height = (count || promptRow) ? (count || promptRow) * ROW_HEIGHT + lines + STRIP_FRAME : 0;
    if (height === stripHeight) return;
    stripHeight = height;
    strip.style.height = height ? `${height}px` : "";
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
      try { sampleColors(); } catch { /* the stylesheet's colors stay */ }
    }, { timeout: 5000 });
  };
  scheduleDetect();
  lifecycle.add(() => { if (detectId != null) win.cancelIdleCallback(detectId); });

  // The colors Roam's theme paints refs, tags, block refs, highlights and
  // code, read from the first such element in the document and set on
  // Burrow's own nodes. Idle only (computed styles), never on a key; a color
  // that is missing or transparent is removed, so the stylesheet's applies.
  let sampledDark = null;
  function sampleColors() {
    const nodes = [strip, preview.node, scopePreview.node, scopePanel.node];
    const set = (name, value) => {
      for (const node of nodes) {
        if (value && !/^(transparent|rgba\(.*,\s*0\))$/.test(value)) node.style.setProperty(name, value);
        else node.style.removeProperty(name);
      }
    };
    const style = (selector) => { const el = doc.querySelector(selector); return el ? win.getComputedStyle(el) : null; };
    set("--burrow-ref", style(".rm-page-ref--link")?.color);
    set("--burrow-tag", style(".rm-page-ref--tag")?.color);
    const bref = style(".rm-block-ref");
    set("--burrow-bref", bref ? (parseFloat(bref.borderBottomWidth) > 0 ? bref.borderBottomColor : bref.color) : null);
    const hl = style(".rm-highlight");
    set("--burrow-hl-bg", hl?.backgroundColor);
    set("--burrow-hl-fg", hl?.color);
    const code = style("code");
    set("--burrow-code-bg", code?.backgroundColor);
    set("--burrow-code-fg", code?.color);
    set("--burrow-mono", code?.fontFamily);
  }
  // A dark/light switch changes what Roam paints: sample again, at idle.
  function colorsStale(dark) {
    if (dark === sampledDark) return;
    sampledDark = dark;
    scheduleDetect();
  }

  function visibleRows() {
    if (!st.pop) return [];
    const inline = setting("aliasInline");
    const pages = st.rows.some((row) => row.kind === "page");
    if (st.aliasOnly != null) return st.rows.slice(0, ROW_LIMIT);
    if (st.token?.kind !== "[[" || st.drill || (inline && !pages)) return st.rows.slice(0, ROW_LIMIT);
    const nativeTitles = new Set();
    for (const row of st.pop.querySelectorAll(NATIVE_ROWS)) {
      const title = row.getAttribute("title")?.toLowerCase();
      if (title && !PLACEHOLDERS.has(title)) nativeTitles.add(title);
    }
    if (inline) return st.rows.filter((row) => row.kind !== "page" || !nativeTitles.has(row.title.toLowerCase())).slice(0, ROW_LIMIT);
    const listed = new Set();
    for (const button of st.pop.querySelectorAll(".rm-aliases .rm-autocomplete-result")) {
      const m = button.textContent.match(/^\[(.*)\]\(\[\[(.*)\]\]\)$/s);
      if (m) listed.add(`${m[1].toLowerCase()}\u0000${m[2].toLowerCase()}`);
    }
    if (roamAliasesSheet && !roamAliasesSheet.isConnected) { roamAliasesSheet = null; scheduleDetect(); }
    const roamAliasesPresent = Boolean(roamAliasesSheet) || Boolean(st.pop.querySelector(".rm-aliases"));
    const query = st.token.query;
    return st.rows.filter((row) => !nativeTitles.has(row.title.toLowerCase())
      && (row.kind === "page" || (!(roamAliasesPresent && roamAliasesWillList(row, query))
        && !listed.has(`${row.alias.toLowerCase()}\u0000${row.title.toLowerCase()}`)))).slice(0, ROW_LIMIT);
  }

  // ---- rendering ----

  let shown = [];
  let shownQuery = null;
  let shownFilters = "";
  // The filter label line: each filter as typed, in:here with its page.
  function filtersText() {
    const labels = st.filters?.labels;
    if (!labels?.length) return "";
    return labels.map((label) => (label.toLowerCase() === "in:here" && st.pageTitle ? `in:here (${st.pageTitle})` : label)).join(" · ");
  }
  function render() {
    if (st.phase === "SCOPE") { placeScope(); return; }
    placeInFlow();
    liftPop();
    if (st.prompt?.kind === "add") { renderPrompt(); return; }
    const rows = visibleRows();
    const query = st.token?.query ?? null;
    const searchText = st.filters ? st.filters.planText : (st.aliasOnly ?? query);
    const filterText = rows.length ? filtersText() : "";
    const same = query === shownQuery && filterText === shownFilters && rows.length === shown.length && rows.every((row, i) => row.key === shown[i].key);
    if (!same) {
      strip.replaceChildren(...(filterText ? [filtersNode] : []), ...rows.map((row, i) => rowNode(row, i)));
      shownFilters = filterText;
      if (filterText) { filtersNode.textContent = filterText; filtersNode.title = `Query filters: ${filterText}`; }
      sizeStrip(rows.length);
      shown = rows;
      shownQuery = query;
      chipsFor = null;
    }
    if (!rows.length) {
      if (st.phase !== "IDLE") { st.phase = "ARMED"; st.active = -1; st.auto = false; st.chip = -1; }
      hideRows();
      syncPanes(rows);
      layoutPop();
      return;
    }
    if (st.phase === "IDLE") st.phase = "ARMED";
    if (st.active >= rows.length) st.active = rows.length - 1;
    const wanted = !rows[0].recent && (rows[0].kind === "drill" || (st.token.kind === "((" && setting("refPreselect") && rows[0].level >= 2)
      || (setting("aliasPreselect") && rows[0].kind === "alias" && aliasStarts(rows[0].alias, searchText) && !exactTitle(searchText)));
    if (st.phase === "OWNED" && st.auto && !wanted) {
      // Native rows arrived late, or the query moved on: give the selection back.
      st.phase = "ARMED";
      st.active = -1;
      st.auto = false;
      st.chip = -1;
    }
    if (st.phase === "ARMED" && wanted && st.released !== releaseKey() && st.active < 0) {
      own(0);
      st.auto = true;
    }
    strip.hidden = false;
    syncPanes(rows);
    paintActive();
    showPreview();
  }

  const aliasStarts = (alias, query) => {
    const a = alias.toLowerCase().trim();
    const q = String(query).toLowerCase().trim();
    if (!q) return false;
    if (a.startsWith(q)) return true;
    const compact = searchKey(query).compact;
    return Boolean(compact) && searchKey(alias).compact.startsWith(compact);
  };

  // A page with exactly the typed title makes Roam's own first row the right
  // pick, so an alias row must not take the selection from it.
  function exactTitle(query) {
    const text = String(query).trim().toLowerCase();
    if (!text) return false;
    for (const row of st.pop?.querySelectorAll(NATIVE_ROWS) || []) {
      if ((row.getAttribute("title") || "").trim().toLowerCase() === text) return true;
    }
    return indexes.titles?.resolve(query)?.title.toLowerCase() === text;
  }

  let model = null;
  let rowPreviewKey = null;
  let rowPreviewId = null;
  // A row preview whose reads are done, waiting for its draw slice.
  let rowPreviewReady = null;
  function cancelRowPreview() {
    if (rowPreviewId != null) { (win.cancelIdleCallback || win.clearTimeout).call(win, rowPreviewId); rowPreviewId = null; }
    rowPreviewKey = null;
    rowPreviewReady = null;
  }

  // What the row preview shows: the page an alias prompt is about, else the
  // selected Burrow alias or referenced row.
  function previewTarget() {
    if (st.prompt) return { kind: "alias", key: `page:${st.prompt.page.uid}`, uid: st.prompt.page.uid, title: st.prompt.page.title };
    const row = st.phase === "OWNED" ? shown[st.active] : null;
    return row?.kind === "alias" || row?.kind === "page" || row?.kind === "ref" ? row : null;
  }

  function showPreview() {
    if (st.drill && setting("drillPreview") && st.pop) {
      cancelRowPreview();
      if (model?.drillKey !== st.drill.key) {
        model = previewModel(st.drill, tree.full, readableText, { hideEmpty: setting("drillEmpty"), images: setting("previewImages") });
        model.drillKey = st.drill.key;
      }
      // The lines now; their place (a layout read) in the frame.
      const budgetMs = richBudget(1);
      if (inFrame) preview.show(model, st.pop, { avoid: st.ta?.getBoundingClientRect(), inFrame: true, budgetMs });
      else { preview.fill(model, st.pop, { budgetMs }); redock = true; requestPlace(); }
      if (preview.unfinished) scheduleRest(preview, () => Boolean(st.drill) && model?.drillKey === st.drill.key, "row");
      return;
    }
    const row = previewTarget();
    if (row && setting("rowPreview") && st.pop?.classList.contains(EXPANDED)) {
      if (rowPreviewKey === row.key) {
        if (model && !preview.node.hidden) { redock = true; requestPlace(); }
        return;
      }
      // The pane keeps the last row's outline until this one is drawn, so
      // moving between Burrow's rows does not flash it (or resize Roam's popover).
      cancelRowPreview();
      thumbs.cancel();
      if (model?.drillKey?.startsWith("row:") !== true) hidePreview();
      rowPreviewKey = row.key;
      scheduleRowPreview(row);
      return;
    }
    cancelRowPreview();
    hidePreview();
  }

  // Drawn at idle, after the strip, like Roam's own preview a moment later:
  // never part of a key's cost. Each idle slice does at most PREVIEW_SLICE_MS
  // of reads (bounded: src/pagetree.js), the draw gets a slice of its own
  // unless the reads were all cached, and the scroll to the highlighted line
  // runs in the next frame. Every slice is one __BURROW_PERF "preview" sample.
  function scheduleRowPreview(row) {
    const run = () => { rowPreviewId = null; drawRowPreview(row); };
    rowPreviewId = typeof win.requestIdleCallback === "function" ? win.requestIdleCallback(run, { timeout: 150 }) : win.setTimeout(run, 50);
  }

  function drawRowPreview(row) {
    if (previewTarget()?.key !== row.key || !st.pop?.classList.contains(EXPANDED)) return;
    const t0 = performance.now();
    const elapsed = () => performance.now() - t0;
    let next = rowPreviewReady?.key === row.key ? rowPreviewReady.model : null;
    if (!next) {
      try {
        next = rowModel(row, tree.bounded(() => elapsed() > PREVIEW_SLICE_MS));
      } catch (error) {
        if (error !== PAUSE) throw error;
        previewSample("read", elapsed());
        scheduleRowPreview(row);
        return;
      }
      if (!next) { previewSample("read", elapsed()); return; }
      // The draw (a layout read, then up to 80 lines) gets a slice of its own
      // unless the reads were all cached: in svy it costs 2-3 ms by itself.
      if (elapsed() > PREVIEW_DRAW_ALONE_MS) {
        rowPreviewReady = { key: row.key, model: next };
        previewSample("read", elapsed());
        scheduleRowPreview(row);
        return;
      }
    }
    rowPreviewReady = null;
    model = next;
    // The lines around the highlighted block now, the rest in the next slice:
    // every line inserted costs about 0.04 ms in svy.
    preview.show(model, st.pop, {
      avoid: st.ta?.getBoundingClientRect(), onFrame: (ms) => previewSample("scroll", ms), lines: PREVIEW_FIRST_LINES,
      budgetMs: richBudget(Math.max(0.5, PREVIEW_SLICE_MS - elapsed())),
    });
    previewSample("draw", elapsed());
    if (preview.pending) scheduleRest(preview, () => previewTarget()?.key === row.key, "row");
  }

  // Rich lines cost more than plain text: with richRows on, a draw stops
  // after its budget (past the highlighted line) and the rest follows at idle.
  const richBudget = (ms) => (setting("richRows") ? ms : Infinity);

  // Every idle task of the row preview is a "preview" sample (held to the
  // budget by perf-gate), and also one of its kind, for the report.
  function previewSample(kind, ms) {
    perf.push("preview", ms);
    perf.push(`preview.${kind}`, ms);
  }

  // The lines of a pane a draw left for later, PREVIEW_SLICE_MS at idle at a
  // time; `current` says the pane still shows what this was scheduled for.
  // "row" is the slot cancelRowPreview clears; the scope preview has its own.
  let scopeRestId = null;
  function scheduleRest(pane, current, slot) {
    if ((slot === "row" ? rowPreviewId : scopeRestId) != null) return;
    const set = (id) => { if (slot === "row") rowPreviewId = id; else scopeRestId = id; };
    const run = () => {
      set(null);
      if (!current() || !pane.unfinished) return;
      if (pane.pending) {
        const t0 = performance.now();
        pane.more(PREVIEW_FIRST_LINES, richBudget(PREVIEW_SLICE_MS));
        previewSample("rest", performance.now() - t0);
      }
      if (pane.unfinished) set(idle(run));
    };
    set(idle(run));
  }
  lifecycle.add(() => { if (scopeRestId != null) (win.cancelIdleCallback || win.clearTimeout).call(win, scopeRestId); scopeRestId = null; });
  const idle = (run) => (typeof win.requestIdleCallback === "function" ? win.requestIdleCallback(run, { timeout: 300 }) : win.setTimeout(run, 60));

  function rowModel(row, read) {
    let page;
    let target = null;
    if (row.kind === "alias" || row.kind === "page") page = { uid: row.uid, title: row.title };
    else {
      const first = read.trail(row.uid)[0];
      if (!first) return null;
      page = { uid: first.uid, title: first.title };
      target = tree.get(row.uid);
    }
    const next = previewModel({ page, target }, read, readableText, { hideEmpty: setting("drillEmpty"), images: setting("previewImages") });
    next.drillKey = `row:${row.key}`;
    return next;
  }

  function rowNode(row, i) {
    const node = doc.createElement("div");
    node.className = "burrow-row";
    node.setAttribute("role", "option");
    node.dataset.index = String(i);
    const text = doc.createElement("span");
    text.className = "burrow-text";
    if (row.kind === "page") {
      text.append(highlight(row.title));
      node.title = row.title;
    } else if (row.kind === "alias") {
      text.append(highlight(row.alias), Object.assign(doc.createElement("span"), { className: "burrow-arrow", textContent: " ↳ " }), row.title);
      node.title = `${row.alias} → ${row.title}`;
    } else if (row.kind === "drill") {
      if (row.crumb) text.append(Object.assign(doc.createElement("span"), { className: "burrow-trail-inline", textContent: `${row.crumb} › ` }));
      if (row.rich) text.append(richContent(row));
      else text.append(row.text);
      node.title = row.crumb ? `${row.crumb} › ${row.text}` : row.text;
    } else {
      if (row.rich) text.append(richContent(row));
      else if (row.parts) for (const part of row.parts) text.append(part.task ? checkbox(doc, part.task) : highlight(part.text));
      else text.append(highlight(row.text));
      node.title = row.text;
    }
    node.append(text);
    if (row.kind === "ref" && row.refs > 0) {
      const count = doc.createElement("sup");
      count.className = "rm-autocomplete__ref-count";
      count.textContent = String(row.refs);
      count.title = `${row.refs} block reference${row.refs === 1 ? "" : "s"}`;
      node.append(count);
    } else if ((row.kind === "alias" || row.kind === "page") && row.refs != null) {
      const count = doc.createElement("sup");
      count.className = "rm-autocomplete__ref-count";
      count.textContent = String(row.refs);
      count.title = `${row.refs} linked reference${row.refs === 1 ? "" : "s"}`;
      node.append(count);
    }
    return node;
  }

  // What the rows are searched and highlighted on: the query without its filters.
  const searchWords = () => (st.filters ? st.filters.planText : (st.aliasOnly ?? st.token?.query));

  // The query's words as one pattern, made once per query (rows render per key).
  let highlightFor = null;
  let highlightRe = null;
  function highlightPattern(query) {
    if (query !== highlightFor) {
      highlightFor = query;
      const words = (String(query ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1);
      highlightRe = words.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${words.map(escapeRe).join("|")})`, "giu") : null;
    }
    return highlightRe;
  }

  // A row's block as Roam draws it, cut around the match when long.
  function richContent(row) {
    return renderParts(doc, snippet(row.rich, highlightPattern(searchWords())), (t) => highlight(t));
  }

  function highlight(text, query = searchWords()) {
    const fragment = doc.createDocumentFragment();
    const re = highlightPattern(query);
    if (!re) { fragment.append(text); return fragment; }
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
    strip.classList.toggle(OWNING, st.phase === "OWNED");
    paintChips();
    paintContext();
    sizeStrip();
    layoutPop();
    showPreview();
  }

  // ---- where the block lives (refContext) ----

  // Under the highlighted block row: `Page › … › Parent` and, when it has
  // any, how many children Tab lists. The line goes in with the page (known
  // from the index) at once, so nothing moves when the rest arrives: the
  // parent and the count are read at idle, once per block per popup.
  const contextKnown = new Map();
  let contextFor = null;
  let contextId = null;
  const contextAvailable = (row) => st.phase === "OWNED" && st.chip < 0 && !st.prompt && setting("refContext") && (row?.kind === "ref" || row?.kind === "drill");

  function paintContext() {
    const row = shown[st.active];
    if (!contextAvailable(row)) {
      contextFor = null;
      cancelContext();
      contextNode.remove();
      return;
    }
    const rowNode = strip.querySelectorAll(".burrow-row")[st.active];
    if (rowNode && contextNode.previousElementSibling !== rowNode) rowNode.after(contextNode);
    if (contextFor === row.key) return;
    contextFor = row.key;
    fillContext(row, contextKnown.get(row.uid));
    if (!contextKnown.has(row.uid)) scheduleContext(row);
  }

  function fillContext(row, known) {
    const trail = known?.trail ?? (row.page ? [row.page] : row.kind === "drill" && st.drill ? [st.drill.page.title] : []);
    const where = Object.assign(doc.createElement("span"), { className: "burrow-context-trail", textContent: trail.length ? `in ${trail.join(" › ")}` : "" });
    const parts = [where];
    if (known?.kids > 0 && (setting("tabDrill") || setting("refOutline"))) {
      const count = known.kids > CONTEXT_KIDS ? `${CONTEXT_KIDS}+` : String(known.kids);
      parts.push(Object.assign(doc.createElement("span"), { className: "burrow-context-kids", textContent: `⇥ ${count} ${known.kids === 1 ? "child" : "children"}` }));
    }
    contextNode.replaceChildren(...parts);
    contextNode.title = trail.length ? trail.join(" › ") : "";
  }

  function cancelContext() {
    if (contextId != null) { (win.cancelIdleCallback || win.clearTimeout).call(win, contextId); contextId = null; }
  }

  function scheduleContext(row) {
    cancelContext();
    const run = () => {
      contextId = null;
      if (contextFor !== row.key || !st.pop) return;
      const t0 = performance.now();
      contextKnown.set(row.uid, readContext(row.uid));
      perf.push("context", performance.now() - t0);
      fillContext(row, contextKnown.get(row.uid));
    };
    contextId = typeof win.requestIdleCallback === "function" ? win.requestIdleCallback(run, { timeout: 200 }) : win.setTimeout(run, 30);
  }

  // The page, then the parent; a deeper block shows `Page › … › Parent`.
  function readContext(uid) {
    const chain = tree.trail(uid);
    const names = chain.map((n, i) => (i === 0 ? n.title || readableText(n.string) : readableText(n.string) || "(empty)"));
    const trail = names.length > 2 ? [names[0], "…", names[names.length - 1]] : names;
    perf.counters.contextPulls = (perf.counters.contextPulls || 0) + 2;
    // Counted up to 100 (`100+` past it): a pull of every child id costs
    // 3-9 ms on a node with 2,000 children.
    const kids = api.pull(`[{(limit :block/children ${CONTEXT_KIDS + 1}) [:db/id]}]`, [":block/uid", uid])?.[":block/children"]?.length ?? 0;
    kidsKnown.set(uid, kids > 0);
    return { trail, kids };
  }

  // The active alias row's other aliases, directly under it. Only this part
  // is rebuilt when the active row changes; rows keep the class-only path.
  let chipsFor = null;
  let chipsScrolled = false;
  let revealedChip = -1;
  const chipsAvailable = (row) => st.phase === "OWNED" && setting("aliasChips") && row?.kind === "alias" && row.aliases.length > 1;

  // The alias, and ×N when the graph links it that often (aliasUsage).
  const chipTitle = (row, alias) => {
    const n = setting("aliasUsage") ? aliasUses(indexes.aliases, row.uid, alias) : 0;
    return n > 0 ? `${alias} ×${n}` : alias;
  };

  function paintChips() {
    const row = shown[st.active];
    const show = chipsAvailable(row);
    if (!show) {
      st.chip = -1;
      chipsFor = null;
      chipsNode.scrollLeft = 0;
      chipsScrolled = false;
      revealedChip = -1;
      chipsNode.remove();
    } else {
      const confirm = st.prompt?.kind === "delete" ? st.prompt : null;
      const key = confirm
        ? `confirm\u0000${row.key}\u0000${confirm.alias}\u0000${confirm.saving}\u0000${confirm.error ?? ""}`
        : `${row.key}\u0000${row.aliases.join("\u0000")}`;
      if (key !== chipsFor) {
        chipsFor = key;
        chipsNode.classList.toggle("burrow-confirm", Boolean(confirm));
        if (confirm) {
          const text = confirm.saving ? `deleting “${confirm.alias}”…` : `delete alias “${confirm.alias}” from ${confirm.page.title}?`;
          chipsNode.replaceChildren(Object.assign(doc.createElement("span"), { className: "burrow-confirm-text", textContent: text }));
          if (confirm.error) chipsNode.append(Object.assign(doc.createElement("span"), { className: "burrow-prompt-error", textContent: confirm.error }));
        } else {
          chipsNode.scrollLeft = 0;
          chipsScrolled = false;
          revealedChip = -1;
          chipsNode.replaceChildren(
            Object.assign(doc.createElement("span"), { className: "burrow-chips-label", textContent: "aliases:" }),
            ...row.aliases.map((alias, i) => {
              const chip = Object.assign(doc.createElement("span"), { className: "burrow-chip", textContent: alias, title: chipTitle(row, alias) });
              chip.dataset.index = String(i);
              return chip;
            }),
          );
        }
      }
      if (!confirm) chipsNode.querySelectorAll(".burrow-chip").forEach((node, i) => node.classList.toggle("burrow-active", i === st.chip));
      const rowNode = strip.querySelectorAll(".burrow-row")[st.active];
      if (rowNode && chipsNode.previousElementSibling !== rowNode) rowNode.after(chipsNode);
      revealChip();
    }
  }

  // The chips are one clipped line; scroll it so the active chip shows, and
  // back to the start (the label) on the first chip or out of chip mode.
  // Layout is read only in chip mode, never while typing.
  function revealChip() {
    if (st.prompt?.kind === "delete") return;
    // Only a chip key moves the line; a render leaves the user's wheel scroll alone.
    if (st.chip === revealedChip) return;
    revealedChip = st.chip;
    if (st.chip <= 0) {
      if (chipsScrolled) chipsNode.scrollLeft = 0;
      chipsScrolled = false;
      return;
    }
    const chip = chipsNode.querySelectorAll(".burrow-chip")[st.chip];
    if (!chip) return;
    const box = chipsNode.getBoundingClientRect();
    const rect = chip.getBoundingClientRect();
    if (rect.right > box.right - CHIPS_INSET) chipsNode.scrollLeft += rect.right - box.right + CHIPS_INSET;
    else if (rect.left < box.left + CHIPS_INSET) chipsNode.scrollLeft -= box.left + CHIPS_INSET - rect.left;
    chipsScrolled = chipsNode.scrollLeft > 0;
  }

  const listColumn = (pop) => pop.querySelector(":scope > .rm-autocomplete__results-main") || pop;

  // The strip goes right above Roam's results list, the hint line at the end
  // of the column (under Roam's footer). Roam re-renders its popover often,
  // and swaps it on some keys: each draw puts them back where they belong.
  // DOM writes only; a no-op when they are in place.
  function placeInFlow() {
    const pop = st.pop;
    if (!pop?.isConnected) return;
    const column = listColumn(pop);
    const list = column.querySelector(":scope > .rm-autocomplete__results-scroll");
    const before = list || column.firstChild;
    if (strip.parentNode !== column || (before && strip.nextSibling !== before && before !== strip)) column.insertBefore(strip, before === strip ? strip.nextSibling : before);
    if (hints.parentNode !== column || column.lastChild !== hints) column.append(hints);
  }

  function sampleTheme(pop) {
    const cs = win.getComputedStyle(pop);
    strip.style.setProperty("--burrow-bg", cs.backgroundColor);
    strip.style.setProperty("--burrow-fg", cs.color);
    strip.style.zIndex = String((Number.parseInt(cs.zIndex, 10) || 20) + 1);
    const firstRow = pop.querySelector(`${NATIVE_ROWS} .rm-autocomplete-result`);
    strip.style.font = firstRow ? win.getComputedStyle(firstRow).font : cs.font;
    // Roam's own active-row color, as the theme paints it; never a muted
    // (transparent) one, which would leave Burrow's row without a highlight.
    const activeRow = [...pop.querySelectorAll(NATIVE_ROWS)].find((row) => row.style.backgroundColor);
    const active = activeRow ? win.getComputedStyle(activeRow).backgroundColor : null;
    if (active && !/^(transparent|rgba\(.*,\s*0\))$/.test(active)) strip.style.setProperty("--burrow-active", active);
    else if (!activeRow) strip.style.removeProperty("--burrow-active");
    const dark = isDarkHost(doc);
    strip.classList.toggle("burrow-dark", dark);
    colorsStale(dark);
    sampleHints(pop, dark);
    for (const p of [preview, scopePreview]) {
      for (const name of ["--burrow-bg", "--burrow-fg"]) p.node.style.setProperty(name, strip.style.getPropertyValue(name));
      p.node.style.zIndex = strip.style.zIndex;
      p.node.style.font = strip.style.font;
    }
    // Roam's block highlight, as Roam paints a selected block. A dark theme
    // can make it an opaque light blue under light text, so there it is
    // diluted to keep the text readable.
    for (const p of [preview, scopePreview]) {
      if (blockHighlight) p.node.style.setProperty("--burrow-highlight", dark ? `color-mix(in srgb, ${blockHighlight} 28%, transparent)` : blockHighlight);
      else p.node.style.removeProperty("--burrow-highlight");
      p.node.classList.toggle("burrow-dark", dark);
      // Hover tips need the pane to take the pointer (a click on it still does nothing).
      p.node.classList.toggle("burrow-tips", Boolean(setting("helpTips")));
    }
    const panel = scopePanel.node;
    for (const name of ["--burrow-bg", "--burrow-fg", "--burrow-active"]) {
      const value = strip.style.getPropertyValue(name);
      if (value) panel.style.setProperty(name, value); else panel.style.removeProperty(name);
    }
    panel.style.zIndex = strip.style.zIndex;
    panel.style.font = strip.style.font;
    panel.classList.toggle("burrow-dark", dark);
    for (const name of ["--burrow-footer-bg", "--burrow-footer-fg"]) {
      const value = hints.style.getPropertyValue(name);
      if (value) panel.style.setProperty(name, value); else panel.style.removeProperty(name);
    }
  }

  function sampleHints(pop, dark) {
    const footer = pop.querySelector(".rm-autocomplete-footer");
    const cs = footer ? win.getComputedStyle(footer) : null;
    const bg = cs?.backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") hints.style.setProperty("--burrow-footer-bg", bg);
    else hints.style.removeProperty("--burrow-footer-bg");
    if (cs?.color) hints.style.setProperty("--burrow-footer-fg", cs.color);
    else hints.style.removeProperty("--burrow-footer-fg");
    for (const name of ["--burrow-bg", "--burrow-fg"]) hints.style.setProperty(name, strip.style.getPropertyValue(name));
    hints.style.fontFamily = strip.style.fontFamily;
    hints.style.zIndex = strip.style.zIndex;
    hints.classList.toggle("burrow-dark", dark);
  }

  // Strip and chips hidden (no rows), layout classes stay.
  function hideRows() {
    strip.hidden = true;
    strip.classList.remove(OWNING);
    chipsNode.remove();
    chipsFor = null;
    contextNode.remove();
    filtersNode.remove();
    shownFilters = "";
    contextFor = null;
    cancelContext();
    cancelRowPreview();
    hidePreview();
    st.pop?.classList.remove(DRILL_CLASS);
  }

  // Everything Burrow put on the popover and on roam-aliases' rows, undone,
  // and its own nodes out of Roam's list column.
  function clearPopover() {
    strip.remove();
    hints.remove();
    if (!st.pop) return;
    if (lifted) st.pop.style.marginBottom = "";
    lifted = 0;
    st.pop.classList.remove(...POP_CLASSES);
    for (const node of st.pop.querySelectorAll(`[${FOLDED}]`)) node.removeAttribute(FOLDED);
  }

  function hideStrip() {
    scopePanel.hide();
    scopePreview.hide();
    strip.hidden = true;
    strip.classList.remove(OWNING);
    chipsNode.remove();
    chipsFor = null;
    contextNode.remove();
    filtersNode.remove();
    shownFilters = "";
    contextFor = null;
    cancelContext();
    hints.hidden = true;
    cancelRowPreview();
    hidePreview();
    clearPopover();
  }

  // ---- roam-aliases column, pane layout, key hints ----

  // The alias pairs roam-aliases lists that a shown Burrow row already
  // carries are folded away; anything Burrow does not show stays visible.
  function foldedByRow(item, rows) {
    const m = (item.querySelector("button")?.textContent ?? "").match(/^\[(.*)\]\(\[\[(.*)\]\]\)$/s);
    if (!m) return false;
    const [, alias, title] = m;
    const lower = alias.toLowerCase();
    const chips = setting("aliasChips");
    return rows.some((row) => row.kind === "alias" && row.title.toLowerCase() === title.toLowerCase()
      && (row.alias === alias || row.alias.toLowerCase() === lower
        || (chips && row.aliases.some((a) => a === alias || a.toLowerCase() === lower))));
  }

  // Classes only; the geometry read is placePanes', in a frame.
  function syncPanes(rows) {
    const pop = st.pop;
    if (!pop) return;
    // roam-aliases only lists in [[.
    if (st.token?.kind !== "[[") { wantFold = false; wantLayout = false; pop.classList.remove(FOLD_ALIASES, LAYOUT); return; }
    const fold = setting("aliasPages") && setting("aliasInline") && !st.drill;
    const items = [...pop.querySelectorAll(".rm-aliases .dont-focus-block.alias")];
    let visible = 0;
    for (const item of items) {
      if (fold && foldedByRow(item, rows)) item.setAttribute(FOLDED, "");
      else { item.removeAttribute(FOLDED); visible += 1; }
    }
    wantFold = items.length > 0 && visible === 0;
    wantLayout = setting("paneLayout") && visible > 0;
    pop.classList.toggle(FOLD_ALIASES, wantFold);
    pop.classList.toggle(LAYOUT, wantLayout);
  }
  let wantFold = false;
  let wantLayout = false;

  // Roam sets the popover's class list wholesale when it re-renders it
  // (Ctrl-O, some updates), dropping Burrow's classes. The popover's
  // observer puts back the ones the current state wants, in the same
  // microtask, before anything is painted.
  function reassertClasses(pop) {
    const want = [];
    if (st.phase === "SCOPE") want.push(SCOPE_OPEN);
    if (st.help) want.push(HELP_OPEN);
    if (wantFold) want.push(FOLD_ALIASES);
    if (wantLayout) want.push(LAYOUT);
    if (preview.drills(pop)) want.push(DRILL_CLASS);
    for (const cls of want) if (!pop.classList.contains(cls)) pop.classList.add(cls);
  }

  // What the hint line says now (src/hints.js), from what is highlighted.
  function hintList() {
    if (st.phase === "SCOPE" || !st.token) return [];
    const row = st.phase === "OWNED" ? shown[st.active] : null;
    const kind = st.token.kind;
    const aliasNew = (page) => Boolean(page) && setting("aliasCreate") && kind === "[[";
    const canDrill = (source) => Boolean(source) && (setting("tabDrill") || setting("drill")) && hasKids(source.uid);
    const state = {
      kind,
      prompt: st.prompt?.kind ?? null,
      chips: Boolean(row) && chipsAvailable(row) && st.chip >= 0,
      row: row ? {
        kind: row.kind, chips: chipsAvailable(row), aliasNew: aliasNew(row.kind === "alias" || row.kind === "page"),
        drill: canDrill(ownedSource(row, st.chip)), block: Boolean(ownedSource(row, -1)?.block),
      } : null,
      native: !row && kind === "[[" ? (() => {
        const source = armedSource();
        return source ? { drill: canDrill(source), aliasNew: aliasNew(source) } : null;
      })() : null,
      rowsAbove: !row && shown.length > 0 && !strip.hidden && nativeActiveIsFirst(),
      recentAbove: shown.length > 0 && shown.every((r) => r.recent),
      on: { tabDrill: setting("tabDrill"), drill: setting("drill"), aliasDelete: setting("aliasDelete"), pageOnly: setting("aliasLinkFormat") === "[[Page]]", refOutline: setting("refOutline") },
    };
    return pickerHints(state);
  }

  // The first-run line on the hint line's right end, once ever: shown in one
  // popup (it counts as seen when that popup closes), gone at once on ✕ or
  // when the key list opens.
  let nudgeShown = false;
  // Seen in this popup already, whatever the settings store says back yet.
  let nudgeDone = false;
  const nudgeWanted = () => !nudgeDone && setting("helpSheet") && setting("helpNudge") && !setting("helpNudgeSeen");
  function nudgeSeen() {
    nudgeShown = false;
    if (nudgeDone || setting("helpNudgeSeen")) { nudgeDone = true; return; }
    nudgeDone = true;
    void Promise.resolve(saveSetting?.("helpNudgeSeen", true)).catch((error) => console.error("[burrow] could not save the tip as seen", error));
  }

  function paintHelpButton(nudge) {
    const want = !setting("helpSheet") ? "" : nudge ? "nudge" : "help";
    if (helpButton.dataset.mode === want) return;
    helpButton.dataset.mode = want;
    helpButton.hidden = !want;
    helpButton.classList.toggle("burrow-nudge", want === "nudge");
    const altSlash = keyLabel("altSlash");
    helpButton.setAttribute("aria-label", `Burrow keys (${altSlash})`);
    if (want === "nudge") {
      helpButton.replaceChildren(`${altSlash} all keys`, Object.assign(doc.createElement("span"), { className: "burrow-nudge-close", textContent: "✕" }));
    } else helpButton.textContent = want ? "?" : "";
  }

  // The hint line's content; it sits at the end of Roam's list column.
  let hintsFor = null;
  function layoutPop() {
    const pop = st.pop;
    if (!pop) return;
    const list = setting("keyHints") ? hintList() : [];
    // While the popup is open the line stays, even with nothing to name for
    // the highlighted row and the key list off, so it never comes and goes
    // under the typing.
    const line = setting("keyHints") && st.phase !== "SCOPE" && !st.help && Boolean(st.token);
    if (!line) {
      hints.hidden = true;
      hintsFor = null;
    } else {
      const nudge = nudgeWanted();
      if (nudge) nudgeShown = true;
      const key = `${hintsKey(list)}\u0002${nudge}`;
      if (key !== hintsFor) {
        hintsFor = key;
        hintItems = list;
        renderHints(doc, hintsList, list);
      }
      paintHelpButton(nudge);
      hints.hidden = false;
    }
  }

  // Burrow's geometry reads run in a frame callback. Read anywhere else (the
  // ranking task runs after a paint, a key handler), they would lay out
  // Roam's own popover changes since that paint early, on Burrow's time: 2.6
  // ms p50 per key in svy, measured. In the frame that layout is due anyway,
  // and the frame paints the content and its place together.
  let inFrame = false;
  let placeId = null;
  let redock = false;
  // A hidden preview stays hidden: no place pending for it.
  function hidePreview() { redock = false; preview.hide(); }
  const inFrameDo = (fn) => { inFrame = true; try { fn(); } finally { inFrame = false; } };
  function requestPlace() {
    if (inFrame) { placePanes(); return; }
    if (placeId != null) return;
    placeId = win.requestAnimationFrame(() => { placeId = null; inFrameDo(placePanes); });
  }
  lifecycle.add(() => { if (placeId != null) win.cancelAnimationFrame(placeId); placeId = null; });
  // Popper puts a flipped popover's bottom on the caret's line, which covers
  // the first lines of a wrapped block. Popper ignores margins, so a bottom
  // margin lifts it clear without feeding back into its placement.
  let lifted = 0;
  let liftId = null;
  function liftPop() {
    if (!inFrame) {
      if (liftId != null) return;
      liftId = win.requestAnimationFrame(() => { liftId = null; inFrameDo(liftPop); });
      return;
    }
    const pop = st.pop;
    const ta = st.ta;
    if (!pop?.isConnected || !ta) return;
    let lift = 0;
    if (pop.style.bottom === "0px") {
      const p = pop.getBoundingClientRect();
      const t = ta.getBoundingClientRect();
      const textTop = t.top + (parseFloat(win.getComputedStyle(ta).paddingTop) || 0);
      const top = p.top + lifted;
      const over = p.bottom + lifted - textTop;
      if (top < textTop && over > 0) lift = Math.max(0, Math.round(Math.min(over, top)));
    }
    if (lift === lifted) return;
    pop.style.marginBottom = lift ? `${lift}px` : "";
    lifted = lift;
  }
  lifecycle.add(() => { if (liftId != null) win.cancelAnimationFrame(liftId); liftId = null; });
  function placePanes() {
    const pop = st.pop;
    if (!pop?.isConnected) return;
    // An unchanged preview follows the popover (src/preview.js reads before it writes).
    if (!redock) return;
    const t0 = performance.now();
    redock = false;
    if (model) preview.show(model, pop, { avoid: st.ta?.getBoundingClientRect(), inFrame: true });
    perf.push("place", performance.now() - t0);
  }
  let hintItems = [];

  // ---- key list (⌥/ or the ?) ----

  function openHelp() {
    if (!st.pop || !setting("helpSheet")) return false;
    st.help = true;
    tips.hide();
    if (nudgeShown || nudgeWanted()) nudgeSeen();
    const covered = st.phase === "SCOPE" ? scopePanel.node : st.pop;
    const anchor = covered.getBoundingClientRect();
    for (const node of [strip, hints, preview.node, scopePreview.node, scopePanel.node]) node.classList.add("burrow-help-covered");
    st.pop.classList.add(HELP_OPEN);
    sampleSheet();
    sheet.show(helpGroups(setting), keyLabel("altSlash"), anchor, st.ta?.getBoundingClientRect());
    trace({ ev: "help-open" });
    return true;
  }

  function closeHelp() {
    if (!st.help) return;
    st.help = false;
    sheet.hide();
    for (const node of [strip, hints, preview.node, scopePreview.node, scopePanel.node]) node.classList.remove("burrow-help-covered");
    st.pop?.classList.remove(HELP_OPEN);
    trace({ ev: "help-close" });
    hintsFor = null;
    if (st.phase === "SCOPE") placeScope();
    else frame();
  }

  function sampleSheet() {
    for (const name of ["--burrow-bg", "--burrow-fg", "--burrow-active", "--burrow-footer-bg", "--burrow-footer-fg"]) {
      const value = (name.includes("footer") ? hints : strip).style.getPropertyValue(name);
      if (value) sheet.node.style.setProperty(name, value); else sheet.node.style.removeProperty(name);
    }
    sheet.node.style.zIndex = strip.style.zIndex;
    sheet.node.style.font = strip.style.font;
    sheet.node.classList.toggle("burrow-dark", strip.classList.contains("burrow-dark"));
  }

  // While the list is open: Esc, ⌥/, F1, Enter or Tab closes it and does
  // nothing else (Enter never picks a row hidden under it); any other key
  // closes it and then does what it does (typing goes on as if it had not
  // been open).
  function helpKey(event) {
    const action = helpKeyAction(event);
    if (action === "keep") return true;
    if (action === "close") consume(event);
    closeHelp();
    return action === "close";
  }

  // The textarea keeps focus (mousedown), and the ? and ✕ act on click: the
  // key list opens under the pointer, and a mouseup on it would make the click
  // land on <body>, which ends Roam's edit.
  function onHintsMouseDown(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function onHelpClick(event) {
    if (!event.target.closest?.(".burrow-help-button")) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.target.closest?.(".burrow-nudge-close")) {
      nudgeSeen();
      hintsFor = null;
      layoutPop();
      return;
    }
    if (st.help) closeHelp(); else openHelp();
  }

  // ---- popup attach / detach ----

  function attach(pop) {
    if (st.pop === pop) return;
    detach();
    st.pop = pop;
    sampleTheme(pop);
    if (st.phase === "SCOPE") pop.classList.add(SCOPE_OPEN);
    if (st.help) pop.classList.add(HELP_OPEN);
    // Burrow's own nodes live in the popover now: their changes are not Roam's.
    const ours = (node) => node === strip || node === hints || strip.contains(node) || hints.contains(node);
    const mo = new MutationObserver((records) => {
      if (st.pop !== pop || st.phase === "IDLE") return;
      let roam = false;
      for (const r of records) {
        if (r.type === "attributes" && r.attributeName === "class") {
          if (r.target === pop) reassertClasses(pop);
          continue;
        }
        if (ours(r.target)) continue;
        if (r.type === "childList" && [...r.addedNodes, ...r.removedNodes].every(ours)) continue;
        roam = true;
      }
      if (roam) frame();
    });
    mo.observe(pop, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
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
    cancelRowPreview();
    hidePreview();
    hints.hidden = true;
    hintsFor = null;
    clearPopover();
    st.pop = null;
  }

  let frameQueued = false;
  function frame() {
    if (frameQueued) return;
    frameQueued = true;
    win.requestAnimationFrame(() => {
      if (frameQueued) inFrameDo(draw);
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

  // Has the caret or the text before it moved since Burrow ranked?
  function stale(ta) {
    const token = st.token;
    if (!token) return false;
    return ta.selectionStart !== ta.selectionEnd || ta.selectionStart !== token.caret
      || ta.value.slice(token.start, token.caret) !== token.kind + token.query;
  }

  // A pick that could not be written: rank again for what the block holds
  // now, with the key already consumed.
  function refused() {
    trace({ ev: "refused" });
    if (st.phase === "SCOPE") exitScope();
    const ta = st.ta;
    if (ta?.isConnected && doc.activeElement === ta) {
      evaluate(ta);
      if (frameQueued) inFrameDo(draw);
    } else reset("commit-refused");
  }

  function reset(reason) {
    if (st.phase !== "IDLE" || st.rows.length) trace({ ev: "reset", reason });
    closeHelp();
    tips.hide();
    if (nudgeShown) nudgeSeen();
    nudgeDone = false;
    kidsKnown.clear();
    contextKnown.clear();
    contextFor = null;
    cancelContext();
    st.phase = "IDLE";
    st.rows = [];
    st.active = -1;
    st.token = null;
    st.filters = null;
    st.released = null;
    st.drill = null;
    st.auto = false;
    st.chip = -1;
    st.scope = null;
    if (st.prompt?.compose) composer.restore(st.prompt, st.ta);
    st.prompt = null;
    promptRows = [];
    cancelRowPreview();
    thumbs.clear();
    model = null;
    scopeModel = null;
    tree.clear();
    shown = [];
    shownQuery = null;
    shownFilters = "";
    chipsFor = null;
    hintsFor = null;
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
    st.auto = false;
    st.chip = -1;
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
    st.chip = -1;
    if (!st.rows.length && st.phase === "OWNED") { st.phase = "ARMED"; st.active = -1; st.auto = false; }
    if (st.phase === "OWNED") st.active = 0;
    // Layout, fold and hints need the popover even with no rows of ours.
    if (st.phase === "IDLE") st.phase = "ARMED";
    frame();
  }

  function onInput(event) {
    const ta = event.target;
    if (!isBlockInput(ta)) return;
    if (st.prompt && (composer.input(event) || composer.stray(event))) return;
    if (st.ignoreNextInput) { st.ignoreNextInput = false; return; }
    if (nativePick?.ta === ta) readNative();
    if (st.prompt) st.prompt = null;
    if (st.phase === "SCOPE") exitScope();
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
    if (tips.visible) tips.hide();
    if (pendingTa && (ACTION_KEYS.has(event.key) || event.altKey) && event.target === pendingTa) flush();
    if (st.phase === "IDLE") return;
    // The key list covers every row: first, so its Enter only closes it.
    if (st.help && event.target === st.ta && helpKey(event)) return;
    // The text before the caret is no longer what Burrow ranked (the caret
    // moved without an event Burrow saw yet): rank again before the key acts.
    // Enter or Tab then only redraws; the highlight the user saw was Burrow's,
    // so the key never falls through to a Roam row that was not highlighted.
    if (st.phase === "OWNED" && event.target === st.ta && (ACTION_KEYS.has(event.key) || event.altKey) && stale(st.ta)) {
      trace({ ev: "stale-key", key: event.key });
      evaluate(st.ta);
      if (frameQueued) inFrameDo(draw);
      if (event.key === "Enter" || event.key === "Tab") { consume(event); return; }
      if (st.phase === "IDLE") return;
    }
    if (isHelpKey(event) && setting("helpSheet") && event.target === st.ta && !event.isComposing && !st.composing && !st.prompt?.compose) {
      if (openHelp()) { consume(event); return; }
    }
    if (st.prompt && composer.key(event)) return;
    if (event.isComposing || st.composing || event.keyCode === 229) return;
    const ta = event.target;
    if (ta !== st.ta || !anyFeature()) { reset("foreign-key"); return; }
    if (ta.selectionStart !== ta.selectionEnd) return;
    if (st.prompt) { promptKey(event); return; }
    const count = shown.length;
    const key = event.key;
    if (st.phase === "SCOPE") { scopeKey(event); return; }
    if (isAltA(event) && setting("aliasCreate") && st.token?.kind === "[[" && (st.phase === "ARMED" || st.phase === "OWNED")) {
      const page = aliasSource();
      if (page) { openPrompt(page); consume(event); return; }
    }
    if (st.phase === "OWNED" && chipKey(event)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (st.phase === "ARMED") {
      if (key === "Tab" && !event.shiftKey && setting("tabDrill") && st.token.kind === "[[" && enterScope(armedSource(), event)) return;
      if ((key === "Enter" || key === "Tab") && !event.shiftKey) rememberNative();
      if (key === "ArrowUp" && !event.shiftKey && count && !strip.hidden && nativeActiveIsFirst()) {
        own(count - 1);
        st.auto = false;
        paintActive();
        consume(event);
      }
      return;
    }
    // OWNED
    if (event.shiftKey && key === "Tab" && setting("refOutline") && outlineUp(shown[st.active], event)) return;
    if (event.shiftKey && key !== "Tab") return;
    if (shown[st.active]?.kind === "drill" && (key === "ArrowDown" || key === "ArrowUp")) {
      consume(event);
      return;
    }
    switch (key) {
      case "ArrowDown":
        st.auto = false;
        st.chip = -1;
        if (st.active < count - 1) st.active += 1;
        else release();
        paintActive();
        consume(event);
        return;
      case "ArrowUp":
        st.auto = false;
        st.chip = -1;
        if (st.active > 0) st.active -= 1;
        paintActive();
        consume(event);
        return;
      case "Enter":
      case "Tab": {
        if (event.shiftKey) return;
        const row = shown[st.active];
        if (key === "Tab" && setting("tabDrill") && enterScope(ownedSource(row, -1), event)) return;
        // Refused (the text or the block changed under the row): the key
        // stays Burrow's and only redraws, so Enter never runs a Roam row the
        // user did not see highlighted.
        consume(event);
        if (!row || !commit(row)) refused();
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

  // Chip mode (spec: alias chips). Returns true when the key was handled.
  function chipKey(event) {
    const row = shown[st.active];
    if (!chipsAvailable(row)) { st.chip = -1; return false; }
    const key = event.key;
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (st.chip < 0) {
      if (key !== "ArrowDown" || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
      st.auto = false;
      st.chip = Math.max(0, row.aliases.indexOf(row.alias));
      paintActive();
      consume(event);
      return true;
    }
    const last = row.aliases.length - 1;
    if (plain && (key === "ArrowLeft" || key === "ArrowUp")) st.chip = Math.max(0, st.chip - 1);
    else if (plain && (key === "ArrowRight" || key === "ArrowDown")) st.chip = Math.min(last, st.chip + 1);
    else if (key === "Backspace" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && setting("aliasDelete")) {
      st.prompt = { kind: "delete", page: { uid: row.uid, title: row.title }, alias: row.aliases[st.chip], saving: false, error: null };
      trace({ ev: "confirm-delete", alias: st.prompt.alias });
    } else if ((key === "ArrowUp" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) || (key === "Escape" && plain)) st.chip = -1;
    else if (plain && (key === "Enter" || key === "Tab")) {
      if (key === "Tab" && setting("tabDrill") && enterScope(ownedSource(row, st.chip), event)) return true;
      consume(event);
      if (!commit(chipRow(row, st.chip))) refused();
      return true;
    } else {
      st.chip = -1;
      paintActive();
      return false;
    }
    paintActive();
    consume(event);
    return true;
  }

  const isAltA = (e) => e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyA";

  // The page ⌥A names: Burrow's alias row when it holds the selection, else
  // Roam's highlighted [[ row when its title is an existing page.
  function aliasSource() {
    if (st.phase === "OWNED") {
      const row = shown[st.active];
      return row?.kind === "alias" || row?.kind === "page" ? { uid: row.uid, title: row.title } : null;
    }
    const native = armedSource();
    return native ? { uid: native.page.uid, title: native.page.title } : null;
  }

  function openPrompt(page) {
    const ta = st.ta;
    st.prompt = { kind: "add", page, text: st.token.query.trim(), fresh: true, saving: false, error: null,
      block: { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd } };
    st.auto = false;
    st.chip = -1;
    trace({ ev: "prompt", uid: page.uid });
    promptRows = shown.slice();
    render();
  }

  let promptRows = [];
  const promptNode = doc.createElement("div");
  promptNode.className = "burrow-row burrow-prompt";
  const composer = createPromptComposer({
    prompt: () => st.prompt,
    textarea: () => st.ta,
    setValue: (ta, value) => valueSetter.call(ta, value),
    render: () => renderPrompt(),
  });
  function renderPrompt() {
    const p = st.prompt;
    const input = Object.assign(doc.createElement("span"), { className: "burrow-prompt-input", textContent: p.saving ? `${p.text} …` : p.text });
    input.classList.toggle("burrow-fresh", p.fresh && Boolean(p.text));
    if (p.compose?.text) input.append(Object.assign(doc.createElement("span"), { className: "burrow-prompt-compose", textContent: p.compose.text }));
    promptNode.replaceChildren(Object.assign(doc.createElement("span"), { className: "burrow-prompt-label", textContent: `alias for ${p.page.title}:` }), input);
    if (p.error) promptNode.append(Object.assign(doc.createElement("span"), { className: "burrow-prompt-error", textContent: p.error, title: p.error }));
    if (strip.firstChild !== promptNode || strip.childNodes.length !== 1) strip.replaceChildren(promptNode);
    sizeStrip(0);
    shown = [];
    shownQuery = null;
    shownFilters = "";
    chipsFor = null;
    chipsNode.remove();
    strip.hidden = false;
    syncPanes(promptRows);
    layoutPop();
    showPreview();
  }

  function promptKey(event) {
    const p = st.prompt;
    const key = event.key;
    if (key === "Shift" || key === "Alt" || key === "Meta" || key === "Control" || key === "CapsLock") return;
    if (p.kind === "delete") {
      consume(event);
      if (p.saving) return;
      if (key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) { confirmDelete(); return; }
      st.prompt = null;
      paintActive();
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (mod && key.toLowerCase() === "v") return;          // the paste event below takes it
    consume(event);
    if (p.saving) return;
    if (key === "Escape") { st.prompt = null; promptRows = []; render(); return; }
    if (key === "Enter") { savePrompt(); return; }
    if (mod) { if (key.toLowerCase() === "a") p.fresh = true; renderPrompt(); return; }
    if (key === "Backspace") { p.text = p.fresh ? "" : [...p.text].slice(0, -1).join(""); p.fresh = false; p.error = null; }
    else if (key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End") p.fresh = false;
    else if (key.length === 1 || [...key].length === 1) { p.text = p.fresh ? key : p.text + key; p.fresh = false; p.error = null; }
    renderPrompt();
  }

  async function savePrompt() {
    const p = st.prompt;
    const check = validAlias(p.text);
    if (!check.ok) { p.error = check.reason; renderPrompt(); return; }
    p.saving = true; p.error = null; renderPrompt();
    let result;
    try { result = await addAliasToPage(api, { pageUid: p.page.uid, keyword: setting("aliasKeyword") || "Aliases", alias: check.alias }); }
    catch (error) { result = { ok: false, error: String(error?.message || error) }; }
    if (st.prompt !== p) return;                            // blur, Esc: closed meanwhile
    if (!result.ok) { p.saving = false; p.error = result.error; renderPrompt(); return; }
    composer.restore(p, st.ta);                             // a composition started while saving
    st.prompt = null;
    promptRows = [];
    debug.lastWrite = { kind: "add", at: Date.now(), ...result };
    trace({ ev: "alias-added", uid: p.page.uid, block: result.blockUid });
    indexes.refreshAliases?.();
    const row = { kind: "alias", key: `alias-new:${p.page.uid}`, uid: p.page.uid, insertion: aliasInsertion({ alias: check.alias, title: p.page.title }, setting("aliasLinkFormat")) };
    if (!commit(row)) reset("commit-refused");
  }

  async function confirmDelete() {
    const p = st.prompt;
    p.saving = true; p.error = null; paintActive();
    let result;
    try { result = await deleteAliasFromPage(api, { pageUid: p.page.uid, keyword: setting("aliasKeyword") || "Aliases", alias: p.alias }); }
    catch (error) { result = { ok: false, error: String(error?.message || error) }; }
    if (st.prompt !== p) return;
    if (!result.ok) { p.saving = false; p.error = result.error; paintActive(); return; }
    st.prompt = null;
    debug.lastWrite = { kind: "delete", at: Date.now(), ...result };
    trace({ ev: "alias-deleted", alias: p.alias, block: result.blockUid });
    for (const r of new Set([...st.rows, ...shown])) {
      if (r.kind === "alias" && r.uid === p.page.uid) r.aliases = r.aliases.filter((a) => a !== p.alias);
    }
    const row = shown[st.active];
    st.chip = chipsAvailable(row) ? Math.min(st.chip, row.aliases.length - 1) : -1;
    chipsFor = null;
    indexes.refreshAliases?.();
    paintActive();
  }

  function onPaste(event) {
    const p = st.prompt;
    if (p?.kind !== "add" || event.target !== st.ta) return;
    consume(event);
    if (p.saving) return;
    const text = (event.clipboardData?.getData("text/plain") ?? "").split(/\r?\n/)[0];
    p.text = p.fresh ? text : p.text + text;
    p.fresh = false;
    p.error = null;
    renderPrompt();
  }

  // A vertical wheel scrolls the chip line sideways while it can still move
  // that way; otherwise, and over Burrow's rows, Roam's list under the strip
  // scrolls (src/wheel.js).
  function onStripWheel(event) {
    const overChips = chipsNode.isConnected && chipsNode.contains(event.target);
    const list = st.pop?.querySelector(".rm-autocomplete__results-scroll");
    const plan = wheelPlan(event,
      overChips ? { left: chipsNode.scrollLeft, max: chipsNode.scrollWidth - chipsNode.clientWidth } : null,
      list ? { top: list.scrollTop, max: list.scrollHeight - list.clientHeight } : null);
    trace({ ev: "wheel", to: plan.to });
    if (plan.to === "chips") {
      chipsNode.scrollLeft = plan.left;
      event.preventDefault();
    } else if (plan.to === "list") {
      list.scrollTop += plan.by;
      event.preventDefault();
    }
  }

  function chipRow(row, index) {
    const alias = row.aliases[index];
    return { ...row, insertion: aliasInsertion({ alias, title: row.title }, setting("aliasLinkFormat")) };
  }

  // ---- Tab drill (scope) ----

  // Where Tab would drill from: the active Burrow row when OWNED ...
  function ownedSource(row, chip) {
    if (!row) return null;
    if (row.kind === "page") return { uid: row.uid, label: row.title, page: { uid: row.uid, title: row.title }, insertion: row.insertion };
    if (row.kind === "alias") {
      const insertion = chip >= 0 ? chipRow(row, chip).insertion : row.insertion;
      return { uid: row.uid, label: row.title, page: { uid: row.uid, title: row.title }, insertion };
    }
    if (row.kind === "ref") return { uid: row.uid, label: row.text, page: null, insertion: row.insertion, block: true };
    if (row.kind === "drill" && st.drill) {
      const block = row.uid !== st.drill.page.uid;
      return { uid: row.uid, label: row.text, page: st.drill.page, insertion: row.insertion, block };
    }
    return null;
  }

  // Up and down the outline (refOutline): the levels from the block's page
  // down to its parent (⇧⇥, `self` false) or to the block itself (Tab). Each
  // level lists its children and starts on the next block of the path, so
  // the crumb is the block's whole trail and ⇧⇥ walks up it.
  function outlineLevels(uid, label, self) {
    const chain = tree.trail(uid);
    if (!chain.length || chain[0].title == null) return null;
    const page = { uid: chain[0].uid, title: chain[0].title };
    const path = [...chain.map((n) => n.uid), uid];
    const nodes = self ? [...chain, { uid, label }] : chain;
    const limit = setting("drillCap") ? CAP : Infinity;
    return nodes.map((n, i) => ({
      uid: n.uid, page, isPage: i === 0, query: "", active: null, activeUid: path[i + 1] ?? null, limit,
      label: i === 0 ? page.title : n.label ?? (readableText(n.string) || "(empty)"),
      insertion: i === 0 ? `[[${page.title}]]` : `((${n.uid}))`,
    }));
  }

  // ⇧⇥ on a highlighted block row: its parent's children, the block highlighted.
  function outlineUp(row, event) {
    if (row?.kind !== "ref" && row?.kind !== "drill") return false;
    const source = ownedSource(row, -1);
    if (!source?.block) return false;
    const levels = outlineLevels(row.uid, row.text, false);
    return Boolean(levels) && enterScope(source, event, levels);
  }

  // ... or Roam's own highlighted page row when ARMED (`[[` only; `((` rows have no uid).
  function armedSource() {
    const rows = [...(st.pop?.querySelectorAll(NATIVE_ROWS) || [])];
    if (!rows.length) return null;
    const at = rows.findIndex((row) => row.style.backgroundColor);
    const title = rows[Math.max(0, at)].getAttribute("title");
    const page = title ? indexes.titles?.resolve(title) : null;
    if (!page || page.title !== title) return null;
    return { uid: page.uid, label: title, page, insertion: `[[${title}]]` };
  }

  function enterScope(source, event, up = null) {
    const ta = st.ta;
    if (!source || !st.pop || st.composing || event.target !== ta) return false;
    if (!tokenStillValid(ta.value, ta.selectionStart, ta.selectionEnd, st.token)) return false;
    if (!up && !tree.children(source.uid).length) return false;
    const levels = up || (source.block && setting("refOutline") && outlineLevels(source.uid, source.label, true))
      || [{ ...source, isPage: !source.block, query: "", active: 0, limit: setting("drillCap") ? CAP : Infinity }];
    st.scope = {
      rootLabel: st.token.kind === "[[" ? "Pages" : "Blocks",
      levels,
      rows: [],
      all: [],
      preview: setting("drillPreview"),
      returnTo: { phase: st.phase, active: st.active, chip: st.chip },
    };
    st.phase = "SCOPE";
    st.auto = false;
    st.chip = -1;
    trace({ ev: "scope-enter", uid: source.uid });
    strip.hidden = true;
    strip.classList.remove(OWNING);
    chipsNode.remove();
    contextNode.remove();
    filtersNode.remove();
    shownFilters = "";
    contextFor = null;
    cancelRowPreview();
    hidePreview();
    st.pop.classList.remove(DRILL_CLASS);
    st.pop.classList.add(SCOPE_OPEN);
    hints.hidden = true;
    hintsFor = null;
    scopeRefresh(false);
    consume(event);
    return true;
  }

  function exitScope() {
    const scope = st.scope;
    if (!scope) return;
    st.scope = null;
    scopePanel.hide();
    scopePreview.hide();
    scopeModel = null;
    st.pop?.classList.remove(SCOPE_OPEN);
    st.phase = scope.returnTo.phase;
    st.active = scope.returnTo.active;
    st.chip = scope.returnTo.chip;
    trace({ ev: "scope-exit" });
    frame();
  }

  const scopeLevel = () => st.scope.levels[st.scope.levels.length - 1];

  // Recompute the rows of the top level, then draw. keepActive: restoring a
  // parent level after a pop.
  function scopeRefresh(keepActive) {
    const level = scopeLevel();
    level.limit ??= setting("drillCap") ? CAP : Infinity;
    st.scope.all = scopeRows(tree.twoLevels(level.uid), level.query, {
      strict: !setting("betterMatch"), text: readableText, ordinals: setting("drillOrdinals"), hideEmpty: setting("drillEmpty"),
    });
    // A level on the way down to a block (refOutline) starts on that block,
    // with enough slices listed to show it.
    const on = !level.query && level.activeUid && (keepActive ? level.active == null : true)
      ? st.scope.all.findIndex((row) => row.uid === level.activeUid) : -1;
    if (on >= 0 && level.limit !== Infinity) level.limit = Math.max(level.limit, Math.ceil((on + 1) / CAP) * CAP);
    st.scope.rows = capRows(st.scope.all, level.limit);
    if (on >= 0) level.active = on;
    else if (keepActive && level.active != null) level.active = Math.min(level.active, Math.max(0, st.scope.rows.length - 1));
    else level.active = level.query ? 0 : firstReal(st.scope.rows);
    scopePanel.show(st.scope, setting("keyHints"), setting("helpSheet"));
    placeScope();
  }

  function scopeMore() {
    const level = scopeLevel();
    const at = level.limit;
    level.limit += CAP;
    st.scope.rows = capRows(st.scope.all, level.limit);
    level.active = Math.min(at, st.scope.rows.length - 1);
    scopePanel.show(st.scope, setting("keyHints"), setting("helpSheet"));
    placeScope();
  }

  let scopeModel = null;
  function placeScope() {
    const scope = st.scope;
    const pop = st.pop;
    if (!scope || !pop) return;
    pop.classList.add(SCOPE_OPEN);
    liftPop();
    const popRect = pop.getBoundingClientRect();
    const main = pop.classList.contains("rm-autocomplete__results--expanded") ? pop.querySelector(".rm-autocomplete__results-main") : null;
    scopePanel.place(main ? main.getBoundingClientRect() : popRect, popRect, st.ta.getBoundingClientRect());
    showScopePreview();
  }

  function showScopePreview() {
    const level = scopeLevel();
    if (!st.scope.preview) { scopePreview.hide(); return; }
    const row = st.scope.rows[level.active];
    const target = row && row.more == null ? row.node : (level.page?.uid === level.uid ? null : tree.get(level.uid));
    const first = tree.trail(level.uid)[0];
    const page = level.page || (first ? { uid: first.uid, title: first.title } : null);
    if (!page) { scopePreview.hide(); return; }
    const key = `${page.uid}:${target?.uid ?? ""}`;
    if (scopeModel?.drillKey !== key) {
      scopeModel = previewModel({ page, target }, tree.full, readableText, { hideEmpty: setting("drillEmpty"), images: setting("previewImages") });
      scopeModel.drillKey = key;
    }
    scopePreview.show(scopeModel, st.pop, { beside: scopePanel.node.getBoundingClientRect(), avoid: st.ta.getBoundingClientRect(), budgetMs: richBudget(1) });
    if (scopePreview.unfinished) scheduleRest(scopePreview, () => st.phase === "SCOPE" && Boolean(st.scope?.preview), "scope");
  }

  // ↑/↓ in the drill panel redraw its preview in the key's own work: one "scope.key" sample each.
  function scopeMove(delta) {
    perf.time("scope.key", () => {
      const level = scopeLevel();
      level.active = Math.max(0, Math.min(Math.max(0, st.scope.rows.length - 1), level.active + delta));
      scopePanel.paintActive(st.scope, setting("keyHints"), setting("helpSheet"));
      showScopePreview();
    });
  }

  function scopeDeeper() {
    const level = scopeLevel();
    const row = st.scope.rows[level.active];
    if (!row?.drillable || row.more != null) return;
    st.scope.levels.push({
      uid: row.uid, label: row.text || "(empty)", page: level.page, insertion: `((${row.uid}))`, query: "", active: 0,
      limit: setting("drillCap") ? CAP : Infinity,
    });
    scopeRefresh(false);
  }

  function scopeBack(toLevel = st.scope.levels.length - 2) {
    if (toLevel < 0) { exitScope(); return; }
    st.scope.levels.length = toLevel + 1;
    scopeRefresh(true);
  }

  function scopeCommit() {
    const level = scopeLevel();
    const row = st.scope.rows[level.active];
    if (row?.more != null) { scopeMore(); return true; }
    if (row?.empty && row.drillable) { scopeDeeper(); return true; }
    return commit(row
      ? { kind: "scope", key: `scope:${row.uid}`, insertion: `((${row.uid}))` }
      : { kind: "scope", key: `scope:${level.uid}`, insertion: level.insertion });
  }

  function scopeKey(event) {
    const key = event.key;
    if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.code === "KeyO") {
      st.scope.preview = !st.scope.preview;
      consume(event);
      showScopePreview();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const level = scopeLevel();
    if (key === "Tab") {
      consume(event);
      if (event.shiftKey) scopeBack(); else scopeDeeper();
      return;
    }
    if (key === "Enter") {
      // Roam's popover is hidden under the panel: a refused Enter is never its.
      consume(event);
      if (!scopeCommit()) refused();
      return;
    }
    if (key === "Escape") { exitScope(); consume(event); return; }
    if (key === "ArrowDown" || key === "ArrowUp") { scopeMove(key === "ArrowDown" ? 1 : -1); consume(event); return; }
    if (key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End" || key === "PageUp" || key === "PageDown") {
      exitScope();
      reset("caret-move");
      return;
    }
    if (key === "Backspace") {
      consume(event);
      if (level.query) {
        level.query = [...level.query].slice(0, -1).join("");
        level.limit = setting("drillCap") ? CAP : Infinity;
        scopeRefresh(false);
      } else scopeBack();
      return;
    }
    if (key.length === 1) {
      consume(event);
      if (key === ">" && st.scope.rows[level.active]?.drillable) { scopeDeeper(); return; }
      level.query += key;
      level.limit = setting("drillCap") ? CAP : Infinity;
      scopeRefresh(false);
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
    recordPick(row);
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

  // A pick feeds the frecency scores and the recent rows: the block when the
  // insertion is a ((uid)), else the row's page. Uids only.
  function recordPick(row) {
    if (!frecency || !(setting("frecency") || setting("recentRows"))) return;
    const block = /^\(\(([\w-]{9})\)\)$/.exec(row.insertion);
    if (block) frecency.record("block", block[1]);
    else if (row.uid && (row.kind === "alias" || row.kind === "page" || row.kind === "drill")) frecency.record("page", row.uid);
    else return;
    pickInfo?.refresh();
  }

  // The row Roam's own list picked (Enter, Tab or a click while Burrow holds
  // nothing) is read back from the block a moment later: the text at the token
  // starts with ((uid)) or [[Title]]. A few string operations, no query.
  let nativePick = null;
  function rememberNative() {
    if (!frecency || !st.token || !st.ta || !(setting("frecency") || setting("recentRows"))) return;
    const memo = { ta: st.ta, start: st.token.start, kind: st.token.kind };
    nativePick = memo;
    let frames = NATIVE_PICK_FRAMES;
    const wait = () => {
      if (frames-- > 0 && nativePick === memo) { win.requestAnimationFrame(wait); return; }
      if (nativePick === memo) { readNative(); nativePick = null; }
    };
    win.requestAnimationFrame(wait);
  }

  function readNative() {
    const memo = nativePick;
    if (!memo || lifecycle.disposed || !memo.ta.isConnected) return false;
    const text = memo.ta.value.slice(memo.start);
    if (memo.kind === "((") {
      const m = /^\(\(([\w-]{9})\)\)/.exec(text);
      if (!m) return false;
      frecency.record("block", m[1]);
    } else {
      const m = /^\[\[([^\]]+)\]\]/.exec(text);
      const uid = m ? indexes.titles?.resolve(m[1])?.uid : null;
      if (!uid) return false;
      frecency.record("page", uid);
    }
    nativePick = null;
    pickInfo?.refresh();
    return true;
  }

  function onNativeMouseDown(event) {
    if (st.phase === "IDLE" || st.phase === "SCOPE" || !st.token) return;
    if (event.target.closest?.(NATIVE_ROWS) && st.pop?.contains(event.target)) rememberNative();
  }

  // ---- mouse ----

  function onStripMouseDown(event) {
    event.preventDefault();
    event.stopPropagation();
    if (st.prompt) return;
    const chip = event.target.closest?.(".burrow-chip");
    if (chip) {
      const row = shown[st.active];
      if (row && !commit(chipRow(row, Number(chip.dataset.index)))) reset("click-refused");
      return;
    }
    const node = event.target.closest?.(".burrow-row");
    if (!node) return;
    const row = shown[Number(node.dataset.index)];
    if (row && !commit(row)) reset("click-refused");
  }

  function onScopeMouseDown(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!st.scope) return;
    if (event.target.closest?.(".burrow-help-button")) return;
    const crumb = event.target.closest?.(".burrow-crumb");
    if (crumb) {
      if (crumb.dataset.level == null) exitScope(); else scopeBack(Number(crumb.dataset.level));
      return;
    }
    const row = event.target.closest?.(".burrow-row");
    if (!row) return;
    const level = scopeLevel();
    level.active = Number(row.dataset.index);
    const clicked = st.scope.rows[level.active];
    if (clicked?.more != null) scopeMore();
    else if (clicked?.empty && clicked.drillable) scopeDeeper();
    else if (!scopeCommit()) reset("click-refused");
  }

  function onCompositionStart(event) {
    if (!isBlockInput(event.target)) return;
    if (st.prompt && composer.start(event)) return;
    st.composing = true;
    pendingTa = null;
    reset("composition");
  }

  function onCompositionEnd(event) {
    if (!isBlockInput(event.target)) return;
    if (st.prompt && composer.end(event)) return;
    st.composing = false;
    if (anyFeature()) evaluate(event.target);
  }

  function onFocusOut(event) {
    if (event.target !== st.ta) return;
    win.setTimeout(() => { if (st.ta && doc.activeElement !== st.ta) reset("blur"); }, 0);
  }

  // ---- hover tips (src/tips.js): what is under the pointer and its keys ----

  const guardedTip = (resolve) => (target) => {
    try { return resolve(target); } catch (error) { console.error("[burrow] tip failed", error); return null; }
  };
  const drillLine = (uid, what) => (setting("tabDrill") && hasKids(uid) ? ["⇥", what] : null);

  function stripTip(target) {
    const chip = target.closest?.(".burrow-chip");
    const active = shown[st.active];
    if (chip && active?.kind === "alias") {
      const i = Number(chip.dataset.index);
      return { el: chip, title: chipTitle(active, active.aliases[i]), lines: [
        ["↵", `or click: insert ${chipRow(active, i).insertion}`],
        ["←→", "move between the aliases"],
        setting("aliasDelete") ? [keyLabel("altBackspace"), "delete the selected alias (asks first)"] : null,
      ].filter(Boolean) };
    }
    const promptRow = target.closest?.(".burrow-prompt");
    if (promptRow && st.prompt?.kind === "add") {
      return { el: promptRow, title: `New alias for ${st.prompt.page.title}`, lines: [["↵", "add it to the page's Aliases:: block, then insert it"], ["esc", "cancel; nothing is written"]] };
    }
    const where = target.closest?.(".burrow-context");
    if (where) {
      return { el: where, title: where.title || null, lines: [
        ["", "where the highlighted block lives: its page and parent"],
        setting("tabDrill") ? ["⇥", "list the children of this block"] : null,
        setting("refOutline") ? ["⇧⇥", "go up to its parent"] : null,
      ].filter(Boolean) };
    }
    const confirm = target.closest?.(".burrow-chips.burrow-confirm");
    if (confirm) return { el: confirm, title: null, lines: [["↵", "delete this alias from the page"], ["esc", "keep it"]] };
    const node = target.closest?.(".burrow-row");
    const row = node ? shown[Number(node.dataset.index)] : null;
    if (!row) return null;
    if (row.kind === "alias") {
      return { el: node, title: `${row.alias} ↳ ${row.title}`, lines: [
        ["↵", `or click: insert ${row.insertion}`],
        setting("aliasChips") && row.aliases.length > 1 ? [keyLabel("altDown"), `pick one of its ${row.aliases.length} aliases`] : null,
        drillLine(row.uid, "list the blocks on this page"),
        setting("aliasCreate") ? [keyLabel("altA"), "add an alias to this page"] : null,
      ].filter(Boolean) };
    }
    if (row.kind === "page") {
      return { el: node, title: row.title, lines: [
        ["", row.recent === "pick" ? "Recent pick" : "Edited recently"],
        ["↵", `or click: insert ${row.insertion}`],
        drillLine(row.uid, "list the blocks on this page"),
        setting("aliasCreate") ? [keyLabel("altA"), "add an alias to this page"] : null,
      ].filter(Boolean) };
    }
    const upLine = setting("refOutline") ? ["⇧⇥", "go up to its parent (the parent's children, this block highlighted)"] : null;
    if (row.kind === "ref") {
      return { el: node, title: row.text, lines: [
        ["↵", `or click: insert ((${row.uid}))`],
        row.recent ? ["", row.recent === "pick" ? "Recent pick" : "Edited recently"] : null,
        row.refs > 0 ? ["", `${row.refs} block${row.refs === 1 ? "" : "s"} reference it`] : null,
        drillLine(row.uid, "list the children of this block"),
        upLine,
      ].filter(Boolean) };
    }
    return { el: node, title: row.crumb ? `${row.crumb} › ${row.text}` : row.text, lines: [
      ["↵", "insert the block the drill-down reaches"],
      drillLine(row.uid, "list the children of this block"),
      ownedSource(row, -1)?.block ? upLine : null,
    ].filter(Boolean) };
  }

  function hintTip(target) {
    if (target.closest?.(".burrow-help-button")) {
      const lines = [[keyLabel("altSlash"), "or click: every key Burrow adds, for the switches that are on"]];
      if (helpButton.dataset.mode === "nudge") lines.push(["✕", "hide this line; ? stays"]);
      return { el: helpButton, title: "Burrow keys", lines };
    }
    const item = target.closest?.(".burrow-hint");
    const hint = item ? hintItems[Number(item.dataset.hint)] : null;
    return hint ? { el: item, title: null, lines: [[hint[0], hint[2] || hint[1]]] } : null;
  }

  function scopeTip(target) {
    if (target.closest?.(".burrow-help-button")) return { el: target.closest(".burrow-help-button"), title: "Burrow keys", lines: [[keyLabel("altSlash"), "or click: every key Burrow adds"]] };
    const crumb = target.closest?.(".burrow-crumb");
    if (crumb) return { el: crumb, title: crumb.textContent, lines: [["click", crumb.dataset.level == null ? "back to the results" : "back to this level"]] };
    const item = target.closest?.(".burrow-hint");
    const hint = item ? scopePanel.hintItems[Number(item.dataset.hint)] : null;
    if (hint) return { el: item, title: null, lines: [[hint[0], hint[2] || hint[1]]] };
    const node = target.closest?.(".burrow-row");
    const row = node && st.scope ? st.scope.rows[Number(node.dataset.index)] : null;
    if (!node || !st.scope) return null;
    if (!row) return { el: node, title: scopeLevel().label, lines: [["↵", "insert this level"]] };
    if (row.more != null) return { el: node, title: `${row.more} more blocks`, lines: [["↵", "or click: list the next 50"]] };
    return { el: node, title: row.text || "(empty)", lines: [
      row.empty && row.drillable ? ["↵", "or click: go into it"] : ["↵", `or click: insert ((${row.uid}))`],
      row.drillable ? ["⇥ or >", "go into it"] : null,
    ].filter(Boolean) };
  }

  function previewTip(target, pane) {
    const node = target.closest?.(".burrow-preview");
    if (!node) return null;
    const trail = [...node.querySelectorAll(".burrow-trail .burrow-crumb")].map((n) => n.textContent).join(" › ");
    if (pane === scopePreview) return { el: node, title: trail, lines: [[keyLabel("ctrlO"), "show or hide this preview"], ["", "read-only; the highlighted line is the selected block"]] };
    if (st.drill) return { el: node, title: trail, lines: [["↵", "insert the highlighted block"], ["", "read-only; follows what you type after # and >"]] };
    return { el: node, title: trail, lines: [[keyLabel("ctrlO"), "close Roam's preview (and this one)"], ["", "read-only preview of the highlighted Burrow row: its page, or the block among its siblings; Tab lists what is under it"]] };
  }

  // A Burrow bug must never cost the user a keystroke: on any throw Burrow
  // drops to IDLE and the event continues to Roam untouched. The one
  // exception is Enter or Tab while Burrow's row or panel held the
  // highlight: Roam's own row was not highlighted, so the key stops here.
  const guarded = (name, handler) => (event) => {
    const held = name === "keydown" && (st.phase === "OWNED" || st.phase === "SCOPE" || Boolean(st.prompt))
      && (event.key === "Enter" || event.key === "Tab");
    try {
      handler(event);
    } catch (error) {
      debug.lastFailure = { reason: `throw:${name}`, at: Date.now(), message: String(error?.message || error) };
      console.error(`[burrow] ${name} failed; falling back to Roam`, error);
      if (held) consume(event);
      try { reset("error"); } catch { /* already broken */ }
    }
  };

  // The caret moved (a click, ←/→ while Roam's row is highlighted, a
  // programmatic move): rank again for the text before it, as Roam does, so
  // Burrow's rows never stay from an older caret.
  function onSelectionChange() {
    const ta = st.ta;
    if (!ta || st.prompt || doc.activeElement !== ta || !anyFeature()) return;
    // Back at the end of a token Roam still has a popup for (after ← and →).
    if (st.phase === "IDLE") {
      if (pendingTa == null && doc.querySelector(POPUP)) scheduleEvaluate(ta);
      return;
    }
    if (stale(ta)) {
      if (st.phase === "SCOPE") exitScope();
      scheduleEvaluate(ta);
    }
  }

  // The pointer moving over a Burrow row selects it, so there is one
  // highlight and Enter does what it shows. Only a real move counts: Roam
  // and the browser send mouse events when the content under a resting
  // pointer changes.
  let lastPointer = null;
  function onStripMouseMove(event) {
    const at = `${event.clientX},${event.clientY}`;
    if (at === lastPointer) return;
    lastPointer = at;
    if (st.prompt || st.help || (st.phase !== "ARMED" && st.phase !== "OWNED")) return;
    const node = event.target.closest?.(".burrow-row");
    if (!node || !strip.contains(node)) return;
    const index = Number(node.dataset.index);
    if (!shown[index] || (st.phase === "OWNED" && st.active === index)) return;
    if (st.phase === "OWNED" && st.chip >= 0) st.chip = -1;
    own(index);
    st.auto = false;
    paintActive();
  }

  function onScopeMouseMove(event) {
    const at = `${event.clientX},${event.clientY}`;
    if (at === lastPointer) return;
    lastPointer = at;
    if (st.phase !== "SCOPE" || !st.scope) return;
    const node = event.target.closest?.(".burrow-scope-list .burrow-row");
    if (!node) return;
    const index = Number(node.dataset.index);
    const level = scopeLevel();
    if (!st.scope.rows[index] || level.active === index) return;
    level.active = index;
    scopePanel.paintActive(st.scope, setting("keyHints"), setting("helpSheet"), false);
    showScopePreview();
  }

  lifecycle.event(win, "keydown", guarded("keydown", onKeyDown), true);
  lifecycle.event(doc, "selectionchange", guarded("selectionchange", onSelectionChange));
  lifecycle.event(strip, "mousemove", guarded("mousemove", onStripMouseMove));
  lifecycle.event(win, "input", guarded("input", onInput), true);
  lifecycle.event(win, "compositionstart", guarded("compositionstart", onCompositionStart), true);
  lifecycle.event(win, "compositionupdate", guarded("compositionupdate", (event) => { if (st.prompt) composer.update(event); }), true);
  lifecycle.event(win, "compositionend", guarded("compositionend", onCompositionEnd), true);
  lifecycle.event(win, "beforeinput", guarded("beforeinput", (event) => { if (st.prompt && !composer.input(event)) composer.insert(event); }), true);
  lifecycle.event(win, "keyup", guarded("keyup", (event) => { if (st.prompt) composer.key(event); }), true);
  lifecycle.event(doc, "focusout", guarded("focusout", onFocusOut), true);
  lifecycle.event(win, "paste", guarded("paste", onPaste), true);
  lifecycle.event(strip, "wheel", guarded("wheel", onStripWheel), { passive: false });
  lifecycle.event(chipsNode, "scroll", () => { chipsScrolled = chipsNode.scrollLeft > 0; }, { passive: true });
  lifecycle.event(strip, "mousedown", guarded("mousedown", onStripMouseDown));
  lifecycle.event(win, "mousedown", guarded("mousedown", onNativeMouseDown), true);
  lifecycle.event(hints, "mousedown", guarded("mousedown", onHintsMouseDown));
  lifecycle.event(hints, "click", guarded("click", onHelpClick));
  lifecycle.event(scopePanel.node, "click", guarded("click", onHelpClick));
  lifecycle.event(sheet.node, "mousedown", (event) => { event.preventDefault(); event.stopPropagation(); });
  for (const p of [preview, scopePreview]) lifecycle.event(p.node, "mousedown", (event) => { event.preventDefault(); event.stopPropagation(); });
  tips.attach(strip, guardedTip(stripTip));
  tips.attach(hints, guardedTip(hintTip));
  tips.attach(scopePanel.node, guardedTip(scopeTip));
  for (const p of [preview, scopePreview]) tips.attach(p.node, guardedTip((target) => previewTip(target, p)));
  // An alias edited anywhere (Burrow's watch, src/indexes.js) re-ranks an
  // open popup at once, unless the user has picked a row or is in the chips.
  const unlisten = indexes.listen?.(() => {
    pickInfo?.refresh();
    if (!st.ta || !st.token || st.phase === "IDLE" || st.phase === "SCOPE" || st.prompt || st.help || st.chip >= 0) return;
    if (st.phase === "OWNED" && !st.auto) return;
    if (doc.activeElement === st.ta) scheduleEvaluate(st.ta);
  });
  if (unlisten) lifecycle.add(unlisten);
  lifecycle.event(scopePanel.node, "mousedown", guarded("mousedown", onScopeMouseDown));
  lifecycle.event(scopePanel.node, "mousemove", guarded("mousemove", onScopeMouseMove));
  lifecycle.add(() => reset("unload"));

  return { state: st, debug, reset, tree, forget };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
