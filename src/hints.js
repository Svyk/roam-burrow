export const IS_MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");

const NAMED = {
  altA: ["⌥A", "Alt+A"],
  altDown: ["⌥↓", "Alt+↓"],
  altBackspace: ["⌥⌫", "Alt+⌫"],
  ctrlO: ["⌃O", "Ctrl+O"],
};

export function keyLabel(name, mac = IS_MAC) {
  const pair = NAMED[name];
  return pair ? pair[mac ? 0 : 1] : name;
}

export function hintsKey(items) {
  return items.map(([keys, label]) => `${keys}\u0000${label}`).join("\u0001");
}

export function renderHints(doc, node, items) {
  const span = (className, textContent) => Object.assign(doc.createElement("span"), { className, textContent });
  const parts = [];
  items.forEach(([keys, label], i) => {
    if (i) parts.push(span("burrow-hint-sep", " · "));
    const item = span("burrow-hint", "");
    item.append(span("burrow-hint-key", keys), ` ${label}`);
    parts.push(item);
  });
  node.replaceChildren(...parts);
}
