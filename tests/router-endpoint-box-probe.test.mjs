import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// 保存 TokenHub 端点前的容器内连通性+密钥探测（2026-10-05）。桌面探测只证明
// Mac 能拨通端点；推理是从容器拨号的（另一网络位置——2026-10-04 整天事故就跑在
// 一个「桌面验证通过、容器实际不可用」的配置上）。setOpenRouterBaseUrl 在任何
// 落盘之前用 probeBoxEndpoint 探测拨号形态 URL：不可达/密钥被拒 → 阻断保存并
// throw（渲染层已有 catch 展示）；跳过（无沙箱/docker 不可用）与奇状态（端点
// 已应答但 /models 异常）→ 放行。

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

async function bundle(entry, outfile) {
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
    external: ["electron", "node:*"],
  });
  return require(outfile);
}

const connector = await bundle(
  "source/electron-main/box/local-docker-host-connector.ts",
  path.join(repoRoot, "node_modules", ".cache", "endpoint-box-probe-connector.cjs"),
);
const mainEdge = await bundle(
  "source/electron-main/main-edge.ts",
  path.join(repoRoot, "node_modules", ".cache", "endpoint-box-probe-main-edge.cjs"),
);
const { SandSettingsStore } = await bundle(
  "source/shared/node/settings/sand-settings-store.ts",
  path.join(repoRoot, "node_modules", ".cache", "endpoint-box-probe-store.cjs"),
);

function setup({ persistedBaseUrl, probe } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "endpoint-box-probe-"));
  const settingsFile = path.join(dir, "settings.json");
  writeFileSync(settingsFile, "{}\n");
  const store = new SandSettingsStore(settingsFile);
  if (persistedBaseUrl !== undefined) store.setOpenRouterBaseUrl(persistedBaseUrl);
  const syncs = [];
  const probes = [];
  const deps = {
    settingsStore: store,
    syncHostSettingsToBox: async (patch) => { syncs.push(patch); return { ...patch }; },
    delay: async () => {},
    ...(probe == null ? {} : { probeBoxEndpoint: async (baseUrl) => { probes.push(baseUrl); return probe(baseUrl); } }),
  };
  const handlers = mainEdge.createMainEdgeHandlers(deps);
  return { store, handlers, syncs, probes };
}

// --- interpretBoxEndpointProbe：curl/docker 原始结果 → 判定（纯函数，不碰 docker） ---

test("interpret: exit 0 with 2xx reads as pass", () => {
  const r = connector.interpretBoxEndpointProbe({ spawnError: null, exitCode: 0, stdout: "200", stderr: "" });
  assert.equal(r.verdict, "pass");
  assert.equal(r.httpStatus, 200);
});

test("interpret: 401/403 read as auth-rejected", () => {
  for (const code of [401, 403]) {
    const r = connector.interpretBoxEndpointProbe({ spawnError: null, exitCode: 0, stdout: String(code), stderr: "" });
    assert.equal(r.verdict, "auth-rejected", `HTTP ${code}`);
    assert.equal(r.httpStatus, code);
  }
});

test("interpret: other answered codes read as odd-status and never block", () => {
  // 204 等 2xx 属于 pass；odd-status 只收 3xx/4xx/5xx 里「端点已应答但不寻常」的形态
  for (const code of [301, 404, 500]) {
    const r = connector.interpretBoxEndpointProbe({ spawnError: null, exitCode: 0, stdout: String(code), stderr: "" });
    assert.equal(r.verdict, "odd-status", `HTTP ${code}`);
  }
});

test("interpret: curl failures (refused/timeout/dns) read as unreachable with stderr detail", () => {
  const r = connector.interpretBoxEndpointProbe({
    spawnError: null, exitCode: 7, stdout: "000",
    stderr: "curl: (7) Failed to connect to api.example.com port 443: Connection refused",
  });
  assert.equal(r.verdict, "unreachable");
  assert.ok(r.detail.includes("Failed to connect"), `detail keeps curl evidence, got: ${r.detail}`);
});

test("interpret: docker-level failures read as skipped — a stopped sandbox must not block saves", () => {
  const spawnErr = connector.interpretBoxEndpointProbe({ spawnError: "spawn docker ENOENT", exitCode: null, stdout: "", stderr: "" });
  assert.equal(spawnErr.verdict, "skipped");
  const cliErr = connector.interpretBoxEndpointProbe({
    spawnError: null, exitCode: 125, stdout: "",
    stderr: "Error response from daemon: Container grok-node-local-vm is not running",
  });
  assert.equal(cliErr.verdict, "skipped");
  assert.ok(cliErr.detail.includes("未运行"), `detail names the stopped container, got: ${cliErr.detail}`);
});

// --- probeEndpointFromBox 的真实子进程契约：密钥绝不进 argv（走 stdin 的 -K -），
// --- 且探测的是「容器拨号形态」URL（127.0.0.1:11010 → 容器内 10100）。 ---

test("probeEndpointFromBox: recorder docker captures argv without key, stdin with key, dial-form URL", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "endpoint-box-probe-bin-"));
  const fakeDocker = path.join(dir, "docker");
  const argvFile = path.join(dir, "argv.txt");
  const stdinFile = path.join(dir, "stdin.txt");
  writeFileSync(fakeDocker, [
    "#!/bin/sh",
    `printf '%s\\n' "$@" > "${argvFile}"`,
    `cat > "${stdinFile}"`,
    `echo 200`,
    "",
  ].join("\n") + "\n");
  const { chmod } = await import("node:fs/promises");
  await chmod(fakeDocker, 0o755);

  const previous = process.env.SAND_DOCKER_BINARY;
  process.env.SAND_DOCKER_BINARY = fakeDocker;
  try {
    const relayRoute = await connector.probeEndpointFromBox("http://127.0.0.1:11010/v1", "sk-secret-123");
    assert.equal(relayRoute.verdict, "pass", JSON.stringify(relayRoute));
    const argv = await import("node:fs/promises").then((fs) => fs.readFile(argvFile, "utf8"));
    const stdin = await import("node:fs/promises").then((fs) => fs.readFile(stdinFile, "utf8"));
    // The key lives ONLY in the curl config on stdin — never in argv, where
    // `ps` could read it off the docker CLI process.
    assert.ok(!argv.includes("sk-secret-123"), `argv must not carry the key, got: ${argv}`);
    assert.ok(stdin.includes('Authorization: Bearer sk-secret-123'), `stdin config must carry the key, got: ${stdin}`);
    // The probe dials the DIAL form (the transport the host itself uses):
    // persisted loopback:11010 rewrites to the in-container relay hop.
    assert.ok(argv.includes("http://127.0.0.1:10100/v1/models"), `relay form must dial the in-container hop, got: ${argv}`);
    assert.ok(argv.includes("-K") && argv.includes("-"), "curl config comes from stdin");

    await import("node:fs/promises").then((fs) => fs.rm(argvFile, { force: true }));
    await import("node:fs/promises").then((fs) => fs.rm(stdinFile, { force: true }));
    const direct = await connector.probeEndpointFromBox("https://api.minimax.cn/v1", "sk-secret-123");
    assert.equal(direct.verdict, "pass");
    const argv2 = await import("node:fs/promises").then((fs) => fs.readFile(argvFile, "utf8"));
    assert.ok(argv2.includes("https://api.minimax.cn/v1/models"), `direct form dials as-is, got: ${argv2}`);
  } finally {
    if (previous === undefined) delete process.env.SAND_DOCKER_BINARY;
    else process.env.SAND_DOCKER_BINARY = previous;
  }
});

// --- setOpenRouterBaseUrl：门禁行为 ---

test("unreachable endpoint blocks the save: nothing persists, nothing syncs, error names the container path", async () => {
  const { store, handlers, syncs, probes } = setup({
    persistedBaseUrl: "https://api.minimax.cn/v1",
    probe: () => ({ verdict: "unreachable", httpStatus: null, detail: "curl: (7) Failed to connect to bad.example.com port 443" }),
  });
  await assert.rejects(
    handlers.setOpenRouterBaseUrl({ baseUrl: "https://bad.example.com/v1" }),
    /容器内无法访问该端点/,
  );
  assert.equal(store.getOpenRouterBaseUrl(), "https://api.minimax.cn/v1", "previous endpoint must survive the blocked save");
  assert.equal(syncs.length, 0, "a blocked save must not sync anything into the box");
  assert.deepEqual(probes, ["https://bad.example.com/v1"], "probe sees the trimmed requested url");
});

test("auth-rejected endpoint blocks the save and points at the key", async () => {
  const { store, handlers, syncs } = setup({
    probe: () => ({ verdict: "auth-rejected", httpStatus: 401, detail: "端点拒绝了当前 API Key（HTTP 401）" }),
  });
  await assert.rejects(
    handlers.setOpenRouterBaseUrl({ baseUrl: "https://api.minimax.cn/v1" }),
    /拒绝了当前 API Key/,
  );
  assert.equal(store.getOpenRouterBaseUrl(), undefined, "nothing persisted");
  assert.equal(syncs.length, 0, "nothing synced");
});

test("pass verdict lets the save through and reports the probe result", async () => {
  const { store, handlers, syncs } = setup({
    probe: () => ({ verdict: "pass", httpStatus: 200, detail: "" }),
  });
  const result = await handlers.setOpenRouterBaseUrl({ baseUrl: "https://api.minimax.cn/v1" });
  assert.equal(result.endpointProbe.verdict, "pass");
  assert.equal(store.getOpenRouterBaseUrl(), "https://api.minimax.cn/v1");
  assert.equal(syncs.at(-1).openRouterBaseUrl, "https://api.minimax.cn/v1");
});

test("odd-status (endpoint answered, /models unusual) does not block", async () => {
  const { store, handlers } = setup({
    probe: () => ({ verdict: "odd-status", httpStatus: 404, detail: "端点已应答" }),
  });
  const result = await handlers.setOpenRouterBaseUrl({ baseUrl: "https://odd.example.com/v1" });
  assert.equal(result.endpointProbe.httpStatus, 404);
  assert.equal(store.getOpenRouterBaseUrl(), "https://odd.example.com/v1");
});

test("skipped verdict (sandbox off) does not block", async () => {
  const { store, handlers } = setup({
    probe: () => ({ verdict: "skipped", httpStatus: null, detail: "docker exec 失败，容器可能未运行" }),
  });
  await handlers.setOpenRouterBaseUrl({ baseUrl: "https://api.minimax.cn/v1" });
  assert.equal(store.getOpenRouterBaseUrl(), "https://api.minimax.cn/v1");
});

test("absent probe dep (tests / non-docker runtimes) keeps the old behavior", async () => {
  const { store, handlers, probes } = setup();
  await handlers.setOpenRouterBaseUrl({ baseUrl: "https://api.minimax.cn/v1" });
  assert.equal(store.getOpenRouterBaseUrl(), "https://api.minimax.cn/v1");
  assert.equal(probes.length, 0);
});

test("clearing the endpoint (null) skips the probe entirely", async () => {
  const { handlers, probes } = setup({
    persistedBaseUrl: "https://api.minimax.cn/v1",
    probe: () => { throw new Error("probe must not run for a clearing save"); },
  });
  await handlers.setOpenRouterBaseUrl({ baseUrl: null });
  assert.equal(probes.length, 0);
});
