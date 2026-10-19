import { aliasInsertion, groupAliasHits, matchAliases, roamAliasesWillList } from "./aliases.js";
import { parseDrill, resolveDrill } from "./drill.js";
import { createTreeSource } from "./pagetree.js";
import { createPreview, DRILL_CLASS, previewModel } from "./preview.js";
import { rankRefs } from "./refindex.js";
import { scopeRows } from "./scope.js";
import { createScopePanel } from "./scopeview.js";
import { searchKey, searchPlan, stripRoamMarkup } from "./search.js";
import { isDarkHost } from "./theme.js";
import { applyToken, findToken, tokenStillValid } from "./token.js";

const POPUP = ".rm-autocomplete__results";
const NATIVE_ROWS = ".rm-autocomplete__results-scroll > div";
const OWNS = "burrow-owns-selection";
const PAD = "burrow-pad";
const PAD_BOTTOM = "burrow-pad-foot";
const FOLD_ALIASES = "burrow-fold-aliases";
const LAYOUT = "burrow-layout";
const SCOPE_OPEN = "burrow-scope-open";
const FOLDED = "data-burrow-folded";
// Row, chips and hints heights; src/extension.css's burrow-pad-* rules are built from them.
const ROW_HEIGHT = 33;
const CHIPS_HEIGHT = 28;
const HINTS_HEIGHT = 22;
// .burrow-chips side padding in src/extension.css.
const CHIPS_INSET = 8;
const ROW_LIMIT = 3;
const PAD_SIZES = Array.from({ length: ROW_LIMIT }, (_, i) => i + 1).flatMap((n) => [`${PAD}-${n}`, `${PAD}-${n}c`]);
// Every class Burrow puts on Roam's popover; each one is removed again on reset.
const POP_CLASSES = [OWNS, DRILL_CLASS, PAD, ...PAD_SIZES, PAD_BOTTOM, FOLD_ALIASES, LAYOUT, SCOPE_OPEN];
const MIN_REF_QUERY = 3;
const MIN_ALIAS_QUERY = 2;
const POPUP_WAIT_FRAMES = 12;
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
export function createStrip({ setting, indexes, perf, lifecycle, api, picks = null, doc = document, win = window }) {
  const st = {
    phase: "IDLE", ta: null, token: null, uid: null, rows: [], active: -1, drill: null, pageTitle: null,
    pop: null, composing: false, ignoreNextInput: false, released: null, waitFrame: 0, observers: [],
    auto: false, chip: -1, scope: null,
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
  const chipsNode = doc.createElement("div");
  chipsNode.className = "burrow-chips";
  const hints = doc.createElement("div");
  hints.className = "burrow-hints";
  hints.hidden = true;
  lifecycle.node(hints, doc.body);
  const preview = createPreview({ doc, win, lifecycle });
  const scopePreview = createPreview({ doc, win, lifecycle });
  const scopePanel = createScopePanel({ doc, win, lifecycle, highlight: (text, query) => highlight(text, query) });
  const fast = api.data?.fast?.q ? (query, ...args) => api.data.fast.q(query, ...args) : (query, ...args) => api.q(query, ...args);
  const tree = createTreeSource({
    pull: (pattern, eid) => api.pull(pattern, eid),
    q: fast,
    onFetch: (kind) => { perf.counters[kind === "query" ? "drillQueries" : "drillPulls"] = (perf.counters[kind === "query" ? "drillQueries" : "drillPulls"] || 0) + 1; },
  });

  const anyFeature = () => setting("aliasPages") || setting("refRanking") || setting("drill") || setting("tabDrill")
    || setting("paneLayout") || setting("keyHints");
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
    const hits = matchAliases(indexes.aliases, plan, { strict: !recall, limit: Infinity, picked: memory?.lookup("alias", token.query) });
    if (setting("aliasInline")) {
      return groupAliasHits(hits, indexes.aliases).map((hit) => ({
        kind: "alias", key: `alias:${hit.uid}`, uid: hit.uid, alias: hit.alias, title: hit.title, aliases: hit.aliases,
        refs: hit.refs, level: hit.level, insertion: aliasInsertion(hit, format), pick: `${hit.uid}:${hit.alias}`,
      }));
    }
    return hits
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
    if (st.token?.kind !== "[[" || st.drill || setting("aliasInline")) return st.rows.slice(0, ROW_LIMIT);
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
    if (st.phase === "SCOPE") { placeScope(); return; }
    const rows = visibleRows();
    const query = st.token?.query ?? null;
    const same = query === shownQuery && rows.length === shown.length && rows.every((row, i) => row.key === shown[i].key);
    if (!same) {
      strip.replaceChildren(...rows.map((row, i) => rowNode(row, i)));
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
    const wanted = rows[0].kind === "drill" || (st.token.kind === "((" && setting("refPreselect") && rows[0].level >= 2)
      || (setting("aliasPreselect") && rows[0].kind === "alias" && aliasStarts(rows[0].alias, query) && !exactTitle(query));
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
  function showPreview() {
    if (!st.drill || !setting("drillPreview") || !st.pop) { preview.hide(); return; }
    if (model?.drillKey !== st.drill.key) {
      model = previewModel(st.drill, tree, readableText);
      model.drillKey = st.drill.key;
    }
    preview.show(model, st.pop, { avoid: st.ta?.getBoundingClientRect() });
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
    } else if (row.kind === "alias" && row.refs != null) {
      const count = doc.createElement("sup");
      count.className = "rm-autocomplete__ref-count";
      count.textContent = String(row.refs);
      count.title = `${row.refs} linked reference${row.refs === 1 ? "" : "s"}`;
      node.append(count);
    }
    return node;
  }

  function highlight(text, query = st.token?.query) {
    const fragment = doc.createDocumentFragment();
    const words = (String(query ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1);
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
    paintChips();
    layoutPop();
  }

  // The active alias row's other aliases, directly under it. Only this part
  // is rebuilt when the active row changes; rows keep the class-only path.
  let chipsFor = null;
  let chipsScrolled = false;
  const chipsAvailable = (row) => st.phase === "OWNED" && setting("aliasChips") && row?.kind === "alias" && row.aliases.length > 1;

  function paintChips() {
    const row = shown[st.active];
    const show = chipsAvailable(row);
    if (!show) {
      st.chip = -1;
      chipsFor = null;
      chipsScrolled = false;
      chipsNode.remove();
    } else {
      const key = `${row.key}\u0000${row.aliases.join("\u0000")}`;
      if (key !== chipsFor) {
        chipsFor = key;
        chipsNode.replaceChildren(
          Object.assign(doc.createElement("span"), { className: "burrow-chips-label", textContent: "aliases:" }),
          ...row.aliases.map((alias, i) => {
            const chip = Object.assign(doc.createElement("span"), { className: "burrow-chip", textContent: alias });
            chip.dataset.index = String(i);
            return chip;
          }),
        );
      }
      chipsNode.querySelectorAll(".burrow-chip").forEach((node, i) => node.classList.toggle("burrow-active", i === st.chip));
      const rowNode = strip.querySelectorAll(".burrow-row")[st.active];
      if (rowNode && chipsNode.previousElementSibling !== rowNode) rowNode.after(chipsNode);
      revealChip();
    }
    setPad(shown.length, show);
  }

  // The chips are one clipped line; scroll it so the active chip shows, and
  // back to the start (the label) on the first chip or out of chip mode.
  // Layout is read only in chip mode, never while typing.
  function revealChip() {
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

  // The strip overlays the top of Roam's list column, the hints line its
  // bottom; static classes (burrow-pad-N, -Nc with the chips) pad that column
  // (not the preview beside it) so no native row is covered. A class toggle
  // restyles only the popover; a rewritten stylesheet would restyle the whole
  // document on every row-count change.
  function setPad(count, withChips) {
    if (!st.pop) return;
    const wanted = count > 0 ? `${PAD}-${Math.min(count, ROW_LIMIT)}${withChips ? "c" : ""}` : null;
    for (const cls of PAD_SIZES) if (st.pop.classList.contains(cls) !== (cls === wanted)) st.pop.classList.toggle(cls);
    if (wanted) st.pop.classList.add(PAD);
    else st.pop.classList.remove(PAD);
  }

  const listColumn = (pop) => pop.querySelector(":scope > .rm-autocomplete__results-main") || pop;

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

  // Strip and chips off the popover (no rows), layout classes stay.
  function hideRows() {
    strip.hidden = true;
    chipsNode.remove();
    chipsFor = null;
    preview.hide();
    st.pop?.classList.remove(OWNS, DRILL_CLASS, PAD, ...PAD_SIZES);
  }

  // Everything Burrow put on the popover and on roam-aliases' rows, undone.
  function clearPopover() {
    if (!st.pop) return;
    st.pop.classList.remove(...POP_CLASSES);
    for (const node of st.pop.querySelectorAll(`[${FOLDED}]`)) node.removeAttribute(FOLDED);
  }

  function hideStrip() {
    scopePanel.hide();
    scopePreview.hide();
    strip.hidden = true;
    chipsNode.remove();
    chipsFor = null;
    hints.hidden = true;
    preview.hide();
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

  // Classes only; layoutPop() reads geometry once after every write.
  function syncPanes(rows) {
    const pop = st.pop;
    if (!pop) return;
    // roam-aliases only lists in [[.
    if (st.token?.kind !== "[[") { pop.classList.remove(FOLD_ALIASES, LAYOUT); return; }
    const fold = setting("aliasPages") && setting("aliasInline") && !st.drill;
    const items = [...pop.querySelectorAll(".rm-aliases .dont-focus-block.alias")];
    let visible = 0;
    for (const item of items) {
      if (fold && foldedByRow(item, rows)) item.setAttribute(FOLDED, "");
      else { item.removeAttribute(FOLDED); visible += 1; }
    }
    pop.classList.toggle(FOLD_ALIASES, items.length > 0 && visible === 0);
    pop.classList.toggle(LAYOUT, setting("paneLayout") && visible > 0);
  }

  function hintList() {
    if (st.phase === "SCOPE") return [];
    const row = shown[st.active];
    const list = [];
    if (setting("tabDrill") && (st.token?.kind === "[[" || (st.phase === "OWNED" && row?.kind === "ref"))) list.push(["⇥", "drill in"]);
    if (chipsAvailable(row)) list.push(...(st.chip >= 0 ? [["←→", "alias"], ["↵", "insert"], ["esc", "rows"]] : [["⌥↓", "aliases"]]));
    return list;
  }

  // The hints line's content and class, then the one geometry read of a
  // render: Roam's list column, which the strip tops and the hints line ends.
  let hintsFor = null;
  function layoutPop() {
    const pop = st.pop;
    if (!pop) return;
    const list = setting("keyHints") ? hintList() : [];
    if (!list.length) {
      hints.hidden = true;
      hintsFor = null;
      pop.classList.remove(PAD_BOTTOM);
    } else {
      const key = list.map((hint) => hint.join(" ")).join("|");
      if (key !== hintsFor) {
        hintsFor = key;
        hints.replaceChildren(...list.map(([keys, label]) => {
          const item = doc.createElement("span");
          item.className = "burrow-hint";
          item.append(Object.assign(doc.createElement("kbd"), { textContent: keys }), label);
          return item;
        }));
      }
      pop.classList.add(PAD_BOTTOM);
    }
    if (strip.hidden && !list.length) return;
    const rect = listColumn(pop).getBoundingClientRect();
    const left = `${Math.round(rect.left)}px`;
    const width = `${Math.round(rect.width)}px`;
    if (!strip.hidden) Object.assign(strip.style, { left, top: `${Math.round(rect.top)}px`, width });
    if (list.length) {
      Object.assign(hints.style, { left, top: `${Math.round(rect.bottom - HINTS_HEIGHT)}px`, width });
      hints.hidden = false;
    }
  }

  // ---- popup attach / detach ----

  function attach(pop) {
    if (st.pop === pop) return;
    detach();
    st.pop = pop;
    sampleTheme(pop);
    if (st.phase === "SCOPE") pop.classList.add(SCOPE_OPEN);
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
    st.auto = false;
    st.chip = -1;
    st.scope = null;
    model = null;
    scopeModel = null;
    tree.clear();
    shown = [];
    shownQuery = null;
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
    if (st.ignoreNextInput) { st.ignoreNextInput = false; return; }
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
    if (pendingTa && ACTION_KEYS.has(event.key) && event.target === pendingTa) flush();
    if (st.phase === "IDLE") return;
    if (event.isComposing || st.composing || event.keyCode === 229) return;
    const ta = event.target;
    if (ta !== st.ta || !anyFeature()) { reset("foreign-key"); return; }
    if (ta.selectionStart !== ta.selectionEnd) return;
    const count = shown.length;
    const key = event.key;
    if (st.phase === "SCOPE") { scopeKey(event); return; }
    if (st.phase === "OWNED" && chipKey(event)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (st.phase === "ARMED") {
      if (key === "Tab" && !event.shiftKey && setting("tabDrill") && st.token.kind === "[[" && enterScope(armedSource(), event)) return;
      if (key === "ArrowUp" && !event.shiftKey && count && !strip.hidden && nativeActiveIsFirst()) {
        own(count - 1);
        st.auto = false;
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
    else if ((key === "ArrowUp" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) || (key === "Escape" && plain)) st.chip = -1;
    else if (plain && (key === "Enter" || key === "Tab")) {
      if (key === "Tab" && setting("tabDrill") && enterScope(ownedSource(row, st.chip), event)) return true;
      if (!commit(chipRow(row, st.chip))) reset("commit-refused");
      consume(event);
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

  function chipRow(row, index) {
    const alias = row.aliases[index];
    return { ...row, insertion: aliasInsertion({ alias, title: row.title }, setting("aliasLinkFormat")), pick: `${row.uid}:${alias}` };
  }

  // ---- Tab drill (scope) ----

  // Where Tab would drill from: the active Burrow row when OWNED ...
  function ownedSource(row, chip) {
    if (!row) return null;
    if (row.kind === "alias") {
      const insertion = chip >= 0 ? chipRow(row, chip).insertion : row.insertion;
      return { uid: row.uid, label: row.title, page: { uid: row.uid, title: row.title }, insertion };
    }
    if (row.kind === "ref") return { uid: row.uid, label: row.text, page: null, insertion: row.insertion };
    if (row.kind === "drill" && st.drill) return { uid: row.uid, label: row.text, page: st.drill.page, insertion: row.insertion };
    return null;
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

  function enterScope(source, event) {
    const ta = st.ta;
    if (!source || !st.pop || st.composing || event.target !== ta) return false;
    if (!tokenStillValid(ta.value, ta.selectionStart, ta.selectionEnd, st.token)) return false;
    if (!tree.children(source.uid).length) return false;
    st.scope = {
      rootLabel: st.token.kind === "[[" ? "Pages" : "Blocks",
      levels: [{ ...source, query: "", active: 0 }],
      rows: [],
      returnTo: { phase: st.phase, active: st.active, chip: st.chip },
    };
    st.phase = "SCOPE";
    st.auto = false;
    st.chip = -1;
    trace({ ev: "scope-enter", uid: source.uid });
    strip.hidden = true;
    chipsNode.remove();
    preview.hide();
    st.pop.classList.remove(OWNS, DRILL_CLASS, PAD, ...PAD_SIZES, PAD_BOTTOM);
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
    st.scope.rows = scopeRows(tree.twoLevels(level.uid), level.query, { strict: !setting("betterMatch"), text: readableText });
    level.active = keepActive ? Math.min(level.active, Math.max(0, st.scope.rows.length - 1)) : 0;
    scopePanel.show(st.scope, setting("keyHints"));
    placeScope();
  }

  let scopeModel = null;
  function placeScope() {
    const scope = st.scope;
    const pop = st.pop;
    if (!scope || !pop) return;
    pop.classList.add(SCOPE_OPEN);
    const popRect = pop.getBoundingClientRect();
    const main = pop.classList.contains("rm-autocomplete__results--expanded") ? pop.querySelector(".rm-autocomplete__results-main") : null;
    scopePanel.place(main ? main.getBoundingClientRect() : popRect, popRect, st.ta.getBoundingClientRect());
    showScopePreview();
  }

  function showScopePreview() {
    const level = scopeLevel();
    if (!setting("drillPreview")) { scopePreview.hide(); return; }
    const row = st.scope.rows[level.active];
    const target = row ? row.node : (level.page?.uid === level.uid ? null : tree.get(level.uid));
    const first = tree.trail(level.uid)[0];
    const page = level.page || (first ? { uid: first.uid, title: first.title } : null);
    if (!page) { scopePreview.hide(); return; }
    const key = `${page.uid}:${target?.uid ?? ""}`;
    if (scopeModel?.drillKey !== key) {
      scopeModel = previewModel({ page, target }, tree, readableText);
      scopeModel.drillKey = key;
    }
    scopePreview.show(scopeModel, st.pop, { beside: scopePanel.node.getBoundingClientRect(), avoid: st.ta.getBoundingClientRect() });
  }

  function scopeMove(delta) {
    const level = scopeLevel();
    level.active = Math.max(0, Math.min(Math.max(0, st.scope.rows.length - 1), level.active + delta));
    scopePanel.paintActive(st.scope, setting("keyHints"));
    showScopePreview();
  }

  function scopeDeeper() {
    const level = scopeLevel();
    const row = st.scope.rows[level.active];
    if (!row?.drillable) return;
    st.scope.levels.push({ uid: row.uid, label: row.text || "(empty)", page: level.page, insertion: `((${row.uid}))`, query: "", active: 0 });
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
    return commit(row
      ? { kind: "scope", key: `scope:${row.uid}`, insertion: `((${row.uid}))` }
      : { kind: "scope", key: `scope:${level.uid}`, insertion: level.insertion });
  }

  function scopeKey(event) {
    const key = event.key;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const level = scopeLevel();
    if (key === "Tab") {
      consume(event);
      if (event.shiftKey) scopeBack(); else scopeDeeper();
      return;
    }
    if (key === "Enter") {
      if (scopeCommit()) consume(event); else reset("commit-refused");
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
      if (level.query) { level.query = [...level.query].slice(0, -1).join(""); scopeRefresh(false); } else scopeBack();
      return;
    }
    if (key.length === 1) {
      consume(event);
      if (key === ">" && st.scope.rows[level.active]?.drillable) { scopeDeeper(); return; }
      level.query += key;
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
    const crumb = event.target.closest?.(".burrow-crumb");
    if (crumb) {
      if (crumb.dataset.level == null) exitScope(); else scopeBack(Number(crumb.dataset.level));
      return;
    }
    const row = event.target.closest?.(".burrow-row");
    if (!row) return;
    scopeLevel().active = Number(row.dataset.index);
    if (!scopeCommit()) reset("click-refused");
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
  lifecycle.event(scopePanel.node, "mousedown", guarded("mousedown", onScopeMouseDown));
  lifecycle.add(() => reset("unload"));

  return { state: st, debug, reset, tree };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
