import { createHash } from "node:crypto";
import type { JsonValue } from "@bufbuild/protobuf";
import type { SmartModeClassifierArgs } from "../../../packages/proto/generated/agent/v1/smart_mode_classifier_exec_pb.js";
import { redactSandAutoReviewInlineSecrets } from "../../../shared/sand-auto-review-redact.js";

const RULE_PREFIX = "Always allow exact local command [local-shell:v1:";
const RULE_KEY = /^Always allow exact local command \[local-shell:v1:([a-f0-9]{64})\]/;

function canonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key] ?? null)).join(",") + "}";
}

export function localShellAllowRule(args: SmartModeClassifierArgs): string | undefined {
  if (args.target?.action !== "shell") return undefined;
  const target = args.target.arguments?.toJson();
  if (target === null || typeof target !== "object" || Array.isArray(target)) return undefined;
  if (typeof target.command !== "string" || !target.command.trim()) return undefined;
  const surface = target.surface;
  if (surface !== "isolated_box" && surface !== "host_machine") return undefined;
  const directory = typeof target.working_directory === "string" ? target.working_directory : "";
  // An implicit working directory cannot be shared across different agents.
  const scope = directory ? null : args.parentConversationId;
  if (!directory && !scope) return undefined;
  const binding: JsonValue = {
    command: target.command,
    working_directory: directory,
    surface,
    conversation: scope ?? null,
    background: target.background ?? null,
    sandbox_enabled: target.sandbox_enabled ?? false,
    is_readonly: target.is_readonly ?? false,
    requested_sandbox_policy: target.requested_sandbox_policy ?? null,
    target_enrichment: target.target_enrichment ?? null,
  };
  const key = createHash("sha256").update(canonical(binding)).digest("hex");
  const location = surface === "isolated_box" ? "Bot computer" : "your computer";
  const summary = redactSandAutoReviewInlineSecrets(target.command).replace(/\s+/g, " ").trim().slice(0,220);
  return RULE_PREFIX + key + "] on " + location + ": " + summary;
}

export function matchesLocalAutoReviewRule(expected: string, candidate: string): boolean {
  const key = RULE_KEY.exec(expected)?.[1];
  return key !== undefined && RULE_KEY.exec(candidate)?.[1] === key;
}

export function hasSavedAutoReviewRule(expected: string, saved: readonly string[]): boolean {
  return saved.some(rule => expected === rule || matchesLocalAutoReviewRule(expected, rule));
}
