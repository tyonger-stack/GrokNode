import { randomUUID } from "node:crypto";

import { Agent, fetch as undiciFetch } from "undici";

import {
  DeadlineExceededError,
  createDeadlinePolicy,
  createIdleWatchdogPolicy,
  createRetryPolicy,
  realClock,
  type Clock,
  type DeadlinePolicy,
  type IdleWatchdogPolicy,
  type RetryPolicy
} from "../../internal/scheduling.js";
import { findSandBoxBlockedMessage, SAND_CLIENT_PAUSE_BLOCKED_MESSAGE } from "../../shared/gateway-reachability.js";
import {
  GATEWAY_API_PREFIX,
  GATEWAY_AUTH_SCHEME,
  GATEWAY_EVENTS_PATH,
  GATEWAY_MINT_DEDUPE_HEADER,
  GATEWAY_SLIM_AVATARS_HEADER,
  GATEWAY_TRACEPARENT_HEADER
} from "../../shared/gateway-wire.js";
import { deriveChildTraceparent } from "../../shared/observability/send-trace.js";
import { proxifyForeverBoxStatus, type ForeverBoxStatus, type VncProxyDescriptor } from "./box-vnc-proxy.js";
import { SandGatewayCommandError } from "./gateway-errors.js";
import {
  SandGatewayUnreachableError,
  classifyBaseUrlKind,
  classifyGatewayError,
  classifyStreamDown,
  outcomeForHttpStatus,
  type GatewayReachabilityOutcome
} from "./gateway-reachability.js";
import { SseBlockDecoder } from "./sse-block-decoder.js";

export const PERMANENT_REFUSAL_KINDS = new Set(["no_storage", "box_blocked", "access_denied"]);
export const PRE_DISPATCH_KINDS = new Set(["refused", "dns"]);
/**
 * 传输层失败种类：连续命中这些达 {@link GATEWAY_POOL_RECYCLE_STREAK} 次（窗口
 * {@link GATEWAY_POOL_RECYCLE_WINDOW_MS}）就整体回收网关连接池。命令失败
 * （4xx SandGatewayCommandError）不算——那是服务端在正常说话。
 */
export const TRANSPORT_FAILURE_KINDS: ReadonlySet<string> = new Set(["network", "timeout", "refused", "dns", "http_5xx"]);
export const GATEWAY_POOL_RECYCLE_STREAK = 3;
export const GATEWAY_POOL_RECYCLE_WINDOW_MS = 30_000;
export const CREATE_AGENT_RETRY_POLICY = { name: "gateway-create-agent-retry", maxAttempts: 3, initialDelayMs: 1_000, maxDelayMs: 4_000, backoffFactor: 2 } as const;
export const SSE_RECONNECT_MIN_MS = 1_000;
export const SSE_RECONNECT_MAX_MS = 10_000;
export const SSE_STALL_TIMEOUT_MS = 35_000;
export const SSE_CONNECT_TIMEOUT_MS = 15_000;
export const SEND_POST_TIMEOUT_MS = 15_000;
export const ROSTER_READ_TIMEOUT_MS = 15_000;
export const TRACE_WINDOW_ROOT_CACHE_MS = 5_000;
export const HOST_ACCOUNT_SLOT = "host";

const DISABLE_SEND_ACCEPT_RETURN_ENV = "SAND_DISABLE_SEND_ACCEPT_RETURN";
const SEND_POST_TIMEOUT_ENV = "SAND_SEND_POST_TIMEOUT_MS";
const ROSTER_READ_TIMEOUT_ENV = "SAND_ROSTER_READ_TIMEOUT_MS";
const DISABLE_SLIM_AVATARS_ENV = "SAND_DISABLE_SLIM_AVATARS";

export function extractGatewayErrorMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { readonly error?: unknown };
    return typeof parsed.error === "string" && parsed.error.length > 0 ? parsed.error : null;
  } catch { return null; }
}

export { SandGatewayCommandError } from "./gateway-errors.js";
export class GatewayEndpointChangedError extends Error {}

export interface GatewayClientTiming {
  readonly clock: Clock;
  readonly reconnectBackoff: RetryPolicy;
  readonly connectDeadline: DeadlinePolicy;
  readonly stallWatchdog: IdleWatchdogPolicy;
  readonly sendPostDeadline: DeadlinePolicy;
  readonly rosterReadDeadline: DeadlinePolicy;
  readonly createAgentRetry: RetryPolicy;
}

export function createCoordinatorGatewayClientTiming(): GatewayClientTiming {
  const overrideMs = Number(process.env[SEND_POST_TIMEOUT_ENV]);
  const sendPostTimeoutMs = Number.isFinite(overrideMs) && overrideMs > 0 ? overrideMs : SEND_POST_TIMEOUT_MS;
  const rosterReadOverrideMs = Number(process.env[ROSTER_READ_TIMEOUT_ENV]);
  const rosterReadTimeoutMs = Number.isFinite(rosterReadOverrideMs) && rosterReadOverrideMs > 0 ? rosterReadOverrideMs : ROSTER_READ_TIMEOUT_MS;
  return {
    clock: realClock,
    reconnectBackoff: createRetryPolicy(realClock, { name: "gateway-sse-reconnect-backoff", maxAttempts: Number.MAX_SAFE_INTEGER, initialDelayMs: SSE_RECONNECT_MIN_MS, maxDelayMs: SSE_RECONNECT_MAX_MS, backoffFactor: 2 }),
    connectDeadline: createDeadlinePolicy(realClock, { name: "gateway-sse-connect", timeoutMs: SSE_CONNECT_TIMEOUT_MS }),
    stallWatchdog: createIdleWatchdogPolicy(realClock, { name: "gateway-sse-stall", idleMs: SSE_STALL_TIMEOUT_MS }),
    sendPostDeadline: createDeadlinePolicy(realClock, { name: "gateway-send-post", timeoutMs: sendPostTimeoutMs }),
    rosterReadDeadline: createDeadlinePolicy(realClock, { name: "gateway-roster-read", timeoutMs: rosterReadTimeoutMs }),
    createAgentRetry: createRetryPolicy(realClock, CREATE_AGENT_RETRY_POLICY)
  };
}

export interface GatewayConnection {
  readonly baseUrl: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly token?: string | null;
  readonly vncProxy?: VncProxyDescriptor | null;
}

export function withAuth(headers: Record<string, string>, connection: GatewayConnection): Record<string, string> {
  const merged = { ...headers, ...(connection.headers ?? {}) };
  if (connection.token != null && connection.token.length > 0) merged.authorization = `${GATEWAY_AUTH_SCHEME} ${connection.token}`;
  return merged;
}

export interface CoordinatorGatewayClientOptions {
  readonly resolveConnection: (signal?: AbortSignal) => Promise<GatewayConnection>;
  readonly timing: GatewayClientTiming;
  readonly onEvent: (event: { readonly channel: string; readonly payload: unknown }) => void;
  readonly onTransportEvent?: (event: unknown) => void;
  readonly onTransportRetry?: () => void;
  readonly onReachability?: (report: unknown, baseUrl?: string) => void;
  readonly recordTransportStage?: (report: unknown) => void;
  readonly recordGatewayCommandSpan?: (report: unknown) => void;
  readonly resolveTraceWindowTraceparent?: () => Promise<string | null | undefined>;
}

type RequestInit = { readonly signal?: AbortSignal; readonly requiredBaseUrl?: string };

export class CoordinatorGatewayClient {
  private isClosed = false;
  private devInducedOffline = false;
  private clientPaused = false;
  private transportState: "initial" | "connected" | "disconnected" = "initial";
  private eventLoopPromise: Promise<void> | undefined;
  private activeEventLoopController: AbortController | undefined;
  private reconnectGeneration = 0;
  private pendingForcedReconnect: (ReturnType<typeof Promise.withResolvers<void>> & { generation: number }) | undefined;
  private connectionCount = 0;
  private readonly sendAcceptReturnDisabled: boolean;
  private readonly slimAvatarsDisabled: boolean;
  private cachedTraceWindowRoot: { expiresAtMonotonicMs: number; root?: string } | undefined;
  private inflightTraceWindowRoot: Promise<void> | undefined;
  private spanSinkBroken = false;
  private readonly options: Omit<CoordinatorGatewayClientOptions, "resolveConnection">;
  private readonly upstreamResolveConnection: CoordinatorGatewayClientOptions["resolveConnection"];
  private readonly mintDedupeProvenBaseUrls = new Set<string>();
  private readonly sendDedupeProvenBaseUrls = new Set<string>();
  private gatewayAgent: Agent;
  private transportFailureStreak = 0;
  private lastTransportFailureAtMonotonicMs: number | undefined;

  constructor(options: CoordinatorGatewayClientOptions) {
    const { resolveConnection, ...rest } = options;
    this.options = rest;
    this.upstreamResolveConnection = resolveConnection;
    this.sendAcceptReturnDisabled = process.env[DISABLE_SEND_ACCEPT_RETURN_ENV] === "1";
    this.slimAvatarsDisabled = process.env[DISABLE_SLIM_AVATARS_ENV] === "1";
    this.gatewayAgent = this.createGatewayAgent();
  }

  /**
   * 专用网关连接池：不依赖全局 dispatcher，断路回收时可整体销毁重建。
   *
   * 2026-10-11 事故背景：OrbStack 端口转发坏窗期间建立的 keep-alive 连接被静默
   * 冻结（无 RST、无 FIN，请求写进去永远没有回音，socket 状态一直是
   * ESTABLISHED）。走全局 fetch 的池子会永远复用这批死连接——每 5s 的重试全部
   * 撞在同一批冻结 socket 上，「正在重新连接」横幅挂到进程重启才消失。重启即愈
   * 证明网关/token/网络都好，坏的只是池子，所以自愈单元就是池子本身。
   *
   * keepAliveTimeout 让空闲冻结连接 10s 内自然淘汰；连击断路（见
   * noteTransportFailure）兜底「冻结连接一直被复用」的情形——销毁会让在途请求
   * 立刻失败、挂起的 promise 立刻 settle，下一跳就是全新 TCP。
   */
  private createGatewayAgent(): Agent {
    return new Agent({ connect: { timeout: SSE_CONNECT_TIMEOUT_MS }, keepAliveTimeout: 10_000, keepAliveMaxTimeout: 10_000 });
  }

  /**
   * 所有网关 HTTP（命令 / sendPrompt / SSE）统一走专用池，禁止落到全局 dispatcher。
   * fetch 与 Agent 必须来自同一个 undici 包实例——跨大版本混搭（Node 内置 undici v7
   * 的全局 fetch + npm undici 5.x 的 Agent）没有协议兼容保证。
   */
  private gatewayFetch(url: string, init: { method?: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<Response> {
    return undiciFetch(url, {
      ...(init.method == null ? {} : { method: init.method as "POST" }),
      headers: init.headers,
      ...(init.body == null ? {} : { body: init.body }),
      ...(init.signal == null ? {} : { signal: init.signal }),
      dispatcher: this.gatewayAgent
    }) as unknown as Promise<Response>;
  }

  private noteTransportFailure(kind: GatewayReachabilityOutcome | string): void {
    if (!TRANSPORT_FAILURE_KINDS.has(kind)) return;
    const now = this.options.timing.clock.monotonicNow();
    if (this.lastTransportFailureAtMonotonicMs !== undefined && now - this.lastTransportFailureAtMonotonicMs > GATEWAY_POOL_RECYCLE_WINDOW_MS) this.transportFailureStreak = 0;
    this.lastTransportFailureAtMonotonicMs = now;
    this.transportFailureStreak += 1;
    if (this.transportFailureStreak >= GATEWAY_POOL_RECYCLE_STREAK) this.recycleGatewayAgent(`transport-failure-streak-${this.transportFailureStreak}`);
  }

  private noteTransportHealthy(): void {
    this.transportFailureStreak = 0;
    this.lastTransportFailureAtMonotonicMs = undefined;
  }

  private recycleGatewayAgent(reason: string): void {
    if (this.isClosed) return;
    const dead = this.gatewayAgent;
    this.gatewayAgent = this.createGatewayAgent();
    this.noteTransportHealthy();
    this.emitTransportEvent({ family: "gateway-pool-recycled", payload: { reason } });
    void dead.destroy().catch(() => {});
  }

  requestHeaders(base: Record<string, string>, connection: GatewayConnection): Record<string, string> {
    const headers = withAuth(base, connection);
    if (!this.slimAvatarsDisabled) headers[GATEWAY_SLIM_AVATARS_HEADER] = "1";
    return headers;
  }

  private traceWindowRoot(): string | undefined {
    const resolve = this.options.resolveTraceWindowTraceparent;
    if (resolve === undefined) return undefined;
    const now = this.options.timing.clock.monotonicNow();
    const cached = this.cachedTraceWindowRoot;
    const isFresh = cached !== undefined && now < cached.expiresAtMonotonicMs;
    if (!isFresh && this.inflightTraceWindowRoot === undefined) {
      const inflight = this.pullTraceWindowRoot(resolve).finally(() => {
        if (this.inflightTraceWindowRoot === inflight) this.inflightTraceWindowRoot = undefined;
      });
      this.inflightTraceWindowRoot = inflight;
    }
    return cached?.root;
  }

  private async pullTraceWindowRoot(resolve: () => Promise<string | null | undefined>): Promise<void> {
    try {
      const root = await resolve() ?? undefined;
      this.cachedTraceWindowRoot = { expiresAtMonotonicMs: this.options.timing.clock.monotonicNow() + TRACE_WINDOW_ROOT_CACHE_MS, ...(root === undefined ? {} : { root }) };
    } catch { this.cachedTraceWindowRoot = undefined; }
  }

  start(): void {
    if (this.isClosed || this.eventLoopPromise != null) return;
    this.eventLoopPromise = this.runEventLoop().finally(() => { this.eventLoopPromise = undefined; });
  }

  forceReconnect(): Promise<void> {
    if (this.isClosed) return Promise.reject(new Error("gateway client is closed"));
    // 强制重连的语义就是「扔掉一切旧连接重来」——池子也一起回收，
    // 否则新的 SSE/命令请求仍会复用冻结的 keep-alive 连接。
    this.recycleGatewayAgent("forced-reconnect");
    if (this.pendingForcedReconnect != null) {
      this.reconnectGeneration += 1;
      this.interruptEventLoopAttempt();
      return this.pendingForcedReconnect.promise;
    }
    const deferred = Promise.withResolvers<void>();
    this.reconnectGeneration += 1;
    this.pendingForcedReconnect = { ...deferred, generation: this.reconnectGeneration };
    this.interruptEventLoopAttempt();
    return deferred.promise;
  }

  private interruptEventLoopAttempt(): void {
    if (this.transportState !== "connected") this.notifyDisconnected("forced-reconnect", null);
    this.activeEventLoopController?.abort();
    this.start();
  }

  private emitTransportEvent(event: unknown): void { this.options.onTransportEvent?.(event); }

  setDevInducedOffline(induced: boolean): { induced: boolean } {
    if (this.devInducedOffline !== induced) { this.devInducedOffline = induced; this.activeEventLoopController?.abort(); }
    return { induced: this.devInducedOffline };
  }

  setClientPaused(paused: boolean): { paused: boolean } {
    if (this.clientPaused !== paused) { this.clientPaused = paused; this.activeEventLoopController?.abort(); }
    return { paused: this.clientPaused };
  }

  async resolveConnection(signal?: AbortSignal): Promise<GatewayConnection> {
    if (this.clientPaused) throw new SandGatewayUnreachableError("box_blocked", SAND_CLIENT_PAUSE_BLOCKED_MESSAGE, { causeSummary: "client-paused" });
    if (this.devInducedOffline) throw new SandGatewayUnreachableError("network", "gateway offline: induced by dev controls", { causeSummary: "dev-induced-offline" });
    return await this.upstreamResolveConnection(signal);
  }

  private notifyDisconnected(reason: string, cause: string | null): void {
    if (this.isClosed || this.transportState === "disconnected") return;
    this.transportState = "disconnected";
    this.emitTransportEvent({ family: "transport-down", payload: { generation: this.connectionCount, reason, cause } });
  }

  close(): void {
    this.isClosed = true;
    this.activeEventLoopController?.abort();
    this.pendingForcedReconnect?.reject(new Error("gateway client closed"));
    this.pendingForcedReconnect = undefined;
    void this.gatewayAgent.destroy().catch(() => {});
  }

  private reportReachability(report: unknown, baseUrl?: string): void {
    if (this.clientPaused) return;
    try { this.options.onReachability?.(report, baseUrl); } catch {}
  }

  private recordSendStage(stage: Record<string, unknown>): void {
    const recorder = this.options.recordTransportStage;
    const clientNonce = stage.clientNonce;
    if (recorder == null || typeof clientNonce !== "string" || clientNonce.length === 0) return;
    try { recorder({ accountSlot: HOST_ACCOUNT_SLOT, ...stage, clientNonce, traceparent: stage.traceparent ?? null, isError: stage.isError === true }); } catch {}
  }

  private reportCommandSpan(method: string, commandTrace: { root: string; child: { spanId: string } } | undefined, settle: Record<string, unknown>): void {
    const sink = this.options.recordGatewayCommandSpan;
    if (commandTrace === undefined || sink == null || this.spanSinkBroken) return;
    try { sink({ method, rootTraceparent: commandTrace.root, spanId: commandTrace.child.spanId, ...settle }); }
    catch { this.spanSinkBroken = true; }
  }

  async request(method: string, args: unknown, init?: RequestInit): Promise<{ result: unknown; connection: GatewayConnection }> {
    const startMonotonicMs = this.options.timing.clock.monotonicNow();
    let connection: GatewayConnection | undefined;
    let commandTrace: { root: string; child: { traceparent: string; spanId: string } } | undefined;
    let fetchStartMonotonicMs = startMonotonicMs;
    let fetchStartEpochMs = 0;
    try {
      connection = await this.resolveConnection(init?.signal);
      if (init?.requiredBaseUrl != null && connection.baseUrl !== init.requiredBaseUrl) throw new GatewayEndpointChangedError();
      const root = this.traceWindowRoot();
      const child = root !== undefined && this.options.recordGatewayCommandSpan != null ? deriveChildTraceparent(root) : undefined;
      if (root !== undefined && child !== undefined) commandTrace = { root, child };
      const traceparent = child?.traceparent ?? root;
      fetchStartMonotonicMs = this.options.timing.clock.monotonicNow();
      fetchStartEpochMs = this.options.timing.clock.now();
      const response = await this.gatewayFetch(`${connection.baseUrl}${GATEWAY_API_PREFIX}/${method}`, {
        method: "POST",
        headers: this.requestHeaders({ "content-type": "application/json", ...(traceparent === undefined ? {} : { [GATEWAY_TRACEPARENT_HEADER]: traceparent }) }, connection),
        body: JSON.stringify(args ?? {}),
        ...(init?.signal == null ? {} : { signal: init.signal })
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText);
        const message = extractGatewayErrorMessage(detail) ?? `gateway ${method} failed: ${detail}`;
        if (response.status < 500) throw new SandGatewayCommandError(message);
        throw new SandGatewayUnreachableError("http_5xx", message, { httpStatus: response.status, attemptedBaseUrl: connection.baseUrl });
      }
      const result = await response.json() as unknown;
      if (response.headers.get(GATEWAY_MINT_DEDUPE_HEADER) === "1") this.mintDedupeProvenBaseUrls.add(connection.baseUrl);
      this.noteTransportHealthy();
      this.reportCommandSpan(method, commandTrace, { startEpochMs: fetchStartEpochMs, durationMs: this.options.timing.clock.monotonicNow() - fetchStartMonotonicMs, isError: false });
      return { result, connection };
    } catch (error) {
      this.reportCommandSpan(method, commandTrace, { startEpochMs: fetchStartEpochMs, durationMs: this.options.timing.clock.monotonicNow() - fetchStartMonotonicMs, isError: true });
      if (error instanceof SandGatewayCommandError || error instanceof GatewayEndpointChangedError) throw error;
      const classified = classifyGatewayError(error);
      this.noteTransportFailure(classified.outcome);
      this.reportReachability({ outcome: classified.outcome, method, latencyMs: this.options.timing.clock.monotonicNow() - startMonotonicMs, baseUrlKind: classifyBaseUrlKind(connection?.baseUrl), ...(classified.httpStatus === undefined ? {} : { httpStatus: classified.httpStatus }), ...(classified.causeSummary === undefined ? {} : { causeSummary: classified.causeSummary }) }, connection?.baseUrl);
      if (error instanceof SandGatewayUnreachableError) throw error;
      const blocked = findSandBoxBlockedMessage(error);
      throw new SandGatewayUnreachableError(classified.outcome, blocked == null ? `gateway ${method} unreachable (${classified.outcome})` : `gateway ${method} unreachable (${classified.outcome}): ${blocked}`, { cause: error, ...(classified.causeSummary === undefined ? {} : { causeSummary: classified.causeSummary }), ...(connection === undefined ? {} : { attemptedBaseUrl: connection.baseUrl }), isPreDispatch: connection === undefined });
    }
  }

  async command(method: string, args: unknown, init?: RequestInit): Promise<unknown> { return (await this.request(method, args, init)).result; }

  dispatchCommand(method: string, args: unknown, init?: RequestInit): Promise<unknown> {
    const record = typeof args === "object" && args != null ? args as Record<string, unknown> : {};
    if (method === "sendPrompt") return this.sendPrompt(record);
    if (method === "getForeverBoxStatus" || method === "ensureForeverBox") return this.foreverBoxStatusCommand(method, args, init);
    if (method === "listAgents" || method === "countAgents") return this.boundedRosterRead(method, init);
    if (method === "createAgent") return this.createAgentWithRetry(record, init);
    if (method === "setDevGatewayOffline") return Promise.resolve(this.setDevInducedOffline(record.induced === true));
    if (method === "setGatewayPaused") return Promise.resolve(this.setClientPaused(record.paused === true));
    return this.command(method, args, init);
  }

  async dispatchLegacyCommand(method: string, args: unknown): Promise<void> { await this.command(method, args); }

  private async createAgentWithRetry(args: Record<string, unknown>, init?: RequestInit): Promise<unknown> {
    const stamped = { ...args, clientNonce: args.clientNonce ?? randomUUID() };
    let pinnedBaseUrl: string | undefined;
    let lastError: unknown;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return (await this.request("createAgent", stamped, { ...(init?.signal == null ? {} : { signal: init.signal }), ...(pinnedBaseUrl == null ? {} : { requiredBaseUrl: pinnedBaseUrl }) })).result;
      } catch (error) {
        if (error instanceof GatewayEndpointChangedError) throw lastError;
        lastError = error;
        const retryable = attempt < CREATE_AGENT_RETRY_POLICY.maxAttempts && init?.signal?.aborted !== true && !(error instanceof SandGatewayCommandError) && !(error instanceof SandGatewayUnreachableError && PERMANENT_REFUSAL_KINDS.has(error.kind));
        if (!retryable) throw error;
        const preDispatch = error instanceof SandGatewayUnreachableError && (error.isPreDispatch === true || PRE_DISPATCH_KINDS.has(error.kind));
        if (!preDispatch) {
          const attempted = error instanceof SandGatewayUnreachableError ? error.attemptedBaseUrl : undefined;
          if (attempted == null || !this.mintDedupeProvenBaseUrls.has(attempted)) throw error;
          pinnedBaseUrl = attempted;
        }
      }
      const wait = this.options.timing.createAgentRetry.schedule(attempt, init?.signal);
      try { await wait.elapsed; } finally { wait.dispose(); }
      this.noteTransportRetry();
    }
  }

  private noteTransportRetry(): void { try { this.options.onTransportRetry?.(); } catch {} }

  private async boundedRosterRead(method: string, init?: RequestInit): Promise<unknown> {
    try { return await this.boundedRosterReadAttempt(method, init); }
    catch (error) {
      const retryable = !this.isClosed && init?.signal?.aborted !== true && !(error instanceof SandGatewayCommandError) && !(error instanceof SandGatewayUnreachableError && PERMANENT_REFUSAL_KINDS.has(error.kind));
      if (!retryable) throw error;
      this.noteTransportRetry();
      return await this.boundedRosterReadAttempt(method, init);
    }
  }

  private async boundedRosterReadAttempt(method: string, init?: RequestInit): Promise<unknown> {
    try { return await this.options.timing.rosterReadDeadline.run((signal) => this.command(method, {}, { signal }), init?.signal); }
    catch (error) {
      if (error instanceof DeadlineExceededError) throw new SandGatewayUnreachableError("timeout", `gateway ${method} unreachable (timeout)`, { cause: error });
      throw error;
    }
  }

  private async sendPrompt(args: Record<string, unknown>): Promise<unknown> {
    if (this.sendAcceptReturnDisabled) return await this.command("sendPrompt", args);
    const first = { baseUrl: undefined as string | undefined, postStarted: false };
    try { return await this.sendPromptAttempt(args, 0, first); }
    catch (error) {
      const postNeverDispatched = !first.postStarted;
      const clientNonce = args.clientNonce;
      const dedupeProven = first.baseUrl != null && this.sendDedupeProvenBaseUrls.has(first.baseUrl);
      const retryable = !this.isClosed && typeof clientNonce === "string" && clientNonce.length > 0 && !(error instanceof SandGatewayCommandError) && (postNeverDispatched || dedupeProven);
      if (!retryable) throw error;
      this.noteTransportRetry();
      return await this.sendPromptAttempt(args, 1, { baseUrl: undefined, postStarted: false }, postNeverDispatched ? undefined : first.baseUrl);
    }
  }

  private async sendPromptAttempt(args: Record<string, unknown>, attempt: number, state: { baseUrl: string | undefined; postStarted: boolean }, requiredBaseUrl?: string): Promise<unknown> {
    const clock = this.options.timing.clock;
    const connectStartEpochMs = clock.now();
    const connectStartMonotonicMs = clock.monotonicNow();
    const connection = await this.resolveConnection();
    state.baseUrl = connection.baseUrl;
    if (requiredBaseUrl != null && connection.baseUrl !== requiredBaseUrl) throw new Error("send retry aborted: the gateway endpoint changed mid-send");
    this.recordSendStage({ stage: "gateway-connect", attempt, clientNonce: args.clientNonce, traceparent: args.traceparent, startEpochMs: connectStartEpochMs, durationMs: clock.monotonicNow() - connectStartMonotonicMs });
    const postStartEpochMs = clock.now();
    const postStartMonotonicMs = clock.monotonicNow();
    try {
      state.postStarted = true;
      const result = await this.options.timing.sendPostDeadline.run(async (signal) => {
        const response = await this.gatewayFetch(`${connection.baseUrl}${GATEWAY_API_PREFIX}/sendPrompt`, { method: "POST", headers: this.requestHeaders({ "content-type": "application/json" }, connection), body: JSON.stringify(args), signal });
        if (!response.ok) {
          const detail = await response.text().catch(() => response.statusText);
          throw new SandGatewayCommandError(extractGatewayErrorMessage(detail) ?? `gateway sendPrompt failed: ${detail}`);
        }
        return await response.json() as unknown;
      });
      if (typeof result === "object" && result != null && "accepted" in result && result.accepted === true) this.sendDedupeProvenBaseUrls.add(connection.baseUrl);
      this.noteTransportHealthy();
      this.recordSendStage({ stage: "gateway-post", attempt, clientNonce: args.clientNonce, traceparent: args.traceparent, startEpochMs: postStartEpochMs, durationMs: clock.monotonicNow() - postStartMonotonicMs });
      return result ?? undefined;
    } catch (error) {
      if (!(error instanceof SandGatewayCommandError)) this.noteTransportFailure(classifyGatewayError(error).outcome);
      this.recordSendStage({ stage: "gateway-post", attempt, clientNonce: args.clientNonce, traceparent: args.traceparent, startEpochMs: postStartEpochMs, durationMs: clock.monotonicNow() - postStartMonotonicMs, isError: true });
      throw error;
    }
  }

  private async foreverBoxStatusCommand(method: string, args: unknown, init?: RequestInit): Promise<unknown> {
    const { result, connection } = await this.request(method, args, init);
    return result == null ? null : proxifyForeverBoxStatus(result as ForeverBoxStatus, connection.vncProxy ?? null);
  }

  private async runEventLoop(): Promise<void> {
    let failedAttempts = 0;
    while (!this.isClosed) {
      const generation = this.reconnectGeneration;
      try { await this.streamEvents(() => { failedAttempts = 0; }, generation); } catch {}
      if (this.isClosed) break;
      if (generation !== this.reconnectGeneration) { failedAttempts = 0; continue; }
      const backoffController = new AbortController();
      this.activeEventLoopController = backoffController;
      if (generation !== this.reconnectGeneration) { this.activeEventLoopController = undefined; failedAttempts = 0; continue; }
      failedAttempts += 1;
      const wait = this.options.timing.reconnectBackoff.schedule(failedAttempts, backoffController.signal);
      try { await wait.elapsed; } catch {} finally { wait.dispose(); }
      if (this.activeEventLoopController === backoffController) this.activeEventLoopController = undefined;
      if (generation !== this.reconnectGeneration) failedAttempts = 0;
    }
  }

  private async streamEvents(resetBackoff: () => void, attemptGeneration: number): Promise<void> {
    const controller = new AbortController();
    this.activeEventLoopController = controller;
    const connectStartMonotonicMs = this.options.timing.clock.monotonicNow();
    let connection: GatewayConnection | undefined;
    let didConnect = false;
    try {
      let handshake: { connection: GatewayConnection; reader: ReadableStreamDefaultReader<Uint8Array> };
      try {
        handshake = await this.options.timing.connectDeadline.run(async (deadlineSignal) => {
          const resolved = await this.resolveConnection(deadlineSignal);
          connection = resolved;
          const response = await this.gatewayFetch(`${resolved.baseUrl}${GATEWAY_EVENTS_PATH}`, { headers: this.requestHeaders({ accept: "text/event-stream" }, resolved), signal: controller.signal });
          if (controller.signal.aborted || attemptGeneration !== this.reconnectGeneration) {
            void response.body?.cancel().catch(() => {});
            throw new Error("gateway connect superseded");
          }
          if (!response.ok || response.body == null) throw new SandGatewayUnreachableError(outcomeForHttpStatus(response.status) ?? "network", `gateway events failed: ${response.status}`, { httpStatus: response.status });
          return { connection: resolved, reader: response.body.getReader() };
        }, controller.signal);
      } catch (error) { if (error instanceof DeadlineExceededError) controller.abort(); throw error; }
      const { reader } = handshake;
      resetBackoff();
      this.connectionCount += 1;
      didConnect = true;
      this.transportState = "connected";
      this.noteTransportHealthy();
      const blocks = new SseBlockDecoder((block) => this.dispatchEventBlock(block, handshake.connection.vncProxy ?? null));
      let stalled = false;
      const watchdog = this.options.timing.stallWatchdog.arm(() => { stalled = true; controller.abort(); });
      let down = { reason: "stream-ended", cause: null as string | null };
      try {
        this.reportReachability({ outcome: "ok", method: "events", latencyMs: this.options.timing.clock.monotonicNow() - connectStartMonotonicMs, baseUrlKind: classifyBaseUrlKind(handshake.connection.baseUrl) }, handshake.connection.baseUrl);
        const forced = this.pendingForcedReconnect != null && this.pendingForcedReconnect.generation <= attemptGeneration;
        this.emitTransportEvent({ family: "transport-connected", payload: { generation: this.connectionCount } });
        if (forced) { this.pendingForcedReconnect?.resolve(); this.pendingForcedReconnect = undefined; }
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          watchdog.kick();
          blocks.push(result.value);
        }
      } catch (error) {
        down = classifyStreamDown({ stalled, forced: attemptGeneration !== this.reconnectGeneration, devInducedOffline: this.devInducedOffline, clientPaused: this.clientPaused, error });
        // 冻结的 SSE 流（stall 看门狗触发）与命令路径共用同一批池化连接，
        // 计入断路连击；自然结束（服务端关流）不计。
        if (stalled) this.noteTransportFailure("timeout");
        throw error;
      } finally { watchdog.dispose(); controller.abort(); this.notifyDisconnected(down.reason, down.cause); }
    } catch (error) {
      if (!didConnect && !this.isClosed && attemptGeneration === this.reconnectGeneration) {
        const classified = classifyGatewayError(error);
        this.noteTransportFailure(classified.outcome);
        this.reportReachability({ outcome: classified.outcome, method: "events", latencyMs: this.options.timing.clock.monotonicNow() - connectStartMonotonicMs, baseUrlKind: classifyBaseUrlKind(connection?.baseUrl), ...(classified.httpStatus === undefined ? {} : { httpStatus: classified.httpStatus }), ...(classified.causeSummary === undefined ? {} : { causeSummary: classified.causeSummary }) }, connection?.baseUrl);
      }
      throw error;
    } finally { if (this.activeEventLoopController === controller) this.activeEventLoopController = undefined; }
  }

  dispatchEventBlock(block: string, vncProxy: VncProxyDescriptor | null): void {
    const dataLines = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice("data:".length).trim());
    if (dataLines.length === 0) return;
    try {
      const event = JSON.parse(dataLines.join("\n")) as { readonly channel?: unknown; readonly payload?: unknown };
      if (typeof event.channel !== "string" || event.channel.length === 0) return;
      if (event.channel === "forever-box") this.options.onEvent({ channel: "forever-box", payload: proxifyForeverBoxStatus(event.payload as ForeverBoxStatus, vncProxy) });
      else this.options.onEvent({ channel: event.channel, payload: event.payload });
    } catch {}
  }
}
