import { createHash } from "node:crypto";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PromptSectionSnapshotStore } from "./sessions/related-conversations-section.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const pair = z.object({ name: z.string().max(80), sha: digest });
const snapshotSchema = z.object({ version: z.literal(1), epoch: z.number().finite(), system: digest, userInfo: digest, toolsSha: digest,
  tools: z.array(pair).max(2048), sections: z.array(pair).max(32) });
type Snapshot = z.infer<typeof snapshotSchema>;
export interface PromptPrefixRequest {
  readonly messages: readonly unknown[];
  readonly tools: readonly unknown[];
  readonly reason: "agent" | "summarization";
}
export interface PromptPrefixObserver { observe(request: PromptPrefixRequest): { onUsage(usage: unknown): void } }
function messageText(value: unknown): string {
  if (!record(value)) return "";
  if (typeof value.content === "string") return value.content;
  if (!Array.isArray(value.content)) return "";
  return value.content.flatMap((part: unknown) => record(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n");
}
function toolDigest(value: unknown): { name: string; sha: string } {
  const definition = record(value) ? value : {};
  const rawName = typeof definition.name === "string" ? definition.name : "other";
  const name = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(rawName) ? rawName : "other";
  let parameters: unknown = definition.parameters ?? definition.inputSchema;
  if (parameters instanceof z.ZodType) parameters = zodToJsonSchema(parameters);
  else if (record(parameters) && "jsonSchema" in parameters) parameters = parameters.jsonSchema;
  return { name, sha: sha(JSON.stringify({ name: rawName, description: definition.description, parameters })) };
}
export function hashPromptPrefix(request: PromptPrefixRequest, epoch: number, sections: readonly { readonly name: string; readonly render: string }[]): Snapshot {
  const system = request.messages.filter(message => record(message) && message.role === "system").map(messageText).join("\n");
  const firstUser = request.messages.find(message => record(message) && message.role === "user");
  const text = messageText(firstUser);
  const tools = request.tools.map(toolDigest);
  return { version: 1, epoch, system: sha(system), userInfo: sha(text.includes("<user_info>") ? text : ""),
    toolsSha: sha(JSON.stringify(tools)), tools, sections: sections.map(section => ({ name: section.name, sha: sha(section.render) })) };
}
export function diffPromptPrefix(previous: Snapshot, current: Snapshot) {
  const changedSections: string[] = [];
  if (previous.system !== current.system) {
    const previousSections = new Map(previous.sections.map(section => [section.name, section.sha]));
    for (const section of current.sections) if (previousSections.get(section.name) !== section.sha) changedSections.push(section.name);
    if (changedSections.length === 0) changedSections.push("system");
  }
  if (previous.userInfo !== current.userInfo) changedSections.push("user_info");
  const changedTools: string[] = [];
  if (previous.toolsSha !== current.toolsSha) {
    const before = new Map(previous.tools.map(tool => [tool.name, tool.sha]));
    const after = new Map(current.tools.map(tool => [tool.name, tool.sha]));
    for (const tool of current.tools) {
      if (!before.has(tool.name)) changedTools.push(`+${tool.name}`);
      else if (before.get(tool.name) !== tool.sha) changedTools.push(tool.name);
    }
    for (const tool of previous.tools) if (!after.has(tool.name)) changedTools.push(`-${tool.name}`);
    if (changedTools.length === 0) changedTools.push("~order");
  }
  return { changedSections, changedTools };
}

export function createPromptPrefixObserver(input: {
  readonly snapshots: () => PromptSectionSnapshotStore | null;
  readonly compactionEpoch: () => number;
  readonly sections: () => readonly { readonly name: string; readonly render: string }[];
  readonly report: (report: Readonly<Record<string, unknown>>) => void;
  readonly reportError?: (errorClass: string) => void;
}): PromptPrefixObserver {
  let fallback: Snapshot | null = null;
  return { observe(request) {
    try {
      const last = request.messages.at(-1);
      const providerOptions = record(last) && record(last.providerOptions) ? last.providerOptions : null;
      const cursor = providerOptions !== null && record(providerOptions.cursor) ? providerOptions.cursor : null;
      const reason = cursor?.inferenceReason === "agent-summarization" ? "summarization" : request.reason;
      if (reason !== "summarization" && request.tools.length === 0) return { onUsage() {} };
      const store = input.snapshots();
      const parsed = snapshotSchema.safeParse(store === null ? fallback : store.getPromptSectionSnapshot("_prefix_observation"));
      const previous = parsed.success ? parsed.data : null;
      const current = hashPromptPrefix(request, input.compactionEpoch(), input.sections());
      const changes = previous === null ? { changedSections: [], changedTools: [] } : diffPromptPrefix(previous, current);
      const report = { reason, ...changes, compaction: previous !== null && previous.epoch !== current.epoch ? "advanced" : "same",
        systemSha: current.system, toolsSha: current.toolsSha, userInfoSha: current.userInfo };
      if (reason === "agent") { fallback = current; store?.setPromptSectionSnapshot("_prefix_observation", current); }
      input.report({ phase: "request", ...report });
      let observed = false;
      return { onUsage(usage) {
        if (observed) return; observed = true;
        try {
          const counts: Record<string, number> = {};
          if (record(usage)) for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]) {
            const value = usage[key];
            if (typeof value === "number" && Number.isFinite(value) && value >= 0) counts[key] = value;
          }
          input.report({ phase: "usage", ...report, ...counts });
        } catch (error) { input.reportError?.(error instanceof Error ? error.name : "UnknownError"); }
      } };
    } catch (error) {
      input.reportError?.(error instanceof Error ? error.name : "UnknownError");
      return { onUsage() {} };
    }
  } };
}
