import { createHash } from "node:crypto";
import { stripThinkingTags, createLoopReminderMessage, SingleMessageLoopDetector } from "../../packages/agent/loop-detection/agent-loop-detector.js";
import { isSandUserDeliveryToolCall } from "../../packages/agent-summarization/delivery-tail.js";
import type { PromptExecutor, MessageLike } from "./send-message-reminder-middleware.js";

export type SandLoopDetectionMode = "off" | "shadow" | "on";
export const parseSandLoopDetectionMode = (value: unknown): SandLoopDetectionMode => value === "shadow" || value === "on" ? value : "off";
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value && typeof value[Symbol.asyncIterator] === "function";
}
const invitedRetries = ["Browser driver shell failed", "The page changed after review", "classifying this action", "waiting for Auto-review approval",
  "could not capture the current page state", "connectOverCDP", "may be temporary; try again", "may be temporary. Try again"] as const;
const tolerantNames = new Set(["browser_press_key", "AwaitShell", "Await", "ListMachines", "browser_take_screenshot", "browser_snapshot"]);
const tolerantActions = new Set(["screenshot", "move", "key", "scroll", "wait"]);
export function normalizeSandToolResultForComparison(value: string): string {
  const images = value.match(/<image:\d+:[^>]*>/g) ?? [];
  let result = value.replace(/<image:\d+:[^>]*>/g, "\0");
  result = result.replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, "<ts>")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "<time>")
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds?|m|min|mins|minutes?)\b/g, "<dur>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>").replace(/\bid\s*[:=]\s*[A-Za-z0-9_-]+/g, "id:<id>");
  let index = 0;
  return result.replace(/\u0000/g, () => images[index++] ?? "");
}
interface Call { readonly toolName: string; readonly args: unknown }
interface LoopMessage { readonly role: string; readonly text: string; readonly calls: readonly Call[]; readonly results: string[] }
function resultText(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 4096);
  if (Array.isArray(value)) return value.flatMap((part: unknown) => {
    if (typeof part === "string") return [part];
    if (!record(part)) return [];
    if (part.type === "text" && typeof part.text === "string") return [part.text];
    if (part.type === "image") { const data = typeof part.data === "string" ? part.data : typeof part.image === "string" ? part.image : ""; return [`<image:${data.length}:${data.slice(0, 256)}>`]; }
    return typeof part.type === "string" ? [`<${part.type}>`] : [];
  }).join("").slice(0, 8192);
  if (value === undefined || value === null) return "";
  try { return (JSON.stringify(value) ?? "").slice(0, 4096); }
  catch (error) { if (error instanceof TypeError) return ""; throw error; }
}
function loopMessages(messages: readonly unknown[]): LoopMessage[] {
  const converted: LoopMessage[] = [];
  for (const message of messages) {
    if (!record(message) || message.role === "system") continue;
    const parts: readonly unknown[] = typeof message.content === "string" ? [{ type: "text", text: message.content }] : Array.isArray(message.content) ? message.content : [];
    if (message.role === "tool") {
      const previous = converted.at(-1);
      if (previous?.role === "assistant") for (const part of parts) if (record(part) && part.type === "tool-result") previous.results.push(resultText(part.experimental_content ?? part.result));
      continue;
    }
    if (message.role !== "assistant" && message.role !== "user") continue;
    const text = parts.flatMap(part => typeof part === "string" ? [part] : record(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("");
    const calls = parts.flatMap(part => record(part) && part.type === "tool-call" && typeof part.toolName === "string" ? [{ toolName: part.toolName, args: part.args }] : []);
    converted.push({ role: message.role, text: stripThinkingTags(text).trim(), calls, results: [] });
  }
  return converted;
}
function effective(call: Call): Call {
  if ((call.toolName === "InvokeTool" || call.toolName === "CallMcpTool") && record(call.args)) {
    const name = call.args.toolName ?? call.args.tool_name ?? call.args.name;
    if (typeof name === "string") return { toolName: name.split(".").at(-1) ?? name, args: call.args.arguments ?? call.args.args };
  }
  return call;
}
function tolerantComputer(value: unknown): boolean {
  if (!record(value) || typeof value.action !== "string" || !tolerantActions.has(value.action)) return false;
  return value.then === undefined || Array.isArray(value.then) && value.then.every(tolerantComputer);
}
function isTolerant(raw: Call): boolean {
  const call = effective(raw);
  return tolerantNames.has(call.toolName) || call.toolName === "Computer" && tolerantComputer(call.args)
    || call.toolName === "browser_tabs" && record(call.args) && call.args.action === "close";
}
function isWait(raw: Call): boolean {
  const call = effective(raw);
  return call.toolName === "AwaitShell" || call.toolName === "Await" || call.toolName === "Computer" && record(call.args) && call.args.action === "wait"
    || call.toolName === "Shell" && record(call.args) && typeof call.args.command === "string" && /(?:^|[;&|])\s*sleep\s+\d/.test(call.args.command);
}
function detectPattern(keys: readonly string[], repetitions: number): { start: number; period: number } | null {
  for (let period = 1; period * (repetitions + 1) <= keys.length; period++) {
    let count = 0;
    for (let i = keys.length - 1; i >= period && keys[i] === keys[i - period]; i--) count++;
    if ((keys.at(-1)?.length ?? 0) >= 10 && count >= period * repetitions)
      return { start: keys.length - count - period, period };
  }
  return null;
}
export interface SandLoopObservation {
  readonly loopKind: "multi_message" | "multi_message_outbound_flood" | "single_message_single_line" | "single_message_multi_line";
  readonly repetitions: number;
  readonly period: number;
  readonly evidenceFingerprint: string;
}
export function detectSandMessageLoop(messages: readonly unknown[]): SandLoopObservation | null {
  const converted = loopMessages(messages);
  let lastUser = -1;
  for (let i = converted.length - 1; i >= 0; i--) if (converted[i]?.role === "user") { lastUser = i; break; }
  if (lastUser < 0) return null;
  const sequence = converted.slice(lastUser + 1).filter(message => message.role === "assistant" && (message.calls.length > 0 || message.text.length >= 10)
    && !message.results.some(result => invitedRetries.some(fragment => result.includes(fragment)))).slice(-256);
  const last = sequence.at(-1);
  if (last === undefined || last.calls.length === 0) return null;
  const keyOf = (message: LoopMessage) => normalizeSandToolResultForComparison(message.text)
    + "<<<TOOLS>>>" + message.calls.map(call => `${call.toolName}:${JSON.stringify(call.args) ?? ""}`).sort().join("|");
  const keys = sequence.map(keyOf);
  let pattern = detectPattern(keys, 2);
  if (pattern !== null) {
    const patternStart = pattern.start;
    const unit = sequence.slice(pattern.start, pattern.start + pattern.period);
    const tolerant = unit.every(message => message.calls.every(isTolerant)) || unit.some(message => message.calls.some(isWait));
    const results: string[] = [];
    for (let start = pattern.start; start + pattern.period <= sequence.length; start += pattern.period) {
      if (!keys.slice(start, start + pattern.period).every((key, offset) => key === keys[patternStart + offset])) break;
      results.push(sequence.slice(start, start + pattern.period).map(message => message.results.map(normalizeSandToolResultForComparison).join("\0")).join("\x01"));
    }
    let identical = 0;
    for (let i = 1; i < results.length; i++) if (results[i] === results[i - 1]) identical++;
    const pairs = Math.max(0, results.length - 1), changed = identical < pairs;
    if (tolerant && changed) pattern = null;
    else {
      const required = Math.max(tolerant ? 4 : 2, pairs > 0 && identical === 0 ? 20 : changed ? 6 : 2);
      pattern = detectPattern(keys, required);
    }
    if (pattern !== null) return { loopKind: "multi_message", repetitions: Math.floor((sequence.length - pattern.start) / pattern.period), period: pattern.period,
      evidenceFingerprint: createHash("sha256").update(keys.slice(pattern.start, pattern.start + pattern.period).join("\0")).digest("hex") };
  }
  let outbound = 0;
  for (const message of sequence) if (message.calls.length > 0) outbound = message.calls.every(isSandUserDeliveryToolCall) ? outbound + 1 : 0;
  if (outbound >= 8) return { loopKind: "multi_message_outbound_flood", repetitions: outbound, period: 1,
    evidenceFingerprint: createHash("sha256").update(last.calls.map(call => call.toolName).sort().join("\0")).digest("hex") };
  return null;
}

export function createSandLoopDetectionPolicy(input: {
  readonly mode: SandLoopDetectionMode;
  readonly report: (event: SandLoopObservation & { readonly mode: SandLoopDetectionMode; readonly stage: "detected" | "applied" | "looped_again" }) => void;
}) {
  const reported = new Set<string>(), applied = new Set<string>();
  let mitigations = 0;
  const reportDetection = (observation: SandLoopObservation) => {
    if (!reported.has(observation.evidenceFingerprint) && reported.size < 32) {
      reported.add(observation.evidenceFingerprint); input.report({ ...observation, mode: input.mode, stage: "detected" });
    }
  };
  return {
    mode: input.mode,
    observeStream(result: unknown): unknown {
      if (input.mode === "off" || !record(result)) return result;
      const stream = result.fullStream;
      if (!isAsyncIterable(stream)) return result;
      const detector = new SingleMessageLoopDetector();
      let observed = false;
      return { ...result, fullStream: (async function* () {
        for await (const chunk of stream) {
          if (!observed && record(chunk) && chunk.type === "text-delta" && typeof chunk.textDelta === "string") {
            try {
              if (detector.addText({ newText: chunk.textDelta, caller: "sand-policy" })) {
                const single = detector.getSingleLineLoopInfo(), multi = detector.getMultiLineLoopInfo();
                const info = single ?? multi;
                if (info !== null && info !== undefined) {
                  observed = true;
                  reportDetection({ loopKind: single ? "single_message_single_line" : "single_message_multi_line",
                    repetitions: info.repetitions, period: single?.period ?? 1,
                    evidenceFingerprint: createHash("sha256").update(info.pattern).digest("hex") });
                }
              }
            } catch (error) { console.warn("[sand:loop-detection] stream observation failed", error instanceof Error ? error.name : "UnknownError"); observed = true; }
          }
          yield chunk;
        }
      })() };
    },
    inspect(messages: readonly unknown[]): MessageLike | null {
      if (input.mode === "off") return null;
      const observation = detectSandMessageLoop(messages);
      if (observation === null) return null;
      reportDetection(observation);
      if (input.mode !== "on" || mitigations >= 16) return null;
      mitigations++;
      input.report({ ...observation, mode: input.mode, stage: applied.has(observation.evidenceFingerprint) ? "looped_again" : "applied" });
      applied.add(observation.evidenceFingerprint);
      return createLoopReminderMessage({ kind: observation.loopKind });
    },
  };
}
export type SandLoopDetectionPolicy = ReturnType<typeof createSandLoopDetectionPolicy>;
export function withSandLoopDetection(executor: PromptExecutor, policy: SandLoopDetectionPolicy): PromptExecutor {
  let lastContext: unknown;
  const check = () => {
    try { const note = policy.inspect(executor.getMessages()); if (note !== null) executor.appendMessages(note); }
    catch (error) { console.warn("[sand:loop-detection] observation failed", error instanceof Error ? error.name : "UnknownError"); }
  };
  return {
    getMessages: () => executor.getMessages(), getState: () => executor.getState(), clearMessages: () => executor.clearMessages(),
    appendMessages(messages) {
      executor.appendMessages(messages);
      if (lastContext !== undefined && (Array.isArray(messages) ? messages : [messages]).some(message => message.role === "tool")) check();
    },
    stream(...args: readonly unknown[]) {
      if (lastContext === undefined && executor.getMessages().at(-1)?.role === "tool") check();
      lastContext = args[0];
      return policy.observeStream(executor.stream(...args));
    },
  };
}
