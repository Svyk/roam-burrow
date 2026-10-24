// Minimal CDP client for live checks against Roam Desktop (default port 9223).
// Keys go through Input.dispatchKeyEvent / Input.insertText, so they are
// trusted events and Roam's own editor and autocomplete react to them.
const PORT = process.env.CDP_PORT || 9223;

const KEYS = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  F1: { code: "F1", keyCode: 112 },
};

export async function connect(titlePart) {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === "page" && (t.title || "").startsWith(titlePart));
  if (!page) throw new Error(`no Roam window titled ${JSON.stringify(titlePart)}…`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 1;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (fn, arg) => {
    const expression = `(${fn.toString()})(${JSON.stringify(arg ?? null)})`;
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(String(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails)).slice(0, 1500));
    }
    return result.result.value;
  };
  // Every character this connection typed, so fixture.deleteNewPages deletes
  // only a page whose title the run itself typed.
  let typed = "";
  const key = async (name, modifiers = 0) => {
    if (name.length === 1 && !modifiers) typed += name;
    const digit = /^\d$/.test(name);
    const spec = KEYS[name] || (digit
      ? { code: `Digit${name}`, keyCode: 48 + Number(name), text: name }
      : { code: `Key${name.toUpperCase()}`, keyCode: name.toUpperCase().charCodeAt(0), text: name });
    const base = { key: name, code: spec.code, windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode, modifiers };
    // With Ctrl (2) or ⌘ (4) held a key types nothing.
    const text = modifiers & 6 ? undefined : spec.text;
    await call("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, text, unmodifiedText: text });
    await call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };
  const type = async (text, delay = 25) => {
    typed += text;
    for (const ch of text) {
      const code = ch === " " ? "Space" : /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : /\d/.test(ch) ? `Digit${ch}` : "";
      await call("Input.dispatchKeyEvent", { type: "keyDown", key: ch, code, text: ch, unmodifiedText: ch });
      await call("Input.dispatchKeyEvent", { type: "keyUp", key: ch, code });
      if (delay) await sleep(delay);
    }
  };
  // Mouse coordinates equal getBoundingClientRect() values (no zoom scaling).
  const click = async (x, y) => {
    await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  };
  const wheel = (x, y, deltaX, deltaY) => call("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX, deltaY });
  // The media override lives only as long as this connection; svy's theme
  // (svy-theme on Auto) follows it. A window whose svy-theme Appearance is
  // fixed (notes: Dark) ignores it, so it gets what svy-theme's own switch
  // (applyAppearance) sets for the other mode: bp3-dark / bp3-light and
  // data-bp-appearance on <html>, and the topbar toggle's icon, label and
  // title, which Better Tasks reads for its own bt-theme class. In memory
  // only: the setting is not written. setTheme(null) puts it all back, and so
  // does the page by itself 20 s after this connection's last beat (a run
  // that crashed or was killed).
  let beat = null;
  const stopBeat = () => { if (beat) clearInterval(beat); beat = null; };
  const setTheme = async (mode) => {
    await call("Emulation.setEmulatedMedia", { features: mode ? [{ name: "prefers-color-scheme", value: mode }] : [] });
    if (!mode) {
      stopBeat();
      const restored = await evaluate(() => { const flip = window.__burrowThemeFlip; if (flip) flip.restore(); return { restored: Boolean(flip) }; });
      // Better Tasks syncs its own class 250 ms after a theme mutation.
      if (restored.restored) await sleep(400);
      return restored;
    }
    for (let t0 = Date.now(); Date.now() - t0 < 4000;) {
      if (await evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches) === (mode === "dark")) break;
      await sleep(50);
    }
    const flipped = await evaluate((mode) => {
      const root = document.documentElement;
      const old = window.__burrowThemeFlip;
      if (old && old.mode !== mode) old.restore();
      if (window.__burrowThemeFlip) { window.__burrowThemeFlip.beat = Date.now(); return window.__burrowThemeFlip.from; }
      const fixed = root.dataset.bpAppearance;
      if ((fixed !== "dark" && fixed !== "light") || fixed === mode) return null;
      const icon = document.querySelector(".blueprint-toggle-icon");
      const label = document.querySelector(".blueprint-dm-toggle-label");
      const wrap = document.querySelector(".blueprint-dm-toggle-wrap");
      const ICONS = ["bp3-icon-clean", "bp3-icon-moon", "bp3-icon-flash"];
      const flip = {
        mode, from: fixed, dark: root.classList.contains("bp3-dark"), light: root.classList.contains("bp3-light"), beat: Date.now(),
        icons: ICONS.filter((c) => icon?.classList.contains(c)), label: label?.textContent, title: wrap?.getAttribute("title"), aria: wrap?.getAttribute("aria-label"),
      };
      const toggle = (icons, text, title, aria) => {
        if (icon) { icon.classList.remove(...ICONS); icon.classList.add(...icons); }
        if (label && text != null) label.textContent = text;
        if (wrap && title != null) wrap.setAttribute("title", title);
        if (wrap && aria != null) wrap.setAttribute("aria-label", aria);
      };
      flip.restore = () => {
        clearInterval(flip.timer);
        root.classList.toggle("bp3-dark", flip.dark);
        root.classList.toggle("bp3-light", flip.light);
        root.dataset.bpAppearance = flip.from;
        toggle(flip.icons, flip.label, flip.title, flip.aria);
        window.__burrowThemeFlip = null;
      };
      flip.timer = setInterval(() => { if (Date.now() - flip.beat > 20000) flip.restore(); }, 2000);
      root.classList.toggle("bp3-dark", mode === "dark");
      root.classList.toggle("bp3-light", mode === "light");
      root.dataset.bpAppearance = mode;
      const name = mode === "dark" ? "Dark" : "Light";
      toggle([mode === "dark" ? "bp3-icon-moon" : "bp3-icon-flash"], name, `Appearance: ${name}`, `Appearance: ${name}`);
      window.__burrowThemeFlip = flip;
      return fixed;
    }, mode);
    if (flipped && !beat) {
      beat = setInterval(() => {
        call("Runtime.evaluate", { expression: "window.__burrowThemeFlip && (window.__burrowThemeFlip.beat = Date.now())" }).catch(() => {});
      }, 3000);
      beat.unref?.();
    }
    await sleep(600);
    const body = await evaluate(() => getComputedStyle(document.body).backgroundColor);
    return { mode, flippedFrom: flipped, body };
  };
  // Page.captureScreenshot clips are in unzoomed pixels; Roam Desktop runs zoomed.
  const screenshot = async (rect) => {
    const params = { format: "png" };
    if (rect) {
      const k = await evaluate(() => window.devicePixelRatio / Math.round(window.devicePixelRatio));
      params.clip = { x: rect.left * k, y: rect.top * k, width: rect.width * k, height: rect.height * k, scale: 1 };
    }
    const result = await call("Page.captureScreenshot", params);
    return Buffer.from(result.data, "base64");
  };
  const close = () => { stopBeat(); socket.close(); };
  return { page, call, evaluate, key, type, typed: () => typed, click, wheel, setTheme, screenshot, close };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
