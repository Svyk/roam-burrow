// One switch per feature (Svy decision 2026-10-17). Handlers read settings at
// the start of each event, so a change applies on the next keystroke.
export const DEFAULTS = Object.freeze({
  aliasPages: true,
  aliasExpand: true,
  refRanking: true,
  refPreselect: true,
  betterMatch: true,
  aliasKeyword: "Aliases",
  aliasLinkFormat: "[alias]([[Page]])",
  perfHud: false,
});

const SWITCHES = [
  ["aliasPages", "Alias rows in [[", "Typing a page alias in [[ shows the page. Hidden for aliases that roam-aliases already lists."],
  ["aliasExpand", "Alias expansion in ((", "In ((, an alias also finds referenced blocks that link to its page."],
  ["refRanking", "Referenced blocks first in ((", "Shows up to three already-referenced blocks above Roam's results, originals before blocks that quote them."],
  ["refPreselect", "Pre-select the referenced original", "The first referenced block starts selected, so Enter inserts it. ↓ past it returns to Roam's rows."],
  ["betterMatch", "Forgiving matching", "Abbreviations, initialisms and small typos for Burrow's rows. Off: separator-insensitive word matches only."],
  ["perfHud", "Performance readout", "Shows Burrow's per-key cost (p50/p95) in the corner. Also at window.__BURROW_PERF."],
];

export function createSettingsReader(extensionAPI) {
  return (id) => {
    const value = extensionAPI.settings.get(id);
    return value == null ? DEFAULTS[id] : value;
  };
}

export function createSettingsPanel({ onChange } = {}) {
  const changed = (id) => (event) => onChange?.(id, event);
  return {
    tabTitle: "Burrow",
    settings: [
      ...SWITCHES.map(([id, name, description]) => ({
        id, name, description, action: { type: "switch", onChange: changed(id) },
      })),
      {
        id: "aliasKeyword",
        name: "Alias attribute",
        description: "The attribute that holds a page's aliases. Use the same value as roam-aliases' Keyword. Matched without case.",
        action: { type: "input", placeholder: DEFAULTS.aliasKeyword, onChange: changed("aliasKeyword") },
      },
      {
        id: "aliasLinkFormat",
        name: "Alias link format",
        description: "What an alias row inserts in [[.",
        action: { type: "select", items: ["[alias]([[Page]])", "[[Page]]"], onChange: changed("aliasLinkFormat") },
      },
    ],
  };
}

// A Roam switch renders unchecked for an unset key, so store the defaults once.
export async function initializeSettings(extensionAPI) {
  if (extensionAPI.settings.canSet === false) return;
  for (const [id, value] of Object.entries(DEFAULTS)) {
    if (extensionAPI.settings.get(id) == null) await extensionAPI.settings.set(id, value);
  }
}
