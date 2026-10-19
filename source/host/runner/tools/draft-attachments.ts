import { Ajv } from "ajv";
import type { JsonValue } from "@bufbuild/protobuf";
import type { DraftAttachment } from "../../../shared/external-drafts.js";
import type { DraftCall } from "./draft-connector.js";

export interface DraftAttachmentTool {
  readonly providerIdentifier: string;
  readonly toolName: string;
  // Unknown at the boundary: the preparer narrows and compiles it before trusting anything.
  readonly inputSchema: unknown;
}
export interface ResolvedDraftAttachment {
  readonly id: string;
  readonly name: string;
  readonly providerIdentifier: string;
  readonly value: JsonValue;
}
export interface DraftAttachmentDependencies {
  readonly listTools: () => Promise<readonly DraftAttachmentTool[]>;
  /** Bind this resolver to the authenticated agent; never interpret an untrusted ID as a disk path. */
  readonly resolveAttachment: (request: {
    readonly providerIdentifier: string;
    // Distinguishes send/create schemas under one provider; the resolver must
    // honor the exact schema of this tool, never a neighboring one.
    readonly toolName: string;
    readonly id: string;
  }) => Promise<ResolvedDraftAttachment | null>;
}
export type PreparedDraftAttachments = { readonly ok: true; readonly attachments: JsonValue }
  | { readonly ok: false; readonly error: string };
function object(value: unknown): value is Record<string, JsonValue> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
export function createDraftAttachmentPreparer(deps: DraftAttachmentDependencies) {
  return async (call: DraftCall, attachments: readonly DraftAttachment[]): Promise<PreparedDraftAttachments> => {
    const tools = (await deps.listTools()).filter(tool => tool.providerIdentifier === call.providerIdentifier && tool.toolName === call.toolName);
    const tool = tools[0];
    if (tools.length !== 1 || tool == null) return { ok: false, error: "The exact connector tool and account could not be resolved." };
    if (!object(tool.inputSchema)) return { ok: false, error: "The connector schema is not a readable object." };
    const properties = tool.inputSchema.properties;
    if (!object(properties) || !object(properties.attachments) || properties.attachments.type !== "array") {
      return { ok: false, error: "The connector schema does not explicitly support an attachments array." };
    }
    if (call.args.draftId != null) return { ok: false, error: "Attachments cannot override an already staged draft." };
    const ids = new Set<string>();
    const values: JsonValue[] = [];
    for (const attachment of attachments) {
      if (ids.has(attachment.id)) return { ok: false, error: "Duplicate attachment ID." };
      ids.add(attachment.id);
      const resolved = await deps.resolveAttachment({ providerIdentifier: call.providerIdentifier, toolName: call.toolName, id: attachment.id });
      if (resolved == null || resolved.id !== attachment.id || resolved.name !== attachment.name || resolved.providerIdentifier !== call.providerIdentifier) {
        return { ok: false, error: "Attachment ID, name or account is not authorized for this send." };
      }
      values.push(resolved.value);
    }
    try {
      const ajv = new Ajv({ strict: true, strictTypes: false, strictTuples: false, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
      const validate = ajv.compile(tool.inputSchema);
      if (!validate({ ...call.args, attachments: values })) return { ok: false, error: "Final attachment arguments do not satisfy the discovered connector schema." };
    } catch (error) {
      if (error instanceof Error) return { ok: false, error: "The connector schema could not be compiled safely." };
      throw error;
    }
    return { ok: true, attachments: values };
  };
}
