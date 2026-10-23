import { z } from "zod";
import { visualizationReadArgsSchema } from "../visualization.js";

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
const timestampMs = z.number().int().nonnegative().safe().nullable();
const source = z.string().min(1).max(8192);
const media = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link"), url: source, timestampMs }).strict(),
  ...(["image", "video", "file"] as const).map((kind) =>
    z.object({ kind: z.literal(kind), source, name: z.string().min(1).max(1024), timestampMs }).strict()),
]);
const page = z.discriminatedUnion("kind", [
  documentLocatorSchema.extend({ kind: z.literal("document") }),
  z.object({ kind: z.literal("canvas"), storeId: libraryStoreIdSchema, canvasId: canvasIdSchema }).strict(),
]);
export const libraryPinSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), page }).strict(),
  z.object({ kind: z.literal("media"), media }).strict(),
  z.object({ kind: z.literal("external-doc"), key: z.string().min(1).max(8192) }).strict(),
  z.object({ kind: z.literal("app"), key: z.string().min(1).max(8192) }).strict(),
]);
const localIdentifier = z.string().min(1).max(512).refine(value => !/[\x00-\x1f]/.test(value));
const localTeamRoleSchema = z.enum(["owner", "admin", "member"]);
export const localTeamSchema = z.object({ teamId: localIdentifier, name: z.string(), role: localTeamRoleSchema }).strict();
export const localTeamMemberSchema = z.object({ accountId: localIdentifier, principalId: localIdentifier, role: localTeamRoleSchema }).strict();
export const localAccessGrantSchema = z.object({
  kind: z.enum(["agent", "store"]), id: localIdentifier,
  recipient: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("person"), accountId: localIdentifier, principalId: localIdentifier }).strict(),
    z.object({ kind: z.literal("team"), teamId: localIdentifier }).strict(),
  ]),
  expiresAtMs: z.number().int().positive().safe().nullable(),
  actions: z.array(z.enum(["view", "use", "create-automation"])).min(1).max(3),
}).strict();
const pinArgs = z.object({ agentId: localIdentifier }).strict();
const documentArgs = z.object({ locator: documentLocatorSchema }).strict();
const readArgs = documentArgs.extend({ groupChatId: z.string().min(1).optional() });
const canvasArgs = z.object({ locator: canvasLocatorSchema }).strict();
export const libraryArgsSchemas = {
  listLibraryPins: pinArgs,
  setLibraryPin: pinArgs.extend({ pin: libraryPinSchema, isPinned: z.boolean() }),
  mergeLibraryPins: pinArgs.extend({ pins: z.array(libraryPinSchema).max(1000) }),
  readVisualizationFragment: visualizationReadArgsSchema,
  listLocalTeams: z.object({}).strict(),
  checkLocalTeamAccess: z.object({ teamId: localIdentifier, action: z.enum(["view", "manage"]) }).strict(),
  createLocalTeam: z.object({ name: z.string().trim().min(1).max(120) }).strict(),
  listLocalTeamMembers: z.object({ teamId: localIdentifier }).strict(),
  setLocalTeamMember: z.object({ teamId: localIdentifier, accountId: localIdentifier, principalId: localIdentifier,
    role: z.enum(["admin", "member"]).nullable() }).strict(),
  getLocalAgentAccess: z.object({ agentId: localIdentifier }).strict(),
  setLocalAccessGrant: z.object({ grant: localAccessGrantSchema, enabled: z.boolean() }).strict(),
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
  listLibraryPins: z.array(libraryPinSchema),
  setLibraryPin: z.array(libraryPinSchema),
  mergeLibraryPins: z.array(libraryPinSchema),
  readVisualizationFragment: z.object({ html: z.string() }).strict(),
  listLocalTeams: z.array(localTeamSchema),
  checkLocalTeamAccess: z.object({ authorized: z.literal(true) }).strict(),
  createLocalTeam: localTeamSchema.extend({ role: z.literal("owner") }),
  listLocalTeamMembers: z.array(localTeamMemberSchema),
  setLocalTeamMember: z.void(),
  getLocalAgentAccess: z.array(localAccessGrantSchema),
  setLocalAccessGrant: z.array(localAccessGrantSchema),
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

export const libraryHttpEnvelopeSchema = z.object({
  method: z.object(libraryArgsSchemas).keyof(),
  args: z.unknown(),
}).strict();
