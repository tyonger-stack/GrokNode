// Regression cover for the official 0.75.8 wording of the two replica panels that live inside the
// ported "连接应用" dialog.
//
// The live marketplace is upstream 0.18's own plugins implementation, but two panels inside it are
// still Grok Node's own 0.66-era replica components: the effective-plugins list and the custom-MCP
// form. They used to render English titles ("Plugins in effect", "Custom MCP server") inside an
// otherwise Chinese UI — the last visible trace of the replica in the ported surface.
//
// The fix ports official 0.75.8's own wording (its zh-Hans locale entries, cited by message id) and
// resolves it through upstream's own locale runtime, so the language preference still switches it.
// This test guards three things:
//
//   * every Chinese string in the wording table is official's — matched against the captured
//     official locale fixture, so a typo or an invented translation fails here;
//   * the old English titles are gone from the components;
//   * the renderer patch still publishes the runtime the wording resolves through.
//
// The runtime behaviour itself is proven by the live smoke (`scripts/lib/marketplace-0758-smoke.mjs`),
// which reads the deployed dialog's text.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MARKETPLACE_CATEGORY_LABELS, MARKETPLACE_WORDING_REPLACEMENTS } from "../scripts/lib/marketplace-official-wording-patch.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const copyModule = read("frontend", "src", "i18n", "official-marketplace-copy.ts");
const panelSource = read("frontend", "src", "recovered", "features", "plugins", "overlay", "effective-plugins-panel.tsx");
const formSource = read("frontend", "src", "extensions", "custom-mcp-form.tsx");
const hostSource = read("frontend", "src", "extensions", "custom-mcp-form-host.tsx");
const wordingPatch = read("scripts", "lib", "marketplace-official-wording-patch.mjs");
const fixture = JSON.parse(read("tests", "fixtures", "official-0758-marketplace-wording.json"));

/**
 * English sides that are intentionally not official's verbatim English. Each one is official's
 * *concept* with official's Chinese, and the reason is recorded here because the fixture cannot
 * carry it.
 */
const EN_ADAPTATIONS = {
  disabledBadge: {
    en: "Disabled",
    reason: "official's 8yK/9X is \"Disabled\" but has no plain zh-Hans entry, so official's cO9+2L (\"Disable\" → 停用) supplies the Chinese",
  },
};

function readWordingTable(name) {
  const start = copyModule.indexOf(`export const ${name} = {`);
  assert.ok(start >= 0, `${name} is missing from the official wording module`);
  const end = copyModule.indexOf("} as const satisfies", start);
  assert.ok(end > start, `${name} has no closing table`);
  const body = copyModule.slice(start, end);
  const entries = new Map();
  const re = /(\w+):\s*\{\s*en:\s*"((?:[^"\\]|\\.)*)",\s*zh:\s*"((?:[^"\\]|\\.)*)",\s*source:\s*"([^"]+)"\s*,?\s*\}/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    entries.set(match[1], { en: match[2], zh: match[3], source: match[4] });
  }
  assert.ok(entries.size > 0, `${name} parsed no entries`);
  return entries;
}

test("every ported Chinese string is official 0.75.8's own", () => {
  for (const table of ["EFFECTIVE_PLUGINS_PANEL_WORDING", "CUSTOM_MCP_FORM_WORDING"]) {
    for (const [field, wording] of readWordingTable(table)) {
      const idMatch = /^official ([A-Za-z0-9+/]{6})$/.exec(wording.source);
      assert.ok(idMatch != null, `${table}.${field} must cite an official message id, got ${wording.source}`);
      const official = fixture.messages[idMatch[1]];
      assert.ok(official != null, `${table}.${field} cites ${idMatch[1]}, which the official fixture does not carry`);
      assert.equal(official.parts.length, 1, `${table}.${field} cites a plural or interpolated entry`);
      assert.equal(wording.zh, official.parts[0], `${table}.${field} Chinese must be official's ${idMatch[1]}`);
      const adaptation = EN_ADAPTATIONS[field];
      if (adaptation == null) {
        assert.equal(wording.en, official.en, `${table}.${field} English must be official's ${idMatch[1]}`);
      } else {
        assert.equal(wording.en, adaptation.en, `${table}.${field} English is a documented adaptation`);
      }
    }
  }
});

test("the official fixture covers every id the wording cites", () => {
  const cited = new Set();
  for (const table of ["EFFECTIVE_PLUGINS_PANEL_WORDING", "CUSTOM_MCP_FORM_WORDING"]) {
    for (const [, wording] of readWordingTable(table)) {
      const idMatch = /^official ([A-Za-z0-9+/]{6})$/.exec(wording.source);
      if (idMatch != null) cited.add(idMatch[1]);
    }
  }
  assert.ok(cited.size >= 15, `expected the wording tables to cite official's ids, got ${cited.size}`);
  for (const id of cited) {
    assert.ok(fixture.messages[id] != null, `the official fixture is missing ${id}`);
  }
});

test("the copy ids map marks the fields official has no message for", () => {
  const map = formSource.match(/export const CUSTOM_MCP_FORM_COPY_IDS[^=]*= \{([\s\S]*?)\n\};/);
  assert.ok(map != null, "CUSTOM_MCP_FORM_COPY_IDS is missing");
  const entries = Array.from(map[1].matchAll(/(\w+):\s*"([^"]+)"/g), (m) => [m[1], m[2]]);
  assert.ok(entries.length >= 15, "CUSTOM_MCP_FORM_COPY_IDS lost entries");
  for (const [field, source] of entries) {
    if (source === "no-official-counterpart") continue;
    assert.match(source, /^[A-Za-z0-9+/]{6}$/, `${field} must cite an official message id, got ${source}`);
    assert.ok(fixture.messages[source] != null, `${field} cites ${source}, which the official fixture does not carry`);
  }
  const unported = copyModule.match(/export const UNPORTED_CUSTOM_MCP_FIELDS = \[([\s\S]*?)\] as const;/);
  assert.ok(unported != null, "UNPORTED_CUSTOM_MCP_FIELDS is missing");
  const listed = Array.from(unported[1].matchAll(/"([^"]+)"/g), (m) => m[1]);
  assert.ok(listed.includes("invalidUrl"), "the unported field list must stay explicit");
  for (const field of listed) {
    assert.ok(
      new RegExp(`\\n\\s*${field}: "`, "m").test(formSource),
      `${field} is listed as unported, so it must keep an explicit English literal`,
    );
  }
});

test("the 0.66-era English titles are gone from the replica panels", () => {
  // Comments may still name the old strings — they document the port — so only code counts.
  const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const source of [panelSource, formSource, hostSource]) {
    assert.ok(!code(source).includes("Plugins in effect"), "the 0.66-era panel title is still in the code");
    assert.ok(!code(source).includes("Custom MCP server"), "the 0.66-era form title is still in the code");
    assert.ok(!code(source).includes("Give the server a name."), "the 0.66-era name validation is still in the code");
  }
  assert.match(panelSource, /effectivePluginsPanelCopy\(props\.copy\)/);
  assert.match(formSource, /customMcpFormCopy\(props\.copy\)/);
  assert.match(hostSource, /customMcpFormCopy\(props\.copy\)/);
});

test("the category headings are official 0.75.8's own, in both languages", () => {
  // official's own category-key map (chunk-plugins-model-DeyTkJ2l.js) → official's message id.
  const categories = {
    FEATURED: "FkMol5",
    INFRASTRUCTURE: "Mo77P4",
    DATA_ANALYTICS: "svH45G",
    PRODUCTIVITY: "N42ane",
    PAYMENTS: "H0ShEF",
    AGENT_ORCHESTRATION: "byAjqm",
    CANVAS: "Zty/IJ",
    INBOX_AND_COLLABORATION: "IzFMeN",
    SCHEDULING: "DbZMYM",
    DOCUMENTS_AND_FILES: "gDShYL",
    SALES: "mUv9U4",
    CUSTOMER_SUPPORT: "n+xLOH",
    FINANCE_AND_LEGAL: "hxm6On",
    RESEARCH: "bdztP2",
    DESIGN: "f8fH8W",
    MARKETING: "vo2a+a",
    LOGIN_AND_CREDENTIAL_MANAGEMENT: "P+nzjE",
  };
  for (const [key, id] of Object.entries(categories)) {
    const official = fixture.messages[id];
    assert.ok(official != null, `the official fixture is missing the category id ${id}`);
    assert.ok(
      MARKETPLACE_CATEGORY_LABELS.includes(`case"${key}":return RLocT("${official.en}","${official.zh}")`),
      `${key} must render official's ${id} (${official.en} / ${official.zh})`,
    );
  }
  assert.ok(
    MARKETPLACE_CATEGORY_LABELS.includes("default:return null"),
    "an unknown category key must not invent a label",
  );
});

test("the wording resolves through upstream's own locale runtime", () => {
  assert.match(copyModule, /globalThis as LocaleGlobal\)\.__sandRLocT/);
  assert.match(copyModule, /typeof runtime === "function" \? runtime\(en, zh\) : en/);
  assert.match(wordingPatch, /globalThis\.__sandRLocT=typeof RLocT==="function"\?RLocT:undefined;/);
  // The publish is only meaningful when the runtime is in the chunk, so the patch must look for it.
  assert.match(wordingPatch, /patched\.includes\("function RLocT\("\)/);
});

test("every Chinese string the chunk patch writes is official 0.75.8's own", () => {
  const entries = MARKETPLACE_WORDING_REPLACEMENTS;
  assert.ok(entries.length >= 25, `expected the wording patch to carry the official swaps, got ${entries.length}`);
  let cited = 0;
  for (const entry of entries) {
    // `official` is either a message id, several ids joined by " / ", or a descriptive note
    // (the category map and the geometry anchors have no single message id).
    const ids = entry.official.split(" / ").filter((id) => /^[A-Za-z0-9+/]{6}$/.test(id));
    if (ids.length === 0) continue;
    cited += 1;
    for (const id of ids) {
      const official = fixture.messages[id];
      assert.ok(official != null, `${entry.label} cites ${id}, which the official fixture does not carry`);
      for (const part of official.parts) {
        assert.ok(
          entry.after.includes(part),
          `${entry.label} must write official's ${id} fragment ${JSON.stringify(part)}, got ${entry.after}`,
        );
      }
    }
  }
  assert.ok(cited >= 25, `expected at least 25 official ids in the wording patch, got ${cited}`);
});

test("the wording patch's anchors are unique", () => {
  const seen = new Map();
  for (const entry of MARKETPLACE_WORDING_REPLACEMENTS) {
    assert.ok(!seen.has(entry.before), `${entry.label} reuses the anchor of ${seen.get(entry.before)}`);
    seen.set(entry.before, entry.label);
  }
  // Where an anchor is still present in the pristine upstream chunk it must occur exactly once —
  // the patch refuses an ambiguous anchor at build time, and this catches it earlier.
  const pristine = path.join(repoRoot, "src", "app", "dist", "renderer", "assets", "view-B5Ug8wEm.js");
  if (!existsSync(pristine)) return;
  const chunk = readFileSync(pristine, "utf8");
  for (const entry of MARKETPLACE_WORDING_REPLACEMENTS) {
    const count = chunk.split(entry.before).length - 1;
    if (count === 0) continue; // a post-i18n anchor: it does not exist in the pristine chunk
    assert.equal(count, 1, `${entry.label}: anchor must occur exactly once in the pristine chunk, found ${count}`);
  }
});
