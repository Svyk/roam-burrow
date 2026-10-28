// A native table block ({{[[table]]}}) as the preview draws it: pure model
// code. Storage (Roam's table and Roam Grid alike): each child of the table
// block is a row; a row's cells are the row block then its first-child chain
// (at each level the child with the smallest order). A stored " " is an empty
// cell. Only the first rows and columns are read and shown.
export const TABLE_ROWS = 6;
export const TABLE_COLS = 5;
export const CELL_CHARS = 40;

// One pull per shown row: five levels with text, then ids only (recursion-
// limited) to count the columns past the fifth.
export const CHAIN = "[:block/uid :block/string :block/order {:block/children [:block/uid :block/string :block/order {:block/children [:block/uid :block/string :block/order {:block/children [:block/uid :block/string :block/order {:block/children [:block/uid :block/string :block/order {:block/children [:db/id :block/order {:block/children 30}]}]}]}]}]}]";

const TABLE = /\{\{\s*(?:\[\[\s*table\s*\]\]|table)\s*\}\}/i;

export function isTableBlock(string) {
  return TABLE.test(String(string ?? ""));
}

const firstKid = (raw) => {
  let best = null;
  for (const kid of raw[":block/children"] || []) {
    if (!best || (kid[":block/order"] ?? 0) < (best[":block/order"] ?? 0)) best = kid;
  }
  return best;
};

// A row's pull -> { cells: [{ uid, string }] (at most 5), length: the whole chain }.
export function tableChain(raw) {
  const cells = [];
  let length = 0;
  for (let at = raw; at; at = firstKid(at)) {
    length += 1;
    if (cells.length < TABLE_COLS) {
      const string = at[":block/string"] ?? "";
      cells.push({ uid: at[":block/uid"], string: string === " " ? "" : string });
    }
  }
  return { cells, length };
}

export function tableModel(uid, totalRows, chains) {
  let cols = 0;
  let longest = 0;
  for (const chain of chains) {
    cols = Math.max(cols, chain.cells.length);
    longest = Math.max(longest, chain.length);
  }
  return { uid, rows: chains.map((chain) => chain.cells), cols, moreRows: Math.max(0, totalRows - TABLE_ROWS), moreCols: Math.max(0, longest - TABLE_COLS) };
}

// Rich parts ({text, cls} / {task}) cut to `max` characters of text, with a
// `…` part when something was cut.
export function clipParts(parts, max = CELL_CHARS) {
  const out = [];
  let left = max;
  for (const part of parts) {
    if (part.task || !part.text) { out.push(part); continue; }
    if (part.text.length <= left) { out.push(part); left -= part.text.length; continue; }
    if (left > 0) out.push({ ...part, text: part.text.slice(0, left) });
    out.push({ text: "…", cls: "burrow-ellipsis" });
    return out;
  }
  return out;
}
