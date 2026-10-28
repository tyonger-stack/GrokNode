import { createIdleWatchdogPolicy, realClock } from "../../../internal/scheduling.js";
import { defineHostExtension } from "../../../internal/host-extensions.js";
import { SAND_LOCAL_EXEC_RESPONSE_TIMEOUT_MS } from "../../../shared/local-exec-gateway.js";
import { HostExtensions } from "../extension-ids.generated.js";
import type { GatewayLocalToolGate } from "./gateway-local-exec-sand-box.js";
import { GatewayLocalExecSandBox, createBridgeUserComputers, type GatewayLocalExecCodec } from "./gateway-local-exec-sand-box.js";
import { SandLocalExecBridge, type LocalExecBridgeFrame } from "./local-exec-bridge.js";

interface LocalExecLogs { reportLocalExecRefused(report: unknown): void; reportLocalExecProvider(report: unknown): void; reportLocalExecFailed(report: unknown): void; }
interface LocalExecHost { readonly events: { on(topic: string, listener: (payload: unknown) => void): () => void }; }

// control 帧的 message 是 daemon executor 的 throwControl 产物；尽力抽出可读文本，
// 保留原始 JSON 兜底（形状不在本扩展的契约内，不发明字段）。
function controlMessageText(message: unknown): string {
  if (typeof message === "string") return message;
  if (typeof message === "object" && message !== null) {
    const record = message as Record<string, unknown>;
    const value = typeof record.value === "object" && record.value !== null ? (record.value as Record<string, unknown>).message : undefined;
    if (typeof value === "string" && value.length > 0) return value;
  }
  try { return JSON.stringify(message); } catch { return "device tool call was refused"; }
}

export function createLocalExecExtension<Client = unknown, Accessor = unknown>(codec: GatewayLocalExecCodec<Client, Accessor>) {
  return defineHostExtension<unknown, LocalExecHost>({
    id: HostExtensions.LocalExec, dependencies: [HostExtensions.LocalToolPermission, HostExtensions.Telemetry],
    start: (context) => {
      const gate = context.deps[HostExtensions.LocalToolPermission] as GatewayLocalToolGate; const logs = (context.deps[HostExtensions.Telemetry] as { readonly logs: LocalExecLogs }).logs;
      const bridge = new SandLocalExecBridge({ clock: realClock, responseWatchdog: createIdleWatchdogPolicy(realClock, { name: "sand-local-exec-response", idleMs: SAND_LOCAL_EXEC_RESPONSE_TIMEOUT_MS }), blockedReason: () => gate.blockedReason(), report: { refused: (report) => logs.reportLocalExecRefused(report), provider: (report) => logs.reportLocalExecProvider(report) } });
      const offRetirement = context.host.events.on("local-tool-permission.approval-retired", (payload) => { if (typeof payload === "object" && payload != null && typeof (payload as { approvalId?: unknown }).approvalId === "string") bridge.retireApproval((payload as { approvalId: string }).approvalId); }); context.onStop(offRetirement);
      const options = { gate, codec, reportFailure: (report: unknown) => logs.reportLocalExecFailed(report) };
      // device-tool 信封（{toolId, inputJson, conversationId}）走 exec 帧；daemon 侧
      // SandLocalExecProvider.handleExec 用 isDeviceToolCallShape 识别并以单个
      // {kind:"client", message} 帧回值（来源：local-exec-provider.ts handleExec）。
      const callDeviceTool = async (
        requestContext: { readonly signal: AbortSignal; readonly agentId?: string },
        call: { readonly toolId: string; readonly input: Record<string, unknown>; readonly conversationId: string },
      ): Promise<unknown> => {
        const frame: LocalExecBridgeFrame = {
          kind: "exec",
          serverMessage: { toolId: call.toolId, inputJson: JSON.stringify(call.input), conversationId: call.conversationId },
        };
        for await (const response of bridge.request(requestContext, frame)) {
          if (response.kind === "client") return response.message;
          if (response.kind === "control") throw new Error(controlMessageText(response.message));
          if (response.kind === "file-error") throw new Error(typeof response.error === "string" ? response.error : "device tool call failed with a file error");
        }
        throw new Error("device tool call ended without a result");
      };
      return { box: new GatewayLocalExecSandBox(bridge, options), userComputers: createBridgeUserComputers(bridge, options), registerProvider: (send: (frame: LocalExecBridgeFrame) => void) => bridge.registerProvider(send), submitResponses: (batch: Parameters<SandLocalExecBridge["submitResponses"]>[0]) => bridge.submitResponses(batch), checkLiveComputerForAsk: (agentId?: string) => bridge.checkLiveComputerForAsk(agentId), callDeviceTool };
    }
  });
}
