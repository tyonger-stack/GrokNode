import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundled = await build({
  entryPoints: [path.join(root, "source/host/extensions/library/canvas-protocol.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const moduleUrl = "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64");
const protocol = await import(moduleUrl);
const {
  buildCanvasFrameUrl,
  parseCanvasFrameUrl,
  decodeCanvasRenderBundle,
  decodeCanvasContent,
  parseCanvasShareJson,
  parseCanvasVisibilityEcho,
  CANVAS_PAYLOAD_LIMITS,
} = protocol;

const canvasId = "123e4567-e89b-42d3-a456-426614174000";
const room = "123e4567-e89b-42d3-a456-426614174111";
const storeId = "node-store:123e4567-e89b-42d3-a456-426614174222";
const bundleJson = JSON.stringify({ version: 1, runtimeEsm: "export function mount() {}", userModule: "export const value = 1;" });
const bundleGzip = gzipSync(Buffer.from(bundleJson, "utf8"));

test("builds the original user and store frame URLs", () => {
  assert.equal(
    buildCanvasFrameUrl({ kind: "active-user-store", canvasId }, "dark", undefined, "build-42"),
    "sand-canvas://frame/user/" + canvasId + "?theme=dark&rev=build-42",
  );
  assert.equal(
    buildCanvasFrameUrl({ kind: "active-user-store", canvasId }, "light", room),
    "sand-canvas://frame/user/" + canvasId + "?theme=light",
  );
  assert.equal(
    buildCanvasFrameUrl({ kind: "store", storeId, canvasId }, "light", room, "r1"),
    "sand-canvas://frame/store/" + encodeURIComponent(storeId) + "/" + canvasId + "?theme=light&room=" + room + "&rev=r1",
  );
  assert.equal(
    buildCanvasFrameUrl({ kind: "store", storeId, canvasId }, "dark", undefined, "bad revision!"),
    "sand-canvas://frame/store/" + encodeURIComponent(storeId) + "/" + canvasId + "?theme=dark",
  );
  assert.throws(() => buildCanvasFrameUrl({ kind: "store", storeId, canvasId }, "blue"), /light or dark/);
  assert.throws(() => buildCanvasFrameUrl({ kind: "store", storeId: "../escape", canvasId }, "light"));
  assert.throws(() => buildCanvasFrameUrl({ kind: "store", storeId, canvasId }, "light", "not-a-uuid"));
});

test("parses canonical frame URLs and rejects non-canonical variants", () => {
  assert.deepEqual(
    parseCanvasFrameUrl(buildCanvasFrameUrl({ kind: "store", storeId, canvasId }, "dark", room, "r:1")),
    { locator: { kind: "store", storeId, canvasId }, theme: "dark", groupChatId: room, revision: "r:1" },
  );
  assert.deepEqual(
    parseCanvasFrameUrl(buildCanvasFrameUrl({ kind: "active-user-store", canvasId }, "light", undefined, "v2")),
    { locator: { kind: "active-user-store", canvasId }, theme: "light", revision: "v2" },
  );
  const normalized = parseCanvasFrameUrl("sand-canvas://frame/user/" + canvasId.toUpperCase() + "?theme=light");
  assert.deepEqual(normalized?.locator, { kind: "active-user-store", canvasId });
  const rejected = [
    "https://cursor.com/frame/user/" + canvasId + "?theme=light",
    "sand-canvas://frames/user/" + canvasId + "?theme=light",
    "sand-canvas://frame:1/user/" + canvasId + "?theme=light",
    "sand-canvas://user@frame/user/" + canvasId + "?theme=light",
    "sand-canvas://frame/user/" + canvasId + "?theme=light#x",
    "sand-canvas://frame/user/" + canvasId + "?theme=blue",
    "sand-canvas://frame/user/" + canvasId + "?theme=Light",
    "sand-canvas://frame/user/" + canvasId + "?theme=light&room=" + room,
    "sand-canvas://frame/user/" + canvasId + "?theme=light&theme=light",
    "sand-canvas://frame/user/" + canvasId + "?rev=v1&theme=light",
    "sand-canvas://frame/store/" + encodeURIComponent(storeId) + "/" + canvasId + "?theme=light&room=" + room.toUpperCase(),
    "sand-canvas://frame/store/" + storeId + "/" + canvasId + "?theme=light",
    "sand-canvas://frame/store/" + encodeURIComponent(storeId) + "/" + canvasId + "?theme=light&room=not-a-uuid",
    "sand-canvas://frame/store/" + encodeURIComponent(storeId) + "/not-a-uuid?theme=light",
    "sand-canvas://frame/team/" + canvasId + "?theme=light",
    "sand-canvas://frame/user/" + canvasId + "?theme=light&rev=" + "x".repeat(129),
  ];
  for (const url of rejected) assert.equal(parseCanvasFrameUrl(url), null, url);
});

test("decodes bundle-v1 payloads within the original size limits", async () => {
  const ready = await decodeCanvasContent({ renderBundleGzip: bundleGzip, dataJson: Buffer.from('{"answer":42}', "utf8") });
  assert.deepEqual(ready, { status: 200, content: { bundleJsonText: bundleJson, dataJsonText: '{"answer":42}' } });
  const emptyData = await decodeCanvasContent({ renderBundleGzip: bundleGzip, dataJson: new Uint8Array() });
  assert.equal(emptyData.status, 200);
  assert.equal(emptyData.content?.dataJsonText, "{}");
  assert.deepEqual(await decodeCanvasRenderBundle(new Uint8Array()), { isDecoded: false, errorClass: "empty" });
  assert.deepEqual(
    await decodeCanvasRenderBundle(new Uint8Array(CANVAS_PAYLOAD_LIMITS.compressedBundleBytes + 1)),
    { isDecoded: false, errorClass: "compressed-too-large" },
  );
  assert.deepEqual(
    await decodeCanvasRenderBundle(gzipSync(Buffer.alloc(CANVAS_PAYLOAD_LIMITS.decompressedBundleBytes + 1))),
    { isDecoded: false, errorClass: "decompressed-too-large" },
  );
  assert.equal(
    (await decodeCanvasRenderBundle(gzipSync(Buffer.from("export default {};", "utf8")))).errorClass,
    "invalid-bundle",
  );
  assert.equal(
    (await decodeCanvasRenderBundle(gzipSync(Buffer.from(JSON.stringify({ version: 2, runtimeEsm: "", userModule: "" }), "utf8")))).errorClass,
    "invalid-bundle",
  );
  assert.equal((await decodeCanvasContent({ renderBundleGzip: bundleGzip, dataJson: Uint8Array.of(0xff, 0xfe) })).status, 422);
  assert.equal((await decodeCanvasContent({ renderBundleGzip: Uint8Array.of(1, 2, 3, 4), dataJson: new Uint8Array() })).status, 422);
  assert.match((await decodeCanvasRenderBundle(Uint8Array.of(1, 2, 3, 4))).errorClass, /Error/);
});

test("parses original provider share and visibility echoes", () => {
  assert.deepEqual(
    parseCanvasShareJson({ visibility: "CANVAS_VISIBILITY_PRIVATE", canShareToTeam: false }),
    { visibility: "private", canShareToTeam: false },
  );
  assert.deepEqual(
    parseCanvasShareJson({ visibility: "CANVAS_VISIBILITY_TEAM_VIEW", canShareToTeam: true }),
    { visibility: "team-view", canShareToTeam: true },
  );
  const malformed = [
    null,
    [],
    {},
    { visibility: "CANVAS_VISIBILITY_PUBLIC", canShareToTeam: true },
    { visibility: "CANVAS_VISIBILITY_PRIVATE", canShareToTeam: "yes" },
  ];
  for (const value of malformed) assert.equal(parseCanvasShareJson(value), null);
  assert.equal(parseCanvasVisibilityEcho("CANVAS_VISIBILITY_TEAM_VIEW"), "team-view");
  assert.equal(parseCanvasVisibilityEcho("CANVAS_VISIBILITY_PRIVATE"), "private");
  assert.equal(parseCanvasVisibilityEcho("unknown"), null);
});
