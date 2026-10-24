import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { build, transform } from 'esbuild';
import { repoRoot } from './config.mjs';

const method = 'importAgentMemory';
const keyOf = property => property.type === 'Property' ? property.key.name ?? property.key.value : null;
const parseSource = source => parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
function owner(ast, name) {
  const matches = [];
  simple(ast, { FunctionDeclaration(node) { if (node.id.name === name) matches.push(node); } });
  assert.equal(matches.length, 1, 'Memory import function missing or ambiguous: ' + name);
  return matches[0];
}
function objectWith(ast, name) {
  const matches = [];
  simple(ast, { ObjectExpression(node) { if (node.properties.some(property => keyOf(property) === name)) matches.push(node); } });
  assert.equal(matches.length, 1, 'Memory import object missing or ambiguous: ' + name);
  return matches[0];
}
function table(ast) {
  const matches = [];
  simple(ast, { VariableDeclarator(node) { if (node.id.name === 'MAIN_METHOD_TABLE') matches.push(node.init); } });
  assert.equal(matches.length, 1, 'Main method table missing or ambiguous');
  return matches[0];
}
const property = (source, object) => {
  const node = object.properties.find(property => keyOf(property) === method);
  assert(node, 'Canonical memory import method missing');
  return source.slice(node.start, node.end);
};
function append(source, object, addition) {
  assert(!object.properties.some(property => keyOf(property) === method), 'Memory import already applied');
  const end = object.properties.at(-1).end;
  return source.slice(0, end) + ',\n' + addition + source.slice(end);
}
export async function buildMemoryImportRuntimePort() {
  const load = async file => (await transform(await readFile(path.join(repoRoot, file), 'utf8'), { loader: 'ts', target: 'node26' })).code;
  const [main, preload, rpc] = await Promise.all(['source/electron-main/main-edge.ts', 'source/electron-preload/preload.ts', 'source/shared/rpc/main.ts'].map(load));
  const mainOwner = owner(parseSource(main), 'createMainEdgeHandlers');
  const mainMethod = property(main, objectWith(mainOwner, method));
  const preloadMethod = property(preload, objectWith(owner(parseSource(preload), 'createDesktopPreloadBridge'), method));
  const descriptor = property(rpc, table(parseSource(rpc)));
  const bundle = await build({ stdin: { contents: 'export {buildImportMemoryPrompt,IMPORT_MEMORY_MAX_CHARS} from "./source/shared/node/agent-memory-import.ts";export {GATEWAY_API_PREFIX,GATEWAY_AUTH_SCHEME} from "./source/shared/gateway-wire.ts";', resolveDir: repoRoot }, bundle: true, platform: 'node', format: 'iife', globalName: 'RMemoryImportRuntime', write: false, logLevel: 'silent' });
  return { mainMethod, preloadMethod, descriptor, parameter: mainOwner.params[0].name, runtime: bundle.outputFiles[0].text };
}
export function patchMemoryImportMain(source, port) {
  assert(!source.includes('RMemoryImportRuntime'), 'Memory import main already applied');
  owner(parseSource(source), 'startLocalDockerBox');
  let patched = append(source, table(parseSource(source)), port.descriptor);
  const mainOwner = owner(parseSource(patched), 'createMainEdgeHandlers');
  assert.equal(mainOwner.params[0].type, 'Identifier');
  const parameterPattern = new RegExp('\\b' + port.parameter + '(?=\\.)', 'g');
  let handler = port.mainMethod.replace(parameterPattern, mainOwner.params[0].name);
  for (const name of ['buildImportMemoryPrompt', 'IMPORT_MEMORY_MAX_CHARS', 'GATEWAY_API_PREFIX', 'GATEWAY_AUTH_SCHEME']) handler = handler.replace(new RegExp('\\b' + name + '\\b', 'g'), 'RMemoryImportRuntime.' + name);
  patched = append(patched, objectWith(mainOwner, 'getAgentOpenRouterEffort'), handler) + '\n' + port.runtime;
  parseSource(patched);
  return patched;
}
export function patchMemoryImportPreload(source, port) {
  let patched = append(source, table(parseSource(source)), port.descriptor);
  const preloadOwner = owner(parseSource(patched), 'createDesktopPreloadBridge');
  patched = append(patched, objectWith(preloadOwner, 'getAgentOpenRouterEffort'), port.preloadMethod);
  parseSource(patched);
  return patched;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function applyMemoryImportRuntimePort({ stageRoot }) {
  const port = await buildMemoryImportRuntimePort(), files = [];
  for (const [file, patch] of [['dist/electron-main/main.cjs', patchMemoryImportMain], ['dist/electron-preload/preload.cjs', patchMemoryImportPreload]]) {
    const target = path.join(stageRoot, file), source = await readFile(target, 'utf8'), patched = patch(source, port);
    await writeFile(target, patched);
    files.push({ path: file, originalSha256: hash(source), patchedSha256: hash(patched), bytes: Buffer.byteLength(patched) });
  }
  const sourceFiles = ['source/electron-main/main-edge.ts', 'source/electron-preload/preload.ts', 'source/shared/rpc/main.ts', 'source/shared/node/agent-memory-import.ts', 'source/shared/gateway-wire.ts'];
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, hash(await readFile(path.join(repoRoot, file)))])));
  const record = { mode: 'source-derived-memory-import-v1', method, sourceHashes, files, hostChanged: false };
  await writeFile(path.join(stageRoot, 'dist/memory-import-runtime-extension.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}
