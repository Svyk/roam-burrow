import { searchKey } from "./search.js";

// Recent rows (BRW-14, spec §18). The pure parts: the latest edits out of the
// idle query, the candidate list, the per-key filter. Nothing here reads the
// graph; the strip hands in what the indexes and the pick store know.

export const RECENT_DAYS = 14;
export const EDITED_BLOCKS = 20;
export const EDITED_PAGES = 20;

// rows: [blockUid, editTime, pageUid, pageTitle]. The newest `blocks` blocks
// and the pages whose newest block is newest, in one pass with no sort of
// the whole result.
export function latestEdits(rows, { blocks = EDITED_BLOCKS, pages = EDITED_PAGES } = {}) {
  const topBlocks = [];
  const byPage = new Map();
  for (const [uid, t, pageUid, title] of rows || []) {
    if (typeof t !== "number") continue;
    const seen = byPage.get(pageUid);
    if (!seen) byPage.set(pageUid, { uid: pageUid, title, t });
    else if (t > seen.t) seen.t = t;
    if (topBlocks.length >= blocks && t <= topBlocks[topBlocks.length - 1].t) continue;
    let at = topBlocks.length;
    while (at > 0 && topBlocks[at - 1].t < t) at -= 1;
    topBlocks.splice(at, 0, { uid, t, page: title ?? null });
    if (topBlocks.length > blocks) topBlocks.pop();
  }
  const newest = [...byPage.values()].sort((a, b) => b.t - a.t).slice(0, pages);
  return { blocks: topBlocks, pages: newest };
}

// picks and edited: [{ uid, text, page? }], most recent first. Picks come
// first, an edited one already picked is dropped, the block or page being
// edited is left out, and so is anything with no text.
export function mergeCandidates({ picks = [], edited = [], skipUid = null, skipText = null }) {
  const seen = new Set();
  const out = [];
  const add = (list, recent) => {
    for (const c of list) {
      if (!c || !c.uid || seen.has(c.uid) || c.uid === skipUid) continue;
      if (typeof c.text !== "string" || !c.text.trim()) continue;
      if (skipText != null && c.text === skipText) continue;
      seen.add(c.uid);
      out.push({ ...c, recent });
    }
  };
  add(picks, "pick");
  add(edited, "edit");
  return out;
}

// A candidate's words, worked out once per uid and text (not per key).
const wordCache = new Map();
function words(c) {
  const key = `${c.uid}\u0000${c.text}`;
  let w = wordCache.get(key);
  if (!w) {
    if (wordCache.size > 400) wordCache.clear();
    w = searchKey(c.text).tokens;
    wordCache.set(key, w);
  }
  return w;
}

// 0 characters typed: the first rows. 1-2: those with a word that starts
// with what was typed (case and separators ignored).
export function filterCandidates(candidates, query, limit) {
  const typed = searchKey(query).compact;
  if (!typed) return candidates.slice(0, limit);
  const out = [];
  for (const c of candidates) {
    if (words(c).some((w) => w.startsWith(typed))) {
      out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}

const BLOCK_PULL = "[:block/string :block/uid]";
const SHOWN_PULL = "[:block/string {:block/page [:node/title]}]";

// The strings of the newest edited blocks, pulled once per index build (not
// per key); empty ones dropped. Kept in memory only.
export function pullBlocks(api, blocks) {
  const eids = blocks.map((b) => [":block/uid", b.uid]);
  let pulled;
  if (api.data?.pull_many) pulled = api.data.pull_many(BLOCK_PULL, eids);
  else pulled = eids.map((eid) => api.pull(BLOCK_PULL, eid));
  const out = [];
  blocks.forEach((b, i) => {
    const string = pulled?.[i]?.[":block/string"];
    if (typeof string === "string" && string.trim()) out.push({ ...b, string });
  });
  return out.slice(0, EDITED_BLOCKS);
}

// Display data for picked blocks the indexes do not hold, read one at a time
// at idle, right after the pick and after each index build. A block whose
// pull returns nothing is gone and is skipped.
export function createPickInfo({ api, idle, frecency, known }) {
  const info = new Map();
  let queued = false;
  const run = () => {
    queued = false;
    for (const uid of frecency.recent("block", 10)) {
      if (info.has(uid) || known(uid)) continue;
      const got = api.pull(SHOWN_PULL, [":block/uid", uid]);
      const string = got?.[":block/string"];
      info.set(uid, typeof string === "string" && string.trim() ? { string, page: got[":block/page"]?.[":node/title"] ?? null } : null);
    }
  };
  return {
    get: (uid) => info.get(uid) ?? null,
    refresh() {
      if (queued) return;
      queued = true;
      idle(run);
    },
    clear() { info.clear(); },
  };
}
