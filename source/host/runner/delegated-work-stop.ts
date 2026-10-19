import { z } from "zod";
import type { DelegatedStopOutcome, DelegatedStopRequest } from "./tools/sand-subagent-management-tools.js";

const outcomesSchema = z.array(z.object({ kind: z.enum(["peer", "cloud_agent"]), id: z.string(), name: z.string(),
  result: z.enum(["stopped", "not_running", "unreachable", "failed", "stale"]), detail: z.string().optional(), stopDescendants: z.boolean().optional() }));

export function createDelegatedWorkStopper(input: {
  readonly selfId: string;
  readonly stopPeers?: (visited: readonly string[]) => Promise<unknown>;
  readonly stopPeerDescendants?: (id: string, request: DelegatedStopRequest) => Promise<readonly DelegatedStopOutcome[]>;
  readonly stopCloud: (id: string, request: DelegatedStopRequest) => Promise<{ readonly result: DelegatedStopOutcome["result"]; readonly detail?: string }>;
  readonly pendingCloudIds?: () => readonly string[];
}) {
  const cloudIds = new Set<string>();
  return {
    launched(id: string) { cloudIds.add(id); },
    finished(id: string) { cloudIds.delete(id); },
    async stop(request: DelegatedStopRequest = {}): Promise<readonly DelegatedStopOutcome[]> {
      const prior = request.visitedAgentIds ?? [];
      if (prior.includes(input.selfId)) return [];
      const visited = [...prior, input.selfId];
      const results: DelegatedStopOutcome[] = [];
      if (input.stopPeers === undefined) results.push({ kind: "peer", id: "", name: "peer delegation", result: "unreachable", detail: "This host has no peer stop adapter." });
      else {
        try {
          const peers = outcomesSchema.parse(await input.stopPeers(visited));
          for (const peer of peers) {
            const { detail, stopDescendants, ...identity } = peer;
            results.push(detail === undefined ? identity : { ...identity, detail });
            if (peer.kind === "peer" && peer.result === "stopped" && stopDescendants === true && !visited.includes(peer.id) && input.stopPeerDescendants !== undefined) {
              results.push(...await input.stopPeerDescendants(peer.id, { ...request, visitedAgentIds: visited }));
            }
          }
        } catch (error) { results.push({ kind: "peer", id: "", name: "peer delegation", result: "failed", detail: error instanceof Error ? error.message : String(error) }); }
      }
      const cloud = await Promise.all([...cloudIds].map(async id => {
        try {
          const result = await input.stopCloud(id, request);
          if (result.result === "stopped" || result.result === "not_running") cloudIds.delete(id);
          return { kind: "cloud_agent" as const, id, name: id, ...result };
        } catch (error) { return { kind: "cloud_agent" as const, id, name: id, result: "failed" as const, detail: error instanceof Error ? error.message : String(error) }; }
      }));
      results.push(...cloud);
      for (const id of input.pendingCloudIds?.() ?? []) if (!cloudIds.has(id) && !cloud.some(result => result.id === id)) {
        results.push({ kind: "cloud_agent", id, name: id, result: "unreachable", detail: "A watch exists, but this runner cannot verify that it launched the cloud agent." });
      }
      return results;
    },
  };
}
