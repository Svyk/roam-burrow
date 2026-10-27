import { searchKey } from "./search.js";
import { taskParts } from "./tasks.js";

// Query filters (queryFilters, BRW-18): `"quoted phrase"`, `-word`,
// `in:here`, `in:Page Title`, `ns:Systems/`, `is:todo`, `is:done`. A filter
// needs its colon, its quotes or its leading `-` before a letter; any other
// word is search text. Burrow reads them from the token, never rewrites it:
// Roam's own search gets the same text.

const NAMED = /^(in|ns|is):/i;
// A filter starts here: `in:` `ns:` `is:`, a quote, or `-` before a letter
// or a quote (`-20` and `a - b` stay text).
const startsFilter = (s, at) => NAMED.test(s.slice(at, at + 3)) || s[at] === "\"" || (s[at] === "-" && /[\p{L}"]/u.test(s[at + 1] ?? ""));
const TASK_STATES = ["todo", "done"];

// Returns null when the query holds no filter (the common case, one regex),
// else { text, planText, phrases, excludes, here, pages, ns, is, labels }:
//   text: the search words, filters removed (highlight, pick memory, code test);
//   planText: text plus the phrases' words, what the scorer ranks on;
//   phrases: [{ key, open }] (open: no closing quote yet, last word a prefix);
//   excludes: [key]; here: in:here; pages: in: values; ns: namespaces
//   without their trailing `/`; is: ["todo" | "done" | null (unknown)];
//   labels: each filter as typed, for the label line.
export function parseFilters(query) {
  const s = String(query ?? "");
  if (!/["]|(?:^|\s)(?:-[\p{L}"]|(?:in|ns|is):)/iu.test(s)) return null;
  const words = [];
  const phrases = [];
  const excludes = [];
  const pages = [];
  const ns = [];
  const is = [];
  const labels = [];
  let here = false;
  // A filter typed so far without its value (`in:`, `is:`, a lone `"`) is
  // still taken out of the search text.
  let consumed = false;
  let at = 0;
  const quoted = (from) => {
    const close = s.indexOf("\"", from + 1);
    const end = close < 0 ? s.length : close;
    return { value: s.slice(from + 1, end), open: close < 0, next: close < 0 ? s.length : close + 1 };
  };
  // An in: or ns: value runs to the next filter or the end, so a title with
  // spaces needs no quotes; a quoted value ends at its quote.
  const longValue = (from) => {
    if (s[from] === "\"") return quoted(from);
    let end = from;
    while (end < s.length) {
      const space = s.slice(end).search(/\s/);
      if (space < 0) { end = s.length; break; }
      let next = end + space;
      while (next < s.length && /\s/.test(s[next])) next++;
      if (next >= s.length || startsFilter(s, next)) { end += space; break; }
      end = next;
    }
    return { value: s.slice(from, end), next: end };
  };
  const word = (from) => {
    const m = /\S*/.exec(s.slice(from));
    return { value: m[0], next: from + m[0].length };
  };
  while (at < s.length) {
    if (/\s/.test(s[at])) { at++; continue; }
    if (startsFilter(s, at)) consumed = true;
    const head = s.slice(at, at + 3).toLowerCase();
    if (s[at] === "\"") {
      const q = quoted(at);
      const key = searchKey(q.value);
      if (key.tokens.length) {
        phrases.push({ key, open: q.open });
        labels.push(`"${q.value.trim()}${q.open ? "" : "\""}`);
      }
      at = q.next;
    } else if (s[at] === "-" && /[\p{L}"]/u.test(s[at + 1] ?? "")) {
      const q = s[at + 1] === "\"" ? quoted(at + 1) : word(at + 1);
      const key = searchKey(q.value);
      if (key.tokens.length) {
        excludes.push(key);
        labels.push(`-${s[at + 1] === "\"" ? `"${q.value.trim()}"` : q.value}`);
      }
      at = q.next;
    } else if (head === "is:") {
      const q = word(at + 3);
      const value = q.value.toLowerCase();
      if (value) {
        // A prefix names its state while it is typed (`is:t` is todo).
        is.push(TASK_STATES.find((state) => state.startsWith(value)) ?? null);
        labels.push(`is:${q.value}`);
      }
      at = q.next;
    } else if (head === "in:" || head === "ns:") {
      const q = longValue(at + 3);
      const value = q.value.trim();
      if (value) {
        if (head === "ns:") ns.push(value.replace(/\/+$/, ""));
        else if (value.toLowerCase() === "here") here = true;
        else pages.push(value);
        labels.push(`${head}${value}`);
      }
      at = q.next;
    } else {
      const q = word(at);
      words.push(q.value);
      at = q.next;
    }
  }
  if (!consumed) return null;
  const text = words.join(" ");
  const planText = [text, ...phrases.map((p) => p.key.spaced)].filter(Boolean).join(" ");
  return { text, planText, phrases, excludes, here, pages, ns, is, labels };
}

// The words of `needle` stand together in `key`, each whole; with `open` the
// last one may be a prefix (a phrase still being typed).
export function hasRun(key, needle, open = false) {
  const words = needle?.tokens;
  const tokens = key?.tokens;
  if (!words?.length || !tokens?.length) return false;
  const last = words.length - 1;
  for (let i = 0; i + last < tokens.length; i++) {
    if (tokens[i] !== words[0] && !(last === 0 && open && tokens[i].startsWith(words[0]))) continue;
    let ok = true;
    for (let k = 1; k <= last && ok; k++) {
      const t = tokens[i + k];
      ok = k === last && open ? t.startsWith(words[k]) : t === words[k];
    }
    if (ok) return true;
  }
  return false;
}

// The first task macro decides: `{{[[TODO]]}}` is todo, `{{[[DONE]]}}` (and
// Better Tasks' `{{[[DONE]]:((uid))}}`) done, anything else neither.
export function taskState(string) {
  for (const part of taskParts(string)) if (part.task) return part.task;
  return null;
}

// What the page filters (in:here, in:Page, ns:) allow, as a test on a page
// title; null when there are none. They add up: a page passes when any of
// them names it. resolve(text) -> { title } | null (titles or aliases);
// an in: value that names no page is compared as typed.
export function pageScope(filters, { currentPage = null, resolve = null } = {}) {
  if (!filters || (!filters.here && !filters.pages.length && !filters.ns.length)) return null;
  const titles = new Set();
  if (filters.here && currentPage != null) titles.add(String(currentPage).toLowerCase());
  for (const value of filters.pages) titles.add(String(resolve?.(value)?.title ?? value).toLowerCase());
  const spaces = filters.ns.map((n) => n.toLowerCase());
  return (title) => {
    if (title == null) return false;
    const t = String(title).toLowerCase();
    return titles.has(t) || spaces.some((n) => t === n || t.startsWith(`${n}/`));
  };
}

// A test on a referenced-block entry (src/refindex.js: string, page, key,
// codeKey) for rankRefs, or null when the query holds no filter. Phrases and
// excluded words are read from the prose key, and from the code key when
// code is matched (withCode).
export function refFilter(filters, { currentPage = null, resolve = null, withCode = false } = {}) {
  if (!filters) return null;
  const inScope = pageScope(filters, { currentPage, resolve });
  const keys = (entry) => (withCode && entry.codeKey ? [entry.key, entry.codeKey] : [entry.key]);
  return (entry) => {
    if (inScope && !inScope(entry.page)) return false;
    if (filters.is.length) {
      const state = taskState(entry.string);
      if (!filters.is.every((want) => want != null && want === state)) return false;
    }
    for (const phrase of filters.phrases) {
      if (!keys(entry).some((key) => hasRun(key, phrase.key, phrase.open))) return false;
    }
    for (const word of filters.excludes) {
      if (keys(entry).some((key) => hasRun(key, word))) return false;
    }
    return true;
  };
}

// The same for a page row in [[ (an alias entry: alias, title, key). A page
// is no task, so any is: filter leaves no page row.
export function pageFilter(filters, { currentPage = null, resolve = null } = {}) {
  if (!filters) return null;
  const inScope = pageScope(filters, { currentPage, resolve });
  const titleKeys = new Map();
  const titleKey = (title) => {
    let key = titleKeys.get(title);
    if (!key) titleKeys.set(title, (key = searchKey(title)));
    return key;
  };
  return (entry) => {
    if (filters.is.length) return false;
    if (inScope && !inScope(entry.title)) return false;
    const keys = [entry.key ?? searchKey(entry.alias), titleKey(entry.title)];
    for (const phrase of filters.phrases) {
      if (!keys.some((key) => hasRun(key, phrase.key, phrase.open))) return false;
    }
    for (const word of filters.excludes) {
      if (keys.some((key) => hasRun(key, word))) return false;
    }
    return true;
  };
}
