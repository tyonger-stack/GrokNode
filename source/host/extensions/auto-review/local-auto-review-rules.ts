import { createHash } from "node:crypto";
import type { JsonValue } from "@bufbuild/protobuf";
import type { SmartModeClassifierArgs } from "../../../packages/proto/generated/agent/v1/smart_mode_classifier_exec_pb.js";
import { redactSandAutoReviewInlineSecrets } from "../../../shared/sand-auto-review-redact.js";

const SHELL_RULE_PREFIX = "Always allow exact local command [local-shell:v1:";
const MCP_RULE_PREFIX = "Always allow connected service tool [local-mcp:v1:";
// Both rule kinds carry a kind-tagged digest in the bracketed tag; a saved rule only
// satisfies an expected rule when kind and digest both match.
const RULE_KEY = /^Always allow (?:exact local command|connected service tool) \[(local-shell|local-mcp):v1:([a-f0-9]{64})\]/;

function canonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key] ?? null)).join(",") + "}";
}

function compactRuleText(value: string, max: number): string {
  return redactSandAutoReviewInlineSecrets(value).replace(/\s+/g, " ").trim().slice(0, max);
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
  const summary = compactRuleText(target.command, 220);
  return SHELL_RULE_PREFIX + key + "] on " + location + ": " + summary;
}

// Connected-service (MCP) standing grant, scoped to one server identity + tool name.
// Call arguments are deliberately excluded from the binding: a tool's arguments change
// between calls, and persisting them would freeze one payload into the allow list.
export function localMcpAllowRule(args: SmartModeClassifierArgs): string | undefined {
  if (args.target?.action !== "mcp") return undefined;
  const target = args.target.arguments?.toJson();
  if (target === null || typeof target !== "object" || Array.isArray(target)) return undefined;
  const server = target.server;
  const serverRecord = server !== null && typeof server === "object" && !Array.isArray(server) ? server : null;
  const identifier = typeof serverRecord?.identifier === "string" ? serverRecord.identifier.trim() : "";
  const name = typeof serverRecord?.name === "string" ? serverRecord.name.trim() : "";
  const tool = typeof target.tool_name === "string" ? target.tool_name.trim() : "";
  const identity = identifier || name;
  if (identity.length === 0 || tool.length === 0) return undefined;
  const binding: JsonValue = { server: identity, tool };
  const key = createHash("sha256").update(canonical(binding)).digest("hex");
  const label = name || identity;
  return MCP_RULE_PREFIX + key + "]: Use " + compactRuleText(label, 160) + " tool " + compactRuleText(tool, 160);
}

export function isIsolatedBoxShellTarget(args: SmartModeClassifierArgs): boolean {
  if (args.target?.action !== "shell") return false;
  const target = args.target.arguments?.toJson();
  if (target === null || typeof target !== "object" || Array.isArray(target)) return false;
  return typeof target.command === "string" && target.command.trim().length > 0 && target.surface === "isolated_box";
}

export function matchesLocalAutoReviewRule(expected: string, candidate: string): boolean {
  const expectedKey = RULE_KEY.exec(expected);
  if (expectedKey === null) return false;
  const candidateKey = RULE_KEY.exec(candidate);
  return candidateKey !== null && candidateKey[1] === expectedKey[1] && candidateKey[2] === expectedKey[2];
}

export function hasSavedAutoReviewRule(expected: string, saved: readonly string[]): boolean {
  return saved.some(rule => expected === rule || matchesLocalAutoReviewRule(expected, rule));
}
