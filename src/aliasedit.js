import { keywordTitles, parseAliasBlock } from "./aliases.js";

// The only place Burrow writes to the graph, and only to one alias block.
const kwOf = (keyword) => String(keyword || "Aliases").trim();
const clean = (value) => value.trim().replace(/^#?\[\[(.*)\]\]$/, "$1").replace(/^#/, "").trim();

export function validAlias(text) {
  const alias = String(text ?? "").trim();
  if (!alias) return { ok: false, reason: "type an alias" };
  if (alias.includes(",")) return { ok: false, reason: "no commas: Roam splits aliases on them" };
  if (/[\r\n[\]]/.test(alias) || alias.includes("((") || alias.includes("))")) return { ok: false, reason: "no brackets or line breaks" };
  return { ok: true, alias };
}

export function isAliasBlock(string, keyword) {
  const kw = kwOf(keyword);
  return String(string).slice(0, kw.length + 2).toLowerCase() === `${kw.toLowerCase()}::`;
}

const holds = (string, keyword, alias) => parseAliasBlock(string, keyword).some((a) => a.toLowerCase() === alias.toLowerCase());

export function appendAlias(string, keyword, alias) {
  if (!isAliasBlock(string, keyword)) return null;
  if (holds(string, keyword, alias)) return { string, changed: false };
  const at = kwOf(keyword).length + 2;
  if (!string.slice(at).trim()) return { string: `${string.slice(0, at)} ${alias}`, changed: true };
  return { string: `${string.trimEnd()}, ${alias}`, changed: true };
}

export function removeAlias(string, keyword, alias) {
  if (!isAliasBlock(string, keyword)) return null;
  const at = kwOf(keyword).length + 2;
  const parts = string.slice(at).split(",");
  let index = parts.findIndex((part) => clean(part) === alias);
  if (index < 0) index = parts.findIndex((part) => clean(part).toLowerCase() === alias.toLowerCase());
  if (index < 0) return null;
  parts.splice(index, 1);
  return string.slice(0, at) + parts.join(",");
}

export function findAliasBlocks(api, pageUid, keyword) {
  const attrIds = api.q("[:find [?a ...] :in $ [?t ...] :where [?a :node/title ?t]]", keywordTitles(keyword));
  if (!attrIds?.length) return [];
  const rows = api.q("[:find ?u ?s :in $ ?pu [?a ...] :where [?p :block/uid ?pu] [?b :block/page ?p] [?b :block/refs ?a] [?b :block/string ?s] [?b :block/uid ?u]]", pageUid, attrIds) || [];
  const blocks = rows.filter(([, string]) => isAliasBlock(string, keyword));
  if (!blocks.length) return [];
  const page = api.pull("[{:block/children [:block/uid]}]", [":block/uid", pageUid]);
  const topUids = new Set((page?.[":block/children"] || []).map((child) => child[":block/uid"]));
  return blocks
    .map(([uid, string]) => ({ uid, string, top: topUids.has(uid) }))
    .sort((a, b) => Number(b.top) - Number(a.top) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
}

const freshString = (api, uid) => api.pull("[:block/string]", [":block/uid", uid])?.[":block/string"] ?? "";
const message = (error) => String(error?.message || error);

export async function addAliasToPage(api, { pageUid, keyword, alias }) {
  try {
    const kw = kwOf(keyword);
    const blocks = findAliasBlocks(api, pageUid, kw);
    const held = blocks.find((block) => holds(block.string, kw, alias));
    if (held) return { ok: true, changed: false, blockUid: held.uid };
    if (blocks.length) {
      const uid = blocks[0].uid;
      const before = freshString(api, uid);
      const result = appendAlias(before, kw, alias);
      if (!result) return { ok: false, error: "alias block changed" };
      if (!result.changed) return { ok: true, changed: false, blockUid: uid };
      await api.data.block.update({ block: { uid, string: result.string } });
      return { ok: true, changed: true, created: false, blockUid: uid, before, after: result.string };
    }
    const uid = api.util.generateUID();
    const after = `${kw}:: ${alias}`;
    await api.data.block.create({ location: { "parent-uid": pageUid, order: 0 }, block: { string: after, uid } });
    return { ok: true, changed: true, created: true, blockUid: uid, before: null, after };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function deleteAliasFromPage(api, { pageUid, keyword, alias }) {
  const missing = { ok: false, error: "alias not found on the page" };
  try {
    const blocks = findAliasBlocks(api, pageUid, keyword);
    const has = (block, test) => parseAliasBlock(block.string, keyword).some(test);
    const target = blocks.find((block) => has(block, (a) => a === alias)) || blocks.find((block) => has(block, (a) => a.toLowerCase() === alias.toLowerCase()));
    if (!target) return missing;
    const before = freshString(api, target.uid);
    const after = removeAlias(before, keyword, alias);
    if (after == null) return missing;
    await api.data.block.update({ block: { uid: target.uid, string: after } });
    return { ok: true, blockUid: target.uid, before, after };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}
