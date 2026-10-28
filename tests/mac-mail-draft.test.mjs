import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));

async function load() {
  const output = path.join(root, "node_modules/.cache/mac-mail-draft.cjs");
  await build({
    stdin: {
      contents: [
        'export {createContextTools, macDraftMailExecute, renderMacDraftMailOutcome, macDraftMailParameters, MAC_DRAFT_MAIL_TOOL_NAME, MAC_DRAFT_MAIL_TOOL_ID} from "./source/host/runner/tools/context-tools.ts";',
        'export {canUseMacDraftMail} from "./source/host/runner/mac-mail-access.ts";',
        'export {dispatchAppleTool, DeviceToolError} from "./source/local-exec-daemon/apple-apps/dispatch.ts";',
        'export {AppleAppsToolRunner} from "./source/local-exec-daemon/apple-apps/runner.ts";',
      ].join("\n"),
      resolveDir: root,
      loader: "ts",
    },
    outfile: output,
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    logLevel: "error",
  });
  return createRequire(import.meta.url)(output);
}

const baseDeps = {
  state: { writeMemory: async () => ({ ok: true, detail: "saved" }), removeMemory: async () => ({ ok: true, detail: "removed" }) },
  selfId: "agent-1",
  listFacts: () => [],
  loadTranscript: async () => null,
  related: () => [],
};

test("MacDraftMail registers only when a draft executor is wired", async () => {
  const modules = await load();
  const withTool = modules.createContextTools({ ...baseDeps, macDraftMail: async () => ({ status: "completed", value: null }) });
  assert.equal(withTool.map((tool) => tool.name).includes(modules.MAC_DRAFT_MAIL_TOOL_NAME), true);
  const withoutTool = modules.createContextTools({ ...baseDeps });
  assert.equal(withoutTool.map((tool) => tool.name).includes(modules.MAC_DRAFT_MAIL_TOOL_NAME), false);
  assert.equal(modules.MAC_DRAFT_MAIL_TOOL_NAME, "MacDraftMail");
  assert.equal(modules.MAC_DRAFT_MAIL_TOOL_ID, "mac_draft_mail");
});

test("draft execute maps args like dispatchMailDraft and refuses reply-less new mail", async () => {
  const modules = await load();
  const calls = [];
  const executor = async (request) => { calls.push(request); return { status: "completed", value: null }; };
  await modules.macDraftMailExecute({ macDraftMail: executor }, modules.macDraftMailParameters.parse({
    to: ["person@example.test"], cc: ["other@example.test"], subject: "Hello", body: "Body text",
  }));
  assert.deepEqual(calls.at(-1), { to: ["person@example.test"], cc: ["other@example.test"], subject: "Hello", body: "Body text" });
  await modules.macDraftMailExecute({ macDraftMail: executor }, modules.macDraftMailParameters.parse({
    replyToId: "mail-1", subject: "should be dropped", body: "Reply body",
  }));
  assert.deepEqual(calls.at(-1), { replyToId: "mail-1", body: "Reply body" });
  await assert.rejects(
    () => modules.macDraftMailExecute({ macDraftMail: executor }, modules.macDraftMailParameters.parse({ body: "no recipient" })),
    /a new email needs to/,
  );
  assert.throws(() => modules.macDraftMailParameters.parse({ body: "" }), /too_small|Invalid/i);
});

test("outcome rendering distinguishes completed, failed, and unknown shapes", async () => {
  const modules = await load();
  assert.match(modules.renderMacDraftMailOutcome({ status: "completed", value: null }), /not sent/i);
  assert.match(modules.renderMacDraftMailOutcome({ status: "failed", error: { code: "sidecar_missing", message: "boom" } }), /sidecar_missing.*boom/s);
  assert.match(modules.renderMacDraftMailOutcome("weird"), /Mail draft result:/);
});

test("canUseMacDraftMail mirrors the vault session-access gate", async () => {
  const modules = await load();
  const base = { isSharedRoomTurn: false, isSubagentRunner: false, agentId: "a1", sessionId: "a1" };
  assert.equal(modules.canUseMacDraftMail(base), true);
  assert.equal(modules.canUseMacDraftMail({ ...base, isSharedRoomTurn: true }), false);
  assert.equal(modules.canUseMacDraftMail({ ...base, isSubagentRunner: true }), false);
  assert.equal(modules.canUseMacDraftMail({ ...base, agentId: "a2" }), false);
});

test("dispatch maps mac_draft_mail onto the mail/draft op with upstream error copy", async () => {
  const modules = await load();
  const ops = [];
  const outcome = await modules.dispatchAppleTool("mac_draft_mail", { to: ["person@example.test"], subject: "S", body: "B" },
    async (app, op, args) => { ops.push({ app, op, args }); return { ok: true }; });
  assert.deepEqual(ops, [{ app: "mail", op: "draft", args: { to: ["person@example.test"], subject: "S", body: "B" } }]);
  assert.deepEqual(outcome, { ok: true });
  const reply = await modules.dispatchAppleTool("mac_draft_mail", { replyToId: "m1", body: "R" },
    async (app, op, args) => ({ app, op, args }));
  assert.equal(reply.args.subject, undefined);
  assert.equal(reply.args.replyToId, "m1");
  await assert.rejects(
    () => modules.dispatchAppleTool("mac_draft_mail", { body: "B" }, async () => ({})),
    (error) => error instanceof modules.DeviceToolError && error.code === "invalid_input" && /a new email needs to/.test(error.message),
  );
  await assert.rejects(
    () => modules.dispatchAppleTool("mac_draft_mail", { to: ["a@b.test"] }, async () => ({})),
    /body is required/,
  );
});

test("runner without a staged sidecar fails closed", async () => {
  const modules = await load();
  const runner = new modules.AppleAppsToolRunner({ env: {} });
  const outcome = await runner.callTool("mac_draft_mail", { to: ["a@b.test"], body: "x" }, { conversationId: "conv-1" });
  // 会话层把非 result 结果统一映射为 sidecar_timeout（runner callTool 语义），
  // 失败链路里保留底层 sidecar_missing 原因文本。
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.code, "sidecar_timeout");
  assert.match(outcome.error.message, /sidecar_missing/);
  assert.match(outcome.error.message, /could not be prepared/);
});
