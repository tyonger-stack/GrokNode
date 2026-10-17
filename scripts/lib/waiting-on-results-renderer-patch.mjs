// P2-2: Await / background wait activity label → official MsZyH5 "Waiting on results".
//
// Evidence (0.71.2):
//   host i18n MsZyH5 = "Waiting on results" / zh-Hans「正在等待结果」(chunk-shared-DwNCHcV3)
//   eager-app bb.waiting_on_command → MsZyH5
// 0.18 maps Await tools through Ja("waiting","Waiting on a command",…).
// This pass rewrites that English literal once; main-i18n's RLocActivityTextZh
// key must match (updated to Waiting on results / 正在等待结果).
//
// Order: before main-i18n (and before working-status-phrases is fine — different anchors).

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const BEFORE = 'return Ja("waiting","Waiting on a command","hourglass")';
const AFTER = 'return Ja("waiting","Waiting on results","hourglass")';

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) {
    throw new Error(`waiting-on-results ${label} anchor missing or ambiguous.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchWaitingOnResults(source) {
  const patched = replaceExactlyOnce(source, BEFORE, AFTER, "Ja waiting");
  if (patched.includes('"Waiting on a command"')) {
    // Task / other agents still use "Waiting on another agent" — only the command string must go.
    if (patched.includes('Ja("waiting","Waiting on a command"')) {
      throw new Error("waiting-on-results left a Waiting on a command Ja call.");
    }
  }
  if (!patched.includes(AFTER)) {
    throw new Error("waiting-on-results did not insert Waiting on results.");
  }
  return patched;
}

export async function applyOriginalRendererWaitingOnResults({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const candidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(BEFORE)) candidates.push({ name, target, source });
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected one chunk with Waiting on a command Ja call, found ${candidates.length}.`);
  }
  const candidate = candidates[0];
  const patched = patchWaitingOnResults(candidate.source);
  await writeFile(candidate.target, patched);
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-waiting-on-results",
    upstream: { version: "0.71.2", messageId: "MsZyH5", en: "Waiting on results", zhHans: "正在等待结果" },
    chunks: [
      {
        role: "activity-verb",
        path: `dist/renderer/assets/${candidate.name}`,
        original: { bytes: Buffer.byteLength(candidate.source), sha256: createHash("sha256").update(candidate.source).digest("hex") },
        patched: { bytes: Buffer.byteLength(patched), sha256: createHash("sha256").update(patched).digest("hex") },
      },
    ],
    transformations: ["Ja-waiting-Waiting-on-results"],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-waiting-on-results-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
