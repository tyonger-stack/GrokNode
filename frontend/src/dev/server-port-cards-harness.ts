import { mountServerPortCard } from "../extensions/server-port-cards-entry";
import { sendDraftRequestSchema } from "../../../source/shared/external-drafts";
import type { TranscriptCardEntry } from "../recovered/features/conversation/cards/transcript-card/protocol";
import { reviewCardClasses } from "../recovered/features/conversation/cards/transcript-card/views/review-card-classes";
import "../recovered/ui/sand-kit-primitives.css";
import "../recovered/features/conversation/cards/transcript-card/server-port-utilities.css";

const stylesheetCandidates = [
  { label: "0.18 packaged renderer + local utility patch", href: "/@fs/Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed/src/app/dist/renderer/assets/index-lCyB53CO.css" },
] as const;

function usedUtilityClasses(): readonly string[] {
  return [...new Set(Object.values(reviewCardClasses).flatMap((value) => value.split(" ")).filter((token) => token.startsWith("sand-")))];
}

function showHarnessStatus(kind: "error" | "warning", message: string): void {
  const host = document.getElementById("cards");
  if (host == null) return;
  const banner = document.createElement("pre");
  banner.style.cssText = "white-space:pre-wrap;padding:12px;border-radius:8px;font:13px/1.5 ui-monospace,monospace;";
  banner.style.background = kind === "error" ? "#fde8e8" : "#fff4d6";
  banner.style.color = kind === "error" ? "#8a1c1c" : "#6b4a00";
  banner.textContent = message;
  host.prepend(banner);
}

async function loadOriginalStylesheet(): Promise<void> {
  const required = usedUtilityClasses();
  const rejected: string[] = [];
  for (const candidate of stylesheetCandidates) {
    const response = await fetch(candidate.href);
    if (!response.ok) { rejected.push(`${candidate.href} -> HTTP ${response.status}`); continue; }
    const text = await response.text();
    const missing = required.filter((name) => !text.includes(`.${name}`) && !name.startsWith("sand-server-port-review"));
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = candidate.href;
    document.head.append(link);
    const patch = await fetch("/src/recovered/features/conversation/cards/transcript-card/server-port-utilities.css").then((r) => r.ok ? r.text() : "");
    const unresolved = missing.filter((name) => !patch.includes(`.${name}`));
    showHarnessStatus(unresolved.length === 0 ? "warning" : "error", `Stylesheet: ${candidate.label}\npatched ${missing.length - unresolved.length}/${missing.length} absent utilities from server-port-utilities.css\ncoverage ${required.length - unresolved.length}/${required.length} utility classes`);
    return;
  }
  showHarnessStatus("error", `No original stylesheet could style these cards.\nRequired utility classes: ${required.length}\nTried:\n${rejected.join("\n")}`);
}

const examples: readonly TranscriptCardEntry[] = [
  {kind: "send-message", id: "email", message: {type: "email-draft", draft: {from: "sender@example.com", to: ["recipient@example.com"], subject: "Review before sending", body: "Example message", signature: "Example signature", attachments: [{id: "sample", name: "report.pdf"}]}}},
  {kind: "send-message", id: "slack", message: {type: "slack-draft", draft: {target: "#example", body: "Example Slack message"}}},
  {kind: "send-message", id: "form", message: {type: "user-form", form: {id: "request", title: "Secure Form", instruction: "Enter the verification code", reason: "auth", domain: "login.example.com", fields: [{id: "code", label: "Verification code", type: "otp", required: true, target: {kind: "ref", value: "e1"}}], submitAfterFill: true}}},
];
const container = document.getElementById("cards");
void loadOriginalStylesheet();
if (container != null) for (const entry of examples) {
  const section = document.createElement("section");
  const host = document.createElement("div");
  section.append(host);
  container.append(section);
  const mount = mountServerPortCard(host, {async call(method, args) {
    if (method === "sendDraft") {
      const request = sendDraftRequestSchema.parse(args);
      queueMicrotask(() => mount.update({...entry, message: request.draft, draftSendState: "sent"}));
      return {accepted: true};
    }
    if (method === "discardDraft") { queueMicrotask(() => mount.update({...entry, draftSendState: "discarded"})); return {accepted: true}; }
    if (method === "submitUserForm") return {status: "submitted"};
    if (method === "dismissUserForm") return {status: "dismissed"};
    throw new TypeError("Unsupported harness method");
  }}, {accountSlot: "local-harness", agentId: "local-harness"}, entry);
  const expire = document.createElement("button");
  expire.textContent = "Simulate expiry";
  expire.addEventListener("click", () => mount.update({...entry, formResolution: "expired"}, true));
  section.append(expire);
  if (entry.message.type === "email-draft" || entry.message.type === "slack-draft") {
    const rollback = document.createElement("button");
    rollback.textContent = "Simulate editable rollback";
    rollback.addEventListener("click", () => mount.update({...entry, draftSendState: "editable"}));
    section.append(rollback);
  }
}
