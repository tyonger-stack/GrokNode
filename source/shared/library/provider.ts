import type { CanvasLocator, CanvasPayload, LibraryArgs, LibraryMethod, LibraryPageRef, LibraryResult } from "../library-contracts.js";

/** Node-only identity envelope; origin is never discarded when crossing provider boundaries. */
export type LibraryIdentity = { readonly providerOrigin: string; readonly ref: LibraryPageRef };
export type LibraryPrincipal = { readonly accountId: string; readonly principalId: string; readonly teamIds: readonly string[] };
export type LibraryOwner = { readonly accountId: string; readonly principalId: string; readonly storeId: string; readonly teamId: string | null };
/** Supplied by authenticated service/runner code, never parsed from renderer arguments. */
export type LibraryRequestContext = {
  readonly principal: LibraryPrincipal;
  readonly providerOrigin: string;
  readonly signal: AbortSignal;
};
export type LibraryExecutionContext = LibraryRequestContext & {
  readonly agentId: string; readonly storeId: string; readonly toolCallId: string; readonly idempotencyKey: string;
};
/** Node design: the tool can supply content only; IDs/ownership come from the execution layer. */
export type NativePublishInput =
  | { readonly kind: "document"; readonly source: string; readonly assets: readonly { readonly name: string; readonly bytes: Uint8Array }[] }
  | ({ readonly kind: "canvas"; readonly title: string } & CanvasPayload);
export type NativePublishEvent = {
  readonly eventId: string; readonly agentId: string; readonly toolCallId: string;
  readonly identity: LibraryIdentity; readonly url: string; readonly title: string;
};
export type NativePublishOutbox = {
  readonly idempotencyKey: string; readonly owner: LibraryOwner; readonly event: NativePublishEvent;
} & (
  | { readonly status: "pending"; readonly attempts: number }
  | { readonly status: "published"; readonly messageId: string; readonly publishedAtMs: number }
);
export type NativePublishResult = { readonly identity: LibraryIdentity; readonly url: string; readonly title: string; readonly eventId: string };
export type NodeLibraryProvider = {
  readonly [M in LibraryMethod]: (args: LibraryArgs<M>, context: LibraryRequestContext) => Promise<LibraryResult<M>>;
} & {
  getCanvasPayload(args: { readonly locator: CanvasLocator; readonly groupChatId?: string }, context: LibraryRequestContext): Promise<CanvasPayload>;
  publishNativeArtifact(input: NativePublishInput, context: LibraryExecutionContext): Promise<NativePublishResult>;
};
