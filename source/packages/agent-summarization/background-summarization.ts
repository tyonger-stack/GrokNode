export enum BackgroundSummarizationMode {
  Background = "Background",
  BackgroundAndPersistIfCompleted = "BackgroundAndPersistIfCompleted",
  WaitForCompletion = "WaitForCompletion",
  WaitForCompletionIfStarted = "WaitForCompletionIfStarted",
}

export interface BackgroundSummarizationProps {
  unusedTokensThresholdToStartBackgroundSummarization?: number | undefined;
  unusedPercentTokensThresholdToStartBackgroundSummarization?: number | undefined;
  /** Absolute used-token threshold (0712 `usedTokensThresholdToStartBackgroundSummarization`). */
  usedTokensThresholdToStartBackgroundSummarization?: number | undefined;
  unusedTokensThresholdToPersistBackgroundSummarization?: number | undefined;
  unusedPercentTokensThresholdToPersistBackgroundSummarization?: number | undefined;
  usedTokensThresholdToPersistBackgroundSummarization?: number | undefined;
  discardOnError?: boolean | undefined;
  requireTriggerThresholdForMidLoopPersist?: boolean | undefined;
}

export const DISABLED_BACKGROUND_SUMMARIZATION_PROPS: BackgroundSummarizationProps = {
  unusedTokensThresholdToStartBackgroundSummarization: undefined,
  unusedPercentTokensThresholdToStartBackgroundSummarization: undefined,
  usedTokensThresholdToStartBackgroundSummarization: undefined,
  unusedTokensThresholdToPersistBackgroundSummarization: undefined,
  unusedPercentTokensThresholdToPersistBackgroundSummarization: undefined,
  usedTokensThresholdToPersistBackgroundSummarization: undefined,
};

function isValidUsedTokensThreshold(threshold: number | undefined, maxTokens: number): threshold is number {
  return typeof threshold === "number" &&
    Number.isSafeInteger(threshold) &&
    Number.isFinite(maxTokens) &&
    threshold > 0 &&
    threshold < maxTokens;
}

export function getBackgroundSummarizationTriggerThreshold(
  maxTokens: number,
  props: BackgroundSummarizationProps,
): number | undefined {
  if (maxTokens <= 0) return undefined;
  const candidates: number[] = [];
  if (props.unusedTokensThresholdToStartBackgroundSummarization !== undefined) {
    candidates.push(maxTokens - props.unusedTokensThresholdToStartBackgroundSummarization);
  }
  if (props.unusedPercentTokensThresholdToStartBackgroundSummarization !== undefined) {
    candidates.push(
      maxTokens * (1 - props.unusedPercentTokensThresholdToStartBackgroundSummarization),
    );
  }
  if (isValidUsedTokensThreshold(props.usedTokensThresholdToStartBackgroundSummarization, maxTokens)) {
    candidates.push(props.usedTokensThresholdToStartBackgroundSummarization);
  }
  if (candidates.length === 0) return undefined;
  return Math.min(...candidates);
}

export function shouldStartBackgroundSummarization(
  usedTokens: number,
  maxTokens: number,
  props: BackgroundSummarizationProps,
): boolean {
  const threshold = getBackgroundSummarizationTriggerThreshold(maxTokens, props);
  return threshold !== undefined && usedTokens >= threshold;
}

export function shouldPersistBackgroundSummarization(
  usedTokens: number,
  maxTokens: number,
  props: BackgroundSummarizationProps,
): boolean {
  const unusedTokens = maxTokens - usedTokens;
  return shouldStartBackgroundSummarization(usedTokens, maxTokens, props) && (
    props.unusedTokensThresholdToPersistBackgroundSummarization !== undefined &&
      unusedTokens <= props.unusedTokensThresholdToPersistBackgroundSummarization ||
    props.unusedPercentTokensThresholdToPersistBackgroundSummarization !== undefined &&
      unusedTokens / maxTokens <= props.unusedPercentTokensThresholdToPersistBackgroundSummarization ||
    isValidUsedTokensThreshold(props.usedTokensThresholdToPersistBackgroundSummarization, maxTokens) &&
      usedTokens >= props.usedTokensThresholdToPersistBackgroundSummarization
  );
}

/**
 * Local Sand / OpenRouter defaults when the inference server does not push
 * `RunInferenceBackgroundSummarizationConfig`. Starts earlier than the 90%
 * self-summary hard line (80% of window, or catalog `auto_compact_token_limit`
 * when lower), and persists at the catalog auto-compact / 90% line.
 */
export function localBackgroundSummarizationPropsForWindow(
  contextWindow: number,
  autoCompactTokenLimit?: number,
): BackgroundSummarizationProps {
  if (!(contextWindow > 0) || !Number.isFinite(contextWindow)) {
    return DISABLED_BACKGROUND_SUMMARIZATION_PROPS;
  }
  const earlyStart = Math.floor(contextWindow * 0.8);
  const persistAt = isValidUsedTokensThreshold(autoCompactTokenLimit, contextWindow)
    ? autoCompactTokenLimit
    : Math.floor(contextWindow * 0.9);
  return {
    usedTokensThresholdToStartBackgroundSummarization: Math.min(earlyStart, persistAt),
    usedTokensThresholdToPersistBackgroundSummarization: persistAt,
    discardOnError: true,
  };
}
