import { connect as tcpConnect } from "node:net";

/**
 * 应用内网络诊断（"连接医生"）引擎 —— 契约移植自 0.75.8 的
 * chunk-network-debugger-dialog，检查清单按 Grok Node 本地链路适配。
 *
 * 上游契约（rea-grokbot-0758/app/dist/renderer/assets/chunk-network-debugger-dialog-Bh_KmfYk.js）：
 * - 状态四态 passed | warning | failed | skipped（图标映射 check-circle/warning/x-circle/minus-circle）；
 * - 协议集 api dns http https sse tls websocket（渲染层 T() 对该集合大写）；
 * - 单项 {id, protocol, status, target, durationMs, detail?}；
 * - 报告 {kind:"grok-bot-network-debugger", startedAtMs, durationMs, allowlist, checks}，
 *   导出 JSON.stringify(..., null, 2) + "\n"，文件名 grok-bot-network-debugger-<startedAtMs>.json。
 *
 * 上游检查 id（api-dns/computer-dns/voice-realtime 等 17 项）全是 cursor.sh/x.ai
 * 云端端点；Grok Node 走本地推理，检查清单替换为本机三面：box 网关健康、box VNC
 * 端口、Mac 侧推理中继。这是 Grok Node 扩展面，不是对上游 UI 的重建。
 */

export const NETWORK_DEBUGGER_KIND = "grok-bot-network-debugger";
export const NETWORK_DEBUGGER_PROTOCOLS = ["api", "dns", "http", "https", "sse", "tls", "websocket"] as const;
export type NetworkDebuggerProtocol = (typeof NETWORK_DEBUGGER_PROTOCOLS)[number];

export const NETWORK_DEBUGGER_STATUSES = ["passed", "warning", "failed", "skipped"] as const;
export type NetworkDebuggerStatus = (typeof NETWORK_DEBUGGER_STATUSES)[number];

export interface NetworkDebuggerCheck {
  readonly id: string;
  readonly protocol: NetworkDebuggerProtocol;
  readonly status: NetworkDebuggerStatus;
  readonly target: string;
  readonly durationMs: number;
  readonly detail?: string;
}

export interface NetworkDebuggerReport {
  readonly kind: typeof NETWORK_DEBUGGER_KIND;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly allowlist: readonly string[];
  readonly checks: readonly NetworkDebuggerCheck[];
}

export function networkDebuggerReportFileName(startedAtMs: number): string {
  return `grok-bot-network-debugger-${startedAtMs}.json`;
}

export function serializeNetworkDebuggerReport(report: NetworkDebuggerReport): string {
  const checks = report.checks.map((check) => ({
    id: check.id, protocol: check.protocol, status: check.status, target: check.target,
    durationMs: check.durationMs, ...(check.detail == null ? {} : { detail: check.detail }),
  }));
  return `${JSON.stringify({
    kind: NETWORK_DEBUGGER_KIND, startedAtMs: report.startedAtMs, durationMs: report.durationMs,
    allowlist: report.allowlist, checks,
  }, null, 2)}\n`;
}

export interface NetworkDebuggerProbe {
  readonly id: string;
  readonly protocol: NetworkDebuggerProtocol;
  readonly target: string;
  run(): Promise<{ readonly status: NetworkDebuggerStatus; readonly detail?: string }>;
}

export interface NetworkDebuggerClock {
  now(): number;
}

export async function runNetworkDebuggerChecks(
  probes: readonly NetworkDebuggerProbe[],
  clock: NetworkDebuggerClock = { now: () => Date.now() },
): Promise<NetworkDebuggerReport> {
  const startedAtMs = clock.now();
  const checks: NetworkDebuggerCheck[] = [];
  for (const probe of probes) {
    const started = clock.now();
    let outcome: { status: NetworkDebuggerStatus; detail?: string };
    try {
      outcome = await probe.run();
    } catch (error) {
      outcome = { status: "failed", detail: error instanceof Error ? error.message : String(error) };
    }
    checks.push({
      id: probe.id, protocol: probe.protocol, target: probe.target, status: outcome.status,
      durationMs: Math.max(0, clock.now() - started),
      ...(outcome.detail == null ? {} : { detail: outcome.detail }),
    });
  }
  return {
    kind: NETWORK_DEBUGGER_KIND, startedAtMs, durationMs: Math.max(0, clock.now() - startedAtMs),
    allowlist: probes.map((probe) => probe.target), checks,
  };
}

/** HTTP 探针：任何 HTTP 应答（含 401/403）都证明监听者活着，网络错误才算 failed。 */
export function httpProbe(options: {
  readonly id: string;
  readonly protocol?: NetworkDebuggerProtocol;
  readonly target: string;
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
}): NetworkDebuggerProbe {
  const protocol = options.protocol ?? "http";
  const fetchFn = options.fetchFn ?? fetch;
  return {
    id: options.id, protocol, target: options.target,
    async run() {
      const response = await fetchFn(options.target, { signal: AbortSignal.timeout(options.timeoutMs ?? 4_000) });
      return response.ok
        ? { status: "passed", detail: `HTTP ${response.status}` }
        : { status: "warning", detail: `HTTP ${response.status} (listener answered)` };
    },
  };
}

/** TCP 连通探针：端口在听即 passed，拒绝/超时即 failed。 */
export function tcpProbe(options: {
  readonly id: string;
  readonly target: string;
  readonly host: string;
  readonly port: number;
  readonly timeoutMs?: number;
}): NetworkDebuggerProbe {
  return {
    id: options.id, protocol: "api", target: options.target,
    run: () => new Promise((resolve) => {
      const socket = tcpConnect({ host: options.host, port: options.port });
      const finish = (status: NetworkDebuggerStatus, detail: string): void => {
        socket.destroy();
        resolve({ status, detail });
      };
      socket.setTimeout(options.timeoutMs ?? 2_000, () => finish("failed", `tcp ${options.host}:${options.port} timed out`));
      socket.once("connect", () => finish("passed", `tcp ${options.host}:${options.port} reachable`));
      socket.once("error", (error) => finish("failed", `tcp ${options.host}:${options.port} ${String(error)}`));
    }),
  };
}

export const GROK_NODE_GATEWAY_HEALTH_URL = "http://127.0.0.1:1340/health";
export const GROK_NODE_BOX_VNC_TARGET = "127.0.0.1:6080";
export const GROK_NODE_RELAY_FORWARDER_TARGET = "127.0.0.1:11010";

/** Grok Node 默认检查清单：box 网关健康、box VNC、Mac 侧推理中继。 */
export function grokNodeNetworkDebuggerProbes(options: {
  readonly fetchFn?: typeof fetch;
} = {}): readonly NetworkDebuggerProbe[] {
  return [
    httpProbe({ id: "gateway-health", target: GROK_NODE_GATEWAY_HEALTH_URL, ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }) }),
    tcpProbe({ id: "box-vnc", host: "127.0.0.1", port: 6_080, target: GROK_NODE_BOX_VNC_TARGET }),
    tcpProbe({ id: "relay-forwarder", host: "127.0.0.1", port: 11_010, target: GROK_NODE_RELAY_FORWARDER_TARGET }),
  ];
}
