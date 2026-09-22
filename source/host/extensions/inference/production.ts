import type { HostExtensionContext } from "../../../internal/host-extensions.js";
import type { SandAgentModelSelection } from "../../../shared/agents/sand-agent-model.js";
import { createLocalWebFetchService, createLocalWebSearchService } from "./local-web-tools.js";
import { createHostInference } from "./inference-service.js";
import type { InferenceExtensionContext } from "./extension.js";

type ProductionContext = HostExtensionContext<unknown> & {
  readonly deps: InferenceExtensionContext["deps"];
};

/** Recreates the artifact's concrete inference construction at host-main.cjs:617672-617732. */
export function createInferenceProductionExtras(
  context: ProductionContext,
): Omit<InferenceExtensionContext, "deps"> {
  return {
    createPort(onModelExperimentApplied) {
      return createHostInference({
        auth: context.deps.auth,
        experiments: context.deps.experiments,
        settings: context.deps.settings,
        onModelExperimentApplied,
      });
    },
    createWebSearch(_args) { return createLocalWebSearchService(); },
    createWebFetch(_args) { return createLocalWebFetchService(); },
  };
}

export type InferenceModelSelection = SandAgentModelSelection;
