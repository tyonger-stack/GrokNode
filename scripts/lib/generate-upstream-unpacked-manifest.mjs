import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { statFile } from "@electron/asar";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const { values } = parseArgs({
  options: {
    version: { type: "string" },
  },
});
const version = values.version;
if (!version || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
  throw new Error("usage: node scripts/lib/generate-upstream-unpacked-manifest.mjs --version <x.y.z>");
}
const compact = version.replaceAll(".", "");

const asarPath = path.resolve(repoRoot, `../rea-grokbot-${compact}/asar/app.asar`);
const outputPath = path.join(repoRoot, `manifests/ports/grokbot-${compact}-unpacked.json`);

const NATIVE_PATHS = [
  "dist/deps/sand-notification-settings/build/Release/sand_notification_settings.node",
  "dist/deps/sand-window-capture/build/Release/sand_window_capture.node",
  "dist/deps/sand-card-text-recognition/build/Release/sand_card_text_recognition.node",
  "dist/deps/sand-devicecheck/build/Release/sand_devicecheck.node",
];

const files = [];
for (const relative of NATIVE_PATHS) {
  const info = statFile(asarPath, relative);
  if (!info.unpacked) throw new Error(`Upstream artifact is not unpacked: ${relative}`);
  if (info.integrity?.algorithm !== "SHA256" || !info.integrity.hash) {
    throw new Error(`Upstream artifact has no SHA-256 declaration: ${relative}`);
  }
  const bytes = await readFile(path.join(`${asarPath}.unpacked`, relative));
  files.push({ path: relative, sha256: sha256(bytes), asarDeclaredSha256: info.integrity.hash });
}

const manifest = {
  schemaVersion: 1,
  version,
  source: `rea-grokbot-${compact}/asar/app.asar.unpacked`,
  integritySource: "captured-unpacked-bytes",
  files,
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${outputPath} (${files.length} native artifacts)`);
