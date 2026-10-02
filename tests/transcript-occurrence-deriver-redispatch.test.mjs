import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

// Minimal in-memory codec + store: turns and steps are plain JS objects the
// fake codec serializes with JSON. Same contract as the protobuf codec.
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
    userMessage(_text) { return userBlob; },
    agentTurn(userMessage, steps) { return put({ case: "agent", userMessage, steps }); },
    assistant(text) { return put({ case: "assistant", text }); },
    tool(name, input, result) {
      return put({ case: "tool", name, input, ...(result === undefined ? {} : { result }) });
    },
  };
  const requiredBlob = (context, storeRef, id) => storeRef.getBlob(id.toString());
  const deriver = new ArtifactTranscriptOccurrenceDeriver(codec);
  // The deriver's requiredBlob is internal; expose blobs through the store and
  // let the deriver resolve them by identity (it passes the store through).
  return { deriver, store, encode, blobs, put, requiredBlob };
}


async function deriveTurn(fx, currentBlobId, previousBlobId, finalizeTurn = true) {
  // The real deriver resolves blobs through its own requiredBlob helper bound
  // to the store passed at call time, so the fixture store works as-is.
  return fx.deriver.deriveTurn({}, fx.store, 0, currentBlobId, previousBlobId, finalizeTurn);
}

test("a redispatched turn re-emitting a completed tool call follows the new result", async () => {
  const fx = makeFixture();
  const user = fx.encode.userMessage("background task completed");
  const callInput = { path: "/tmp/report.md" };

  // First attempt: tool call completed with result A, checkpoint committed.
  const stepsA = [fx.encode.tool("write_file", callInput, { ok: true })];
  const turnA = fx.encode.agentTurn(fx.encode.userMessage("bg done"), stepsA);

  // Redispatch: same call re-issued, completed with result B.
  const stepsB = [fx.encode.tool("write_file", callInput, { ok: true, retried: true })];
  const turnB = fx.encode.agentTurn(fx.encode.userMessage("bg done"), stepsB);

  const out = await deriveTurn(fx, turnB, turnA);
  const results = out.occurrences.filter((o) => o.id.endsWith("tool-result"));
  assert.equal(results.length, 1, "the new result must be emitted");
  assert.match(results[0].line, /retried/, `the mirror must follow the new checkpoint, got: ${results[0].line}`);
});

test("a redispatched call that has not completed yet still throws (stale completion cannot be dropped)", async () => {
  const fx = makeFixture();
  const user = fx.encode.userMessage("background task completed");
  const callInput = { path: "/tmp/report.md" };

  const stepsA = [fx.encode.tool("write_file", callInput, { ok: true })];
  const turnA = fx.encode.agentTurn(fx.encode.userMessage("bg done"), stepsA);
  const stepsB = [fx.encode.tool("write_file", callInput)]; // re-issued, no result yet
  const turnB = fx.encode.agentTurn(fx.encode.userMessage("bg done"), stepsB);

  await assert.rejects(
    deriveTurn(fx, turnB, turnA),
    /completed durable tool call changed after checkpoint/,
  );
});

test("a changed tool call at the tail still throws (name or input mutated)", async () => {
  const fx = makeFixture();
  const user = fx.encode.userMessage("background task completed");

  const stepsA = [fx.encode.tool("write_file", { path: "/a" }, { ok: true })];
  const turnA = fx.encode.agentTurn(fx.encode.userMessage("bg done"), stepsA);
  const stepsB = [fx.encode.tool("write_file", { path: "/b" }, { ok: true })]; // input mutated
  const turnB = fx.encode.agentTurn(fx.encode.userMessage("bg done"), stepsB);

  await assert.rejects(
    deriveTurn(fx, turnB, turnA),
    /durable tool call changed after checkpoint/,
  );
});

test("the original healthy path is unchanged: first result emission still works", async () => {
  const fx = makeFixture();
  const user = fx.encode.userMessage("background task completed");
  const steps = [fx.encode.tool("read_file", { path: "/a" }, { data: "x" })];
  const turn = fx.encode.agentTurn(fx.encode.userMessage("bg done"), steps);

  const out = await deriveTurn(fx, turn, undefined);
  const kinds = out.occurrences.map((o) => o.id.split(":").pop());
  assert.deepEqual(kinds, ["user", "tool-use", "tool-result"]);
});
