import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
const compiled = await build({ entryPoints: ['source/electron-main/library-canvas-protocol.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const url = 'sand-canvas://frame/user/123e4567-e89b-42d3-a456-426614174000?theme=dark&rev=2';
const payload = { renderBundleGzip: gzipSync(JSON.stringify({version:1,runtimeEsm:'export function mountCanvas() {}',userModule:'export default 42'})), dataJson: Buffer.from('{"x":"</script>"}') };
test('protocol validates URLs, bounded payloads, cancellations and bridge failures', async () => {
 const handler = api.createLibraryCanvasHandler(async () => payload);
 assert.equal((await handler(new Request(url))).status,200);
 assert.equal((await handler(new Request('sand-canvas://frame/bad'))).status,400);
 assert.equal((await api.createLibraryCanvasHandler(async()=>{throw new Error('ACL denied')})(new Request(url))).status,404);
 assert.equal((await api.createLibraryCanvasHandler(async()=>({...payload,renderBundleGzip:Uint8Array.of(0)}))(new Request(url))).status,422);
 assert.equal((await handler(new Request(url,{signal:AbortSignal.abort()}))).status,499);
 const response=await handler(new Request(url)); const html=await response.text();
 assert.match(html,/runtimeModule.mountCanvas\(userUrl\)/); assert.match(html,/__cursorCanvas/);
 assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 assert.match(response.headers.get('content-security-policy'),/sandbox allow-scripts/);
 assert.doesNotMatch(html,/<\/script>"/);
});
test('two-stage registration has teardown and authenticated coordinator byte decoding',async()=>{
 const calls=[]; let callback;
 api.registerLibraryCanvasScheme({registerSchemesAsPrivileged:x=>calls.push(x)});
 const service=api.registerLibraryCanvasProtocol({handle:(name,fn)=>{calls.push(name);callback=fn},unhandle:name=>calls.push('unhandle:'+name)},async()=>payload);
 assert.equal(calls[0][0].scheme,'sand-canvas'); assert.equal((await callback(new Request(url))).status,200);
 service.dispose(); assert.equal(calls.at(-1),'unhandle:sand-canvas');
 const legs={libraryMainCredential:async()=> 'issued-test-credential',getCanvasPayload:async args=>{assert.equal(args.credential,'issued-test-credential');return {renderBundleGzip:{$b64:payload.renderBundleGzip.toString('base64')},dataJson:{$b64:payload.dataJson.toString('base64')}}}};
 const read=api.createLibraryCanvasBridge(legs);
 assert.deepEqual(await read({locator:{kind:'active-user-store',canvasId:'123e4567-e89b-42d3-a456-426614174000'},theme:'dark'},new AbortController().signal),{renderBundleGzip:new Uint8Array(payload.renderBundleGzip),dataJson:new Uint8Array(payload.dataJson)});
});

test("production binding validates ports, guards double registration, and tears down", async () => {
  assert.throws(() => api.createProductionLibraryCanvasBinding({}), /registerSchemesAsPrivileged/);
  assert.throws(() => api.createProductionLibraryCanvasBinding({ protocol: {} }), /registerSchemesAsPrivileged/);
  const calls = [];
  const ports = { protocol: { registerSchemesAsPrivileged: (x) => calls.push(["scheme", x]), handle: (n, fn) => calls.push(["handle", n, fn]), unhandle: (n) => calls.push(["unhandle", n]) } };
  const binding = api.createProductionLibraryCanvasBinding(ports);
  binding.registerScheme();
  assert.throws(() => binding.registerScheme(), /already registered/);
  assert.equal(calls[0][1][0].scheme, "sand-canvas");
  const legs = { libraryMainCredential: async () => "test-credential", getCanvasPayload: async (args) => { assert.equal(args.credential, "test-credential"); return { renderBundleGzip: payload.renderBundleGzip, dataJson: payload.dataJson }; } };
  const registration = binding.register({ coordinatorLegs: { legs } });
  assert.equal(calls[1][1], "sand-canvas");
  assert.equal((await calls[1][2](new Request(url))).status, 200);
  assert.throws(() => binding.register({ coordinatorLegs: { legs } }), /already registered/);
  registration.dispose();
  assert.equal(calls.at(-1)[0], "unhandle");
});

test("service factories create canvas registration from actual adapters", async () => {
  const bundledAdapters = await build({ entryPoints: ["source/electron-main/production-adapters.ts"], bundle: true, platform: "node", format: "esm", write: false, external: ["electron", "undici"] });
  const adaptersApi = await import("data:text/javascript;base64," + Buffer.from(bundledAdapters.outputFiles[0].text).toString("base64"));
  const canvasCalls = [];
  const areas = {
    secureStorage: { initialize: () => {}, getMachineId: async () => "machine" },
    settings: { create: () => ({}) },
    attachmentGateway: { create: () => ({}) },
    avatarImages: { create: () => ({}) },
    localAccount: { create: () => ({}), createTranscriptionManager: () => async () => ({}) },
    mainRpc: { create: () => ({}) },
    updaterInstaller: { create: () => ({}) },
    mediaProtocol: { registerScheme: () => {}, register: () => ({ dispose: () => {} }) },
    canvasProtocol: { registerScheme: () => canvasCalls.push("scheme"), register: () => { canvasCalls.push("register"); return { dispose: () => canvasCalls.push("dispose") }; } },
    accountOAuth: { create: () => ({}) },
    experiments: { create: () => ({}) },
    mcpOAuth: { create: () => ({}) },
    telemetry: { create: () => ({}) },
    notifications: { create: () => ({}) },
    coordinator: { create: () => ({}) },
    ipc: { register: () => ({ dispose: () => {} }) },
  };
  const factories = adaptersApi.createElectronProductionServiceFactories(areas);
  factories.registerLibraryCanvasScheme();
  const registration = factories.registerLibraryCanvas({});
  assert.deepEqual(canvasCalls, ["scheme", "register"]);
  registration.dispose();
  assert.deepEqual(canvasCalls, ["scheme", "register", "dispose"]);
  const missing = { ...areas };
  delete missing.canvasProtocol;
  assert.throws(() => adaptersApi.createElectronProductionServiceFactories(missing), /canvasProtocol/);
});

import { readFile as readActivationEntry } from "node:fs/promises";
test("packaged entry wires canvas builtin with no manifest slot", async () => {
  const entry = await readActivationEntry(new URL("../scripts/electron-main-production-activation.mjs", import.meta.url), "utf8");
  assert.match(entry, /createElectronProductionLibraryCanvasBinding/);
  assert.match(entry, /canvasProtocol: createElectronProductionLibraryCanvasBinding\(\)/);
  assert.equal(entry.includes(`{ path: "adapters.canvasProtocol"`), false);
});
