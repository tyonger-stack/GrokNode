import { AnthropicCompactionHandler } from "./anthropic-compaction-handler.js";
import { OpenAICompactionHandler } from "./openai-compaction-handler.js";
import {
  SelfSummarizer,
  type SelfSummaryPromptSession,
  type SelfSummaryRetryOptions,
} from "./self-summary-handler.js";
import {
  XaiCompactionHandler,
  type XaiCompactionPromptVariant,
} from "./xai-compaction-handler.js";
import type { DeliveryTailConfig } from "../../agent-summarization/delivery-tail.js";
import type { SelfSummarizerFactory } from "../summarization-orchestrator.js";

export type SelfSummaryFlavor =
  | "xai-compact"
  | "openai-compact"
  | "anthropic-compact"
  | "self-summary"
  | "anthropic-explicit"
  | "generic";

export interface SelfSummaryConfig {
  readonly promptSession?: SelfSummaryPromptSession | undefined;
  readonly flavor?: SelfSummaryFlavor | undefined;
  readonly resolveFlavor?: (() => SelfSummaryFlavor | undefined) | undefined;
  readonly promptVariant?: XaiCompactionPromptVariant | undefined;
  readonly tokenLimit?: number | undefined;
  readonly canUseSelfSummary?: (() => boolean) | undefined;
  readonly enableTranscriptEnrichment?: boolean | undefined;
  readonly retryOptions?: SelfSummaryRetryOptions | undefined;
  readonly enableReduceInputsRetry?: boolean | undefined;
  readonly enableRetryUncategorizedErrors?: boolean | undefined;
  readonly enableRetryNoSummaryResponse?: boolean | undefined;
  readonly openAiCompactionEnableRetryNoSummaryResponse?: boolean | undefined;
  readonly anthropicCompactionEnableRetryNoSummaryResponse?: boolean | undefined;
  readonly preserveUserDeliveryTail?: DeliveryTailConfig | undefined;
  readonly onSelfSummaryStart?: (() => void) | undefined;
}

export function resolveSelfSummaryFlavor(config: SelfSummaryConfig | undefined): SelfSummaryFlavor {
  return config?.resolveFlavor?.() ?? config?.flavor ?? "generic";
}

export function createSelfSummarizerFactory(input: {
  readonly config: SelfSummaryConfig | undefined;
  readonly fallbackPromptSession: SelfSummaryPromptSession;
  readonly modelId: string;
}): SelfSummarizerFactory | undefined {
  const config = input.config;
  if (config === undefined) return undefined;
  return (stateHandler, interactionListener, tools, extraT, descriptionProps) => {
    const promptSession = config.promptSession ?? input.fallbackPromptSession;
    const flavor = resolveSelfSummaryFlavor(config);
    const retry = {
      enableReduceInputsRetry: config.enableReduceInputsRetry ?? true,
      enableRetryUncategorizedErrors: config.enableRetryUncategorizedErrors ?? true,
      descriptionProps,
      ...config.retryOptions,
    };
    config.onSelfSummaryStart?.();
    switch (flavor) {
      case "xai-compact":
        return new XaiCompactionHandler(
          promptSession,
          stateHandler,
          interactionListener,
          tools,
          extraT,
          input.modelId,
          {
            ...retry,
            enableRetryNoSummaryResponse: config.enableRetryNoSummaryResponse ?? config.retryOptions?.enableRetryNoSummaryResponse ?? true,
            promptVariant: config.promptVariant,
            enableTranscriptEnrichment: config.enableTranscriptEnrichment === true,
            deliveryTail: config.preserveUserDeliveryTail,
          },
        );
      case "openai-compact":
        return new OpenAICompactionHandler(
          promptSession,
          stateHandler,
          interactionListener,
          tools,
          extraT,
          input.modelId,
          {
            ...retry,
            enableRetryNoSummaryResponse: config.openAiCompactionEnableRetryNoSummaryResponse ?? false,
            deliveryTail: config.preserveUserDeliveryTail,
          },
        );
      case "anthropic-explicit":
      case "anthropic-compact":
        return new AnthropicCompactionHandler(
          promptSession,
          stateHandler,
          interactionListener,
          tools,
          extraT,
          input.modelId,
          {
            ...retry,
            explicit: flavor === "anthropic-explicit",
            enableRetryNoSummaryResponse: config.anthropicCompactionEnableRetryNoSummaryResponse ?? false,
            deliveryTail: config.preserveUserDeliveryTail,
          },
        );
      case "generic":
      case "self-summary":
        return new SelfSummarizer(
          promptSession,
          stateHandler,
          interactionListener,
          tools,
          extraT,
          input.modelId,
          {
            ...retry,
            enableRetryNoSummaryResponse: config.enableRetryNoSummaryResponse ?? config.retryOptions?.enableRetryNoSummaryResponse ?? true,
          },
          config.enableTranscriptEnrichment === true,
          config.preserveUserDeliveryTail,
        );
      default: {
        const _exhaustive: never = flavor;
        throw new Error(`Unknown self-summary flavor: ${String(_exhaustive)}`);
      }
    }
  };
}
