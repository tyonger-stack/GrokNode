import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function bundle(entry, outName) {
  const out = path.join(repoRoot, "node_modules", ".cache", outName);
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true, platform: "node", format: "cjs", outfile: out,
    logLevel: "error", external: ["node:*"],
  });
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)(out);
}

const { ArtifactTranscriptOccurrenceDeriver } = await bundle(
  "source/host/transcript-mirror/transcript-occurrence-deriver.ts",
  "occurrence-deriver.cjs",
);

async function loadMirror() {
  const dir = await mkdtemp(path.join(tmpdir(), "grok-mirror-module-"));
  const outfile = path.join(dir, "mirror.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/host/transcript-mirror/transcript-mirror.ts")],
    bundle: true, platform: "node", format: "esm", outfile,
    logLevel: "error",
    plugins: [{ name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\..*\.js$/ }, (args) => ({ path: path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")) })); } }],
  });
  try {
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Minimal in-memory codec + store: turns and steps are plain JS objects the
// fake codec serializes with JSON. Same contract as the protobuf codec.
// Every encode.* call registers a FRESH blob id, so two calls with identical
// arguments are byte-unequal exactly like re-encoded protobuf messages.
function makeFixture() {
  const blobs = new Map();
  const userBlob = Buffer.from("user-message-fixed");
  blobs.set(userBlob.toString(), JSON.stringify({ text: "background task completed" }));
  let next = 1;
  const put = (value) => {
    const key = String(next++);
    blobs.set(key, typeof value === "string" ? value : JSON.stringify(value));
    return Buffer.from(key);
  };
  const codec = {
    decodeTurn(bytes) { return JSON.parse(Buffer.from(bytes).toString()); },
    decodeUserMessage(bytes) { return JSON.parse(Buffer.from(bytes).toString()); },
    decodeStep(bytes) { return JSON.parse(Buffer.from(bytes).toString()); },
  };
  const store = {
    async getBlob(_context, id) {
      const key = typeof id === "string" ? id : Buffer.from(id).toString();
      const hit = blobs.get(key);
      if (hit === undefined) throw new Error(`fixture miss: ${key}`);
      return typeof hit === "string" ? Buffer.from(hit) : hit;
    },
  };
  const encode = {
    userMessage() { return userBlob; },
    agentTurn(userMessage, steps) { return put({ case: "agent", userMessage: userMessage.toString(), steps: steps.map((id) => id.toString()) }); },
    assistant(text) { return put({ case: "assistant", text }); },
    tool(name, input, result) {
      return put({ case: "tool", name, input, ...(result === undefined ? {} : { result }) });
    },
  };
  const deriver = new ArtifactTranscriptOccurrenceDeriver(codec);
  return { deriver, codec, store, encode, blobs, put };
}

async function deriveTurn(fx, currentBlobId, previousBlobId, finalizeTurn = true, deferred) {
  return fx.deriver.deriveTurn({}, fx.store, 0, currentBlobId, previousBlobId, finalizeTurn, deferred);
}

const ids = (out) => out.occurrences.map((o) => o.id);

test("a redispatched turn re-emitting a completed tool call follows the new result", async () => {
  const fx = makeFixture();
  const callInput = { path: "/tmp/report.md" };

  const stepsA = [fx.encode.tool("write_file", callInput, { ok: true })];
  const turnA = fx.encode.agentTurn(fx.encode.userMessage(), stepsA);
  const stepsB = [fx.encode.tool("write_file", callInput, { ok: true, retried: true })];
  const turnB = fx.encode.agentTurn(fx.encode.userMessage(), stepsB);

  const out = await deriveTurn(fx, turnB, turnA);
  assert.deepEqual(ids(out), ["turn:0:step:0:tool-result"], "only the new completion is emitted; the tool-use line is already in the journal");
  assert.match(out.occurrences[0].line, /retried/, `the mirror must follow the new checkpoint, got: ${out.occurrences[0].line}`);
});

test("a redispatched call that has not completed yet emits nothing and waits", async () => {
  const fx = makeFixture();
  const callInput = { path: "/tmp/report.md" };

  const stepsA = [fx.encode.tool("write_file", callInput, { ok: true })];
  const turnA = fx.encode.agentTurn(fx.encode.userMessage(), stepsA);
  const stepsB = [fx.encode.tool("write_file", callInput)]; // re-issued, no result yet
  const turnB = fx.encode.agentTurn(fx.encode.userMessage(), stepsB);

  const out = await deriveTurn(fx, turnB, turnA);
  assert.deepEqual(ids(out), [], "the re-issued call without a result must not fail the checkpoint");
});

test("a different tool call at the divergence point is emitted fresh", async () => {
  const fx = makeFixture();

  const stepsA = [fx.encode.tool("write_file", { path: "/a" }, { ok: true })];
  const turnA = fx.encode.agentTurn(fx.encode.userMessage(), stepsA);
  const stepsB = [fx.encode.tool("write_file", { path: "/b" }, { ok: true })]; // input mutated
  const turnB = fx.encode.agentTurn(fx.encode.userMessage(), stepsB);

  const out = await deriveTurn(fx, turnB, turnA);
  assert.deepEqual(ids(out), [
    "turn:0:step:0:tool-use",
    "turn:0:step:0:tool-result",
  ], "a diverging call belongs to the new attempt and is emitted in full");
  assert.match(out.occurrences[0].line, /"path":"\/b"/);
});

test("a multi-step redispatch survives every commit of its lifecycle", async () => {
  const fx = makeFixture();
  const writeInput = { path: "/tmp/report.md" };

  // First attempt: two completed calls plus a summary, all committed.
  const stepsA = [
    fx.encode.tool("write_file", writeInput, { ok: true }),
    fx.encode.tool("read_file", { path: "/tmp/x" }, { data: "x" }),
    fx.encode.assistant("attempt one summary"),
  ];
  const turnA = fx.encode.agentTurn(fx.encode.userMessage(), stepsA);

  // Commit 1 — redispatch reset: the new attempt has only re-issued the
  // first call. This is the shape that used to die with
  // "durable agent steps moved backwards".
  const stepsB1 = [fx.encode.tool("write_file", writeInput)];
  const turnB1 = fx.encode.agentTurn(fx.encode.userMessage(), stepsB1);
  const out1 = await deriveTurn(fx, turnB1, turnA);
  assert.deepEqual(ids(out1), [], "the re-issued call waits for its completion");

  // Commit 2 — the call completes again with a fresh result.
  const stepsB2 = [fx.encode.tool("write_file", writeInput, { ok: true, retried: true })];
  const turnB2 = fx.encode.agentTurn(fx.encode.userMessage(), stepsB2);
  const out2 = await deriveTurn(fx, turnB2, turnB1);
  assert.deepEqual(ids(out2), ["turn:0:step:0:tool-result"]);
  assert.match(out2.occurrences[0].line, /retried/);

  // Commit 3 — the new attempt finishes with text (byte-equal prefix + new tail).
  const stepsB3 = [stepsB2[0], fx.encode.tool("read_file", { path: "/tmp/x" }, { data: "x" }), fx.encode.assistant("attempt two summary")];
  const turnB3 = fx.encode.agentTurn(fx.encode.userMessage(), stepsB3);
  const out3 = await deriveTurn(fx, turnB3, turnB2);
  assert.deepEqual(ids(out3), [
    "turn:0:step:1:tool-use",
    "turn:0:step:1:tool-result",
    "turn:0:step:2:text",
  ], "steps past the byte-equal prefix are emitted fresh");
});

test("a turn shrunk to a byte-equal prefix emits nothing", async () => {
  const fx = makeFixture();
  const step0 = fx.encode.tool("write_file", { path: "/a" }, { ok: true });
  const step1 = fx.encode.assistant("summary");

  const turnA = fx.encode.agentTurn(fx.encode.userMessage(), [step0, step1]);
  const turnB = fx.encode.agentTurn(fx.encode.userMessage(), [step0]); // same blob id

  const out = await deriveTurn(fx, turnB, turnA);
  assert.deepEqual(ids(out), [], "a strict prefix has nothing new to say");
});

test("a step changing kind at the divergence point follows the new attempt", async () => {
  const fx = makeFixture();
  const stepsA = [fx.encode.tool("write_file", { path: "/a" }, { ok: true })];
  const turnA = fx.encode.agentTurn(fx.encode.userMessage(), stepsA);
  const stepsB = [fx.encode.assistant("skipped the tool this time")];
  const turnB = fx.encode.agentTurn(fx.encode.userMessage(), stepsB);

  const out = await deriveTurn(fx, turnB, turnA);
  assert.deepEqual(ids(out), ["turn:0:step:0:text"]);
});

test("an unfinalized text tail stays deferred and is emitted on the next pass", async () => {
  const fx = makeFixture();
  const call = fx.encode.tool("write_file", { path: "/a" }, { ok: true });
  const text = fx.encode.assistant("partial answer");

  const turnA = fx.encode.agentTurn(fx.encode.userMessage(), [call]);
  const turnB = fx.encode.agentTurn(fx.encode.userMessage(), [call, text]);

  const out1 = await deriveTurn(fx, turnB, turnA, false);
  assert.deepEqual(ids(out1), [], "the text tail is held back while the turn is live");
  assert.deepEqual(out1.deferredStep, { turnIndex: 0, stepIndex: 1 });

  const out2 = await deriveTurn(fx, turnB, turnA, true, out1.deferredStep);
  assert.deepEqual(ids(out2), ["turn:0:step:1:text"], "the deferred cursor re-derives exactly the held-back tail");
});

test("guards that were NOT relaxed still reject: user message changed", async () => {
  const fx = makeFixture();
  const stepsA = [fx.encode.tool("write_file", { path: "/a" }, { ok: true })];
  const turnA = fx.encode.agentTurn(fx.encode.userMessage(), stepsA);
  const otherUser = fx.put(JSON.stringify({ text: "a different message" }));
  const turnB = fx.encode.agentTurn(otherUser, stepsA);

  await assert.rejects(
    deriveTurn(fx, turnB, turnA),
    /durable agent user message changed after checkpoint/,
  );
});

test("the original healthy path is unchanged: first result emission still works", async () => {
  const fx = makeFixture();
  const steps = [fx.encode.tool("read_file", { path: "/a" }, { data: "x" })];
  const turn = fx.encode.agentTurn(fx.encode.userMessage(), steps);

  const out = await deriveTurn(fx, turn, undefined);
  assert.deepEqual(ids(out), [
    "turn:0:user",
    "turn:0:step:0:tool-use",
    "turn:0:step:0:tool-result",
  ]);
});

test("a redispatch survives the real mirror: journal keeps both attempts in order", async () => {
  const { FileTranscriptMirror } = await loadMirror();
  const fx = makeFixture();
  const deriver = new ArtifactTranscriptOccurrenceDeriver(fx.codec);
  const dir = await mkdtemp(path.join(tmpdir(), "grok-journal-redispatch-"));
  try {
    const mirror = new FileTranscriptMirror(dir, () => {}, deriver);
    const id = "agent-1";
    await mkdir(path.join(dir, id), { recursive: true });
    await writeFile(path.join(dir, id, `${id}.journal-mode`), "1\n");

    const callInput = { path: "/tmp/report.md" };
    // Attempt one commits a completed call; the mirror initializes from it.
    const turnA = fx.encode.agentTurn(fx.encode.userMessage(), [
      fx.encode.tool("write_file", callInput, { ok: true }),
    ]);
    await mirror.prepareCheckpoint({}, id, { turns: [turnA] }, fx.store, true);
    await mirror.commitCheckpoint({}, id);

    // Redispatch reset: the re-issued call has no result yet. The checkpoint
    // must prepare (with zero new lines) instead of failing the turn.
    const turnB1 = fx.encode.agentTurn(fx.encode.userMessage(), [
      fx.encode.tool("write_file", callInput),
    ]);
    const reset = await mirror.prepareCheckpoint({}, id, { turns: [turnB1] }, fx.store, false);
    assert.equal(reset.entryCount, 0, "the reset commit must not fail the checkpoint");
    await mirror.commitCheckpoint({}, id);

    // The call completes again with a fresh result.
    const turnB2 = fx.encode.agentTurn(fx.encode.userMessage(), [
      fx.encode.tool("write_file", callInput, { ok: true, retried: true }),
    ]);
    const completion = await mirror.prepareCheckpoint({}, id, { turns: [turnB2] }, fx.store, false);
    assert.equal(completion.entryCount, 1);
    await mirror.commitCheckpoint({}, id);

    const journal = await readFile(path.join(dir, id, `${id}.jsonl`), "utf8");
    const lines = journal.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((line) => line.message.content[0].type), [
      "text", "tool_use", "tool_result", "tool_result",
    ], "the journal keeps the abandoned attempt's completion followed by the retry's");
    assert.deepEqual(lines[2].message.content[0].result, { ok: true });
    assert.deepEqual(lines[3].message.content[0].result, { ok: true, retried: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
