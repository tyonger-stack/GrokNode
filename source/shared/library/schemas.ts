import { z } from "zod";

export const canvasIdSchema = z.string().trim().toLowerCase().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-57][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const documentIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/);
export const libraryStoreIdSchema = z.string().min(1).refine(value => !/[\s/\\%?#\u0000-\u001f\u007f]/u.test(value) && value !== "." && value !== "..");
export const originalStoreIdSchema = z.string().regex(/^store-[0-9a-f]{8}-[0-9a-f]{4}-[1-57][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
export const documentAssetNameSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9_-]|\.(?!\.)){0,63}$/);
export const documentLocatorSchema = z.object({ storeId: libraryStoreIdSchema, documentId: documentIdSchema }).strict();
export const canvasLocatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("store"), storeId: libraryStoreIdSchema, canvasId: canvasIdSchema }).strict(),
  z.object({ kind: z.literal("active-user-store"), canvasId: canvasIdSchema }).strict(),
]);
export const libraryPageRefSchema = z.discriminatedUnion("kind", [
  documentLocatorSchema.extend({ kind: z.literal("document") }),
  z.object({ kind: z.literal("canvas"), storeId: libraryStoreIdSchema, canvasId: canvasIdSchema }).strict(),
  z.object({ kind: z.literal("active-user-store-canvas"), canvasId: canvasIdSchema }).strict(),
]);
export const libraryWriteVisibilitySchema = z.enum(["private", "team-view"]);
export const libraryShareSchema = z.object({ visibility: libraryWriteVisibilitySchema, canShareToTeam: z.boolean() }).strict();
const documentArgs = z.object({ locator: documentLocatorSchema }).strict();
const readArgs = documentArgs.extend({ groupChatId: z.string().min(1).optional() });
const canvasArgs = z.object({ locator: canvasLocatorSchema }).strict();
export const libraryArgsSchemas = {
  resolveLibraryPages: z.object({ refs: z.array(libraryPageRefSchema), includeDocuments: z.boolean() }).strict(),
  listLibraryPages: z.object({ includeDocuments: z.boolean() }).strict(),
  listLibraryDocs: z.object({ agentId: z.string().min(1) }).strict(),
  getDocument: readArgs,
  getDocumentEditRight: documentArgs,
  saveDocument: documentArgs.extend({ source: z.string() }),
  setDocumentVisibility: documentArgs.extend({ visibility: libraryWriteVisibilitySchema }),
  getDocumentAssets: readArgs.extend({ names: z.array(z.string()) }),
  getCanvasShare: canvasArgs,
  setCanvasVisibility: canvasArgs.extend({ visibility: libraryWriteVisibilitySchema }),
} as const;
const assetName = z.string();
export const documentAssetSchema = z.discriminatedUnion("status", [
  z.object({ name: assetName, status: z.literal("ready"), bytes: z.instanceof(Uint8Array), contentType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]), etag: z.string().nullable() }).strict(),
  z.object({ name: assetName, status: z.literal("missing") }).strict(),
  z.object({ name: assetName, status: z.literal("failed"), reason: z.string() }).strict(),
  z.object({ name: assetName, status: z.literal("too_large"), sizeBytes: z.number().int().nonnegative() }).strict(),
  z.object({ name: assetName, status: z.literal("not_image") }).strict(),
]);
const pageFields = {
  title: z.string(), createdAtMs: z.number().finite().nullable(), updatedAtMs: z.number().finite().nullable(),
  visibility: z.enum(["private", "team", "public", "unknown"]), canShareToTeam: z.boolean(),
};
export const libraryPageSchema = z.discriminatedUnion("kind", [
  documentLocatorSchema.extend({ kind: z.literal("document"), ...pageFields }),
  z.object({ kind: z.literal("canvas"), storeId: libraryStoreIdSchema, canvasId: canvasIdSchema, ...pageFields }).strict(),
]);
export const libraryResolutionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("found"), ref: libraryPageRefSchema, page: libraryPageSchema }).strict(),
  z.object({ status: z.literal("absent"), ref: libraryPageRefSchema }).strict(),
  z.object({ status: z.literal("failed"), ref: libraryPageRefSchema }).strict(),
]);
export const libraryExternalProviderSchema = z.enum([
  "notion", "google-docs", "google-sheets", "google-slides", "google-drive", "onedrive", "sharepoint",
  "figma", "figjam", "figma-slides", "linear-issue", "linear-document", "confluence-page", "jira-issue",
  "github-file", "github-gist", "github-issue", "slack-canvas", "box", "dropbox", "airtable", "coda", "miro",
  "canva", "hex", "gmail-draft", "google-calendar-event", "slack-message", "github-pull-request", "web", "other",
]);
export const libraryExternalDocSchema = z.object({
  key: z.string().min(1), provider: libraryExternalProviderSchema, externalId: z.string().min(1),
  url: z.string().url().refine(value => new URL(value).protocol === "https:"), title: z.string().nullable(),
  createdByBot: z.boolean(), lastAction: z.enum(["created", "edited"]),
  firstTouchedAtMs: z.number().int().positive().safe(), lastTouchedAtMs: z.number().int().positive().safe(),
}).strict();
export const libraryResultSchemas = {
  resolveLibraryPages: z.array(libraryResolutionSchema),
  listLibraryPages: z.object({ pages: z.array(libraryPageSchema), storeId: libraryStoreIdSchema.nullable(), isComplete: z.boolean(), isDegraded: z.boolean(), listedAtMs: z.number().finite() }).strict(),
  listLibraryDocs: z.object({ docs: z.array(libraryExternalDocSchema), listedAtMs: z.number().finite() }).strict(),
  getDocument: readArgs.extend({ source: z.string(), share: libraryShareSchema.nullable() }),
  getDocumentEditRight: documentArgs.extend({ canEdit: z.boolean() }),
  saveDocument: documentArgs.extend({ title: z.string() }),
  setDocumentVisibility: libraryWriteVisibilitySchema,
  getDocumentAssets: z.object({ assets: z.array(documentAssetSchema) }).strict(),
  getCanvasShare: z.object({ storeId: libraryStoreIdSchema, canvasId: canvasIdSchema, share: libraryShareSchema.nullable() }).strict(),
  setCanvasVisibility: libraryWriteVisibilitySchema,
} as const;
