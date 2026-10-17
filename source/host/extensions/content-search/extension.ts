import { join } from "node:path";
import { createDeadlinePolicy, realClock } from "../../../internal/scheduling.js";
import { defineHostExtension } from "../../../internal/host-extensions.js";
import { subscribeTranscriptMutations } from "../../transcript-mutation-events.js";
import { getSandRootDir } from "../../host-paths.js";
import { getSandAgentsRootDir } from "../../storage/agent-paths.js";
import { HostExtensions } from "../extension-ids.generated.js";
import { AGENT_CONTENT_SEARCH_MAX_MATCHES_PER_AGENT, AGENT_CONTENT_SEARCH_MAX_RESULTS, findAgentContentMatches } from "./agent-content-search.js";
import { SEARCH_INDEX_FILENAME } from "./search-index-db.js";
import { SandSearchIndexService, SEARCH_INDEX_DISPOSE_TIMEOUT_MS, type TranscriptMutation } from "./search-index-service.js";

// P1-8 / official 0.71.2 parity: content-search is always on.
// Official host-main.cjs registers this extension with only Telemetry as a
// dependency, starts the FTS5 index unconditionally, and exposes
// isGlobalSearchEnabled as `async () => true` (no sand_global_search gate).
// Keeping isEnabled() as a constant true preserves any residual callers while
// the gateway methods themselves no longer consult the gate.
export const GLOBAL_SEARCH_GATE = "sand_global_search";

export const contentSearchExtension = defineHostExtension({
  id: HostExtensions.ContentSearch,
  dependencies: [HostExtensions.Telemetry],
  start: (context) => {
    const deps = context.deps as {
      telemetry: { logs: { reportSearchIndexHealth(value: Record<string, unknown>): void } };
    };
    const index = new SandSearchIndexService({
      indexDbPath: join(getSandRootDir(), SEARCH_INDEX_FILENAME),
      agentsRootDir: getSandAgentsRootDir(),
      disposeDeadline: createDeadlinePolicy(realClock, { name: "sand-content-search-dispose", timeoutMs: SEARCH_INDEX_DISPOSE_TIMEOUT_MS }),
      report: (value) => deps.telemetry.logs.reportSearchIndexHealth(value)
    });
    context.onStop(() => index.dispose());
    const subscribe = subscribeTranscriptMutations as unknown as (listener: (mutation: TranscriptMutation) => void) => () => void;
    context.onStop(subscribe((mutation) => index.applyMutation(mutation)));
    index.start();
    return {
      isEnabled: () => true,
      get isSearchReady() { return index.isSearchReady; },
      maxMatchesPerAgent: AGENT_CONTENT_SEARCH_MAX_MATCHES_PER_AGENT,
      maxResults: AGENT_CONTENT_SEARCH_MAX_RESULTS,
      searchMessages: ({ query, limit }: { query: string; limit: number }) => index.searchMessages(query, limit),
      searchMedia: ({ query, limit }: { query: string; limit: number }) => index.searchMedia(query, limit),
      findTranscriptMatches: findAgentContentMatches
    };
  }
});
