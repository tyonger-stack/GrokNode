import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const cache = path.join(root, "node_modules/.cache");
await mkdir(cache, { recursive: true });
const temporary = await mkdtemp(path.join(cache, "compaction-contracts-"));
test.after(() => rm(temporary, { recursive: true, force: true }));
const outfile = path.join(temporary, "contracts.cjs");
await build({
  stdin: {
    contents: `
      export { createSelfSummarizerFactory, resolveSelfSummaryFlavor } from './source/packages/agent/self-summary/self-summarizer-factory.ts';
      export { toRedactedCoreMessages } from './source/packages/redaction/core-message.ts';
      export { PrivacyMode } from './source/packages/redaction/privacy-mode.ts';
      export { createContext } from './source/packages/context/core.ts';
      export { loggerKey } from './source/packages/context/logger.ts';
      export { findLastRealUserMessageForCompaction } from './source/packages/agent/self-summary/compaction-user-message.ts';
      export { selectUserDeliveryTail } from './source/packages/agent-summarization/delivery-tail.ts';
    `,
    resolveDir: root,
    loader: "ts",
  },
  outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent",
});
const {
  createSelfSummarizerFactory, resolveSelfSummaryFlavor, toRedactedCoreMessages,
  PrivacyMode, createContext, loggerKey, findLastRealUserMessageForCompaction,
  selectUserDeliveryTail,
} = createRequire(import.meta.url)(outfile);
const mode = PrivacyMode.UNSPECIFIED;
const redacted = messages => toRedactedCoreMessages(messages, mode);
const deliveryTail = {
  isDeliveryToolCall: ({ toolName }) => toolName === "send_message",
  maxCalls: 2,
  triggerReasons: ["approaching_token_limit"],
};
const messages = redacted([
  { role: "system", content: "fixture system" },
  { role: "user", content: "<user_query>fixture task</user_query>" },
  { role: "assistant", id: "delivery", content: [
    { type: "tool-call", toolCallId: "c1", toolName: "send_message", args: { text: "delivered" } },
  ] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "send_message", result: "ok" }] },
]);

function runtimeFixture(config) {
  const requests = [];
  const usage = [];
  let started = 0;
  const state = {
    selfSummaryCount: 0,
    getPrivacyMode: () => mode,
    addTurnUsage: value => usage.push(value),
    incrementSelfSummaryCount() { this.selfSummaryCount += 1; },
  };
  const executor = {
    appendMessages(value) { this.messages = value; },
    executeToolStream(_ctx, _state, _interaction, tools, _extra, _onTool, descriptionProps) {
      requests.push({ tools, descriptionProps, messages: this.messages });
      return {
        fullStream: (async function* () { yield { type: "text-delta", textDelta: "summary" }; })(),
        response: Promise.resolve({ messages: [{ role: "assistant", content: "<summary>fixture summary</summary>" }] }),
        extendedUsage: Promise.resolve({ inputTokens: 41, outputTokens: 7 }),
        usage: Promise.resolve({}), providerMetadata: Promise.resolve({}), invocationId: Promise.resolve("fixture"),
      };
    },
  };
  const promptSession = { getExecutor: () => executor };
  const factory = createSelfSummarizerFactory({
    config: { ...config, preserveUserDeliveryTail: deliveryTail, onSelfSummaryStart: () => started++ },
    fallbackPromptSession: promptSession, modelId: "fixture/model",
  });
  const tool = { name: "send_message", toolIdentifier: "SEND_MESSAGE", parameters: {} };
  const descriptionProps = { allTools: { SEND_MESSAGE: tool } };
  const handler = factory(state, { async sendUpdate() {}, async query() { throw new Error("unexpected query"); } }, [tool], {}, descriptionProps);
  return { handler, state, requests, usage, started: () => started, descriptionProps };
}

test("flavor resolution follows the original resolver, configured value, generic fallback order", () => {
  const config = { flavor: "xai-compact", resolveFlavor: () => "openai-compact" };
  const resolved = [resolveSelfSummaryFlavor(config), resolveSelfSummaryFlavor({ flavor: "xai-compact" }), resolveSelfSummaryFlavor({})];
  assert.deepEqual(resolved, ["openai-compact", "xai-compact", "generic"]);
});

for (const [flavor, constructor] of [
  ["xai-compact", "XaiCompactionHandler"],
  ["openai-compact", "OpenAICompactionHandler"],
  ["anthropic-explicit", "AnthropicCompactionHandler"],
  ["generic", "SelfSummarizer"],
]) {
  test(`${flavor} completes compaction and preserves answered delivery pairs after the summary`, async () => {
    const fixture = runtimeFixture({ flavor });
    const ctx = createContext().with(loggerKey, { log() {} });
    const result = await fixture.handler.summarize(ctx, messages, { triggerReason: "approaching_token_limit" });
    result.onPersisted();
    assert.equal(fixture.handler.constructor.name, constructor);
    assert.equal(fixture.started(), 1);
    assert.equal(fixture.state.selfSummaryCount, 1);
    assert.deepEqual(fixture.usage, [{ inputTokens: 41, outputTokens: 7, cacheReadTokens: undefined, cacheWriteTokens: undefined, reasoningTokens: undefined }]);
    assert.equal(fixture.requests[0].descriptionProps, fixture.descriptionProps);
    assert.deepEqual(result.fullReplacementMessages.slice(-2).map(message => message.role), ["assistant", "tool"]);
    assert.equal(result.fullReplacementMessages.at(-2).id, "delivery");
    assert.equal(result.fullReplacementMessages.at(-1)._privacyMode, mode);
    assert.ok(result.fullReplacementMessages.slice(0, -2).some(message => message.providerOptions?.cursor?.isSummary === true));
  });
}

test("original retry defaults and explicit Anthropic mode reach the selected handlers", () => {
  const xai = runtimeFixture({ flavor: "xai-compact" }).handler;
  const openai = runtimeFixture({ flavor: "openai-compact" }).handler;
  const anthropic = runtimeFixture({ flavor: "anthropic-explicit" }).handler;
  assert.equal(xai.retryOptions.enableReduceInputsRetry, true);
  assert.equal(xai.retryOptions.enableRetryUncategorizedErrors, true);
  assert.equal(xai.retryOptions.enableRetryNoSummaryResponse, true);
  assert.equal(openai.retryOptions.enableRetryNoSummaryResponse, false);
  assert.equal(anthropic.retryOptions.enableRetryNoSummaryResponse, false);
  assert.equal(anthropic.compactionMode, "explicit");
});

test("delivery selection unwraps redacted arguments, keeps the latest answered calls, and retains privacy mode", () => {
  const input = redacted([
    { role: "assistant", content: [
      { type: "tool-call", toolCallId: "older", toolName: "send_message", args: { recipient: "older" } },
      { type: "tool-call", toolCallId: "latest", toolName: "send_message", args: { recipient: "user" } },
      { type: "tool-call", toolCallId: "pending", toolName: "send_message", args: {} },
    ] },
    { role: "tool", content: [
      { type: "tool-result", toolCallId: "older", toolName: "send_message", result: "older" },
      { type: "tool-result", toolCallId: "latest", toolName: "send_message", result: "ok" },
    ] },
  ]);
  const seen = [];
  const tail = selectUserDeliveryTail(input, { maxCalls: 1, isDeliveryToolCall: call => { seen.push(call.args()); return true; } });
  assert.ok(seen.some(args => args.includes('"recipient":"user"')));
  assert.deepEqual(tail.map(message => message.content[0].toolCallId), ["latest", "latest"]);
  assert.ok(tail.every(message => message._privacyMode === mode));
});

test("xai preserves an agent message turn and skips summaries and synthetic wakeups", () => {
  const input = [
    { role: "user", content: "human", providerOptions: { cursor: {} } },
    { role: "user", content: "agent", providerOptions: { cursor: { agentMessageTurn: true } } },
    { role: "user", content: "summary", providerOptions: { cursor: { isSummary: true } } },
    { role: "user", content: "<task>wake</task>Perform any necessary follow-up actions in response to the subagent completion above.</system_notification>" },
  ];
  const selected = findLastRealUserMessageForCompaction(input, message => message.content);
  assert.equal(selected, input[1]);
});
