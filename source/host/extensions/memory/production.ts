import type { HostExtensionContext } from "../../../internal/host-extensions.js";
import { randomUUID } from "node:crypto";
import { createContext } from "../../../packages/context/core.js";
import { conversationIdKey, requestIdKey } from "../../../packages/chat-inference-proto/client.js";
import { LocalUserProfileService } from "./local-user-profile.js";
import { reportHostDiagnostic } from "../../host-diagnostics.js";
import {
  createDeadlinePolicy,
  createRealDebouncePolicy,
  createRealPollingPolicy,
  createRealRetryPolicy,
  realClock
} from "../../../internal/scheduling.js";
import { getSandAgentsRootDir } from "../../storage/agent-paths.js";
import { getSandRootDir } from "../../host-paths.js";
import { SAND_SUMMARIZATION_MODEL_ID } from "../../../shared/agents/sand-agent-model.js";
import type { MemoryExtensionContext } from "./extension.js";
import {
  MEMORY_CHANGE_DEBOUNCE_MS,
  type MemoryService
} from "./memory-service.js";
import {
  MEMORY_SYNTHESIS_DEADLINE_MS,
  MEMORY_SYNTHESIS_DEBOUNCE_MS,
  MEMORY_SYNTHESIS_POLL_INTERVAL_MS,
  MEMORY_SYNTHESIS_RETRY_ATTEMPTS,
  MEMORY_SYNTHESIS_RETRY_INITIAL_MS,
  MEMORY_SYNTHESIS_RETRY_MAX_MS,
  MemorySynthesisService,
  memorySynthesisTelemetryReport
} from "./memory-synthesis-service.js";

type ProductionContext = HostExtensionContext<unknown> & {
  readonly deps: MemoryExtensionContext["deps"];
};

/** Artifact construction at host-main.cjs:626827-626891. */
export function createMemoryProductionExtras(
  context: ProductionContext
): Omit<MemoryExtensionContext, "deps" | "onStop"> {
  return {
    sandRoot: getSandRootDir(),
    agentsRootDir: getSandAgentsRootDir(),
    debounce: createRealDebouncePolicy({
      name: "sand-memory-change",
      delayMs: MEMORY_CHANGE_DEBOUNCE_MS
    }),
    createUserProfile() {
      return new LocalUserProfileService({
        sandRoot: getSandRootDir(),
        agentsRoot: getSandAgentsRootDir(),
        async generate(system, user, signal) {
          const executor = context.deps.inference.port.createSession(() => {}, {
            modelId: SAND_SUMMARIZATION_MODEL_ID,
            isSummarizationSession: true,
            skipLabeling: true,
          }).getExecutor();
          const [runContext, cancel] = createContext().with(conversationIdKey, randomUUID()).with(requestIdKey, randomUUID()).withCancel();
          const abort = () => cancel("local user profile cancelled");
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
          try {
            executor.appendMessages([{ role: "system", content: system }, { role: "user", content: user }]);
            const result = executor.stream(runContext, undefined, undefined, {});
            if (typeof result !== "object" || result === null || !("fullStream" in result) || !isProfileStream(result.fullStream)) throw new TypeError("Profile inference stream is unavailable");
            let text = "";
            for await (const part of result.fullStream) {
              if (typeof part !== "object" || part === null || !("type" in part)) continue;
              if (part.type === "error") throw new Error("Profile inference failed");
              if (part.type === "text-delta" && "textDelta" in part && typeof part.textDelta === "string") text += part.textDelta;
              if (text.length > 64_000) throw new Error("Profile inference output exceeds the limit");
            }
            return text;
          } finally {
            signal.removeEventListener("abort", abort);
            cancel("local user profile finished");
          }
        },
        report: outcome => reportHostDiagnostic({ kind: "local_user_profile", outcome }),
      });
    },
    createSynthesis(service: MemoryService) {
      return new MemorySynthesisService({
        debounce: createRealDebouncePolicy({
          name: "sand-memory-synthesis",
          delayMs: MEMORY_SYNTHESIS_DEBOUNCE_MS
        }),
        deadline: createDeadlinePolicy(realClock, {
          name: "sand-memory-synthesis-inference",
          timeoutMs: MEMORY_SYNTHESIS_DEADLINE_MS
        }),
        polling: createRealPollingPolicy({
          name: "sand-memory-temporal-refresh",
          intervalMs: MEMORY_SYNTHESIS_POLL_INTERVAL_MS
        }),
        retry: createRealRetryPolicy({
          name: "sand-memory-synthesis-retry",
          maxAttempts: MEMORY_SYNTHESIS_RETRY_ATTEMPTS,
          initialDelayMs: MEMORY_SYNTHESIS_RETRY_INITIAL_MS,
          maxDelayMs: MEMORY_SYNTHESIS_RETRY_MAX_MS
        }),
        getTarget: agentId => service.synthesisTargetForAgent(agentId),
        listTargets: () => service.listSynthesisTargets().map(({ agentId, store }) => ({
          agentId,
          target: store
        })),
        createExecutor: () => context.deps.inference.port.createSession(() => {}, {
          modelId: SAND_SUMMARIZATION_MODEL_ID,
          isSummarizationSession: true,
          skipLabeling: true
        }).getExecutor(),
        report: event => context.deps.telemetry.logs.reportMemorySynthesis(memorySynthesisTelemetryReport(event))
      });
    }
  };
}

function isProfileStream(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value && typeof value[Symbol.asyncIterator] === "function";
}
