import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { collectLocalProfileEvidence } from "./local-user-profile-evidence.js";
import { reportHostDiagnostic } from "../../host-diagnostics.js";
import { LOCAL_USER_PROFILE_PROMPT, LOCAL_USER_PROFILE_REPAIR_PROMPT, LOCAL_USER_PROFILE_VERIFY_PROMPT, validateProfileCandidates, acceptReviewedProfileClaims, type LocalProfileClaim } from "./local-user-profile-validation.js";
export { LOCAL_USER_PROFILE_PROMPT, LOCAL_USER_PROFILE_VERIFY_PROMPT } from "./local-user-profile-validation.js";

export const LOCAL_PROFILE_REFRESH_MS = 6 * 60 * 60 * 1000;
const MAX_PROFILE_CHARS = 12_000;
const metadataSchema = z.object({ fingerprint: z.string(), generatedAt: z.number().finite() });

export function localUserProfilePath(sandRoot: string): string { return join(sandRoot, "user-profile", "index.md"); }

function readProfile(sandRoot: string): { content: string; metadata: z.infer<typeof metadataSchema> | null } {
  const path = localUserProfilePath(sandRoot);
  if (!existsSync(path)) return { content: "", metadata: null };
  if (statSync(path).size > 64_000) throw new Error("Local user profile exceeds the size limit");
  const raw = readFileSync(path, "utf8");
  const header = /^<!-- grok-node-user-profile (.+) -->\n/.exec(raw);
  if (header?.[1] === undefined) return { content: raw.slice(0, MAX_PROFILE_CHARS).trim(), metadata: null };
  const metadata = metadataSchema.parse(JSON.parse(header[1]));
  return { content: raw.slice(header[0].length).trim(), metadata };
}

export function readLocalUserProfile(sandRoot: string): string {
  try { return readProfile(sandRoot).content; }
  catch (error) {
    reportHostDiagnostic({ kind: "local_user_profile", outcome: "read-failed", errorClass: error instanceof Error ? error.name : "unknown" });
    return "";
  }
}

function renderProfile(claims: readonly LocalProfileClaim[]): string {
  if (claims.length === 0) return "";
  const lines = ["# Local user profile", "", "Work style inferred from local human conversations. Current user instructions and project rules take precedence."];
  for (const [section, title] of [["workstyle", "Working style and preferences"], ["codebase", "Frequent codebase areas"], ["commands", "Recurring terminal workflows"]] as const) {
    const selected = claims.filter(claim => claim.section === section);
    if (selected.length === 0) continue;
    let sectionWritten = false;
    for (const claim of selected) {
      const citations = claim.sources.map(source => `conversation ${source.conversationId}, message ${source.messageId}`).join("; ");
      const additions = [...(sectionWritten ? [] : ["", `## ${title}`, ""]), `- ${claim.text.replace(/\s+/gu, " ")} (Sources: ${citations})`];
      if ([...lines, ...additions].join("\n").length > MAX_PROFILE_CHARS) continue;
      lines.push(...additions);
      sectionWritten = true;
    }
  }
  const content = lines.join("\n");
  return content;
}

export type LocalProfileOutcome = "updated" | "unchanged" | "insufficient-evidence" | "failed" | "stopped";
export interface LocalUserProfileOptions {
  readonly sandRoot: string;
  readonly agentsRoot: string;
  readonly generate: (system: string, user: string, signal: AbortSignal) => Promise<string>;
  readonly report?: (outcome: LocalProfileOutcome) => void;
  readonly now?: () => number;
}

export class LocalUserProfileService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<LocalProfileOutcome> | undefined;
  private readonly lifetime = new AbortController();
  constructor(private readonly options: LocalUserProfileOptions) {}

  start(): void {
    if (this.timer !== undefined || this.lifetime.signal.aborted) return;
    this.timer = setInterval(() => { void this.refresh(); }, 5 * 60 * 1000);
    this.timer.unref();
    void this.refresh();
  }

  dispose(): void {
    this.lifetime.abort();
    clearInterval(this.timer);
    this.timer = undefined;
  }

  refresh(): Promise<LocalProfileOutcome> {
    if (this.lifetime.signal.aborted) return Promise.resolve("stopped");
    if (this.active !== undefined) return this.active;
    this.active = this.generateProfile().catch((error): LocalProfileOutcome => {
      reportHostDiagnostic({ kind: "local_user_profile", outcome: "generation-failed", errorClass: error instanceof Error ? error.name : "unknown" });
      return this.lifetime.signal.aborted ? "stopped" : "failed";
    }).then(outcome => {
      this.options.report?.(outcome);
      return outcome;
    }).finally(() => { this.active = undefined; });
    return this.active;
  }

  private async generateProfile(): Promise<LocalProfileOutcome> {
    const now = this.options.now?.() ?? Date.now();
    const previous = readProfile(this.options.sandRoot);
    if (previous.metadata !== null && now - previous.metadata.generatedAt < LOCAL_PROFILE_REFRESH_MS) return "unchanged";
    const conversations = collectLocalProfileEvidence(this.options.agentsRoot);
    if (conversations.length === 0) return "insufficient-evidence";
    const user = JSON.stringify({ conversations });
    const fingerprint = createHash("sha256").update(LOCAL_USER_PROFILE_PROMPT).update(LOCAL_USER_PROFILE_REPAIR_PROMPT).update(LOCAL_USER_PROFILE_VERIFY_PROMPT).update(user).digest("hex");
    if (fingerprint === previous.metadata?.fingerprint) return "unchanged";
    const signal = () => AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(90_000)]);
    const generationSignal = signal();
    const raw = await this.options.generate(LOCAL_USER_PROFILE_PROMPT, user, generationSignal);
    if (generationSignal.aborted) return this.lifetime.signal.aborted ? "stopped" : "failed";
    const candidates = validateProfileCandidates(raw, conversations);
    if (candidates.rejectedItems.length > 0) {
      try {
        const repairSignal = signal();
        const repairedRaw = await this.options.generate(LOCAL_USER_PROFILE_REPAIR_PROMPT, JSON.stringify({ rejectedItems: candidates.rejectedItems, conversations }), repairSignal);
        if (repairSignal.aborted) throw new Error("Profile citation repair cancelled");
        const repaired = validateProfileCandidates(repairedRaw, conversations);
        const seen = new Set(candidates.claims.map(claim => claim.text));
        for (const claim of repaired.claims) {
          if (seen.has(claim.text) || candidates.claims.length >= 12) continue;
          seen.add(claim.text);
          candidates.claims.push({ ...claim, id: `repair-${claim.id}` });
        }
      } catch (error) {
        reportHostDiagnostic({ kind: "local_user_profile", outcome: "repair-failed", errorClass: error instanceof Error ? error.name : "unknown" });
      }
    }
    if (candidates.claims.length === 0) return "insufficient-evidence";
    const reviewSignal = signal();
    const review = await this.options.generate(LOCAL_USER_PROFILE_VERIFY_PROMPT, JSON.stringify({ claims: candidates.claims, conversations }), reviewSignal);
    if (reviewSignal.aborted) return this.lifetime.signal.aborted ? "stopped" : "failed";
    const accepted = acceptReviewedProfileClaims(review, candidates.claims, conversations);
    reportHostDiagnostic({ kind: "local_user_profile", outcome: "reviewed", candidates: candidates.claims.length, structuralRejected: candidates.rejected, semanticRejected: candidates.claims.length - accepted.length, accepted: accepted.length });
    if (accepted.length === 0) return "insufficient-evidence";
    const content = renderProfile(accepted);
    const directory = join(this.options.sandRoot, "user-profile");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, `<!-- grok-node-user-profile ${JSON.stringify({ fingerprint, generatedAt: now })} -->\n${content}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temporary, localUserProfilePath(this.options.sandRoot));
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    return "updated";
  }
}
