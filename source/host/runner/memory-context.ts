import { dirname } from "node:path";
import { UserMemoryStore, ProjectMemoryStore, getProjectMemoryShardDir } from "../extensions/memory/memory-service.js";
import { AgentProjectMembership } from "../extensions/memory/project-membership.js";
import { mergeUserMemoryShards, selectProjectMemoryBlocks } from "./sand-memory.js";
import type { DebouncePolicy } from "../../internal/scheduling.js";
import type { SystemPromptAssemblyDependencies, MemoryPromptStore, MemorySnapshotStore } from "./system-prompt-assembly.js";
import type { TurnMemoryStore, EpisodeProgress } from "./turn-memory.js";

const immediateDebounce: DebouncePolicy = {
  name: "memory-context",
  wrap: <T extends (...args: never[]) => unknown>(fn: T) => Object.assign(fn, { dispose() {} }),
};

function isPromptStore(value: unknown): value is MemoryPromptStore {
  return typeof value === "object" && value !== null && "recall" in value && typeof value.recall === "function"
    && "getLocation" in value && typeof value.getLocation === "function";
}
function isSnapshotStore(value: unknown): value is MemorySnapshotStore {
  return typeof value === "object" && value !== null && "getMemoryPromptSnapshot" in value && typeof value.getMemoryPromptSnapshot === "function"
    && "setMemoryPromptSnapshot" in value && typeof value.setMemoryPromptSnapshot === "function";
}

export function isTurnMemoryStore(value: unknown): value is TurnMemoryStore {
  return isPromptStore(value) && "addMemory" in value && typeof value.addMemory === "function"
    && "listMemories" in value && typeof value.listMemories === "function"
    && "removeMemoryByContent" in value && typeof value.removeMemoryByContent === "function";
}

export function isEpisodeProgress(value: unknown): value is EpisodeProgress {
  return typeof value === "object" && value !== null && "clearPendingEpisodeTurns" in value && typeof value.clearPendingEpisodeTurns === "function"
    && "getPendingEpisodeTurns" in value && typeof value.getPendingEpisodeTurns === "function"
    && "recordEpisodeTurn" in value && typeof value.recordEpisodeTurn === "function";
}

export function createRunnerMemoryContext(input: {
  readonly agentId: string;
  readonly dbPath: string;
  readonly sandRoot: string | undefined;
  readonly store: unknown;
  readonly snapshots: unknown;
  readonly resolveAgentName: (id: string) => string;
}): Pick<SystemPromptAssemblyDependencies, "memoryStore" | "memorySnapshots" | "userMemory" | "projectMemory"> {
  const root = input.sandRoot;
  const membership = new AgentProjectMembership(dirname(input.dbPath));
  const user = root === undefined ? null : new UserMemoryStore(root, input.agentId, input.resolveAgentName, immediateDebounce);
  const project = root === undefined ? null : new ProjectMemoryStore(root, input.agentId, membership, input.resolveAgentName, immediateDebounce);
  return {
    memoryStore: () => isPromptStore(input.store) ? input.store : null,
    memorySnapshots: () => isSnapshotStore(input.snapshots) ? input.snapshots : null,
    userMemory: () => user === null ? null : {
      getLocation: () => user.getLocation(),
      getOwnShardLocation: () => user.getOwnShardLocation(),
      recall: (limits) => {
        const facts = user.recallAll();
        return mergeUserMemoryShards(facts.map((fact) => ({
          via: fact.agentName,
          recall: { profile: fact.kind === "profile" ? [fact] : [], recent: fact.kind === "log" ? [fact] : [] },
        })), limits);
      },
    },
    projectMemory: () => project === null || root === undefined ? null : {
      getLocation: () => project.getLocation(),
      recall: (limits, cap) => {
        const facts = project.recall({ profile: Number.MAX_SAFE_INTEGER, recent: Number.MAX_SAFE_INTEGER }, Number.MAX_SAFE_INTEGER);
        return selectProjectMemoryBlocks([...membership.read()].map((slug) => ({
          slug,
          name: slug,
          ownShardDir: getProjectMemoryShardDir(root, slug, input.agentId),
          recall: mergeUserMemoryShards(facts.filter((fact) => fact.project === slug).map(({ memory, agentName }) => ({
            via: agentName,
            recall: { profile: memory.kind === "profile" ? [memory] : [], recent: memory.kind === "log" ? [memory] : [] },
          })), limits),
        })), cap);
      },
    },
  };
}
