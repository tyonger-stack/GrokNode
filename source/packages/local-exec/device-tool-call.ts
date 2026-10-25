import { APPLE_TOOL_KEYS } from "../../shared/node/apple-apps-tools.js";

/**
 * device-tool 调用信封 —— 形状移植自 0.75.8 daemon 的 cmr()
 * （{toolId, inputJson, conversationId}）。cmr 的清单是 computer_* 工具族，
 * 错误文案 "… is not a computer-use tool." 属于那张表；Apple 工具族的等价
 * 拒绝句是 est() 的 unsupported 文案（已在 dispatch.ts 逐字锚定），两条
 * 通用文案（会话缺失 / 参数不是 JSON 对象）逐字复用 cmr。
 */

export interface DeviceToolCall {
  readonly toolId: string;
  readonly input: Record<string, unknown>;
  readonly conversationId: string;
}

export type ParsedDeviceToolCall =
  | { readonly kind: "valid" } & DeviceToolCall
  | { readonly kind: "invalid"; readonly error: string };

export const DEVICE_TOOL_MISSING_CONVERSATION = "The call names no conversation to run it for.";

export function isDeviceToolCallShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.toolId === "string" && typeof record.conversationId === "string" && "inputJson" in record;
}

export function parseDeviceToolCall(value: unknown): ParsedDeviceToolCall {
  if (typeof value !== "object" || value === null || typeof (value as Record<string, unknown>).toolId !== "string") {
    return { kind: "invalid", error: "device tool call has no toolId." };
  }
  const toolId = (value as Record<string, unknown>).toolId as string;
  if (!(APPLE_TOOL_KEYS as readonly string[]).includes(toolId)) {
    return { kind: "invalid", error: `This Mac has no "${toolId}" tool.` };
  }
  if (typeof (value as Record<string, unknown>).conversationId !== "string" || ((value as Record<string, unknown>).conversationId as string).length === 0) {
    return { kind: "invalid", error: DEVICE_TOOL_MISSING_CONVERSATION };
  }
  const conversationId = (value as Record<string, unknown>).conversationId as string;
  const rawInput = (value as Record<string, unknown>).inputJson;
  let input: Record<string, unknown>;
  if (rawInput === undefined || rawInput === null) input = {};
  else if (typeof rawInput === "object" && !Array.isArray(rawInput)) input = rawInput as Record<string, unknown>;
  else if (typeof rawInput === "string") {
    try {
      const parsed: unknown = JSON.parse(rawInput);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { kind: "invalid", error: `The ${toolId} arguments are not a JSON object.` };
      }
      input = parsed as Record<string, unknown>;
    } catch {
      return { kind: "invalid", error: `The ${toolId} arguments are not a JSON object.` };
    }
  } else {
    return { kind: "invalid", error: `The ${toolId} arguments are not a JSON object.` };
  }
  return { kind: "valid", toolId, input, conversationId };
}

export function deviceToolCallServerMessage(toolId: string, input: Record<string, unknown>, conversationId: string): Record<string, unknown> {
  return { toolId, inputJson: JSON.stringify(input), conversationId };
}
