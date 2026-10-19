import { z } from "zod";

export const userFormTargetSchema = z.object({ kind: z.enum(["ref", "selector", "label"]), value: z.string().trim().min(1) }).strict();
export const userFormFieldSchema = z.object({
  id: z.string().trim().min(1).max(64), label: z.string().trim().min(1).max(120),
  type: z.enum(["text", "email", "tel", "password", "otp", "number", "date", "select", "textarea", "checkbox"]),
  required: z.boolean().optional(), placeholder: z.string().max(120).optional(),
  options: z.array(z.object({ label: z.string().min(1), value: z.string().min(1) }).strict()).max(20).optional(),
  secret: z.boolean().optional(), target: userFormTargetSchema.optional(),
}).strict();
export function normalizeUserFormDomain(raw: string): string | undefined {
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch { return undefined; }
}
export const requestUserFormParameters = z.object({
  title: z.string().trim().min(1).max(120), instruction: z.string().trim().min(1).max(400),
  reason: z.enum(["auth", "checkout", "profile", "other"]), domain: z.string().trim().min(1).optional(),
  fields: z.array(userFormFieldSchema).min(1).max(8), submitAfterFill: z.boolean().optional(),
}).strict().superRefine((form, ctx) => {
  const domain = form.domain === undefined ? undefined : normalizeUserFormDomain(form.domain);
  if (form.domain !== undefined && domain === undefined) ctx.addIssue({ code: "custom", message: "Invalid domain" });
  if (new Set(form.fields.map(field => field.id)).size !== form.fields.length) ctx.addIssue({ code: "custom", message: "Duplicate field IDs" });
  for (const field of form.fields) {
    if ((isSecretUserFormField(field) || field.target) && !domain) ctx.addIssue({ code: "custom", message: "Verified destination required" });
    if (isSecretUserFormField(field) && !field.target) ctx.addIssue({ code: "custom", message: "Secret target required" });
    if (field.type === "select" && !field.options?.length) ctx.addIssue({ code: "custom", message: "Select options required" });
  }
  if (form.submitAfterFill && (form.fields.length !== 1 || form.fields[0]?.type !== "otp" || !form.fields[0].target || !domain || /card|cvv|ssn|iban|passport|government|routing/i.test(`${form.fields[0].id} ${form.fields[0].label}`))) {
    ctx.addIssue({ code: "custom", message: "Enter submission requires a single targeted OTP field" });
  }
});
export type UserFormField = z.infer<typeof userFormFieldSchema>;
export type UserFormRequest = z.infer<typeof requestUserFormParameters>;
export type UserForm = UserFormRequest & { readonly id: string };
export type UserFormMessage = { readonly type: "user-form"; readonly form: UserForm };
export function isSecretUserFormField(field: UserFormField): boolean { return field.secret === true || field.type === "password" || field.type === "otp"; }
export const submitUserFormRequestSchema = z.object({ agentId: z.string().min(1), requestId: z.string().min(1), values: z.record(z.string(), z.union([z.string(), z.boolean()])) }).strict();
export const dismissUserFormRequestSchema = z.object({ agentId: z.string().min(1), requestId: z.string().min(1) }).strict();
export const remapUserFormTargetsParameters = z.object({ targets: z.array(z.object({ fieldId: z.string().min(1), target: userFormTargetSchema }).strict()).min(1).max(8) }).strict();
export type UserFormFailure = "driver_unavailable" | "page_moved" | "domain_mismatch" | "stale_locator" | "fill_failed";
export type UserFormFieldOutcome = { readonly id: string; readonly status: "filled" | "not_filled" | "failed"; readonly reason?: UserFormFailure };
export type UserFormReceipt = {
  readonly requestId: string;
  readonly status: "shown" | "submitted" | "dismissed" | "expired" | "stopped" | "turn_ended" | "unavailable" | "invalid_values" | "remapped";
  readonly fields?: readonly UserFormFieldOutcome[];
  readonly remapFieldIds?: readonly string[];
  readonly submit?: { readonly attempted: boolean; readonly succeeded?: boolean };
};
