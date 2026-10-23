import { z } from "zod";

export const visualizationReadArgsSchema = z.object({
  agentId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,511}$/),
  entryId: z.string().min(1).max(512),
  documentSha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const visualizationEntryReferenceSchema = z.object({ id: z.string(), kind: z.literal("send-message"),
  message: z.object({ type: z.literal("visualization"), documentSha256: z.string().regex(/^[0-9a-f]{64}$/) }) });

export interface VisualizationMessage {
  readonly type: "visualization";
  readonly title: string;
  readonly summary: string;
  readonly documentSha256: string;
  readonly heightPx?: number;
  readonly visualId?: string;
  readonly channel?: string;
}

export interface VisualizationRef {
  readonly entryId: string;
  readonly title: string;
  readonly summary: string;
  readonly documentSha256: string;
  readonly heightPx?: number;
  readonly timestampMs: number | null;
}

export interface VisualizationReadArgs {
  readonly agentId: string;
  readonly entryId: string;
  readonly documentSha256: string;
}

export interface VisualizationFragment {
  readonly html: string;
}
