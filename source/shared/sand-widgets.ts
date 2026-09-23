import { z } from "zod";

export const widgetActionStyleSchema = z.enum(["default", "primary", "danger"]);

export const choiceOptionSchema = z.object({
  label: z.string().trim().min(1),
  value: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Text sent back to you when this option is picked. Defaults to the label. Make it read like something the user would naturally say in reply.",
    ),
  description: z.string().trim().min(1).optional(),
  style: widgetActionStyleSchema.optional(),
});

function tryParseJsonValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.length < 2) return value;
  const first = trimmed[0];
  if (first !== "{" && first !== "[") return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

// Some providers / proxies occasionally deliver a nested object as a JSON-encoded
// string (double-encoding), or an option as a bare label string. Coerce those
// shapes back before validation so a widget question does not fail with
// "Expected object, received string" and force the model into a text fallback.
export const choiceOptionInputSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const parsed = tryParseJsonValue(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed;
    return { label: value };
  }
  return value;
}, choiceOptionSchema);

export const sandWidgetSchema = z.object({
  prompt: z.string().trim().min(1),
  helpText: z.string().trim().min(1).optional(),
  options: z.array(choiceOptionInputSchema).min(1).max(6),
  allowCustom: z
    .boolean()
    .optional()
    .describe(
      "When true, the user can type a custom free-text answer instead of choosing one of the options.",
    ),
  dismissOnMoveOn: z
    .boolean()
    .optional()
    .describe(
      "When true, this widget auto-dismisses (becomes inert, shows a muted Dismissed state) once the user sends a newer message without answering it. Omit/false to keep the question live and answerable indefinitely. Set true only for low-stakes questions that become moot if the user moves on; keep it off for real decisions you still need answered.",
    ),
});

// Input-side schema for SendMessage: accepts the strict object shape, plus a
// JSON-encoded string of that object (double-encoded by some model gateways).
// Plain non-JSON strings still fail validation, so the model gets a clear error
// instead of silently dropping the card.
export const sandWidgetInputSchema = z.preprocess((value) => {
  if (typeof value === "string") return tryParseJsonValue(value);
  return value;
}, sandWidgetSchema);

export type SandWidget = z.infer<typeof sandWidgetSchema>;

interface WidgetLike {
  readonly prompt?: unknown;
  readonly options?: unknown;
}

export function summarizeWidget(widget: WidgetLike): string {
  const prompt = typeof widget.prompt === "string" ? widget.prompt : "Question";
  const options = Array.isArray(widget.options)
    ? (widget.options as { readonly label?: unknown; readonly value?: unknown }[])
    : [];
  const labels = options.map((option) => option.label).join(" / ");
  return labels.length > 0 ? `${prompt} — ${labels}` : prompt;
}

export function getWidgetAnswerLabel(widget: WidgetLike, answer: string): string {
  const options = Array.isArray(widget.options)
    ? (widget.options as { readonly label?: string; readonly value?: string }[])
    : [];
  const match = options.find((option) => (option.value ?? option.label) === answer);
  return match?.label ?? answer;
}
