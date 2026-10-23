import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(repoRoot, "node_modules/.cache"), { recursive: true });
const temporary = await mkdtemp(path.join(repoRoot, "node_modules/.cache/xai-compaction-"));
test.after(() => rm(temporary, { recursive: true, force: true }));

const handlerOut = path.join(temporary, "xai-compaction-handler.mjs");
await build({
  entryPoints: [
    path.join(repoRoot, "source/packages/agent/self-summary/xai-compaction-handler.ts"),
  ],
  outfile: handlerOut,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node26",
  logLevel: "silent",
  packages: "external",
});

const factoryOut = path.join(temporary, "self-summarizer-factory.mjs");
await build({
  entryPoints: [
    path.join(repoRoot, "source/packages/agent/self-summary/self-summarizer-factory.ts"),
  ],
  outfile: factoryOut,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node26",
  logLevel: "silent",
  packages: "external",
});

const {
  XAI_COMPACTION_SYSTEM_PROMPT,
  XAI_COMPACTION_SUMMARIZE_PROMPT,
  GENERALIZED_XAI_COMPACTION_SUMMARIZE_PROMPT,
  xaiCompactionPromptForVariant,
  buildContinuePrompt,
} = await import(pathToFileURL(handlerOut).href);

const { createSelfSummarizerFactory } = await import(pathToFileURL(factoryOut).href);

test("xaiCompactionPromptForVariant default uses standard summarize prompt", () => {
  const prompt = xaiCompactionPromptForVariant("default");
  assert.ok(prompt.startsWith(XAI_COMPACTION_SYSTEM_PROMPT));
  assert.ok(prompt.includes(XAI_COMPACTION_SUMMARIZE_PROMPT));
  assert.equal(prompt.includes(GENERALIZED_XAI_COMPACTION_SUMMARIZE_PROMPT), false);
});

test("xaiCompactionPromptForVariant generalized uses generalized summarize prompt", () => {
  const prompt = xaiCompactionPromptForVariant("generalized");
  assert.ok(prompt.startsWith(XAI_COMPACTION_SYSTEM_PROMPT));
  assert.ok(prompt.includes(GENERALIZED_XAI_COMPACTION_SUMMARIZE_PROMPT));
  assert.equal(prompt.includes("Files and Artifacts:"), true);
});

test("buildContinuePrompt wraps summary in conversation_summary and resume instructions", () => {
  const content = buildContinuePrompt("SECTION ONE");
  assert.match(content, /<conversation_summary>/);
  assert.match(content, /SECTION ONE/);
  assert.match(content, /Pick up the last task as if the break never happened\./);
  assert.equal(content.includes("I'll continue"), true); // negative instruction text is present
});

test("createSelfSummarizerFactory stays disabled without a self-summary config", () => {
  const factory = createSelfSummarizerFactory({
    config: undefined,
    fallbackPromptSession: { getExecutor: () => ({}) },
    modelId: "fixture/model",
  });
  assert.equal(factory, undefined);
});

test("createSelfSummarizerFactory uses the explicit local xai configuration", () => {
  const promptSession = { getExecutor: () => ({}) };
  const factory = createSelfSummarizerFactory({
    config: { flavor: "xai-compact", promptVariant: "generalized" },
    fallbackPromptSession: promptSession,
    modelId: "zai/glm-5.3-flash",
  });
  const handler = factory(
    {
      selfSummaryCount: 0,
      getPrivacyMode: () => "UNSPECIFIED",
      addTurnUsage: () => {},
      incrementSelfSummaryCount: () => {},
    },
    {},
    [],
    {},
    undefined,
  );
  assert.equal(handler.constructor.name, "XaiCompactionHandler");
  assert.equal(handler.getModelId(), "zai/glm-5.3-flash");
});

test("createSelfSummarizerFactory respects flavor openai-compact", () => {
  const factory = createSelfSummarizerFactory({
    config: { flavor: "openai-compact" },
    fallbackPromptSession: { getExecutor: () => ({}) },
    modelId: "openai/gpt-5.2",
  });
  const handler = factory(
    {
      selfSummaryCount: 0,
      getPrivacyMode: () => "UNSPECIFIED",
      addTurnUsage: () => {},
      incrementSelfSummaryCount: () => {},
    },
    {},
    [],
    {},
    undefined,
  );
  assert.equal(handler.constructor.name, "OpenAICompactionHandler");
  assert.notEqual(handler.constructor.name, "XaiCompactionHandler");
});

test("provider-session resolves extendedUsage.maxTokens from catalog window", () => {
  const source = readFileSync(
    path.join(repoRoot, "source/host/extensions/inference/provider-session.ts"),
    "utf8",
  );
  assert.match(source, /DEFAULT_INFERENCE_CONTEXT_WINDOW_TOKENS = 1_000_000/);
  assert.match(source, /maxTokens: resolveInferenceContextWindowTokens\(/);
  assert.equal(source.includes("maxTokens: 0"), false);
});

test("AnysphereAgent wires selfSummarizerFactory instead of undefined", () => {
  const source = readFileSync(
    path.join(repoRoot, "source/packages/agent/index.ts"),
    "utf8",
  );
  assert.match(source, /createSelfSummarizerFactory/);
  assert.match(source, /selfSummarizerFactory,/);
  assert.equal(
    /new SummarizationOrchestrator\(\s*summarizationHandler,\s*undefined\s*,/.test(source),
    false,
  );
});

test("host staticConfig enables xai-compact selfSummaryConfig with model window", () => {
  const source = readFileSync(
    path.join(repoRoot, "source/host/host-runner-composition.ts"),
    "utf8",
  );
  assert.match(source, /agentTokenLimit: inferenceContextWindow/);
  assert.match(source, /flavor: "xai-compact"/);
  assert.match(source, /promptVariant: "generalized"/);
  assert.match(source, /tokenLimit: catalogContext\?\.autoCompactTokenLimit \?\? Math\.min\(LOCAL_AUTO_COMPACT_TOKEN_LIMIT, Math\.floor\(inferenceContextWindow \* 0\.9\)\)/);
  assert.match(source, /canUseSelfSummary: \(\) => true/);
});
