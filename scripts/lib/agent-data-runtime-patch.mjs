import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { build, transform } from 'esbuild';
import { repoRoot } from './config.mjs';

export const AGENT_DATA_METHODS = ['getAgentDataOverview', 'getAgentMemoryLog', 'getAgentWorkflowContent'];
const keyOf = property => property.type === 'Property' ? property.key.name ?? property.key.value : null;
const astOf = source => parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
function objectContaining(ast, names) {
  const matches = [];
  simple(ast, { ObjectExpression(node) { if (names.every(name => node.properties.some(property => keyOf(property) === name))) matches.push(node); } });
  assert.equal(matches.length, 1, 'Agent data object missing or ambiguous');
  return matches[0];
}
function namedFunction(ast, name) {
  const matches = [];
  simple(ast, { FunctionDeclaration(node) { if (node.id.name === name) matches.push(node); } });
  assert.equal(matches.length, 1, 'Agent data function missing or ambiguous: ' + name);
  return matches[0];
}
function methodTable(ast) {
  const matches = [];
  simple(ast, { VariableDeclarator(node) { if (node.id.name === 'MAIN_METHOD_TABLE') matches.push(node.init); } });
  assert.equal(matches.length, 1, 'Main method table missing or ambiguous');
  assert.equal(matches[0].type, 'ObjectExpression');
  return matches[0];
}
const properties = (source, object) => AGENT_DATA_METHODS.map(name => {
  const property = object.properties.find(property => keyOf(property) === name);
  assert(property, 'Canonical data method missing: ' + name);
  return source.slice(property.start, property.end);
});
function appendProperties(source, object, additions) {
  assert(AGENT_DATA_METHODS.every(name => !object.properties.some(property => keyOf(property) === name)), 'Agent data methods already applied');
  const last = object.properties.at(-1);
  assert(last);
  return source.slice(0, last.end) + ',\n' + additions.join(',\n') + source.slice(last.end);
}
export async function buildAgentDataRuntimePort() {
  const load = async file => (await transform(await readFile(path.join(repoRoot, file), 'utf8'), { loader: 'ts', target: 'node26' })).code;
  const main = await load('source/electron-main/main-edge.ts');
  const preload = await load('source/electron-preload/preload.ts');
  const table = await load('source/shared/rpc/main.ts');
  const mainMethods = properties(main, objectContaining(namedFunction(astOf(main), 'createMainEdgeHandlers'), AGENT_DATA_METHODS)).map(source => source.replace(/\b(readAgentDataOverview|readAgentMemoryLog|readAgentWorkflowContent)(?=\()/g, 'RAgentDataRuntimeReaders.$1'));
  const preloadMethods = properties(preload, objectContaining(namedFunction(astOf(preload), 'createDesktopPreloadBridge'), AGENT_DATA_METHODS));
  const methodDescriptors = properties(table, methodTable(astOf(table)));
  const result = await build({
    stdin: { contents: 'export {readAgentDataOverview,readAgentMemoryLog,readAgentWorkflowContent} from "./source/electron-main/box/agent-data-reader.ts";', resolveDir: repoRoot },
    bundle: true, platform: 'node', format: 'iife', globalName: 'RAgentDataRuntimeReaders', write: false, logLevel: 'silent',
    plugins: [{ name: 'reuse-installed-docker-adapter', setup(builder) {
      builder.onResolve({ filter: /local-docker-host-connector\.js$/ }, () => ({ path: 'existing-docker', namespace: 'agent-data' }));
      builder.onLoad({ filter: /.*/, namespace: 'agent-data' }, () => ({ contents: 'export const LOCAL_DOCKER_BOX_CONTAINER=RAgentDataRuntimeExisting.container;export const runDocker=args=>RAgentDataRuntimeExisting.run(args);' }));
    } }],
  });
  const readerCode = 'const RAgentDataRuntimeExisting={container:LOCAL_DOCKER_BOX_CONTAINER,run:runDocker};\n' + result.outputFiles[0].text;
  return { mainMethods, preloadMethods, methodDescriptors, readerCode };
}
export function patchAgentDataMain(source, port) {
  assert(!source.includes('RAgentDataRuntimeReaders'), 'Agent data main already patched');
  assert(source.includes('function runDocker(') && /\bLOCAL_DOCKER_BOX_CONTAINER\s*=/.test(source), 'Installed Docker adapter missing');
  let ast = astOf(source);
  let patched = appendProperties(source, methodTable(ast), port.methodDescriptors);
  ast = astOf(patched);
  const owner = namedFunction(ast, 'createMainEdgeHandlers');
  patched = appendProperties(patched, objectContaining(owner, ['getAgentOpenRouterEffort']), port.mainMethods) + '\n' + port.readerCode;
  astOf(patched);
  return patched;
}
export function patchAgentDataPreload(source, port) {
  let patched = appendProperties(source, methodTable(astOf(source)), port.methodDescriptors);
  const owner = namedFunction(astOf(patched), 'createDesktopPreloadBridge');
  patched = appendProperties(patched, objectContaining(owner, ['getAgentOpenRouterEffort']), port.preloadMethods);
  astOf(patched);
  return patched;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function applyAgentDataRuntimePort({ stageRoot }) {
  const port = await buildAgentDataRuntimePort(), files = [];
  for (const [file, patch] of [['dist/electron-main/main.cjs', patchAgentDataMain], ['dist/electron-preload/preload.cjs', patchAgentDataPreload]]) {
    const target = path.join(stageRoot, file), source = await readFile(target, 'utf8'), patched = patch(source, port);
    await writeFile(target, patched);
    files.push({ path: file, originalSha256: hash(source), patchedSha256: hash(patched), bytes: Buffer.byteLength(patched) });
  }
  const sourceFiles = ['source/electron-main/box/agent-data-reader.ts', 'source/electron-main/main-edge.ts', 'source/electron-preload/preload.ts', 'source/shared/rpc/main.ts'];
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, hash(await readFile(path.join(repoRoot, file)))])));
  const record = { mode: 'source-derived-agent-data-runtime', methods: AGENT_DATA_METHODS, sourceHashes, files };
  await writeFile(path.join(stageRoot, 'dist/agent-data-runtime-extension.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}
