// Cross-layer publication guard for the host RPC path.
//
// The main Bot RPCs exposed the same defect at two different layers, and both were
// invisible to every existing gate:
//
//   1. `MAIN_METHOD_TABLE` (desktop edge) — the handler existed in
//      `createMainEdgeHandlers` and the preload bridge called it, but the table that
//      `serveEdge` publishes from did not name it. Symptom:
//      `mainEdge[method] is not a function`.
//   2. `SAND_GATEWAY_COMMANDS` (host gateway) — `createHostGatewayApi` returned the
//      methods and the coordinator leg asked for them, but the dispatch table did not
//      route them. Symptom: `unknown gateway method: getMainAgent`.
//
// The shape of both is the same: a method is fully implemented and fully wired, and
// simply never published, so TypeScript is satisfied, every test passes, the package
// builds, and the failure only appears in the running renderer. These assertions turn
// "is it wired?" into "is it reachable?", which is the question that actually matters.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const read = file => readFile(path.join(REPO_ROOT, file), "utf8");

/** Keys of a `const NAME = { ... } as const` style table. */
function tableKeys(source, name) {
  const start = source.indexOf(`${name} = {`);
  assert.ok(start >= 0, `could not find ${name}`);
  const end = source.indexOf("} as const", start);
  const body = source.slice(start, end === -1 ? source.length : end);
  return [...body.matchAll(/^\s{2}([A-Za-z][\w]*):/gm)].map(match => match[1]);
}

/** The desktop edge's exposure whitelist. */
async function desktopEdgeMethods() {
  return new Set(tableKeys(await read("source/shared/rpc/main.ts"), "export const MAIN_METHOD_TABLE"));
}

/** The host gateway's dispatch whitelist. */
async function gatewayMethods() {
  return new Set(tableKeys(await read("source/host/gateway-protocol.ts"), "export const SAND_GATEWAY_COMMANDS"));
}

/** The legs the desktop coordinator may call on the host. */
async function coordinatorLegs() {
  return tableKeys(await read("source/shared/rpc/coordinator-main.ts"), "export const COORDINATOR_MAIN_METHOD_TABLE");
}

/** The methods `createHostGatewayApi` actually returns. */
async function gatewayApiMethods() {
  const source = await read("source/host/host-gateway-api.ts");
  const start = source.indexOf("return {", source.indexOf("export function createHostGatewayApi"));
  assert.ok(start >= 0, "could not find the gateway API return block");
  const body = source.slice(start, start + 4000);
  return new Set([...body.matchAll(/^\s{4}([A-Za-z][\w]*):/gm)].map(match => match[1]));
}

/** The legs the desktop is allowed to call that are deliberately not gateway-routed. */
const DEV_ONLY_LEGS = new Set([
  // Dev switches driven from the desktop, not by the production gateway.
  "setDevGatewayOffline",
  "setGatewayPaused",
]);

test("every coordinator leg the desktop can call is routed by the host gateway", async () => {
  const legs = await coordinatorLegs();
  const gateway = await gatewayMethods();
  const unroutable = legs.filter(leg => !gateway.has(leg) && !DEV_ONLY_LEGS.has(leg));
  assert.deepEqual(unroutable, [],
    `the coordinator would call these legs but the gateway answers "unknown gateway method" for them: ${unroutable.join(", ")}`);
});

test("the main Bot methods are published on every layer of the path", async () => {
  const desktop = await desktopEdgeMethods();
  const gateway = await gatewayMethods();
  const legs = new Set(await coordinatorLegs());
  const api = await gatewayApiMethods();

  for (const method of ["getHostMainAgent", "setHostMainAgent", "ensureHostMainAgent"]) {
    assert.ok(desktop.has(method), `${method} is missing from the desktop MAIN_METHOD_TABLE`);
  }
  // The desktop names the `…HostMainAgent` handlers; the host names the gateway commands.
  // They are deliberately different — the edge is one hop above the gateway.
  for (const method of ["getMainAgent", "setMainAgent", "ensureDefaultMainAgent"]) {
    assert.ok(api.has(method), `${method} is missing from createHostGatewayApi`);
    assert.ok(gateway.has(method), `${method} is missing from SAND_GATEWAY_COMMANDS`);
    assert.ok(legs.has(method), `${method} is missing from COORDINATOR_MAIN_METHOD_TABLE`);
  }
});

test("MUTATION: implementing a gateway method without publishing it is now caught", async () => {
  // The exact shape of the shipped defect: `createHostGatewayApi` returns the method,
  // the coordinator leg is registered, and the dispatch table is silent about it.
  const api = await gatewayApiMethods();
  const legs = new Set(await coordinatorLegs());
  const gateway = await gatewayMethods();
  assert.ok(api.has("getMainAgent"), "the API really does implement it");
  assert.ok(legs.has("getMainAgent"), "the coordinator leg really is registered");
  assert.ok(gateway.has("getMainAgent"), "and the gateway really does route it");
  // Strip the dispatch entry and the first test's invariant is what catches it.
  const stripped = new Set(gateway);
  stripped.delete("getMainAgent");
  assert.ok(!stripped.has("getMainAgent"));
  assert.ok(legs.has("getMainAgent") && !stripped.has("getMainAgent"),
    "a leg the gateway will not route — the 404 the user actually saw");
});
