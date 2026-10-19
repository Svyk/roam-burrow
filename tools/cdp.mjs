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
  const key = async (name, modifiers = 0) => {
    const digit = /^\d$/.test(name);
    const spec = KEYS[name] || (digit
      ? { code: `Digit${name}`, keyCode: 48 + Number(name), text: name }
      : { code: `Key${name.toUpperCase()}`, keyCode: name.toUpperCase().charCodeAt(0), text: name });
    const base = { key: name, code: spec.code, windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode, modifiers };
    await call("Input.dispatchKeyEvent", { type: spec.text ? "keyDown" : "rawKeyDown", ...base, text: spec.text, unmodifiedText: spec.text });
    await call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };
  const type = async (text, delay = 25) => {
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
  // The override lives only as long as this connection; svy's theme follows it.
  const setTheme = async (mode) => {
    await call("Emulation.setEmulatedMedia", { features: mode ? [{ name: "prefers-color-scheme", value: mode }] : [] });
    if (!mode) return;
    for (let t0 = Date.now(); Date.now() - t0 < 4000;) {
      if (await evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches) === (mode === "dark")) break;
      await sleep(50);
    }
    await sleep(600);
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
  const close = () => socket.close();
  return { page, call, evaluate, key, type, click, wheel, setTheme, screenshot, close };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
