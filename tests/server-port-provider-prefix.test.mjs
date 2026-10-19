import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundleServerPort } from "./server-port-bundle.mjs";

const m = await bundleServerPort(["host/extensions/inference/provider-session", "host/runner/prompt-prefix-observation"], [{
  name: "synthetic-provider-boundary", setup(builder) {
    builder.onResolve({ filter: /^(ai|@ai-sdk\/openai)$/ }, args => ({ path: args.path, namespace: "synthetic-provider" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic-provider" }, args => ({ loader: "js", contents: args.path === "ai"
      ? "export const jsonSchema = value => ({jsonSchema:value}); export const tool = value => value; export const streamText = args => globalThis.__serverPortProvider(args);"
      : "export const createOpenAI = () => ({chat:() => ({})});" }));
  },
}]);

test("actual provider executor observes requests and preserves upstream cached prompt tokens", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "prefix-provider-"));
  const keys = ["SAND_DATA_ROOT", "SAND_OPENROUTER_MODEL", "OPENROUTER_API_KEY"], previous = new Map(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  t.after(async () => { for (const key of keys) { const value = previous.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    globalThis.fetch = originalFetch; delete globalThis.__serverPortProvider; await rm(dir, { recursive: true, force: true }); });
  process.env.SAND_DATA_ROOT = dir; process.env.SAND_OPENROUTER_MODEL = "test/model"; process.env.OPENROUTER_API_KEY = "synthetic-key";
  globalThis.fetch = () => { throw new Error("External network forbidden in this fixture"); };
  let called = 0;
  globalThis.__serverPortProvider = () => {
    called++;
    return { fullStream: (async function* () { yield { type: "text-delta", textDelta: "synthetic reply" }; yield { type: "finish", finishReason: "stop" }; })(),
      usage: Promise.resolve({ promptTokens: 100, completionTokens: 3, totalTokens: 103 }), response: Promise.resolve({ id: "synthetic" }),
      providerMetadata: Promise.resolve({ openai: { cachedPromptTokens: 64 } }) };
  };
  const snapshots = new Map(), reports = [];
  const prefixObserver = m.createPromptPrefixObserver({ snapshots: () => ({ getPromptSectionSnapshot: key => snapshots.get(key), setPromptSectionSnapshot: (key, value) => snapshots.set(key, value) }),
    compactionEpoch: () => 0, sections: () => [], report: value => reports.push(value) });
  const executor = m.createProviderPromptSession("openrouter", { agentId: "synthetic-agent", prefixObserver }).getExecutor();
  executor.appendMessages([{ role: "system", content: "PRIVATE-SYSTEM" }, { role: "user", content: "PRIVATE-QUESTION" }]);
  const result = executor.stream(undefined, "synthetic-request", [{ name: "Read", parameters: { type: "object", properties: {} } }]);
  let chunks = 0;
  for await (const chunk of result.fullStream) { assert.ok(chunk); chunks++; }
  assert.equal(chunks, 2);
  assert.equal((await result.extendedUsage).cacheReadTokens, 64);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(called, 1); assert.equal(reports.find(report => report.phase === "usage").cacheReadTokens, 64);
  assert.ok(!JSON.stringify(reports).includes("PRIVATE"));
});
