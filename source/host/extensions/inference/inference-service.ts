import { join } from "node:path";

import type { SandInferenceProvider } from "../../../shared/inference-router.js";
import { SandSettingsStore } from "../../../shared/node/settings/sand-settings-store.js";
import { getSandRootDir } from "../../host-paths.js";
import type { PromptExecutor } from "./sand-labeling.js";
import { createProviderPromptSession } from "./provider-session.js";
import type { SummarizationPromptSession } from "../../../packages/agent-summarization/summarization-handler.js";
import { PrivacyMode } from "../../../packages/redaction/privacy-mode.js";

export interface HostInferenceOptions {
  auth: { getAccessToken(...args: unknown[]): Promise<string>; getMachineId(): string };
  experiments: { checkFeatureGate(name: string): boolean; getComputerUseModelOverride(): unknown; getBrowserUseModelOverride(): unknown; getSandModelExperimentState(): unknown; hasHydratedStatsigUserId(): boolean; getConfiguredDefaultModel(): unknown; getConfiguredAutomationsModel(): unknown };
  settings: { getAgentDefaultModel(): unknown; getComputerUseModel(): unknown; getInferenceProvider(): SandInferenceProvider; recordInferenceUsage(provider: SandInferenceProvider, usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }): void };
  onModelExperimentApplied(): void;
}

export function createHostInference(options: HostInferenceOptions) {
  const routerSettings = new SandSettingsStore(join(getSandRootDir(), "settings.json"));
  const createLocalSession = () => createProviderPromptSession(routerSettings.getInferenceProvider());
  const createSession = (_onRequestId: (requestId: string) => void, _sessionOptions?: Readonly<Record<string, unknown>>) => createLocalSession();
  return {
    resolvePrivacyMode: () => PrivacyMode.UNSPECIFIED,
    createSession,
    createSummarizationSession: (_onRequestId: (requestId: string) => void, _sessionOptions?: Readonly<Record<string, unknown>>) => createLocalSession() as unknown as SummarizationPromptSession,
  } satisfies {
    resolvePrivacyMode(): PrivacyMode;
    createSession(onRequestId: (requestId: string) => void, options?: Readonly<Record<string, unknown>>): { getModelId(): string; getExecutor(state?: unknown): PromptExecutor };
    createSummarizationSession(onRequestId: (requestId: string) => void, options?: Readonly<Record<string, unknown>>): SummarizationPromptSession;
  };
}
