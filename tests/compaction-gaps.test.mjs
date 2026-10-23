import assert from "node:assert/strict";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(repoRoot, "node_modules/.cache"), { recursive: true });
const temporary = await mkdtemp(path.join(repoRoot, "node_modules/.cache/compaction-gaps-"));
test.after(() => rm(temporary, { recursive: true, force: true }));

async function bundle(entry, name, options = {}) {
  const outfile = path.join(temporary, `${name}.mjs`);
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node26",
    logLevel: "silent",
    packages: "external",
    ...options,
  });
  return import(pathToFileURL(outfile).href);
}

const bg = await bundle(
  "source/packages/agent-summarization/background-summarization.ts",
  "background-summarization",
);
const delivery = await bundle(
  "source/packages/agent-summarization/delivery-tail.ts",
  "delivery-tail",
);
const segments = await bundle(
  "source/packages/agent/self-summary/compaction-segments.ts",
  "compaction-segments",
);
const userMsg = await bundle(
  "source/packages/agent/self-summary/compaction-user-message.ts",
  "compaction-user-message",
);
const catalogDir = path.join(temporary, "catalog");
mkdirSync(catalogDir);
writeFileSync(path.join(catalogDir, "opencodex-catalog.json"), JSON.stringify({ models: [
  { slug: "zai/glm-5.3-flash", context_window: 950_000, auto_compact_token_limit: 855_000 },
  { slug: "small/window", context_window: 32_000, auto_compact_token_limit: 20_000 },
] }));
const proxy = await bundle(
  "source/shared/node/openrouter-proxy.ts",
  "openrouter-proxy",
  { define: { "process.env.CODEX_HOME": JSON.stringify(catalogDir) } },
);

test("localBackgroundSummarizationPropsForWindow starts near 80% and persists near auto-compact", () => {
  const props = bg.localBackgroundSummarizationPropsForWindow(128_000, 115_200);
  assert.equal(props.usedTokensThresholdToStartBackgroundSummarization, 102_400);
  assert.equal(props.usedTokensThresholdToPersistBackgroundSummarization, 115_200);
  assert.equal(bg.shouldStartBackgroundSummarization(102_400, 128_000, props), true);
  assert.equal(bg.shouldStartBackgroundSummarization(102_399, 128_000, props), false);
  assert.equal(bg.shouldPersistBackgroundSummarization(115_200, 128_000, props), true);
  assert.equal(bg.shouldPersistBackgroundSummarization(115_199, 128_000, props), false);
});

test("selectUserDeliveryTail keeps answered send_message pairs after the last user", () => {
  const messages = [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "c1", toolName: "send_message", args: { text: "hello" } }],
    },
    {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "c1", result: "ok" }],
    },
  ];
  const tail = delivery.selectUserDeliveryTail(messages.slice(1), {
    isDeliveryToolCall: delivery.isSandUserDeliveryToolCall,
    maxCalls: 5,
  });
  assert.equal(tail.length, 2);
  assert.equal(tail[0].role, "assistant");
  assert.equal(tail[1].role, "tool");
});

test("selectSelfSummaryDeliveryTail honors trigger reasons", () => {
  const messages = [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "c1", toolName: "send_message", args: {} }],
    },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", result: "ok" }] },
  ];
  const findLast = msgs => {
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user") return i;
    return -1;
  };
  const kept = delivery.selectSelfSummaryDeliveryTail(
    messages,
    { triggerReason: "approaching_token_limit" },
    delivery.SAND_COMPACTION_DELIVERY_TAIL,
    findLast,
  );
  assert.equal(kept.length, 2);
  const skipped = delivery.selectSelfSummaryDeliveryTail(
    messages,
    { triggerReason: "other" },
    delivery.SAND_COMPACTION_DELIVERY_TAIL,
    findLast,
  );
  assert.equal(skipped.length, 0);
});

test("findLastRealUserMessageForCompaction skips synthetic acknowledgements", () => {
  const messages = [
    {
      role: "user",
      content: "<user_query>real task please</user_query>",
      providerOptions: { cursor: {} },
    },
    {
      role: "user",
      content:
        "<user_query>Briefly inform the user about the task result and perform any follow-up actions (if needed).</user_query>",
      providerOptions: { cursor: {} },
    },
  ];
  const last = userMsg.findLastRealUserMessageForCompaction(messages, m =>
    typeof m.content === "string" ? m.content : "",
  );
  assert.ok(last);
  assert.match(String(last.content), /real task please/);
});

test("writeCompactionSegment writes segment_*.md and INDEX.md", async () => {
  const dir = path.join(temporary, "compaction-store");
  const written = segments.writeCompactionSegment({
    compactionDir: dir,
    messages: [
      { role: "user", content: "do the thing" },
      { role: "assistant", content: "done" },
    ],
    rawSummary: "## 8. Current Work\nWorking on FooBarBaz widgets.",
  });
  assert.ok(written);
  assert.equal(written.index, 0);
  assert.ok(existsSync(written.path));
  const index = await readFile(path.join(dir, "INDEX.md"), "utf8");
  assert.match(index, /segment_000\.md/);
  assert.match(index, /FooBarBaz/);
  const hint = segments.formatCompactionSegmentsHint(dir);
  assert.match(hint, /segment_\*\.md/);
  assert.match(hint, /INDEX\.md/);
});

test("host wires model window, background props, and compactionEpoch from archives", () => {
  const source = readFileSync(
    path.join(repoRoot, "source/host/host-runner-composition.ts"),
    "utf8",
  );
  assert.match(source, /resolveInferenceContextWindowTokens/);
  assert.match(source, /localBackgroundSummarizationPropsForWindow/);
  assert.match(source, /agentTokenLimit: inferenceContextWindow/);
  assert.match(source, /backgroundSummarizationPropsOverride: localBackgroundSummarizationProps/);
  assert.match(source, /tokenLimit: catalogContext\?\.autoCompactTokenLimit \?\? Math\.min\(LOCAL_AUTO_COMPACT_TOKEN_LIMIT, Math\.floor\(inferenceContextWindow \* 0\.9\)\)/);
  assert.equal(source.includes("compactionEpoch: () => 0"), false);
  assert.match(source, /summaryArchives\.length/);
});

test("pipeline appends trailingMessages after assembleFinalMessages", () => {
  const source = readFileSync(
    path.join(repoRoot, "source/packages/agent-summarization/pipeline.ts"),
    "utf8",
  );
  assert.match(source, /trailingMessages/);
  assert.match(source, /\.\.\.trailingMessages/);
});

test("orchestrator refuses placeholder summaries", () => {
  const source = readFileSync(
    path.join(repoRoot, "source/packages/agent/summarization-orchestrator.ts"),
    "utf8",
  );
  assert.match(source, /SummaryPlaceholderRejectedError/);
  assert.match(source, /result\.isPlaceholder === true/);
  assert.match(source, /placeholder_summary/);
});

test("readOpenRouterModelContextWindow is exported for catalog windows", () => {
  assert.equal(typeof proxy.readOpenRouterModelContextWindow, "function");
  assert.equal(proxy.readOpenRouterModelContextWindow(undefined), null);
  assert.equal(proxy.readOpenRouterModelContextWindow(""), null);
});

test("bare glm-5.3-flash is direct Z.AI API meta, not TokenHub zai/ catalog", () => {
  const bare = proxy.readOpenRouterModelContextWindow("glm-5.3-flash");
  const prefixed = proxy.readOpenRouterModelContextWindow("zai/glm-5.3-flash");
  assert.ok(bare, "direct coding-paas id must resolve without catalog slug");
  assert.ok(prefixed, "TokenHub slug still uses catalog");
  assert.equal(bare.contextWindow, 1_000_000);
  assert.equal(bare.autoCompactTokenLimit, 120_000);
  assert.equal(prefixed.contextWindow, 950_000);
  assert.equal(prefixed.autoCompactTokenLimit, 120_000);
  const small = proxy.readOpenRouterModelContextWindow("small/window");
  assert.equal(small.contextWindow, 32_000);
  assert.equal(small.autoCompactTokenLimit, 20_000);
  assert.notEqual(bare.contextWindow, prefixed.contextWindow);
  const bareEffort = proxy.readOpenRouterModelReasoning("glm-5.3-flash");
  assert.deepEqual([...bareEffort.levels], ["low", "high", "max"]);
  assert.equal(bareEffort.defaultLevel, "max");
  assert.equal(proxy.effortSupportedByModel("medium", "glm-5.3-flash"), null);
  assert.equal(proxy.effortSupportedByModel("max", "glm-5.3-flash"), "max");
});

for (const condition of ["missing", "malformed"]) {
  test(`direct model context and reasoning survive a ${condition} optional catalog`, async () => {
    const isolatedDir = path.join(temporary, condition);
    if (condition === "malformed") {
      mkdirSync(isolatedDir);
      writeFileSync(path.join(isolatedDir, "opencodex-catalog.json"), "{broken");
    }
    const isolated = await bundle("source/shared/node/openrouter-proxy.ts", `proxy-${condition}`, {
      define: { "process.env.CODEX_HOME": JSON.stringify(isolatedDir) },
    });
    assert.deepEqual(isolated.readOpenRouterModelContextWindow("glm-5.3-flash"), {
      contextWindow: 1_000_000, autoCompactTokenLimit: 120_000,
    });
    assert.deepEqual(isolated.readOpenRouterModelReasoning("glm-5.3-flash"), {
      levels: ["low", "high", "max"], defaultLevel: "max",
    });
    assert.equal(isolated.readOpenRouterModelContextWindow("zai/glm-5.3-flash"), null);
  });
}
