import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let cached;

async function loadJournal() {
  if (cached != null) return cached;
  const dir = await mkdtemp(path.join(tmpdir(), "grok-journal-module-"));
  const outfile = path.join(dir, "journal.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/host/transcript-mirror/transcript-mirror.ts")],
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

const deriver = {
  async derive(_ctx, _store, previous, checkpoint) {
    return { occurrences: checkpoint.turns.slice(previous.turns.length).map((turn, index) => ({ id: `t${previous.turns.length + index}`, line: JSON.stringify({ role: "user", message: { content: [{ type: "text", text: Buffer.from(turn).toString("utf8") }] } }) })) };
  },
  async initial(_ctx, _store, checkpoint) {
    return checkpoint.turns.map((turn, index) => ({ id: `t${index}`, line: JSON.stringify({ role: "user", message: { content: [{ type: "text", text: Buffer.from(turn).toString("utf8") }] } }) }));
  }
};

test("a journal-owned conversation prepares its first checkpoint without an explicit recover", async () => {
  const { FileTranscriptMirror } = await loadJournal();
  const dir = await mkdtemp(path.join(tmpdir(), "grok-journal-"));
  try {
    const mirror = new FileTranscriptMirror(dir, () => {}, deriver);
    const id = "agent-1";
    await mkdir(path.join(dir, id), { recursive: true });
    await writeFile(path.join(dir, id, `${id}.journal-mode`), "1\n");
    assert.equal(await mirror.ownsConversation(id), true);
    const first = { turns: [new TextEncoder().encode("hello")] };
    const prepared = await mirror.prepareCheckpoint({}, id, first, {});
    assert.equal(prepared.entryCount, 0);
    await mirror.commitCheckpoint({}, id);
    const second = { turns: [new TextEncoder().encode("hello"), new TextEncoder().encode("world")] };
    const again = await mirror.prepareCheckpoint({}, id, second, {});
    assert.equal(again.entryCount, 1);
    await mirror.commitCheckpoint({}, id);
    const journal = await readFile(path.join(dir, id, `${id}.jsonl`), "utf8");
    assert.equal(journal.trim().split("\n").length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
