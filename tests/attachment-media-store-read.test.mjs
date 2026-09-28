import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "node_modules/.cache/attachment-media-store-read.cjs");
await mkdir(path.dirname(output), { recursive: true });
await build({
  stdin: { resolveDir: root, contents: [
    'export * from "./source/host/box/protected-path-guard.ts";',
    'export { buildAttachedFilesNote, DEFAULT_SAND_SYSTEM_PROMPT } from "./source/host/runner/system-prompt.ts";',
    'export { createRemoteBoxResourceAccessor, SandBoxNotReadyError } from "./source/host/runner/remote-box-resources.ts";',
    'export { createContext } from "./source/packages/context/core.ts";',
    'export { readExecutorResource } from "./source/packages/agent-exec/read.ts";',
    'export { LoopbackSandBox } from "./source/host/box/loopback-sand-box.ts";',
    'export { productionBoxGeneratedPorts } from "./source/host/box/generated-production.ts";',
    'export { createPromptCollectorGlue } from "./source/host/runner/prompt-collector-glue.ts";',
    'export { createHostGatewayApi } from "./source/host/host-gateway-api.ts";',
    'export { createHostRunnerComposition } from "./source/host/host-runner-composition.ts";',
    'export * from "./source/host/attachment-runtime-ports.ts";',
    'export { runStartWindow } from "./source/host/box/box-windows.ts";',
    'export { SandBoxNoMonitorAvailableError } from "./source/host/ports/box.ts";',
  ].join("\n") },
  bundle: true, platform: "node", format: "cjs", packages: "external", outfile: output, logLevel: "error",
});
const api = createRequire(import.meta.url)(output);
const agentId = "agent-a";

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), "attachment-read-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const store = path.join(base, "sand-data");
  const alias = path.join(base, "agent-data");
  for (const agent of [agentId, "agent-b"]) {
    for (const bucket of ["attachments", "assets"]) {
      const dir = path.join(store, "agents", agent, bucket);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "sample.md"), `content for ${agent}/${bucket}`);
    }
  }
  await writeFile(path.join(store, "host-secrets.json"), "secret");
  await symlink(store, alias);
  return { base, store, alias, own: path.join(store, "agents", agentId, "attachments", "sample.md"),
    other: path.join(store, "agents", "agent-b", "attachments", "sample.md") };
}

function resourceHost(box, id = agentId) {
  return {
    remoteBox: box, remoteBoxHasDesktop: false, resolveBoxId: () => id, getConversationId: () => id,
    setRemoteBoxTerminalsFolder() {}, autoReviewGate: { assertNoPendingApproval() {}, currentModes: () => ({}) },
    auditShellCommand() {}, computerUse: { getOrCreateNavigationProbe() {}, recordAuditIntent() {} },
    probeNavigationAfterComputerUse() {},
  };
}

test("scoped read permits own media and root aliases but refuses another agent or no scope", async t => {
  const { store, alias, own, other } = await fixture(t);
  const guard = (file, scope = agentId) => api.assertPathOutsideProtectedRoots([store], file, "/workspace", scope);
  await guard(own);
  await guard(path.join(alias, "agents", agentId, "attachments", "sample.md"));
  await guard(path.join(store, "agents", agentId, "assets", "sample.md"));
  await assert.rejects(guard(other), api.SandProtectedPathError);
  await assert.rejects(api.assertPathOutsideProtectedRoots([store], own, "/workspace"), api.SandProtectedPathError);
  await assert.rejects(guard(path.join(store, "host-secrets.json")), api.SandProtectedPathError);
  await assert.rejects(guard(path.join(alias, "host-secrets.json")), api.SandProtectedPathError);
  await assert.rejects(guard(path.dirname(own)), api.SandProtectedPathError);
});

test("media symlinks cannot reach another agent, a different bucket, secrets or outside the root", async t => {
  const { base, store, own, other } = await fixture(t);
  const outside = path.join(base, "outside.md");
  await writeFile(outside, "outside");
  const targets = [other, path.join(store, "host-secrets.json"), outside,
    path.join(store, "agents", agentId, "assets", "sample.md")];
  for (const [index, target] of targets.entries()) {
    const link = path.join(path.dirname(own), `link-${index}.md`);
    await symlink(target, link);
    await assert.rejects(api.assertPathOutsideProtectedRoots([store], link, "/workspace", agentId), api.SandProtectedPathError);
  }
  const safe = path.join(path.dirname(own), "safe.md");
  await symlink(own, safe);
  await api.assertPathOutsideProtectedRoots([store], safe, "/workspace", agentId);
  await api.assertPathOutsideProtectedRoots([store], outside, "/workspace", agentId);
});

test("real Read accessor propagates agent scope through the generated guard and reads bytes", async t => {
  const { store, alias, other } = await fixture(t);
  let reads = 0;
  const raw = { get: () => ({ execute: async (_ctx, args) => { reads++; return readFile(args.path, "utf8"); } }) };
  const box = new api.LoopbackSandBox({
    protectedBoxPaths: [store], watchdogIntervalMs: 0,
    operations: { ping: async () => ({ outcome: "ok" }), createRemoteAccessor: () => raw,
      protectRemoteAccessor: (accessor, guard) => api.productionBoxGeneratedPorts.withFileReadGuard(accessor, guard) },
  });
  t.after(() => box.dispose());
  const accessor = api.createRemoteBoxResourceAccessor(resourceHost(box));
  const read = file => accessor.get(api.readExecutorResource).execute(api.createContext(), { path: file });
  assert.equal(await read(path.join(alias, "agents", agentId, "attachments", "sample.md")), "content for agent-a/attachments");
  await assert.rejects(read(other), api.SandProtectedPathError);
  assert.equal(reads, 1, "the denied file must never reach the exec accessor");
});

test("symlink plus parent traversal cannot bypass normal or fallback Read scope", async t => {
  const { store, own } = await fixture(t);
  const pivot = path.join(path.dirname(own), "pivot");
  await symlink(path.join(store, "agents"), pivot);
  const attack = `${pivot}/../host-secrets.json`;
  let reads = 0;
  const raw = { get: () => ({ execute: async (_ctx, args) => { reads++; return readFile(args.path, "utf8"); } }) };
  const box = new api.LoopbackSandBox({ protectedBoxPaths: [store], watchdogIntervalMs: 0,
    operations: { ping: async () => ({ outcome: "ok" }), createRemoteAccessor: () => raw,
      protectRemoteAccessor: (accessor, guard) => api.productionBoxGeneratedPorts.withFileReadGuard(accessor, guard) } });
  t.after(() => box.dispose());
  const normal = api.createRemoteBoxResourceAccessor(resourceHost(box));
  await assert.rejects(normal.get(api.readExecutorResource).execute(api.createContext(), { path: attack }), api.SandProtectedPathError);
  let options;
  const noop = () => {};
  const fakeRunner = new Proxy({ subagents: { sessions: new Map() }, computerUse: undefined }, {
    get(target, key) { return key in target ? target[key] : noop; },
  });
  const exts = { "forever-box": { box, prewarm() {} }, "auto-review": { bindRunner: () => ({}) },
    attachments: { stageIntoBox: async () => new Map(), scheduleRestage() {}, forgetAgent() {} },
    session: { transcriptsDir: () => "/tmp/transcripts" } };
  const composition = api.createHostRunnerComposition({ ctx: api.createContext(), extensions: { api: id => exts[id] ?? {} },
    emitGatewayEvent() {}, buildRunner: value => { options = value; return fakeRunner; } });
  t.after(() => composition.dispose());
  composition.createRunner({ id: agentId, dbPath: "/tmp/agents/agent-a/store.db" }, { transport: { onUpdate() {} } });
  const fallback = await options.createResourceAccessor(api.createContext());
  await assert.rejects(fallback.get(api.readExecutorResource).execute(api.createContext(), { path: attack }), api.SandProtectedPathError);
  assert.equal(reads, 0);
});

test("attachment note chooses Read for container paths and ExternalRead for Mac paths, per file", () => {
  const hostPath = "/home/box/sand-data/agents/agent-a/attachments/sample.md";
  const macPath = "/Users/me/notes.md";
  const note = api.buildAttachedFilesNote([hostPath, macPath], new Map(), new Map([[hostPath, 22384]]));
  assert.match(note, /\/home\/box\/agent-data\/agents\/agent-a\/attachments\/sample\.md \(22 KB\) \(stored on your box; read with Read\)/);
  assert.match(note, /\/Users\/me\/notes.md \(stored on the user's computer; read with ExternalRead\)/);
  assert.doesNotMatch(note, /They live on the user's computer|they are not on your box|also copied into your box/);
  const staged = api.buildAttachedFilesNote([hostPath], new Map([[hostPath, "/workspace/uploads/sample.md"]]));
  assert.match(staged, /also copied into your box at \/workspace\/uploads\/sample.md/);
  assert.doesNotMatch(api.DEFAULT_SAND_SYSTEM_PROMPT, /Files the user attaches in chat.*live on their computer/);
});

for (const generated of [false, true]) {
  test(`${generated ? "generated" : "plain"} prompt schedules only missing files after partial staging`, async () => {
    const a = "/home/box/sand-data/agents/agent-a/attachments/a.md";
    const b = "/home/box/sand-data/agents/agent-a/attachments/b.md";
    const restages = [];
    const glue = api.createPromptCollectorGlue({ getRemoteBoxAvailable: () => true,
      uploadAttachmentsIntoBox: async () => new Map([[a, "/workspace/uploads/a.md"]]),
      scheduleAttachmentRestage: files => restages.push(files) });
    const args = { runCtx: api.createContext(), trimmedPrompt: "Read both files", options: { attachedFilePaths: [a, b] }, compactionEpoch: () => 0 };
    const result = generated ? await glue.assembleGeneratedTurnAction(args) : await glue.assembleTurnAction(args);
    assert.deepEqual(restages, [[b]]);
    const text = result.action.action.value.userMessage.text;
    assert.match(text, /b.md \(stored on your box; read with Read\)/);
  });
}

test("a successful staging does not arm retries", async () => {
  const file = "/home/box/sand-data/agents/agent-a/attachments/a.md";
  const glue = api.createPromptCollectorGlue({ getRemoteBoxAvailable: () => true,
    uploadAttachmentsIntoBox: async () => new Map([[file, "/workspace/uploads/a.md"]]),
    scheduleAttachmentRestage: () => assert.fail("already staged") });
  await glue.assembleTurnAction({ trimmedPrompt: "read", options: { attachedFilePaths: [file] }, compactionEpoch: () => 0 });
});

test("window failure preserves exit code/stderr and avoids the downloading boilerplate", async () => {
  const shell = { get: () => ({ execute: async () => ({ result: { case: "failure", value: { exitCode: 1, stderr: "X server failed", signal: "" } } }) }) };
  const accessor = api.createRemoteBoxResourceAccessor(resourceHost({ ensureReady: async ctx => {
    await api.runStartWindow(ctx, shell, 2);
    assert.fail("failed startup must not return a connection");
  } }));
  await assert.rejects(accessor.get(api.readExecutorResource).execute(api.createContext(), { path: "/tmp/a.md" }), error => {
    assert.equal(error.name, "SandBoxNotReadyError");
    assert.match(error.message, /start-window exited 1: X server failed/);
    assert.doesNotMatch(error.message, /still starting up|downloading its image/);
    return true;
  });
});

test("a cancelled Read startup retains cancellation instead of claiming an image download", async () => {
  const [ctx, cancel] = api.createContext().withCancel();
  const cancelled = new Error("user stopped this turn");
  const accessor = api.createRemoteBoxResourceAccessor(resourceHost({ ensureReady: async () => {
    cancel(cancelled);
    throw cancelled;
  } }));
  await assert.rejects(accessor.get(api.readExecutorResource).execute(ctx, { path: "/tmp/a.md" }), error => error === cancelled);
});

test("window ownership failure 75 remains a no-monitor error even in failure result", async () => {
  const shell = { get: () => ({ execute: async () => ({ result: { case: "failure", value: { exitCode: 75, stderr: "occupied" } } }) }) };
  await assert.rejects(api.runStartWindow(api.createContext(), shell, 2), api.SandBoxNoMonitorAvailableError);
});

test("CreateAgent runner composition uses the bounded service API and scopes fallback reads", async () => {
  const ids = [];
  let runnerOptions;
  let seenScope;
  const raw = { get: () => ({ execute: async ctx => { seenScope = ctx.get(api.agentMediaReadScopeKey); return "read"; } }) };
  const noop = () => {};
  const extensions = {
    "forever-box": { box: { ensureReady: async () => ({ remoteAccessor: raw }),
      ensure: () => assert.fail("HostBox.ensure(ctx,id) is not the service API") },
      prewarm: input => ids.push(input.id) },
    transcript: { createBackgroundAgent: async () => ({ agent: { id: "tool-created", name: "test" } }) },
    attachments: { stageIntoBox: async () => new Map(), scheduleRestage() {}, forgetAgent() {} },
    "auto-review": { bindRunner: () => ({}) },
    session: { transcriptsDir: () => "/tmp/transcripts" },
  };
  const runner = new Proxy({ subagents: { sessions: new Map() }, computerUse: undefined }, {
    get(target, key) { return key in target ? target[key] : noop; },
  });
  const composition = api.createHostRunnerComposition({ ctx: api.createContext(), extensions: { api: id => extensions[id] ?? {} },
    emitGatewayEvent() {}, buildRunner: options => { runnerOptions = options; return runner; } });
  composition.createRunner({ id: agentId, dbPath: "/tmp/agents/agent-a/store.db" }, { transport: { onUpdate() {} } });
  const created = await runnerOptions.agentManagement.create({ name: "test", description: "" });
  assert.equal(created.id, "tool-created");
  assert.deepEqual(ids, ["tool-created"]);
  const accessor = await runnerOptions.createResourceAccessor(api.createContext());
  assert.equal(await accessor.get(api.readExecutorResource).execute(api.createContext(), { path: "/tmp/a.md" }), "read");
  assert.equal(seenScope, agentId);
  await composition.dispose();
});

test("composition main-branch Read scope follows session.id, not a swapped conversation", async t => {
  const { store, alias } = await fixture(t);
  const scopes = [];
  const raw = { get: () => ({ execute: async ctx => { scopes.push(ctx.get(api.agentMediaReadScopeKey)); return "read"; } }) };
  const box = new api.LoopbackSandBox({ protectedBoxPaths: [store], watchdogIntervalMs: 0,
    operations: { ping: async () => ({ outcome: "ok" }), createRemoteAccessor: () => raw,
      protectRemoteAccessor: (accessor, guard) => api.productionBoxGeneratedPorts.withFileReadGuard(accessor, guard) } });
  t.after(() => box.dispose());
  const noop = () => {};
  const healthyRunner = new Proxy({ subagents: { sessions: new Map() },
    computerUse: { getOrCreateNavigationProbe: () => undefined, recordAuditIntent() {} },
    setRemoteBoxTerminalsFolder() {}, probeNavigationAfterComputerUse() {},
    auditShellCommand() {} }, {
    get(target, key) { return key in target ? target[key] : noop; },
  });
  const exts = { "forever-box": { box, prewarm() {} }, "auto-review": { bindRunner: () => ({ bind() {} }) },
    attachments: { stageIntoBox: async () => new Map(), scheduleRestage() {}, forgetAgent() {} },
    session: { transcriptsDir: () => "/tmp/transcripts" } };
  let runnerOptions;
  const composition = api.createHostRunnerComposition({ ctx: api.createContext(), extensions: { api: id => exts[id] ?? {} },
    emitGatewayEvent() {}, buildRunner: options => { runnerOptions = options; return healthyRunner; } });
  t.after(() => composition.dispose());
  composition.createRunner({ id: agentId, dbPath: "/tmp/agents/agent-a/store.db" }, { transport: { onUpdate() {} } });
  const accessor = await runnerOptions.createResourceAccessor(api.createContext());
  const own = path.join(alias, "agents", agentId, "attachments", "sample.md");
  assert.equal(await accessor.get(api.readExecutorResource).execute(api.createContext(), { path: own }), "read");
  assert.deepEqual(scopes, [agentId], "main-branch scope must bind the session's own agent");
});

test("missing staging or prewarm service bindings fail at composition instead of silently skipping", () => {
  assert.throws(() => api.bindAgentBoxPrewarmPort({ ensure() {} }), /prewarm lifecycle is not bound/);
  assert.throws(() => api.bindAttachmentStagingPort({ stageIntoBox() {} }), /staging lifecycle is not bound/);
});

test("all known container roots use Read and startup failures preserve their actual cause", async () => {
  const note = api.buildAttachedFilesNote(["/workspace/uploads/report.pdf", "/home/box/Downloads/report.pdf"]);
  for (const row of note.split("\n").slice(1)) assert.match(row, /stored on your box; read with Read/);
  const accessor = api.createRemoteBoxResourceAccessor(resourceHost({ ensureReady: async () => {
    throw new Error("exec-daemon connection refused (ECONNREFUSED)");
  } }));
  await assert.rejects(accessor.get(api.readExecutorResource).execute(api.createContext(), { path: "/workspace/report.pdf" }), error => {
    assert.match(error.message, /ECONNREFUSED/);
    assert.doesNotMatch(error.message, /downloading its image|still starting up/);
    return true;
  });
});

test("gateway mint delegates to the service prewarm API once for a nonce", async () => {
  const ids = [];
  let creations = 0;
  const extensions = {
    transcript: { createAgent: async () => { creations++; return { agent: { id: "new-agent" } }; } },
    telemetry: { analytics: { markActive() {}, trackEvent() {} } },
    "forever-box": { prewarm: input => ids.push(input.id), ensure: () => assert.fail("must use bounded scheduler") },
  };
  const gateway = api.createHostGatewayApi({ extensions: { api: id => extensions[id] ?? {} }, hostEvents: { emit() {} } });
  const args = { name: "new", description: "", clientNonce: "one-mint" };
  await Promise.all([gateway.createAgent(args), gateway.createAgent(args)]);
  assert.equal(creations, 1);
  assert.deepEqual(ids, ["new-agent"]);
});
