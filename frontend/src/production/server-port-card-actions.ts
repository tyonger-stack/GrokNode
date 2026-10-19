import { z } from "zod";
import { draftSendStateSchema, sendDraftRequestSchema, type SendDraftRequest, type DraftKey, type DraftSendState } from "../../../source/shared/external-drafts";
import type { ProductionCoordinatorClient } from "./coordinator-client";

export interface UserFormKey { readonly agentId: string; readonly requestId: string; }
export interface ServerPortCardActions {
  sendDraft(input: SendDraftRequest): Promise<DraftSendState>;
  discardDraft(input: DraftKey): Promise<DraftSendState>;
  submitUserForm(input: UserFormKey & { readonly values: Record<string, string | boolean> }): Promise<string>;
  dismissUserForm(input: UserFormKey): Promise<string>;
}
const draftReply = z.object({ accepted: z.boolean(), state: draftSendStateSchema.optional() });
const formReply = z.object({ status: z.enum(["submitted", "dismissed", "expired", "stopped", "turn_ended", "unavailable", "invalid_values"]), fields: z.array(z.object({id: z.string(), status: z.enum(["filled", "not_filled", "failed"])})).optional(), submit: z.object({attempted: z.boolean(), succeeded: z.boolean().optional()}).optional() });
function draftState(reply: unknown): DraftSendState {
  const parsed = draftReply.parse(reply);
  if (!parsed.accepted) return "editable";
  return parsed.state ?? "sending";
}
export function createServerPortCardActions(client: Pick<ProductionCoordinatorClient, "call">): ServerPortCardActions {
  return {
    async sendDraft(input) { return draftState(await client.call("sendDraft", sendDraftRequestSchema.parse(input))); },
    async discardDraft(input) { return draftState(await client.call("discardDraft", input)); },
    async submitUserForm(input) {
      const receipt = formReply.parse(await client.call("submitUserForm", input));
      return receipt.fields?.some((field) => field.status !== "filled") || (receipt.submit?.attempted && receipt.submit.succeeded !== true) ? "fill_failed" : receipt.status;
    },
    async dismissUserForm(input) { return formReply.parse(await client.call("dismissUserForm", input)).status; },
  };
}
