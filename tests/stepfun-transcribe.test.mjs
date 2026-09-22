import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let cached;

async function loadModule() {
  if (cached != null) return cached;
  const dir = await mkdtemp(path.join(tmpdir(), "grok-stepfun-"));
  const outfile = path.join(dir, "stepfun.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/electron-main/account/stepfun-transcribe.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    plugins: [{ name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\..*\.js$/ }, (args) => ({ path: path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")) })); } }]
  });
  cached = await import(pathToFileURL(outfile).href);
  return cached;
}

function sse(events) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); }
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("stepfun transcription accumulates deltas and prefers the done text", async () => {
  const { transcribeWithStepFun } = await loadModule();
  process.env.STEPFUN_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return sse([
      { type: "transcript.text.delta", delta: "你好，这是" },
      { type: "transcript.text.delta", delta: "一段测试。" },
      { type: "transcript.text.done", text: "你好，这是一段测试。" }
    ]);
  };
  try {
    const result = await transcribeWithStepFun({ audio: new Uint8Array([1, 2, 3]), mimeType: "audio/wav", language: "zh-CN" });
    assert.equal(result.text, "你好，这是一段测试。");
    const request = JSON.parse(requests[0].init.body);
    assert.equal(request.audio.input.transcription.model, "stepaudio-2.5-asr");
    assert.equal(request.audio.input.transcription.language, "zh");
    assert.equal(request.audio.input.transcription.enable_itn, true);
    assert.deepEqual(request.audio.input.format, { type: "wav", codec: "pcm_s16le", rate: 16000, bits: 16, channel: 1 });
    assert.equal(request.audio.data, Buffer.from([1, 2, 3]).toString("base64"));
    assert.equal(requests[0].init.headers.authorization, "Bearer test-key");
    assert.match(requests[0].url, /\/audio\/asr\/sse$/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.STEPFUN_API_KEY;
  }
});

test("stepfun transcription falls back to accumulated deltas without a done event", async () => {
  const { transcribeWithStepFun } = await loadModule();
  process.env.STEPFUN_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => sse([
    { type: "transcript.text.delta", delta: "hello " },
    { type: "transcript.text.delta", delta: "world" }
  ]);
  try {
    const result = await transcribeWithStepFun({ audio: new Uint8Array([9]), mimeType: "audio/webm;codecs=opus" });
    assert.equal(result.text, "hello world");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.STEPFUN_API_KEY;
  }
});

test("stepfun transcription reports upstream failures and a missing key", async () => {
  const { transcribeWithStepFun } = await loadModule();
  const originalFetch = globalThis.fetch;
  delete process.env.STEPFUN_API_KEY;
  await assert.rejects(() => transcribeWithStepFun({ audio: new Uint8Array([1]), mimeType: "audio/wav", credential: "" }), /needs an API key/);
  process.env.STEPFUN_API_KEY = "test-key";
  globalThis.fetch = async () => new Response("bad key", { status: 401 });
  try {
    await assert.rejects(() => transcribeWithStepFun({ audio: new Uint8Array([1]), mimeType: "audio/wav" }), /401: bad key/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.STEPFUN_API_KEY;
  }
});

test("stepfun audio format maps recorder mime types to declared containers", async () => {
  const { stepFunAudioFormat } = await loadModule();
  assert.deepEqual(stepFunAudioFormat("audio/webm;codecs=opus"), { type: "wav", codec: "pcm_s16le", rate: 16000, bits: 16, channel: 1 });
  assert.deepEqual(stepFunAudioFormat("audio/mp4"), { type: "mp4", codec: "aac", rate: 44100, bits: 16, channel: 1 });
  assert.deepEqual(stepFunAudioFormat("audio/wav"), { type: "wav", codec: "pcm_s16le", rate: 16000, bits: 16, channel: 1 });
});
