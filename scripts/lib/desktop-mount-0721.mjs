import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import { simple, ancestor } from "acorn-walk";
import { transform } from "esbuild";
import { openUpstream0721 } from "./upstream-0721.mjs";
import { extractUpstreamDeclarations } from "./upstream-declarations.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const panel = "src/electron-renderer/desktop-mount/panel/panel.html";
const overlay = "src/electron-renderer/desktop-mount/capture-overlay/capture-overlay.html";

function extractInitialized(code, exports, bindings = {}) {
  const ast = parse(code, { ecmaVersion: "latest" });
  const declarations = new Map();
  const assignments = new Map();
  for (const node of ast.body) {
    if (node.type !== "VariableDeclaration") continue;
    for (const declaration of node.declarations) declarations.set(declaration.start, declaration);
  }
  ancestor(ast, { AssignmentExpression(node, parents) {
    if (node.operator !== "=" || node.left.type !== "Identifier") return;
    const functions = parents.filter((parent) => /Function/.test(parent.type));
    if (functions.length !== 1 || functions[0].type !== "ArrowFunctionExpression") return;
    const parent = parents[parents.indexOf(functions[0]) - 1];
    if (parent?.type !== "CallExpression" || !["I", "N"].includes(parent.callee.name)) return;
    const list = assignments.get(node.left.name) ?? [];
    list.push(node);
    assignments.set(node.left.name, list);
  } });
  const replacements = { performance: 'require("node:perf_hooks").performance', ...bindings };
  const initializers = [];
  for (let round = 0; round < 30; round++) {
    const result = extractUpstreamDeclarations({ code, exports, bindings: replacements, strict: true });
    const empty = result.provenance.filter((entry) => {
      const declaration = declarations.get(entry.start);
      return declaration && declaration.init === null && assignments.has(declaration.id.name);
    });
    if (empty.length === 0) return { ...result, initializers };
    for (const entry of empty) {
      const [name] = entry.bindings;
      const candidates = assignments.get(name) ?? [];
      if (candidates.length !== 1) throw new Error(`Ambiguous upstream initializer ${name}: ${candidates.length}`);
      const assignment = candidates[0];
      replacements[name] = code.slice(assignment.right.start, assignment.right.end);
      initializers.push({ binding: name, start: assignment.start, end: assignment.end,
        sha256: digest(code.slice(assignment.start, assignment.end)) });
    }
  }
  throw new Error("Upstream initializer closure did not converge");
}

export async function stageDesktopMount0721({ distRoot, asarPath } = {}) {
  if (!distRoot || !path.isAbsolute(distRoot)) throw new TypeError("distRoot must be absolute");
  const upstream = await openUpstream0721(asarPath === undefined ? {} : { asarPath });
  const coreCode = upstream.read("dist/electron-main/main-core.cjs").toString("utf8");
  const appCode = upstream.read("dist/electron-main/main-app.cjs").toString("utf8");
  const core = extractInitialized(coreCode, {
    rpcObject: "LB", rpcString: "PB", rpcUint8Array: "UB", rpcOptional: "NB",
    createTaskBoundaryPolicy: "Pa", ipcMainTransport: "tB", parseAgentId: "Na",
    invariant: "Ze", isUnknownRecord: "k", errorLogTag: "Nt", writeFileAtomicSync: "rn",
  });
  const app = extractInitialized(appCode, {
    createMount: "wet", createCapture: "ftt", createPicker: "att", createCaptureService: "ctt",
    createPositionStore: "Uet", createCaptureGate: "Get", createHotkey: "Vet",
    isCaptureSupported: "Fet", loadNative: "ltt", serveEdge: "kl", mountEdge: "uet",
  }, {
    _c: '() => require("@desktop/core")', NV: '() => require("@desktop/core")',
    LGe: '() => require("@desktop/core")',
    qr: '() => require("@desktop/core")', vn: '() => require("@desktop/core")',
    be: '() => require("@desktop/core")', Ot: '() => require("@desktop/core")',
    xe: '() => require("@desktop/core")', Fr: '() => require("@desktop/core")',
    co: '() => require("@desktop/report")', xw: '() => ({PRELOAD_DIST_DIR: require("@desktop/paths").preloadRoot})',
    E: 'require("@desktop/zod")',
    okn: 'require("@desktop/paths").panelDocument', kkn: 'require("@desktop/paths").overlayDocument',
    Nkn: 'require("@desktop/nativeRequire")',
  });
  const coreCjs = (await transform(core.code, { format: "cjs", target: "node26" })).code;
  const appCjs = (await transform(app.code, { format: "cjs", target: "node26" })).code;
  const artifact = `"use strict";
const nodeRequire = require;
module.exports.createUpstream = function(ports) {
  let core;
  const require = (name) => {
    if (name === "electron") return ports.electron;
    if (name === "@desktop/core") return {...core, ipcMainTransport: (config) => core.ipcMainTransport({...config,
      broadcast: (channel, value) => {
        config.broadcast(channel, value);
        if (channel === "dune-rpc:desktop-mount:e:prompt-submitted") ports.onPromptSubmitted(value);
      }
    })};
    if (name === "@desktop/report") return {captureSandSentryWarning: ports.reportWarning};
    if (name === "@desktop/paths") return ports;
    if (name === "@desktop/zod") return ports.zod;
    if (name === "@desktop/nativeRequire") return ports.nativeRequire;
    return nodeRequire(name);
  };
  core = (() => { const module = {exports:{}}; ${coreCjs}\nreturn module.exports; })();
  return (() => { const module = {exports:{}}; ${appCjs}\nreturn module.exports; })();
};
`;
  const generatedPath = path.join(distRoot, "electron-main/desktop-mount/upstream-0721.cjs");
  const outputs = [];
  async function emit(destination, bytes) {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    outputs.push({ path: path.relative(distRoot, destination), bytes: Buffer.byteLength(bytes), sha256: digest(bytes) });
  }
  await emit(generatedPath, artifact);
  const rendererRoot = path.join(distRoot, "renderer/upstream-0721");
  const pending = [panel, overlay];
  const visited = new Set();
  function enqueue(from, specifier) {
    if (/^(?:data:|https?:|#)/.test(specifier)) return;
    const relative = specifier.startsWith("/") ? specifier.slice(1)
      : path.posix.join(path.posix.dirname(from), specifier);
    if (relative.startsWith("../")) throw new Error(`Renderer dependency escapes root: ${specifier}`);
    pending.push(relative.split(/[?#]/)[0]);
  }
  while (pending.length) {
    const relative = pending.shift();
    if (visited.has(relative)) continue;
    visited.add(relative);
    const bytes = upstream.read(`dist/renderer/${relative}`);
    const text = bytes.toString("utf8");
    if (relative.endsWith(".html")) {
      for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) enqueue(relative, match[1]);
    } else if (relative.endsWith(".js")) {
      simple(parse(text, { ecmaVersion: "latest", sourceType: "module" }), {
        ImportDeclaration(node) { enqueue(relative, node.source.value); },
        ExportNamedDeclaration(node) { if (node.source) enqueue(relative, node.source.value); },
        ExportAllDeclaration(node) { enqueue(relative, node.source.value); },
        ImportExpression(node) { if (node.source.type === "Literal") enqueue(relative, node.source.value); },
      });
    } else if (relative.endsWith(".css")) {
      for (const match of text.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g)) enqueue(relative, match[1]);
    }
    await emit(path.join(rendererRoot, relative), bytes);
  }
  const preloadRoot = path.join(distRoot, "electron-preload");
  for (const name of ["panel", "capture-overlay"]) {
    const relative = `dist/electron-preload/preload-desktop-mount-${name}.cjs`;
    await emit(path.join(preloadRoot, path.basename(relative)), upstream.read(relative));
  }
  for (const name of ["package.json", "index.js", "build/Release/sand_window_capture.node"]) {
    const relative = `dist/deps/sand-window-capture/${name}`;
    await emit(path.join(distRoot, "deps/sand-window-capture", name), name.endsWith(".node")
      ? await upstream.readNative(relative) : upstream.read(relative));
  }
  const provenancePath = path.join(distRoot, "electron-main/desktop-mount/provenance-0721.json");
  const provenance = { identity: upstream.identity, inputs: upstream.provenance(), outputs,
    core: { ...core, code: undefined }, app: { ...app, code: undefined } };
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + "\n");
  return { generatedPath, rendererRoot, preloadRoot, provenancePath,
    nativeRoot: path.join(distRoot, "deps/sand-window-capture") };
}

