import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { UPSTREAM_0758, openUpstream0758 } from "../scripts/lib/upstream-0758.mjs";

const snapshot = fileURLToPath(new URL("../../rea-grokbot-0758/asar/app.asar", import.meta.url));
const nativePath = "dist/deps/sand-window-capture/build/Release/sand_window_capture.node";
const options = { skip: !existsSync(snapshot) && "0.75.8 snapshot is absent" };

test("0.75.8 reader returns exact packed source and independently pinned native bytes", options, async () => {
  const archive = await openUpstream0758({ asarPath: snapshot });
  const source = archive.read("dist/electron-main/main-app.cjs");
  assert.ok(source.includes(Buffer.from("grok_bot_apple_apps")));
  assert.deepEqual(await archive.readNative(nativePath), await readFile(`${snapshot}.unpacked/${nativePath}`));
  assert.equal(archive.provenance().find((entry) => entry.path === nativePath).integritySource, "captured-unpacked-bytes");
  assert.throws(() => archive.read("../package.json"), /Invalid upstream artifact path/);
});

test("0.75.8 reader reports the upstream version it actually holds", options, async () => {
  const archive = await openUpstream0758({ asarPath: snapshot });
  assert.equal(archive.identity.version, "0.75.8");
  assert.equal(archive.identity.asarSha256, UPSTREAM_0758.asarSha256);
  const metadata = JSON.parse(archive.read("package.json").toString("utf8"));
  assert.equal(metadata.version, "0.75.8");
});

test("0.75.8 reader rejects an altered archive before reading any member", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "grok-0758-archive-"));
  try {
    const archive = path.join(root, "app.asar");
    await writeFile(archive, "untrusted replacement");
    await assert.rejects(openUpstream0758({ asarPath: archive }), /ASAR checksum mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("0.75.8 reader rejects tampered unpacked native bytes with an intact ASAR", options, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "grok-0758-native-"));
  try {
    const archivePath = path.join(root, "app.asar");
    await copyFile(snapshot, archivePath);
    const nativeTarget = `${archivePath}.unpacked/${nativePath}`;
    await mkdir(path.dirname(nativeTarget), { recursive: true });
    await writeFile(nativeTarget, "tampered addon");
    const archive = await openUpstream0758({ asarPath: archivePath });
    await assert.rejects(archive.readNative(nativePath), /native snapshot checksum mismatch/);
    await assert.rejects(archive.readNative("dist/deps/unpinned.node"), /Unpinned upstream native artifact/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("0.75.5 and 0.75.8 native binaries are distinct builds", options, async () => {
  const archive = await openUpstream0758({ asarPath: snapshot });
  const bytes = await archive.readNative(nativePath);
  const manifest = JSON.parse(await readFile(
    fileURLToPath(new URL("../manifests/ports/grokbot-0758-unpacked.json", import.meta.url)), "utf8"));
  const entry = manifest.files.find((file) => file.path === nativePath);
  assert.equal(entry.sha256, archive.provenance().find((item) => item.path === nativePath).sha256);
  assert.notEqual(entry.sha256, "a3630613ab7cb4b74e1cc229caf63a3a8454b45374553b74559225091cfdcb7d");
  assert.ok(bytes.length > 0);
});
