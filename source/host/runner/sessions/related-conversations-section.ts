import { z } from "zod";
import { resolveRelatedConversationsPromptSection, type RelatedConversationLink } from "./related-conversations-prompt.js";

const snapshotSchema = z.object({ render: z.string(), compactionEpoch: z.number(), announcedRender: z.string().optional() });

export interface PromptSectionSnapshotStore {
  getPromptSectionSnapshot(name: string): unknown;
  setPromptSectionSnapshot(name: string, snapshot: unknown): void;
}

export function promptSectionSnapshotStore(value: unknown): PromptSectionSnapshotStore | null {
  return isStore(value) ? value : null;
}
function isStore(value: unknown): value is PromptSectionSnapshotStore {
  return typeof value === "object" && value !== null && "getPromptSectionSnapshot" in value && typeof value.getPromptSectionSnapshot === "function"
    && "setPromptSectionSnapshot" in value && typeof value.setPromptSectionSnapshot === "function";
}

export function createRelatedConversationsSection(input: {
  readonly related: () => readonly RelatedConversationLink[] | undefined;
  readonly compactionEpoch: () => number;
  readonly snapshots: () => PromptSectionSnapshotStore | null;
}) {
  let fallback: z.infer<typeof snapshotSchema> | null = null;
  function resolve() {
    const store = input.snapshots();
    const parsed = snapshotSchema.safeParse(store === null ? fallback : store.getPromptSectionSnapshot("related_conversations"));
    const result = resolveRelatedConversationsPromptSection({ snapshot: parsed.success ? parsed.data : null,
      compactionEpoch: input.compactionEpoch(), live: input.related() });
    if (result.snapshotToPersist !== undefined) {
      fallback = result.snapshotToPersist;
      store?.setPromptSectionSnapshot("related_conversations", result.snapshotToPersist);
    }
    return result;
  }
  return {
    render: () => resolve().render,
    appendUpdates(messages: readonly unknown[]): readonly unknown[] {
      const update = resolve().update;
      if (update === undefined) return messages;
      // Same contract as frozen prompt updates: return a plain message. The history modifier
      // redacts the returned array, and a pre-redacted note makes that pass throw.
      const note = {
        role: "user" as const,
        content: `<instructions_update>\nThese instructions changed since the copy above was rendered and replace that section until your context is next summarized.\n\n## Related conversations\n${update.live}\n</instructions_update>`,
        providerOptions: { cursor: { isInjectedReminder: true } },
      };
      fallback = update.snapshotToPersist;
      input.snapshots()?.setPromptSectionSnapshot("related_conversations", update.snapshotToPersist);
      return [...messages, note];
    },
  };
}
