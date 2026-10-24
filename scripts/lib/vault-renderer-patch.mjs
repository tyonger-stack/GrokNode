import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { parse } from "acorn";
import { openUpstream0755 } from "./upstream-0755.mjs";
import { bundleUpstreamModule } from "./upstream-module.mjs";
import { chunkReactPlugin } from "./library-host-renderer-patch.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vaultDir = path.join(repoRoot, "frontend/src/recovered/features/vault");
const generatedPath = path.join(vaultDir, "upstream-vault-settings.generated.mjs");
const hostEntry = path.join(repoRoot, "frontend/src/extensions/vault-host-mount.tsx");
const messagesPath = path.join(vaultDir, "upstream-vault-messages.generated.mjs");
export const VAULT_RENDERER_NAMESPACE = "__sandVaultRendererNS";
export const VAULT_RENDERER_MARK = "/* sand-vault-0721 */";

const browserGlobals = `const window=globalThis.window,document=globalThis.document,HTMLElement=globalThis.HTMLElement,HTMLInputElement=globalThis.HTMLInputElement,HTMLSelectElement=globalThis.HTMLSelectElement,HTMLTextAreaElement=globalThis.HTMLTextAreaElement,HTMLAnchorElement=globalThis.HTMLAnchorElement,Image=globalThis.Image,Event=globalThis.Event,DOMException=globalThis.DOMException,KeyboardEvent=globalThis.KeyboardEvent,FocusEvent=globalThis.FocusEvent,MouseEvent=globalThis.MouseEvent,IntersectionObserver=globalThis.IntersectionObserver,MutationObserver=globalThis.MutationObserver,reportError=globalThis.reportError,ResizeObserver=globalThis.ResizeObserver,cancelAnimationFrame=globalThis.cancelAnimationFrame,getComputedStyle=globalThis.getComputedStyle,requestAnimationFrame=globalThis.requestAnimationFrame,navigator=globalThis.navigator,location=globalThis.location,history=globalThis.history,__REACT_DEVTOOLS_GLOBAL_HOOK__=globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__,CSS=globalThis.CSS,Element=globalThis.Element,Node=globalThis.Node,ShadowRoot=globalThis.ShadowRoot,performance=globalThis.performance;\n`;

// Upstream initializes some module-level factories with a side-effect pattern:
//   var cc,lc;(class e{ ... static{ cc=...; lc=... } ... })
// The declaration extractor keeps the bare `var cc,lc;` declarators but drops
// the unindexed class expression statement, so the bundle ships `var lc;`
// forever undefined (observed: "lc is not a function" when the settings hook
// renders). Rewrite each occurrence into a hoisted helper whose invocation is
// the declarator's initializer, which the extractor follows:
//   var {cc,lc}=__sandVaultFactoryNNN();function __sandVaultFactoryNNN(){let cc,lc;(class ...);return {cc,lc};}
export function inlineClassStaticFactories(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const edits = [];
  for (let i = 0; i + 1 < ast.body.length; i += 1) {
    const decl = ast.body[i];
    const next = ast.body[i + 1];
    if (decl.type !== "VariableDeclaration" || next.type !== "ExpressionStatement") continue;
    if (decl.declarations.length === 0) continue;
    if (!decl.declarations.every((d) => d.init === null && d.id.type === "Identifier")) continue;
    const names = decl.declarations.map((d) => d.id.name);
    const text = source.slice(next.start, next.end);
    if (!text.startsWith("(class ") || !text.includes("static{")) continue;
    if (!names.every((name) => text.includes(`${name}=`))) continue;
    const helper = `__sandVaultFactory${decl.start}`;
    edits.push({ start: decl.start, end: next.end,
      replacement: `var {${names.join(",")}}=${helper}();function ${helper}(){let ${names.join(",")};${text};return {${names.join(",")}};}` });
    i += 1;
  }
  if (edits.length === 0) return source;
  let out = "";
  let cursor = 0;
  for (const edit of edits) {
    out += source.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  return out + source.slice(cursor);
}
const virtualEntry = "dist/renderer/assets/sand-vault-0721-entry.js";
const upstreamView = "dist/renderer/assets/chunk-view-CuYU9NOh.js";
const upstreamEagerApp = "dist/renderer/assets/index.eager-app-uZS5Ltig.js";
const upstreamCommon = "dist/renderer/assets/index.eager-common-F4Y1-gMW.js";
const upstreamCss = "dist/renderer/assets/index-CFSAhbDS.css";
const upstreamVendor = "dist/renderer/assets/index.eager-vendor-CRCbzhle.js";

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`Vault renderer ${label} anchor must appear exactly once.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function transformUpstreamArchive(archive) {
  return {
    identity: archive.identity,
    files: archive.files,
    provenance: archive.provenance,
    readNative: archive.readNative.bind(archive),
    copy: archive.copy.bind(archive),
    read(relative) {
      if (process.env.SAND_VAULT_DEBUG) console.error("vault-read", relative);
      const bytes = relative === virtualEntry
        ? Buffer.from(`import {sandVaultSettings as settings} from "./chunk-view-CuYU9NOh.js"; import {sandVaultCreateStore as createStore} from "./index.eager-app-uZS5Ltig.js"; import {et as linguiProvider} from "./index.eager-vendor-CRCbzhle.js"; import {r as paneHeaderProvider} from "./chunk-pane-header-BbJph3XZ.js"; export {settings as default, createStore as createUpstreamVaultStore, linguiProvider as createUpstreamVaultLinguiProvider, paneHeaderProvider as createUpstreamVaultPaneHeaderProvider};\n`)
        : archive.read(relative);
      let source = Buffer.concat([Buffer.from(browserGlobals), bytes]).toString("utf8");
      if (relative === upstreamCommon) {
        source = replaceOnce(source, "ot as At", "sandVaultReact as At", "React port");
        source = `function sandVaultReact(){return globalThis.__sandVaultReact}\n${source}`;
      }
      if (relative === upstreamEagerApp) {
        source = replaceOnce(source, "function Q(){", "function SandOriginalVaultQ(){", "client hook");
        source = replaceOnce(source, "function up(){return Nc(Q().auth.snapshots)}", "function up(){return {status:{kind:\"logged-in\"}}}", "auth hook");
        source = `function Q(){return globalThis.__sandVault0721Client}\n${source}`;
        const tail = source.lastIndexOf("};");
        if (tail < 0) throw new Error("Upstream eager-app export table is missing.");
        source = source.slice(0, tail) + ",Gmn as sandVaultCreateStore" + source.slice(tail);
        if (process.env.SAND_VAULT_DEBUG) console.error(source.slice(Math.max(0, source.length - 500)));
      }
      if (process.env.SAND_VAULT_DEBUG && relative === virtualEntry) console.error(JSON.stringify(source.slice(0, 180)));
      if (relative === upstreamView) {
        source = replaceOnce(source, "gr as default", "gr as default,gr as sandVaultSettings", "settings export");
      }
      if (relative === upstreamCommon || relative === upstreamEagerApp || relative === upstreamView || relative === upstreamVendor) {
        source = inlineClassStaticFactories(source);
      }
      return Buffer.from(source, "utf8");
    },
  };
}

function cssRules(css) {
  const rules = [];
  let index = 0;
  function parse(nested = false) {
    while (index < css.length) {
      const start = index;
      const brace = css.indexOf("{", index);
      if (brace < 0) break;
      const selector = css.slice(start, brace).trim();
      let depth = 1;
      index = brace + 1;
      while (index < css.length && depth > 0) {
        if (css[index] === "{") depth += 1;
        else if (css[index] === "}") depth -= 1;
        index += 1;
      }
      const body = css.slice(brace + 1, index - 1).trim();
      rules.push({ selector, body, nested });
      if (nested && css[index] === ";") index += 1;
    }
  }
  parse();
  return rules;
}

function scopeSelector(selector, root) {
  if (selector.includes(":root")) return root;
  return selector.split(",").map((part) => `${root} ${part.trim()}`).join(",");
}

function scopeActionSelector(selector) {
  if (selector.includes(":root")) return "[data-sand-vault-actions]";
  return selector.split(",").map((part) => `[data-sand-vault-actions] ${part.trim()}`).join(",");
}

function scopeMenuPortalSelector(selector) {
  const guard = ':where(body:has(#sand-vault-0721-root [aria-expanded="true"], [data-sand-vault-actions] [aria-expanded="true"]))';
  return selector.split(",").map((part) => {
    const clean = part.trim().replaceAll(":not(#\\#)", "");
    return `${guard} :where([data-component="menu-popup"], [data-component="menu-popup"] *):not(#sand-vault-portal-sentinel):not(#sand-vault-portal-sentinel-2):is(${clean})`;
  }).join(",");
}

function scopeDialogSelector(selector) {
  const guard = ':where(body:has(#sand-vault-0721-root))';
  return selector.split(",").map((part) => {
    const clean = part.trim().replaceAll(":not(#\\#)", "");
    return `${guard} :where(.sand-dialog, .sand-dialog *):not(#sand-vault-dialog-sentinel):is(${clean})`;
  }).join(",");
}

function vaultLegacyTokenLayer() {
  const guard = ':where(body:has(#sand-vault-0721-root [aria-expanded="true"], [data-sand-vault-actions] [aria-expanded="true"]))';
  return `.sand-settings-dialog,.sand-dialog,#sand-vault-0721-root,[data-sand-vault-actions],${guard} [data-component="menu-popup"]{--sand-bg-pane:var(--sand-bg-base);--sand-bg-chrome:var(--sand-bg-subtle);--sand-bg-sidebar:var(--sand-bg-subtle);--sand-bg-elevated-hover:var(--sand-fill-ghost-hover);--sand-bg-luminous:var(--sand-bg-elevated);--sand-bg-hover:var(--sand-fill-ghost-hover);--sand-bg-active:var(--sand-fill-ghost-selected);--sand-bg-primary:var(--sand-fill-primary);--sand-bg-primary-hover:var(--sand-fill-primary-hover);--sand-bg-primary-disabled:var(--sand-fill-primary-disabled);--sand-bg-secondary:var(--sand-fill-secondary);--sand-bg-secondary-hover:var(--sand-fill-secondary-hover);--sand-bg-secondary-active:var(--sand-fill-ghost-selected);--sand-bg-secondary-disabled:var(--sand-fill-secondary-disabled);--sand-bg-tertiary:var(--sand-fill-ghost-hover);--sand-bg-quaternary:var(--sand-fill-secondary-disabled);--sand-text-inverted:var(--sand-text-on-primary);--sand-border-primary-translucent:var(--sand-border-strong);--sand-border-secondary-translucent:var(--sand-border-default);--sand-border-tertiary-translucent:var(--sand-border-weak);--sand-border-quaternary-translucent:var(--sand-border-subtle);--sand-border-focus-primary:var(--sand-border-focus);}
.sand-settings-dialog:not(#\\#):not(#\\#){--cursor-bg-elevated:var(--sand-bg-subtle);--cursor-bg-secondary:var(--sand-fill-secondary);--cursor-bg-tertiary:var(--sand-fill-ghost-hover);--cursor-border-secondary:var(--sand-border-default);--cursor-button-secondary-background:var(--sand-fill-secondary);--cursor-stroke-tertiary:var(--sand-border-weak);--cursor-stroke-focused:var(--sand-border-focus);--cursor-text-primary:var(--sand-text-primary);--cursor-text-secondary:var(--sand-text-secondary)}
[data-theme=cursor-dark] .sand-dialog:not(#\\#):not(#\\#){--sand-bg-elevated:#1f1f1f;--sand-bg-hover:#f5f5f50f}
[data-theme=cursor-light] .sand-dialog:not(#\\#):not(#\\#){--sand-bg-elevated:#fff;--sand-bg-hover:#1c1c1c0f}
body:has(.sand-settings-dialog) .sand-settings-dialog:not(#\\#):not(#\\#):not(#\\#){background-color:var(--sand-bg-subtle)}
body:has(.sand-settings-dialog) .sand-settings-dialog .sand-settings-nav:not(#\\#):not(#\\#):not(#\\#){background-color:transparent;border-inline-end:.5px solid var(--sand-border-weak)}`;
}

function extractScopedVaultCss(css, classNames) {
  const classes = new Set(classNames);
  const uiClasses = new Set([...classes].filter((name) => name.startsWith("ui-")));
  const matched = [];
  const tokenScopes = '.sand-dialog,#sand-vault-0721-root,[data-sand-vault-actions],:where(body:has(#sand-vault-0721-root [aria-expanded="true"], [data-sand-vault-actions] [aria-expanded="true"])) [data-component="menu-popup"]';
  const appendRule = (selector, body) => {
    matched.push(`${scopeSelector(selector, "#sand-vault-0721-root")}{${body}}`);
    matched.push(`${scopeActionSelector(selector)}{${body}}`);
    matched.push(`${scopeMenuPortalSelector(selector)}{${body}}`);
    matched.push(`${scopeDialogSelector(selector)}{${body}}`);
  };
  for (const rule of cssRules(css)) {
    if (rule.selector.includes(":root")) {
      const dimensional = rule.body.split(";").filter((declaration) => {
        const name = declaration.slice(0, declaration.indexOf(":")).trim();
        return /^--sand-(?:menu|font|line-height|letter-spacing|spacing|radius|height|size|blur)/u.test(name);
      }).join(";");
      if (dimensional.length > 0) matched.push(`${tokenScopes}{${dimensional}}`);
      continue;
    }
    if (rule.selector.startsWith("@media") || rule.selector.startsWith("@supports")) {
      const children = cssRules(rule.body).filter((child) => child.selector.split(",").some((part) => [...classes].some((name) => part.includes(`.${name}`))));
      if (children.length > 0) {
        matched.push(`${rule.selector}{${children.map((child) => `${scopeSelector(child.selector, "#sand-vault-0721-root")}{${child.body}}`).join("")}}`);
        matched.push(`${rule.selector}{${children.map((child) => `${scopeActionSelector(child.selector)}{${child.body}}`).join("")}}`);
        matched.push(`${rule.selector}{${children.map((child) => `${scopeMenuPortalSelector(child.selector)}{${child.body}}`).join("")}}`);
        matched.push(`${rule.selector}{${children.map((child) => `${scopeDialogSelector(child.selector)}{${child.body}}`).join("")}}`);
      }
      continue;
    }
    if (rule.selector.startsWith("@keyframes")) continue;
    if (rule.selector.split(",").some((part) => [...classes].some((name) => part.includes(`.${name}`)))) {
      appendRule(rule.selector, rule.body);
    }
  }
  const used = matched.join("\n");
  for (const rule of cssRules(css)) {
    if (!rule.selector.startsWith("@keyframes")) continue;
    const name = (/@keyframes\s+([A-Za-z0-9_-]+)/u.exec(rule.selector)?.[1]) ?? "";
    if (name !== "" && used.includes(name)) matched.push(rule.selector + "{" + rule.body + "}");
  }
  if (matched.length === 0) throw new Error("No scoped Vault styles were found in the pinned upstream stylesheet.");
  return matched.join("\n");
}

export async function buildUpstreamVaultSettings() {
  const archive = transformUpstreamArchive(await openUpstream0755());
  const result = await bundleUpstreamModule({
    archive,
    entry: virtualEntry,
    exports: ["default", "createUpstreamVaultStore", "createUpstreamVaultLinguiProvider", "createUpstreamVaultPaneHeaderProvider"],
    platform: "browser",
  });
  let code = result.code.replaceAll(os.tmpdir(), "<tmp>");
  code = code.replace(/<tmp>\/grok-upstream-module-[^/]+/gu, "<upstream>");
  code = replaceOnce(code, "var P = Me();", 'var P = Me({ locale: globalThis.navigator?.language || "en" });', "i18n locale");
  const classNames = [...new Set(code.match(/(?<![A-Za-z0-9_-])(?:sand|ui)-[A-Za-z0-9_-]+/gu) ?? [])];
  if (classNames.filter((name) => name.startsWith("ui-")).length < 100) {
    throw new Error("Extracted Vault module lost the upstream UI design-system classes.");
  }
  const css = extractScopedVaultCss(archive.read(upstreamCss).toString("utf8").slice(browserGlobals.length), classNames) + "\n" + vaultLegacyTokenLayer();
  const provenance = {
    upstream: archive.identity,
    modules: result.modules.map((module) => ({ path: module.path, inputSha256: module.inputSha256, exports: module.exports })),
    styleSha256: createHash("sha256").update(css).digest("hex"),
  };
  const contents = [
    "// Generated by scripts/lib/vault-renderer-patch.mjs from the pinned Grok Bot 0.75.5 ASAR. Do not edit.",
    `// provenance=${JSON.stringify(provenance)}`,
    `export const upstreamVaultStyle = ${JSON.stringify(css)};`,
    code,
    "",
  ].join("");
  await mkdir(vaultDir, { recursive: true });
  await writeFile(generatedPath, contents, "utf8");
  return { path: generatedPath, bytes: contents.length, styleBytes: css.length, style: css, classNames: classNames.length, provenance };
}

function collectBundleMessageIds(code) {
  const ids = new Set();
  for (const match of code.matchAll(/[{,]\s*id:\s*[`"']([A-Za-z0-9+/=_-]{4,12})[`"']/gu)) ids.add(match[1]);
  for (const match of code.matchAll(/_\(\s*[`"']([A-Za-z0-9+/=_-]{4,12})[`"']/gu)) ids.add(match[1]);
  return ids;
}

function extractCatalogEntries(source, ids) {
  const entries = {};
  for (const id of ids) {
    const key = `"${id}":`;
    const start = source.indexOf(key);
    if (start < 0) continue;
    let index = start + key.length;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; index < source.length; index += 1) {
      const ch = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === "[") { depth += 1; continue; }
      if (ch === "]") {
        depth -= 1;
        if (depth === 0) { index += 1; break; }
        continue;
      }
      if (depth === 0 && (ch === "," || ch === "}")) break;
    }
    try { entries[id] = JSON.parse(source.slice(start + key.length, index)); }
    catch { /* non-JSON catalog value; the runtime falls back to the default message */ }
  }
  return entries;
}

export async function buildUpstreamVaultMessages(settingsBundleCode) {
  const archive = await openUpstream0755();
  const ids = collectBundleMessageIds(settingsBundleCode);
  if (ids.size < 20) throw new Error(`Vault bundle exposed too few message ids: ${ids.size}`);
  const en = extractCatalogEntries(archive.read(upstreamEagerApp).toString("utf8"), ids);
  let zhSource = null;
  for (const file of archive.files) {
    if (!/dist\/renderer\/assets\/chunk-settings-[^/]+\.js$/u.test(file)) continue;
    const text = archive.read(file).toString("utf8");
    if (text.includes('"NLLW52"') && text.includes("\u4fdd\u9669\u5e93")) { zhSource = text; break; }
  }
  if (zhSource === null) throw new Error("Simplified Chinese renderer catalog was not found");
  const zh = extractCatalogEntries(zhSource, ids);
  const provenance = { upstream: archive.identity, ids: ids.size, en: Object.keys(en).length, zhCN: Object.keys(zh).length };
  const contents = [
    "// Generated by scripts/lib/vault-renderer-patch.mjs from the pinned Grok Bot 0.75.5 ASAR. Do not edit.",
    `// provenance=${JSON.stringify(provenance)}`,
    `export const upstreamVaultMessages = ${JSON.stringify({ en, "zh-CN": zh })};`,
    "",
  ].join("\n");
  await mkdir(vaultDir, { recursive: true });
  await writeFile(messagesPath, contents, "utf8");
  return { path: messagesPath, provenance };
}

export async function buildVaultRendererBundle() {
  const generated = await buildUpstreamVaultSettings();
  const messages = await buildUpstreamVaultMessages(await readFile(generated.path, "utf8"));
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [hostEntry],
    outfile: path.join(repoRoot, "vault-renderer.js"),
    bundle: true,
    format: "iife",
    globalName: VAULT_RENDERER_NAMESPACE,
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    write: false,
    metafile: true,
    sourcemap: "external",
    legalComments: "none",
    define: { "import.meta.url": "document.baseURI" },
    banner: { js: "globalThis.__sandVaultReact=S;" },
    plugins: [chunkReactPlugin()],
  });
  const file = result.outputFiles.find((item) => item.path.endsWith(".js"))?.text ?? "";
  const map = result.outputFiles.find((item) => item.path.endsWith(".js.map"))?.text ?? "";
  if (!file.includes("RVaultSettingsHost")) throw new Error("Vault renderer bundle did not emit RVaultSettingsHost.");
  if (/from\s+"react"|require\("react"\)/u.test(file)) throw new Error("Vault renderer bundle bundled a second React runtime.");
  if (/createRoot\s*\(/u.test(file)) throw new Error("Vault renderer bundle must mount inside the existing React tree.");
  if (/new\s+MutationObserver[\s\S]{0,320}\.observe\(\s*(?:document\.(?:body|documentElement)|window)\b/u.test(file)) {
    throw new Error("Vault renderer bundle must not observe the document root.");
  }
  const inputs = Object.keys(result.metafile.inputs).map((input) => path.resolve(repoRoot, input));
  if (inputs.some((input) => /[/\\]node_modules[/\\](react|react-dom)[/\\]/u.test(input))) {
    throw new Error("Vault renderer must compile against the pinned chunk React runtime.");
  }
  if (generated.style.length === 0) throw new Error("Vault renderer bundle lost the scoped upstream stylesheet.");
  const styleCss = JSON.stringify(generated.style);
  const style = `;(()=>{if(typeof document==="undefined"||document.getElementById("sand-vault-0721-style"))return;const style=document.createElement("style");style.id="sand-vault-0721-style";style.textContent=${styleCss};document.head.append(style);})();`;
  return {
    generated,
    bundle: `${VAULT_RENDERER_MARK}\n${file}${style}\n`,
    sourceMap: map,
  };
}

function patchViewSource(source) {
  if (source.includes('id: "vault"')) return source;
  let result = replaceOnce(source,
    'export type SettingsSectionId = "general" | "router" | "usage" | "beta";',
    'export type SettingsSectionId = "general" | "router" | "vault" | "usage" | "beta";',
    "section id type");
  result = replaceOnce(result,
    'icon: "settings-gear" | "git-branch" | "chart-bars" | "cloud-download";',
    'icon: "settings-gear" | "git-branch" | "vault" | "chart-bars" | "cloud-download";',
    "section icon type");
  result = replaceOnce(result,
    '  { id: "usage", label: "Usage & Billing", icon: "chart-bars" },',
    '  { id: "vault", label: "Vault", icon: "vault" },\n  { id: "usage", label: "Usage & Billing", icon: "chart-bars" },',
    "Vault nav entry");
  return result;
}

function patchSurfaceSource(source) {
  if (source.includes("RVaultSettingsHost")) return source;
  let result = replaceOnce(source,
    'import { SettingsNoticeView, settingsNoticeFromEvent, type SettingsNotice } from "./notice";',
    'import { SettingsNoticeView, settingsNoticeFromEvent, type SettingsNotice } from "./notice";\nimport { RVaultSettingsHost } from "../../../extensions/vault-host-mount";',
    "Vault host import");
  return replaceOnce(result,
    '        if (section === "general") return (',
    '        if (section === "vault") return <RVaultSettingsHost focusSetting={null} />;\n        if (section === "general") return (',
    "Vault section render");
}

export function patchVaultSettingsSources({ view, surface }) {
  if (typeof view !== "string" || typeof surface !== "string") throw new Error("Vault settings patch requires view and surface sources.");
  const nextView = patchViewSource(view);
  const nextSurface = patchSurfaceSource(surface);
  if (nextView.includes("id: \"vault\"", 0) && nextView.split('id: "vault"').length !== 2) throw new Error("Vault settings nav was already applied.");
  if (nextSurface.includes("RVaultSettingsHost")) {
    if (surface.includes("RVaultSettingsHost")) throw new Error("Vault settings surface was already applied.");
  }
  return { view: nextView, surface: nextSurface };
}
