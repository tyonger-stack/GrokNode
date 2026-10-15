// Regression guard for the 2026-10-11 "frozen gateway pool never self-heals" incident.
//
// 事故形状：OrbStack 端口转发坏窗期间建立的 keep-alive 连接被静默冻结（无 RST/FIN，
// socket 恒 ESTABLISHED，请求永远无回音）。旧实现里命令路径走全局 fetch，undici
// 池子永远复用这批死连接 —— 每 5s 的重试全部撞在同一批冻结 socket 上，「正在重新
// 连接」横幅挂到进程重启才消失。重启即愈（网关/token/网络全好）证明自愈单元应该
// 是池子本身。
//
// 本测试在进程内复现整个场景，不依赖 OrbStack：
//   阶段一：TCP 服务器 accept 后永不响应（黑冻），池里攒出冻结连接；
//   阶段二：同一服务器开始正常响应 —— 但只在**新连接**上（冻结的那些永远不出话）；
//   断言：客户端必须在一个断路周期内自愈（成功拿到命令结果），且期间发出过
//         gateway-pool-recycled 传输事件。没有断路回收的实现在这个测试里会永远挂起。
//
// 反向断言：服务端正常说 4xx（SandGatewayCommandError）不计入断路连击 ——
// 连接池不为应用层错误买单。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const MODULE = "source/node-agent-coordinator/gateway/gateway-client.ts";

async function loadGatewayClient() {
  const dir = await mkdtemp(path.join(tmpdir(), "gateway-client-"));
  const out = path.join(dir, "out.cjs");
  await build({
    entryPoints: [path.join(REPO, MODULE)],
    bundle: true,
    // CJS 输出：undici 是 CJS 包，esm 输出会给外部化的 node 内置模块注入
    // 运行时 require 垫片并直接抛错；CJS 则原生 require 可用。
    format: "cjs",
    platform: "node",
    target: "node22",
    outfile: out,
    logLevel: "silent",
  });
  try {
    return await import(out);
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

/**
 * 行为随阶段切换的 TCP 服务器：
 *   phase "frozen"  — accept 后什么都不做（连接保持打开：黑冻）；
 *   phase "serving" — 新连接按 HTTP 应答 200 JSON（旧连接依旧冻着）。
 * 返回 { port, setPhase, frozenSockets }。
 */
async function startTwoPhaseServer(responseFor) {
  const frozenSockets = new Set();
  let phase = "frozen";
  const server = net.createServer((socket) => {
    if (phase === "frozen") {
      frozenSockets.add(socket);
      socket.on("close", () => frozenSockets.delete(socket));
      return;
    }
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      if (!buffer.includes("\r\n\r\n")) return;
      const body = JSON.stringify(responseFor(buffer));
      socket.end(`HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: keep-alive\r\n\r\n${body}`);
      buffer = "";
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    setPhase: (next) => { phase = next; },
    frozenSockets,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function makeClient(module, port, events) {
  return new module.CoordinatorGatewayClient({
    resolveConnection: async () => ({ baseUrl: `http://127.0.0.1:${port}`, token: null }),
    timing: module.createCoordinatorGatewayClientTiming(),
    onEvent: () => {},
    onTransportEvent: (event) => events.push(event),
  });
}

test("冻结池在一个断路周期内自愈（2026-10-11 事故回归）", async () => {
  const module = await loadGatewayClient();
  const events = [];
  const server = await startTwoPhaseServer(() => ({ ok: true, value: { recovered: true } }));
  const client = makeClient(module, server.port, events);
  try {
    // 阶段一：三次命令全部撞在冻结连接上（每次 400ms 上限，模拟调用方 deadline）。
    for (let i = 0; i < module.GATEWAY_POOL_RECYCLE_STREAK; i += 1) {
      await assert.rejects(
        client.command("setHostSettings", {}, { signal: AbortSignal.timeout(400) }),
        (error) => error?.name === "SandGatewayUnreachableError" && error?.kind === "timeout",
      );
    }
    // 断路应已跳闸：冻结连接被销毁，recycle 事件发出。
    assert.ok(events.some((e) => e.family === "gateway-pool-recycled"), "断路未跳闸：没有 gateway-pool-recycled 事件");
    // 服务侧恢复（只对新连接生效）。没有回收的客户端会永远复用冻结连接。
    server.setPhase("serving");
    const result = await client.command("setHostSettings", {}, { signal: AbortSignal.timeout(3_000) });
    assert.equal(result?.value?.recovered, true, "服务恢复后命令未自愈");
  } finally {
    client.close();
    for (const socket of server.frozenSockets) socket.destroy();
    await server.close();
  }
});

test("应用层 4xx 不触发断路：连接池不为命令错误买单", async () => {
  const module = await loadGatewayClient();
  const events = [];
  const server = await startTwoPhaseServer(() => { throw new Error("serving 阶段不应收到请求"); });
  // 本用例全程 serving，但让服务端回 4xx：换成专用小服务器更直接。
  await server.close();
  for (const socket of server.frozenSockets) socket.destroy();

  const errorServer = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      if (!buffer.includes("\r\n\r\n")) return;
      const body = JSON.stringify({ error: "bad request" });
      socket.end(`HTTP/1.1 400 Bad Request\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: keep-alive\r\n\r\n${body}`);
      buffer = "";
    });
  });
  await new Promise((resolve) => errorServer.listen(0, "127.0.0.1", resolve));
  const client = makeClient(module, errorServer.address().port, events);
  try {
    for (let i = 0; i < module.GATEWAY_POOL_RECYCLE_STREAK + 2; i += 1) {
      await assert.rejects(client.command("setHostSettings", {}), (error) => error?.constructor?.name === "SandGatewayCommandError");
    }
    assert.equal(events.filter((e) => e.family === "gateway-pool-recycled").length, 0, "命令错误不应触发池回收");
  } finally {
    client.close();
    await new Promise((resolve) => errorServer.close(() => resolve()));
  }
});
