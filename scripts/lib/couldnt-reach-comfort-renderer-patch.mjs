// P0-5 — couldnt-reach comfort copy aligned to official Grok Bot 0.71.2.
//
// Evidence (byte-sourced from rea-grokbot-0712 / 0.71.2 renderer):
//   * Dialog jU (index-wlkGG389.js ~1403500) uses title IgRphe + description LDzo5u
//     (`nDe={id:"LDzo5u"}`). Gate CU: isLocked && kind==="reconnecting" &&
//     escalation==="unreachable" && !isTemporalAgentSelected.
//   * 0.18 already has the same door: q8n → sand-computer-couldnt-reach-dialog +
//     constants w8n/v8n (index-UbX-y3il.js ~4788606). No second top-bar banner —
//     official strip rq only covers asleep / access-blocked, not unreachable.
//   * Gap is copy + i18n: 0.18 still says "Your agents, files…" and has no LDzo5u
//     pair, so zh-Hans never localizes the comfort body.
//
// Official EN (index.eager-app-DSuGVQNC.js) / zh-Hans (chunk-core-CFLk5DM-.js):
//   LDzo5u  Your Bots, files, and logins are safe. If it doesn't reconnect on its
//           own, recover Grok Bot's computer to keep the data.
//           你的 Bot、文件和登录信息都是安全的。如果它没有自动重新连接，请恢复 Grok Bot 的电脑以保留数据。
//   wUMeMd  This recreates… Your Bots, files, and logins are kept, but installed
//           apps and packages are removed. / 这会重新创建…都会保留，但已安装的应用和软件包会被移除。
//   Vi957D  The recovery couldn't finish… Your Bots, files, and logins are safe.
//
// Conflict policy: official wins (Bot/Bots, not agents; recover-confirm includes
// the apps/packages clause). Must run BEFORE main-i18n so pairs match patched EN.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const COULDNT_REACH_COMFORT_EVIDENCE = Object.freeze({
  reference: "Grok Bot 0.71.2 index-wlkGG389.js jU / nDe LDzo5u; eager-app + chunk-core-CFLk5DM-",
  gate: '0.18 q8n + CU-equivalent: isLocked && kind==="reconnecting" && escalation==="unreachable"',
  dialogClass: "sand-computer-couldnt-reach-dialog",
  notATopBanner:
    "Official unreachable comfort is the couldnt-reach dialog only; strip rq is asleep/access-blocked.",
});

/** Official LDzo5u (dialog description). */
export const LDZO5U_EN =
  "Your Bots, files, and logins are safe. If it doesn't reconnect on its own, recover Grok Bot's computer to keep the data.";
export const LDZO5U_ZH =
  "你的 Bot、文件和登录信息都是安全的。如果它没有自动重新连接，请恢复 Grok Bot 的电脑以保留数据。";

/** Official wUMeMd (recover-confirm description). */
export const WUMEMD_EN =
  "This recreates Grok Bot's computer and reconnects. Your Bots, files, and logins are kept, but installed apps and packages are removed.";
export const WUMEMD_ZH =
  "这会重新创建 Grok Bot 的电脑并重新连接。你的 Bot、文件和登录信息都会保留，但已安装的应用和软件包会被移除。";

/** Official Vi957D (recover-failed description). */
export const VI957D_EN =
  "The recovery couldn't finish, so Grok Bot's computer may still be unreachable. Your Bots, files, and logins are safe.";
export const VI957D_ZH =
  "恢复未能完成，Grok Bot 的电脑可能仍然无法连接。你的 Bot、文件和登录信息都是安全的。";

/** Same comfort clause as Vi957D on the update-failed path (0.18 still ships it). */
export const UPDATE_FAILED_EN =
  "The update couldn't finish, so Grok Bot's computer is still on its previous image. Your Bots, files, and logins are safe.";

const TRANSFORMS = Object.freeze([
  [
    "LDzo5u couldnt-reach body",
    "Your agents, files, and logins are safe. If it doesn't reconnect on its own, recover Grok Bot's computer to keep the data.",
    LDZO5U_EN,
  ],
  [
    "wUMeMd recover-confirm body",
    "This recreates Grok Bot's computer and reconnects. Your agents, files, and logins are kept.",
    WUMEMD_EN,
  ],
  [
    "Vi957D recover-failed body",
    "The recovery couldn't finish, so Grok Bot's computer may still be unreachable. Your agents, files, and logins are safe.",
    VI957D_EN,
  ],
  [
    "update-failed comfort uses Bots",
    "The update couldn't finish, so Grok Bot's computer is still on its previous image. Your agents, files, and logins are safe.",
    UPDATE_FAILED_EN,
  ],
]);

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`couldnt-reach comfort ${label} anchor is missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchCouldntReachComfort(source) {
  let patched = source;
  for (const [label, before, after] of TRANSFORMS) {
    patched = replaceExactlyOnce(patched, before, after, label);
  }
  return patched;
}

function digest(text) {
  return { bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex") };
}

export async function applyOriginalRendererCouldntReachComfort({ stageRoot }) {
  const assetsDir = path.join(stageRoot, "dist", "renderer", "assets");
  const files = (await readdir(assetsDir)).filter((name) => /^index-.*\.js$/.test(name) && !name.includes("eager"));
  const hits = [];
  for (const file of files) {
    const full = path.join(assetsDir, file);
    const source = await readFile(full, "utf8");
    if (!source.includes('sand-computer-couldnt-reach-dialog')) continue;
    if (!source.includes("Your agents, files, and logins are safe. If it doesn't reconnect")) {
      if (source.includes(LDZO5U_EN)) {
        throw new Error(`couldnt-reach comfort: ${file} already patched (re-run on pristine).`);
      }
      continue;
    }
    const patched = patchCouldntReachComfort(source);
    await writeFile(full, patched);
    hits.push({ file, original: digest(source), patched: digest(patched) });
  }
  if (hits.length !== 1) {
    throw new Error(`couldnt-reach comfort: expected one main chunk, found ${hits.length}.`);
  }
  const provenance = {
    mode: "couldnt-reach-comfort-0712",
    evidence: COULDNT_REACH_COMFORT_EVIDENCE,
    transforms: TRANSFORMS.map(([label, before, after]) => ({ label, before, after })),
    files: hits,
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-couldnt-reach-comfort-extension.json");
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + "\n");
  console.log(`couldnt-reach comfort: aligned LDzo5u/wUMeMd/Vi957D on ${hits[0].file}`);
  return provenance;
}
