import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { getBoxSecretsStorePath } from "../../host/extensions/secrets/secrets-service.js";
import { readCodexConfigValue } from "./stepfun-config.js";

const STEPFUN_BASE_URL = "https://api.stepfun.com/step_plan/v1";
const STEPFUN_ASR_MODEL = "stepaudio-2.5-asr";
const TRANSCRIBE_TIMEOUT_MS = 60_000;

export class StepFunTranscriptionError extends Error {
  constructor(message: string) { super(message); this.name = "StepFunTranscriptionError"; }
}

export interface StepFunAudioFormat {
  readonly type: "wav" | "pcm" | "webm" | "mp4";
  readonly codec: string;
  readonly rate: number;
  readonly bits: number;
  readonly channel: number;
}

function persistedSecrets(): Record<string, string> {
  const candidates = [getBoxSecretsStorePath(), join(homedir(), ".grokbot", "box-secrets.json"), join(homedir(), ".cursor", "sand", "box-secrets.json")];
  for (const candidate of candidates) {
  try {
    const parsed = JSON.parse(readFileSync(candidate, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) return {};
    const secrets = (parsed as { secrets?: unknown }).secrets;
    if (typeof secrets !== "object" || secrets == null || Array.isArray(secrets)) return {};
    return Object.fromEntries(Object.entries(secrets).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch { continue; }
  }
  return {};
}

export function stepFunCredential(): string | null {
  const value = process.env.STEPFUN_API_KEY?.trim() || persistedSecrets().STEPFUN_API_KEY?.trim();
  return value == null || value.length === 0 ? null : value;
}

export function stepFunBaseUrl(): string {
  return process.env.STEPFUN_BASE_URL?.trim() || readCodexConfigValue("stepfun_base_url") || STEPFUN_BASE_URL;
}

export function stepFunAsrModel(): string {
  return process.env.STEPFUN_ASR_MODEL?.trim() || readCodexConfigValue("stepfun_asr_model") || STEPFUN_ASR_MODEL;
}

export function stepFunAudioFormat(mimeType: string): StepFunAudioFormat {
  const container = mimeType.split(";")[0]!.trim().toLowerCase();
  if (container === "audio/webm") return { type: "wav", codec: "pcm_s16le", rate: 16_000, bits: 16, channel: 1 };
  if (container === "audio/mp4") return { type: "mp4", codec: "aac", rate: 44_100, bits: 16, channel: 1 };
  if (container === "audio/wav" || container === "audio/x-wav") return { type: "wav", codec: "pcm_s16le", rate: 16_000, bits: 16, channel: 1 };
  if (container === "audio/pcm") return { type: "pcm", codec: "pcm_s16le", rate: 16_000, bits: 16, channel: 1 };
  return { type: "wav", codec: "pcm_s16le", rate: 16_000, bits: 16, channel: 1 };
}
async function* sseEvents(response: Response): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary).replaceAll("\r", "");
      buffer = buffer.slice(boundary + 2);
      const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (data.length === 0 || data === "[DONE]") continue;
      let parsed: unknown;
      try { parsed = JSON.parse(data); } catch { continue; }
      if (typeof parsed === "object" && parsed != null) yield parsed as Record<string, unknown>;
    }
    if (done) break;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function pickText(event: Record<string, unknown>): string | null {
  for (const key of ["text", "transcript", "delta"]) {
    const value = event[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  const nested = asRecord(event.transcript) ?? asRecord(event.data);
  if (nested != null) {
    const value = nested.text ?? nested.transcript;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function isDoneEvent(event: Record<string, unknown>): boolean {
  const type = event.type;
  return typeof type === "string" && (type === "transcript.text.done" || type.endsWith("transcript.text.done") || type === "done");
}

function isErrorEvent(event: Record<string, unknown>): boolean {
  return event.type === "error" || asRecord(event.error) != null;
}

export interface StepFunTranscriptionResult {
  readonly text: string;
}

export async function transcribeWithStepFun(args: {
  readonly audio: Uint8Array;
  readonly mimeType: string;
  readonly language?: string;
  readonly signal?: AbortSignal;
  readonly credential?: string | null;
}): Promise<StepFunTranscriptionResult> {
  const credential = args.credential === undefined ? stepFunCredential() : args.credential?.trim() || null;
  if (credential == null) throw new StepFunTranscriptionError("StepFun needs an API key. Add STEPFUN_API_KEY in Settings.");
  const format = stepFunAudioFormat(args.mimeType);
  const language = args.language != null && args.language.length > 0 ? args.language.split("-")[0]! : "zh";
  const body = {
    audio: {
      data: Buffer.from(args.audio).toString("base64"),
      input: {
        transcription: { model: stepFunAsrModel(), language, enable_itn: true },
        format
      }
    }
  };
  const response = await fetch(`${stepFunBaseUrl()}/audio/asr/sse`, {
    method: "POST",
    headers: { authorization: `Bearer ${credential}`, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    ...(args.signal == null ? {} : { signal: args.signal }),
  });
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.text()).slice(0, 4_096).trim(); } catch {}
    throw new StepFunTranscriptionError(`StepFun transcription failed (${response.status}${detail.length === 0 ? "" : `: ${detail}`}).`);
  }
  let text = "";
  for await (const event of sseEvents(response)) {
    if (isErrorEvent(event)) throw new StepFunTranscriptionError(`StepFun transcription failed: ${JSON.stringify(event).slice(0, 2_048)}`);
    if (isDoneEvent(event)) {
      const finalText = pickText(event);
      if (finalText != null) text = finalText;
      break;
    }
    const delta = pickText(event);
    if (delta != null) text += delta;
  }
  return { text: text.trim() };
}
