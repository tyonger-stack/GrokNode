import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "acorn";
import { full } from "acorn-walk";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mainPath = "dist/electron-main/main-app.cjs";
const corePath = "dist/electron-main/main-core.cjs";
export const notificationNativePin = Object.freeze({
  path: "dist/deps/sand-notification-settings/build/Release/sand_notification_settings.node",
  sha256: "3e58c2e52be30df6f4e3a357331e44cac4529c6aa02b2e81338432d49c6615ac",
  asarDeclaredSha256: "c002fd02246453816c69ac309ea5f24f6913d7f153ac197efebc31eb3d9a2047",
  bytes: 102336,
});

async function helpers(directory) {
  let base = directory === undefined ? new URL("./", import.meta.url) : pathToFileURL(`${path.resolve(directory)}/`);
  const [{ openUpstream0721 }, { extractUpstreamDeclarations }] = await Promise.all([
    import(new URL("upstream-0721.mjs", base)), import(new URL("upstream-declarations.mjs", base)),
  ]);
  return { openUpstream0721, extractUpstreamDeclarations };
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
  const { openUpstream0721, extractUpstreamDeclarations } = await helpers(helpersDir);
  const input = upstream ?? await openUpstream0721();
  const coreExports = { defaultPreferences: "J_", isPreferences: "xj", createRetryPolicy: "vR", realClock: "ae", RetryExhaustedError: "fc" };
  const core = extractInitialized(extractUpstreamDeclarations, input.read(corePath).toString("utf8"), coreExports, { performance: "globalThis.performance" });
  const exports = { startMenubarTray: "cJn", createRoster: "jCt", loadNative: "CC", parsePermission: "EJn",
    mapPermission: "vJn", readPermission: "kC", createPermission: "IIt", composePermission: "MIt", showProbe: "a6n" };
  const translations = "({i18n:{_:ports.translate}})";
  const invariant = "({invariant:(value,message)=>{if(!value)throw new Error(typeof message==='function'?message():message)}})";
  const bindings = {
    Zi: "ports.electron", RK: "ports.electron", Jh: "ports.electron",
    Mge: "({reportDesktopEdgeFailure:ports.reportFailure})", HCt: "({reportDesktopEdgeFailure:ports.reportFailure})",
    Pge: "({errorLogTag:error=>error instanceof Error?error.name:'UnknownError'})",
    Oge: "({isUnknownRecord:value=>typeof value==='object'&&value!==null&&!Array.isArray(value)})",
    Lkt: "({rosterPhotoImageSrc:photo=>ports.rosterPhotoUrl(photo.key)})",
    OK: translations, xkt: translations, MK: translations, Fge: translations,
    Nkt: "({realClock:ports.clock??core.realClock})", TC: "core", kIt: "({SandDomainError:Error})",
    PK: invariant, ekt: invariant, SJn: "ports.loadNotificationNative", Bkt: "({default:require('node:path')})",
    Request: "globalThis.Request",
  };
  const main = extractInitialized(extractUpstreamDeclarations, input.read(mainPath).toString("utf8"), exports, bindings);
  const catalogs = desktopCatalogs(input, main.code);
  const code = `"use strict";\nexports.desktopCatalogs = ${JSON.stringify(catalogs)};\nexports.createDesktop0721Upstream = function(ports) {\nconst core = (()=>{\n${factoryBody(core, coreExports)}\n})();\nconst main = (()=>{\n${factoryBody(main, exports)}\n})();\nreturn {...main,defaultPreferences:core.defaultPreferences,isPreferences:core.isPreferences};\n};\n`;
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
  const { openUpstream0721 } = await helpers(helpersDir);
  const input = upstream ?? await openUpstream0721();
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
  const { openUpstream0721, extractUpstreamDeclarations } = await helpers(helpersDir);
  const input = upstream ?? await openUpstream0721();
  const operationsPath = "dist/renderer/assets/chunk-general-pane-DfO6XZcq.js";
  const panelPath = "dist/renderer/assets/chunk-view-C9fWByH0.js";
  const operationsExports = { isAtCap: "It", findRule: "Ft", groupRules: "Mt", sameRule: "Pt", behaviors: "jt", listRules: "Dt", editRule: "Lt", deleteRule: "Nt" };
  const operations = extractInitialized(extractUpstreamDeclarations, input.read(operationsPath).toString("utf8"), operationsExports);
  const bindings = {
    U: "ports.compilerRuntime", W: "ports.React", G: "ports.jsxRuntime", T: "ports.useLingui",
    a: "ports.Button", c: "ports.IconButton", t: "ports.Text", n: "ports.Tooltip", C: "ports.Icon",
    w: "ports.Trans", D: "ports.styles", l: "ports.controlStyles", N: "1000",
    I: "ports.operations.groupRules", F: "ports.operations.findRule", B: "ports.operations.editRule",
    V: "ports.operations.deleteRule", L: "ports.operations.sameRule", R: "ports.operations.behaviors",
    z: "ports.operations.listRules", P: "ports.operations.isAtCap",
  };
  const panel = extractInitialized(extractUpstreamDeclarations, input.read(panelPath).toString("utf8"), { RulesEditor: "J" }, bindings);
  const code = `export const operations = (()=>{${factoryBody(operations, operationsExports)}})();\nexport function createPersonalRulesEditor(adapters) {\nconst ports = {...adapters,operations};\nconst {RulesEditor} = (()=>{${factoryBody(panel, { RulesEditor: "J" })}})();\nreturn function PersonalRulesEditor(props) { return ports.jsxRuntime.jsx(RulesEditor,{...props,teamRules:{allowInstructions:[],blockInstructions:[]}}); };\n}\n`;
  const manifest = { upstream: input.identity, outputSha256: digest(code),
    sources: [{ path: operationsPath, ...operations }, { path: panelPath, ...panel }].map(({ code: ignored, ...record }) => record) };
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, code);
  await writeFile(`${outputFile}.provenance.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return { outputFile, manifest };
}

