import type { JsonValue } from "@bufbuild/protobuf";
import type { DraftCardMessage, DraftRoute } from "../../../shared/external-drafts.js";
import { parseDraftConnectorRecord, unreachable, type DraftCall } from "./draft-connector.js";

export interface DraftSendPlan {
  readonly first: DraftCall;
  readonly completion?: (resultText: string) => DraftCall | null;
}
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function proseHtml(text: string): string { return escapeHtml(text).replace(/\n/g, "<br>"); }
function html(body: string): string {
  const text = body.replace(/\r\n?/g, "\n");
  let result = "";
  let cursor = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    let url = match[0];
    while (/[.,;:!?]$/.test(url) || (url.endsWith(")") && url.split(")").length > url.split("(").length)) url = url.slice(0, -1);
    const escaped = escapeHtml(url);
    result += `${proseHtml(text.slice(cursor, match.index))}<a href="${escaped}">${escaped}</a>`;
    cursor = match.index + url.length;
  }
  return `<div dir="auto">${result}${proseHtml(text.slice(cursor))}</div>`;
}
export function buildDraftSendCall(route: DraftRoute, message: DraftCardMessage): DraftSendPlan | null {
  const body = message.draft.body + (message.draft.signature ? `\n\n${message.draft.signature}` : "");
  const providerIdentifier = route.providerIdentifier;
  switch (message.type) {
    case "email-draft": {
      if (route.platform !== "email") return null;
      const outlook = route.mailbox === "outlook";
      const args: Record<string, JsonValue> = { to: [...message.draft.to], subject: message.draft.subject,
        ...(message.draft.cc == null ? {} : { cc: [...message.draft.cc] }),
        ...(outlook ? { body: html(body), bodyType: "html" } : { body, htmlBody: html(body) }) };
      if (route.replyToMessageId == null) return { first: { providerIdentifier, toolName: outlook ? "send_mail" : "send_message", args } };
            // Gmail draft-send guard parity: the finishing call carries draftId alone.
      // The connector sends the saved draft exactly as staged and ignores recipient,
      // subject or body fields mixed into the same call, so they must never be added.
return { first: { providerIdentifier, toolName: "create_draft", args: { ...args, replyToMessageId: route.replyToMessageId } },
        completion: resultText => {
          let id: unknown;
          try { const parsed: unknown = JSON.parse(resultText.trim()); id = typeof parsed === "string" ? parsed : parseDraftConnectorRecord(resultText.trim())?.id; }
          catch (error) { if (error instanceof SyntaxError) return null; throw error; }
          return typeof id === "string" && id.trim() ? { providerIdentifier, toolName: outlook ? "send_draft" : "send_message", args: { draftId: id } } : null;
        } };
    }
    case "slack-draft": return route.platform === "slack" ? { first: { providerIdentifier, toolName: "slack_send_message",
      args: { channel_id: route.channelId, message: body, ...(route.threadTs == null ? {} : { thread_ts: route.threadTs }) } } } : null;
    default: return unreachable(message);
  }
}
