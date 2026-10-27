// Image thumbnails for the previews: the highlighted block's first image in a
// box reserved when the line is drawn (no layout shift), loaded only after the
// row has stayed highlighted for a moment, one request at a time. An encrypted
// graph's files are decrypted with Roam's file API into object URLs kept for
// the popup only, in a small LRU. Never throws: a failure keeps the "image"
// label with the alt text.
const FENCE = /```[\s\S]*?(?:```|$)/g;
const INLINE_CODE = /`[^`\n]*`/g;
const SCHEME = /^(?:https?:\/\/|data:image\/)/i;

// { url, alt, more } for the first ![alt](url) outside code, or null. `more`
// counts the further images. Only http(s) and data:image URLs count.
export function firstImage(string) {
  if (!string || string.indexOf("![") === -1) return null;
  const s = string.replace(FENCE, " ").replace(INLINE_CODE, " ");
  let first = null;
  let more = 0;
  let at = 0;
  for (;;) {
    const i = s.indexOf("![", at);
    if (i === -1) break;
    at = i + 2;
    const mid = s.indexOf("](", at);
    if (mid === -1) break;
    if (s.indexOf("]", at) !== mid) continue;
    let depth = 1;
    let j = mid + 2;
    for (; j < s.length && depth; j++) {
      const c = s.charCodeAt(j);
      if (c === 40) depth++;
      else if (c === 41) depth--;
    }
    if (depth) break;
    at = j;
    const url = s.slice(mid + 2, j - 1).trim().split(/\s/)[0];
    if (!SCHEME.test(url)) continue;
    if (first) more++;
    else first = { url, alt: s.slice(i + 2, mid).trim() };
  }
  return first && { ...first, more };
}

export function isEncryptedUrl(url) {
  let path = String(url).split(/[?#]/)[0];
  try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
  return path.toLowerCase().endsWith(".enc");
}

export function createThumbs({ doc, win, api, perf, lifecycle, encrypted = () => api?.graph?.isEncrypted === true, dwellMs = 150, maxBytes = 5 * 1024 * 1024, cacheSize = 8 }) {
  const lru = new Map();
  let timer = null;
  let current = null;
  let generation = 0;

  const syncCount = () => { perf.counters.thumbUrls = lru.size; };
  const count = () => { perf.counters.thumbLoads = (perf.counters.thumbLoads || 0) + 1; };
  syncCount();

  function revoke(objectUrl) {
    try { win.URL.revokeObjectURL(objectUrl); } catch { /* already gone */ }
  }

  function remember(url, objectUrl) {
    const old = lru.get(url);
    if (old) { lru.delete(url); revoke(old); }
    lru.set(url, objectUrl);
    while (lru.size > cacheSize) {
      const oldest = lru.keys().next().value;
      revoke(lru.get(oldest));
      lru.delete(oldest);
    }
    syncCount();
  }

  // The box's picture goes first; the +N stays.
  function setImg(box, img) {
    box.querySelector(".burrow-thumb-img")?.remove();
    box.prepend(img);
  }

  function fail(box, image) {
    try {
      box.dataset.state = "failed";
      box.querySelector(".burrow-thumb-img")?.remove();
      box.querySelector(".burrow-label")?.remove();
      const label = doc.createElement("span");
      label.className = "burrow-label";
      label.append("image");
      if (image.alt) label.append(` ${image.alt}`);
      box.prepend(label);
    } catch { /* box already torn down */ }
  }

  function showImg(req, src, lazy) {
    const { box, image } = req;
    const img = doc.createElement("img");
    img.className = "burrow-thumb-img";
    if (lazy) img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
    img.alt = image.alt || "";
    img.draggable = false;
    img.addEventListener("load", () => { box.dataset.state = "ok"; });
    img.addEventListener("error", () => fail(box, image));
    box.dataset.state = "loading";
    setImg(box, img);
    img.src = src;
  }

  function plain(req) {
    count();
    showImg(req, req.image.url, true);
  }

  async function decrypted(req) {
    const { box, image } = req;
    const gen = generation;
    box.dataset.state = "loading";
    count();
    let file;
    try {
      file = await api.file.get({ url: image.url });
    } catch {
      if (!isEncryptedUrl(image.url) && current === req && box.isConnected) plain(req);
      else fail(box, image);
      return;
    }
    try {
      if (!file || !(file.size <= maxBytes)) { fail(box, image); return; }
      if (gen !== generation) return;
      const objectUrl = win.URL.createObjectURL(file);
      remember(image.url, objectUrl);
      if (current === req && box.isConnected) showImg(req, objectUrl, false);
    } catch { fail(box, image); }
  }

  function load(req) {
    try {
      if (encrypted() || isEncryptedUrl(req.image.url)) {
        if (!api?.file?.get) { fail(req.box, req.image); return; }
        decrypted(req).catch(() => fail(req.box, req.image));
      } else plain(req);
    } catch { fail(req.box, req.image); }
  }

  function stopTimer() {
    if (timer != null) { win.clearTimeout(timer); timer = null; }
  }

  function cancel(owner) {
    if (owner != null && current?.owner !== owner) return;
    stopTimer();
    current = null;
  }

  function clear() {
    cancel();
    generation++;
    for (const objectUrl of lru.values()) revoke(objectUrl);
    lru.clear();
    syncCount();
  }
  lifecycle.add(() => clear());

  return {
    box(image) {
      const box = doc.createElement("div");
      box.className = "burrow-thumb";
      box.dataset.state = "wait";
      if (image.more > 0) {
        const more = doc.createElement("span");
        more.className = "burrow-thumb-more";
        more.textContent = `+${image.more}`;
        box.append(more);
      }
      return box;
    },
    want(box, image, owner) {
      stopTimer();
      const req = { box, image, owner };
      current = req;
      try {
        const cached = lru.get(image.url);
        if (cached) {
          lru.delete(image.url);
          lru.set(image.url, cached);
          showImg(req, cached, false);
          return;
        }
        timer = win.setTimeout(() => {
          timer = null;
          try { if (current === req && box.isConnected) load(req); } catch { fail(box, image); }
        }, dwellMs);
      } catch { fail(box, image); }
    },
    cancel,
    clear,
    get live() { return lru.size; },
  };
}
