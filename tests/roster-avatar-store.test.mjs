// Regression cover: the desktop-side `roster-avatars` mirror.
//
// Official Grok Bot keeps a content cache of agent pictures at
// `<userData>/roster-avatars/<32 hex>` — no extension, PNG payload — and keys it off the
// cloud `avatarUrl` (0.62.0 `dist/electron-main/main-core.cjs` `sX`:
// `sha256(avatarUrl + "#" + avatarVersion).slice(0, 32)`), served to the renderer over a
// token-authenticated `sand-avatar://` endpoint.
//
// A local-only build has no `avatarUrl` to hash: the picture is written by the host into the
// box's `agents/<id>/avatar.png`. So the key here is derived from the image bytes instead.
// The folder name, the 32-hex-extensionless key shape, and the PNG payload are what we
// reproduce; the key VALUE is intentionally not what official would compute.
//
// Why the coordinator owns this: the host runs inside the local Docker box and
// `/home/box/sand-data` is a named volume invisible from macOS, so the host physically
// cannot write `~/.groknode/`. The coordinator is a desktop Node utility process and sees
// every `setAgentAvatarBytes` before forwarding it to the gateway.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Bundle the module plus the dispatcher it is wired into, from source. */
const bundleSources = async (mutate) => {
  const bundle = await build({
    stdin: {
      contents: [
        'export { createRosterAvatarStore, writeRosterAvatarCopy, rosterAvatarKey, rosterAvatarStoreDir, isRosterAvatarKey, isPngBytes, decodeBase64Image, decodeImageDataUrl, ROSTER_AVATAR_DIRNAME, ROSTER_AVATAR_KEY_LENGTH } from "./source/node-agent-coordinator/gateway/roster-avatar-store.ts";',
        'export { createGatewayRequestDispatch } from "./source/node-agent-coordinator/gateway/gateway-request-dispatcher.ts";',
      ].join("\n"),
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "error",
    plugins: mutate == null ? [] : [mutate],
  });
  return await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
};

const api = await bundleSources(null);
const {
  createRosterAvatarStore,
  writeRosterAvatarCopy,
  rosterAvatarKey,
  rosterAvatarStoreDir,
  isRosterAvatarKey,
  isPngBytes,
  decodeBase64Image,
  decodeImageDataUrl,
  ROSTER_AVATAR_DIRNAME,
  ROSTER_AVATAR_KEY_LENGTH,
  createGatewayRequestDispatch,
} = api;

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_2PX = Buffer.concat([PNG_1PX, Buffer.from([0x00, 0x01, 0x02, 0x03])]);

const withDataDir = async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "grok-node-roster-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

const readStore = async (dataDir) => {
  const dir = rosterAvatarStoreDir(dataDir);
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

test("directory name and key shape match the official client", () => {
  assert.equal(ROSTER_AVATAR_DIRNAME, "roster-avatars");
  assert.equal(ROSTER_AVATAR_KEY_LENGTH, 32);
  const key = rosterAvatarKey(PNG_1PX);
  assert.equal(key.length, 32);
  assert.ok(isRosterAvatarKey(key), `${key} must be 32 lowercase hex`);
  // Content-addressed, and derived from bytes only — the official URL input is absent here.
  assert.equal(key, createHash("sha256").update(PNG_1PX).digest("hex").slice(0, 32));
  assert.notEqual(key, rosterAvatarKey(PNG_2PX));
});

test("written copy is extensionless, byte-identical, and content-keyed", async (t) => {
  const dataDir = await withDataDir(t);
  const copy = await writeRosterAvatarCopy({ dataDir, bytes: PNG_1PX });
  assert.ok(copy != null);
  assert.equal(path.basename(copy.filePath), rosterAvatarKey(PNG_1PX));
  assert.equal(path.extname(copy.filePath), "", "official keys carry no extension");
  assert.equal(copy.filePath, path.join(dataDir, "roster-avatars", rosterAvatarKey(PNG_1PX)));
  assert.deepEqual(await readFile(copy.filePath), PNG_1PX);
  assert.deepEqual(await readStore(dataDir), [rosterAvatarKey(PNG_1PX)]);
});

test("the same picture stored twice does not duplicate or grow the directory", async (t) => {
  const dataDir = await withDataDir(t);
  const first = await writeRosterAvatarCopy({ dataDir, bytes: PNG_1PX });
  const second = await writeRosterAvatarCopy({ dataDir, bytes: PNG_1PX });
  assert.equal(first?.alreadyStored, false);
  assert.equal(second?.alreadyStored, true);
  assert.equal(second?.key, first?.key);
  assert.deepEqual(await readStore(dataDir), [rosterAvatarKey(PNG_1PX)]);
});

test("distinct pictures become distinct keys side by side", async (t) => {
  const dataDir = await withDataDir(t);
  await writeRosterAvatarCopy({ dataDir, bytes: PNG_1PX });
  await writeRosterAvatarCopy({ dataDir, bytes: PNG_2PX });
  assert.deepEqual(await readStore(dataDir), [rosterAvatarKey(PNG_1PX), rosterAvatarKey(PNG_2PX)].sort());
});

test("non-PNG payloads are refused instead of poisoning the store", async (t) => {
  const dataDir = await withDataDir(t);
  assert.equal(isPngBytes(PNG_1PX), true);
  assert.equal(isPngBytes(Buffer.from("GIF89a not really")), false);
  assert.equal(isPngBytes(PNG_1PX.subarray(0, 4)), false);
  assert.equal(await writeRosterAvatarCopy({ dataDir, bytes: Buffer.from("GIF89a not really") }), null);
  assert.equal(await writeRosterAvatarCopy({ dataDir, bytes: Buffer.alloc(0) }), null);
  assert.deepEqual(await readStore(dataDir), [], "a refused write must not create the directory");
});

test("decoders reject the shapes that would otherwise silently store garbage", () => {
  assert.deepEqual(decodeBase64Image(PNG_1PX.toString("base64")), PNG_1PX);
  assert.equal(decodeBase64Image(""), null);
  assert.equal(decodeBase64Image("   "), null);
  assert.equal(decodeBase64Image(42), null);
  assert.equal(decodeBase64Image(undefined), null);
  assert.deepEqual(decodeImageDataUrl(`data:image/png;base64,${PNG_1PX.toString("base64")}`), PNG_1PX);
  assert.equal(decodeImageDataUrl(`data:image/png,raw`), null, "non-base64 data URLs are not supported");
  assert.equal(decodeImageDataUrl("https://example.com/a.png"), null);
  assert.equal(decodeImageDataUrl(null), null);
});

test("a set-avatar call mirrors its bytes; clearing one stores nothing", async (t) => {
  const dataDir = await withDataDir(t);
  const store = createRosterAvatarStore({ dataDir, log: () => {} });

  const copy = await store.mirrorSetAvatarArgs({ id: "agent-1", pngBase64: PNG_1PX.toString("base64") });
  assert.equal(copy?.key, rosterAvatarKey(PNG_1PX));
  assert.deepEqual(await readStore(dataDir), [rosterAvatarKey(PNG_1PX)]);

  assert.equal(await store.mirrorSetAvatarArgs({ id: "agent-1", pngBase64: null }), null, "clear writes no file");
  assert.equal(await store.mirrorSetAvatarArgs({ id: "agent-1" }), null);
  assert.equal(await store.mirrorSetAvatarArgs({ id: "agent-1", pngBase64: "" }), null);
  assert.equal(await store.mirrorSetAvatarArgs({}), null);
  assert.equal(await store.mirrorSetAvatarArgs("not-an-object"), null);
  assert.deepEqual(await readStore(dataDir), [rosterAvatarKey(PNG_1PX)]);
});

test("backfill mirrors every avatar the box already holds, once", async (t) => {
  const dataDir = await withDataDir(t);
  const calls = [];
  const dispatch = async (method, args) => {
    calls.push(method);
    if (method === "listAgents") return [
      { id: "with-avatar", avatarVersion: "1" },
      { id: "also-with-avatar", avatarVersion: "1" },
      { id: "no-avatar", avatarVersion: null },
    ];
    if (method === "getAgentAvatar") {
      if (args.id === "with-avatar") return { version: "1", dataUrl: `data:image/png;base64,${PNG_1PX.toString("base64")}` };
      if (args.id === "also-with-avatar") return { version: "1", dataUrl: `data:image/png;base64,${PNG_2PX.toString("base64")}` };
      return { version: null, dataUrl: null };
    }
    throw new Error(`unexpected ${method}`);
  };
  const store = createRosterAvatarStore({ dataDir, dispatch, log: () => {} });

  const first = await store.syncExistingAvatars();
  assert.deepEqual(first, { scanned: 3, mirrored: 2 });
  assert.deepEqual(await readStore(dataDir), [rosterAvatarKey(PNG_1PX), rosterAvatarKey(PNG_2PX)].sort());

  const second = await store.syncExistingAvatars();
  assert.equal(second, null, "a settled backfill must not re-fetch the whole roster");
  assert.equal(calls.filter((m) => m === "listAgents").length, 1);
});

test("a failed backfill is retried, not written off", async (t) => {
  const dataDir = await withDataDir(t);
  let attempts = 0;
  const dispatch = async (method) => {
    if (method === "getAgentAvatar") return { version: null, dataUrl: null };
    if (method !== "listAgents") throw new Error(`unexpected ${method}`);
    attempts += 1;
    if (attempts === 1) throw new Error("gateway down");
    return [{ id: "a", avatarVersion: "1" }];
  };
  const store = createRosterAvatarStore({ dataDir, dispatch, log: () => {} });

  assert.equal(await store.syncExistingAvatars(), null);
  assert.deepEqual(await store.syncExistingAvatars(), { scanned: 1, mirrored: 0 });
  assert.equal(attempts, 2);
});

test("the dispatcher observer fires after success and never changes the reply", async (t) => {
  const dataDir = await withDataDir(t);
  const seen = [];
  const store = createRosterAvatarStore({ dataDir, log: () => {} });
  const dispatch = createGatewayRequestDispatch(
    {
      dispatchCommand: async (method, args) => {
        if (method === "setAgentAvatarBytes") {
          if (args.id === "boom") throw new Error("gateway refused");
          return { id: args.id, avatarVersion: "v1" };
        }
        if (method === "listAgents") return [];
        throw new Error(`no handler for ${method}`);
      },
    },
    (method) => method === "setAgentAvatarBytes" || method === "listAgents",
    (method, args) => {
      seen.push(method);
      if (method === "setAgentAvatarBytes") return store.mirrorSetAvatarArgs(args);
    },
  );

  const ok = await dispatch("setAgentAvatarBytes", { id: "agent-1", pngBase64: PNG_1PX.toString("base64") });
  assert.equal(ok.status, "ok");
  assert.deepEqual(ok.value, { id: "agent-1", avatarVersion: "v1" });
  assert.deepEqual(seen, ["setAgentAvatarBytes"]);
  assert.deepEqual(await readStore(dataDir), [rosterAvatarKey(PNG_1PX)]);

  const failed = await dispatch("setAgentAvatarBytes", { id: "boom", pngBase64: PNG_2PX.toString("base64") });
  assert.equal(failed.status, "failed", "a gateway failure must stay a failure");
  assert.deepEqual(await readStore(dataDir), [rosterAvatarKey(PNG_1PX)], "nothing is mirrored for a failed commit");
});

test("an unwritable data root never breaks the avatar commit it observes", async (t) => {
  const locked = await withDataDir(t);
  const readOnly = path.join(locked, "roster-avatars");
  await writeFile(readOnly, PNG_1PX);
  await chmod(readOnly, 0o400);
  t.after(() => chmod(readOnly, 0o700).catch(() => {}));

  const dispatched = [];
  const dispatch = createGatewayRequestDispatch(
    { dispatchCommand: async (method) => { dispatched.push(method); return { ok: true }; } },
    () => true,
    () => { throw new Error("mirror exploded"); },
  );
  const outcome = await dispatch("setAgentAvatarBytes", { id: "agent-1" });
  assert.equal(outcome.status, "ok", "observer failures are swallowed");
  assert.deepEqual(dispatched, ["setAgentAvatarBytes"]);
});

// Mutation guard: the mirror is only load-bearing if it keys on image CONTENT. Re-pointing
// `rosterAvatarKey` at a constant collapses every picture onto one file, which the shape and
// round-trip cases above must both catch.
test("mutation: a non-content key is rejected", async () => {
  const mutated = await bundleSources({
    name: "constant-roster-avatar-key",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /roster-avatar-store\.ts$/ }, () => ({ path: "roster-avatar-store", namespace: "mutant" }));
      pluginBuild.onLoad({ filter: /.*/, namespace: "mutant" }, async (args) => {
        const source = await readFile(path.join(root, "source/node-agent-coordinator/gateway/roster-avatar-store.ts"), "utf8");
        const broken = source.replace(
          /return createHash\("sha256"\)\.update\(bytes\)\.digest\("hex"\)\.slice\(0, ROSTER_AVATAR_KEY_LENGTH\);/,
          'return "0".repeat(ROSTER_AVATAR_KEY_LENGTH);',
        );
        assert.notEqual(broken, source, "mutation must actually change rosterAvatarKey");
        return { contents: broken, loader: "ts" };
      });
    },
  });

  const dir = await mkdtemp(path.join(tmpdir(), "grok-node-roster-mutant-"));
  try {
    assert.equal(mutated.rosterAvatarKey(PNG_1PX), mutated.rosterAvatarKey(PNG_2PX),
      "mutant makes distinct pictures share a key");
    await mutated.writeRosterAvatarCopy({ dataDir: dir, bytes: PNG_1PX });
    await mutated.writeRosterAvatarCopy({ dataDir: dir, bytes: PNG_2PX });
    const files = await readdir(mutated.rosterAvatarStoreDir(dir));
    assert.equal(files.length, 1, "mutant collapses two pictures into one file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
