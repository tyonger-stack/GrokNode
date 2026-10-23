import { useEffect, useState, type ReactNode } from "react";
import type { DesktopBridge } from "../../../contracts/desktop-bridge";
import type { ProductionCoordinatorClient } from "../../../../production/coordinator-client";
import { MemoryImportSection, type MemoryImportPreview } from "./memory-import-section";

const MEMORY_IMPORT_GATE = "grok_bot_memory_import";

function gateEnabled(snapshot: unknown, name: string): boolean {
  if (typeof snapshot !== "object" || snapshot === null) return false;
  const gates = (snapshot as { featureGates?: unknown }).featureGates;
  if (typeof gates !== "object" || gates === null) return false;
  return (gates as Record<string, unknown>)[name] === true;
}

function memoryContents(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const content = (row as { content?: unknown }).content;
    return typeof content === "string" && content.length > 0 ? [content] : [];
  });
}

function addedContents(value: unknown): string[] {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { added?: unknown }).added)) {
    throw new Error("Memory import returned an unexpected result.");
  }
  return memoryContents((value as { added: unknown }).added);
}

export function MemoryImportHost(props: {
  readonly bridge: Pick<DesktopBridge, "agent" | "experiments">;
  readonly coordinator: Pick<ProductionCoordinatorClient, "call"> | null;
}): ReactNode {
  const [enabled, setEnabled] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [existing, setExisting] = useState<readonly string[]>([]);

  useEffect(() => {
    let live = true;
    void (async () => {
      let snapshot: unknown = props.bridge.experiments.initialSnapshot;
      try { snapshot = await props.bridge.experiments.getSnapshot(); } catch { /* keep the initial snapshot */ }
      if (!live) return;
      if (!gateEnabled(snapshot, MEMORY_IMPORT_GATE)) {
        setEnabled(false);
        return;
      }
      setEnabled(true);
      let id: string | null = null;
      try { id = await props.bridge.agent.getMainAgent(); } catch { id = null; }
      if (!live) return;
      setAgentId(typeof id === "string" && id.length > 0 ? id : null);
      if (typeof id !== "string" || id.length === 0 || props.coordinator == null) return;
      try {
        const listed = await props.coordinator.call("getAgentMemories", { id });
        if (live) setExisting(memoryContents(listed));
      } catch {
        if (live) setExisting([]);
      }
    })();
    return () => { live = false; };
  }, [props.bridge, props.coordinator]);

  if (!enabled) return null;
  const blocked = agentId == null
    ? "Choose a main Bot before importing memories."
    : props.coordinator == null
      ? "Memory import is unavailable."
      : null;
  const ready = blocked == null;
  const persist = async (_items: readonly { readonly content: string; readonly kind: "profile" | "log" }[], preview: MemoryImportPreview): Promise<void> => {
    if (props.coordinator == null || agentId == null) throw new Error("Memory import is unavailable.");
    const result = await props.coordinator.call("importAgentMemories", {
      id: agentId,
      kind: preview.kind,
      text: preview.text,
      ...(preview.fileName === undefined ? {} : { fileName: preview.fileName }),
    });
    const added = addedContents(result);
    if (added.length > 0) setExisting((current) => [...current, ...added]);
  };
  return (
    <div className="sand-memory-import-host">
      {blocked == null ? null : <p className="sand-memory-import-notice" role="status">{blocked}</p>}
      <MemoryImportSection disabled={!ready} existingContents={existing} onImport={persist} />
    </div>
  );
}
