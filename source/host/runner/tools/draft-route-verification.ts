import { z } from "zod";
import { resolveSlackToLabel } from "./draft-slack-facts.js";
import type { DraftRoute, DraftRouteVerification, DraftCardMessage } from "../../../shared/external-drafts.js";
import { parseDraftConnectorRecord, executeDraftWithDeadline, unreachable, type DraftExecute, type DraftCall } from "./draft-connector.js";

export type DraftVerificationResult = { readonly ok: true; readonly verification: DraftRouteVerification }
  | { readonly ok: false; readonly reason: string };
const address = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const sentThreads = z.object({ threads: z.array(z.object({ messages: z.array(z.object({ sender: z.string(), labelIds: z.array(z.string()) })) })) });
export function parseSentSender(text: string): string | null {
  const data = sentThreads.safeParse(parseDraftConnectorRecord(text));
  if (!data.success) return null;
  for (const thread of data.data.threads) for (const message of thread.messages) {
    const sender = /<([^<>]+)>/.exec(message.sender)?.[1] ?? message.sender.trim();
    if (message.labelIds.includes("SENT") && address.test(sender)) return sender;
  }
  return null;
}
function stringField(text: string, field: string): string | null {
  const value = parseDraftConnectorRecord(text)?.[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}
export function plannedDraftVerificationReads(route: DraftRoute): readonly Omit<DraftCall, "providerIdentifier">[] {
  switch (route.platform) {
    case "email": return [route.mailbox === "outlook" ? { toolName: "get_me", args: {} } : { toolName: "search_threads", args: { query: "in:sent", pageSize: 1 } },
      ...(route.replyToMessageId == null ? [] : [route.mailbox === "outlook"
        ? { toolName: "get_mail_message", args: { messageId: route.replyToMessageId, select: "id,subject,from" } }
        : { toolName: "get_message", args: { messageId: route.replyToMessageId, messageFormat: "MINIMAL" } }])];
    case "slack": return [
      { toolName: "slack_read_channel", args: { channel_id: route.channelId, limit: 1, response_format: "concise" } },
      { toolName: "slack_read_user_profile", args: {} },
      ...(/^U[A-Z0-9]+$/i.test(route.channelId) ? [{ toolName: "slack_read_user_profile", args: { user_id: route.channelId } }] : []),
      ...(route.threadTs == null ? [] : [{ toolName: "slack_read_thread", args: { channel_id: route.channelId, message_ts: route.threadTs, limit: 1, response_format: "detailed" } }]),
    ];
    default: return unreachable(route);
  }
}
export async function resolveDraftRouteVerification(execute: DraftExecute, route: DraftRoute): Promise<DraftVerificationResult> {
  const results: string[] = [];
  for (const read of plannedDraftVerificationReads(route)) {
    const result = await executeDraftWithDeadline(execute, { ...read, providerIdentifier: route.providerIdentifier }, 20_000);
    switch (result.outcome) {
      case "sent": results.push(result.resultText); break;
      case "failed": return { ok: false, reason: result.error };
      case "needs-auth": return { ok: false, reason: `${result.serverName} needs authorization.` };
      case "unconfirmed": return { ok: false, reason: "The connector did not confirm the verification read." };
      default: return unreachable(result);
    }
  }
  const first = results[0] ?? "";
  switch (route.platform) {
    case "email": {
      const sender = route.mailbox === "outlook" ? stringField(first, "mail") ?? stringField(first, "userPrincipalName") : parseSentSender(first);
      if (sender == null || !address.test(sender)) return { ok: false, reason: "The mailbox did not report its sending address." };
      if (route.replyToMessageId == null) return { ok: true, verification: { platform: "email", sendingAddress: sender } };
      const reply = parseDraftConnectorRecord(results[1] ?? "");
      if (reply == null || (typeof reply.id === "string" && reply.id !== route.replyToMessageId)) return { ok: false, reason: "The reply message does not match the requested message." };
      if (route.mailbox === "outlook") {
        if (reply.id !== route.replyToMessageId) return { ok: false, reason: "The reply message id is missing." };
      } else if (typeof reply.subject !== "string" || !reply.subject) return { ok: false, reason: "The reply message subject is missing." };
      const subject = typeof reply.subject === "string" && reply.subject ? reply.subject : "(no subject)";
      const from = z.object({ emailAddress: z.object({ address: z.string() }) }).safeParse(reply.from);
      const replySender = typeof reply.sender === "string" ? reply.sender : from.success ? from.data.emailAddress.address : "";
      return { ok: true, verification: { platform: "email", sendingAddress: sender, replyTo: `“${subject}”${replySender ? ` from ${replySender}` : ""}` } };
    }
    case "slack": {
      const messages = stringField(first, "messages") ?? "";
      const channel = /^Channel:\s*(.+?)\s*\(([^)]+)\)/.exec(messages);
      if (channel?.[1] == null || channel[2] !== route.channelId) return { ok: false, reason: "The connector did not report the requested Slack channel." };
      const profile = stringField(results[1] ?? "", "result") ?? "";
      const organization = /^Organization Name:\s*(.+)$/m.exec(profile)?.[1]?.trim();
      const email = /^Email:\s*(\S+@\S+)$/m.exec(profile)?.[1];
      if (!organization || !email) return { ok: false, reason: "The Slack account identity is incomplete." };
      const partner = /^U[A-Z0-9]+$/i.test(route.channelId) ? stringField(results[2] ?? "", "result") ?? "" : "";
      const channelName = resolveSlackToLabel({ headerName: channel[1], channelId: route.channelId, messages, profile, partnerProfile: partner });
      const verification = { platform: "slack" as const, channelName, workspace: `${organization} (${email})` };
      if (route.threadTs == null) return { ok: true, verification };
      const threadText = stringField(results.at(-1) ?? "", "messages") ?? "";
      const ts = /^Message TS:\s*(\S+)/m.exec(threadText)?.[1];
      const author = /^From:\s*([^<(\n]+)/m.exec(threadText)?.[1]?.trim();
      const body = /^Message TS:[^\n]*\n([\s\S]*)/m.exec(threadText)?.[1]?.trim().split("\n")[0];
      if (ts !== route.threadTs || !author || !body) return { ok: false, reason: "The Slack thread parent could not be verified." };
      return { ok: true, verification: { ...verification, thread: `${author}: ${body}`.slice(0, 80) } };
    }
    default: return unreachable(route);
  }
}
export function sameRouteIdentity(a: DraftRouteVerification, b: DraftRouteVerification): boolean {
  return a.platform === "email" && b.platform === "email" ? a.sendingAddress.toLowerCase() === b.sendingAddress.toLowerCase()
    : a.platform === "slack" && b.platform === "slack" && a.workspace === b.workspace;
}
export function draftMatchesVerification(message: DraftCardMessage, route: DraftRoute, verified: DraftRouteVerification): boolean {
  switch (message.type) {
    case "email-draft": return route.platform === "email" && verified.platform === "email"
      && message.draft.from.toLowerCase() === verified.sendingAddress.toLowerCase()
      && (route.replyToMessageId != null) === (verified.replyTo != null);
    case "slack-draft": return route.platform === "slack" && verified.platform === "slack"
      && message.draft.target === verified.channelName && message.draft.thread === verified.thread
      && (route.threadTs != null) === (verified.thread != null);
    default: return unreachable(message);
  }
}
