import { spawn, type ChildProcess } from "node:child_process";

/**
 * computer-use sidecar 的 MCP stdio 会话 —— 语义逐字移植自 0.75.8 daemon 的 Zge 类。
 *
 * 上游锚点（rea-grokbot-0758/apple/evidence.json 提取时的手工 dump，均出自
 * dist/local-exec-daemon/main.cjs）：
 * - spawn `<helper> --mcp-stdio --conversation-id <id>`，stdio pipe/pipe/inherit；
 * - initialize params `{protocolVersion:"2025-06-18", capabilities:{},
 *   clientInfo:{name:"sand-local-exec-daemon", version:"1"}}`，成功后发
 *   `notifications/initialized`；
 * - 请求 2 分钟超时（Tst=2*6e4）→ `timed-out` 并 stop；
 * - 空闲 10 分钟（H0r=10*6e4）→ stop("The computer-use helper was idle and was stopped.")；
 * - cancel → `notifications/cancelled` `{requestId, reason:"The agent cancelled the call."}`；
 * - 退出/失败文案：refused to start / could not start / could not be prepared /
 *   stopped answering。
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_CLIENT_INFO = { name: "sand-local-exec-daemon", version: "1" } as const;

export const SIDECAR_REQUEST_TIMEOUT_MS = 2 * 60_000;
export const SIDECAR_IDLE_STOP_MS = 10 * 60_000;

export const SIDECAR_IDLE_STOP_MESSAGE = "The computer-use helper was idle and was stopped.";
export const SIDECAR_STOPPED_ANSWERING_MESSAGE = "The computer-use helper stopped answering and was stopped.";
export const SIDECAR_CANCEL_REASON = "The agent cancelled the call.";

export interface SidecarTimer {
  dispose(): void;
}

export interface SidecarClock {
  schedule(delayMs: number, run: () => void): SidecarTimer;
}

export const realSidecarClock: SidecarClock = {
  schedule(delayMs, run) {
    const timer = setTimeout(run, delayMs);
    return { dispose() { clearTimeout(timer); } };
  },
};

export type SidecarLaunch = { readonly command: string; readonly args: readonly string[] };

export type SidecarRequestReply =
  | { readonly kind: "result"; readonly result: unknown }
  | { readonly kind: "error"; readonly message: string };

export type SidecarRequestOutcome =
  | SidecarRequestReply
  | { readonly kind: "timed-out" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "exited"; readonly message: string };

export interface SidecarSessionOptions {
  readonly conversationId: string;
  readonly launch: () => Promise<SidecarLaunch>;
  readonly clock?: SidecarClock;
  readonly onClosed?: (message: string) => void;
  readonly spawnImpl?: typeof spawn;
}

interface PendingEntry {
  readonly resolve: (outcome: SidecarRequestOutcome) => void;
  readonly timeout: SidecarTimer;
}

function jsonRpcMessage(value: unknown): { jsonrpc: "2.0"; id?: number; method?: string; params?: unknown } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== "2.0") return undefined;
  return record as { jsonrpc: "2.0"; id?: number; method?: string; params?: unknown };
}

export class SidecarMcpSession {
  readonly ready: Promise<void>;
  private readonly options: Required<Pick<SidecarSessionOptions, "conversationId" | "launch" | "clock">> &
    SidecarSessionOptions;
  private child: ChildProcess | undefined;
  private exitMessage: string | undefined;
  private nextId = 0;
  private readonly pending = new Map<number, PendingEntry>();
  private leases = 0;
  private idle: SidecarTimer | undefined;

  constructor(options: SidecarSessionOptions) {
    this.options = { clock: realSidecarClock, ...options };
    this.ready = this.start();
  }

  lease(): void {
    this.leases += 1;
    this.idle?.dispose();
    this.idle = undefined;
  }

  release(): void {
    this.leases -= 1;
    if (this.leases > 0 || this.exitMessage !== undefined) return;
    this.idle = this.options.clock.schedule(SIDECAR_IDLE_STOP_MS, () => this.stop(SIDECAR_IDLE_STOP_MESSAGE));
  }

  request(method: string, params: unknown): { id: number; reply: Promise<SidecarRequestOutcome> } {
    const id = this.nextId++;
    const { promise, resolve } = Promise.withResolvers<SidecarRequestOutcome>();
    const timeout = this.options.clock.schedule(SIDECAR_REQUEST_TIMEOUT_MS, () => {
      if (this.settle(id, { kind: "timed-out" })) this.stop(SIDECAR_STOPPED_ANSWERING_MESSAGE);
    });
    this.pending.set(id, { resolve, timeout });
    if (this.exitMessage !== undefined) {
      this.settle(id, { kind: "exited", message: this.exitMessage });
    } else {
      this.send({ jsonrpc: "2.0", id, method, params });
    }
    return { id, reply: promise };
  }

  cancel(id: number): void {
    if (this.settle(id, { kind: "cancelled" })) {
      this.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: SIDECAR_CANCEL_REASON } });
    }
  }

  stop(message: string): void {
    this.exit(message);
    this.child?.kill("SIGTERM");
  }

  private send(message: Record<string, unknown>): void {
    if (this.exitMessage !== undefined) return;
    this.child?.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  private exit(message: string): string {
    if (this.exitMessage === undefined) this.exitMessage = message;
    for (const [id, entry] of this.pending) {
      entry.timeout.dispose();
      entry.resolve({ kind: "exited", message: this.exitMessage });
      this.pending.delete(id);
    }
    this.idle?.dispose();
    this.idle = undefined;
    return this.exitMessage;
  }

  private settle(id: number, outcome: SidecarRequestOutcome): boolean {
    const entry = this.pending.get(id);
    if (entry === undefined) return false;
    entry.timeout.dispose();
    this.pending.delete(id);
    entry.resolve(outcome);
    return true;
  }

  private receive(raw: string): void {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    const message = jsonRpcMessage(value);
    if (message === undefined || message.id === undefined || message.method !== undefined) return;
    const entry = this.pending.get(message.id);
    if (entry === undefined) return;
    const record = value as Record<string, unknown>;
    if (typeof record.error === "object" && record.error !== null) {
      const error = record.error as Record<string, unknown>;
      const text = typeof error.message === "string" ? error.message : JSON.stringify(error);
      this.settle(message.id, { kind: "error", message: text });
    } else {
      this.settle(message.id, { kind: "result", result: record.result });
    }
  }

  private async start(): Promise<void> {
    let launch: SidecarLaunch;
    try {
      launch = await this.options.launch();
    } catch (error) {
      this.options.onClosed?.(this.exit(`The computer-use helper could not be prepared (${String(error)}).`));
      return;
    }
    if (this.exitMessage !== undefined) return;
    const spawnImpl = this.options.spawnImpl ?? spawn;
    const child = spawnImpl(launch.command, [...launch.args, "--mcp-stdio", "--conversation-id", this.options.conversationId],
      { stdio: ["pipe", "pipe", "inherit"] });
    this.child = child;
    child.on("error", (error) => {
      this.exit(`The computer-use helper could not start (${String(error)}).`);
    });
    child.on("close", () => {
      const message = this.exitMessage ?? "The computer-use helper exited.";
      this.options.onClosed?.(message);
    });
    child.stdout?.setEncoding("utf8");
    let buffer = "";
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim() !== "") this.receive(line);
      }
    });
    const { reply } = this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: MCP_CLIENT_INFO,
    });
    const outcome = await reply;
    if (outcome.kind === "error") {
      this.stop(`The computer-use helper refused to start: ${outcome.message}`);
      return;
    }
    if (outcome.kind === "result") {
      this.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    }
  }
}
