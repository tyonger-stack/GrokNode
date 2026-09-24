export type OpenRouterChannelStatusCode =
  | "ok"
  | "out_of_quota"
  | "rate_limited"
  | "upstream_403"
  | "connection_failed"
  | "response_timeout"
  | "model_list_abnormal";

export interface OpenRouterChannelStatus {
  state: OpenRouterChannelStatusCode;
  httpStatus: number | null;
  latencyMs: number | null;
  code: string | null;
  message: string | null;
  resetAt: string | null;
  retryAfterMs: number | null;
  observedAt: string;
  source: "model_list" | "chat";
}

const ABNORMAL_STATES = ["out_of_quota", "rate_limited", "upstream_403", "connection_failed", "response_timeout", "model_list_abnormal"] as const;
const HARD_MODEL_LIST_STATES = ["out_of_quota", "rate_limited", "upstream_403"] as const;

function recordFrom(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value == null) return {};
  return value instanceof Error
    ? { name: value.name, message: value.message, cause: value.cause, ...value as unknown as Record<string, unknown> }
    : value as Record<string, unknown>;
}
function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function nonNegativeInteger(value: unknown): number | null {
  const number = finiteNumber(value);
  return number != null && number >= 0 ? Math.round(number) : null;
}
function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function limitedText(value: unknown): string | null {
  if (value == null) return null;
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try { text = JSON.stringify(value) ?? ""; } catch { text = String(value); }
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length === 0 ? null : text.slice(0, 500);
}
function getHeader(headers: unknown, name: string): string | null {
  if (headers instanceof Headers) {
    const value = headers.get(name);
    return value == null || value.trim().length === 0 ? null : value.trim();
  }
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && entry[0].toLowerCase() === name.toLowerCase()) return stringValue(entry[1]);
    }
    return null;
  }
  if (typeof headers === "object" && headers != null) {
    const wanted = Object.keys(headers as Record<string, unknown>).find((key) => key.toLowerCase() === name.toLowerCase());
    return wanted == null ? null : stringValue((headers as Record<string, unknown>)[wanted]);
  }
  return null;
}
function parseRetryAfter(value: unknown, now: Date = new Date()): { resetAt: string; retryAfterMs: number } | null {
  const raw = stringValue(value);
  if (raw == null) return null;
  if (/^\d+$/.test(raw.trim())) {
    const seconds = Number(raw.trim());
    if (Number.isFinite(seconds) && seconds >= 0) {
      const reset = new Date(now.getTime() + Math.round(seconds * 1000));
      return { resetAt: reset.toISOString(), retryAfterMs: Math.max(0, reset.getTime() - now.getTime()) };
    }
  }
  const reset = new Date(raw);
  if (Number.isFinite(reset.getTime()) && reset.getTime() >= now.getTime()) {
    return { resetAt: reset.toISOString(), retryAfterMs: reset.getTime() - now.getTime() };
  }
  return null;
}
function statusFrom(args: {
  state: OpenRouterChannelStatusCode;
  source: OpenRouterChannelStatus["source"];
  startedAt: number;
  httpStatus?: number | null;
  record: Record<string, unknown>;
  retryAfter?: unknown;
  observedAt?: Date;
}): OpenRouterChannelStatus {
  const observedAt = args.observedAt ?? new Date();
  const retry = args.retryAfter == null ? null : parseRetryAfter(args.retryAfter, observedAt);
  return {
    state: args.state,
    httpStatus: nonNegativeInteger(args.httpStatus),
    latencyMs: Math.max(0, Math.round(observedAt.getTime() - args.startedAt)),
    code: stringValue(args.record.code) ?? stringValue(args.record.name),
    message: limitedText(args.record.message),
    resetAt: retry?.resetAt ?? null,
    retryAfterMs: retry?.retryAfterMs ?? null,
    observedAt: observedAt.toISOString(),
    source: args.source,
  };
}
function bodyText(record: Record<string, unknown>): string {
  return [record.responseBody, record.data, record.message, record.cause].map(limitedText).filter((value): value is string => value != null).join(" ").toLowerCase();
}
function isQuotaFailure(status: number | null, record: Record<string, unknown>): boolean {
  if (status === 402) return true;
  if (status !== 403 && status !== 429) return false;
  return /quota|balance|insufficient|payment|exhausted|额度|余额|余量/.test(bodyText(record));
}
function connectionCode(record: Record<string, unknown>): string | null {
  const code = stringValue(record.code) ?? stringValue(record.name);
  if (code == null) return null;
  return ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "EHOSTUNREACH", "ENETUNREACH"].includes(code) ? code : null;
}
export function openRouterOkStatus(source: OpenRouterChannelStatus["source"], startedAt: number = Date.now(), httpStatus: number | null = null): OpenRouterChannelStatus {
  return {
    state: "ok",
    httpStatus: nonNegativeInteger(httpStatus),
    latencyMs: Math.max(0, Date.now() - startedAt),
    code: null,
    message: null,
    resetAt: null,
    retryAfterMs: null,
    observedAt: new Date().toISOString(),
    source,
  };
}
export function classifyOpenRouterError(error: unknown, source: OpenRouterChannelStatus["source"], startedAt: number = Date.now(), extra: { readonly timedOut?: boolean } = {}): OpenRouterChannelStatus | null {
  let record = recordFrom(error);
  if (record.cause != null) {
    const cause = recordFrom(record.cause);
    record = { ...cause, ...record, cause: record.cause };
  }
  const status = nonNegativeInteger(record.statusCode ?? record.httpStatus);
  const retryAfter = record.responseHeaders == null ? null : getHeader(record.responseHeaders, "retry-after");
  const code = stringValue(record.code) ?? stringValue(record.name);
  const message = limitedText(record.message) ?? "";
  if (isQuotaFailure(status, record)) return statusFrom({ state: "out_of_quota", source, startedAt, httpStatus: status, record });
  if (status === 429) return statusFrom({ state: "rate_limited", source, startedAt, httpStatus: status, record, retryAfter });
  if (status === 403) return statusFrom({ state: "upstream_403", source, startedAt, httpStatus: status, record });
  if (status === 408 || status === 504 || status === 524) return statusFrom({ state: "response_timeout", source, startedAt, httpStatus: status, record });
  if (status != null && source === "model_list") return statusFrom({ state: "model_list_abnormal", source, startedAt, httpStatus: status, record });
  if (extra.timedOut === true || code === "TimeoutError" || code === "ETIMEDOUT" || /timed?\s*out|timeout|超时/.test(message)) {
    return statusFrom({ state: "response_timeout", source, startedAt, httpStatus: status, record });
  }
  const networkCode = connectionCode(record);
  if (networkCode != null) return statusFrom({ state: "connection_failed", source, startedAt, httpStatus: status, record: { ...record, code: networkCode } });
  if (error instanceof SyntaxError && source === "model_list") return statusFrom({ state: "model_list_abnormal", source, startedAt, httpStatus: status, record });
  if (code === "AbortError") return null;
  if (source === "model_list") return statusFrom({ state: "model_list_abnormal", source, startedAt, httpStatus: status, record });
  return statusFrom({ state: "connection_failed", source, startedAt, httpStatus: status, record });
}
export function normalizeOpenRouterChannelStatus(value: unknown): OpenRouterChannelStatus | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const state = stringValue(record.state);
  const source = stringValue(record.source);
  const observedAt = stringValue(record.observedAt);
  if ((state !== "ok" && !ABNORMAL_STATES.includes(state as (typeof ABNORMAL_STATES)[number])) || (source !== "model_list" && source !== "chat") || observedAt == null || !Number.isFinite(new Date(observedAt).getTime())) return null;
  const httpStatus = record.httpStatus == null ? null : nonNegativeInteger(record.httpStatus);
  const latencyMs = record.latencyMs == null ? null : nonNegativeInteger(record.latencyMs);
  const retryAfterMs = record.retryAfterMs == null ? null : nonNegativeInteger(record.retryAfterMs);
  const resetAt = stringValue(record.resetAt);
  if (record.httpStatus != null && httpStatus == null) return null;
  if (record.latencyMs != null && latencyMs == null) return null;
  if (record.retryAfterMs != null && retryAfterMs == null) return null;
  if (resetAt != null && !Number.isFinite(new Date(resetAt).getTime())) return null;
  return { state: state as OpenRouterChannelStatusCode, httpStatus, latencyMs, code: stringValue(record.code), message: stringValue(record.message), resetAt, retryAfterMs, observedAt, source };
}
function statusAgeMs(status: OpenRouterChannelStatus, now: Date): number {
  return Math.max(0, now.getTime() - new Date(status.observedAt).getTime());
}
function isExpired(status: OpenRouterChannelStatus, now: Date): boolean {
  if (status.state === "rate_limited") {
    if (status.resetAt != null) return new Date(status.resetAt).getTime() <= now.getTime();
    if (status.retryAfterMs != null) return statusAgeMs(status, now) >= status.retryAfterMs;
    return statusAgeMs(status, now) > 60 * 60 * 1000;
  }
  if (status.state === "connection_failed" || status.state === "response_timeout" || status.state === "model_list_abnormal") {
    return statusAgeMs(status, now) > 10 * 60 * 1000;
  }
  return false;
}
export function mergeOpenRouterChannelStatus(chatStatus: OpenRouterChannelStatus | null, modelListStatus: OpenRouterChannelStatus | null, now: Date = new Date()): OpenRouterChannelStatus | null {
  const chat = chatStatus == null || isExpired(chatStatus, now) ? null : chatStatus;
  const list = modelListStatus == null ? null : modelListStatus;
  if (chat?.state !== "ok") {
    if (chat != null) return chat;
    return list;
  }
  if (list == null || list.state === "ok") return list ?? chat;
  if (HARD_MODEL_LIST_STATES.includes(list.state as (typeof HARD_MODEL_LIST_STATES)[number])) return list;
  return statusAgeMs(chat, now) <= 60_000 ? chat : list;
}
