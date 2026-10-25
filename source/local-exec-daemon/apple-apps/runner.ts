import { existsSync } from "node:fs";
import { join } from "node:path";

import { resolveLocal0721Feature } from "../../shared/node/port-0721-features.js";
import {
  APPLE_SIDECAR_DESCRIPTORS,
  type AppleSidecarDescriptor,
} from "../../shared/node/apple-apps-tools.js";
import { DeviceToolError, dispatchAppleTool, type AppleEventsCall } from "./dispatch.js";
import {
  SidecarMcpSession,
  type SidecarClock,
  type SidecarLaunch,
  type SidecarRequestOutcome,
} from "../sidecar/mcp-session.js";

/**
 * Apple 工具运行器：按 conversationId 持有 SidecarMcpSession，把 est 语义的
 * toolId 分发落到 MCP tools/call("apple-events/run")。
 *
 * 门控 grok_bot_apple_apps 走 0721 本地 flag 解析（env
 * SAND_FEATURE_GATE_OVERRIDES / GROK_NODE_0721_FEATURES）。
 * sidecar .app 由 GROK_NODE_SIDECAR_APP 指向（打包 staging 约定，见
 * scripts/lib/computer-use-sidecar-0721.mjs；上游同名 env 是
 * GROK_BOT_SIDECAR_APP，我们刻意不读官方路径）。
 */

export function appleAppsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveLocal0721Feature("grok_bot_apple_apps", env) === true;
}

export const GROK_NODE_SIDECAR_APP = "GROK_NODE_SIDECAR_APP";

export function resolveAppleSidecarLaunch(env: NodeJS.ProcessEnv = process.env): SidecarLaunch | undefined {
  const appPath = typeof env[GROK_NODE_SIDECAR_APP] === "string" ? env[GROK_NODE_SIDECAR_APP]?.trim() : "";
  if (appPath === "") return undefined;
  const appName = appPath.split("/").findLast((segment) => segment.endsWith(".app"));
  const descriptor: AppleSidecarDescriptor | undefined = appName === undefined
    ? undefined
    : Object.values(APPLE_SIDECAR_DESCRIPTORS).find((candidate) => candidate.appName === appName.slice(0, -4));
  const executable = descriptor?.executable ?? APPLE_SIDECAR_DESCRIPTORS.prod.executable;
  const command = join(appPath, "Contents/MacOS", executable);
  return existsSync(command) ? { command, args: [] } : undefined;
}

export interface AppleAppsToolRunnerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly clock?: SidecarClock;
  readonly launch?: () => Promise<SidecarLaunch>;
  readonly spawnImpl?: typeof import("node:child_process").spawn;
  readonly onHelperClosed?: (message: string) => void;
}

interface ToolCallResult {
  readonly status: "completed" | "failed";
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

function outcomeToError(tool: string, outcome: SidecarRequestOutcome): { code: string; message: string } {
  switch (outcome.kind) {
    case "error": return { code: "sidecar_tool_error", message: outcome.message };
    case "timed-out": return { code: "sidecar_timeout", message: `sidecar_timeout ${tool} did not answer in time.` };
    case "cancelled": return { code: "sidecar_cancelled", message: `sidecar_cancelled ${tool} was cancelled.` };
    case "exited": return { code: "sidecar_not_running", message: `sidecar_not_running ${outcome.message}` };
    case "result": return { code: "sidecar_invalid_reply", message: `sidecar_invalid_reply ${tool} returned no structured content.` };
  }
}

/** MCP tools/call 结果解包：优先 structuredContent；否则 content[0].text 按 JSON 解析。 */
export function unwrapToolCallResult(result: unknown): unknown {
  if (result === null || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  if (record.structuredContent !== undefined && record.structuredContent !== null) return record.structuredContent;
  const content = record.content;
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0] as Record<string, unknown> | null;
    if (first !== null && typeof first === "object" && typeof first.text === "string") {
      try { return JSON.parse(first.text); } catch { return first.text; }
    }
  }
  return result;
}

export class AppleAppsToolRunner {
  private readonly options: AppleAppsToolRunnerOptions;
  private readonly sessions = new Map<string, SidecarMcpSession>();

  constructor(options: AppleAppsToolRunnerOptions = {}) {
    this.options = options;
  }

  private sessionFor(conversationId: string): SidecarMcpSession {
    const existing = this.sessions.get(conversationId);
    if (existing !== undefined) return existing;
    const session = new SidecarMcpSession({
      conversationId,
      ...(this.options.clock === undefined ? {} : { clock: this.options.clock }),
      ...(this.options.spawnImpl === undefined ? {} : { spawnImpl: this.options.spawnImpl }),
      launch: this.options.launch ?? (() => {
        const resolved = resolveAppleSidecarLaunch(this.options.env);
        if (resolved === undefined) {
          return Promise.reject(new DeviceToolError("sidecar_missing",
            `sidecar_missing ${GROK_NODE_SIDECAR_APP} does not point at a staged computer-use sidecar app.`));
        }
        return Promise.resolve(resolved);
      }),
      onClosed: (message) => {
        if (this.sessions.get(conversationId) === session) this.sessions.delete(conversationId);
        this.options.onHelperClosed?.(message);
      },
    });
    this.sessions.set(conversationId, session);
    return session;
  }

  /** est() 语义入口；结果形状对齐上游 {status:"completed"|"failed",…} 包装。 */
  async callTool(toolId: string, input: unknown, options: { conversationId: string } = { conversationId: "default" }): Promise<ToolCallResult> {
    const session = this.sessionFor(options.conversationId);
    session.lease();
    try {
      await session.ready;
      const call: AppleEventsCall = async (app, op, args) => {
        const { reply } = session.request("tools/call", { name: "apple-events/run", arguments: { app, op, args } });
        const outcome = await reply;
        if (outcome.kind !== "result") throw new DeviceToolError("sidecar_timeout", outcomeToError("apple-events/run", outcome).message);
        return unwrapToolCallResult(outcome.result);
      };
      const value = await dispatchAppleTool(toolId, input, call);
      return { status: "completed", value };
    } catch (error) {
      if (error instanceof DeviceToolError) return { status: "failed", error: { code: error.code, message: error.message } };
      const message = error instanceof Error ? error.message : String(error);
      return { status: "failed", error: { code: "sidecar_unreachable", message } };
    } finally {
      session.release();
    }
  }

  close(): void {
    for (const session of this.sessions.values()) session.stop("Grok Bot stopped serving this computer.");
    this.sessions.clear();
  }
}
