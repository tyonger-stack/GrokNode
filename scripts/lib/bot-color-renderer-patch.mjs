// 强调色 = Bot 颜色 — build pass that appends the bot-color runtime (see
// bot-color-renderer-components.mjs) to the renderer's ENTRY chunk.
//
// Why the entry chunk and not the transcript chunk: the runtime is a self-starting
// IIFE that polls the DOM, so it must run exactly once per window load; the entry chunk
// (the one index.html references) is the only chunk with that guarantee. It also happens
// to be the chunk that owns the container classes we anchor on and the palette helpers
// (Cee/QCe) the runtime reuses through shared module scope.
//
// Fail-closed on five counts, mirroring applyMainAgentRendererPatch's discipline:
//   1. exactly one entry script referenced by dist/renderer/index.html;
//   2. the three container class names and both palette helpers must be present in that
//      chunk (Cee and QCe exactly once each — they are called by name at runtime);
//   3. the stylesheet must define the user-bubble class the runtime scopes by;
//   4. the generated tint table must be non-empty AND every replacement token inside it
//      must be defined in that stylesheet (buildBotColorTintTable already filters, this
//      re-asserts so a future stylesheet rename fails the build, not the user's chat);
//   5. the patched chunk must still parse (acorn) and must not be double-applied.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import { buildBotColorTintTable, botColorRuntime, findBotColorMessageClasses } from "./bot-color-renderer-components.mjs";

const hash = text => createHash("sha256").update(text).digest("hex");
const MARKER = "/* grok-node bot-color tint";

/** Containers and palette helpers that must exist in the entry chunk (presence check).
 *  Class-name strings appear WITHOUT their dot in JS (the dot is CSS-selector-only).
 *  The composer anchor is 0.18's sand-prompt-form (verified live: .sand-jp7ctv is the
 *  0.70.2 composer class and never appears in the 0.18 DOM). */
const REQUIRED_STRINGS = ["ui-scroll-area", "sand-prompt-form", "sand-info-pane"];
/** Palette helpers the runtime calls by name through shared module scope (uniqueness check). */
const REQUIRED_UNIQUE = ["function Cee(", "function QCe("];

export function patchBotColorRenderer(source, runtime) {
  if (source.includes(MARKER)) throw new Error("Bot-color renderer patch was already applied.");
  const patched = source + runtime;
  parse(patched, { ecmaVersion: "latest", sourceType: "module" });
  return patched;
}

export async function applyBotColorRendererPatch({ stageRoot }) {
  const rendererRoot = path.join(stageRoot, "dist", "renderer");
  const html = await readFile(path.join(rendererRoot, "index.html"), "utf8");
  const scripts = [...html.matchAll(/src="\.\/(assets\/[^"]+\.js)"/g)].map(match => match[1]);
  const entryScripts = scripts.filter(name => /\/index-[^/]+\.js$/.test(name));
  if (entryScripts.length !== 1) throw new Error(`Bot-color patch: expected exactly one entry index script, found ${entryScripts.length}.`);
  const entryPath = path.join(rendererRoot, entryScripts[0]);
  const source = await readFile(entryPath, "utf8");

  for (const marker of REQUIRED_STRINGS) {
    if (!source.includes(marker)) throw new Error(`Bot-color patch: container marker missing from entry chunk: ${marker}`);
  }
  for (const marker of REQUIRED_UNIQUE) {
    const count = source.split(marker).length - 1;
    if (count !== 1) throw new Error(`Bot-color patch: palette helper ${marker} must appear exactly once, found ${count}.`);
  }

  const cssFiles = (await readdir(path.join(rendererRoot, "assets"))).filter(file => /^index-.*\.css$/.test(file));
  if (cssFiles.length !== 1) throw new Error(`Bot-color patch: expected one main renderer stylesheet, found ${cssFiles.length}.`);
  const css = await readFile(path.join(rendererRoot, "assets", cssFiles[0]), "utf8");
  const messageClasses = findBotColorMessageClasses(css);
  const tintTable = buildBotColorTintTable(css);
  const hues = Object.keys(tintTable);
  if (hues.length === 0) throw new Error("Bot-color patch: tint table is empty; the stylesheet carries none of the hue source families.");
  for (const vars of Object.values(tintTable)) {
    for (const replacement of Object.values(vars)) {
      const token = replacement.slice(4, -1);
      if (!css.includes(token)) throw new Error(`Bot-color patch: tint references a token the stylesheet never defines: ${token}`);
    }
  }

  const runtime = botColorRuntime(tintTable, messageClasses);
  const patched = patchBotColorRenderer(source, runtime);
  await writeFile(entryPath, patched);
  console.log(`Bot-color tint: appended runtime to ${entryScripts[0]} (hues: ${hues.join(", ")}; message scope: .${messageClasses.user}${messageClasses.agent == null ? "" : `,.${messageClasses.agent}`})`);

  const provenance = {
    mode: "bot-color-in-chat",
    evidence: "Grok Bot 0.70.2 botTint (grok_bot_all_bots_color_theming), dimension-reduced onto the 0.18 flat token surface",
    entry: entryScripts[0],
    hues,
    messageClasses,
    files: [{ file: entryScripts[0], originalSha256: hash(source), patchedSha256: hash(patched) }],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-bot-color-extension.json");
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}
