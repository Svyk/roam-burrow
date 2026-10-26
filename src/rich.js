// A block's text as Roam draws it, read-only: parse the markdown once into a
// short list of styled parts, cut a long one around the match, render with
// text nodes only. Pure; the rows and the preview call it per key, so the
// scanner is hand-written (module constants only, no regex built per call) and
// a code block's body is skipped with indexOf, never scanned.
import { checkbox, taskParts } from "./tasks.js";

const CHIP = "burrow-label";
const ATTR = "burrow-attr";
const ATTR_AT = /^\s*([^:\n`]{1,80})::\s*/;
const WS = /\s/;
const WS_RUN = /\s+/g;
const BRACKETS = /\[\[|\]\]/g;
const SMARTBLOCK = /:\d*SmartBlock:/i;
const BREF_IN = /\(\(([\w-]{9})\)\)/;
const FILE = /\.(?:pdf|docx|xlsx|pptx|zip|csv|mp4|mov|mp3|png|jpg|jpeg|gif)(?:[?#].*)?$/i;
const COMMENT = /^\s*(#|\/\/|--|;|%|\/\*|\*|<!--)/;
const MACRO_CAP = 4000;
const SPAN_CAP = 500;

const MACROS = new Map([
  ["embed", "embed"], ["embed-path", "embed"], ["embed-children", "embed"],
  ["roam/render", "render"], ["query", "query"], ["pdf", "pdf"],
  ["video", "video"], ["youtube", "video"], ["audio", "audio"], ["iframe", "iframe"],
]);
const LANGS = new Map([
  ["r", "R"], ["js", "JS"], ["javascript", "JS"], ["ts", "TS"], ["typescript", "TS"],
  ["py", "Python"], ["python", "Python"], ["clj", "Clojure"], ["clojure", "Clojure"], ["cljs", "Clojure"],
  ["sh", "Shell"], ["bash", "Shell"], ["shell", "Shell"], ["zsh", "Shell"],
  ["css", "CSS"], ["html", "HTML"], ["sql", "SQL"], ["json", "JSON"],
  ["md", "Markdown"], ["markdown", "Markdown"], ["yaml", "YAML"], ["yml", "YAML"],
]);
// Style marker -> class, in the order the classes are written.
const STYLES = [["**", "burrow-b"], ["__", "burrow-i"], ["^^", "burrow-hl"], ["~~", "burrow-s"]];

function langLabel(lang) {
  const key = lang.toLowerCase();
  if (!key) return "code";
  const known = LANGS.get(key);
  if (known) return known;
  return key.length <= 3 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
}

// The line of a code block that says what it is: the first that is not blank
// and not a comment, or with a needle the first code line it matches, else the
// first comment line it matches (a query hit in the code beats one in a comment).
export function codeLine(body, needle = null) {
  const text = String(body ?? "");
  let first = "";
  let firstCode = "";
  let comment = "";
  let at = 0;
  while (at <= text.length) {
    let end = text.indexOf("\n", at);
    if (end === -1) end = text.length;
    const line = text.slice(at, end);
    at = end + 1;
    if (!line.trim()) continue;
    if (needle) {
      needle.lastIndex = 0;
      const hit = needle.test(line);
      needle.lastIndex = 0;
      if (hit) {
        if (!COMMENT.test(line)) return line.trim().slice(0, 120);
        if (!comment) comment = line;
      }
    }
    if (!first) first = line;
    if (!firstCode && !COMMENT.test(line)) {
      firstCode = line;
      if (!needle) break;
    }
  }
  return (comment || firstCode || first).trim().slice(0, 120);
}

// Index just past the closer that matches the opener at `from`, or -1.
function closeAt(s, from, open, close, cap) {
  const end = Math.min(s.length, from + cap);
  const width = open.length;
  let depth = 1;
  for (let j = from + width; j < end; j++) {
    const c = s.charCodeAt(j);
    if (c === open.charCodeAt(0) && (width === 1 || s.charCodeAt(j + 1) === open.charCodeAt(1))) { depth++; j += width - 1; }
    else if (c === close.charCodeAt(0) && (width === 1 || s.charCodeAt(j + 1) === close.charCodeAt(1))) {
      depth--;
      if (depth === 0) return j + width;
      j += width - 1;
    }
  }
  return -1;
}

// `{{ … }}` counted by braces, so `{{[[query]]: {and: …}}}` closes at the end.
function macroEnd(s, from) {
  const end = Math.min(s.length, from + MACRO_CAP);
  let depth = 0;
  for (let j = from; j < end; j++) {
    const c = s.charCodeAt(j);
    if (c === 123) depth++;
    else if (c === 125 && --depth === 0) return j + 1;
  }
  return -1;
}

function macroLabel(inner) {
  const colon = inner.indexOf(":");
  if (SMARTBLOCK.test(inner)) return inner.slice(0, colon).trim() || "SmartBlock";
  const written = (colon === -1 ? inner : inner.slice(0, colon)).replace(BRACKETS, "").trim();
  const known = MACROS.get(written.toLowerCase());
  if (known) return known;
  if (!written) return "macro";
  return written.length > 24 ? `${written.slice(0, 24)}…` : written;
}

// [{ text, cls } | { task }]; `resolve(uid)` gives a block's string or null;
// `needle` (a RegExp) picks the code line the query matched.
export function richParts(string, { resolve = () => null, needle = null } = {}) {
  return parse(String(string ?? ""), resolve, false, needle);
}

function parse(input, resolve, inner, needle = null) {
  let s = input.trim();
  const parts = [];
  if (s.startsWith(":hiccup")) return [{ text: "hiccup", cls: CHIP }];
  if (s.startsWith("> ")) s = s.slice(2);
  const on = [false, false, false, false];
  let style = "";

  const push = (text, base = "") => {
    if (!text) return;
    if (WS.test(text)) text = text.replace(WS_RUN, " ");
    const cls = base === CHIP ? base : (style ? (base ? `${base} ${style}` : style) : base);
    const last = parts[parts.length - 1];
    if (cls !== CHIP && (!last || last.task || (last.cls !== CHIP && last.text.endsWith(" "))) && text[0] === " ") text = text.slice(1);
    if (!text) return;
    if (last && !last.task && cls !== CHIP && last.cls === cls) last.text += text;
    else parts.push({ text, cls });
  };
  const pushTask = (task) => {
    const last = parts[parts.length - 1];
    if (last && !last.task && last.cls !== CHIP && last.text.endsWith(" ")) {
      last.text = last.text.slice(0, -1);
      if (!last.text) parts.pop();
    }
    parts.push({ task });
  };

  const attr = ATTR_AT.exec(s);
  let i = 0;
  if (attr) { push(`${attr[1].trim()}:`, ATTR); i = attr[0].length; }
  const n = s.length;
  let from = i;
  let marked = -1; // end of the last style marker: a tag may follow it
  const flush = (to) => { if (to > from) push(s.slice(from, to)); };
  const done = (to) => { i = to; from = to; };

  while (i < n) {
    const c = s.charCodeAt(i);
    let end = -1;
    switch (c) {
      case 123: { // {
        if (s.charCodeAt(i + 1) !== 123 || (end = macroEnd(s, i)) === -1) break;
        flush(i);
        const macro = s.slice(i, end);
        const asTask = taskParts(macro);
        if (asTask.length === 1 && asTask[0].task) pushTask(asTask[0].task);
        else {
          const body = macro.slice(2, -2);
          const label = macroLabel(body);
          push(label, CHIP);
          if (!inner && label === "embed") {
            const uid = BREF_IN.exec(body)?.[1];
            const text = uid ? resolve(uid) : null;
            if (typeof text === "string") for (const part of parse(text, resolve, true)) part.task ? pushTask(part.task) : push(part.text, part.cls);
          }
        }
        done(end);
        continue;
      }
      case 96: { // `
        if (s.startsWith("```", i)) {
          flush(i);
          const close = s.indexOf("```", i + 3);
          const nl = s.indexOf("\n", i + 3);
          let lang = "";
          let body;
          if (nl === -1 || (close !== -1 && close < nl)) body = close === -1 ? s.slice(i + 3) : s.slice(i + 3, close);
          else {
            lang = s.slice(i + 3, nl).trim().split(WS_RUN)[0];
            body = close === -1 ? s.slice(nl + 1) : s.slice(nl + 1, close);
          }
          push(langLabel(lang), CHIP);
          push(codeLine(body, needle), "burrow-code");
          done(close === -1 ? n : close + 3);
          continue;
        }
        end = s.indexOf("`", i + 1);
        if (end > i + 1 && !(s.indexOf("\n", i + 1) < end && s.indexOf("\n", i + 1) !== -1)) {
          flush(i);
          push(s.slice(i + 1, end), "burrow-code");
          done(end + 1);
          continue;
        }
        break;
      }
      case 36: { // $$math$$
        if (s.charCodeAt(i + 1) !== 36) break;
        end = s.indexOf("$$", i + 2);
        if (end <= i + 2) break;
        flush(i);
        push(s.slice(i + 2, end), "burrow-code");
        done(end + 2);
        continue;
      }
      case 91: { // [
        if (s.charCodeAt(i + 1) === 91) {
          end = closeAt(s, i, "[[", "]]", SPAN_CAP);
          if (end === -1) break;
          flush(i);
          push(s.slice(i + 2, end - 2).replace(BRACKETS, ""), "burrow-ref");
          done(end);
          continue;
        }
        const link = linkAt(s, i);
        if (!link) break;
        flush(i);
        const target = link.target.trim();
        const text = link.text || target;
        if (target.startsWith("[[") && target.endsWith("]]")) push(text, "burrow-ref");
        else if (target.startsWith("((") && target.endsWith("))")) push(text, "burrow-bref");
        else {
          if (target.includes("firebasestorage") || FILE.test(target)) push("file", CHIP);
          push(text, "burrow-link");
        }
        done(link.end);
        continue;
      }
      case 33: { // ![alt](url)
        if (s.charCodeAt(i + 1) !== 91) break;
        const image = linkAt(s, i + 1);
        if (!image) break;
        flush(i);
        push("image", CHIP);
        done(image.end);
        continue;
      }
      case 35: { // #
        const before = i === 0 ? 32 : s.charCodeAt(i - 1);
        if (!(before === 32 || before === 40 || before === 9 || before === 10 || before === 13 || marked === i)) break;
        if (s.charCodeAt(i + 1) === 91 && s.charCodeAt(i + 2) === 91) {
          end = closeAt(s, i + 1, "[[", "]]", SPAN_CAP);
          if (end === -1) break;
          flush(i);
          push(`#${s.slice(i + 3, end - 2).replace(BRACKETS, "")}`, "burrow-tag");
          done(end);
          continue;
        }
        let j = i + 1;
        while (j < n) {
          const d = s.charCodeAt(j);
          if (d === 32 || d === 9 || d === 10 || d === 13 || d === 91 || d === 93 || d === 35 || d === 44 || d === 40 || d === 41) break;
          if ((d === 42 || d === 95 || d === 94 || d === 126) && s.charCodeAt(j + 1) === d && on[d === 42 ? 0 : d === 95 ? 1 : d === 94 ? 2 : 3]) break;
          j++;
        }
        while (j > i + 1 && ".,!?;:'\"".includes(s[j - 1])) j--;
        if (j === i + 1) break;
        flush(i);
        push(s.slice(i, j), "burrow-tag");
        done(j);
        continue;
      }
      case 40: { // ((uid))
        if (s.charCodeAt(i + 1) !== 40 || s.charCodeAt(i + 11) !== 41 || s.charCodeAt(i + 12) !== 41) break;
        const uid = s.slice(i + 2, i + 11);
        if (!BREF_IN.test(`((${uid}))`)) break;
        flush(i);
        const text = inner ? null : resolve(uid);
        push(typeof text === "string" ? plainText(parse(text, resolve, true)) : `((${uid}))`, "burrow-bref");
        done(i + 13);
        continue;
      }
      case 42: case 95: case 94: case 126: { // ** __ ^^ ~~
        if (s.charCodeAt(i + 1) !== c) break;
        const k = c === 42 ? 0 : c === 95 ? 1 : c === 94 ? 2 : 3;
        if (!on[k] && s.indexOf(STYLES[k][0], i + 2) === -1) break;
        flush(i);
        on[k] = !on[k];
        style = STYLES.filter((_, x) => on[x]).map((x) => x[1]).join(" ");
        marked = i + 2;
        done(i + 2);
        continue;
      }
    }
    i++;
  }
  flush(n);
  const last = parts[parts.length - 1];
  if (last && !last.task && last.cls !== CHIP) {
    last.text = last.text.trimEnd();
    if (!last.text) parts.pop();
  }
  return parts;
}

// [text](target) starting at the `[`: { text, target, end } or null.
function linkAt(s, from) {
  const close = closeAt(s, from, "[", "]", SPAN_CAP);
  if (close === -1 || s.charCodeAt(close) !== 40) return null;
  const end = closeAt(s, close, "(", ")", SPAN_CAP);
  if (end === -1) return null;
  return { text: s.slice(from + 1, close - 1), target: s.slice(close + 1, end - 1), end };
}

const spaced = (part) => part.cls === CHIP || part.cls === ATTR;

// The visible text; a chip or an attribute name gets a space from its neighbours.
export function plainText(parts) {
  let out = "";
  let apart = false;
  for (const part of parts) {
    if (part.task) continue;
    const gap = out && !out.endsWith(" ") && part.text[0] !== " " && (apart || spaced(part));
    out += (gap ? " " : "") + part.text;
    apart = spaced(part);
  }
  return out.trim();
}

// Cut a long row so the query's words show together: `…` and the words before
// the earliest match with the most distinct words within 40 characters after it.
export function snippet(parts, re, { lead = 30, keep = 24 } = {}) {
  if (!re) return parts;
  let full = "";
  for (const part of parts) if (!part.task && part.cls !== CHIP) full += part.text;
  const scan = re.global ? re : new RegExp(re.source, `${re.flags}g`);
  scan.lastIndex = 0;
  const hits = [];
  for (let m = scan.exec(full); m && hits.length < 64; m = scan.exec(full)) {
    if (!m[0]) { scan.lastIndex++; continue; }
    hits.push({ index: m.index, word: m[0].toLowerCase() });
  }
  scan.lastIndex = 0;
  if (re.lastIndex) re.lastIndex = 0;
  if (!hits.length) return parts;
  let hit = hits[0];
  let best = 0;
  for (let i = 0; i < hits.length; i++) {
    const words = new Set();
    for (let j = i; j < hits.length && hits[j].index <= hits[i].index + 40; j++) words.add(hits[j].word);
    if (words.size > best) { best = words.size; hit = hits[i]; }
  }
  if (hit.index <= lead) return parts;
  let cut = hit.index - keep;
  if (cut <= 0) return parts;
  const space = full.indexOf(" ", cut);
  if (space !== -1 && space < hit.index) cut = space + 1;
  const out = [];
  let k = 0;
  while (k < parts.length && parts[k].task) out.push(parts[k++]);
  out.push({ text: "…", cls: "burrow-ellipsis" });
  let at = 0;
  for (const part of parts) {
    if (part.task || part.cls === CHIP) { if (at >= cut && !(part.task && out.includes(part))) out.push(part); continue; }
    const to = at + part.text.length;
    if (to > cut) out.push(at >= cut ? part : { text: part.text.slice(cut - at), cls: part.cls });
    at = to;
  }
  return out;
}

export function renderParts(doc, parts, highlight = (text) => text) {
  const fragment = doc.createDocumentFragment();
  for (const part of parts) {
    if (part.task) fragment.append(checkbox(doc, part.task));
    else if (!part.cls) fragment.append(highlight(part.text));
    else {
      const span = doc.createElement("span");
      span.className = part.cls;
      if (part.cls === CHIP) span.textContent = part.text;
      else span.append(highlight(part.text));
      fragment.append(span);
    }
  }
  return fragment;
}

// Keyed by uid and text: an edited block is a new key. The caller clears it
// when the ref index is rebuilt, since a block ref's resolved text can change.
export function createRichCache(limit = 400) {
  const map = new Map();
  return {
    get(uid, string, make) {
      const key = `${uid}\u0000${string}`;
      if (map.has(key)) return map.get(key);
      const value = make();
      map.set(key, value);
      if (map.size > limit) map.delete(map.keys().next().value);
      return value;
    },
    clear() { map.clear(); },
    get size() { return map.size; },
  };
}
