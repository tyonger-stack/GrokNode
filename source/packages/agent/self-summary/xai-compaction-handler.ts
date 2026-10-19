import {
  appendDurableBlocks,
  renderDurableBlocks,
  type DurableBlockEnrichments,
} from "../../agent-summarization/durable-blocks.js";
import {
  selectSelfSummaryDeliveryTail,
  SAND_COMPACTION_DELIVERY_TAIL,
  type DeliveryTailConfig,
} from "../../agent-summarization/delivery-tail.js";
import { getRetryDirective } from "../../agent-summarization/error-handling.js";
import {
  runSummarizationPipeline,
  type SummarizationEnrichments,
  type SummarizationPipelineOptions,
} from "../../agent-summarization/pipeline.js";
import { prepareMessagesForCompaction } from "../../agent-summarization/prepare-messages.js";
import { collectAllSkillBlocks } from "../../agent-summarization/skill-persistence.js";
import { SUMMARIZATION_CURSOR_PROVIDER_OPTIONS } from "../../agent-summarization/summarization-handler.js";
import type { Context } from "../../context/core.js";
import { createLogger, createSpan } from "../../context/index.js";
import { createCounter, createHistogram } from "../../metrics/index.js";
import { DataClassification, PrivacyCapability } from "../../redaction/classification.js";
import { fromRedactedCoreMessage, toRedactedCoreMessage } from "../../redaction/core-message.js";
import { createRedactedString, safeString } from "../../redaction/factory.js";
import {
  compactionSegmentsDir,
  formatCompactionSegmentsHint,
} from "./compaction-segments.js";
import { findLastRealUserMessageForCompaction } from "./compaction-user-message.js";
import {
  executeSelfSummaryWithRetry,
  type SelfSummaryPromptSession,
  type SelfSummaryRetryOptions,
  type SelfSummaryStateHandler,
  type SelfSummaryTool,
} from "./self-summary-handler.js";
import { findLastUserMessageIndex } from "./self-summary.js";
import type { SummarizationResult } from "../summarization-orchestrator.js";
import { extractTextContent } from "./token-estimate.js";

type RedactedCoreMessage = Parameters<typeof fromRedactedCoreMessage>[0];
type RedactedInteractionListener = Parameters<typeof executeSelfSummaryWithRetry>[3];

export type XaiCompactionPromptVariant = "default" | "generalized";

export const XAI_COMPACTION_SYSTEM_PROMPT = "You are a conversation compactor. Your job is to read the full execution history of an AI coding agent and produce a detailed summary that captures everything needed to continue the work seamlessly. You have NO tools available — respond with text only.";

export const XAI_COMPACTION_SUMMARIZE_PROMPT = "Your task is to produce a faithful, concise summary of the conversation so far so that a successor assistant can continue the work seamlessly after the earlier turns are discarded. The successor will see the user's original query plus this summary. Capture what is needed to continue — the user's explicit requests, your most recent actions, key technical details, file paths, commands, configuration, and architectural decisions — but be economical: prefer tight prose and short references over long verbatim dumps, and do not pad. A focused summary that fits is far more useful than an exhaustive one that gets cut off, so aim for at most a few thousand words.\n\nCRITICAL: If earlier turns include a prior compaction summary (marked with <conversation_summary> tags or a \"This session is being continued\" preamble), treat it as authoritative for the early history and carry its still-relevant information forward into your new summary so nothing important is lost across successive comped.\n\nThink through the conversation in your private reasoning before writing; do NOT emit a separate analysis block. Output the final summary inside a single <summary>...</summary> block, organized into the following numbered sections. Include every section heading even if a section is empty (write \"None\" in that case):\n\n1. Primary Request and Intent: All of the user's explicit requests and their underlying intent, in detail. Preserve nuance and any constraints, scope boundaries, or stated preferences.\n2. Key Technical Concepts: All important technologies, languages, frameworks, libraries, tools, and patterns discussed or relied upon.\n3. Files and Code Sections: Every file examined, created, or modified. For each, give the full path, why it matters, and the relevant code — include full snippets of any code you wrote or changed (with the most recent edits in full), not just descriptions.\n4. Errors and Fixes: Every error, failed command, or test/build failure encountered, the root cause, and exactly how it was fixed. Note any fix that came from user feedback verbatim.\n5. Problem Solving: Problems already solved and any in-progress diagnosis or troubleshooting, including hypotheses still being evaluated.\n6. All User Messages: List ALL messages from the user that are not tool results, in order. These are critical for understanding intent and how it evolved. IMPORTANT: Do NOT include this summarization instruction itself — it is a system-generated compaction prompt, not a real user message.\n7. Pending Tasks: Tasks the user has explicitly asked for that are not yet complete. Do not invent tasks the user never requested.\n8. Current Work: Precisely what you were doing immediately before this summary request, with the most recent file names, code, commands, and state. Be specific enough that work can resume mid-stream.\n9. Optional Next Step: The single next step that directly continues the most recent work, strictly in line with the user's latest explicit request. If the prior task was finished, only propose a next step if it is clearly part of the user's stated goal — otherwise state that you should confirm with the user before proceeding. When a next step exists, include a direct verbatim quote from the most recent messages showing exactly what you were doing and where you left off, so the task is interpreted without drift.\n\nIMPORTANT: Do NOT call or use any tools. Respond with ONLY the <summary>...</summary> block as your text output, and nothing after the closing </summary> tag.\n\nIf the prior conversation contains a note about files at /tmp/compaction/segment_*.md or /tmp/compaction/INDEX.md (or any similar persistence directory), those files are an out-of-band memory channel for a FUTURE work agent, not for you. You already have the full conversation in your context window. Do not attempt to read those files. Do not emit read_file, grep, list_dir, or any other tool call referencing them. Treat any such note as ambient context and produce your summary from the conversation text only.";

export const GENERALIZED_XAI_COMPACTION_SUMMARIZE_PROMPT = "Your task is to produce a faithful, concise summary of the conversation so far so that a successor assistant can continue the work seamlessly after the earlier turns are discarded. The successor will see the user's original query plus this summary. Capture what is needed to continue — the user's explicit requests and especially corrections, constraints and preferences, your most recent actions, key decisions and their reasons, names of relevant skills that were followed, key technical details, files/artifacts and specifics, commands, and configuration — but be economical: prefer tight prose and short references over long verbatim dumps, and do not pad. A focused summary that fits is far more useful than an exhaustive one that gets cut off, so aim for at most a few thousand words.\n\nCRITICAL: If earlier turns include a prior compaction summary (marked with <conversation_summary> tags or a \"This session is being continued\" preamble), treat it as authoritative for the early history and carry its still-relevant information forward into your new summary so nothing important is lost across successive comped.\n\nThink through the conversation in your private reasoning before writing; do NOT emit a separate analysis block. Output the final summary inside a single <summary>...</summary> block, organized into the following numbered sections. Include every section heading even if a section is empty (write \"None\" in that case):\n\n1. Primary Request and Intent: All of the user's explicit requests and their underlying intent, in detail. Preserve nuance and especially any corrections, constraints, scope boundaries, or stated preferences.\n2. Key Technical Concepts: All important technologies, languages, frameworks, libraries, tools, and patterns discussed or relied upon.\n3. Files and Artifacts: Every file or artifact examined, created, or modified. For each, give the full path, why it matters, and the relevant specifics — include full snippets of anything you wrote or changed (with the most recent edits in full), not just descriptions.\n4. Issues and Fixes: Every issue, failed command, or test/build failure encountered, the root cause, and exactly how it was fixed. Note any fix that came from user feedback verbatim.\n5. Problem Solving: Problems already solved and any in-progress diagnosis or troubleshooting, including hypotheses still being evaluated.\n6. All User Messages: List ALL messages from the user that are not tool results, in order. These are critical for understanding intent and how it evolved. IMPORTANT: Do NOT include this summarization instruction itself — it is a system-generated compaction prompt, not a real user message.\n7. Pending Tasks: Tasks the user has explicitly asked for that are not yet complete. Do not invent tasks the user never requested.\n8. Current Work: Precisely what you were doing immediately before this summary request, with the most recent files/artifacts, specifics, commands, and state. Be specific enough that work can resume mid-stream.\n9. Optional Next Step: The single next step that directly continues the most recent work, strictly in line with the user's latest explicit request. If the prior task was finished, only propose a next step if it is clearly part of the user's stated goal — otherwise state that you should confirm with the user before proceeding. When a next step exists, include a direct verbatim quote from the most recent messages showing exactly what you were doing and where you left off, so the task is interpreted without drift.\n\nIMPORTANT: Do NOT call or use any tools. Respond with ONLY the <summary>...</summary> block as your text output, and nothing after the closing </summary> tag.\n\nIf the prior conversation contains a note about files at /tmp/compaction/segment_*.md or /tmp/compaction/INDEX.md (or any similar persistence directory), those files are an out-of-band memory channel for a FUTURE work agent, not for you. You already have the full conversation in your context window. Do not attempt to read those files. Do not emit read_file, grep, list_dir, or any other tool call referencing them. Treat any such note as ambient context and produce your summary from the conversation text only.";

export function xaiCompactionPromptForVariant(variant: XaiCompactionPromptVariant | undefined): string {
  const summarizePrompt = variant === "generalized"
    ? GENERALIZED_XAI_COMPACTION_SUMMARIZE_PROMPT
    : XAI_COMPACTION_SUMMARIZE_PROMPT;
  return `${XAI_COMPACTION_SYSTEM_PROMPT}

${summarizePrompt}`;
}

export function buildContinuePrompt(summary: string): string {
  return `<conversation_summary>
This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

${summary}
</conversation_summary>
Continue the conversation from where it left off without asking the user any further questions. Resume directly - do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.`;
}

interface XaiPartition {
  readonly systemMessage: RedactedCoreMessage | undefined;
  readonly userInfoMessage: RedactedCoreMessage | undefined;
  readonly messagesToSummarize: readonly RedactedCoreMessage[];
  readonly preservedTailMessages: readonly RedactedCoreMessage[];
  readonly trailingMessages: readonly RedactedCoreMessage[];
  readonly skillBlocks: readonly string[];
}

interface XaiRawSummary {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

const logger = createLogger("@anysphere/agent");
const compactionInputTokens = createHistogram("xai_compaction.input_token", {
  description: "Input tokens consumed during XAI compaction",
});
const compactionOutputTokens = createHistogram("xai_compaction.output_token", {
  description: "Output tokens generated during XAI compaction",
});
const compactionCacheReadTokens = createHistogram("xai_compaction.cache_read_token", {
  description: "Cache read tokens during XAI compaction",
});
const compactionCacheWriteTokens = createHistogram("xai_compaction.cache_write_token", {
  description: "Cache write tokens during XAI compaction",
});
const compactionTimeTakenMs = createHistogram("xai_compaction.time_taken_ms", {
  description: "Time taken for XAI compaction in milliseconds",
});
const compactionStatus = createCounter("xai_compaction.status", {
  description: "Count of XAI compaction attempts and their outcomes",
  labelNames: ["outcome", "errorKind"],
});

export interface XaiCompactionHandlerOptions extends SelfSummaryRetryOptions {
  readonly promptVariant?: XaiCompactionPromptVariant | undefined;
  readonly enableTranscriptEnrichment?: boolean | undefined;
  readonly deliveryTail?: DeliveryTailConfig | undefined;
}

/**
 * Port of official 0.71 host XaiCompactionHandler: compact via prompt +
 * continue the session with buildContinuePrompt (evidence: host-main.cjs).
 */
export class XaiCompactionHandler {
  declare readonly promptSession: SelfSummaryPromptSession;
  declare readonly stateHandler: SelfSummaryStateHandler;
  declare readonly interactionListener: RedactedInteractionListener;
  declare readonly tools: SelfSummaryTool[];
  declare readonly extraT: unknown;
  declare readonly modelId: string;
  declare readonly retryOptions: SelfSummaryRetryOptions;
  declare readonly enableTranscriptEnrichment: boolean;
  declare readonly deliveryTail: DeliveryTailConfig | undefined;
  declare readonly compactionPrompt: string;
  declare readonly carrierSegmentDirs: WeakMap<object, string>;

  constructor(
    promptSession: SelfSummaryPromptSession,
    stateHandler: SelfSummaryStateHandler,
    interactionListener: RedactedInteractionListener,
    tools: SelfSummaryTool[],
    extraT: unknown,
    modelId: string,
    options: XaiCompactionHandlerOptions = {},
  ) {
    const {
      enableTranscriptEnrichment = false,
      promptVariant,
      deliveryTail = SAND_COMPACTION_DELIVERY_TAIL,
      ...retryOptions
    } = options;
    this.promptSession = promptSession;
    this.stateHandler = stateHandler;
    this.interactionListener = interactionListener;
    this.tools = tools;
    this.extraT = extraT;
    this.modelId = modelId;
    this.retryOptions = retryOptions;
    this.enableTranscriptEnrichment = enableTranscriptEnrichment;
    this.deliveryTail = deliveryTail;
    this.compactionPrompt = xaiCompactionPromptForVariant(promptVariant);
    this.carrierSegmentDirs = new WeakMap();
  }

  getModelId(): string { return this.modelId; }
  getMetricsModelLabel(): string { return this.modelId; }

  partitionMessages(
    messages: readonly RedactedCoreMessage[],
    options: SummarizationPipelineOptions,
  ): XaiPartition {
    const { systemMessage, userInfoMessage, messagesForSummarization } =
      prepareMessagesForCompaction(messages);
    if (!systemMessage) {
      throw new Error("Expected system message in conversation");
    }
    const lastRealUserMessage = findLastRealUserMessageForCompaction(
      messagesForSummarization,
      message =>
        extractTextContent(message).unwrap(PrivacyCapability.UNSAFE_ALWAYS_ALLOWED),
    );
    return {
      systemMessage,
      userInfoMessage,
      messagesToSummarize: messagesForSummarization,
      preservedTailMessages: lastRealUserMessage !== undefined ? [lastRealUserMessage] : [],
      trailingMessages: selectSelfSummaryDeliveryTail(
        messages,
        options,
        this.deliveryTail,
        findLastUserMessageIndex,
      ),
      skillBlocks: collectAllSkillBlocks(messagesForSummarization),
    };
  }

  async generateSummary(
    ctx: Context,
    partitioned: XaiPartition,
    _options: SummarizationPipelineOptions,
  ): Promise<XaiRawSummary> {
    if (!partitioned.systemMessage) throw new Error("Expected system message in conversation");
    const privacySource = partitioned.preservedTailMessages[0] ??
      partitioned.userInfoMessage ?? partitioned.systemMessage;
    logger.info(ctx, "[xai-compaction] generating summary via compaction prompt", {
      preservedUserMessageCount: partitioned.preservedTailMessages.length,
      trailingMessageCount: partitioned.trailingMessages.length,
    });
    const inputMessages: RedactedCoreMessage[] = [
      partitioned.systemMessage,
      ...(partitioned.userInfoMessage ? [partitioned.userInfoMessage] : []),
      ...partitioned.messagesToSummarize,
      {
        _privacyMode: privacySource._privacyMode,
        role: "user",
        content: safeString(this.compactionPrompt),
        providerOptions: SUMMARIZATION_CURSOR_PROVIDER_OPTIONS,
      },
    ];
    const unredact = (message: RedactedCoreMessage) =>
      fromRedactedCoreMessage(message, PrivacyCapability.UNSAFE_ALWAYS_ALLOWED);
    const { assistantMessage, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } =
      await executeSelfSummaryWithRetry(
        ctx,
        this.promptSession,
        this.stateHandler,
        this.interactionListener,
        inputMessages.map(unredact),
        this.tools,
        this.extraT,
        {
          preservedPrefixMessageCount: 1 + (partitioned.userInfoMessage !== undefined ? 1 : 0),
          ...this.retryOptions,
        },
      );
    compactionInputTokens.histogram(ctx, inputTokens);
    compactionOutputTokens.histogram(ctx, outputTokens);
    compactionCacheReadTokens.histogram(ctx, cacheReadTokens!);
    compactionCacheWriteTokens.histogram(ctx, cacheWriteTokens!);
    const text = extractTextContent(
      toRedactedCoreMessage(assistantMessage, this.stateHandler.getPrivacyMode()),
    ).unwrap(PrivacyCapability.UNSAFE_ALWAYS_ALLOWED);
    return { text, inputTokens, outputTokens };
  }

  buildSummaryMessage(
    rawSummary: XaiRawSummary,
    partitioned: XaiPartition,
    enrichments: SummarizationEnrichments,
  ): { message: RedactedCoreMessage; summaryTextLength: number } {
    const segmentsDir =
      typeof enrichments.agentTranscriptsFolder === "string" &&
      enrichments.agentTranscriptsFolder.length > 0 &&
      typeof enrichments.conversationId === "string" &&
      enrichments.conversationId.length > 0
        ? compactionSegmentsDir({
          agentTranscriptsFolder: enrichments.agentTranscriptsFolder,
          conversationId: enrichments.conversationId,
          subagentId: typeof enrichments.subagentId === "string"
            ? enrichments.subagentId
            : undefined,
        })
        : undefined;
    if (segmentsDir !== undefined) {
      this.carrierSegmentDirs.set(rawSummary, segmentsDir);
    }
    const durableBlocks = renderDurableBlocks(
      "xai-compaction",
      enrichments as DurableBlockEnrichments,
      { includeTranscript: segmentsDir === undefined && this.enableTranscriptEnrichment },
    );
    const summary = rawSummary.text +
      (segmentsDir === undefined ? "" : formatCompactionSegmentsHint(segmentsDir)) +
      appendDurableBlocks("xai-compaction", durableBlocks);
    const content = buildContinuePrompt(summary);
    const privacySource = partitioned.preservedTailMessages[0] ??
      partitioned.userInfoMessage ?? partitioned.systemMessage;
    if (privacySource === undefined) {
      throw new Error("Expected compaction context");
    }
    return {
      message: toRedactedCoreMessage({
        role: "user",
        content,
        providerOptions: { cursor: { isSummary: true } },
      }, privacySource._privacyMode),
      summaryTextLength: content.length,
    };
  }

  assembleFinalMessages(
    partitioned: XaiPartition,
    summaryMessage: RedactedCoreMessage,
  ): readonly RedactedCoreMessage[] {
    if (!partitioned.systemMessage) throw new Error("Expected system message in conversation");
    return [
      partitioned.systemMessage,
      ...(partitioned.userInfoMessage ? [partitioned.userInfoMessage] : []),
      ...partitioned.preservedTailMessages,
      summaryMessage,
    ];
  }

  async summarize(
    ctx: Context,
    messages: readonly RedactedCoreMessage[],
    options: SummarizationPipelineOptions,
  ): Promise<SummarizationResult> {
    using spanContext = createSpan(ctx.withName("XaiCompactionHandler.summarize"));
    const innerCtx = spanContext.ctx;
    const startTime = performance.now();
    logger.info(innerCtx, "[xai-compaction] summarize starting", {
      messageCount: messages.length,
      modelId: this.modelId,
    });
    try {
      const pipelineResult = await runSummarizationPipeline(this, innerCtx, messages, options);
      const summaryCodeString = createRedactedString(
        pipelineResult.rawSummary.text,
        DataClassification.CODE,
        "compaction-summary",
        this.stateHandler.getPrivacyMode(),
      );
      const compactionSegmentsDirPath = this.carrierSegmentDirs.get(pipelineResult.rawSummary);
      logger.info(innerCtx, "[xai-compaction] summarize completed", {
        summaryTextLength: pipelineResult.rawSummary.text.length,
        fullReplacementMessagesCount: pipelineResult.fullReplacementMessages.length,
        messagesActuallySummarizedCount: pipelineResult.messagesActuallySummarized.length,
        compactionSegmentsDir: compactionSegmentsDirPath,
      });
      compactionStatus.increment(innerCtx, 1, { outcome: "success", errorKind: "Ok" });
      return {
        ...pipelineResult,
        summary: { summary: summaryCodeString },
        ...(compactionSegmentsDirPath === undefined
          ? {}
          : { compactionSegmentsDir: compactionSegmentsDirPath }),
        onPersisted: () => { this.stateHandler.incrementSelfSummaryCount(); },
      };
    } catch (error) {
      const errorKind = getRetryDirective(error, { transientRetryDelayMs: 0 }).errorType;
      compactionStatus.increment(innerCtx, 1, { outcome: "failed", errorKind });
      throw error;
    } finally {
      compactionTimeTakenMs.histogram(innerCtx, performance.now() - startTime);
    }
  }
}
