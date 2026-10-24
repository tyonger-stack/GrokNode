import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "acorn";
import { full } from "acorn-walk";
import { desktopCoreRuntimeSource } from "./desktop-core-runtime-0721.mjs";
import { bundleUpstreamModule } from "./upstream-module.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mainPath = "dist/electron-main/main-app.cjs";
const corePath = "dist/electron-main/main-core.cjs";
export const notificationNativePin = Object.freeze({
  path: "dist/deps/sand-notification-settings/build/Release/sand_notification_settings.node",
  sha256: "ca769adb52b1ae6bf96c0c7625dd4f2c31c1eab9a25d07a32b5cf565840006ed",
  asarDeclaredSha256: "e2ab6519cb76945eb7750f5271cbf967e63b5e7eddbc11e2329366869f466671",
  bytes: 102368,
});

async function helpers(directory) {
  let base = directory === undefined ? new URL("./", import.meta.url) : pathToFileURL(`${path.resolve(directory)}/`);
  const [{ openUpstream0755 }, { extractUpstreamDeclarations }] = await Promise.all([
    import(new URL("upstream-0755.mjs", base)), import(new URL("upstream-declarations.mjs", base)),
  ]);
  return { openUpstream0755, extractUpstreamDeclarations };
}

function extractInitialized(extract, code, exports, initialBindings = {}) {
  const ast = parse(code, { ecmaVersion: "latest", sourceType: "module" });
  const assignments = new Map();
  full(ast, (node) => {
    if (node.type !== "AssignmentExpression" || node.operator !== "=" || node.left.type !== "Identifier") return;
    const entries = assignments.get(node.left.name) ?? [];
    entries.push(node);
    assignments.set(node.left.name, entries);
  });
  const bindings = { ...initialBindings };
  const initializers = [];
  for (;;) {
    const result = extract({ code, exports, bindings });
    let changed = false;
    for (const unit of result.provenance) {
      if (unit.kind !== "VariableDeclarator" || unit.bindings.length !== 1) continue;
      const name = unit.bindings[0];
      if (code.slice(unit.start, unit.end) !== name) continue;
      const candidates = assignments.get(name) ?? [];
      if (candidates.length !== 1) throw new Error(`Expected one initializer for ${name}, found ${candidates.length}`);
      const assignment = candidates[0];
      bindings[name] = code.slice(assignment.right.start, assignment.right.end);
      initializers.push({ binding: name, start: assignment.start, end: assignment.end,
        sha256: digest(code.slice(assignment.start, assignment.end)) });
      changed = true;
    }
    if (!changed) {
      const unresolved = result.unresolved.filter((name) => name !== "ports" && name !== "core");
      if (unresolved.length) throw new Error(`Unresolved desktop dependencies: ${unresolved.join(", ")}`);
      return { ...result, initializers };
    }
  }
}

function factoryBody(extraction, exports) {
  const ast = parse(extraction.code, { ecmaVersion: "latest", sourceType: "module" });
  const end = ast.body.at(-1);
  if (end.type !== "ExportNamedDeclaration") throw new Error("Missing transplant export declaration");
  return `${extraction.code.slice(0, end.start)}\nreturn {${Object.entries(exports).map(([key, value]) => `${JSON.stringify(key)}:${value}`).join(",")}};`;
}

function desktopCatalogs(input, code) {
  const ids = new Set();
  const ast = parse(code, { ecmaVersion: "latest", sourceType: "module" });
  const descriptors = new Map();
  full(ast, (node) => {
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init?.type === "ObjectExpression") {
      descriptors.set(node.id.name, node.init);
    }
  });
  full(ast, (node) => {
    if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.property.name !== "_") return;
    const argument = node.arguments[0];
    const descriptor = argument?.type === "Identifier" ? descriptors.get(argument.name) : argument;
    if (descriptor?.type !== "ObjectExpression") throw new Error("Unsupported desktop translation descriptor");
    const id = descriptor.properties.find((property) => property.key?.name === "id");
    if (typeof id?.value?.value === "string") ids.add(id.value.value);
  });
  return Object.fromEntries(["en", "zh-CN"].map((locale) => {
    const source = input.read(locale === "en" ? corePath : `dist/electron-main/locales/${locale}/messages.cjs`).toString("utf8");
    const messages = {};
    full(parse(source, { ecmaVersion: "latest", sourceType: "module" }), (node) => {
      if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" ||
          node.callee.object.name !== "JSON" || node.callee.property.name !== "parse") return;
      const argument = node.arguments[0];
      const json = argument?.type === "TemplateLiteral" && argument.expressions.length === 0
        ? argument.quasis[0].value.cooked : argument?.value;
      if (typeof json !== "string") return;
      const catalog = JSON.parse(json);
      for (const id of ids) {
        if (!Object.hasOwn(catalog, id)) continue;
        const value = catalog[id];
        if (!Array.isArray(value) || !value.every((part) => typeof part === "string" || (Array.isArray(part) && part.length === 1 && typeof part[0] === "string"))) {
          throw new Error(`Unsupported desktop catalog interpolation: ${locale}/${id}`);
        }
        messages[id] = value;
      }
    });
    for (const id of ids) if (!Object.hasOwn(messages, id)) throw new Error(`Missing desktop translation: ${locale}/${id}`);
    return [locale, messages];
  }));
}

export async function generateDesktop0721Module({ outputFile, upstream, helpersDir } = {}) {
  if (!outputFile) throw new TypeError("outputFile is required");
  const { openUpstream0755, extractUpstreamDeclarations } = await helpers(helpersDir);
  const input = upstream ?? await openUpstream0755();
  const coreRuntime = `const module = {exports:{}};\nconst exports = module.exports;\n${desktopCoreRuntimeSource(input.read(corePath).toString("utf8"))}`;
  const coreExports = { defaultPreferences: "eh", isPreferences: "Lj", createRetryPolicy: "OR", realClock: "ae", RetryExhaustedError: "fc" };
  const core = extractInitialized(extractUpstreamDeclarations, input.read(corePath).toString("utf8"), coreExports, { performance: "globalThis.performance" });
  const exports = { startMenubarTray: "QJn", createRoster: "Dvt", loadNative: "VC", parsePermission: "XJn",
    mapPermission: "e6n", readPermission: "zC", createPermission: "hIt", composePermission: "bIt", showProbe: "L6n" };
  const translations = "({i18n:{_:ports.translate}})";
  const invariant = "({invariant:(value,message)=>{if(!value)throw new Error(typeof message==='function'?message():message)}})";
  const bindings = {
    Zi: "ports.electron", RK: "ports.electron", Jh: "ports.electron",
    Mge: "({reportDesktopEdgeFailure:ports.reportFailure})", HCt: "({reportDesktopEdgeFailure:ports.reportFailure})",
    Ffe: "({reportDesktopEdgeFailure:ports.reportFailure})",
    $ae: "({captureSandSentryWarning:(area,detail)=>ports.reportFailure(area,'warning',new Error(detail))})",
    Pge: "({errorLogTag:error=>error instanceof Error?error.name:'UnknownError'})",
    Oge: "({isUnknownRecord:value=>typeof value==='object'&&value!==null&&!Array.isArray(value)})",
    Lkt: "({rosterPhotoImageSrc:photo=>ports.rosterPhotoUrl(photo.key)})",
    Tkt: "({rosterPhotoImageSrc:photo=>ports.rosterPhotoUrl(photo.key)})",
    OK: translations, xkt: translations, MK: translations, Fge: translations, XK: translations,
    Nkt: "({realClock:ports.clock??core.realClock})", Ikt: "({realClock:ports.clock??core.realClock})",
    TC: "core", kIt: "({SandDomainError:Error})",
    PK: invariant, SJn: "ports.loadNotificationNative", ZJn: "(name)=>ports.loadNotificationNative(name)",
    Bkt: "({default:require('node:path')})",
    Request: "globalThis.Request", vJn: "5",
  };
  const main = extractInitialized(extractUpstreamDeclarations, input.read(mainPath).toString("utf8"), exports, bindings);
  const catalogs = desktopCatalogs(input, main.code);
  const code = `"use strict";\nconst nodeRequire = require;\nexports.desktopCatalogs = ${JSON.stringify(catalogs)};\nexports.createDesktop0721Upstream = function(ports) {\nfunction require(name) {\nreturn name === "electron" ? ports.electron : name === "original-fs" ? nodeRequire("node:fs") : nodeRequire(name);\n}\n(()=>{\nconst __import_meta_url = require("node:url").pathToFileURL(__filename).href;\nconst savedElectronVersion = process.versions.electron;\nif (savedElectronVersion === undefined) process.versions.electron = "0.0.0";\ntry {\n${coreRuntime}\n} finally {\nif (savedElectronVersion === undefined) delete process.versions.electron;\n}\n})();\nconst core = (()=>{\n${factoryBody(core, coreExports)}\n})();\nconst main = (()=>{\n${factoryBody(main, exports)}\n})();\nreturn {...main,defaultPreferences:core.defaultPreferences,isPreferences:core.isPreferences};\n};\n`;
  const manifest = { upstream: input.identity, outputSha256: digest(code),
    sources: [{ path: corePath, ...core }, { path: mainPath, ...main }].map(({ code: ignored, ...record }) => record),
    artifacts: input.provenance() };
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, code);
  await writeFile(`${outputFile}.provenance.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return { outputFile, manifest };
}

export async function stageDesktop0721Resources({ outputDir, upstream, helpersDir, notificationNativePath } = {}) {
  if (!outputDir) throw new TypeError("outputDir is required");
  const { openUpstream0755 } = await helpers(helpersDir);
  const input = upstream ?? await openUpstream0755();
  const paths = input.files.filter((entry) =>
    /^dist\/electron-main\/menubar-tray\/assets\/[^/]+\.png$/.test(entry) ||
    ["dist/deps/sand-notification-settings/package.json", "dist/deps/sand-notification-settings/index.js"].includes(entry));
  if (!paths.some((entry) => entry.endsWith("/brand.png")) || !paths.some((entry) => entry.endsWith("/working.png"))) {
    throw new Error("Missing upstream tray assets");
  }
  const files = [];
  for (const relative of paths) {
    const bytes = input.read(relative);
    const destination = path.join(outputDir, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    files.push({ path: relative, bytes: bytes.length, sha256: digest(bytes) });
  }
  const bytes = notificationNativePath === undefined
    ? await input.readNative(notificationNativePin.path) : await readFile(notificationNativePath);
  if (digest(bytes) !== notificationNativePin.sha256 || bytes.length !== notificationNativePin.bytes) {
    throw new Error("Notification native snapshot checksum mismatch");
  }
  const destination = path.join(outputDir, notificationNativePin.path);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  files.push(notificationNativePin);
  const manifest = { upstream: input.identity, files };
  await writeFile(path.join(outputDir, "desktop-0721-resources.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function generateDesktop0721RulesModule({ outputFile, upstream, helpersDir } = {}) {
  if (!outputFile) throw new TypeError("outputFile is required");
  const { openUpstream0755 } = await helpers(helpersDir);
  const input = upstream ?? await openUpstream0755();
  const commonPath = "dist/renderer/assets/index.eager-common-F4Y1-gMW.js";
  const vendorPath = "dist/renderer/assets/index.eager-vendor-CRCbzhle.js";
  const panelPath = "dist/renderer/assets/chunk-view-Csdcxtbd.js";
  const entryPath = "dist/renderer/assets/rules-0755-entry.js";
  const entry = `import {RulesEditor} from "./chunk-view-Csdcxtbd.js";
import {a as editRule,c as instructionList,d as sameRule,i as behaviors,l as deleteRule,o as groupRules,s as isAtCap,u as findRule} from "./chunk-general-pane-C6f-EusD.js";
const operations={editRule,instructionList,sameRule,behaviors,deleteRule,groupRules,isAtCap,findRule};
function createPersonalRulesEditor(adapters){globalThis.__sandRulesReact=adapters.React;globalThis.__sandRulesJsx=adapters.jsxRuntime;globalThis.__sandRulesLingui=adapters.useLingui;return function PersonalRulesEditor(props){return adapters.jsxRuntime.jsx(RulesEditor,{...props,rulesInEffect:props.rulesInEffect??{kind:"none"},teamRules:{allowInstructions:[],blockInstructions:[]}});};}
export {operations,createPersonalRulesEditor};\n`;
  const archive = { ...input, read(relative) {
    if (relative === entryPath) return Buffer.from(entry);
    let source = input.read(relative).toString("utf8");
    if (relative === commonPath) {
      source = source.replace("ot as At", "sandRulesReact as At").replace("it as jt", "sandRulesJsx as jt");
      source = `function sandRulesReact(){return globalThis.__sandRulesReact}\nfunction sandRulesJsx(){return globalThis.__sandRulesJsx}\n${source}`;
    }
    if (relative === vendorPath) {
      source = source.replace("fx as nt", "sandRulesLingui as nt");
      source = `function sandRulesLingui(){return globalThis.__sandRulesLingui()}\n${source}`;
    }
    if (relative === panelPath) source = `export {Z as RulesEditor};\n${source}`;
    return Buffer.from(source);
  } };
  const bundled = await bundleUpstreamModule({ archive, entry: entryPath,
    exports: ["operations", "createPersonalRulesEditor"], bindings: {
      CSS: "globalThis.CSS", DOMRect: "globalThis.DOMRect", Element: "globalThis.Element",
      Event: "globalThis.Event", FocusEvent: "globalThis.FocusEvent",
      HTMLAnchorElement: "globalThis.HTMLAnchorElement", HTMLInputElement: "globalThis.HTMLInputElement",
      HTMLTextAreaElement: "globalThis.HTMLTextAreaElement", HTMLElement: "globalThis.HTMLElement",
      Image: "globalThis.Image", IntersectionObserver: "globalThis.IntersectionObserver",
      KeyboardEvent: "globalThis.KeyboardEvent", MouseEvent: "globalThis.MouseEvent",
      MutationObserver: "globalThis.MutationObserver", Node: "globalThis.Node",
      ResizeObserver: "globalThis.ResizeObserver", ShadowRoot: "globalThis.ShadowRoot",
      __REACT_DEVTOOLS_GLOBAL_HOOK__: "globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__",
      cancelAnimationFrame: "globalThis.cancelAnimationFrame", document: "globalThis.document",
      getComputedStyle: "globalThis.getComputedStyle", navigator: "globalThis.navigator",
      performance: "globalThis.performance", requestAnimationFrame: "globalThis.requestAnimationFrame",
      reportError: "globalThis.reportError", window: "globalThis.window",
    } });
  const code = [
    'import * as __rulesReact from "react";',
    'import * as __rulesJsx from "react/jsx-runtime";',
    "globalThis.__sandRulesReact=__rulesReact;",
    "globalThis.__sandRulesJsx=__rulesJsx;",
    bundled.code,
    "",
  ].join("\n");
  const manifest = { upstream: input.identity, outputSha256: digest(code),
    artifacts: input.provenance(), modules: bundled.modules };
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, code);
  await writeFile(`${outputFile}.provenance.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return { outputFile, manifest };
}

