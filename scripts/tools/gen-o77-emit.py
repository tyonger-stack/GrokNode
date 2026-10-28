#!/usr/bin/env python3
import json, pathlib, re

body = open('o77_body.js').read()
manifest = json.load(open('o77_manifest.json'))
css = open('o77_css_append.css').read()
wiring = open('wiring.js').read()
EXPORT_PROMPT = open('constants.txt').read().rstrip()
INSTRUCTIONS = open('instructions.txt').read().rstrip()

HEADER = '''// Settings → 通用 → 导入: the official 0.77.0 memory-import flow ("将记忆导入 Grok
// Bot"). This revision ports the official DIALOG VERBATIM: the OFFICIAL_BODY below
// is 84 byte-extract segments from the rea-grokbot-0770 evidence chunks (per-segment
// anchor + sha256 in OFFICIAL_MANIFEST), renamed only in free identifiers to the
// O77_* namespace. The dialog chrome therefore matches the official app by
// construction — card shell + titlebar icon (arrow-bracket-to-down) + numbered
// steps + embedded copy button + leading-status footer — using the official sand-*
// class recipe (atomic rules missing from the pinned 0.18 stylesheet are appended,
// see OFFICIAL_CSS_APPEND; stylex hashes are content-derived so appended rules only
// ever apply to the classes this body renders).
//
// The WIRING layer at the top of COMPONENT_SOURCE maps the official runtime onto
// this build without visual code: react/jsx/compiler-runtime/Text/icon-glyph/base
// dialog come from the 0.18 registry chunk (same component lineage), i18n ids
// resolve through the RLocT settings-i18n appends, and the app hooks
// (sendPrompt/target/clipboard/navigation) go through the window.desktop.agent
// bridge. Documented deviations: rea-grokbot-0770/IMPORT-0770.md §6 (unconditional
// gate, main-bot-only target, no telemetry/toast, section card on the 0.18
// General-panel kit, icon glyph renderer + base dialog primitives from 0.18).
//
// Replaces the earlier hand-written RImportDialog in this file, whose Gt-kit
// chrome + inline styles did not match the official dialog. The v1 memory TAB
// (scripts/lib/agent-memory-import-renderer-patch.mjs) stays removed.
//
// Regeneration: python3 scripts/tools/gen-o77-import.py (extraction from the
// evidence tree is anchored and deterministic; keep the evidence path in sync).
'''

PATCH = f'''import {{ createHash }} from "node:crypto";
import {{ readdir, readFile, stat, writeFile }} from "node:fs/promises";
import path from "node:path";

// ── shared contract (tests/agent-memory-import*.test.mjs guard these; must stay
//    byte-identical to source/shared/node/agent-memory-import.ts) ──
{EXPORT_PROMPT}

export const VISIBLE_TEXT_EN = "Add these memories from my other AI assistant";
export const VISIBLE_TEXT_ZH = "添加这些来自我另一个 AI 助手的记忆";

{INSTRUCTIONS}

export const IMPORT_MAX_CHARS = 100_000;

// Anchors (unchanged): the section append target in the General panel. The router
// patch runs first and drops the Account card (children:[l,r,i,o]); we append here.
export const SA_CHILDREN_BEFORE = "children:[l,r,i,o]}}";
export const SA_CHILDREN_AFTER = "children:[l,r,i,o,a.jsx(RImportSection,{{}})]}}";
export const COMPONENT_ANCHOR = "function Sa(s){{";

// Verbatim official 0.77.0 segments (see file header). Embedded as a JSON string so
// the minified source (full of backticks) round-trips losslessly into the chunk.
const OFFICIAL_BODY = {json.dumps(body)};

// Per-segment provenance: source chunk, official symbol, emitted sha256, bytes.
export const OFFICIAL_MANIFEST = {json.dumps(manifest)};

// Official atomic rules absent from the pinned 0.18 stylesheet (0.77.0 index-BakdV4s2.css).
const OFFICIAL_CSS_APPEND = {json.dumps(css)};

export const COMPONENT_SOURCE = {json.dumps(wiring)} + "\\n" + "const O77PortInstructions=" + JSON.stringify(INSTRUCTIONS) + ";\\n" + OFFICIAL_BODY;

function replaceExactlyOnce(source, before, after, label) {{
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {{
    throw new Error(`Original renderer ${{label}} anchor is missing or ambiguous.`);
  }}
  return source.slice(0, first) + after + source.slice(first + before.length);
}}

export function patchOriginalImportBinding(source) {{
  // Earlier revision bound the Gt dialog kit here; the official body no longer needs
  // an import-tail change. Kept (no-op) so the clean-build call site stays stable.
  return source;
}}

export function patchOriginalSettingsGeneral(source) {{
  if (source.includes("RImportSection")) throw new Error("Memory import section is already injected.");
  if (!source.includes(COMPONENT_ANCHOR)) throw new Error("General settings panel (Sa) anchor missing.");
  let patched = replaceExactlyOnce(source, COMPONENT_ANCHOR, COMPONENT_SOURCE + COMPONENT_ANCHOR, "import component insertion");
  patched = replaceExactlyOnce(patched, SA_CHILDREN_BEFORE, SA_CHILDREN_AFTER, "general panel children (Sa)");
  return patched;
}}

function collectCssRules(text) {{
  // Sanity: every sand-* class the official body renders must resolve either in the
  // pinned stylesheet or in the appended rules — else the dialog silently degrades.
  const used = new Set(OFFICIAL_BODY.match(/sand-[a-z0-9]+/g) || []);
  const known = new Set((text.match(/sand-[a-z0-9]+/g) || []));
  const unresolved = [...used].filter((c) => !known.has(c) && !c.startsWith("sand-dialog") && !c.startsWith("sand-kit"));
  if (unresolved.length) throw new Error(`Official dialog classes missing from stylesheet: ${{unresolved.join(", ")}}`);
}}

export async function applyOriginalRendererMemoryImport0770({{ stageRoot }}) {{
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  let cssPath = null;
  for (const name of await readdir(assetsRoot)) {{
    if (!name.endsWith(".js") && !name.endsWith(".css")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (name.endsWith(".js") && source.includes(SA_CHILDREN_BEFORE) && source.includes(COMPONENT_ANCHOR)) {{
      candidates.push({{ name, target, source }});
    }}
    if (name.endsWith(".css") && source.includes("sand-") && source.length > 400_000) {{
      if (cssPath) throw new Error("Multiple renderer stylesheet candidates; refusing to guess.");
      cssPath = {{ name, target, source }};
    }}
  }}
  if (candidates.length !== 1) {{
    throw new Error(`Expected exactly one settings panel chunk (pristine, post-router), found ${{candidates.length}}.`);
  }}
  if (!cssPath) throw new Error("Pinned renderer stylesheet not found for the official CSS append.");

  const panel = candidates[0];
  const patched = patchOriginalSettingsGeneral(patchOriginalImportBinding(panel.source));
  // A stray identifier or unbalanced brace only shows up when the lazy settings view
  // loads — catch it now, while packaging can still fail loudly.
  const {{ parse }} = await import("acorn");
  parse(patched, {{ ecmaVersion: "latest", sourceType: "module" }});
  collectCssRules(cssPath.source + OFFICIAL_CSS_APPEND);

  let cssPatched = cssPath.source;
  let cssAppended = 0;
  if (!cssPatched.includes("/* o77-import */")) {{
    cssPatched = cssPatched + "\\n/* o77-import */\\n" + OFFICIAL_CSS_APPEND + "\\n";
    cssAppended = OFFICIAL_CSS_APPEND.split("\\n").length;
  }}
  await writeFile(panel.target, patched);
  await writeFile(cssPath.target, cssPatched);

  const hash = (text) => createHash("sha256").update(text).digest("hex");
  const record = {{
    schemaVersion: 2,
    mode: "original-renderer-memory-import-0770-verbatim",
    chunks: [
      {{
        role: "settings-panel-general-import-section",
        path: `dist/renderer/assets/${{panel.name}}`,
        original: {{ bytes: Buffer.byteLength(panel.source), sha256: hash(panel.source) }},
        patched: {{ bytes: Buffer.byteLength(patched), sha256: hash(patched) }},
      }},
      {{
        role: "renderer-stylesheet-official-append",
        path: `dist/renderer/assets/${{cssPath.name}}`,
        original: {{ bytes: Buffer.byteLength(cssPath.source), sha256: hash(cssPath.source) }},
        patched: {{ bytes: Buffer.byteLength(cssPatched), sha256: hash(cssPatched), appendedLines: cssAppended }},
      }},
    ],
    officialSegments: {{ count: OFFICIAL_MANIFEST.length, bytes: Buffer.byteLength(OFFICIAL_BODY) }},
    evidence: {{
      upstreamEquivalent: "Grok Bot 0.77.0 Settings → General → Import (grok_bot_memory_import)",
      note: "Official 0.77.0 dialog ported verbatim (84 segments, per-segment sha256 in OFFICIAL_MANIFEST). Deviations: rea-grokbot-0770/IMPORT-0770.md §6 (gate unconditional, main-bot-only target, no telemetry/toast, section card on 0.18 kit, icon glyph + base dialog primitives from the 0.18 registry chunk).",
    }},
    features: ["memory-import-0770", "memory-import-0770-verbatim-dialog"],
    transformations: ["settings-general-appends-import-section", "renderer-css-appends-official-atomic-rules"],
  }};
  const provenancePath = path.join(stageRoot, "dist", "renderer-memory-import-0770-extension.json");
  await writeFile(provenancePath, `${{JSON.stringify(record, null, 2)}}\\n`);
  return {{ ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size }};
}}
'''

out = pathlib.Path('/Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed/scripts/lib/memory-import-0770-renderer-patch.mjs')
out.write_text(HEADER + '\n' + PATCH, encoding='utf-8')
print('written', out, out.stat().st_size, 'bytes')
