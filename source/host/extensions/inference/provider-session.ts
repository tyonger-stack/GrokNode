import { lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { createOpenAI } from "@ai-sdk/openai";
import { jsonSchema, streamText, tool, type CoreMessage, type LanguageModelV1, type ToolSet } from "ai";
 import { zodToJsonSchema } from "zod-to-json-schema";

import { BasePromptBuilder, BasePromptExecutor } from "../../../packages/chat-inference/base.js";
import type { SandInferenceProvider } from "../../../shared/inference-router.js";
import { isOpenRouterProxyMode, readCodexConfigValue, resolveOpenRouterTransport } from "../../../shared/node/openrouter-proxy.js";
import { classifyOpenRouterError, openRouterOkStatus } from "../../../shared/openrouter-channel-status.js";
import { DEFAULT_FIRST_TOKEN_STALL_DEADLINE_MS, resolveFirstTokenStallDeadlineMs } from "../../runner/transient-stream-error.js";
import { getSandRootDir } from "../../host-paths.js";
import { SandSettingsStore } from "../../../shared/node/settings/sand-settings-store.js";
import { getBoxSecretsStorePath } from "../secrets/secrets-service.js";
import { streamCodexDirectResponses, type CodexDirectTool } from "./codex-direct-responses.js";
import type { LabelMessage, PromptExecutor } from "./sand-labeling.js";

type Loose = Record<string, any>;
interface ProviderMessage extends LabelMessage { role: string; content: string | readonly unknown[] }
type RoutedProvider = SandInferenceProvider;
type UsageRecord = { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
type RoutedToolExecutor = (tool: Loose, args: unknown, toolCallId: string) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function jsonString(value: unknown): string {
  try { return JSON.stringify(value) ?? "null"; } catch (error) { return JSON.stringify({ isError: true, error: error instanceof Error ? error.message : String(error) }); }
}

function imageUrlOf(part: Record<string, unknown>): string | undefined {
  if (typeof part.url === "string") return part.url;
  if (typeof part.image_url === "string") return part.image_url;
  if (isRecord(part.image_url) && typeof part.image_url.url === "string") return part.image_url.url;
  if (typeof part.data === "string" && typeof part.mimeType === "string") return "data:" + part.mimeType + ";base64," + part.data;
  return undefined;
}

export function toCodexInputMessages(messages: readonly ProviderMessage[]): readonly Loose[] {
  const input: Loose[] = [];
  for (const message of messages) {
    const parts = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    if (message.role === "tool") {
      for (const raw of parts) {
        if (!isRecord(raw) || (raw.type !== "tool-result" && raw.type !== "tool_result")) continue;
        const callId = raw.toolCallId ?? raw.tool_call_id;
        if (typeof callId === "string") input.push({ type: "function_call_output", call_id: callId, output: jsonString(raw.result ?? raw.output ?? raw.content) });
      }
      continue;
    }
    const content: Loose[] = [], calls: Loose[] = [];
    for (const raw of parts) {
      if (typeof raw === "string") { content.push({ type: message.role === "assistant" ? "output_text" : "input_text", text: raw }); continue; }
      if (!isRecord(raw)) continue;
      if (raw.type === "tool-call" || raw.type === "tool_call") {
        const callId = raw.toolCallId ?? raw.tool_call_id, name = raw.toolName ?? raw.tool_name;
        if (typeof callId === "string" && typeof name === "string") calls.push({ type: "function_call", call_id: callId, name, arguments: typeof raw.args === "string" ? raw.args : jsonString(raw.args ?? {}) });
        continue;
      }
      if (raw.type === "text" && typeof raw.text === "string") { content.push({ type: message.role === "assistant" ? "output_text" : "input_text", text: raw.text }); continue; }
      if (raw.type === "image" || raw.type === "image_url" || raw.type === "input_image") { const url = imageUrlOf(raw); if (url != null) content.push({ type: "input_image", image_url: url }); continue; }
      if (raw.type === "file" || raw.type === "input_file") { const url = typeof raw.url === "string" ? raw.url : typeof raw.file_url === "string" ? raw.file_url : undefined; if (url != null) content.push({ type: "input_file", file_url: url }); }
    }
    if (content.length > 0) input.push({ role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user", content });
    input.push(...calls);
  }
  return input;
}

function contextSignal(value: unknown): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined" || typeof value !== "object" || value == null || !("signal" in value)) return undefined;
  const signal = value.signal;
  return signal instanceof AbortSignal ? signal : undefined;
}

const GROK_ROUTER_SYSTEM_PROMPT = [
  "You are Grok Bot, a warm, concise desktop assistant.",
  "You are running inside Grok Bot, not inside Codex CLI or Claude Code.",
  "The tools supplied with this request are Grok Bot's already-connected plugins and accounts. Use them whenever they are relevant instead of claiming that a plugin is unavailable or asking the user to reconnect it.",
  "Never ask for an API key for an already-connected plugin. Respond directly to the user in natural language after completing any necessary tool calls.",
].join("\n");

function recordRoutedUsage(provider: RoutedProvider, usage: UsageRecord): void {
  new SandSettingsStore(join(getSandRootDir(), "settings.json")).recordInferenceUsage(provider, usage);
}

function persistedSecrets(): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(getBoxSecretsStorePath(), "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) return {};
    const secrets = (parsed as { secrets?: unknown }).secrets;
    if (typeof secrets !== "object" || secrets == null || Array.isArray(secrets)) return {};
    return Object.fromEntries(Object.entries(secrets).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch { return {}; }
}

function readPersistedOpenRouterModel(): string | null {
  try {
    const stored = new SandSettingsStore(join(getSandRootDir(), "settings.json")).getOpenRouterModel();
    return typeof stored === "string" && stored.trim().length > 0 ? stored.trim() : null;
  } catch { return null; }
}

function readPersistedOpenRouterBaseUrl(): string | null {
  try {
    const stored = new SandSettingsStore(join(getSandRootDir(), "settings.json")).getOpenRouterBaseUrl();
    return typeof stored === "string" && stored.trim().length > 0 ? stored.trim() : null;
  } catch { return null; }
}

export function resolveOpenRouterModel(): string {
  return process.env.SAND_OPENROUTER_MODEL?.trim() || readPersistedOpenRouterModel() || readCodexConfigValue("openrouter_model") || "openai/gpt-5.2";
}

/** Reasoning effort chosen in Settings → Router → Model → Effort. `null` omits the field so the endpoint default applies. */
function readPersistedOpenRouterEffort(): string | null {
  try {
    const stored = new SandSettingsStore(join(getSandRootDir(), "settings.json")).getOpenRouterEffort();
    return typeof stored === "string" && stored.trim().length > 0 ? stored.trim() : null;
  } catch { return null; }
}

export function resolveOpenRouterEffort(): string | null {
  return process.env.SAND_OPENROUTER_EFFORT?.trim() || readPersistedOpenRouterEffort();
}

function openRouterCredential(): string {
  const value = process.env.OPENROUTER_API_KEY?.trim() || persistedSecrets().OPENROUTER_API_KEY?.trim();
  if (value != null && value.length > 0) return value;
  if (isOpenRouterProxyMode(readPersistedOpenRouterBaseUrl())) return "local-proxy";
  throw new Error("OpenRouter needs OPENROUTER_API_KEY. Add it in Settings → Router.");
}

function deferred<T>() { return Promise.withResolvers<T>(); }

function response(text: string, id: string, modelId: string) {
  return { id, modelId, timestamp: new Date(), headers: {}, messages: [{ role: "assistant", content: [{ type: "text", text }] }] };
}

type CodexCredentials = { accessToken: string; refreshToken: string; idToken: string; accountId: string; path: string; document: Loose };

function codexCredentials(): CodexCredentials {
  const path = join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "auth.json");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("Codex login credentials must be a private direct regular file.");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Loose;
  const accessToken = parsed?.tokens?.access_token;
  const refreshToken = parsed?.tokens?.refresh_token;
  const idToken = parsed?.tokens?.id_token;
  const accountId = parsed?.tokens?.account_id;
  if (parsed?.auth_mode !== "chatgpt" || typeof accessToken !== "string" || accessToken.length === 0 || typeof refreshToken !== "string" || refreshToken.length === 0 || typeof idToken !== "string" || idToken.length === 0 || typeof accountId !== "string" || accountId.length === 0) {
    throw new Error("Codex is not signed in with ChatGPT. Run `codex login`, then reopen Grok Bot.");
  }
  return { accessToken, refreshToken, idToken, accountId, path, document: parsed };
}

function jwtAudience(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Loose;
    const audience = payload.aud;
    return typeof audience === "string" ? audience : Array.isArray(audience) ? audience.find((value): value is string => typeof value === "string") ?? null : null;
  } catch { return null; }
}

async function refreshCodexCredentials(current: CodexCredentials): Promise<CodexCredentials> {
  const clientId = jwtAudience(current.idToken);
  if (clientId == null) throw new Error("Codex login expired and its refresh identity is invalid. Run `codex login` again.");
  const refresh = await fetch("https://auth.openai.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: clientId }),
  });
  if (!refresh.ok) throw new Error("Codex login expired and could not be refreshed. Run `codex login` again.");
  const payload = await refresh.json() as Loose;
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) throw new Error("Codex returned an invalid refreshed login. Run `codex login` again.");
  const document = {
    ...current.document,
    tokens: {
      ...current.document.tokens,
      access_token: payload.access_token,
      refresh_token: typeof payload.refresh_token === "string" && payload.refresh_token.length > 0 ? payload.refresh_token : current.refreshToken,
      id_token: typeof payload.id_token === "string" && payload.id_token.length > 0 ? payload.id_token : current.idToken,
    },
    last_refresh: new Date().toISOString(),
  };
  const temporary = `${current.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, current.path);
  return codexCredentials();
}

function codexAuthenticatedFetch(initial: CodexCredentials): typeof fetch {
  let credentials = initial;
  return async (input, init) => {
    const perform = () => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${credentials.accessToken}`);
      headers.set("ChatGPT-Account-Id", credentials.accountId);
      return fetch(input, { ...init, headers });
    };
    let result = await perform();
    if (result.status !== 401) return result;
    credentials = await refreshCodexCredentials(credentials);
    result = await perform();
    return result;
  };
}

function configuredCodexModel(): string {
  const selected = process.env.SAND_CODEX_MODEL?.trim();
  if (selected) return selected;
  try {
    const config = readFileSync(join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "config.toml"), "utf8");
    return /^\s*model\s*=\s*["']([^"']+)["']/m.exec(config)?.[1]?.trim() || "gpt-5.4";
  } catch { return "gpt-5.4"; }
}

function configuredCodexReasoningEffort(): "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
  const selected = process.env.SAND_CODEX_REASONING_EFFORT?.trim();
  if (selected === "minimal" || selected === "low" || selected === "medium" || selected === "high" || selected === "xhigh") return selected;
  try {
    const config = readFileSync(join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "config.toml"), "utf8");
    const value = /^\s*model_reasoning_effort\s*=\s*["']([^"']+)["']/m.exec(config)?.[1]?.trim();
    return value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" ? value : undefined;
  } catch { return undefined; }
}

function stripSchemaArtifacts(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripSchemaArtifacts);
  const { $schema: _schema, default: _default, definitions: _definitions, markdownDescription: _markdown, ...rest } = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(rest)) result[key] = stripSchemaArtifacts(child);
  return result;
}

// Strict function-calling normalization for the OpenAI-compatible channel: every
// object node must declare additionalProperties:false and list all declared
// properties in required (some strict backends reject anything else with a 400,
// e.g. muse-spark via the local proxy). Applied at this single egress so both
// zod-built tools and pass-through MCP inputSchemas are covered. Non-strict
// backends accept the result as plain JSON Schema. Runtime args are still
// validated by zod on the host side; this only describes the shape to the model.
function resolveInternalRef(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node == null || typeof node !== "object") return undefined;
    node = Array.isArray(node)
      ? ( /^\d+$/.test(key) ? node[Number(key)] : undefined )
      : (node as Record<string, unknown>)[key];
  }
  return node;
}

export function normalizeStrictToolSchema(value: unknown, root?: unknown, seen?: Set<string>): unknown {
  // AI SDK jsonSchema() wrappers carry the real schema under .jsonSchema while
  // internal $refs resolve relative to that inner schema, so descend first and
  // let the inner object become the ref owner.
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.jsonSchema != null && typeof record.jsonSchema === "object" && record.type === undefined && record.$ref === undefined) {
      return { ...record, jsonSchema: normalizeStrictToolSchema(record.jsonSchema) };
    }
  }
  const owner = root ?? value;
  const active = seen ?? new Set<string>();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((child) => normalizeStrictToolSchema(child, owner, active));
  const record = value as Record<string, unknown>;
  // zod-to-json-schema emits internal relative $refs (e.g. z.array of a
  // discriminatedUnion points at its sibling branch). Strict backends do not
  // resolve $ref, so inline the target. Cyclic refs are left as-is.
  if (typeof record.$ref === "string") {
    const ref = record.$ref;
    if (active.has(ref)) return value;
    const target = resolveInternalRef(owner, ref);
    if (target == null || typeof target !== "object") return value;
    active.add(ref);
    try {
      const inlined = normalizeStrictToolSchema(target, owner, active);
      if (inlined == null || typeof inlined !== "object" || Array.isArray(inlined)) return value;
      const { $ref: _dropped, ...siblings } = record;
      return { ...(inlined as Record<string, unknown>), ...siblings };
    } finally {
      active.delete(ref);
    }
  }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) result[key] = normalizeStrictToolSchema(child, owner, active);
  if (result.type === "object") {
    // Bare object nodes (e.g. pass-through MCP inputSchemas) carry no
    // additionalProperties key at all; strict backends reject those too.
    if (result.additionalProperties !== false) result.additionalProperties = false;
    // Record-shaped leftovers (z.record with the value schema dropped) have no
    // properties key; strict backends require one, even if empty.
    if (result.properties == null) result.properties = {};
    const properties: Record<string, unknown> | null = typeof result.properties === "object" && result.properties !== null && !Array.isArray(result.properties)
      ? result.properties as Record<string, unknown>
      : null;
    if (properties !== null) {
      const declared = Object.keys(properties);
      // A null/non-list required (emitted for empty z.object({})) is also
      // rejected; rebuild it from the declared properties.
      const required = Array.isArray(result.required) ? result.required.filter((entry): entry is string => typeof entry === "string") : [];
      const missing = declared.filter((key) => !required.includes(key));
      if (missing.length > 0 || !Array.isArray(result.required)) result.required = [...required, ...missing];
    }
  }
  return result;
}

// Host tools carry Zod schemas; serialized raw they reach the endpoint as its internals and draw an opaque server_error, so convert them to JSON Schema.
export function toToolWireParameters(parameters: unknown): unknown {
  if (parameters == null || typeof parameters !== "object") return parameters;
  if (isRecord(parameters) && parameters.type === undefined && parameters.$ref === undefined && isRecord(parameters.jsonSchema)) {
    return parameters.jsonSchema;
  }
  if ("~standard" in parameters || "_def" in parameters) {
    try {
      return stripSchemaArtifacts(zodToJsonSchema(parameters as never, { target: "openApi3" }));
    } catch {
      return parameters;
    }
  }
  return parameters;
}

function codexTools(definitions: readonly Loose[] | undefined): CodexDirectTool[] | undefined {
  if (definitions == null) return undefined;
  const tools = definitions.flatMap((source): CodexDirectTool[] => {
    const parameters = source.inputSchema ?? source.parameters;
    const schema = toToolWireParameters(parameters);
    return typeof source.name === "string" && source.name.length > 0 && parameters != null ? [{
      name: source.name,
      ...(typeof source.description === "string" ? { description: source.description } : {}),
      parameters: schema,
      source,
    }] : [];
  });
  return tools.length === 0 ? undefined : tools;
}

function codexExecutor(messages: readonly ProviderMessage[], invocationId: string, definitions?: readonly Loose[], executeTool?: RoutedToolExecutor, onUsage?: (usage: UsageRecord) => void, signal?: AbortSignal) {
  const credentials = codexCredentials();
  const usage = deferred<{ promptTokens: number; completionTokens: number; totalTokens: number }>();
  const extendedUsage = deferred<{ inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; maxTokens: number }>();
  const resultResponse = deferred<ReturnType<typeof response>>();
  const metadata = deferred<Record<string, unknown>>();
  const model = configuredCodexModel();
  const tools = codexTools(definitions);
  const fullStream = (async function* () {
    let text = "";
    try {
      for await (const event of streamCodexDirectResponses({
        fetch: codexAuthenticatedFetch(credentials),
        endpoint: "https://chatgpt.com/backend-api/codex/responses",
        model,
        ...(configuredCodexReasoningEffort() == null ? {} : { reasoningEffort: configuredCodexReasoningEffort()! }),
        instructions: GROK_ROUTER_SYSTEM_PROMPT,
        input: toCodexInputMessages(messages),
        ...(signal === undefined ? {} : { signal }),
        ...(tools == null ? {} : { tools }),
        ...(executeTool == null ? {} : { executeTool: async (selected, args, toolCallId) => await executeTool(selected.source, args, toolCallId) }),
        ...(executeTool == null ? { surfaceToolCalls: true } : {}),
        maxSteps: tools == null ? 1 : 8,
      })) {
        if (event.type === "text-delta") { text += event.delta; yield { type: "text-delta" as const, textDelta: event.delta }; continue; }
        if (event.type === "tool-call") { yield { type: "tool-call" as const, toolCallId: event.toolCallId, toolName: event.toolName, args: event.args }; continue; }
        const inputTokens = finiteTokenCount(event.usage?.inputTokens), outputTokens = finiteTokenCount(event.usage?.outputTokens);
        const basic = { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens };
        const extended = { ...event.usage, maxTokens: 0 };
        onUsage?.(event.usage);
        usage.resolve(basic);
        extendedUsage.resolve(extended);
        metadata.resolve({ openai: { responseId: event.responseId, direct: true } });
        resultResponse.resolve(response(text, invocationId, model));
      }
    } catch (error) { usage.reject(error); extendedUsage.reject(error); metadata.reject(error); resultResponse.reject(error); throw error; }
  })();
  return { fullStream, response: resultResponse.promise, usage: usage.promise, extendedUsage: extendedUsage.promise, providerMetadata: metadata.promise, invocationId: Promise.resolve(invocationId) };
}

function toToolSet(definitions: readonly Loose[] | undefined, executeTool?: RoutedToolExecutor): ToolSet | undefined {
  if (definitions == null || definitions.length === 0) return undefined;
  const tools: ToolSet = {};
  for (const definition of definitions) {
    if (typeof definition.name !== "string" || definition.name.length === 0) continue;
    const parameters = definition.inputSchema ?? definition.parameters;
    if (parameters == null) continue;
    const routedTool: any = {
      ...(typeof definition.description === "string" ? { description: definition.description } : {}),
      parameters: jsonSchema(normalizeStrictToolSchema(toToolWireParameters(parameters)) as Parameters<typeof jsonSchema>[0]),
    };
    if (executeTool != null) routedTool.execute = async (args: unknown, options: { toolCallId: string }) => await executeTool(definition, args, options.toolCallId);
    tools[definition.name] = tool(routedTool);
  }
  return Object.keys(tools).length === 0 ? undefined : tools;
}

const finiteTokenCount = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
const CHAT_IDLE_TIMEOUT_MS = resolveFirstTokenStallDeadlineMs() || DEFAULT_FIRST_TOKEN_STALL_DEADLINE_MS;

function openRouterExecutor(messages: readonly ProviderMessage[], invocationId: string, definitions?: readonly Loose[], executeTool?: RoutedToolExecutor, onUsage?: (usage: UsageRecord) => void, signal?: AbortSignal) {
  const chatStartedAt = Date.now();
  const chatStatusStore = new SandSettingsStore(join(getSandRootDir(), "settings.json"));
  let recordedChatStatusSignature = "";
  function writeChatStatus(status: ReturnType<typeof openRouterOkStatus>): void {
    const signature = JSON.stringify(status);
    if (signature === recordedChatStatusSignature) return;
    recordedChatStatusSignature = signature;
    try { chatStatusStore.setOpenRouterChatStatus(status); } catch {}
  }
  function recordChatError(error: unknown): void {
    const status = classifyOpenRouterError(error, "chat", chatStartedAt);
    if (status == null) {
      recordedChatStatusSignature = "aborted";
      return;
    }
    writeChatStatus(status);
  }
  const transport = resolveOpenRouterTransport(readPersistedOpenRouterBaseUrl());
  const id = resolveOpenRouterModel();
  const headers: Record<string, string> = { "HTTP-Referer": "https://github.com/grok-bot-reconstructed", "X-Title": "Grok Bot Reconstructed" };
  if (transport.hostHeader) headers["Host"] = transport.hostHeader;
  let model: LanguageModelV1;
  const effort = resolveOpenRouterEffort();
  try {
    // The effort has to go through the model settings, not `providerOptions`: the bundled
    // @ai-sdk/openai reads `providerMetadata.openai.reasoningEffort` (namespace hard-coded to
    // "openai", not this provider's `name`), while ai@4.3 hands the model `providerOptions` —
    // so the providerOptions channel silently drops it. `chat(id, { reasoningEffort })` lands on
    // `this.settings.reasoningEffort`, which is read unconditionally.
    model = createOpenAI({ apiKey: openRouterCredential(), baseURL: transport.baseUrl, compatibility: "compatible", name: "openrouter", headers })
      .chat(id as any, effort === null ? undefined : ({ reasoningEffort: effort } as any));
  } catch (error) {
    recordChatError(error);
    throw error;
  }
  const tools = toToolSet(definitions, executeTool);
  const result = streamText({ model, system: GROK_ROUTER_SYSTEM_PROMPT, messages: messages as CoreMessage[], ...(signal === undefined ? {} : { abortSignal: signal }), ...(tools === undefined ? {} : { tools }), toolCallStreaming: true, maxSteps: tools === undefined ? 1 : 8, maxRetries: 4 });
  async function* observedFullStream() {
    const iterator = result.fullStream[Symbol.asyncIterator]();
    let pending = iterator.next();
    try {
      while (true) {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const idleTimeout = new Promise<{ readonly streamTimeout: true }>((resolve) => {
          timeoutHandle = setTimeout(() => resolve({ streamTimeout: true }), CHAT_IDLE_TIMEOUT_MS);
        });
        const outcome = await Promise.race([
          pending.then((value) => ({ value })),
          idleTimeout,
        ]);
        clearTimeout(timeoutHandle);
        if ("streamTimeout" in outcome) {
          recordChatError({ name: "ResponseTimeoutError", code: "ETIMEDOUT", message: `OpenCodex 通道 ${CHAT_IDLE_TIMEOUT_MS / 1000} 秒未返回流式响应。` });
          continue;
        }
        if (outcome.value.done) break;
        const event = outcome.value.value;
        if (event.type === "error") recordChatError(event.error);
        yield event;
        pending = iterator.next();
      }
      writeChatStatus(openRouterOkStatus("chat", chatStartedAt));
    } catch (error) {
      recordChatError(error);
      throw error;
    }
  }
  void result.response.catch(recordChatError);

  const usage = result.usage.then(value => ({ promptTokens: finiteTokenCount(value?.promptTokens), completionTokens: finiteTokenCount(value?.completionTokens), totalTokens: finiteTokenCount(value?.totalTokens) || finiteTokenCount(value?.promptTokens) + finiteTokenCount(value?.completionTokens) }));
  const extendedUsage = usage.then(value => ({ inputTokens: value.promptTokens, outputTokens: value.completionTokens, cacheReadTokens: 0, cacheWriteTokens: 0, maxTokens: 0 }));
  if (onUsage != null) void extendedUsage.then(onUsage);
  return { fullStream: observedFullStream(), response: result.response, usage, extendedUsage, providerMetadata: result.providerMetadata, invocationId: Promise.resolve(invocationId) };
}

class ProviderPromptExecutor extends BasePromptExecutor<ProviderMessage> {
  constructor(readonly provider: RoutedProvider, initialMessages?: readonly ProviderMessage[], readonly onUsage?: (usage: UsageRecord) => void) { super(new BasePromptBuilder(initialMessages)); }
  stream(ctx: unknown, invocationId = crypto.randomUUID(), definitions?: readonly Loose[]) {
    const signal = contextSignal(ctx);
    if (this.provider === "codex") return codexExecutor(this.getMessages(), invocationId, definitions, undefined, this.onUsage, signal);
    return openRouterExecutor(this.getMessages(), invocationId, definitions, undefined, this.onUsage, signal);
  }
}

export function createProviderPromptSession(provider: RoutedProvider): { getModelId(): string; getExecutor(state?: unknown): PromptExecutor } {
  const modelId = provider === "codex" ? configuredCodexModel() : resolveOpenRouterModel();
  return { getModelId: () => modelId, getExecutor: state => new ProviderPromptExecutor(provider, Array.isArray(state) ? state as ProviderMessage[] : undefined, usage => recordRoutedUsage(provider, usage)) };
}

export async function runRoutedProviderText(provider: RoutedProvider, messages: readonly ProviderMessage[], options?: {
  readonly tools?: readonly Loose[];
  readonly executeTool?: RoutedToolExecutor;
  readonly onTextDelta?: (delta: string, accumulated: string) => void;
  readonly signal?: AbortSignal;
}): Promise<string> {
  const invocationId = crypto.randomUUID();
  const onUsage = (usage: UsageRecord) => recordRoutedUsage(provider, usage);
  const result = provider === "codex"
    ? codexExecutor(messages, invocationId, options?.tools, options?.executeTool, onUsage, options?.signal)
    : openRouterExecutor(messages, invocationId, options?.tools, options?.executeTool, onUsage, options?.signal);
  let text = "";
  for await (const event of result.fullStream) {
    if (event.type === "text-delta" && typeof event.textDelta === "string") {
      text += event.textDelta;
      options?.onTextDelta?.(event.textDelta, text);
    }
  }
  await result.response;
  return text;
}
