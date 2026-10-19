import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawFixture = JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "library-parity-raw-transcript.json"), "utf8"));
const golden = JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "library-parity-golden.json"), "utf8"));

async function loadModule() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "source/host/extensions/library/transcript-media.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}

function materialize(fixtureEntries, now) {
  return fixtureEntries.map((entry) => {
    const out = { ...entry };
    if (entry.kind === "send-message" || entry.kind === "message" || entry.kind === "user-attachment") {
      out.timestampMs = entry.tsOffsetMs == null ? null : now + entry.tsOffsetMs;
    }
    delete out.tsOffsetMs;
    return out;
  });
}

test("golden fixture: ids, kinds and names match the frozen original transcription", async () => {
  const media = await loadModule();
  const now = Date.now();
  const rows = media.extractTranscriptMedia(materialize(rawFixture.entries, now));
  assert.deepEqual(rows.map((row) => row.id), golden.derivedGolden.mediaReversedIds);
  assert.deepEqual(rows.map((row) => row.kind), golden.derivedGolden.mediaKinds);
  assert.deepEqual(rows.map((row) => (row.kind === "link" ? "" : row.name)), golden.derivedGolden.mediaNames);
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(byId.get("e_old:visual:file:///home/box/agent-data/agents/agent-1/attachments/imgA.webp").name, "HgJXYXWJ");
  const link = byId.get("e_link:link:https://example.com/reports/q3.pdf");
  assert.equal(link.url, "https://example.com/reports/q3.pdf");
  assert.ok(!("name" in link));
});

test("user uploads, duplicates, malformed and injected content are handled", async () => {
  const media = await loadModule();
  const rows = media.extractTranscriptMedia([
    { id: "u1", kind: "user-attachment", file_path: "file:///a/shared.webp", file_name: "shared.webp" },
    { id: "m1", kind: "message", role: "user", images: [{ url: "file:///a/shared.webp" }] },
    { id: "b1", kind: "send-message", timestampMs: 5, message: { type: "text", content: "x", images: [{ url: "file:///a/shared.webp", alt: "mine" }] } },
    { id: "b2", kind: "send-message", timestampMs: 6, message: { type: "text", content: "x", images: [{ url: "file:///a/once.png", alt: "  " }, { url: "file:///a/once.png", alt: "twice" }] } },
    { id: "bad", kind: "send-message", timestampMs: 7, message: null },
    { id: "inj", kind: "send-message", timestampMs: 8, message: { type: "text", content: "hi", images: [{ url: "file:///a/evil.webp", alt: "[x](https://evil.example) <script>" }] } },
    { id: "sys", kind: "session", timestampMs: 9 },
  ]);
  assert.deepEqual(rows.map((row) => row.id), [
    "inj:visual:file:///a/evil.webp",
    "b2:visual:file:///a/once.png",
  ]);
  assert.equal(rows[0].name, "[x](https://evil.example) <script>");
  assert.equal(rows[1].name, "once.png");
});

test("source normalization treats one file as one source across spellings", async () => {
  const media = await loadModule();
  assert.equal(media.normalizeMediaSource("  file:///a/My%20Pic.png?x=1  "), "/a/My Pic.png");
  assert.equal(media.normalizeMediaSource("https://example.com/a b"), "https://example.com/a b");
  assert.equal(media.isVideoSource("file:///a/clip.mp4"), true);
  assert.equal(media.isVideoSource("file:///a/imgA.webp"), false);
  assert.equal(media.isBotMediaEntry({ id: "x", kind: "send-message" }), true);
  assert.equal(media.isBotMediaEntry({ id: "x", kind: "message", role: "assistant" }), true);
});

 test("local attachment omission regression", async () => {
  const media = await loadModule();
  assert.deepEqual(media.extractTranscriptMedia([{id:"pdf",kind:"send-message",message:{type:"attachment",url:"file:///a/report.pdf",file_name:"Report"}}]), [{id:"pdf:file:file:///a/report.pdf",kind:"file",timestampMs:null,source:"file:///a/report.pdf",name:"Report"}]);
});

test("R7a source-backed counterexamples match original FRe rows", async () => {
  const media = await loadModule();
  assert.deepEqual(media.extractTranscriptMedia(rawFixture.r7aCounterexamples), golden.r7aExpected);
});

test("conversation media includes uploaded DOCX and deduplicates a bot echo of its file URI", async () => {
  const media = await loadModule();
  const entries = [
    { id: "upload", kind: "user-attachment", timestampMs: 4, file_path: "file:///workspace/Report%20v2.docx", file_name: "Report v2.docx" },
    { id: "echo", kind: "send-message", timestampMs: 5, message: { type: "attachment", url: "/workspace/Report v2.docx", file_name: "Echo" } },
  ];
  const rows = media.extractConversationMedia(entries);
  assert.deepEqual(rows, [{ id: "upload:file:file:///workspace/Report%20v2.docx", kind: "file", timestampMs: 4, source: "file:///workspace/Report%20v2.docx", name: "Report v2.docx" }]);
});

test("conversation media includes uploaded images while preserving returned artifact boundaries", async () => {
  const media = await loadModule();
  const entries = [
    { id: "image", kind: "user-attachment", timestampMs: 6, file_path: "file:///workspace/shot.png", file_name: "My screenshot" },
    { id: "image-echo", kind: "message", role: "user", images: [{ url: "file:///workspace/shot.png" }] },
    { id: "returned", kind: "send-message", author: { kind: "cloud-agent" }, message: { type: "attachment", url: "file:///workspace/returned.docx" } },
    { id: "empty", kind: "user-attachment", file_path: "" },
  ];
  const rows = media.extractConversationMedia(entries);
  assert.deepEqual(rows, [{ id: "image:visual:file:///workspace/shot.png", kind: "image", timestampMs: 6, source: "file:///workspace/shot.png", name: "My screenshot" }]);
});

test("unstamped user-attachment inherits the latest prior entry timestampMs", async () => {
  const media = await loadModule();
  const rows = media.extractConversationMedia([
    { id: "m1", kind: "message", role: "user", timestampMs: 1_700_000_000_000, content: "hi" },
    { id: "u1", kind: "user-attachment", file_path: "file:///a/today.pdf", file_name: "today.pdf" },
    { id: "m2", kind: "send-message", timestampMs: 1_700_000_100_000, message: { type: "text", content: "ok" } },
  ]);
  assert.deepEqual(rows, [{
    id: "u1:file:file:///a/today.pdf",
    kind: "file",
    timestampMs: 1_700_000_000_000,
    source: "file:///a/today.pdf",
    name: "today.pdf",
  }]);
});

test("unstamped user-attachment stays null when no prior stamped entry exists", async () => {
  const media = await loadModule();
  const rows = media.extractConversationMedia([
    { id: "u1", kind: "user-attachment", file_path: "file:///a/orphan.pdf", file_name: "orphan.pdf" },
  ]);
  assert.equal(rows[0]?.timestampMs, null);
});

test("unstamped bot artifacts do not inherit an unrelated prior timestamp", async () => {
  const media = await loadModule();
  const rows = media.extractConversationMedia([
    { id: "m1", kind: "message", role: "user", timestampMs: 1_700_000_000_000, content: "hi" },
    { id: "b1", kind: "send-message", message: { type: "attachment", url: "file:///a/unknown.pdf", file_name: "unknown.pdf" } },
  ]);
  assert.equal(rows[0]?.timestampMs, null);
});
