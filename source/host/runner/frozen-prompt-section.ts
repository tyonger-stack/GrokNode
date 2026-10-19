import { z } from "zod";
import { toRedactedCoreMessage } from "../../packages/redaction/core-message.js";
import type { PromptSectionSnapshotStore } from "./sessions/related-conversations-section.js";

export const FROZEN_PROMPT_SECTION_NAMES = ["timezone", "automations", "agent_directory", "mcp_instructions"] as const;
export type FrozenPromptSectionName = (typeof FROZEN_PROMPT_SECTION_NAMES)[number];
const snapshotSchema = z.object({ render: z.string(), compactionEpoch: z.number().finite(), announcedRender: z.string().optional() });
const privacySchema = z.object({ _privacyMode: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) });
const labels = { timezone: "Time", automations: "Routines", agent_directory: "Teammates and groups", mcp_instructions: "Connector instructions" } as const;
interface SectionUpdate { readonly name: FrozenPromptSectionName; readonly previous: string; readonly live: string }

function changedLines(before: string, after: string): string[] | null {
  const a = before.split("\n"), b = after.split("\n");
  if (a.length * b.length > 250_000) return null;
  const matrix = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  const at = (i: number, j: number) => matrix[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    const row = matrix[i];
    if (row === undefined) continue;
    for (let j = b.length - 1; j >= 0; j--) row[j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
  }
  const edits: string[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; }
    else if (at(i + 1, j) >= at(i, j + 1)) { edits.push(`- ${a[i] ?? ""}`); i++; }
    else { edits.push(`+ ${b[j] ?? ""}`); j++; }
  }
  for (; i < a.length; i++) edits.push(`- ${a[i] ?? ""}`);
  for (; j < b.length; j++) edits.push(`+ ${b[j] ?? ""}`);
  return edits.length < b.length ? edits : null;
}
function updateText(update: SectionUpdate): string {
  const label = labels[update.name];
  if (update.live.length === 0) return `## ${label}\n(This section is now empty.)`;
  const diff = update.previous.length === 0 ? null : changedLines(update.previous, update.live);
  return diff === null ? `## ${label}\n${update.live}` : `## ${label} (changed lines only)\n${diff.join("\n")}`;
}

export function createFrozenPromptSections(input: {
  readonly snapshots: () => PromptSectionSnapshotStore | null;
  readonly compactionEpoch: () => number;
  readonly renderers: Readonly<Record<FrozenPromptSectionName, () => string | null>>;
  readonly enabled: () => boolean;
}) {
  const fallback = new Map<FrozenPromptSectionName, z.infer<typeof snapshotSchema>>();
  const read = (name: FrozenPromptSectionName) => {
    const store = input.snapshots();
    const parsed = snapshotSchema.safeParse(store === null ? fallback.get(name) : store.getPromptSectionSnapshot(name));
    return parsed.success ? parsed.data : null;
  };
  const save = (name: FrozenPromptSectionName, snapshot: z.infer<typeof snapshotSchema>) => {
    fallback.set(name, snapshot); input.snapshots()?.setPromptSectionSnapshot(name, snapshot);
  };
  function render(name: FrozenPromptSectionName): string | null {
    if (!input.enabled()) return input.renderers[name]();
    const snapshot = read(name), epoch = input.compactionEpoch();
    if (snapshot?.compactionEpoch === epoch) return snapshot.render || null;
    const live = input.renderers[name]() ?? "";
    const resolved = name === "timezone" && live.length === 0 ? snapshot?.announcedRender ?? snapshot?.render ?? "" : live;
    save(name, { render: resolved, compactionEpoch: epoch });
    return resolved || null;
  }
  return {
    render,
    rendered: () => FROZEN_PROMPT_SECTION_NAMES.map(name => ({ name, render: read(name)?.render ?? "" })),
    appendUpdates(messages: readonly unknown[]): readonly unknown[] {
      if (!input.enabled()) return messages;
      const updates: SectionUpdate[] = [];
      for (const name of FROZEN_PROMPT_SECTION_NAMES) {
        if (name === "mcp_instructions") continue;
        const snapshot = read(name);
        if (snapshot === null || snapshot.compactionEpoch !== input.compactionEpoch()) { render(name); continue; }
        const live = input.renderers[name]() ?? "";
        if (name === "timezone" && live.length === 0) continue;
        const previous = snapshot.announcedRender ?? snapshot.render;
        if (previous === live) continue;
        updates.push({ name, previous, live });
        save(name, { ...snapshot, announcedRender: live });
      }
      if (updates.length === 0) return messages;
      const privacy = privacySchema.safeParse(messages[0]);
      const note = toRedactedCoreMessage({ role: "user", content: `<instructions_update>\nThese parts of your instructions changed since the fixed copy above. A changed-lines section lists additions (+) and removals (-); otherwise the section replaces that earlier copy until the next summary.\n\n${updates.map(updateText).join("\n\n")}\n</instructions_update>`,
        providerOptions: { cursor: { isInjectedReminder: true } } }, privacy.success ? privacy.data._privacyMode : 0);
      return [...messages, note];
    },
  };
}
