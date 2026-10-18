import { searchKey } from "./search.js";

// Pick memory (Thymer's idea, off by default): a Burrow row you picked for a
// query ranks first among equal matches the next time you type that query or
// a prefix of it. Kept per graph in this browser's localStorage only; it is
// a convenience, and losing it changes nothing but ranking.
const LIMIT = 200;
const MIN_QUERY = 2;

export function createPickMemory({ storage, key }) {
  let picks = null;
  const load = () => {
    if (picks) return picks;
    try { picks = JSON.parse(storage?.getItem(key) || "[]"); } catch { picks = []; }
    if (!Array.isArray(picks)) picks = [];
    return picks;
  };
  const save = () => {
    try { storage?.setItem(key, JSON.stringify(picks)); } catch { /* private window or full storage */ }
  };
  return {
    record(kind, query, uid) {
      const q = searchKey(query).compact;
      if (q.length < MIN_QUERY || !uid) return;
      const list = load().filter((p) => !(p.kind === kind && p.q === q && p.uid === uid));
      list.push({ kind, q, uid, t: Date.now() });
      picks = list.slice(-LIMIT);
      save();
    },
    // uid -> recency rank (higher is more recent) for picks made with this
    // query or a longer one that starts with it.
    lookup(kind, query) {
      const q = searchKey(query).compact;
      const found = new Map();
      if (q.length < MIN_QUERY) return found;
      const list = load();
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.kind === kind && p.q.startsWith(q)) found.set(p.uid, i + 1);
      }
      return found;
    },
    clear() { picks = []; save(); },
  };
}
