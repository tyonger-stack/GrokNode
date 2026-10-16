import { z } from "zod";
import type { Context } from "../../../packages/context/core.js";
import type { LibraryPrincipal, NativePublishInput, NativePublishResult } from "../../../shared/library-contracts.js";
import { defineCommunicateTool } from "./communicate-tool.js";
import { invariant } from "../../../shared/invariant.js";

/**
 * Task 13d: the model-facing native publication tool (Node design).
 * The model supplies content only. Owner, store, object ids and the
 * idempotency key come from the injected execution plus this call's
 * toolCallId; the host extension re-resolves identity from the
 * credential, so model arguments can never claim another store.
 */
const MAX_PUBLISH_BYTES = 5 * 1024 * 1024;
const base64Bytes = z.string().min(1).refine((value) => {
  try {
    return Buffer.from(value, "base64").byteLength <= MAX_PUBLISH_BYTES;
  } catch {
    return false;
  }
}, "Payload must be base64 within the 5 MiB bound.");
export const publishNativeArtifactParameters = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("document"),
    source: z.string().min(1),
    assets: z.array(z.object({ name: z.string().min(1), dataBase64: base64Bytes })).max(20).optional(),
  }),
  z.object({
    kind: z.literal("canvas"),
    title: z.string().trim().min(1),
    renderBundleGzipBase64: base64Bytes,
    dataJsonBase64: base64Bytes,
  }),
]);
export type PublishNativeArtifactArgs = z.infer<typeof publishNativeArtifactParameters>;
export interface NativeArtifactToolExecution {
  readonly credential: string;
  readonly agentId: string;
  readonly storeId: string;
  readonly toolCallId: string;
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
}
export interface NativeArtifactToolBase {
  readonly agentId: string;
  readonly storeId: string;
  readonly principal: LibraryPrincipal;
  readonly providerOrigin: string;
  readonly credential: string;
}
export interface NativeArtifactToolDependencies {
  publish(input: NativePublishInput, execution: NativeArtifactToolExecution): Promise<NativePublishResult>;
  resolveExecutionBase(): NativeArtifactToolBase;
}
export function createPublishNativeArtifactTool(deps: NativeArtifactToolDependencies) {
  return defineCommunicateTool(deps, {
    id: "PUBLISH_NATIVE_ARTIFACT",
    name: "publish_native_artifact",
    description: "Publish a native library document or canvas the user can reopen from the conversation library. Pass content only: Markdown source (plus optional named image bytes) or a canvas title with its render bundle and data. Ownership and identity come from this run, never from arguments. Always include the returned link in your reply so it lands in the transcript.",
    parameters: publishNativeArtifactParameters,
    async execute(_context: Context, args: PublishNativeArtifactArgs, resolved) {
      const base = resolved.resolveExecutionBase();
      invariant(base.agentId.length > 0, "publish_native_artifact was called outside an agent run.");
      const input: NativePublishInput = args.kind === "document"
        ? {
          kind: "document",
          source: args.source,
          assets: (args.assets ?? []).map((asset) => ({ name: asset.name, bytes: new Uint8Array(Buffer.from(asset.dataBase64, "base64")) })),
        }
        : {
          kind: "canvas",
          title: args.title,
          renderBundleGzip: new Uint8Array(Buffer.from(args.renderBundleGzipBase64, "base64")),
          dataJson: new Uint8Array(Buffer.from(args.dataJsonBase64, "base64")),
        };
      const toolCallId = resolved.toolCallId;
      const result = await resolved.publish(input, {
        credential: base.credential,
        agentId: base.agentId,
        storeId: base.storeId,
        toolCallId,
        idempotencyKey: `native-artifact:${toolCallId}`,
        signal: AbortSignal.timeout(120000),
      });
      return `Published ${args.kind} "${result.title}": ${result.url}`;
    },
  });
}
export interface TurnNativeArtifactToolFactoryInput {
  readonly nativeArtifacts: NativeArtifactToolDependencies;
}
