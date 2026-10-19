import { draftExternalMessageParameters, type DraftEmission, type DraftExternalMessageArgs } from "../../../shared/external-drafts.js";
import { defineCommunicateTool } from "./communicate-tool.js";
import { unreachable, type DraftExecute } from "./draft-connector.js";
import { resolveDraftRouteVerification } from "./draft-route-verification.js";

export interface DraftToolDependencies {
  readonly execute: DraftExecute;
  readonly emitDraft: (emission: DraftEmission) => Promise<string>;
}
export class DraftRefusedError extends Error {
  readonly category = "route_unverified";
}
export const SAND_DRAFT_EXTERNAL_MESSAGE_TOOL_NAME = "DraftExternalMessage";
export async function emitExternalDraft(args: DraftExternalMessageArgs, deps: DraftToolDependencies): Promise<string> {
  let emission: Omit<DraftEmission, "verification">;
  switch (args.platform) {
    case "email": {
      const { platform, providerIdentifier, mailbox, replyToMessageId, ...draft } = args;
      emission = { message: { type: "email-draft", draft }, route: { platform, providerIdentifier,
        ...(mailbox == null ? {} : { mailbox }), ...(replyToMessageId == null ? {} : { replyToMessageId }) } };
      break;
    }
    case "slack": {
      const { platform, providerIdentifier, channelId, threadTs, ...draft } = args;
      emission = { message: { type: "slack-draft", draft }, route: { platform, providerIdentifier, channelId, ...(threadTs == null ? {} : { threadTs }) } };
      break;
    }
    default: return unreachable(args);
  }
  const resolution = await resolveDraftRouteVerification(deps.execute, emission.route);
  if (!resolution.ok) throw new DraftRefusedError(`Draft refused: ${resolution.reason} Nothing was drafted.`);
  const verification = resolution.verification;
  switch (emission.message.type) {
    case "email-draft":
      if (verification.platform !== "email" || emission.message.draft.from.toLowerCase() !== verification.sendingAddress.toLowerCase()) throw new DraftRefusedError("Draft refused: from does not match the connected account.");
      break;
    case "slack-draft":
      if (verification.platform !== "slack") throw new DraftRefusedError("Draft refused: route platform mismatch.");
      emission = { ...emission, message: { type: "slack-draft", draft: { ...emission.message.draft, target: verification.channelName, ...(verification.thread == null ? {} : { thread: verification.thread }) } } };
      break;
    default: return unreachable(emission.message);
  }
  const id = await deps.emitDraft({ ...emission, verification });
  if (!id.trim()) throw new DraftRefusedError("The draft was not confirmed saved.");
  return `Draft is now an editable card in the chat (id: ${id}). Nothing has been sent. The user can edit, send or discard it. Do not send it again through a connector.`;
}
export function createDraftExternalMessageTool(deps: DraftToolDependencies) {
  return defineCommunicateTool(deps, {
    id: "SEND_TO_USER", name: SAND_DRAFT_EXTERNAL_MESSAGE_TOOL_NAME,
    description: "Draft an email or Slack message as an editable review card. This baseline has no automatic signature or send-as alias lookup. Never invent a signature or claim a configured signature was loaded; signature is a user-edit-only card field. Resolve the real installed providerIdentifier, sending address, channel and reply/thread id first. Routing is verified before saving. Nothing is sent until the user clicks Send. Never follow this with connector send/draft tools for the same message. A discard is a decline; do not redraft unasked. To save a mailbox draft instead, use the connector create_draft tool.",
    parameters: draftExternalMessageParameters,
    execute: async (_ctx, args: DraftExternalMessageArgs, runtime) => emitExternalDraft(args, runtime),
  });
}
