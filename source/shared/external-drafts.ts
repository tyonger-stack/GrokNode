import { z } from "zod";

const text = z.string().trim().min(1);
const address = text.regex(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/, "Expected a plain email address");
export const draftAttachmentSchema = z.object({ id: text, name: text }).strict();
export type DraftAttachment = Readonly<z.infer<typeof draftAttachmentSchema>>;
const content = { body: z.string().min(1), signature: z.string().optional(), attachments: z.array(draftAttachmentSchema).optional() };
// A single string recipient is wrapped, mirroring the boundary of the formal lenient array path.
// Only boundary wrap is mirrored; markup-leak repair stays formal-side and is not reimplemented here.
const requiredAddressList = z.preprocess((value: unknown) => typeof value === "string" ? [value] : value, z.array(address).min(1));
const optionalAddressList = z.preprocess((value: unknown) => typeof value === "string" ? [value] : value, z.array(address).optional());
export const emailDraftSchema = z.object({ from: address, to: requiredAddressList, cc: optionalAddressList, subject: text, ...content }).strict();
export const slackDraftSchema = z.object({ target: text, thread: z.string().optional(), ...content }).strict();
export const draftCardMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("email-draft"), draft: emailDraftSchema }).strict(),
  z.object({ type: z.literal("slack-draft"), draft: slackDraftSchema }).strict(),
]);
export type DraftCardMessage = Readonly<z.infer<typeof draftCardMessageSchema>>;
export const draftSendStateSchema = z.enum(["editable", "sending", "sent", "discarded", "unconfirmed", "draft-created"]);
export type DraftSendState = z.infer<typeof draftSendStateSchema>;
const key = { agentId: text, entryId: text };
export const sendDraftRequestSchema = z.object({ ...key, draft: draftCardMessageSchema }).strict();
export const discardDraftRequestSchema = z.object(key).strict();
export type SendDraftRequest = Readonly<z.infer<typeof sendDraftRequestSchema>>;
export type DraftKey = Readonly<z.infer<typeof discardDraftRequestSchema>>;
export const draftRouteSchema = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("email"), providerIdentifier: text, mailbox: z.enum(["gmail", "outlook"]).optional(), replyToMessageId: text.optional() }).strict(),
  z.object({ platform: z.literal("slack"), providerIdentifier: text, channelId: text, threadTs: text.optional() }).strict(),
]);
export type DraftRoute = Readonly<z.infer<typeof draftRouteSchema>>;
export const draftRouteVerificationSchema = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("email"), sendingAddress: address, replyTo: text.optional() }).strict(),
  z.object({ platform: z.literal("slack"), channelName: text, workspace: text, thread: text.optional() }).strict(),
]);
export type DraftRouteVerification = Readonly<z.infer<typeof draftRouteVerificationSchema>>;
export interface DraftEmission {
  readonly message: DraftCardMessage;
  readonly route: DraftRoute;
  readonly verification: DraftRouteVerification;
}
export interface DraftEntry extends DraftKey, DraftEmission {
  readonly state: DraftSendState;
  readonly revision: number;
}
export const draftExternalMessageParameters = z.discriminatedUnion("platform", [
  emailDraftSchema.omit({ signature: true }).extend({ platform: z.literal("email"), providerIdentifier: text, mailbox: z.enum(["gmail", "outlook"]).optional(), replyToMessageId: text.optional() }).strict(),
  slackDraftSchema.omit({ thread: true, signature: true }).extend({ platform: z.literal("slack"), providerIdentifier: text, channelId: text, threadTs: text.optional() }).strict(),
]).superRefine((value, ctx) => {
  if (value.platform === "email" && /<\/(?:p|div|li|ul|ol|strong|b|em|i|span|a|h[1-6])\s*>|<br\s*\/?>/i.test(value.body)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["body"], message: "Email body must be plain text, not HTML." });
  }
});
export type DraftExternalMessageArgs = z.infer<typeof draftExternalMessageParameters>;
