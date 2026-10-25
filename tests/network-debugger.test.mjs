import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const outfile = path.join(repoRoot, "node_modules", ".cache", "network-debugger.cjs");
await build({
  entryPoints: [path.join(repoRoot, "source/electron-main/dev/network-debugger.ts")],
  bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
});
const {
  NETWORK_DEBUGGER_KIND, NETWORK_DEBUGGER_PROTOCOLS, NETWORK_DEBUGGER_STATUSES,
  grokNodeNetworkDebuggerProbes, httpProbe, networkDebuggerReportFileName, renderNetworkDebuggerHtml,
  runNetworkDebuggerChecks, serializeNetworkDebuggerReport, tcpProbe,
} = require(outfile);

const clock = { now: () => { tick += step; return tick; } };
let tick = 0;
const step = 7;

test("report shape, filename, and serialization match the upstream contract", async () => {
  tick = 0;
  const report = await runNetworkDebuggerChecks([
    { id: "a", protocol: "http", target: "http://127.0.0.1:1/x", run: async () => ({ status: "passed", detail: "HTTP 200" }) },
    { id: "b", protocol: "api", target: "127.0.0.1:2", run: async () => ({ status: "failed" }) },
    { id: "c", protocol: "tls", target: "x", run: async () => { throw new Error("boom"); } },
  ], clock);
  assert.equal(report.kind, "grok-bot-network-debugger");
  assert.equal(report.kind, NETWORK_DEBUGGER_KIND);
  assert.deepEqual(report.allowlist, ["http://127.0.0.1:1/x", "127.0.0.1:2", "x"]);
  assert.deepEqual(report.checks.map((c) => [c.id, c.status, c.durationMs]),
    [["a", "passed", 7], ["b", "failed", 7], ["c", "failed", 7]]);
  assert.equal(report.checks[2].detail, "boom");
  assert.deepEqual(NETWORK_DEBUGGER_PROTOCOLS, ["api", "dns", "http", "https", "sse", "tls", "websocket"]);
  assert.deepEqual(NETWORK_DEBUGGER_STATUSES, ["passed", "warning", "failed", "skipped"]);
  assert.equal(networkDebuggerReportFileName(report.startedAtMs), `grok-bot-network-debugger-${report.startedAtMs}.json`);
  const text = serializeNetworkDebuggerReport(report);
  assert.ok(text.endsWith("}\n"));
  assert.ok(text.includes('"durationMs": 7'));
  assert.ok(!text.includes('"detail": undefined'));
});

test("http probe passes on 2xx, warns on any other HTTP answer, fails on network error", async () => {
  const responding = (status) => async () => ({ ok: status < 400, status });
  const passed = await httpProbe({ id: "h1", target: "u", fetchFn: responding(200) }).run();
  assert.deepEqual(passed, { status: "passed", detail: "HTTP 200" });
  const forbidden = await httpProbe({ id: "h2", target: "u", fetchFn: responding(403) }).run();
  assert.deepEqual(forbidden, { status: "warning", detail: "HTTP 403 (listener answered)" });
  const down = await httpProbe({
    id: "h3", target: "u",
    fetchFn: async () => { throw new Error("ECONNREFUSED"); },
  }).run().catch((error) => ({ status: "thrown", detail: String(error) }));
  assert.ok(down.status === "thrown" || down.status === "failed");
});

test("tcp probe reports a real listener as passed and a dead port as failed", async () => {
  const server = createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const up = await tcpProbe({ id: "t1", host: "127.0.0.1", port, target: `127.0.0.1:${port}` }).run();
    assert.equal(up.status, "passed");
    const dead = await tcpProbe({ id: "t2", host: "127.0.0.1", port: port + 1, target: "x" }).run();
    assert.equal(dead.status, "failed");
  } finally {
    server.close();
  }
});

test("the grok-node default probe list covers gateway, vnc, and relay targets", () => {
  const probes = grokNodeNetworkDebuggerProbes();
  assert.deepEqual(probes.map((probe) => probe.id), ["gateway-health", "box-vnc", "relay-forwarder"]);
  assert.equal(probes[0].protocol, "http");
  assert.equal(probes[0].target, "http://127.0.0.1:1340/health");
  assert.equal(probes[1].target, "127.0.0.1:6080");
  assert.equal(probes[2].target, "127.0.0.1:11010");
});

test("the dialog page is self-contained and wired to the run endpoint", async () => {
  const html = renderNetworkDebuggerHtml();
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("/network-debugger"));
  assert.ok(html.includes("grok-bot-network-debugger-"));
  for (const marker of ["\u2713", "\u2715", "\u2013", "运行检查", "导出报告"]) assert.ok(html.includes(marker), marker);
  for (const external of ["http://", "https://", "<link", "<script src"]) {
    assert.ok(!html.slice(html.indexOf("<body")).includes(external), `page must not depend on ${external}`);
  }
});
