import {
  APPLE_NOTES_MAX_CHARS,
  clampAppleContactsLimit,
  clampAppleReadLimit,
} from "../../shared/node/apple-apps-tools.js";

/**
 * Apple 工具 op 分发 —— 移植自 0.75.8 daemon 的 est()/Vnt()。
 *
 * 上游锚点（rea-grokbot-0758/apple/evidence.json：apple-events-op-dispatch、
 * est-master-dispatch、op-error-copy）：
 * - notes/mail 走 MCP 工具 `apple-events/run`，参数 `{app, op, args}`，args 里
 *   值为 undefined 的键丢弃（上游 Hpr）；
 * - `mac_read_notes`：有 id → `notes get {id, maxChars}`，否则 `notes search
 *   {query, folder, limit}`；`mac_write_notes`：有 id → append（必须带
 *   currentTitle），否则 create（必须带 title）；写路径包 lD 重试包装；
 * - `mac_read_mail`：有 id → `mail get`，否则 `mail search`；`mac_draft_mail`：
 *   replyToId 与 to 都缺 → invalid_input；
 * - est() default 分支抛 `{code:"unsupported", message:'This Mac has no "<toolId>" tool.'}`；
 * - invalid_input 消息形状 `K7`：`${toolId}: ${reason}`；
 * - lD：错误消息首词 ∈ {sidecar_timeout, sidecar_closed} 且非 DeviceToolError →
 *   MacWriteUnconfirmedError（保留原 message 与 cause）。
 *
 * reminders/calendar/contacts/location 的专用客户端（Gnt：reminders/lists 等
 * 直接作 MCP 工具名）与回复 zod 校验属 host 暴露层（S3），本模块只承运
 * apple-events/run 通道与 est 的错误语义。
 */

export class DeviceToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DeviceToolError";
    this.code = code;
  }
}

export class MacWriteUnconfirmedError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "MacWriteUnconfirmedError";
  }
}

const WRITE_UNCONFIRMED_PREFIXES = new Set(["sidecar_timeout", "sidecar_closed"]);

export function firstWord(message: string): string {
  const space = message.indexOf(" ");
  return space === -1 ? message : message.slice(0, space);
}

export function withMacWriteConfirmation<T>(run: () => Promise<T>): Promise<T> {
  return run().catch((error: unknown) => {
    if (error instanceof DeviceToolError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (WRITE_UNCONFIRMED_PREFIXES.has(firstWord(message))) throw new MacWriteUnconfirmedError(error);
    throw error;
  });
}

/** 上游 Hpr：丢弃值为 undefined 的键（exactOptionalPropertyTypes 下显式构造）。 */
export function compactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) if (value !== undefined) output[key] = value;
  return output;
}

/** apple-events/run 调用端口；真实实现走 SidecarMcpSession.request("tools/call", …)。 */
export type AppleEventsCall = (app: string, op: string, args: Record<string, unknown>) => Promise<unknown>;

function invalidInput(toolId: string, reason: string): DeviceToolError {
  return new DeviceToolError("invalid_input", `${toolId}: ${reason}`);
}

function readString(record: Map<string, unknown>, key: string): string | undefined {
  const value = record.get(key);
  return typeof value === "string" && value.trim() !== "" ? value : void 0;
}

function readStringArray(record: Map<string, unknown>, key: string): readonly string[] | undefined {
  const value = record.get(key);
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length === 0 ? undefined : items;
}

function inputRecord(input: unknown): Map<string, unknown> {
  if (input === null || typeof input !== "object") return new Map();
  return new Map(Object.entries(input as Record<string, unknown>));
}

async function dispatchNotesRead(toolId: string, input: unknown, call: AppleEventsCall): Promise<unknown> {
  const record = inputRecord(input);
  const id = readString(record, "id");
  if (id !== undefined) return call("notes", "get", { id, maxChars: APPLE_NOTES_MAX_CHARS });
  return call("notes", "search", compactArgs({
    query: readString(record, "query"),
    folder: readString(record, "folder"),
    limit: record.has("limit") ? clampAppleReadLimit(record.get("limit")) : undefined,
  }));
}

async function dispatchNotesWrite(toolId: string, input: unknown, call: AppleEventsCall): Promise<unknown> {
  const record = inputRecord(input);
  const body = readString(record, "body");
  if (body === undefined) throw invalidInput(toolId, "body is required");
  const id = readString(record, "id");
  if (id !== undefined) {
    const currentTitle = record.get("currentTitle");
    if (typeof currentTitle !== "string") throw invalidInput(toolId, "currentTitle is required with id");
    const appended = await withMacWriteConfirmation(() =>
      call("notes", "append", { id, currentTitle, body }));
    return { action: "appended", note: replyRecord(appended, "appended") };
  }
  const title = readString(record, "title");
  if (title === undefined) throw invalidInput(toolId, "a new note needs a title");
  const created = await withMacWriteConfirmation(() =>
    call("notes", "create", compactArgs({ title, body, folder: readString(record, "folder") })));
  return { action: "created", note: replyRecord(created, "created") };
}

async function dispatchMailRead(toolId: string, input: unknown, call: AppleEventsCall): Promise<unknown> {
  const record = inputRecord(input);
  const id = readString(record, "id");
  if (id !== undefined) return call("mail", "get", { id, maxChars: APPLE_NOTES_MAX_CHARS });
  const unreadOnly = record.get("unreadOnly") === true ? true : undefined;
  return call("mail", "search", compactArgs({
    query: readString(record, "query"),
    mailbox: readString(record, "mailbox"),
    unreadOnly,
    days: typeof record.get("days") === "number" ? record.get("days") : undefined,
    limit: record.has("limit") ? clampAppleReadLimit(record.get("limit")) : undefined,
  }));
}

async function dispatchMailDraft(toolId: string, input: unknown, call: AppleEventsCall): Promise<unknown> {
  const record = inputRecord(input);
  const body = readString(record, "body");
  if (body === undefined) throw invalidInput(toolId, "body is required");
  const replyToId = readString(record, "replyToId");
  const to = readStringArray(record, "to");
  if (replyToId === undefined && to === undefined) throw invalidInput(toolId, "a new email needs to");
  return withMacWriteConfirmation(() => call("mail", "draft", compactArgs({
    replyToId,
    to,
    cc: readStringArray(record, "cc"),
    subject: replyToId === undefined ? readString(record, "subject") : undefined,
    body,
  })));
}

function replyRecord(reply: unknown, key: string): unknown {
  if (reply === null || typeof reply !== "object") throw new Error("device_tool_reply_invalid");
  const value = (reply as Record<string, unknown>)[key];
  if (value === null || typeof value !== "object") throw new Error("device_tool_reply_invalid");
  return value;
}

const APPLE_EVENTS_DISPATCH: Readonly<Record<string, (toolId: string, input: unknown, call: AppleEventsCall) => Promise<unknown>>> = {
  mac_read_notes: dispatchNotesRead,
  mac_write_notes: dispatchNotesWrite,
  mac_read_mail: dispatchMailRead,
  mac_draft_mail: dispatchMailDraft,
};

/**
 * est() 语义：认识的权限键分发，否则抛 unsupported（上游 default 分支逐字）。
 * reminders/calendar/contacts/location 的客户端键返回 undefined 由调用层
 * 标注 not-routed-yet —— 它们不走 apple-events/run 通道。
 */
export async function dispatchAppleTool(toolId: string, input: unknown, call: AppleEventsCall): Promise<unknown> {
  const handler = APPLE_EVENTS_DISPATCH[toolId];
  if (handler === undefined) {
    throw new DeviceToolError("unsupported", `This Mac has no "${toolId}" tool.`);
  }
  return handler(toolId, input, call);
}

export { clampAppleContactsLimit };
