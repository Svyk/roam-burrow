import { IS_MAC } from "./hints.js";
import { stripRoamMarkup } from "./search.js";

// Insert variants (insertVariants) and open in sidebar (openInSidebar): what
// ⇧↵, ⌥↵ and ⌘⇧↵ (Ctrl+Shift+↵ off a Mac) do on a highlighted Burrow row,
// drill row or drill panel row. Roam's own rows never see them.
//   target: { type: "block", uid, text } | { type: "page", uid, title, alias? }
const LABEL_MAX = 40;

export function variantOf(event, setting, mac = IS_MAC) {
  if (event.key !== "Enter") return null;
  const primary = mac ? event.metaKey : event.ctrlKey;
  if (mac ? event.ctrlKey : event.metaKey) return null;
  const { shiftKey: shift, altKey: alt } = event;
  if (shift && !alt && !primary) return setting("insertVariants") ? "embed" : null;
  if (alt && !shift && !primary) return setting("insertVariants") ? "label" : null;
  if (primary && shift && !alt) return setting("openInSidebar") ? "sidebar" : null;
  return null;
}

// A label inside [label](…): one line, no brackets (a ] would end it).
const clean = (text) => String(text ?? "").replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();

// The block's first 40 plain characters, as a reader sees them: a markdown
// image or link keeps only its text.
export function blockLabel(text) {
  const plain = stripRoamMarkup(String(text ?? "").replace(/!?\[([^\]]*)\]\((?!\(|\[\[)[^)]*\)/g, "$1"));
  return [...clean(plain)].slice(0, LABEL_MAX).join("").trim();
}

// What the drill row's label takes from `Page#heading > child`: the last step.
export const lastStep = (query) => String(query ?? "").split(/[#>]/).pop().trim();

export function variantInsertion(variant, target, query) {
  if (variant === "embed") return target.type === "page" ? `{{[[embed]]: [[${target.title}]]}}` : `{{[[embed]]: ((${target.uid}))}}`;
  if (target.type === "page") return `[${clean(target.alias) || clean(query) || clean(target.title)}]([[${target.title}]])`;
  return `[${clean(query) || blockLabel(target.text) || target.uid}](((${target.uid})))`;
}

// Roam's right sidebar: a page opens as its outline, a block on its own.
export const sidebarWindow = (target) => ({ type: target.type === "page" ? "outline" : "block", "block-uid": target.uid });
