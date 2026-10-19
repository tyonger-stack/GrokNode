import type { Context } from "../../context/core.js";
import { createLogger } from "../../context/logger.js";
import type { fromRedactedCoreMessage } from "../../redaction/core-message.js";
import { isSummaryCursorMessage } from "./compaction-user-message.js";
import {
  EVAL_ENFORCED_SELF_SUMMARY_TOKEN_LIMIT,
} from "../utils/overridable-config.js";
import {
  SELF_SUMMARY_CONTEXT_WINDOW_FRACTION,
} from "./constants.js";
import { estimateTokenCount } from "./token-estimate.js";

export type SelfSummaryMessage = Parameters<typeof fromRedactedCoreMessage>[0];

export interface SelfSummaryTokenDetails {
  readonly usedTokens?: number | undefined;
  readonly maxTokens?: number | undefined;
}

const logger = createLogger("@anysphere/agent");

export function findLastUserMessageIndex(
  messages: readonly SelfSummaryMessage[],
  options?: { readonly includeSummaryMessages?: boolean | undefined } | null,
): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (
      message.role === "user" &&
      (options?.includeSummaryMessages || !isSummaryCursorMessage(message))
    ) {
      return index;
    }
  }
  return -1;
}

export function shouldPerformSelfSummary(
  messages: readonly SelfSummaryMessage[],
  tokenDetails: SelfSummaryTokenDetails | null | undefined,
  ctx: Context | undefined,
  configTokenLimit: number | undefined,
): boolean {
  const tokenCount = tokenDetails?.usedTokens !== undefined &&
      Number.isFinite(tokenDetails.usedTokens) && tokenDetails.usedTokens > 0
    ? tokenDetails.usedTokens
    : estimateTokenCount(messages, { includeNonTextContent: true });
  const evalOverrideLimit = ctx !== undefined
    ? EVAL_ENFORCED_SELF_SUMMARY_TOKEN_LIMIT(ctx)
    : undefined;
  if (evalOverrideLimit !== undefined && ctx !== undefined) {
    logger.info(ctx, "[self-summary] using eval override token limit", {
      evalOverrideLimit,
      configTokenLimit,
    });
  }
  const fractionLimit = tokenDetails?.maxTokens !== undefined && tokenDetails.maxTokens > 0
    ? Math.floor(tokenDetails.maxTokens * SELF_SUMMARY_CONTEXT_WINDOW_FRACTION)
    : undefined;
  const tokenLimit = evalOverrideLimit ?? configTokenLimit ?? fractionLimit;
  if (tokenLimit === undefined) return false;
  return tokenCount >= tokenLimit;
}
