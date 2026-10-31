// Settings → General → notification sound (official `notification-sound-enabled` /
// `notification-sound` rows). The five bundled sounds ship in the official 0.78.1
// renderer assets; ids `ping-1-open-blip` … `ping-5-chime-b` are the official
// option ids and the exact enum our desktop-notification-preferences store has
// carried since the 0.72.1 port (source/shared/desktop-0721.ts).
//
// Official evidence (rea-grokbot-0781): option table `$$t` in index.eager-app
// @2,717,340 (`{id,label:{BnX6kI|XPT37m|TS5vYS|8rSWEN|QN4KVA},url:new URL("tmp-N-…wav",import.meta.url)}`);
// playback `r1t(e)` = singleton Audio src=url play(); the main process emits a
// `notification-sound` event and the renderer plays it (`W.subscribe({"notification-sound":…})`).
// zh labels from the official zh pack `chunk-settings-BbrFWJId.js`.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openUpstream0781 } from "./upstream-0781.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");

export const NOTIFICATION_SOUNDS_0781 = Object.freeze([
  Object.freeze({ id: "ping-1-open-blip", file: "tmp-1-open-blip-D1y74m9N.wav", sha256: "7e454b7dd0aed424afccaa4c858f46415158fa39a85e5f2dbd657cb32411eaa6", bytes: 49004, en: "Open Blip", zh: "清亮嘀声" }),
  Object.freeze({ id: "ping-2-tick", file: "tmp-2-tick-DY1KrPne.wav", sha256: "6c50642ba6a388a95400501e0f2d3b0185f93d7342ea3eb308c6a7143c717db1", bytes: 42284, en: "Tick", zh: "滴答" }),
  Object.freeze({ id: "ping-3-double-tick", file: "tmp-3-double-tick-CdEXJqnB.wav", sha256: "c166fb491094d42216523c7fa80003b78b6ed701a56e80333d1ad4dc41d52383", bytes: 63404, en: "Double Tick", zh: "双滴答" }),
  Object.freeze({ id: "ping-4-chime-a", file: "tmp-4-chime-a-CH10PUxT.wav", sha256: "5d9408bab724f5ecf3f712c3809d275f4ec937b5e93b32c315533676bd12fc09", bytes: 65324, en: "Chime A", zh: "铃音 A" }),
  Object.freeze({ id: "ping-5-chime-b", file: "tmp-5-chime-b-B3aR0Am-.wav", sha256: "8ae218b2d3764cc1c056ca3792c5e922ea5d45631d3cdf5218e8667282e26b6b", bytes: 67244, en: "Chime B", zh: "铃音 B" }),
]);

const OFFICIAL_DIR = "dist/renderer/assets";

export async function stageNotificationSounds0781({ stageRoot, archive: supplied } = {}) {
  const archive = supplied ?? await openUpstream0781();
  const assetsRoot = path.resolve(stageRoot, OFFICIAL_DIR);
  await mkdir(assetsRoot, { recursive: true });
  const files = [];
  for (const sound of NOTIFICATION_SOUNDS_0781) {
    const bytes = archive.read(`${OFFICIAL_DIR}/${sound.file}`);
    const digest = sha(bytes);
    if (digest !== sound.sha256 || bytes.length !== sound.bytes) {
      throw new Error(`Notification sound ${sound.file} does not match the pinned upstream extraction`);
    }
    await writeFile(path.join(assetsRoot, sound.file), bytes);
    files.push({ path: `${OFFICIAL_DIR}/${sound.file}`, sha256: digest, bytes: bytes.length });
  }
  return { upstream: archive.identity, files };
}

export async function verifyStagedNotificationSounds0781({ stageRoot, archive: supplied } = {}) {
  const archive = supplied ?? await openUpstream0781();
  for (const sound of NOTIFICATION_SOUNDS_0781) {
    const staged = await readFile(path.resolve(stageRoot, OFFICIAL_DIR, sound.file));
    const digest = sha(staged);
    if (digest !== sound.sha256) throw new Error(`Staged notification sound ${sound.file} differs from the pinned upstream extraction`);
  }
  return { upstream: archive.identity, count: NOTIFICATION_SOUNDS_0781.length };
}
