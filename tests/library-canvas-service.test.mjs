import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const buildModule = async entry => {
  const bundled = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  return import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
};
const [serviceModule, catalogModule] = await Promise.all([
  buildModule("source/host/extensions/library/canvas-service.ts"),
  buildModule("source/host/extensions/library/catalog.ts"),
]);
const { createCanvasService, CANVAS_ACTIVE_USER_STORE_RETRY, CanvasStoreUnavailableError } = serviceModule;
const { LibraryCatalog } = catalogModule;

const origin = "https://library.example.test";
const canvasId = "123e4567-e89b-42d3-a456-426614174000";
const room = "123e4567-e89b-42d3-a456-426614174111";
const missingId = "123e4567-e89b-42d3-a456-426614174001";
const corruptId = "123e4567-e89b-42d3-a456-426614174002";
const mismatchShareId = "123e4567-e89b-42d3-a456-426614174003";
const malformedShareId = "123e4567-e89b-42d3-a456-426614174004";
const echoFailureId = "123e4567-e89b-42d3-a456-426614174005";
const fallbackOtherId = "123e4567-e89b-42d3-a456-426614174006";
const bundleJson = JSON.stringify({ version: 1, runtimeEsm: "export function mount() {}", userModule: "export const value = 1;" });
const renderBundleGzip = gzipSync(Buffer.from(bundleJson, "utf8"));
const signal = () => new AbortController().signal;
const unavailable = () => Object.assign(new Error("canvas object is unavailable"), { canvasObjectUnavailable: true });

function canvasPort(overrides = {}) {
  const calls = {
    listUserCanvases: [],
    getCanvasPayload: [],
    readGroupChatCanvas: [],
    getCanvasMetadata: [],
    setCanvasVisibility: [],
  };
  return {
    calls,
    async listUserCanvases(context) {
      calls.listUserCanvases.push(context.principal.accountId);
      return overrides.listUserCanvases ? overrides.listUserCanvases(calls.listUserCanvases.length) : { storeId: null };
    },
    async getCanvasPayload(args, context) {
      calls.getCanvasPayload.push(args);
      return overrides.getCanvasPayload ? overrides.getCanvasPayload(args, context) : {
        metadata: { storeId: args.storeId, canvasId: args.canvasId },
        renderBundleGzip,
        dataJson: Buffer.from('{"ok":true}', "utf8"),
      };
    },
    async readGroupChatCanvas(args, context) {
      calls.readGroupChatCanvas.push(args);
      return overrides.readGroupChatCanvas ? overrides.readGroupChatCanvas(args, context) : {
        renderBundleGzip,
        dataJson: Buffer.from('{"group":true}', "utf8"),
      };
    },
    async getCanvasMetadata(args, context) {
      calls.getCanvasMetadata.push(args);
      return overrides.getCanvasMetadata ? overrides.getCanvasMetadata(args, context) : {
        metadata: { storeId: args.storeId, canvasId: args.canvasId, share: { visibility: "CANVAS_VISIBILITY_TEAM_VIEW", canShareToTeam: true } },
      };
    },
    async setCanvasVisibility(args, context) {
      calls.setCanvasVisibility.push(args);
      return overrides.setCanvasVisibility ? overrides.setCanvasVisibility(args, context) : { visibility: "CANVAS_VISIBILITY_TEAM_VIEW" };
    },
  };
}

const fastRetry = {
  name: "canvas-test-retry",
  async runWithRetry(work, outer) {
    const workSignal = outer ?? signal();
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await work(attempt, workSignal);
      } catch (error) {
        if (attempt >= CANVAS_ACTIVE_USER_STORE_RETRY.maxAttempts || !(error instanceof CanvasStoreUnavailableError)) throw error;
      }
    }
  },
};

function serviceFixture(t, options = {}) {
  const dataRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "library-canvas-")));
  let catalog = new LibraryCatalog({ dataRoot, providerOrigin: origin });
  t.after(() => {
    catalog.close();
    rmSync(dataRoot, { recursive: true, force: true });
  });
  const alice = catalog.identity.createLocalPrincipal();
  catalog.identity.assignTeam({ ...alice, teamId: "team-local" }, true);
  catalog.identity.assignAgent({ ...alice, agentId: "conversation" }, true);
  const registeredStore = "node-store:" + randomUUID();
  catalog.identity.registerStore({ ...alice, storeId: registeredStore, teamId: "team-local" });
  const request = (overrides = {}) => ({
    ...catalog.identity.resolveCredential(alice.credential, signal()),
    ...overrides,
  });
  const execution = () => ({
    ...request(),
    storeId: registeredStore,
    agentId: "conversation",
    toolCallId: "tool-1",
    idempotencyKey: "canvas-" + randomUUID(),
  });
  const port = options.port ?? canvasPort(options.portOverrides ?? {});
  const service = createCanvasService(port, {
    dataRoot,
    catalog,
    retry: fastRetry,
    ...(options.isEnabled === undefined ? {} : { isEnabled: options.isEnabled }),
    ...(options.randomUUID === undefined ? {} : { randomUUID: options.randomUUID }),
  });
  return { dataRoot, get catalog() { return catalog; }, registeredStore, request, execution, port, service };
}

test("keeps the original active-user-store retry shape", () => {
  assert.deepEqual(CANVAS_ACTIVE_USER_STORE_RETRY, {
    name: "canvas-active-user-store-read",
    maxAttempts: 7,
    initialDelayMs: 500,
    maxDelayMs: 2500,
    backoffFactor: 2,
  });
});

test("maps frame reads to the original five statuses", async t => {
  let enabled = true;
  const f = serviceFixture(t, {
    isEnabled: () => enabled,
    portOverrides: {
      listUserCanvases: () => ({ storeId: "node-store:123e4567-e89b-42d3-a456-426614174222" }),
      getCanvasPayload: args => {
        if (args.canvasId === missingId) throw unavailable();
        if (args.canvasId === corruptId) {
          return { metadata: { storeId: args.storeId, canvasId: args.canvasId }, renderBundleGzip: Uint8Array.of(1, 2, 3, 4), dataJson: new Uint8Array() };
        }
        return { metadata: { storeId: args.storeId, canvasId: args.canvasId }, renderBundleGzip, dataJson: new Uint8Array() };
      },
    },
  });
  const userFrame = id => "sand-canvas://frame/user/" + id + "?theme=light";
  assert.equal((await f.service.readCanvasFrame(userFrame(canvasId), f.request())).status, 200);
  const ready = await f.service.readCanvasFrame(userFrame(canvasId), f.request());
  assert.equal(ready.content?.bundleJsonText, bundleJson);
  assert.equal(ready.content?.dataJsonText, "{}");
  enabled = false;
  assert.equal((await f.service.readCanvasFrame(userFrame(canvasId), f.request())).status, 404);
  enabled = true;
  assert.equal((await f.service.readCanvasFrame("sand-canvas://frame/user/not-a-uuid?theme=light", f.request())).status, 400);
  assert.equal((await f.service.readCanvasFrame(userFrame(missingId), f.request())).status, 404);
  assert.equal((await f.service.readCanvasFrame(userFrame(corruptId), f.request())).status, 422);
  const controller = new AbortController();
  controller.abort();
  assert.equal((await f.service.readCanvasFrame(userFrame(canvasId), f.request({ signal: controller.signal }))).status, 499);
});

test("checks payload metadata identity before decoding a valid bundle", async t => {
  const f = serviceFixture(t, {
    portOverrides: {
      getCanvasPayload: args => ({
        metadata: { storeId: args.storeId + "-intruder", canvasId: args.canvasId },
        renderBundleGzip,
        dataJson: new Uint8Array(),
      }),
    },
  });
  await assert.rejects(
    f.service.getCanvasPayload({ locator: { kind: "store", storeId: f.registeredStore, canvasId } }, f.request()),
    error => error.name === "CanvasPayloadIdentityError" && /invalid identity/.test(error.message),
  );
  const frame = await f.service.readCanvasFrame(
    "sand-canvas://frame/store/" + encodeURIComponent(f.registeredStore) + "/" + canvasId + "?theme=dark",
    f.request(),
  );
  assert.equal(frame.status, 404);
});

test("retries active-user-store payload reads but not metadata reads", async t => {
  const port = canvasPort({
    listUserCanvases(attempt) {
      if (attempt <= 2 || attempt === 4) throw new CanvasStoreUnavailableError("store warming up");
      return { storeId: "node-store:123e4567-e89b-42d3-a456-426614174222" };
    },
  });
  const f = serviceFixture(t, { port });
  const payload = await f.service.getCanvasPayload({ locator: { kind: "active-user-store", canvasId } }, f.request());
  assert.deepEqual(payload, { renderBundleGzip, dataJson: Buffer.from('{"ok":true}', "utf8") });
  assert.equal(port.calls.listUserCanvases.length, 3);
  const metadataPort = canvasPort({
    listUserCanvases: () => {
      throw new CanvasStoreUnavailableError("metadata store warming up");
    },
  });
  const metadataService = createCanvasService(metadataPort, { dataRoot: f.dataRoot, catalog: f.catalog, retry: fastRetry });
  await assert.rejects(
    metadataService.getCanvasShare({ locator: { kind: "active-user-store", canvasId } }, f.request()),
    /metadata store warming up/,
  );
  assert.equal(metadataPort.calls.listUserCanvases.length, 1);
  const share = await f.service.getCanvasShare({ locator: { kind: "active-user-store", canvasId } }, f.request());
  assert.equal(port.calls.listUserCanvases.length, 3);
  assert.equal(share.share?.visibility, "team-view");
});

test("falls back to group canvas reads only for unavailable store objects", async t => {
  const port = canvasPort({
    getCanvasPayload: () => { throw unavailable(); },
    readGroupChatCanvas(args) {
      if (args.canvasId === missingId) throw unavailable();
      if (args.canvasId === fallbackOtherId) throw new Error("group transport failed");
      return { renderBundleGzip, dataJson: Buffer.from('{"group":true}', "utf8") };
    },
  });
  const f = serviceFixture(t, { port });
  const read = (id, groupChatId) => f.service.getCanvasPayload({
    locator: { kind: "store", storeId: f.registeredStore, canvasId: id },
    ...(groupChatId === undefined ? {} : { groupChatId }),
  }, f.request());
  assert.deepEqual(await read(canvasId, room), { renderBundleGzip, dataJson: Buffer.from('{"group":true}', "utf8") });
  await assert.rejects(read(canvasId), /canvas object is unavailable/);
  await assert.rejects(read(missingId, room), /canvas object is unavailable/);
  await assert.rejects(read(fallbackOtherId, room), /group transport failed/);
  assert.equal(port.calls.getCanvasPayload.length, 4);
  assert.equal(port.calls.readGroupChatCanvas.length, 3);
});

test("returns null shares, rejects metadata mismatches, and enforces visibility echoes", async t => {
  const port = canvasPort({
    getCanvasMetadata: args => {
      if (args.canvasId === missingId) return { metadata: null };
      if (args.canvasId === mismatchShareId) {
        return { metadata: { storeId: args.storeId + "-intruder", canvasId: args.canvasId, share: { visibility: "CANVAS_VISIBILITY_PRIVATE", canShareToTeam: false } } };
      }
      if (args.canvasId === malformedShareId) {
        return { metadata: { storeId: args.storeId, canvasId: args.canvasId, share: { visibility: "CANVAS_VISIBILITY_PUBLIC", canShareToTeam: true } } };
      }
      return { metadata: { storeId: args.storeId, canvasId: args.canvasId, share: { visibility: "CANVAS_VISIBILITY_TEAM_VIEW", canShareToTeam: true } } };
    },
    setCanvasVisibility: args => ({ visibility: args.canvasId === echoFailureId ? "CANVAS_VISIBILITY_PUBLIC" : "CANVAS_VISIBILITY_PRIVATE" }),
  });
  const f = serviceFixture(t, { port });
  const share = id => f.service.getCanvasShare({ locator: { kind: "store", storeId: f.registeredStore, canvasId: id } }, f.request());
  assert.deepEqual(await share(canvasId), { storeId: f.registeredStore, canvasId, share: { visibility: "team-view", canShareToTeam: true } });
  assert.deepEqual(await share(missingId), { storeId: f.registeredStore, canvasId: missingId, share: null });
  assert.deepEqual(await share(malformedShareId), { storeId: f.registeredStore, canvasId: malformedShareId, share: null });
  await assert.rejects(share(mismatchShareId), error => error.name === "CanvasShareIdentityError" && /invalid identity/.test(error.message));
  const setVisibility = id => f.service.setCanvasVisibility(
    { locator: { kind: "store", storeId: f.registeredStore, canvasId: id }, visibility: "private" },
    f.request(),
  );
  assert.equal(await setVisibility(canvasId), "private");
  await assert.rejects(setVisibility(echoFailureId), error => error.name === "CanvasVisibilityEchoError" && /echo was not recognized/.test(error.message));
});

test("persists canvas manifests through catalog commitNative", async t => {
  const ids = [
    "123e4567-e89b-42d3-a456-426614174010",
    "123e4567-e89b-42d3-a456-426614174011",
    "123e4567-e89b-42d3-a456-426614174012",
  ];
  let nextId = 0;
  const f = serviceFixture(t, { randomUUID: () => ids[nextId++ % ids.length] });
  const execution = f.execution();
  const input = {
    kind: "canvas",
    title: "Original canvas",
    renderBundleGzip,
    dataJson: Buffer.from('{"answer":42}', "utf8"),
  };
  const result = await f.service.publishNativeArtifact(input, execution);
  assert.equal(result.url, origin + "/canvas/" + encodeURIComponent(f.registeredStore) + "/" + ids[0]);
  assert.equal(result.eventId, ids[2]);
  assert.deepEqual(result.identity, { providerOrigin: origin, ref: { kind: "canvas", storeId: f.registeredStore, canvasId: ids[0] } });
  const file = path.join(f.dataRoot, "library", "canvases", ids[0] + ".json");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(file).nlink, 1);
  const persisted = f.catalog.readObject(f.request(), { storeId: f.registeredStore, kind: "canvas", objectId: ids[0] });
  assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), persisted?.contentHash);
  const pending = f.catalog.outbox.find(execution);
  assert.equal(pending?.status, "pending");
  assert.equal(pending?.event.eventId, ids[2]);
  assert.deepEqual(pending?.event.identity, result.identity);
  assert.equal(pending?.event.url, result.url);
  assert.equal(f.catalog.listPages(f.request(), false)[0].canvasId, ids[0]);
  const replay = await f.service.publishNativeArtifact(input, execution);
  assert.equal(replay.eventId, ids[2]);
  assert.deepEqual(readdirSync(path.join(f.dataRoot, "library", "canvases")), [ids[0] + ".json"]);
  await assert.rejects(
    f.service.publishNativeArtifact({ kind: "document", source: "# nope" }, f.execution()),
    /Canvas publication requires/,
  );
});

test("rejects malformed arguments and aborted contexts before transport", async t => {
  const f = serviceFixture(t);
  await assert.rejects(
    f.service.getCanvasPayload({ locator: { kind: "store", storeId: "../escape", canvasId } }, f.request()),
  );
  await assert.rejects(
    f.service.getCanvasPayload({ locator: { kind: "store", storeId: f.registeredStore, canvasId }, groupChatId: "" }, f.request()),
    /non-empty/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.service.getCanvasShare({ locator: { kind: "active-user-store", canvasId } }, f.request({ signal: controller.signal })),
    /abort/i,
  );
  assert.equal(f.port.calls.getCanvasPayload.length, 0);
  assert.equal(f.port.calls.getCanvasMetadata.length, 0);
  assert.equal(f.port.calls.listUserCanvases.length, 0);
});
