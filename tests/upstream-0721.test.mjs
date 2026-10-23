import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { openUpstream0721 } from "../scripts/lib/upstream-0721.mjs";

const snapshot = fileURLToPath(new URL("../../rea-grokbot-0721/asar/app.asar", import.meta.url));
const nativePath = "dist/deps/sand-window-capture/build/Release/sand_window_capture.node";
const options = { skip: !existsSync(snapshot) && "0.72.1 snapshot is absent" };

test("0.72.1 reader returns exact packed source and independently pinned native bytes", options, async () => {
  const archive = await openUpstream0721({ asarPath: snapshot });
  const source = archive.read("dist/electron-preload/preload-desktop-mount-capture-overlay.cjs");
  assert.ok(source.includes(Buffer.from("desktopMountCaptureOverlay")));
  assert.deepEqual(await archive.readNative(nativePath), await readFile(`${snapshot}.unpacked/${nativePath}`));
  assert.equal(archive.provenance().find((entry) => entry.path === nativePath).integritySource, "captured-unpacked-bytes");
  assert.throws(() => archive.read("../package.json"), /Invalid upstream artifact path/);
});

test("0.72.1 reader rejects an altered archive before reading any member", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "grok-0721-archive-"));
  try {
    const archive = path.join(root, "app.asar");
    await writeFile(archive, "untrusted replacement");
    await assert.rejects(openUpstream0721({ asarPath: archive }), /ASAR checksum mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("0.72.1 reader rejects tampered unpacked native bytes with an intact ASAR", options, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "grok-0721-native-"));
  try {
    const archivePath = path.join(root, "app.asar");
    await copyFile(snapshot, archivePath);
    const nativeTarget = `${archivePath}.unpacked/${nativePath}`;
    await mkdir(path.dirname(nativeTarget), { recursive: true });
    await writeFile(nativeTarget, "tampered addon");
    const archive = await openUpstream0721({ asarPath: archivePath });
    await assert.rejects(archive.readNative(nativePath), /native snapshot checksum mismatch/);
    await assert.rejects(archive.readNative("dist/deps/unpinned.node"), /Unpinned upstream native artifact/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
