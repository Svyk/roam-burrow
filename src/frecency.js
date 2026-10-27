// Frequent first and recent rows (BRW-14, spec §18): every pick feeds a
// per-graph score, a count that halves every two weeks, kept in this
// browser's localStorage only. The store holds uids, a score and a time,
// never block text. It breaks ties after match quality and references, for
// any query, and supplies the "recent pick" rows. Losing it changes nothing
// but ranking.
const HALF_LIFE = 14 * 24 * 3600 * 1000;
const LIMIT = 500;
const KINDS = new Set(["block", "page"]);

export function createFrecency({ storage, key, legacyKey = null, now = Date.now }) {
  let entries = null;
  let byId = null;
  // The caches drop on every change; the scores are `s` decayed to the time
  // the cache was built, so a keystroke reads a ready Map.
  let scoreCache = new Map();
  let recentCache = new Map();
  let version = 0;

  const changed = () => { scoreCache = new Map(); recentCache = new Map(); version += 1; };
  const id = (k, uid) => `${k}:${uid}`;
  const save = () => {
    try { storage?.setItem(key, JSON.stringify(entries)); } catch { /* private window or full storage */ }
  };
  const bump = (k, uid, t) => {
    const found = byId.get(id(k, uid));
    if (found) {
      found.s = found.s * 0.5 ** (Math.max(0, t - found.t) / HALF_LIFE) + 1;
      found.t = Math.max(found.t, t);
    } else {
      const entry = { k, id: uid, s: 1, t };
      entries.push(entry);
      byId.set(id(k, uid), entry);
    }
    if (entries.length > LIMIT) {
      entries.sort((a, b) => b.t - a.t);
      for (const gone of entries.splice(LIMIT)) byId.delete(id(gone.k, gone.id));
    }
  };

  // The pick memory of 0.8.0 and before ({ kind: "ref" | "alias", q, uid, t }):
  // each pick folds in at its own time; the query text and alias are dropped.
  const migrate = () => {
    if (!legacyKey) return;
    let raw = null;
    try { raw = storage?.getItem(legacyKey); } catch { /* unreadable */ }
    if (raw == null) return;
    try {
      const old = JSON.parse(raw);
      if (Array.isArray(old)) {
        const picks = old.filter((p) => p && typeof p.uid === "string" && p.uid && Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
        for (const p of picks) {
          if (p.kind === "ref") bump("block", p.uid, p.t);
          else if (p.kind === "alias") bump("page", p.uid.split(":")[0], p.t);
        }
        if (picks.length) { changed(); save(); }
      }
    } catch { /* a broken value is just removed */ }
    try { storage?.removeItem(legacyKey); } catch { /* nothing to do */ }
  };

  const load = () => {
    if (entries) return entries;
    entries = [];
    byId = new Map();
    let stored = [];
    try { stored = JSON.parse(storage?.getItem(key) || "[]"); } catch { stored = []; }
    if (Array.isArray(stored)) {
      // Rebuilt field by field: nothing but k, id, s and t is ever kept.
      for (const e of stored) {
        if (!e || !KINDS.has(e.k) || typeof e.id !== "string" || !e.id || !Number.isFinite(e.s) || !Number.isFinite(e.t) || byId.has(id(e.k, e.id))) continue;
        const entry = { k: e.k, id: e.id, s: e.s, t: e.t };
        entries.push(entry);
        byId.set(id(e.k, e.id), entry);
      }
    }
    migrate();
    return entries;
  };

  return {
    // Reads the store (and folds in a pick memory of an older version) now.
    load() { load(); },
    record(kind, uid) {
      if (!KINDS.has(kind) || !uid || typeof uid !== "string") return;
      load();
      bump(kind, uid, now());
      changed();
      save();
    },
    // uid -> current score, the same Map until the next change.
    scores(kind) {
      load();
      let map = scoreCache.get(kind);
      if (!map) {
        const t0 = now();
        map = new Map();
        for (const e of entries) if (e.k === kind) map.set(e.id, e.s * 0.5 ** (Math.max(0, t0 - e.t) / HALF_LIFE));
        scoreCache.set(kind, map);
      }
      return map;
    },
    score(kind, uid) { return this.scores(kind).get(uid) ?? 0; },
    // The latest picks, most recent first; the same array until the next change.
    recent(kind, n) {
      load();
      const k = `${kind}:${n}`;
      let list = recentCache.get(k);
      if (!list) {
        list = entries.filter((e) => e.k === kind).sort((a, b) => b.t - a.t).slice(0, n).map((e) => e.id);
        recentCache.set(k, list);
      }
      return list;
    },
    clear() {
      load();
      entries = [];
      byId = new Map();
      changed();
      try { storage?.removeItem(key); } catch { /* nothing to do */ }
    },
    get version() { return version; },
    get size() { return load().length; },
  };
}
