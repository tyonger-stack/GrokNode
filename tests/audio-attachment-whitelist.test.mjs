/**
 * P2-4: send audio attachments — official AUDIO_MIME_FROM_EXTENSION + preview/kind paths.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const cacheDir = path.join(root, "node_modules", ".cache");
await mkdir(cacheDir, { recursive: true });

const OFFICIAL_AUDIO = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".weba": "audio/webm",
};

const jsToTs = {
  name: "js-to-ts",
  setup(builder) {
    builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
      const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
      return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null;
    });
  },
};

async function load(entry, name) {
  const outfile = path.join(cacheDir, `${name}-audio-whitelist.cjs`);
  await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    logLevel: "error",
    plugins: [jsToTs],
    external: ["electron"],
  });
  return createRequire(import.meta.url)(outfile);
}

const media = await load("source/shared/media/media-extensions.ts", "media-ext");
const mime = await load("source/shared/media/image-mime.ts", "image-mime");
const preview = await load("source/shared/media/file-preview-kind.ts", "preview");
const summary = await load("source/shared/media/attachment-summary.ts", "attach-summary");
const labels = await load("source/shared/media/attachments.ts", "attach-labels");
const sendSchema = await load("source/host/runner/tools/send-message-schema.ts", "send-schema");

test("AUDIO_MIME_FROM_EXTENSION matches official 0.71.2 host-main table", () => {
  assert.deepEqual({ ...media.AUDIO_MIME_FROM_EXTENSION }, OFFICIAL_AUDIO);
});

test("audioMimeFromPath and preview kind cover every official extension", () => {
  for (const [ext, expectedMime] of Object.entries(OFFICIAL_AUDIO)) {
    const file = `/workspace/out/clip${ext}`;
    assert.equal(mime.audioMimeFromPath(file), expectedMime, ext);
    assert.equal(preview.getFilePreviewKind(file), "audio", ext);
    assert.equal(summary.classifyAttachment({ urlOrPath: file }), "audio", ext);
    assert.equal(summary.classifyAttachment({ fileName: `clip${ext}` }), "audio", ext);
  }
  assert.equal(summary.classifyMimeType("audio/mpeg"), "audio");
  assert.equal(mime.audioMimeFromPath("/workspace/out/notes.txt"), undefined);
});

test("attachment sent summary uses audio file wording (ZlwLVh EN)", () => {
  assert.equal(labels.kindPhrase("audio", 1), "1 audio file");
  assert.equal(labels.kindPhrase("audio", 3), "3 audio files");
  assert.equal(labels.formatAttachmentSentSummary(1, [{ kind: "audio", count: 1 }]), "Sent 1 audio file");
});

test("SendMessage attachment URL description mentions audio extensions", async () => {
  const source = await readFile(path.join(root, "source/host/runner/tools/send-message-schema.ts"), "utf8");
  assert.match(source, /Audio files \(\.mp3, \.m4a, \.wav/);
  assert.match(source, /\.aac, \.flac, \.opus, \.weba/);
  // Schema still parses a normal attachment url.
  const parsed = sendSchema.sendMessageParameters.parse({
    type: "attachment",
    url: "file:///workspace/out/clip.mp3",
  });
  assert.equal(parsed.url, "file:///workspace/out/clip.mp3");
});

test("session projection classifies the full audio extension set", async () => {
  const source = await readFile(path.join(root, "source/host/extensions/session/session-projection.ts"), "utf8");
  assert.match(source, /mp3\|wav\|m4a\|ogg\|oga\|opus\|aac\|flac\|weba/);
});
