// The entry owns the native React roots and Cee palette resolver. Keep the compiler
// caches intact and merge tint after their cached JSX, retaining keys, refs and events.
//
// Fail-closed on five counts, mirroring applyMainAgentRendererPatch's discipline:
//   1. exactly one entry script referenced by dist/renderer/index.html;
//   2. the three container class names and both palette helpers must be present in that
//      chunk (Cee resolves the palette; QCe anchors the native avatar contract);
//   3. the stylesheet must define the user-bubble class the runtime scopes by;
//   4. the generated tint table must be non-empty AND every replacement token inside it
//      must be defined in that stylesheet (buildBotColorTintTable already filters, this
//      re-asserts so a future stylesheet rename fails the build, not the user's chat);
//   5. the patched chunk must still parse (acorn) and must not be double-applied.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import { simple } from "acorn-walk";
import { buildBotColorTintTable, botColorRuntime, findBotColorMessageClasses } from "./bot-color-renderer-components.mjs";

const hash = text => createHash("sha256").update(text).digest("hex");
const MARKER = "/* grok-node bot-color tint";

/** Containers and palette helpers that must exist in the entry chunk (presence check).
 *  Class-name strings appear WITHOUT their dot in JS (the dot is CSS-selector-only).
 *  The composer anchor is 0.18's sand-prompt-form (verified live: .sand-jp7ctv is the
 *  0.70.2 composer class and never appears in the 0.18 DOM). */
const REQUIRED_STRINGS = ["ui-scroll-area", "sand-prompt-form", "sand-info-pane"];
/** Native palette and avatar helpers used to identify the supported renderer. */
const REQUIRED_UNIQUE = ["function Cee(", "function QCe("];

export function patchBotColorRenderer(source, runtime) {
  if (source.includes(MARKER)) throw new Error("Bot-color renderer patch was already applied.");
  if (/\bRbcTint\b/.test(source)) throw new Error("Bot-color renderer binding already exists.");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const transcriptBindings = [];
  simple(ast, { VariableDeclarator(node) {
    if (node.id.name === "c_n") transcriptBindings.push(source.slice(node.start, node.end));
  } });
  if (transcriptBindings.length !== 1 || transcriptBindings[0] !== "c_n=S.memo(i_n)") throw new Error("Bot-color patch: native transcript memo binding drifted.");
  const edits = [];
  function scoped(name, change) {
    const nodes = ast.body.filter(n => n.type === "FunctionDeclaration" && n.id.name === name);
    if (nodes.length !== 1) throw new Error(`Bot-color patch: expected one function ${name}, found ${nodes.length}.`);
    const node = nodes[0];
    edits.push({ start: node.start, end: node.end, text: change(source.slice(node.start, node.end), node) });
  }
  function once(text, anchor, replacement) {
    if (text.split(anchor).length !== 2) throw new Error(`Bot-color patch: missing or ambiguous native anchor ${anchor}`);
    return text.replace(anchor, replacement);
  }
  scoped("hve", text => once(text, "p.jsx(S9n,{...n,isSendingPaused:i})", "p.jsx(S9n,{...n,isSendingPaused:i})"));
  scoped("yOn", (text, node) => {
    const returns = node.body.body.filter(n => n.type === "ReturnStatement" && n.argument?.type === "ObjectExpression");
    if (returns.length !== 1) throw new Error("Bot-color patch: yOn chat assembly drifted.");
    const properties = returns[0].argument.properties;
    const propsEdits = [];
    for (const [names, component, style] of [
      [["transcript"], "c_n", "RbcTint.transcript(rbcTheme)"],
      [["composer", "inputDock"], "hve", "RbcTint.composer(rbcTheme)"],
    ]) {
      const candidates = properties.filter(prop => names.includes(prop.key?.name));
      if (candidates.length !== 1) throw new Error(`Bot-color patch: ambiguous chat property ${names.join("/")}`);
      const calls = [];
      simple(candidates[0].value, { CallExpression(call) {
        if (call.callee.type === "MemberExpression" && call.callee.object.name === "p" && call.callee.property.name === "jsx" && call.arguments[0]?.name === component && call.arguments[1]?.type === "ObjectExpression") calls.push(call);
      } });
      if (calls.length !== 1) throw new Error(`Bot-color patch: expected one ${component} in ${candidates[0].key.name}.`);
      propsEdits.push({ at: calls[0].arguments[1].start + 1 - node.start, text: `botColorStyle:${style},` });
    }
    for (const edit of propsEdits.sort((a, b) => b.at - a.at)) text = text.slice(0, edit.at) + edit.text + text.slice(edit.at);
    return once(text, "function yOn(n){", "function yOn(n){const rbcTheme=RbcTint.theme(n.currentAgent);");
  });
  scoped("i_n", text => {
    once(text, "he.c(150)", "he.c(150)");
    once(text, "Sr=p.jsx(p.Fragment,{children:p.jsx(Ar,{", "Sr=p.jsx(p.Fragment,{children:p.jsx(Ar,{");
    return once(text, ":Sr=e[149],Sr}", ":Sr=e[149],S.cloneElement(Sr,{children:S.cloneElement(Sr.props.children,{style:{...Sr.props.children.props.style,...n.botColorStyle}})})}");
  });
  scoped("S9n", text => {
    once(text, "he.c(215)", "he.c(215)");
    once(text, '$a=p.jsx("form",{className:ts,onSubmit:ks,children:za})', '$a=p.jsx("form",{className:ts,onSubmit:ks,children:za})');
    return once(text, ":$a=e[214],$a}", ":$a=e[214],S.cloneElement($a,{style:{...$a.props.style,...n.botColorStyle}})}");
  });
  scoped("E3n", text => {
    once(text, "he.c(58)", "he.c(58)");
    once(text, 'id:G,style:Y,children:[U,se,le]', 'id:G,style:Y,children:[U,se,le]');
    text = once(text, "function E3n(n){", "function E3n(n){const rbcInfo=RbcTint.info(n.agent);");
    return once(text, ":Q=e[57],Q}", ":Q=e[57],S.cloneElement(Q,{style:{...Y,...rbcInfo}})}");
  });
  let patched = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) patched = patched.slice(0, edit.start) + edit.text + patched.slice(edit.end);
  patched += runtime;
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
  console.log(`Bot-color tint: patched React roots in ${entryScripts[0]} (hues: ${hues.join(", ")})`);

  const provenance = {
    mode: "bot-color-in-chat",
    evidence: "Grok Bot 0.75.3 literal fQ/pQ/mQ/ion and qn/pf; native 0.18 palette and flat token projection",
    entry: entryScripts[0],
    hues,
    messageClasses,
    files: [{ file: entryScripts[0], originalSha256: hash(source), patchedSha256: hash(patched) }],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-bot-color-extension.json");
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}
