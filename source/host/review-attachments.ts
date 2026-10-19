import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import mime from "mime-types";
import { z } from "zod";
import type { JsonValue } from "@bufbuild/protobuf";
import type { ReviewTranscriptStore } from "./extensions/transcript/review-transcript-store.js";
import { readOwnedMediaBytes } from "./extensions/attachments/attachments-service.js";
import { bindReviewMcp } from "./review-mcp-execution.js";
import type { DraftAttachmentDependencies } from "./runner/tools/draft-attachments.js";

const json: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(json), z.record(json)]));
const descriptorSchema = z.array(z.object({ providerIdentifier: z.string(), toolName: z.string(), inputSchema: z.record(json) }));
const object = (value: JsonValue | undefined): value is Record<string, JsonValue> => value !== null && typeof value === "object" && !Array.isArray(value);
function dereference(schema: Record<string, JsonValue>, root: Record<string, JsonValue>): Record<string, JsonValue> | null {
  if (typeof schema.$ref !== "string") return schema;
  if (!schema.$ref.startsWith("#/")) return null;
  let cursor: JsonValue | undefined = root;
  for (const key of schema.$ref.slice(2).split("/").map(key => key.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (!object(cursor) || ["__proto__", "prototype", "constructor"].includes(key)) return null;
    cursor = cursor[key];
  }
  return object(cursor) ? cursor : null;
}
function attachmentValue(schema: Record<string, JsonValue>, bytes: Uint8Array, filename: string): JsonValue | null {
  const properties = schema.properties;
  if (!object(properties)) return null;
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
  const result: Record<string, JsonValue> = {};
  let containsBytes = false;
  for (const [name, property] of Object.entries(properties)) {
    if (!object(property)) continue;
    const key = name.replace(/_/g, "").toLowerCase();
    if (["filename", "name"].includes(key)) result[name] = filename;
    else if (["mimetype", "contenttype"].includes(key)) result[name] = mime.lookup(filename) || "application/octet-stream";
    else if (key === "contentbytes" || ["data", "content", "base64content", "base64"].includes(key)
      && (key.startsWith("base64") || property.contentEncoding === "base64" || property.format === "byte" || typeof property.description === "string" && /base64/i.test(property.description))) {
      result[name] = Buffer.from(bytes).toString("base64");
      containsBytes = true;
    }
  }
  return containsBytes && required.every(key => Object.hasOwn(result, key)) ? result : null;
}

export type ReviewAttachmentResolver = (request: Parameters<DraftAttachmentDependencies["resolveAttachment"]>[0] & { readonly agentId: string }) => ReturnType<DraftAttachmentDependencies["resolveAttachment"]>;
export function createReviewAttachmentResolver(transcripts: ReviewTranscriptStore, mcp: unknown): ReviewAttachmentResolver {
  return async request => {
    const session = await transcripts.open(request.agentId);
    const entry = session.readEntries().find(entry => entry.id === request.id);
    if (entry === undefined) return null;
    let path: unknown = entry.kind === "user-attachment" ? entry.file_path : undefined;
    if (path === undefined && typeof entry.message === "object" && entry.message !== null && "type" in entry.message
      && entry.message.type === "attachment" && "url" in entry.message) path = entry.message.url;
    if (typeof path !== "string") return null;
    if (path.startsWith("file:")) {
      try { path = fileURLToPath(path); } catch (error) { if (error instanceof TypeError) return null; throw error; }
    }
    if (typeof path !== "string") return null;
    const filename = typeof entry.file_name === "string" ? entry.file_name : basename(path);
    if (filename !== basename(filename) || /[\0\r\n]/.test(filename)) return null;
    const binding = bindReviewMcp(mcp, request.agentId);
    if (binding === null) return null;
    const tools = descriptorSchema.safeParse(await binding.listTools());
    if (!tools.success) return null;
    const tool = tools.data.find(tool => tool.providerIdentifier === request.providerIdentifier && tool.toolName === request.toolName);
    if (tool === undefined || !object(tool.inputSchema.properties)) return null;
    const attachmentSchema = tool.inputSchema.properties.attachments;
    if (!object(attachmentSchema) || !object(attachmentSchema.items)) return null;
    const itemSchema = dereference(attachmentSchema.items, tool.inputSchema);
    if (itemSchema === null) return null;
    const owned = await readOwnedMediaBytes(session.directory, path);
    if (owned === null || owned.bytes.byteLength > 32 * 1024 * 1024) return null;
    const value = attachmentValue(itemSchema, owned.bytes, filename);
    return value === null ? null : { id: request.id, name: filename, providerIdentifier: request.providerIdentifier, value };
  };
}
