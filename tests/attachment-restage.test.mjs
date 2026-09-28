import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const jsToTs = { name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null; }); } };
const output = path.join(root, "node_modules", ".cache", "attachment-restage.cjs");
await mkdir(path.dirname(output), { recursive: true });
await build({
  stdin: { resolveDir: root, contents: [
    'export { attachmentsExtension } from "./source/host/extensions/attachments/extension.ts";',
    'export { createAttachmentsService } from "./source/host/extensions/attachments/attachments-service.ts";',
    'export { stageAttachmentsIntoBox, SAND_BOX_STAGE_MAX_BYTES } from "./source/host/extensions/attachments/box-staging.ts";',
    'export { createAttachmentRestager, ATTACHMENT_RESTAGE_DELAYS_MS, ATTACHMENT_STAGE_DEADLINE_MS } from "./source/host/extensions/attachments/attachment-restage.ts";',
    'export { createContext, createKey } from "./source/packages/context/core.ts";',
    'export { HostBox } from "./source/host/extensions/forever-box/host-box.ts";',
  ].join("\n") },
  bundle: true, platform: "node", format: "cjs", outfile: output, logLevel: "error", plugins: [jsToTs],
});
const api = createRequire(import.meta.url)(output);

class FakeClock {
  time = 0;
  jobs = new Set();
  now = () => this.time;
  monotonicNow = () => this.time;
  schedule = (ms, callback) => {
    const job = { due: this.time + ms, callback };
    this.jobs.add(job);
    return { dispose: () => this.jobs.delete(job) };
  };
  advance(ms) {
    const end = this.time + ms;
    for (;;) {
      const job = [...this.jobs].filter(item => item.due <= end).sort((a, b) => a.due - b.due)[0];
      if (!job) break;
      this.time = job.due;
      this.jobs.delete(job);
      job.callback();
    }
    this.time = end;
  }
}
async function settle() { for (let n = 0; n < 12; n += 1) await new Promise(resolve => setImmediate(resolve)); }
async function until(predicate) {
  for (let n = 0; n < 400; n += 1) { if (predicate()) return; await delay(5); }
  assert.fail("Timed out waiting for attachment staging");
}
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "attachment-restage-"));
  const dataRoot = path.join(dir, "data");
  const owner = path.join(dataRoot, "agents", "agent-a");
  const other = path.join(dataRoot, "agents", "agent-b");
  for (const agentDir of [owner, other]) for (const bucket of ["attachments", "assets"]) await mkdir(path.join(agentDir, bucket), { recursive: true });
  const previous = process.env.SAND_DATA_ROOT;
  process.env.SAND_DATA_ROOT = dataRoot;
  t.after(async () => { if (previous === undefined) delete process.env.SAND_DATA_ROOT; else process.env.SAND_DATA_ROOT = previous; await rm(dir, { recursive: true, force: true }); });
  const file = async (name, content = name, agentDir = owner, bucket = "attachments") => {
    const target = path.join(agentDir, bucket, name);
    await writeFile(target, content);
    return target;
  };
  return { dir, dataRoot, owner, other, file };
}
function service(t, box, restage = {}, report = () => {}) {
  const apiService = api.createAttachmentsService({ ctx: api.createContext(), auth: {}, box, restage, report });
  t.after(() => apiService.dispose());
  return apiService;
}
function restager(t, clock, stage, options = {}) {
  const instance = api.createAttachmentRestager({ ctx: api.createContext(), clock, stage, ...options });
  t.after(() => instance.dispose());
  return instance;
}

test("production attachment extension passes a usable Context through HostBox and cancels on stop", async (t) => {
  const { file } = await fixture(t);
  const input = await file("first.md");
  const next = await file("second.md");
  const stops = [], contexts = [], reports = [];
  const key = api.createKey(Symbol("probe"), "default");
  let block = false;
  const box = new api.HostBox({
    runState: async (ctx) => { assert.equal(ctx.get(key), "default"); return "running"; },
    uploadFile: async (ctx, agentId, boxPath, bytes) => {
      assert.equal(agentId, "agent-a");
      assert.equal(ctx.with(key, "changed").get(key), "changed");
      assert.equal(ctx.withName("rpc").getPath().at(-1), "rpc");
      assert.ok(ctx.signal instanceof AbortSignal);
      assert.ok(boxPath.startsWith("/workspace/uploads/"));
      assert.ok(bytes.byteLength > 0);
      contexts.push(ctx);
      if (block) await new Promise((resolve, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.reason), { once: true }));
    },
  });
  const attachments = await api.attachmentsExtension.start({
    deps: { auth: {}, "forever-box": { box }, telemetry: { logs: { reportHostExtensionDiagnostic: value => reports.push(value) } } },
    host: {}, onStop: stop => stops.push(stop),
  });
  t.after(() => stops.forEach(stop => stop()));
  assert.equal(stops.length, 1);
  const staged = await attachments.stageIntoBox("agent-a", [input]);
  assert.ok(staged instanceof Map);
  assert.equal(staged.get(input), "/workspace/uploads/first.md");
  assert.equal(contexts[0].canceled, true, "successful attempt releases its Context");
  block = true;
  const pending = attachments.stageIntoBox("agent-a", [next]);
  await until(() => contexts.length === 2);
  await stops[0]();
  assert.equal(contexts[1].canceled, true);
  assert.equal((await pending).size, 0);
  assert.equal((await attachments.stageIntoBox("agent-a", [next])).size, 0);
  assert.equal(contexts.length, 2);
  assert.deepEqual(reports, []);
});

test("downtime recovers at 30s then 120s and retries only the missing part", async (t) => {
  const { file } = await fixture(t);
  const first = await file("ready.md"), second = await file("retry.md");
  const clock = new FakeClock(), uploads = [], reports = [];
  let running = false, secondReady = false, probes = 0;
  const attachments = service(t, {
    runState: async () => { probes += 1; return running ? "running" : "absent"; },
    uploadFile: async (_ctx, _agentId, boxPath) => {
      uploads.push(boxPath);
      if (boxPath.endsWith("retry.md") && !secondReady) throw new Error("SECRET /private/customer/input.md");
    },
  }, { clock }, diagnostic => reports.push(diagnostic));
  assert.deepEqual(api.ATTACHMENT_RESTAGE_DELAYS_MS, [30_000, 90_000]);
  assert.equal((await attachments.stageIntoBox("agent-a", [first, second])).size, 0);
  attachments.scheduleRestage("agent-a", [first, second, first]);
  attachments.scheduleRestage("agent-a", [second]);
  assert.equal(clock.jobs.size, 1);
  clock.advance(29_999);
  assert.equal(probes, 1);
  running = true;
  clock.advance(1);
  await until(() => uploads.length === 2 && clock.jobs.size === 1);
  assert.deepEqual(uploads, ["/workspace/uploads/ready.md", "/workspace/uploads/retry.md"]);
  attachments.scheduleRestage("agent-a", [first, second]);
  clock.advance(89_999);
  await settle();
  assert.equal(uploads.length, 2);
  secondReady = true;
  clock.advance(1);
  await until(() => uploads.length === 3 && clock.jobs.size === 0);
  assert.equal(uploads[2], "/workspace/uploads/retry.md");
  const staged = await attachments.stageIntoBox("agent-a", [first, second]);
  assert.equal(staged.size, 2);
  assert.equal(uploads.length, 3, "successful paths are not uploaded again");
  assert.ok(reports.some(report => report.reason === "box_unavailable"));
  assert.ok(reports.some(report => report.reason === "upload_failed"));
  assert.ok(!JSON.stringify(reports).includes("SECRET"));
  assert.ok(!JSON.stringify(reports).includes(first));
  assert.ok(!JSON.stringify(reports).includes("retry.md"));
});

test("partial initial success is returned and is never included in a delayed retry", async (t) => {
  const { file } = await fixture(t);
  const first = await file("one.md"), second = await file("two.md");
  const clock = new FakeClock(), uploads = [];
  let ready = false;
  const attachments = service(t, {
    runState: async () => "running",
    uploadFile: async (_ctx, _agentId, boxPath) => { uploads.push(boxPath); if (boxPath.endsWith("two.md") && !ready) throw new Error("not ready"); },
  }, { clock });
  assert.deepEqual([...await attachments.stageIntoBox("agent-a", [first, second])], [[first, "/workspace/uploads/one.md"]]);
  attachments.scheduleRestage("agent-a", [first, second]);
  ready = true;
  clock.advance(30_000);
  await until(() => uploads.length === 3 && clock.jobs.size === 0);
  clock.advance(90_000);
  await settle();
  assert.deepEqual(uploads, ["/workspace/uploads/one.md", "/workspace/uploads/two.md", "/workspace/uploads/two.md"]);
});

test("duplicate schedules do not reset retry budget and failures stop after two attempts", async (t) => {
  const clock = new FakeClock(), calls = [], reports = [];
  const queue = restager(t, clock, async (_ctx, agentId, paths) => { calls.push({ time: clock.time, agentId, paths }); return new Map(); }, { report: report => reports.push(report) });
  queue.scheduleRestage("agent-a", ["/missing.md", "/missing.md"]);
  clock.advance(10_000);
  queue.scheduleRestage("agent-a", ["/missing.md"]);
  clock.advance(20_000);
  await settle();
  assert.equal(calls.length, 1);
  queue.scheduleRestage("agent-a", ["/missing.md"]);
  clock.advance(90_000);
  await settle();
  assert.deepEqual(calls.map(call => call.time), [30_000, 120_000]);
  assert.equal(clock.jobs.size, 0);
  queue.scheduleRestage("agent-a", ["/missing.md"]);
  clock.advance(30_000);
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(reports.filter(report => report.kind === "restage_exhausted").length, 1);
});

test("initial calls and restaging share one per-agent upload lane", async (t) => {
  const clock = new FakeClock(), calls = [], releases = [];
  let active = 0, maxActive = 0;
  const queue = restager(t, clock, async (_ctx, _agentId, paths) => {
    active += 1; maxActive = Math.max(maxActive, active); calls.push(paths);
    await new Promise(resolve => releases.push(resolve));
    active -= 1;
    return new Map(paths.map(path => [path, `/workspace/uploads/${path.split("/").at(-1)}`]));
  }, { deadlineMs: 200_000 });
  const first = queue.stageIntoBox("agent-a", ["/one.md"]);
  const duplicate = queue.stageIntoBox("agent-a", ["/one.md", "/two.md"]);
  queue.scheduleRestage("agent-a", ["/one.md", "/two.md"]);
  clock.advance(30_000);
  await settle();
  assert.deepEqual(calls, [["/one.md"]]);
  releases.shift()();
  await until(() => calls.length === 2);
  assert.deepEqual(calls[1], ["/two.md"]);
  releases.shift()();
  assert.equal((await first).size, 1);
  assert.equal((await duplicate).size, 2);
  await settle();
  assert.equal(maxActive, 1);
  assert.equal(clock.jobs.size, 0);
});

test("forgetAgent and dispose cancel queued timers and in-flight uploads", async (t) => {
  const clock = new FakeClock(), contexts = [];
  const queue = restager(t, clock, (ctx) => {
    contexts.push(ctx);
    return new Promise((resolve, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.reason), { once: true }));
  });
  queue.scheduleRestage("agent-a", ["/one.md"]);
  queue.forgetAgent("agent-a");
  queue.scheduleRestage("agent-a", ["/one.md"]);
  assert.equal((await queue.stageIntoBox("agent-a", ["/one.md"])).size, 0);
  clock.advance(120_000);
  assert.equal(contexts.length, 0);
  const pending = queue.stageIntoBox("agent-b", ["/two.md"]);
  await settle();
  queue.scheduleRestage("agent-b", ["/two.md"]);
  queue.forgetAgent("agent-b");
  assert.equal(contexts[0].canceled, true);
  assert.equal((await pending).size, 0);
  const next = queue.stageIntoBox("agent-c", ["/three.md"]);
  await settle();
  queue.scheduleRestage("agent-d", ["/four.md"]);
  queue.dispose();
  queue.dispose();
  assert.equal((await next).size, 0);
  assert.equal(contexts[1].canceled, true);
  assert.equal(clock.jobs.size, 0);
  queue.scheduleRestage("agent-e", ["/five.md"]);
  assert.equal((await queue.stageIntoBox("agent-e", ["/five.md"])).size, 0);
});

test("forgetting immediately after stage admission prevents the deferred transfer from starting", async (t) => {
  const clock = new FakeClock();
  let calls = 0;
  const queue = restager(t, clock, async () => { calls += 1; return new Map(); });
  const pending = queue.stageIntoBox("agent-a", ["/one.md"]);
  queue.forgetAgent("agent-a");
  assert.equal((await pending).size, 0);
  assert.equal(calls, 0);
  assert.equal(clock.jobs.size, 0);
});

test("deadline returns partial success and keeps the lane locked until canceled transport settles", async (t) => {
  const clock = new FakeClock(), calls = [], reports = [], releases = [];
  const queue = restager(t, clock, (ctx, _agentId, paths, onResult) => {
    calls.push({ ctx, paths });
    onResult({ path: paths[0], kind: "staged", boxPath: "/workspace/uploads/one.md" });
    return new Promise(resolve => releases.push(resolve));
  }, { deadlineMs: 10, retryDelaysMs: [30, 90], report: report => reports.push(report) });
  const pending = queue.stageIntoBox("agent-a", ["/one.md", "/two.md"]);
  await settle();
  clock.advance(10);
  assert.deepEqual([...await pending], [["/one.md", "/workspace/uploads/one.md"]]);
  assert.equal(calls[0].ctx.canceled, true);
  queue.scheduleRestage("agent-a", ["/one.md", "/two.md"]);
  clock.advance(30);
  await settle();
  clock.advance(10);
  await settle();
  clock.advance(80);
  await settle();
  clock.advance(10);
  await settle();
  assert.equal(calls.length, 1, "a wedged transport never overlaps its retry");
  assert.equal(clock.jobs.size, 0);
  queue.forgetAgent("agent-a");
  assert.equal((await queue.stageIntoBox("agent-a", ["/later.md"])).size, 0);
  assert.equal(calls.length, 1, "forget does not release a still-running upload lane");
  releases[0](new Map([["/two.md", "/workspace/uploads/two.md"]]));
  await settle();
  assert.ok(reports.some(report => report.kind === "stage_deadline"));
  assert.ok(reports.some(report => report.kind === "restage_exhausted"));
});

test("deadlines also bound a hung runState probe", async (t) => {
  const { file } = await fixture(t);
  const input = await file("probe.md"), clock = new FakeClock();
  let probeCtx, uploads = 0;
  const attachments = service(t, {
    runState: (ctx) => { probeCtx = ctx; return new Promise(() => {}); },
    uploadFile: async () => { uploads += 1; },
  }, { clock, deadlineMs: 20 });
  const pending = attachments.stageIntoBox("agent-a", [input]);
  await until(() => probeCtx !== undefined);
  clock.advance(20);
  assert.equal((await pending).size, 0);
  assert.equal(probeCtx.canceled, true);
  assert.equal(uploads, 0);
});

test("staging rejects cross-agent files, secrets, and escapes at file, bucket, and agent boundaries", async (t) => {
  const { dir, dataRoot, owner, other, file } = await fixture(t);
  const safe = await file("safe.md"), asset = await file("asset.txt", "asset", owner, "assets");
  const foreign = await file("foreign.md", "FOREIGN", other);
  const secret = path.join(dataRoot, "host-secrets.json");
  const outside = path.join(dir, "private.txt");
  await writeFile(secret, "SECRET"); await writeFile(outside, "OUTSIDE");
  const aliases = [
    ["foreign-link.md", foreign], ["secret-link.md", secret], ["outside-link.md", outside],
    ["bucket-link.md", asset], ["valid-link.md", safe],
  ];
  for (const [name, target] of aliases) await symlink(target, path.join(owner, "attachments", name));
  await symlink(path.join(other, "attachments"), path.join(owner, "attachments", "foreign-dir"));
  await symlink(other, path.join(dataRoot, "agents", "agent-alias"));
  await mkdir(path.join(dataRoot, "agents", "bucket-agent"));
  await symlink(path.join(other, "attachments"), path.join(dataRoot, "agents", "bucket-agent", "attachments"));
  const uploads = [], reports = [];
  const attachments = service(t, { runState: async () => "running", uploadFile: async (_ctx, _id, target, data) => uploads.push({ target, text: Buffer.from(data).toString() }) }, {}, report => reports.push(report));
  const paths = [safe, asset, foreign, secret, outside, ...aliases.map(([name]) => path.join(owner, "attachments", name)), path.join(owner, "attachments", "foreign-dir", "foreign.md")];
  const result = await attachments.stageIntoBox("agent-a", paths);
  assert.deepEqual([...result.keys()], [safe, asset, path.join(owner, "attachments", "valid-link.md")]);
  assert.equal((await attachments.stageIntoBox("agent-alias", [path.join(dataRoot, "agents", "agent-alias", "attachments", "foreign.md")])).size, 0);
  assert.equal((await attachments.stageIntoBox("bucket-agent", [path.join(dataRoot, "agents", "bucket-agent", "attachments", "foreign.md")])).size, 0);
  assert.equal(uploads.length, 3);
  assert.ok(uploads.every(upload => !/SECRET|FOREIGN|OUTSIDE/.test(upload.text)));
  assert.ok(reports.some(report => report.reason === "path_rejected"));
  assert.ok(!JSON.stringify(reports).includes(secret));
  assert.ok(!JSON.stringify(reports).includes("foreign.md"));
});

test("directory swaps during a box probe cannot expose another owner's file", async (t) => {
  const { owner, other, file } = await fixture(t);
  const input = await file("same.md", "SAFE");
  await file("same.md", "FOREIGN", other);
  const reports = [];
  const attachments = service(t, {
    runState: async () => {
      await rename(path.join(owner, "attachments"), path.join(owner, "old-attachments"));
      await symlink(path.join(other, "attachments"), path.join(owner, "attachments"));
      return "running";
    },
    uploadFile: async () => assert.fail("swapped directory uploaded foreign bytes"),
  }, {}, diagnostic => reports.push(diagnostic));
  assert.equal((await attachments.stageIntoBox("agent-a", [input])).size, 0);
  assert.ok(reports.some(report => report.reason === "path_rejected"));
});

test("container aliases and historical roots reanchor IO while preserving caller map keys", async (t) => {
  const { dataRoot, owner, file } = await fixture(t);
  const a = await file("model.md"), b = await file("container.md"), c = await file("moved.md");
  const supplied = ["/home/box/agent-data/agents/agent-a/attachments/model.md", "/home/box/sand-data/agents/agent-a/attachments/container.md", "/Users/old/.grokbot/agents/agent-a/attachments/moved.md"];
  const uploads = [];
  const attachments = service(t, { runState: async () => "running", uploadFile: async (_ctx, _id, target, bytes) => uploads.push({ target, text: Buffer.from(bytes).toString() }) });
  const result = await attachments.stageIntoBox("agent-a", supplied);
  assert.deepEqual([...result.keys()], supplied);
  assert.deepEqual(uploads.map(upload => upload.text), ["model.md", "container.md", "moved.md"]);
  assert.equal((await attachments.stageIntoBox("agent-a", [a, b, c])).size, 3);
  assert.equal(uploads.length, 3, "alias spellings share the staged cache");
  const aliasRoot = `${dataRoot}-alias`;
  await symlink(dataRoot, aliasRoot);
  process.env.SAND_DATA_ROOT = aliasRoot;
  const viaSymlink = service(t, { runState: async () => "running", uploadFile: async () => {} });
  assert.equal((await viaSymlink.stageIntoBox("agent-a", [path.join(owner, "attachments", "model.md")])).size, 1);
});

test("video, oversize, missing, and non-file paths are terminal even while the box is down", async (t) => {
  const { owner, file } = await fixture(t);
  const video = await file("clip.mp4"), hiddenVideo = path.join(owner, "attachments", "clip.txt");
  await symlink(video, hiddenVideo);
  const large = await file("large.bin");
  const handle = await open(large, "r+");
  await handle.truncate(api.SAND_BOX_STAGE_MAX_BYTES + 1); await handle.close();
  const directory = path.join(owner, "attachments", "directory"); await mkdir(directory);
  const missing = path.join(owner, "attachments", "deleted.md");
  const clock = new FakeClock(), reports = [];
  let probes = 0;
  const attachments = service(t, { runState: async () => { probes += 1; return "absent"; }, uploadFile: async () => assert.fail("ineligible path uploaded") }, { clock }, report => reports.push(report));
  const paths = [video, hiddenVideo, large, directory, missing];
  assert.equal((await attachments.stageIntoBox("agent-a", paths)).size, 0);
  attachments.scheduleRestage("agent-a", paths);
  assert.equal(clock.jobs.size, 0);
  assert.equal(probes, 0);
  assert.deepEqual(new Set(reports.map(report => report.reason)), new Set(["video", "too_large", "not_file", "missing_file"]));
  assert.ok(reports.every(report => report.retryable === false));
});

test("Context listeners, timers, and queue admission stay bounded", async (t) => {
  const clock = new FakeClock(), ctx = api.createContext(), calls = [], reports = [];
  const queue = api.createAttachmentRestager({ ctx, clock, stage: async (_ctx, _id, paths) => { calls.push(paths); return new Map(paths.map(path => [path, "/workspace/uploads/file"])); }, report: value => reports.push(value) });
  t.after(() => queue.dispose());
  assert.equal(getEventListeners(ctx.signal, "abort").length, 1);
  for (let i = 0; i < 40; i += 1) await queue.stageIntoBox("agent-a", [`/file-${i}.md`]);
  assert.equal(getEventListeners(ctx.signal, "abort").length, 1);
  assert.equal(clock.jobs.size, 0);
  queue.scheduleRestage("agent-a", Array.from({ length: 300 }, (_, n) => `/queued-${n}.md`));
  clock.advance(30_000);
  await settle();
  assert.equal(calls.at(-1).length, 256);
  assert.equal(clock.jobs.size, 0);
  for (let n = 0; n < 140; n += 1) queue.scheduleRestage(`agent-${n}`, ["/pending.md"]);
  assert.equal(clock.jobs.size, 128);
  assert.ok(reports.some(report => report.kind === "stage_capacity"));
  queue.dispose();
  assert.equal(clock.jobs.size, 0);
  assert.equal(getEventListeners(ctx.signal, "abort").length, 0);
});
