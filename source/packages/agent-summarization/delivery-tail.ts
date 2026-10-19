/**
 * Port of official `agent-summarization/delivery-tail.js`: keep a short tail of
 * answered user-delivery tool calls (e.g. send_message) after compaction so the
 * successor still sees what was just delivered to the user.
 */

import { PrivacyCapability } from "../redaction/classification.js";
import type { fromRedactedCoreMessage } from "../redaction/core-message.js";
import { isRedactedString } from "../redaction/types.js";

export type DeliveryTailTriggerReason = string;

export interface DeliveryToolCallView {
  readonly toolName: string;
  readonly args: () => unknown;
}

export interface DeliveryTailConfig {
  readonly isDeliveryToolCall: (call: DeliveryToolCallView) => boolean;
  readonly maxCalls: number;
  readonly triggerReasons: readonly DeliveryTailTriggerReason[];
}

export type DeliveryTailMessage = Parameters<typeof fromRedactedCoreMessage>[0];

type ToolCallPart = {
  readonly type: "tool-call";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args?: unknown;
};

type ToolResultPart = {
  readonly type?: string;
  readonly toolCallId: string;
};

function viewOf(part: ToolCallPart): DeliveryToolCallView {
  return {
    toolName: part.toolName,
    args: () => isRedactedString(part.args)
      ? part.args.unwrap(PrivacyCapability.UNSAFE_ALWAYS_ALLOWED)
      : part.args,
  };
}

function isToolCallPart(part: unknown): part is ToolCallPart {
  return typeof part === "object" && part !== null &&
    "type" in part && part.type === "tool-call" &&
    "toolCallId" in part && typeof part.toolCallId === "string" &&
    "toolName" in part && typeof part.toolName === "string";
}

function isToolResultPart(part: unknown): part is ToolResultPart {
  return typeof part === "object" && part !== null &&
    "toolCallId" in part && typeof part.toolCallId === "string";
}

export function selectUserDeliveryTail(
  messages: readonly DeliveryTailMessage[],
  options: Pick<DeliveryTailConfig, "isDeliveryToolCall" | "maxCalls">,
): DeliveryTailMessage[] {
  if (options.maxCalls <= 0) return [];
  const resultsByCallId = new Map<string, { part: ToolResultPart; message: DeliveryTailMessage }>();
  for (const message of messages) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!isToolResultPart(part)) continue;
      if (!resultsByCallId.has(part.toolCallId)) {
        resultsByCallId.set(part.toolCallId, { part, message });
      }
    }
  }
  const selected: DeliveryTailMessage[] = [];
  let remaining = options.maxCalls;
  for (let i = messages.length - 1; i >= 0 && remaining > 0; i--) {
    const message = messages[i];
    if (message === undefined) continue;
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const answeredDeliveryCalls = message.content.flatMap(part => {
      if (!isToolCallPart(part)) return [];
      const result = resultsByCallId.get(part.toolCallId);
      if (result === undefined || !options.isDeliveryToolCall(viewOf(part))) return [];
      return [{ call: part, result }];
    });
    if (answeredDeliveryCalls.length === 0) continue;
    const keptCalls = answeredDeliveryCalls.slice(-remaining);
    remaining -= keptCalls.length;
    const results = keptCalls.map(({ result }) => result);
    const firstResult = results[0];
    if (firstResult === undefined) continue;
    const assistant = {
      _privacyMode: message._privacyMode,
      role: "assistant",
      content: keptCalls.map(({ call }) => call),
      ...(message.id === undefined ? {} : { id: message.id }),
    };
    const tool = {
      _privacyMode: firstResult.message._privacyMode,
      role: "tool",
      content: results.map(result => result.part),
    };
    selected.unshift(assistant, tool);
  }
  return selected;
}

export function selectSelfSummaryDeliveryTail(
  messages: readonly DeliveryTailMessage[],
  options: { readonly triggerReason?: unknown },
  config: DeliveryTailConfig | undefined,
  findLastUserMessageIndex: (messages: readonly DeliveryTailMessage[]) => number,
): DeliveryTailMessage[] {
  if (config === undefined) return [];
  const triggerReason = typeof options.triggerReason === "string" ? options.triggerReason : undefined;
  if (triggerReason === undefined || !config.triggerReasons.includes(triggerReason)) {
    return [];
  }
  const lastUserIdx = findLastUserMessageIndex(messages);
  return lastUserIdx === -1
    ? []
    : selectUserDeliveryTail(messages.slice(lastUserIdx + 1), config);
}

/** Local Sand delivery tools: `send_message` and its snake/camel aliases. */
export function isSandUserDeliveryToolCall(call: {
  readonly toolName: string;
  readonly args?: unknown;
}): boolean {
  const name = call.toolName.trim().toLowerCase();
  return name === "send_message" ||
    name === "draftexternalmessage" || name === "requestuserform" ||
    name === "sendmessage" ||
    name === "send_message_tool" ||
    name.endsWith("__send_message");
}

export const SAND_IDLE_DELIVERY_TAIL_MAX_CALLS = 5;

/**
 * Delivery-tail config for local Sand. Official 0.71 only enables this for
 * `idle_timer`; Node also enables it on token/image compaction so the feature
 * is reachable without the idle timer path.
 */
export const SAND_COMPACTION_DELIVERY_TAIL: DeliveryTailConfig = {
  isDeliveryToolCall: call => isSandUserDeliveryToolCall({ toolName: call.toolName }),
  maxCalls: SAND_IDLE_DELIVERY_TAIL_MAX_CALLS,
  triggerReasons: [
    "idle_timer",
    "approaching_token_limit",
    "force_option",
    "image_threshold",
  ],
};
