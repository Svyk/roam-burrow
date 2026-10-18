// Host theme, in order: explicit dark markers Roam and its themes stamp, then
// the measured body background. Never the OS prefers-color-scheme alone.
const DARK_MARKERS = [
  ["html", "bp3-dark"], ["body", "bp3-dark"], ["body", "bt-theme-dark"], ["body", "rm-dark-theme"],
];

export function parseRgb(value) {
  const m = String(value || "").match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
}

export function luminance({ r, g, b }) {
  const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function isDarkHost(doc = globalThis.document) {
  if (!doc) return false;
  for (const [tag, cls] of DARK_MARKERS) {
    const el = tag === "html" ? doc.documentElement : doc.body;
    if (el?.classList.contains(cls)) return true;
  }
  if (doc.body?.classList.contains("roam-body") && doc.body.classList.contains("dark")) return true;
  const bg = parseRgb(globalThis.getComputedStyle?.(doc.body).backgroundColor);
  return Boolean(bg && bg.a > 0 && luminance(bg) < 0.2);
}
