import { dirname } from "node:path";
import { createContext } from "../packages/context/core.js";
import { TranscriptManager } from "./extensions/transcript/transcript-manager.js";
import { createReviewInteractions } from "./review-interactions-service.js";
import { createReviewPrivateBox } from "./review-private-box.js";
import type { PrivateUserFormBox } from "./runner/browser/user-form-fill.js";
import { createReviewAttachmentResolver } from "./review-attachments.js";
import { ReviewTranscriptStore } from "./extensions/transcript/review-transcript-store.js";
import { bindAgentBoxPrewarmPort, bindAttachmentStagingPort } from "./attachment-runtime-ports.js";
import { TranscriptMirrorOffloadPool } from "./agent-isolation/transcript-mirror-offload.js";
import type {
  CreateProductionRunnerRunStep,
  ProductionTurnHostDependencies,
  ProductionTurnHostToolProjections,
  ProductionTurnAutoReviewHostProjection,
  ProductionTurnCancelThisRun,
  ProductionTurnExternalAwaitInputs,
  ProductionTurnEmitUpdate,
  ProductionTurnToolInputs,
} from "./runner-production-bridge.js";
import {
  createProductionTurnToolInputs,
  createProductionTurnToolsetHost,
  type ProductionTurnToolsetHostInput,
} from "./runner-production-bridge.js";
import { NoopConversationActionReceiver } from "../packages/agent-core/conversation-actions/remote.js";
import {
  RequestContext,
  RequestContextEnv,
} from "../packages/proto/generated/agent/v1/request_context_exec_pb.js";
import {
  SummarizationHandler,
  type SummarizationPromptSession,
} from "../packages/agent-summarization/summarization-handler.js";
import { getAgentBlobStore } from "./runner/sand-agent-runner.js";
import type { AgentProfileForRunner } from "./runner/sand-agent-runner.js";
import type {
  AutomationRecord,
  AutomationReview,
  WorkflowRecord,
} from "./runner/tools/sand-state-tool.js";
import { buildContextToolDependencies } from "./runner/tools/context-tools.js";
import { createRunnerMemoryContext, isTurnMemoryStore, isEpisodeProgress } from "./runner/memory-context.js";
import { isMemorableExchange } from "./runner/sand-memory.js";
import { createPromptTranscriptSource, hasPromptTranscriptState, readOwnedSubagentTranscript } from "./runner/transcript-blobs.js";
import { createLocalConversationAccess } from "./runner/sessions/transcript-reader.js";
import { promptSectionSnapshotStore } from "./runner/sessions/related-conversations-section.js";
import { createPromptPrefixObserver } from "./runner/prompt-prefix-observation.js";
import { FileAutomationStore } from "./automations/automation-store.js";
import { createDelegatedWorkStopper } from "./runner/delegated-work-stop.js";
import { createSandLoopDetectionPolicy, parseSandLoopDetectionMode } from "./runner/loop-detection-policy.js";
import type { DelegatedStopOutcome, DelegatedStopRequest } from "./runner/tools/sand-subagent-management-tools.js";
import type {
  CloudAgentApi,
  CloudAgentToolContext,
  CloudAgentToolDeps,
} from "./cloud-agents/cloud-agent-tool.js";
import {
  SAND_EXTERNAL_READ_TOOL_DESCRIPTION,
  SAND_BOX_READ_TOOL_DESCRIPTION,
  SAND_READ_FORMATTING_OPTIONS,
  type TurnToolsetHostFactoryProvider,
} from "./runner/tools/turn-toolset.js";
import type {
  TurnAwaitToolFactoryInput,
  TurnBrowserToolFactoryInput,
  TurnBoxHelpToolFactoryInput,
  TurnCloudAgentToolFactoryInput,
  TurnComputerToolFactoryInput,
  TurnMcpMetaToolFactoryInput,
  TurnMcpManagementToolFactoryInput,
  TurnTaskToolFactoryInput,
  TurnReadToolFactoryInput,
  TurnWebFetchToolFactoryInput,
  TurnWebSearchToolFactoryInput,
} from "./runner/tools/turn-toolset.js";
import { fencedToolSet } from "./runner/tools/sand-spotlight-tools.js";
import type {
  RemoteResource,
  ResourceAccessor,
} from "../packages/agent-exec/resource-provider.js";
import { subagentExecutorResource } from "../packages/agent-exec/subagent.js";
import { requestContextExecutorResource } from "../packages/agent-exec/request-context.js";
import { subagentRegistryResource } from "../packages/agent/tools/subagent-registry.js";
import { smartModeClassifierExecutorResource } from "../packages/agent-exec/smart-mode-classifier.js";
import { mcpExecutorResource, mcpStateExecutorResource } from "../packages/agent-exec/mcp.js";
import { shellStreamExecutorResource } from "../packages/agent-exec/shell-stream.js";
import { backgroundShellExecutorResource } from "../packages/agent-exec/background-shell.js";
import type { RemoteExecManager } from "../packages/agent-exec/remote.js";
import {
  SAND_BOX_AWAIT_SHELL_TOOL_NAME,
  SAND_BOX_READ_TOOL_NAME,
  SAND_EXTERNAL_AWAIT_SHELL_TOOL_NAME,
  SAND_EXTERNAL_READ_TOOL_NAME,
} from "./sand-activity.js";
import { connectorCardEmissionToMessage } from "./runner/tools/box-help-tool.js";
import { createAgentPromptSession } from "./extensions/inference/extension.js";
import { resolveInferenceContextWindowTokens } from "./extensions/inference/provider-session.js";
import { LOCAL_AUTO_COMPACT_TOKEN_LIMIT, readOpenRouterModelContextWindow } from "../shared/node/openrouter-proxy.js";
import { localBackgroundSummarizationPropsForWindow } from "../packages/agent-summarization/background-summarization.js";
import { SAND_COMPACTION_DELIVERY_TAIL } from "../packages/agent-summarization/delivery-tail.js";
import { LIBRARY_MAIN_STORE } from "./extensions/library/extension.js";
import { captureLibraryMcpExecution } from "../shared/library/mcp-result-hook.js";
import { CONNECTOR_MANIFESTS } from "../shared/channels.js";
import { parseStoredTrigger } from "./automations/automation-trigger.js";
import { listenerPlatformsInTrigger } from "./automations/listener-integrations.js";
import { resolveSharedRoomBoxToolsEnabled } from "./groups/xuser.js";
import { boxAgentWindowIndex, boxSupportsMultiWindow } from "./box/box-capabilities.js";
import { agentMediaReadScopeKey } from "./box/protected-path-guard.js";
import { CombinedResourceAccessor, resourceEntry } from "../packages/agent-exec/resource-provider.js";
import { readExecutorResource } from "../packages/agent-exec/read.js";
import { createAutoReviewGate } from "./runner/auto-review-gate.js";
import { createSandMcpApprovalProvider } from "./runner/sand-auto-review-tool-escalations.js";
import {
  sandAutoReviewApprovalExpiryPolicy,
  SandAutoReviewController,
} from "./runner/sand-auto-review.js";
import {
  createHostBrowserDriverDependencies,
  createHostComputerToolDependencies,
  createHostShellExecutor,
  type HostBrowserBoxOwner,
} from "./runner/host-computer-tool-dependencies.js";
import {
  createRemoteBoxResourceAccessor,
  type RemoteBoxResourceHost,
} from "./runner/remote-box-resources.js";
import { createStreamAttempt } from "./runner/stream-attempt.js";
import {
  createTurnAgentRunStreamInput,
  createTurnAgentStreamStart,
  type TurnMcpProjectionInput,
  type TurnLocalResourceProjectionInput,
} from "./runner/turn-agent-composition.js";
import {
  createProductionTurnAgentOwner,
  createProductionTurnAgentRunInput,
  type ProductionTurnAgentOwnerInput,
} from "./runner/production-turn-agent-owner.js";
 import {
   createProductionTurnRunShellHostInput,
   type ProductionTurnRunShellHostInput,
 } from "./runner/production-turn-run-shell-adapter.js";
import {
  createPromptCollectorGlue,
  type PromptCollectorHost,
} from "./runner/prompt-collector-glue.js";
import type { GeneratedTurnPromptOptions } from "./runner/prompt-collector-glue.js";
import { createRunnerPromptGlue } from "./runner/runner-prompt-glue.js";
import {
  createShellWatchGeneratedStateProjection,
  createShellWatchReadAccessor,
  type ShellTerminalWatchHost,
} from "./runner/shell-terminal-watch.js";
import { DEFAULT_SAND_SYSTEM_PROMPT } from "./runner/system-prompt.js";
 import { builtinSubagentConfigs, isComputerUseSubagentType } from "./runner/tools/sand-computer-use-subagent.js";
 import { isBrowserUseSubagentType } from "./runner/tools/sand-browser-use-subagent.js";
import {
  createSystemPromptAssembly,
  type PromptSnapshotStore,
} from "./runner/system-prompt-assembly.js";
import { PrivacyMode, type PrivacyMode as PrivacyModeValue } from "../packages/redaction/privacy-mode.js";
import { ConversationStateStructure } from "../packages/proto/generated/agent/v1/agent_pb.js";
import { tryExtractSandAutoReviewClassifierConversationContext } from "../packages/agent/smart-mode-classifier-context.js";
import {
  buildSandAutomationWriteRiskTarget,
  reviewSandAutomationWrite,
} from "./runner/sand-automation-auto-review.js";
import {
  runSandAutoReviewClassifier,
} from "./runner/sand-auto-review-classifier-run.js";
import { SAND_AUTOMATION_WRITE_CLASSIFIER_ERROR_REASON } from "./runner/sand-automation-auto-review.js";
import { surfaceListenerConnectCards } from "./runner/tools/listener-connect-cards.js";
import { boundedConnectorTag } from "../shared/observability/connector-auth-telemetry.js";
import { errorLogTag } from "../shared/errors.js";
import {
  mcpErrorClassOf,
  takeMcpExecErrorClass,
} from "../shared/node/mcp/mcp-diagnostics.js";
import {
  buildSandCloudAgentRiskTarget,
  buildSandCloudAgentLifecycleReviewTarget,
  buildSandCloudAgentReviewTarget,
  describeSandCloudAgentReviewImages,
  reviewSandCloudAgentAction,
  reviewSandCloudAgentLifecycleAction,
  SAND_CLOUD_AGENT_CLASSIFIER_ERROR_REASON,
} from "./runner/sand-cloud-agent-auto-review.js";
import type { Context } from "../packages/context/core.js";
import type {
  TurnShellAutoReviewInput,
  TurnToolsetHost,
  TurnToolsetTurnInput,
} from "./runner/tools/turn-toolset.js";
import type { TurnCheckpoint, TurnSettleHost } from "./runner/turn-settle.js";
import type { TextExecutor } from "./runner/sand-memory.js";
import type { RunnerPromptGlueOwner } from "./runner/runner-prompt-glue.js";
import type { TransferBox } from "./box/box-transfer.js";
import type { CapableBox } from "./box/box-capabilities.js";
import type { UserComputerHandle } from "./runner/tools/sand-file-transfer-tools.js";
import type { AgentProfilePromptSnapshot } from "./runner/sand-agent-profile-prompt.js";
import type {
  RunningSubagentInfo,
  SubagentManagementController,
} from "./runner/tools/sand-subagent-management-tools.js";
import type {
  SubagentSession,
  SubagentRunOptions,
} from "./runner/subagent-runtime.js";
import type {
  SubagentAdapterArgs,
} from "./runner/agent-adapters.js";
import type { CursorRule } from "../packages/proto/generated/agent/v1/cursor_rules_pb.js";

export const DEFAULT_SAND_MODEL = "gpt-5.5-high-fast";
export const SAND_SUMMARIZATION_MAX_PROMPT_CHARS = 2_800_000;

type DynamicApi = Record<string, any>;

export interface HostRunnerSession {
  readonly id: string;
  readonly dbPath: string;
  readonly agentStore?: DynamicApi;
  readonly memory?: unknown;
  readonly automations?: unknown;
  readonly workflows?: unknown;
  readonly channels?: unknown;
  readonly db?: unknown;
}

export interface HostRunnerHooks {
  readonly transport: {
    onUpdate(
      update: unknown,
      cancelThisRun?: ProductionTurnCancelThisRun,
    ): void;
    lastSentMessageId?(): string | undefined;
    lastReactionApplied?(): boolean;
  };
  /** Exact turn-scoped card emitter; omitted callers remain fail-closed. */
  readonly emitUpdate?: ProductionTurnEmitUpdate;
  readonly onRunLifecycle?: (event: unknown) => void;
  readonly agentProfileProvider?: () => AgentProfileForRunner | null;
  readonly ingestAttachment?: (sourcePath: string) => Promise<string>;
  readonly persistImage?: (...args: any[]) => unknown;
  readonly persistMediaBytes?: (
    filename: string,
    data: Uint8Array,
  ) => Promise<string | null>;
}

export interface HostRunnerOverrides {
  readonly groupMemberTurn?: boolean;
  readonly isSharedRoomTurn?: boolean;
  readonly systemPrompt?: unknown;
  readonly [key: string]: unknown;
}

export interface HostRunnerExtensions {
  api(id: string): DynamicApi;
}

/**
 * The per-turn resource owner is created only after the box has been made
 * ready.  The box owns the remote accessor; this boundary deliberately does
 * not cache it or manufacture a fallback accessor between turns.
 */
export interface ProductionBoxResourceOwner {
  ensureReady(
    context: unknown,
    agentId: string,
  ): Promise<{ readonly remoteAccessor?: unknown }>;
}

export type ProductionResourceAccessor = ResourceAccessor<RemoteExecManager>;

export function createPerTurnResourceAccessor(
  owner: ProductionBoxResourceOwner,
  agentId: string,
): (context: unknown) => Promise<ProductionResourceAccessor> {
  return async (context: unknown): Promise<ProductionResourceAccessor> => {
    const connection = await owner.ensureReady(context, agentId);
    const accessor = connection?.remoteAccessor;
    if (
      typeof accessor !== "object"
      || accessor == null
      || typeof (accessor as { readonly get?: unknown }).get !== "function"
    ) {
      throw new TypeError("production Agent resource accessor is not bound");
    }
    return accessor as ProductionResourceAccessor;
  };
}

export interface ProductionSessionBoundRunner {
  readonly subagents: {
    readonly sessions: Map<string, SubagentSession>;
    isRunning(agentId: string): boolean;
    dispatchBackgroundSubagent(input: Parameters<
      TurnLocalResourceProjectionInput["subagentDispatcher"]["dispatch"]
    >[0]): void;
  };
  readonly computerUse: {
    allocateWindow(agentId: string): unknown | null;
    freeWindow(agentId: string): void;
  } | undefined;
  run(prompt: string, options?: SubagentRunOptions): Promise<unknown>;
  interrupt(reason: string): unknown;
  stopSubagents?(): void;
  endTurnAwaitingUser?(reason: string): void;
  getResolvedOutline(): Promise<readonly unknown[]>;
  getObservedToolCallCount(): number;
  getActivitySnapshot(): readonly string[];
  getTranscriptPath(): string | null;
  setAgentStore(agentStore: unknown, agentProfileProvider?: unknown): void;
  setMemoryStore(memoryStore: unknown): void;
  setUserMemory(userMemory: unknown): void;
  setProjectMemory(projectMemory: unknown): void;
  setMemorySnapshotStore(memorySnapshots: unknown): void;
  setProfilePromptSnapshotStore(profilePromptSnapshots: unknown): void;
  setEpisodeProgress(episodeProgress: unknown): void;
  setAutomationStore(automationStore: unknown): void;
  setWorkflowStore(workflowStore: unknown): void;
  setChannelStore(channelStore: unknown): void;
  setMcp(mcp: unknown): void;
  setMcpManagement(mcpManagement: unknown): void;
  setAttachmentIngestor(ingest: unknown): void;
  setImagePersister(persistImage: unknown): void;
  setMediaBytesPersister(persistMediaBytes: unknown): void;
}

export interface HostRunnerCompositionDependencies<Runner extends ProductionSessionBoundRunner = ProductionSessionBoundRunner> {
  readonly extensions: HostRunnerExtensions;
  readonly ctx: unknown;
  emitGatewayEvent(event: unknown): void;
  buildRunner(options: Record<string, unknown>): Runner;
  readonly createRunStep?: CreateProductionRunnerRunStep;
  createRequestContext?(options: {
    transcriptsDir: string;
    getUserTimeZone(): unknown;
    resolveTeamRules(): Promise<unknown>;
    getUserFullName(): Promise<unknown>;
  }): unknown;
  createTranscriptMirror?(options: {
    transcriptsDir: string;
    session: HostRunnerSession;
    pool: () => TranscriptMirrorOffloadPool;
    reportOutcome(report: unknown): void;
    isJournalEnabled(): Promise<boolean>;
  }): unknown;
  decorateActionAuditor?(
    actionAuditor: unknown,
    callbacks: {
      onBotBlock(hit: any, record: any): void;
      onSiteVisit(visit: any, record: any): void;
    }
  ): unknown;
  readonly mirrorPoolFactory?: () => TranscriptMirrorOffloadPool;
}

export interface RecoveredHostRunnerComposition<Runner extends ProductionSessionBoundRunner> {
  createRunner(session: HostRunnerSession, hooks: HostRunnerHooks): Runner;
  createGroupMemberRunner(
    session: HostRunnerSession,
    hooks: HostRunnerHooks,
    overrides: HostRunnerOverrides
  ): Runner;
  canAskLocalToolPermission(agentId: string): boolean;
  forgetLocalToolPermission(agentId: string): void;
  dispose(): Promise<void>;
}

function method(api: DynamicApi | undefined, name: string): ((...args: any[]) => any) | undefined {
  if (api == null) return undefined;
  const candidate = api[name];
  return typeof candidate === "function" ? candidate.bind(api) : undefined;
}

function asSandAutoReviewController(value: unknown): SandAutoReviewController | undefined {
  return value instanceof SandAutoReviewController ? value : undefined;
}

function asActionAuditor(
  value: unknown,
): NonNullable<ProductionTurnAutoReviewHostProjection["actionAuditor"]> | undefined {
  if (typeof value !== "object" || value == null) return undefined;
  const record = (value as Record<string, unknown>).record;
  if (typeof record !== "function") return undefined;
  return { record: entry => record.call(value, entry) };
}

function asLocalToolPermissionProjection(
  value: unknown,
): NonNullable<ProductionTurnAutoReviewHostProjection["localToolPermission"]> | undefined {
  if (typeof value !== "object" || value == null) return undefined;
  const candidate = value as Record<string, unknown>;
  const awaitDesktopStandingDecision = candidate.awaitDesktopStandingDecision;
  const completeScope = candidate.completeScope;
  if (
    typeof awaitDesktopStandingDecision !== "function"
    || typeof completeScope !== "function"
  ) return undefined;
  return {
    awaitDesktopStandingDecision: args =>
      awaitDesktopStandingDecision.call(value, args),
    completeScope: scope => completeScope.call(value, scope),
  };
}

type ProductionClassifierStateHandler = Parameters<
  typeof tryExtractSandAutoReviewClassifierConversationContext
>[1];

function asProductionClassifierStateHandler(
  value: unknown,
): ProductionClassifierStateHandler | undefined {
  if (typeof value !== "object" || value == null) return undefined;
  const candidate = value as Record<string, unknown>;
  const turns = candidate.turns;
  const rootPromptBuilder = candidate.rootPromptBuilder;
  if (
    !Array.isArray(turns)
    || typeof rootPromptBuilder !== "object"
    || rootPromptBuilder == null
    || typeof (rootPromptBuilder as Record<string, unknown>).getState !== "function"
  ) return undefined;
  return value as ProductionClassifierStateHandler;
}

export async function extractProductionTurnAutoReviewConversationContext(
  context: Context,
  stateHandler: unknown,
) {
  const candidate = asProductionClassifierStateHandler(stateHandler);
  if (candidate === undefined) return [];
  return [
    ...await tryExtractSandAutoReviewClassifierConversationContext(
      context,
      candidate,
    ),
  ];
}

function isAgentContext(value: unknown): value is Context {
  return typeof value === "object" && value != null
    && typeof (value as { with?: unknown }).with === "function"
    && typeof (value as { get?: unknown }).get === "function"
    && typeof (value as { withCancel?: unknown }).withCancel === "function";
}

interface PromptRequestContext {
  resolve(): {
    readonly osVersion?: string;
    readonly shell?: string;
    readonly timeZone?: string;
    readonly transcriptsFolder?: string;
    readonly userFullName?: string;
  };
  resolveRules(): Promise<CursorRule[] | undefined>;
}

function asTransferBox(value: unknown): TransferBox | undefined {
  if (typeof value !== "object" || value == null) return undefined;
  const candidate = value as Record<string, unknown>;
  const downloadFile = candidate.downloadFile;
  const uploadFile = candidate.uploadFile;
  if (typeof downloadFile !== "function" || typeof uploadFile !== "function") return undefined;
  return {
    downloadFile: (context, agentId, path) =>
      downloadFile.call(value, context, agentId, path),
    uploadFile: (context, agentId, path, data) =>
      uploadFile.call(value, context, agentId, path, data),
  };
}

function asCapableTransferBox(value: unknown): TransferBox & CapableBox | undefined {
  const transfer = asTransferBox(value);
  if (transfer === undefined) return undefined;
  if (typeof value !== "object" || value == null) return undefined;
  const candidate = value as Record<string, unknown>;
  const capable: TransferBox & CapableBox = transfer;
  const getTerminalsFolder = candidate.getTerminalsFolder;
  if (typeof getTerminalsFolder === "function") {
    capable.getTerminalsFolder = () => getTerminalsFolder.call(value);
  }
  const isAvailable = candidate.isAvailable;
  if (typeof isAvailable === "function") {
    capable.isAvailable = () => isAvailable.call(value);
  }
  const isPreparing = candidate.isPreparing;
  if (typeof isPreparing === "function") {
    capable.isPreparing = (agentId) => isPreparing.call(value, agentId);
  }
  const getAgentWindowIndex = candidate.getAgentWindowIndex;
  if (typeof getAgentWindowIndex === "function") {
    capable.getAgentWindowIndex = agentId => getAgentWindowIndex.call(value, agentId);
  }
  return capable;
}

type RemoteBoxResourceOwner = RemoteBoxResourceHost["remoteBox"];

function asRemoteBoxResourceOwner(value: unknown): RemoteBoxResourceOwner | undefined {
  const capable = asCapableTransferBox(value);
  if (capable === undefined || typeof value !== "object" || value == null) return undefined;
  const ensureReady = (value as Record<string, unknown>).ensureReady;
  if (typeof ensureReady !== "function") return undefined;
  return {
    ...capable,
    ensureReady: (context, agentId) => ensureReady.call(value, context, agentId),
  };
}

function asProductionResourceAccessor(
  registry: ReturnType<typeof createRemoteBoxResourceAccessor>,
): ProductionResourceAccessor {
  return {
    get<Implementation>(
      resource: RemoteResource<Implementation, RemoteExecManager>,
    ): Implementation {
      const value = registry.get({
        symbol: resource.symbol,
        remoteImplementation: resource.remoteImplementation,
        registerControlledImplementation: () => {},
      });
      if (value === undefined) {
        const knownResources: ReadonlyArray<readonly [symbol, string]> = [
          [subagentExecutorResource.symbol, "subagentExecutorResource"],
          [requestContextExecutorResource.symbol, "requestContextExecutorResource"],
          [subagentRegistryResource.symbol, "subagentRegistryResource"],
          [smartModeClassifierExecutorResource.symbol, "smartModeClassifierExecutorResource"],
          [mcpExecutorResource.symbol, "mcpExecutorResource"],
          [mcpStateExecutorResource.symbol, "mcpStateExecutorResource"],
          [shellStreamExecutorResource.symbol, "shellStreamExecutorResource"],
          [backgroundShellExecutorResource.symbol, "backgroundShellExecutorResource"],
        ];
        const resourceName = knownResources.find(([known]) => known === resource.symbol)?.[1]
          ?? "unknownResource";
        const implementationSource = Function.prototype.toString.call(
          resource.remoteImplementation,
        );
        const requestedResourceProvenance = {
          resourceName,
          symbolDescription: resource.symbol.description ?? null,
          symbolRegistryKey: Symbol.keyFor(resource.symbol) ?? null,
          remoteImplementationName: resource.remoteImplementation.name || null,
          wireNames: Array.from(
            implementationSource.matchAll(/["']([A-Za-z][A-Za-z0-9]*)["']/g),
            match => match[1],
          ),
        } as const;
        const error = new TypeError(
          `production remote resource is not registered: ${JSON.stringify(requestedResourceProvenance)}`,
        );
        Object.defineProperties(error, {
          requestedResourceSymbol: { value: resource.symbol, enumerable: true },
          requestedResourceProvenance: {
            value: requestedResourceProvenance,
            enumerable: true,
          },
        });
        console.error("[sand-host] production resource lookup failed", error);
        throw error;
      }
      return value;
    },
  };
}

function asUserComputer(value: unknown): UserComputerHandle | undefined {
  if (typeof value !== "object" || value == null) return undefined;
  const candidate = value as Record<string, unknown>;
  const box = asTransferBox(candidate.box);
  if (
    typeof candidate.id !== "string"
    || typeof candidate.label !== "string"
    || typeof candidate.connected !== "boolean"
    || box === undefined
  ) return undefined;
  return {
    id: candidate.id,
    label: candidate.label,
    connected: candidate.connected,
    box,
  };
}

function asPromptUserComputers(value: unknown): RunnerPromptGlueOwner["userComputers"] | undefined {
  if (typeof value !== "object" || value == null) return undefined;
  const candidate = value as Record<string, unknown>;
  const resolve = candidate.resolve;
  const list = candidate.list;
  if (typeof resolve !== "function" || typeof list !== "function") return undefined;
  return {
    resolve: (computerId) => asUserComputer(resolve.call(value, computerId)),
    list: () => {
      const listed = list.call(value);
      if (!Array.isArray(listed)) return [];
      return listed.flatMap(computer => {
        const resolved = asUserComputer(computer);
        return resolved === undefined ? [] : [resolved];
      });
    },
  };
}

function isGeneratedSelectedVideo(
  value: unknown,
): value is NonNullable<GeneratedTurnPromptOptions["selectedVideos"]>[number] {
  if (typeof value !== "object" || value == null) return false;
  const candidate = value as Record<string, unknown>;
  const dataOrBlobId = candidate.dataOrBlobId;
  return typeof candidate.uuid === "string"
    && typeof candidate.path === "string"
    && typeof candidate.mimeType === "string"
    && typeof candidate.filename === "string"
    && typeof candidate.materializeToFilesystem === "boolean"
    && typeof dataOrBlobId === "object"
    && dataOrBlobId != null
    && typeof (dataOrBlobId as Record<string, unknown>).case === "string";
}

function isAgentProfilePromptSnapshot(value: unknown): value is AgentProfilePromptSnapshot {
  if (typeof value !== "object" || value == null) return false;
  const candidate = value as Record<string, unknown>;
  const systemIdentity = candidate.systemIdentity;
  const announcedIdentity = candidate.announcedIdentity;
  const identity = (entry: unknown): boolean =>
    typeof entry === "object"
    && entry != null
    && typeof (entry as Record<string, unknown>).name === "string"
    && typeof (entry as Record<string, unknown>).description === "string";
  return candidate.version === 1
    && typeof candidate.profileSection === "string"
    && identity(systemIdentity)
    && identity(announcedIdentity)
    && typeof candidate.compactionEpoch === "number";
}

function asPromptSnapshotStore(value: unknown): PromptSnapshotStore | undefined {
  if (typeof value !== "object" || value == null) return undefined;
  const candidate = value as Record<string, unknown>;
  const getSnapshot = candidate.getAgentProfilePromptSnapshot;
  const setSnapshot = candidate.setAgentProfilePromptSnapshot;
  if (typeof getSnapshot !== "function" || typeof setSnapshot !== "function") return undefined;
  return {
    getAgentProfilePromptSnapshot: () => {
      const snapshot = getSnapshot.call(value);
      return isAgentProfilePromptSnapshot(snapshot) ? snapshot : undefined;
    },
    setAgentProfilePromptSnapshot: snapshot => {
      setSnapshot.call(value, snapshot);
    },
  };
}

function createTypedInferenceOwner(
  value: DynamicApi,
): ProductionTurnAgentOwnerInput["inference"] {
  const createSession = method(value, "createSession");
  const resolvePrivacyMode = method(value, "resolvePrivacyMode");
  if (createSession === undefined || resolvePrivacyMode === undefined) {
    throw new TypeError("production inference session/privacy owner is not bound");
  }
  const createSummarizationSession = method(value, "createSummarizationSession");
  return {
    createSession: (onRequestId, options) => createSession(onRequestId, options),
    resolvePrivacyMode: async (): Promise<PrivacyModeValue> => {
      const resolved = await resolvePrivacyMode();
      if (
        resolved === PrivacyMode.UNSPECIFIED
        || resolved === PrivacyMode.NO_STORAGE
        || resolved === PrivacyMode.NO_TRAINING
        || resolved === PrivacyMode.USAGE_DATA_TRAINING_ALLOWED
        || resolved === PrivacyMode.USAGE_CODEBASE_TRAINING_ALLOWED
      ) return resolved;
      throw new TypeError("production inference returned an invalid privacy mode");
    },
    ...(createSummarizationSession === undefined
      ? {}
      : { createSummarizationSession: (onRequestId: (requestId: string) => void, options?: Readonly<Record<string, unknown>>) => createSummarizationSession(onRequestId, options) }),
  };
}

function isTextPromptExecutor(value: unknown): value is Parameters<typeof createTextExecutor>[0] {
  return typeof value === "object" && value !== null
    && ["appendMessages", "clearMessages", "getMessages", "getState", "stream"].every((key) => typeof Reflect.get(value, key) === "function");
}

function createTextExecutor(executor: {
  appendMessages(...args: any[]): void;
  clearMessages(): void;
  getMessages(): readonly unknown[];
  getState(): unknown;
  stream(...args: any[]): unknown;
}): TextExecutor {
  return {
    appendMessages: messages => executor.appendMessages(messages),
    clearMessages: () => executor.clearMessages(),
    getMessages: () => executor.getMessages(),
    getState: () => executor.getState(),
    stream: (context, first, second, options) => {
      const result = executor.stream(context, first, second, options);
      if (typeof result !== "object" || result == null) {
        throw new TypeError("production prompt executor returned no stream");
      }
      const fullStream = (result as Record<string, unknown>).fullStream;
      if (
        typeof fullStream !== "object"
        || fullStream == null
        || typeof (fullStream as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== "function"
      ) throw new TypeError("production prompt executor returned an invalid stream");
      return { fullStream: fullStream as AsyncIterable<{ readonly type: string; readonly textDelta?: string; readonly error?: unknown }> };
    },
  };
}

function toGeneratedTurnPromptOptions(
  options: {
    readonly selectedImages?: readonly unknown[];
    readonly selectedVideos?: readonly unknown[];
    readonly attachedFilePaths?: readonly string[];
    readonly attachedFileSizes?: ReadonlyMap<string, number>;
    readonly richText?: string;
    readonly replyContext?: unknown;
    readonly messageId?: string;
    readonly automationWake?: { readonly id: string };
    readonly isSilenceAllowed?: boolean;
    readonly appendReplyReminder?: boolean;
    readonly hidden?: boolean;
    readonly recentUserMessages?: readonly { readonly id: string; readonly text: string }[];
  },
): GeneratedTurnPromptOptions {
  const selectedImages = options.selectedImages?.flatMap(image => {
    if (typeof image !== "object" || image == null) return [];
    const record = image as Record<string, unknown>;
    const data = record.data;
    if (!(data instanceof Uint8Array)) return [];
    return [{
      data,
      ...(typeof record.path === "string" ? { path: record.path } : {}),
      ...(typeof record.mimeType === "string" ? { mimeType: record.mimeType } : {}),
    }];
  });
  const selectedVideos = options.selectedVideos?.filter(isGeneratedSelectedVideo);
  return {
    ...(selectedImages === undefined ? {} : { selectedImages }),
    ...(selectedVideos === undefined ? {} : { selectedVideos }),
    ...(options.attachedFilePaths === undefined ? {} : { attachedFilePaths: options.attachedFilePaths }),
    ...(options.attachedFileSizes === undefined ? {} : { attachedFileSizes: options.attachedFileSizes }),
    ...(options.richText === undefined ? {} : { richText: options.richText }),
    ...(options.replyContext === undefined ? {} : { replyContext: options.replyContext }),
    ...(options.messageId === undefined ? {} : { messageId: options.messageId }),
    ...(options.automationWake === undefined ? {} : { automationWake: options.automationWake }),
    ...(options.isSilenceAllowed === undefined ? {} : { isSilenceAllowed: options.isSilenceAllowed }),
    ...(options.appendReplyReminder === undefined ? {} : { appendReplyReminder: options.appendReplyReminder }),
    ...(options.hidden === undefined ? {} : { hidden: options.hidden }),
    ...(options.recentUserMessages === undefined ? {} : { recentUserMessages: options.recentUserMessages }),
  };
}

function isPromptRequestContext(value: unknown): value is PromptRequestContext {
  return typeof value === "object" && value != null
    && typeof (value as { resolve?: unknown }).resolve === "function"
    && typeof (value as { resolveRules?: unknown }).resolveRules === "function";
}

function resolveRequestContextEnvironment(
  requestContext: unknown,
): {
  readonly timeZone?: string;
  readonly projectFolder?: string;
  readonly osVersion?: string;
} {
  if (
    typeof requestContext !== "object"
    || requestContext == null
    || typeof (requestContext as { readonly resolve?: unknown }).resolve !== "function"
  ) return {};
  const resolved = (requestContext as { resolve(): unknown }).resolve();
  if (typeof resolved !== "object" || resolved == null) return {};
  const candidate = resolved as Record<string, unknown>;
  const environment = typeof candidate.env === "object" && candidate.env != null
    ? candidate.env as Record<string, unknown>
    : candidate;
  return {
    ...(typeof (candidate.timeZone ?? environment.timeZone) === "string"
      ? { timeZone: (candidate.timeZone ?? environment.timeZone) as string }
      : {}),
    ...(typeof environment.projectFolder === "string"
      ? { projectFolder: environment.projectFolder }
      : {}),
    ...(typeof (candidate.osVersion ?? environment.osVersion) === "string"
      ? { osVersion: (candidate.osVersion ?? environment.osVersion) as string }
      : {}),
  };
}

function isCloudAgentApi(api: DynamicApi): api is CloudAgentApi {
  return ["launch", "list", "listModels", "get", "reply", "rename", "cancel", "setArchived", "delete", "listArtifacts", "getTranscriptDump"]
    .every(name => typeof api[name] === "function");
}

interface RunnerSubagentOwner {
  listRunningSubagents(): readonly RunningSubagentInfo[];
  getRunningSubagent(id: string): RunningSubagentInfo | null;
  steerSubagent(id: string, message: string): "steered" | "not-running" | string;
  abortSubagent(id: string): "aborted" | "not-running" | string;
}

interface RunnerCloudWatchOwner {
  isCloudWatchReady?(): boolean;
  watchCloudAgent(
    id: string,
    options?: { readonly quietOrigin?: string; readonly afterFollowup?: boolean },
  ): void;
}

function isRunnerSubagentOwner(value: unknown): value is RunnerSubagentOwner {
  if (typeof value !== "object" || value == null) return false;
  const candidate = value as Record<string, unknown>;
  return [
    "listRunningSubagents",
    "getRunningSubagent",
    "steerSubagent",
    "abortSubagent",
  ].every(name => typeof candidate[name] === "function");
}

function createRunnerSubagentManagement(
  value: unknown,
): SubagentManagementController<unknown> | undefined {
  if (!isRunnerSubagentOwner(value)) return undefined;
  return {
    listRunningSubagents: () => value.listRunningSubagents(),
    getRunningSubagent: id => value.getRunningSubagent(id) ?? undefined,
    steerSubagent: (id, message) => value.steerSubagent(id, message),
    abortSubagent: id => value.abortSubagent(id),
  };
}

function createRunnerCloudWatch(
  value: unknown,
): CloudAgentToolDeps["watch"] | undefined {
  if (
    typeof value !== "object"
    || value == null
    || typeof (value as Record<string, unknown>).watchCloudAgent !== "function"
  ) return undefined;
  const owner = value as RunnerCloudWatchOwner;
  if (
    typeof owner.isCloudWatchReady === "function"
    && owner.isCloudWatchReady() !== true
  ) return undefined;
  return (id, options) => {
    const quietOrigin = typeof options.quietOrigin === "string"
      ? options.quietOrigin
      : undefined;
    owner.watchCloudAgent(id, {
      ...(quietOrigin === undefined ? {} : { quietOrigin }),
      ...(options.afterFollowup === undefined
        ? {}
        : { afterFollowup: options.afterFollowup }),
    });
  };
}

function requestIdForwarder(hooks: HostRunnerHooks, source: string) {
  return (requestId: string) => {
    hooks.transport.onUpdate({
      type: "request-id",
      requestId,
      source
    });
  };
}

/**
 * Composes each turn runner from extension-owned ports. The composition keeps
 * group-member turns intentionally narrower: they do not receive the private
 * transcript mirror, memory stores, image persistence, or local permission
 * approval surface.
 */
export function createHostRunnerComposition<Runner extends ProductionSessionBoundRunner>(
  deps: HostRunnerCompositionDependencies<Runner>
): RecoveredHostRunnerComposition<Runner> {
  const { extensions, ctx } = deps;
  const auth = extensions.api("auth");
  const localToolPermission = extensions.api("local-tool-permission");
  const localToolPermissionSurfaces = new Map<string, () => void>();
  const ownedRunners = new Set<Runner>();
  const delegatedStopHandlers = new Map<string, (request: DelegatedStopRequest) => Promise<readonly DelegatedStopOutcome[]>>();
  const reviewBoxes = new Map<string, () => Promise<PrivateUserFormBox | undefined>>();
  const reviewTurnIds = new Map<string, string>();
  const reviewTranscript = extensions.api("transcript");
  const reviewInteractions = reviewTranscript instanceof TranscriptManager ? createReviewInteractions({
    transcript: reviewTranscript,
    mcp: extensions.api("mcp").mcp,
    resolveAttachment: createReviewAttachmentResolver(new ReviewTranscriptStore(reviewTranscript), extensions.api("mcp").mcp),
    resolvePrivateBox: async agentId => reviewBoxes.get(agentId)?.(),
    onError: code => console.warn("[sand:review]", code),
  }) : undefined;
  if (reviewInteractions !== undefined) method(reviewTranscript, "setReviewInteractions")?.(reviewInteractions);
  let mirrorOffloadPool: TranscriptMirrorOffloadPool | null = null;

  const getMirrorOffloadPool = () => {
    mirrorOffloadPool ??=
      deps.mirrorPoolFactory?.() ?? new TranscriptMirrorOffloadPool();
    return mirrorOffloadPool;
  };

  const resolveAgentDisplayName = (agentId: string): string | null => {
    const transcript = extensions.api("transcript");
    const roster = method(transcript, "listAgentsSync")?.() ?? [];
    return roster.find(
      (agent: any) => agent.id === agentId && agent.isGroup !== true
    )?.name ?? null;
  };

  function bindLocalPermissionSurface(
    session: HostRunnerSession,
    hooks: HostRunnerHooks,
    overrides: HostRunnerOverrides
  ): void {
    localToolPermissionSurfaces.get(session.id)?.();
    localToolPermissionSurfaces.delete(session.id);
    if (overrides.groupMemberTurn === true) return;

    const subscribe = method(localToolPermission, "subscribe");
    if (subscribe == null) return;
    const unsubscribe = subscribe((event: any) => {
      if (event?.request?.agentId !== session.id) return;

      if (event.type === "created") {
        hooks.transport.onUpdate({
          type: "send-message",
          message: {
            type: "local-tool-permission",
            ask: {
              requestId: event.request.id,
              action: event.request.action,
              target: event.request.target,
              status: "pending",
              ...(event.request.description === undefined
                ? {}
                : { description: event.request.description })
            }
          },
          timestampMs: Date.now()
        });
        return;
      }

      hooks.transport.onUpdate({
        type: "local-tool-permission-status",
        requestId: event.request.id,
        status: event.request.status === "pending"
          ? "expired"
          : event.request.status
      });
    });
    localToolPermissionSurfaces.set(session.id, unsubscribe);
  }

  function createRunner(
    session: HostRunnerSession,
    hooks: HostRunnerHooks,
    overrides: HostRunnerOverrides = {}
  ): Runner {
    const isSharedRoomTurn = overrides.isSharedRoomTurn === true;
    const localExec = extensions.api("local-exec");
    const attachments = extensions.api("attachments");
    const attachmentStaging = bindAttachmentStagingPort(attachments);
    const memory = extensions.api("memory");
    const transcript = extensions.api("transcript");
    const experiments = extensions.api("experiments");
    const telemetry = extensions.api("telemetry");
    const analytics = telemetry.analytics as DynamicApi | undefined;
    const mcp = extensions.api("mcp");
    const sessionApi = extensions.api("session");
    const settings = extensions.api("settings");
    const cloudAgents = extensions.api("cloud-agents");
    const foreverBox = extensions.api("forever-box");
    const boxPrewarm = bindAgentBoxPrewarmPort(foreverBox);
    const remoteBox = foreverBox.box as DynamicApi;
    if (!isSharedRoomTurn) reviewBoxes.set(session.id, async () => {
      const owner = asRemoteBoxResourceOwner(remoteBox), transfer = asTransferBox(remoteBox);
      const download = method(remoteBox, "downloadFile");
      if (owner === undefined || transfer === undefined || download === undefined) return undefined;
      return createReviewPrivateBox({ agentId: session.id, context: createContext(), box: {
        ensureReady: (context, id) => owner.ensureReady(context, id),
        getAgentWindowIndex: id => owner.getAgentWindowIndex?.(id),
        uploadFile: (context, id, path, bytes) => transfer.uploadFile(context, id, path, bytes),
        downloadFile: async (context, id, path, options) => {
          const bytes: unknown = await download(context, id, path, options);
          if (!(bytes instanceof Uint8Array) || options?.maxBytes !== undefined && bytes.byteLength > options.maxBytes) throw new TypeError("Private browser output is unavailable");
          return bytes;
        },
      } });
    });
    const transcriptsDir = method(sessionApi, "transcriptsDir")?.() ??
      dirname(dirname(session.dbPath));

    const actionAuditor = deps.decorateActionAuditor?.(
      extensions.api("action-audit"),
      {
        onBotBlock(hit, record) {
          method(telemetry.brain ?? {}, "reportBotBlock")?.({
            conversationId: record.agentId,
            family: hit.family,
            confidence: hit.confidence,
            blockedHost: hit.blockedHost,
            blockedUrl: hit.blockedUrl
          });
          method(analytics ?? {}, "trackEvent")?.("sand.bot_block", {
            agent_id: record.agentId,
            family: hit.family,
            confidence: hit.confidence,
            blocked_host: hit.blockedHost,
            blocked_url: hit.blockedUrl
          });
        },
        onSiteVisit(visit, record) {
          method(analytics ?? {}, "trackEvent")?.("sand.site.visited", {
            agent_id: record.agentId,
            host: visit.host
          });
        }
      }
    ) ?? extensions.api("action-audit");

    const autoReview = method(
      extensions.api("auto-review"),
      "bindRunner"
    )?.({
      agentId: session.id,
      approvalsResolvable: overrides.groupMemberTurn !== true,
      onUpdate: (update: unknown) => hooks.transport.onUpdate(update)
    }) ?? {};

    const autoReviewController = asSandAutoReviewController(
      autoReview.autoReviewController,
    );

    const autoReviewGate = (() => {
      if (
        autoReviewController == null
        || autoReview.autoReviewModes == null
        || typeof autoReview.getAutoReviewModes !== "function"
      ) return undefined;
      const dependencies = {
        baseModes: autoReview.autoReviewModes,
        getModes: () => autoReview.getAutoReviewModes(),
        controller: () => autoReviewController,
        resolveBoxId: () => session.id,
        ...(typeof autoReview.getAutoReviewInstructions === "function"
          ? { getInstructions: () => autoReview.getAutoReviewInstructions() }
          : {}),
      };
      return createAutoReviewGate(dependencies);
    })();

    const persistImageForTurn = typeof hooks.persistImage === "function"
      ? async (bytes: Uint8Array, mimeType: string) => {
        const result = await hooks.persistImage?.(bytes, mimeType);
        if (
          typeof result === "object"
          && result != null
          && "fileUrl" in result
          && typeof result.fileUrl === "string"
        ) return { fileUrl: result.fileUrl };
        return undefined;
      }
      : undefined;

    const createTurnToolProjections =
      autoReviewGate == null
        ? undefined
        : (input: ProductionTurnToolInputs): ProductionTurnHostToolProjections => {
          const shell = createHostShellExecutor({
            resourceAccessor: input.resourceAccessor,
            assertNoPendingApproval: autoReviewGate.assertNoPendingApproval,
            auditShellCommand: command => {
              method(actionAuditor as DynamicApi, "record")?.({
                agentId: session.id,
                occurredAtMs: Date.now(),
                action: {
                  kind: "shellCommand",
                  command,
                  shellKind: "foreground",
                  target: "box",
                },
              });
            },
          });
          const userAutoRunInstructions = autoReviewGate.userInstructions();
          const projectionAutoReviewModes = autoReviewGate.currentModes();
          const projection = {
            turnToolsetFactoryProvider: createTurnToolsetFactoryProvider(
              hostDependencies(),
              input,
            ),
            createComputerToolDependencies: () => createHostComputerToolDependencies({
              resourceAccessor: input.resourceAccessor,
              autoReview: {
                mode: projectionAutoReviewModes.computer,
                agentId: session.id,
                boxIdentity: {
                  boxId: session.id,
                  windowGeneration: `${autoReviewController?.hostGeneration ?? "host"}:${session.id}`,
                },
                ...(autoReviewController === undefined
                  ? {}
                  : { autoReviewController }),
                extractConversationContext:
                  extractProductionTurnAutoReviewConversationContext,
                getApprovalExpiryPolicy: () =>
                  sandAutoReviewApprovalExpiryPolicy("turn"),
                resolveDisplayNumber: async (context: unknown) => {
                  await method(remoteBox, "ensureReady")?.(context, session.id);
                  const windowIndex = boxAgentWindowIndex(remoteBox as any, session.id);
                  return windowIndex ?? (boxSupportsMultiWindow(remoteBox as any) ? undefined : 1);
                },
                ...(userAutoRunInstructions === undefined
                  ? {}
                  : { userAutoRunInstructions }),
              },
              ...(persistImageForTurn === undefined
                ? {}
                : { persistImage: persistImageForTurn }),
              isUnicodeTypingEnabled: () =>
                method(experiments, "isUnicodeTypingEnabled")?.() ?? false,
              onComputerAction: action => {
                deps.emitGatewayEvent({
                  channel: "computer-action",
                  payload: { agentId: session.id, ...action },
                });
              },
            }),
            createScreenshotToolDependencies: () => createHostComputerToolDependencies({
              resourceAccessor: input.resourceAccessor,
              ...(persistImageForTurn === undefined
                ? {}
                : { persistImage: persistImageForTurn }),
              isUnicodeTypingEnabled: () =>
                method(experiments, "isUnicodeTypingEnabled")?.() ?? false,
            }),
            createBrowserDriverDependencies: () => createHostBrowserDriverDependencies({
              resourceAccessor: input.resourceAccessor,
              box: remoteBox as unknown as HostBrowserBoxOwner<unknown>,
              getBoxId: () => session.id,
              getDefaultViewId: () => session.id,
              executeShell: shell,
              autoReview: {
                mode: projectionAutoReviewModes.computer,
                agentId: session.id,
                boxIdentity: {
                  boxId: session.id,
                  windowGeneration: `${autoReviewController?.hostGeneration ?? "host"}:${session.id}`,
                },
                ...(autoReviewController === undefined
                  ? {}
                  : { autoReviewController }),
                extractConversationContext:
                  extractProductionTurnAutoReviewConversationContext,
                getApprovalExpiryPolicy: () =>
                  sandAutoReviewApprovalExpiryPolicy("turn"),
                resolveDisplayNumber: async (context: unknown) => {
                  await method(remoteBox, "ensureReady")?.(context, session.id);
                  const windowIndex = boxAgentWindowIndex(remoteBox as any, session.id);
                  return windowIndex ?? (boxSupportsMultiWindow(remoteBox as any) ? undefined : 1);
                },
                ...(userAutoRunInstructions === undefined
                  ? {}
                  : { userAutoRunInstructions }),
              },
              ...(persistImageForTurn === undefined
                ? {}
                : { getPersistImage: () => persistImageForTurn }),
            }),
            createBoxShellExecutor: () => shell,
          };
          return projection;
        };

    const createTurnWebAndAwaitProjections = (
      input: ProductionTurnToolInputs,
    ): ProductionTurnHostToolProjections => {
      const inference = extensions.api("inference");
      const webSearchService = method(inference, "createWebSearch")?.({
        modelId: process.env.SAND_AGENT_MODEL ?? DEFAULT_SAND_MODEL,
        onRequestId: requestIdForwarder(hooks, "web-search"),
      });
      const webFetchService = method(inference, "createWebFetch")?.({
        onRequestId: requestIdForwarder(hooks, "web-fetch"),
      });
      const contextEnvironment = webSearchService === undefined
        && webFetchService === undefined
        ? {}
        : resolveRequestContextEnvironment(requestContext);
      const conversationStartedDate = webSearchService === undefined
        ? undefined
        : method(
          input.stateHandler as DynamicApi,
          "getOrInitializeConversationStartedDate",
        )?.(contextEnvironment.timeZone);
      const projectFolder = contextEnvironment.projectFolder;
      const osPlatform = contextEnvironment.osVersion?.split(" ")[0];
      const webSearch = webSearchService === undefined
        ? undefined
        : {
            webSearchService,
            promptVersion: "latest",
            ...(typeof conversationStartedDate === "string"
              ? { conversationStartedDate }
              : {}),
            ...(projectFolder === undefined ? {} : { projectFolder }),
            ...(osPlatform === undefined ? {} : { osPlatform }),
            resourceAccessor: input.resourceAccessor,
          };
      const webFetch = webFetchService === undefined
        ? undefined
        : {
            webFetchService,
            promptVersion: "latest",
            ...(projectFolder === undefined ? {} : { projectFolder }),
            ...(osPlatform === undefined ? {} : { osPlatform }),
            resourceAccessor: input.resourceAccessor,
          };
      const getTerminalsFolder = method(remoteBox, "getTerminalsFolder");
      const externalAwait: ProductionTurnExternalAwaitInputs | undefined =
        getTerminalsFolder === undefined
          ? undefined
          : {
              resourceAccessor: input.resourceAccessor,
              options: {
                toolName: SAND_EXTERNAL_AWAIT_SHELL_TOOL_NAME,
                terminalsFolder: () => getTerminalsFolder() ?? "",
                enableSubagentAwaiting: false,
                defaultBlockUntilMs: 30_000,
                enableJobCompletionNotifications: true,
              },
            };
      return {
        ...(webSearch === undefined ? {} : { webSearch }),
        ...(webFetch === undefined ? {} : { webFetch }),
        ...(externalAwait === undefined ? {} : { externalAwait }),
      };
    };

    bindLocalPermissionSurface(session, hooks, overrides);

    let builtRunner: Runner | undefined;
    let transcriptMirrorForTurn: TurnSettleHost["transcriptMirror"] | undefined;

    const requestContext = isSharedRoomTurn
      ? {
          resolve: () => ({}),
          resolveRules: async () => []
        }
      : deps.createRequestContext?.({
          transcriptsDir,
          getUserTimeZone: () => method(settings, "getUserTimeZone")?.(),
          resolveTeamRules: async () =>
            await method(
              extensions.api("managed-setup"),
              "resolveTeamRules"
            )?.(),
          getUserFullName: async () =>
            await method(auth, "getUserFullName")?.()
        });

    const resolveCloudAgentTitle = async (_ctx: unknown, bcId: string) =>
      (await method(cloudAgents, "get")?.(bcId))?.name;
    const rawAwaitCloudAgent = method(cloudAgents, "awaitCompletion");
    const awaitCloudAgent = rawAwaitCloudAgent === undefined ? undefined : async (id: string, options: { waitForRestart: boolean }) => {
      const result = await rawAwaitCloudAgent(id, options);
      delegatedStopper.finished(id);
      return result;
    };
    const stopPeers = method(transcript, "stopDelegatedFromAgent");
    const delegatedStopper = createDelegatedWorkStopper({
      selfId: session.id,
      ...(stopPeers === undefined ? {} : { stopPeers: (visited: readonly string[]) => stopPeers(session.id, visited) }),
      stopPeerDescendants: (id, request) => delegatedStopHandlers.get(id)?.(request) ?? Promise.resolve([]),
      pendingCloudIds: () => method(builtRunner, "getPendingCloudAgentWatchBcIds")?.() ?? [],
      stopCloud: async (id, request) => {
        const cloud = hostDependencies().cloudAgent;
        if (cloud === undefined) return { result: "unreachable", detail: "Cloud-agent control is unavailable." };
        const current = await cloud.api.get(id);
        if (current === null || current.status !== "running" && current.status !== "creating") return { result: "not_running" };
        const review = await cloud.reviewAction?.({ args: { action: "cancel", agent_id: id }, toolCallId: request.toolCallId ?? "stop-delegated-work", images: [] });
        if (review !== undefined && !review.allowed) return { result: "failed", detail: review.reason };
        await cloud.api.cancel(id);
        return { result: "stopped" };
      },
    });
    if (!isSharedRoomTurn) delegatedStopHandlers.set(session.id, delegatedStopper.stop);
    const sendToAgent = (
      toAgentId: string,
      text: string,
      images: unknown,
      priority: boolean,
    ) => method(transcript, "sendToAgent")?.(
      session.id,
      toAgentId,
      text,
      images,
      priority,
    );
    const agentManagement = {
      create: async (input: { name: string; description: string }) => {
        const result = await method(
          transcript,
          "createBackgroundAgent"
        )?.({
          name: input.name,
          description: input.description
        }, "user");
        const agent = result.agent;
        boxPrewarm.prewarm({ id: agent.id });
        return {
          id: agent.id,
          name: agent.name,
          description: agent.description
        };
      },
      update: async (
        id: string,
        patch: { name?: string; description?: string }
      ) => {
        const current = (await method(transcript, "listAgents")?.())
          ?.find((agent: any) => agent.id === id);
        if (current == null || current.isGroup) return null;
        const summary = await method(transcript, "updateAgent")?.(id, {
          name: patch.name ?? current.name,
          description: patch.description ?? current.description
        });
        return summary == null
          ? null
          : {
              id: summary.id,
              name: summary.name,
              description: summary.description
            };
      }
    };
    const agentStateOwner = !isSharedRoomTurn
      ? method(memory, "createAgentState")?.({
          memory: session.memory,
          automations: session.automations,
          workflows: session.workflows,
          channels: session.channels,
          agentDir: dirname(session.dbPath),
          agentId: session.id,
          readBoxFile: (boxPath: string) =>
            method(remoteBox, "downloadFile")?.(ctx, session.id, boxPath)
        })
      : undefined;

    const productionContext = isAgentContext(ctx) ? ctx : undefined;
    const productionRequestContext = isPromptRequestContext(requestContext)
      ? requestContext
      : undefined;
    const readVideoAttachment = method(attachments, "readVideoBytes");
    const readVideoAttachmentBytes = readVideoAttachment === undefined
      ? undefined
      : (path: string) => readVideoAttachment({ path, agentId: session.id });
    const mcpCustomInstructions = method(mcp.mcp, "getCustomInstructions");
    let shellWatchWatermark:
      | { readonly turnCount: number; readonly boundaryRef: Uint8Array; readonly lastUserMessageId?: string; readonly hasUserTurn: boolean }
      | undefined;
    const productionPromptGlue = productionContext === undefined
      || productionRequestContext === undefined
      ? undefined
      : (() => {
        const box = asTransferBox(localExec.box);
        const remoteBoxForPrompt = asCapableTransferBox(remoteBox);
        const userComputers = asPromptUserComputers(localExec.userComputers);
        if (box === undefined || remoteBoxForPrompt === undefined || userComputers === undefined) return undefined;
        const readVideoAttachment = readVideoAttachmentBytes === undefined
          ? undefined
          : async (path: string): Promise<Uint8Array | null> => {
              const value = await readVideoAttachmentBytes(path);
              return value instanceof Uint8Array ? value : null;
            };
        return createRunnerPromptGlue({
          ctx: productionContext,
          box,
          remoteBox: remoteBoxForPrompt,
          userComputers,
          remoteBoxHasDesktop: true,
          isSubagentRunner: false,
          isComputerUseSubagent: false,
          isBrowserUseSubagent: false,
          requestContext: productionRequestContext,
          ...(typeof hooks.agentProfileProvider === "function"
            ? { agentProfileProvider: () => hooks.agentProfileProvider?.() ?? { name: "", description: "" } }
            : {}),
          ...(readVideoAttachment === undefined
            ? {}
            : { readVideoAttachmentBytes: readVideoAttachment }),
          isSpotlightEnabled: () => method(experiments, "isSpotlightEnabled")?.() ?? false,
          uploadAttachmentsIntoBox: paths => attachmentStaging.stageIntoBox(session.id, paths),
          scheduleAttachmentRestage: paths => attachmentStaging.scheduleRestage(session.id, paths),
          getRemoteBoxAvailable: () => method(remoteBox, "isAvailable")?.() !== false,
          getConversationId: () => session.id,
          resolveBoxId: () => session.id,
          ...(mcpCustomInstructions === undefined
            ? {}
            : { mcp: { getCustomInstructions: async (_context: Context) => await mcpCustomInstructions() } }),
          mcpConnectedServerNamesForTurn: () => [],
          mcpCustomInstructionsForTurn: () => new Map(),
          isMcpDiscoveryUnavailableForTurn: () => false,
          shellWatchHost: () => {
            const store = session.agentStore;
            if (
              store == null
              || typeof store.getConversationStateStructure !== "function"
              || typeof store.getBlobStore !== "function"
            ) throw new TypeError("production prompt state store is not bound");
            const blobStore = getAgentBlobStore(
              store as Parameters<typeof getAgentBlobStore>[0],
            );
            const generated = createShellWatchGeneratedStateProjection({
              getConversationState: () => store.getConversationStateStructure(),
              getBlobStore: () => blobStore,
            });
            const shellHost: ShellTerminalWatchHost<Context> = {
              ctx: productionContext,
              ...generated,
              getConversationId: () => session.id,
              ensureBoxReady: async (pollContext, agentId) => {
                const connection = await remoteBox.ensureReady(pollContext, agentId);
                return {
                  terminalsFolder: method(remoteBox, "getTerminalsFolder")?.() ?? "",
                  remoteAccessor: createShellWatchReadAccessor(connection.remoteAccessor),
                };
              },
              getConfirmedUserTurnWatermarkCache: () => shellWatchWatermark,
              setConfirmedUserTurnWatermarkCache: cache => {
                shellWatchWatermark = cache;
              },
            };
            return shellHost;
          },
        });
      })();
    const conversationAccess = createLocalConversationAccess(session.id, () => method(transcript, "listAgentsSync")?.() ?? []);
    const productionSystemPromptAssembly = productionContext === undefined
      || productionRequestContext === undefined
      ? undefined
      : createSystemPromptAssembly({
          basePrompt: typeof overrides.systemPrompt === "string"
            ? overrides.systemPrompt
            : DEFAULT_SAND_SYSTEM_PROMPT,
          isSubagentRunner: false,
          isSharedRoomRunner: isSharedRoomTurn,
          isSystemPromptOverridden: typeof overrides.systemPrompt === "string",
          agentProfileProvider: () => hooks.agentProfileProvider?.() ?? null,
          agentStore: () => {
            const store = session.agentStore;
            return store != null && typeof store.getMetadata === "function"
              ? { getMetadata: (key: string) => String(store.getMetadata(key)) }
              : null;
          },
          compactionEpoch: () => {
            try {
              const store = session.agentStore as {
                getConversationStateStructure?: () => { summaryArchives?: readonly unknown[] };
              } | null | undefined;
              const state = store?.getConversationStateStructure?.();
              return Array.isArray(state?.summaryArchives) ? state.summaryArchives.length : 0;
            } catch {
              return 0;
            }
          },
          ...createRunnerMemoryContext({
            agentId: session.id,
            dbPath: session.dbPath,
            sandRoot: memory.options?.sandRoot,
            store: session.memory,
            snapshots: session.db,
            resolveAgentName: (id) => resolveAgentDisplayName(id) ?? id,
          }),
          relatedConversations: () => conversationAccess.related().map((link) => ({ sessionId: link.id, label: link.name })),
          promptSectionSnapshots: () => promptSectionSnapshotStore(session.db),
          isBoxScopedSubagent: () => false,
          requestContext: {
            resolve: () => {
              const resolved = productionRequestContext.resolve();
              return {
                timeZone: resolved.timeZone ?? "UTC",
                ...(typeof resolved.userFullName === "string"
                  ? { userFullName: resolved.userFullName }
                  : {}),
              };
            },
          },
          automationStore: () => session.automations instanceof FileAutomationStore ? session.automations : null,
          workflowStore: () => null,
          channelStore: () => null,
          connectorManifests: CONNECTOR_MANIFESTS,
          sendToAgentImpl: sendToAgent,
          agentManagement,
          agentDirectory: () => (method(transcript, "listAgentsSync")?.() ?? [])
            .filter((agent: { id: string; isGroup?: boolean; remoteRoom?: unknown }) =>
              agent.id !== session.id && !agent.isGroup && agent.remoteRoom == null)
            .map((agent: { id: string; name: string; description?: string }) => ({
              id: agent.id, name: agent.name, description: agent.description ?? "",
            })),
          agentGroups: () => [],
          agentsRootDir: () => dirname(dirname(session.dbPath)),
          isSpotlightEnabled: () => method(experiments, "isSpotlightEnabled")?.() ?? false,
          isMultitaskEnabled: () => method(experiments, "isMultitaskEnabled")?.() ?? false,
          mcpManagement: () => mcp.management,
          isMcpMultiAccountEnabled: () => method(experiments, "isMcpMultiAccountEnabled")?.() ?? false,
          isCloudAgentsDisabledByTeam: () => method(experiments, "isCloudAgentsDisabledByTeam")?.() ?? false,
          mcpCustomInstructionsSection: () => productionPromptGlue?.getMcpCustomInstructionsSection() ?? null,
          mcpDiscoveryStatusSection: () => productionPromptGlue?.getMcpDiscoveryStatusSection() ?? null,
          remoteBoxSection: () => productionPromptGlue?.getRemoteBoxSection() ?? "",
          computerSection: () => productionPromptGlue?.getComputerSection() ?? null,
        });

    const promptPrefixObserver = productionSystemPromptAssembly === undefined || isSharedRoomTurn ? undefined : createPromptPrefixObserver({
      snapshots: () => promptSectionSnapshotStore(session.db),
      compactionEpoch: productionSystemPromptAssembly.getCompactionEpoch,
      sections: productionSystemPromptAssembly.renderedFrozenSections,
      report: report => console.info("[sand:prompt-prefix]", JSON.stringify({ agentId: session.id, ...report })),
      reportError: errorClass => console.warn("[sand:prompt-prefix] observation failed", errorClass),
    });
    const runnerOptions: Record<string, unknown> = {
      inference: extensions.api("inference").port,
      diskPressureReminder: foreverBox.diskPressureReminder,
      box: localExec.box,
      ctx,
      ...(awaitCloudAgent === undefined
        ? {}
        : {
            cloudAgentWatcher: {
              awaitCompletion: (
                id: string,
                options: { readonly waitForRestart: boolean },
              ) => awaitCloudAgent(id, options),
            },
          }),
      remoteBox,
      userComputers: localExec.userComputers,
      remoteBoxHasDesktop: true,
      boxHandoff: {
        requestHelp: (request: unknown) =>
          method(extensions.api("session"), "startHandoff")?.(request)
      },
      transport: hooks.transport,
      onInterrupt: () => reviewInteractions?.stopAgent(session.id),
      onRunLifecycle: (event: { readonly type: "started" | "ended"; readonly requestId: string }) => {
        if (event.type === "started") {
          reviewTurnIds.set(session.id, event.requestId);
          reviewInteractions?.onTurnStarted(session.id, event.requestId);
        }
        if (event.type === "ended") method(transcript, "settleReviewInteractionTurn")?.(session.id, event.requestId);
        if (event.type === "ended" && reviewTurnIds.get(session.id) === event.requestId) reviewTurnIds.delete(session.id);
        hooks.onRunLifecycle?.(event);
      },
      isSharedRoomTurn,
      isSharedRoomBoxToolsEnabled: () =>
        !Boolean(method(experiments, "checkFeatureGate")?.(
          "sand_shared_room_box_tools_kill_switch"
        )) && resolveSharedRoomBoxToolsEnabled(
          process.env.SAND_SHARED_ROOM_BOX_TOOLS
        ),
      getAgentId: () => session.id,
      agentProfileProvider: hooks.agentProfileProvider,
      connectorManifests: CONNECTOR_MANIFESTS,
      ingestAttachment: hooks.ingestAttachment,
      persistImage: hooks.persistImage,
      persistMediaBytes: hooks.persistMediaBytes,
      readVideoAttachmentBytes,
      readMediaDimensions: (path: string) => method(attachments, "readMediaDimensions")?.({ path, agentId: session.id }),
      requestContext,
      localToolPermission,
      ...autoReview,
      actionAuditor,
      webSearchService: method(
        extensions.api("inference"),
        "createWebSearch"
      )?.({
        modelId: process.env.SAND_AGENT_MODEL ?? DEFAULT_SAND_MODEL,
        onRequestId: requestIdForwarder(hooks, "web-search")
      }),
      webFetchService: method(
        extensions.api("inference"),
        "createWebFetch"
      )?.({
        onRequestId: requestIdForwarder(hooks, "web-fetch")
      }),
      onComputerAction: ({ agentId, action }: any) => {
        deps.emitGatewayEvent({
          channel: "computer-action",
          payload: { agentId, ...action }
        });
      },
      systemPrompt: overrides.systemPrompt,
      isMultitaskEnabled: () =>
        method(experiments, "isMultitaskEnabled")?.() ?? false,
      isSendMessageDeliveryOwedEnabled: () =>
        method(experiments, "isSendMessageDeliveryOwedEnabled")?.() ?? false,
      isDynamicToolsEnabled: () =>
        method(experiments, "isDynamicToolsEnabled")?.() ?? false,
      isBrowserUseSubagentEnabled: () =>
        method(experiments, "isBrowserUseSubagentEnabled")?.() ?? false,
      isSpotlightEnabled: () =>
        method(experiments, "isSpotlightEnabled")?.() ?? false,
      isMcpMultiAccountEnabled: () =>
        method(experiments, "isMcpMultiAccountEnabled")?.() ?? false,
      isUnicodeTypingEnabled: () =>
        method(experiments, "isUnicodeTypingEnabled")?.() ?? false,
      isListenerPlatformConnected: (platform: string) =>
        method(
          extensions.api("automations"),
          "isListenerPlatformConnected"
        )?.(platform) ?? false,
      resolveCloudAgentTitle,
      sendToAgent,
      agentDirectory: () => {
        const roster = method(transcript, "listAgentsSync")?.() ?? [];
        return roster
          .filter((agent: any) =>
            agent.id !== session.id &&
            !agent.isGroup &&
            agent.remoteRoom == null
          )
          .map((agent: any) => ({
            id: agent.id,
            name: agent.name,
            description: agent.description
          }));
      },
      agentGroups: () => {
        const roster = method(transcript, "listAgentsSync")?.() ?? [];
        const byId = new Map(roster.map((agent: any) => [agent.id, agent]));
        return roster
          .filter((agent: any) =>
            agent.isGroup && agent.memberIds.includes(session.id)
          )
          .map((group: any) => ({
            id: group.id,
            name: group.name,
            members: group.memberIds
              .filter((memberId: string) => memberId !== session.id)
              .map((memberId: string) => byId.get(memberId))
              .filter((member: any) => member != null)
              .map((member: any) => ({
                id: member.id,
                name: member.name,
                description: member.description
              }))
          }));
      },
      agentManagement,
      agentsRootDir: () => dirname(dirname(session.dbPath))
    };

    runnerOptions.createPromptSession = (
      onRequestId: (requestId: string) => void,
      options?: Readonly<Record<string, unknown>>,
    ) => createAgentPromptSession(
      extensions.api("inference").port,
      onRequestId,
      options,
    );

    const baseProductionResourceAccessor = createPerTurnResourceAccessor(
      remoteBox as unknown as ProductionBoxResourceOwner,
      session.id,
    );
    const productionResourceAccessor = async (
      context: unknown,
    ): Promise<ProductionResourceAccessor> => {
      const owner = asRemoteBoxResourceOwner(remoteBox);
      const runner = builtRunner as {
        readonly computerUse?: RemoteBoxResourceHost["computerUse"];
        setRemoteBoxTerminalsFolder?(folder: string): void;
        probeNavigationAfterComputerUse?(
          context: Context,
          connection: { readonly remoteAccessor: unknown },
        ): void;
        auditShellCommand?(
          shellKind: string,
          command: string,
          target: "box" | "user_machine",
          attribution?: { readonly turnId?: string; readonly boxId?: string },
        ): void;
      } | undefined;
      if (
        owner === undefined
        || autoReviewGate === undefined
        || runner?.computerUse === undefined
        || typeof runner.setRemoteBoxTerminalsFolder !== "function"
        || typeof runner.probeNavigationAfterComputerUse !== "function"
        || typeof runner.auditShellCommand !== "function"
        || !isAgentContext(context)
) {
        const baseAccessor = await baseProductionResourceAccessor(context);
        return new CombinedResourceAccessor(baseAccessor, [resourceEntry(readExecutorResource, {
          execute: (readContext, args, options) => baseAccessor.get(readExecutorResource).execute(
            readContext.with(agentMediaReadScopeKey, session.id), args, options,
          ),
        })]);
      }
      const remoteAutoReviewGate = {
        assertNoPendingApproval: () => autoReviewGate.assertNoPendingApproval(),
        currentModes: () => ({ ...autoReviewGate.currentModes() }),
      };
      const accessor = createRemoteBoxResourceAccessor({
        remoteBox: owner,
        remoteBoxHasDesktop: true,
        resolveBoxId: () => session.id,
        getConversationId: () => session.id,
        setRemoteBoxTerminalsFolder: folder => runner.setRemoteBoxTerminalsFolder?.(folder),
        autoReviewGate: remoteAutoReviewGate,
        auditShellCommand: (_agentId, kind, command, _target, attribution) =>
          runner.auditShellCommand?.(kind, command, "box", attribution),
        computerUse: runner.computerUse,
        probeNavigationAfterComputerUse: (probeContext, connection) =>
          runner.probeNavigationAfterComputerUse?.(probeContext, connection),
        ...(autoReview.autoReviewClassifierExecutor === undefined
          ? {}
          : { autoReviewClassifierExecutor: autoReview.autoReviewClassifierExecutor }),
      });
      return asProductionResourceAccessor(accessor);
    };
    const localProductionResourceAccessor = createPerTurnResourceAccessor(
      localExec.box as ProductionBoxResourceOwner,
      session.id,
    );
    runnerOptions.createResourceAccessor = productionResourceAccessor;
    runnerOptions.createSummarizationHandler = (
      summarizationSession: SummarizationPromptSession,
      options?: { preserveLatestImage?: boolean },
    ) => new SummarizationHandler(summarizationSession, false, {
      enableReduceInputsRetry: true,
      maxPromptChars: SAND_SUMMARIZATION_MAX_PROMPT_CHARS,
      maxOutputTokens: 32_000,
      preserveLatestImage: options?.preserveLatestImage ?? false,
    });
    runnerOptions.createConversationActionReceiver = () =>
      new NoopConversationActionReceiver();
    // Dormant direct owner for the immutable retry/checkpoint boundary. The
    // current clean runner does not consume this until the real Agent stream
    // join is released; keeping the factory here makes the owner reachable
    // without invoking runStream or replacing the fail-closed runStep port.
    runnerOptions.createStreamAttempt = createStreamAttempt;
    // This is the exact generated redaction/RESUME projection used by the
    // immutable stream handoff. It remains a dormant typed option: the clean
    // runner does not call it until the real Agent stream join is promoted.
    runnerOptions.createTurnAgentRunStreamInput = createTurnAgentRunStreamInput;
    // Direct constructor-side stream owner. This remains dormant until a
    // dependency-closed built Agent is supplied by the real turn join.
    runnerOptions.createTurnAgentStreamStart = createTurnAgentStreamStart;

    // Host-owned production caller for the recovered constructor. The caller
    // supplies the typed per-turn prompt/action and summarization identities;
    // resource readiness and blob ownership remain fixed to this session.
    runnerOptions.createProductionTurnAgentOwner = (
      input: Omit<
        ProductionTurnAgentOwnerInput,
        "createResourceAccessor" | "blobStore"
      >,
    ) => {
      if (
        session.agentStore == null
        || typeof session.agentStore.getBlobStore !== "function"
      ) {
        throw new TypeError("production Agent blob store is not bound");
      }
      return createProductionTurnAgentOwner({
        ...input,
        createResourceAccessor: localProductionResourceAccessor,
        createRemoteBoxResourceAccessor: productionResourceAccessor,
        blobStore: getAgentBlobStore(
          session.agentStore as Parameters<typeof getAgentBlobStore>[0],
        ),
      });
    };
    runnerOptions.createProductionTurnAgentRunInput =
      createProductionTurnAgentRunInput;

    if (session.agentStore != null && typeof session.agentStore.getBlobStore === "function") {
      runnerOptions.blobStore = getAgentBlobStore(
        session.agentStore as unknown as Parameters<typeof getAgentBlobStore>[0],
      );
    }

    if (!isSharedRoomTurn) {
      transcriptMirrorForTurn = deps.createTranscriptMirror?.({
        transcriptsDir,
        session,
        pool: getMirrorOffloadPool,
        reportOutcome: report => {
          method(telemetry.brain ?? {}, "reportJournalOutcome")?.(report);
        },
        isJournalEnabled: async () =>
          await method(experiments, "checkGate")?.(
            "sand_new_transcript_journal"
          ) ?? false
      }) as TurnSettleHost["transcriptMirror"] | undefined;
      Object.assign(runnerOptions, {
        transcriptMirror: transcriptMirrorForTurn,
        mcp: mcp.mcp,
        mcpManagement: mcp.management,
        agentState: agentStateOwner,
        generateImageService: method(
          attachments,
          "createGenerateImageService"
        )?.({
          persistImage: hooks.persistImage,
          onRequestId: requestIdForwarder(hooks, "generate-image")
        }),
        generateImageResourceAccessor: method(
          attachments,
          "createGenerateImageResourceAccessor"
        )?.(dirname(session.dbPath)),
        getAgentDir: () => dirname(session.dbPath),
        uploadAttachmentsIntoBox: (hostPaths: readonly string[]) =>
          attachmentStaging.stageIntoBox(session.id, hostPaths),
        agentStore: session.agentStore,
        conversationSizeGuard: () =>
          sessionApi.store?.ensureConversationCapacityForTurn?.(session),
        memoryStore: session.memory,
        userMemory: method(memory, "createUserMemory")?.({
          agentId: session.id,
          resolveAgentName: resolveAgentDisplayName
        }),
        projectMemory: method(memory, "createProjectMemory")?.({
          agentDir: dirname(session.dbPath),
          agentId: session.id,
          resolveAgentName: resolveAgentDisplayName
        }),
        memorySnapshots: session.db,
        profilePromptSnapshots: session.db,
        episodeProgress: session.db,
        automationStore: session.automations,
        workflowStore: session.workflows,
        channelStore: session.channels
      });
    }

    const projectedLocalToolPermission = asLocalToolPermissionProjection(
      localToolPermission,
    );

    const hostDependencies = (): ProductionTurnHostDependencies => {
      const readMediaDimensions = (path: string) => method(attachments, "readMediaDimensions")?.({ path, agentId: session.id });
      const uploadFile = method(remoteBox, "uploadFile");
      const downloadFile = method(remoteBox, "downloadFile");
      const watchCloudAgent = createRunnerCloudWatch(builtRunner);
      const cloudAgent = (() => {
        const launchedIds = cloudAgents.launchedIds;
        if (
          !isCloudAgentApi(cloudAgents)
          || !(launchedIds instanceof Set)
          || uploadFile === undefined
        ) return undefined;
        const reviewAction: NonNullable<CloudAgentToolDeps["reviewAction"]> | undefined =
          productionContext === undefined || autoReviewGate === undefined
            ? undefined
            : async ({ args, toolCallId, images, signal }) => {
              const instructions = autoReviewGate.userInstructions();
              const reviewOptions = {
                mode: autoReviewGate.currentModes().cloudAgent,
                agentId: session.id,
                ...(autoReviewController === undefined
                  ? {}
                  : { autoReviewController }),
                ...(instructions === undefined
                  ? {}
                  : { userAutoRunInstructions: instructions }),
                getApprovalExpiryPolicy: () =>
                  sandAutoReviewApprovalExpiryPolicy("turn"),
              };
              const lifecycleTarget = buildSandCloudAgentLifecycleReviewTarget({
                action: args.action,
                ...(args.agent_id === undefined ? {} : { agent_id: args.agent_id }),
                ...(args.title === undefined ? {} : { title: args.title }),
              });
              if (lifecycleTarget !== undefined) {
                const result = await reviewSandCloudAgentLifecycleAction({
                  ctx: productionContext,
                  target: lifecycleTarget,
                  options: reviewOptions,
                  ...(signal === undefined ? {} : { signal }),
                });
                return { allowed: result.allowed, reason: result.reason ?? "" };
              }
              const target = buildSandCloudAgentReviewTarget(
                args,
                describeSandCloudAgentReviewImages(
                  images.map(image => image.path),
                  images,
                ),
              );
              if (target === undefined) return { allowed: true, reason: "" };
              const result = await reviewSandCloudAgentAction({
                ctx: productionContext,
                target,
                toolCallId,
                ...(signal === undefined ? {} : { signal }),
                options: {
                  ...reviewOptions,
                  classify: async (classifyContext, classifyTarget, mode, id) =>
                    await runSandAutoReviewClassifier({
                      ctx: classifyContext,
                      resourceAccessor: await productionResourceAccessor(classifyContext),
                      toolCallId: id,
                      mode,
                      buildTarget: () => buildSandCloudAgentRiskTarget({
                        target: classifyTarget,
                        ...(instructions === undefined
                          ? {}
                          : { userAutoRunInstructions: instructions }),
                      }),
                      loadConversationContext: async () =>
                        await extractProductionTurnAutoReviewConversationContext(
                          classifyContext,
                          agentStateOwner,
                        ),
                      errorReason: SAND_CLOUD_AGENT_CLASSIFIER_ERROR_REASON,
                    }),
                },
              });
              return { allowed: result.allowed, reason: result.reason ?? "" };
            };
        return {
          api: cloudAgents,
          launchedIds,
          agentDir: dirname(session.dbPath),
          ...(downloadFile === undefined
            ? {}
            : {
                readBoxFile: async (
                  cloudContext: CloudAgentToolContext,
                  boxPath: string,
                ) => await downloadFile(cloudContext, session.id, boxPath),
              }),
          writeBoxFile: async (
            cloudContext: CloudAgentToolContext,
            boxPath: string,
            data: Uint8Array,
          ) => await uploadFile(cloudContext, session.id, boxPath, data),
          ...(awaitCloudAgent === undefined
            ? {}
            : {
                cloudAgentWatcher: () => ({
                  awaitCompletion: (id: string, options: { waitForRestart: boolean }) =>
                    awaitCloudAgent(id, options),
                }),
              }
          ),
          ...(watchCloudAgent === undefined ? {} : { watch: watchCloudAgent }),
          ...(reviewAction === undefined ? {} : { reviewAction }),
        };
      })();

      const sendMessage = {
        getIngestAttachment: () => hooks.ingestAttachment,
        resolveCloudAgentTitle,
        ...(readMediaDimensions === undefined
          ? {}
          : { readMediaDimensions }),
        onSendMessage: (message: Record<string, unknown>, timestampMs: number) => {
          hooks.transport.onUpdate({
            type: "send-message",
            message: { ...message, type: String(message.type ?? "text") },
            timestampMs,
          });
          return hooks.transport.lastSentMessageId?.();
        },
      };
      const reaction = {
        react: (args: { messageAddress: string; emoji: string }) => {
          hooks.transport.onUpdate({ type: "react-to-message", ...args });
        },
      };
      const listenerPlatformConnected = method(
        extensions.api("automations"),
        "isListenerPlatformConnected",
      );
      const reviewAutomationWrite: NonNullable<
        ProductionTurnHostDependencies["state"]
      >["reviewAutomationWrite"] =
        productionContext === undefined || autoReviewGate === undefined
          ? undefined
          : async (review: AutomationReview, toolCallId?: string) => {
            if (toolCallId === undefined || toolCallId.length === 0) {
              return {
                allowed: false,
                reason: "Auto-review requires a tool call identity.",
              };
            }
            const trigger = parseStoredTrigger(review.spec.trigger);
            if (trigger === null) {
              return {
                allowed: false,
                reason: "This routine trigger could not be reviewed.",
              };
            }
            const target = {
              operation: review.operation,
              id: review.id ?? review.referencedWorkflows[0]?.id ?? "",
              spec: {
                name: review.spec.name,
                prompt: review.spec.prompt,
                trigger,
                isEnabled: review.spec.isEnabled ?? true,
              },
              referencedWorkflows: review.referencedWorkflows,
              ...(review.referencingRoutines === undefined
                ? {}
                : { referencingRoutines: review.referencingRoutines }),
            };
            const instructions = autoReviewGate.userInstructions();
            const result = await reviewSandAutomationWrite({
              ctx: productionContext,
              target,
              toolCallId,
              options: {
                mode: autoReviewGate.currentModes().automationWrite,
                agentId: session.id,
                ...(autoReviewController === undefined
                  ? {}
                  : { autoReviewController }),
                ...(instructions === undefined
                  ? {}
                  : { userAutoRunInstructions: instructions }),
                getApprovalExpiryPolicy: () =>
                  sandAutoReviewApprovalExpiryPolicy("turn"),
                classify: async (classifyContext, classifyTarget, mode, id) =>
                  await runSandAutoReviewClassifier({
                    ctx: classifyContext,
                    resourceAccessor: await productionResourceAccessor(classifyContext),
                    toolCallId: id,
                    mode,
                    buildTarget: () => buildSandAutomationWriteRiskTarget({
                      target: classifyTarget,
                      ...(instructions === undefined
                        ? {}
                        : { userAutoRunInstructions: instructions }),
                    }),
                    loadConversationContext: async () =>
                      await extractProductionTurnAutoReviewConversationContext(
                        classifyContext,
                        agentStateOwner,
                      ),
                    errorReason: SAND_AUTOMATION_WRITE_CLASSIFIER_ERROR_REASON,
                  }),
              },
            });
            return { allowed: result.allowed, reason: result.reason ?? "" };
          };
      const onListenerRoutineSaved: NonNullable<
        ProductionTurnHostDependencies["state"]
      >["onListenerRoutineSaved"] =
        listenerPlatformConnected === undefined
          ? undefined
          : async triggerValue => {
            const trigger = parseStoredTrigger(triggerValue);
            if (trigger === null) return undefined;
            return (await surfaceListenerConnectCards({
              trigger,
              platformsInTrigger: value => {
                const parsed = parseStoredTrigger(value);
                return parsed === null ? [] : listenerPlatformsInTrigger(parsed);
              },
              isListenerPlatformConnected: async platform =>
                Boolean(await listenerPlatformConnected(platform)),
              emit: card => {
                hooks.transport.onUpdate({
                  type: "send-message",
                  message: card,
                  timestampMs: Date.now(),
                });
              },
              displayName: platform => platform === "slack" ? "Slack" : "GitHub",
            })) ?? undefined;
          };
      const state = agentStateOwner === undefined
        ? undefined
        : {
            state: agentStateOwner,
            ...(session.automations != null
              && typeof (session.automations as { list?: unknown }).list === "function"
              ? {
                  automationStore: session.automations as {
                    list(): readonly AutomationRecord[];
                  },
                }
              : {}),
            ...(session.workflows != null
              && typeof (session.workflows as { list?: unknown }).list === "function"
              ? {
                  workflowStore: session.workflows as {
                    list(): readonly WorkflowRecord[];
                  },
                }
              : {}),
            parseTrigger: parseStoredTrigger,
            ...(reviewAutomationWrite === undefined ? {} : { reviewAutomationWrite }),
            ...(onListenerRoutineSaved === undefined ? {} : { onListenerRoutineSaved }),
          };

      const ownedSubagents = createRunnerSubagentManagement(builtRunner);
      const subagentManagement = ownedSubagents === undefined ? undefined : { ...ownedSubagents, stopDelegatedWork: delegatedStopper.stop };
      const projectedActionAuditor = asActionAuditor(actionAuditor);
      const autoReviewProjection: ProductionTurnAutoReviewHostProjection | undefined =
        autoReviewController === undefined || autoReviewGate === undefined
          ? undefined
          : {
              controller: autoReviewController,
              agentId: session.id,
              getModes: () => autoReviewGate.currentModes(),
              getInstructions: () => autoReviewGate.userInstructions(),
              getApprovalExpiryPolicy: () =>
                sandAutoReviewApprovalExpiryPolicy("turn"),
              requestContext: new RequestContext({
                env: new RequestContextEnv({
                  smartModeClassifierAutoModeEnabled: true,
                }),
              }),
              getShellApprovalState: surface =>
                autoReviewGate.shellApprovalState(surface),
              enforceModelFacingShellUiAutomationGuard:
                autoReviewGate.currentModes().hostShell === "enforce"
                || autoReviewGate.currentModes().computer === "enforce",
              ...(projectedActionAuditor === undefined
                ? {}
                : { actionAuditor: projectedActionAuditor }),
              ...(projectedLocalToolPermission === undefined
                ? {}
                : { localToolPermission: projectedLocalToolPermission }),
              ...(listenerPlatformConnected === undefined
                ? {}
                : {
                    isListenerPlatformConnected: async (platform: string) =>
                      Boolean(await listenerPlatformConnected(platform)),
                  }),
            };
      return {
        isMultitaskEnabled: () =>
          method(experiments, "isMultitaskEnabled")?.() ?? false,
        sendMessage,
        sendToAgent: {
          getSelfAgentId: () => session.id,
          sendToAgent: (
            targetId: string,
            text: string,
            images,
            priority,
          ) => sendToAgent(targetId, text, images, priority === true),
        },
        reaction,
        agentManagement,
        ...(state === undefined ? {} : { state }),
        ...(!isSharedRoomTurn && mcp.management != null
          && typeof mcp.management.listPlugins === "function"
          ? { mcpManagement: mcp.management }
          : {}),
        ...(cloudAgent === undefined ? {} : { cloudAgent }),
        ...(subagentManagement === undefined
          ? {}
          : { subagentManagement }),
        ...(autoReviewProjection === undefined
          ? {}
          : { autoReview: autoReviewProjection }),
      };
    };

    const createTurnToolsetFactoryProvider = (
      dependencies: ProductionTurnHostDependencies,
      turnInputs?: ProductionTurnToolInputs,
      agentId: string = session.id,
    ): TurnToolsetHostFactoryProvider => {
      const cloudAgent = dependencies.cloudAgent;
      const mcpManagement = dependencies.mcpManagement;
      const scopedAutoReviewModes = autoReviewGate?.currentModes() ?? {
        hostShell: "off" as const,
        boxShell: "off" as const,
        mcp: "off" as const,
        computer: "off" as const,
        automationWrite: "off" as const,
        cloudAgent: "off" as const,
        subagentLaunch: "off" as const,
      };
      const scopedUserAutoRunInstructions = autoReviewGate?.userInstructions();
      const scopedAutoReview = {
        mode: scopedAutoReviewModes.computer,
        agentId,
        boxIdentity: {
          boxId: session.id,
          windowGeneration: `${autoReviewController?.hostGeneration ?? "host"}:${session.id}`,
        },
        ...(autoReviewController === undefined ? {} : { autoReviewController }),
        extractConversationContext: extractProductionTurnAutoReviewConversationContext,
        getApprovalExpiryPolicy: () => sandAutoReviewApprovalExpiryPolicy("turn"),
        resolveDisplayNumber: async (context: unknown) => {
          await method(remoteBox, "ensureReady")?.(context, session.id);
          const windowIndex = boxAgentWindowIndex(remoteBox as any, session.id);
          return windowIndex ?? (boxSupportsMultiWindow(remoteBox as any) ? undefined : 1);
        },
        ...(scopedUserAutoRunInstructions === undefined
          ? {}
          : { userAutoRunInstructions: scopedUserAutoRunInstructions }),
      };
      const provider: TurnToolsetHostFactoryProvider = {
      createReviewInteractionTools: turn => {
        const requestId = reviewTurnIds.get(agentId);
        if (reviewInteractions === undefined || requestId === undefined || isSharedRoomTurn || turn.endThisRunAwaitingUser === undefined) return [];
        return reviewInteractions.toolsForTurn({ agentId, requestId, endThisRunAwaitingUser: turn.endThisRunAwaitingUser,
          onCardShown: (entryId, message) => turn.emitUpdate?.({ type: "send-message", reviewEntryId: entryId,
            message, timestampMs: Date.now(), ...(turn.ackToken === undefined ? {} : { ackToken: turn.ackToken }) }),
        });
      },
      createSendMessageToolInputs: turn => ({
        dependencies: turn.emitUpdate === undefined
          ? dependencies.sendMessage
          : {
              ...dependencies.sendMessage,
              onSendMessage: (message, timestampMs) => {
                turn.emitUpdate?.({
                  type: "send-message",
                  message: { ...message, type: String(message.type ?? "text") },
                  timestampMs,
                  ...(turn.ackToken === undefined
                    ? {}
                    : { ackToken: turn.ackToken }),
                });
                const messageId = hooks.transport.lastSentMessageId?.();
                const library = extensions.api("library");
                const acknowledge = method(library, "acknowledgePublishedLinks");
                const credentialOf = method(library, "mainCredential");
                const content = typeof message.content === "string" ? message.content : typeof message.url === "string" ? message.url : "";
                if (acknowledge !== undefined && credentialOf !== undefined && typeof messageId === "string" && messageId.length > 0 && content.includes("https://")) {
                  acknowledge({ credential: credentialOf(), agentId, storeId: LIBRARY_MAIN_STORE, messageId, content, publishedAtMs: timestampMs }, AbortSignal.timeout(5000));
                }
                return messageId;
              },
            },
      }),
      createNativeArtifactToolInputs: () => {
        const library = extensions.api("library");
        const publish = method(library, "publishNativeArtifact");
        const credentialOf = method(library, "mainCredential");
        const pending = method(library, "pendingPublications");
        const executionBaseOf = method(library, "executionBase");
        if (publish === undefined || credentialOf === undefined || executionBaseOf === undefined) throw new TypeError("production Library native publisher is not bound");
        const credential = credentialOf();
        const queued = pending?.({ credential, agentId, storeId: LIBRARY_MAIN_STORE }, AbortSignal.timeout(5000)) ?? [];
        for (const item of queued) {
          const timestampMs = Date.now();
          const messageId = dependencies.sendMessage.onSendMessage({ type: "text", content: item.event.url }, timestampMs);
          if (typeof messageId === "string" && messageId.length > 0) {
            method(library, "acknowledgePublishedLinks")?.({ credential, agentId, storeId: LIBRARY_MAIN_STORE, messageId, content: item.event.url, publishedAtMs: timestampMs }, AbortSignal.timeout(5000));
          }
        }
        return {
          nativeArtifacts: {
            resolveExecutionBase: () => executionBaseOf({ agentId }, AbortSignal.timeout(120000)),
            publish: (input, execution) => publish({
              input,
              execution: {
                credential: typeof execution.credential === "string" ? execution.credential : credential,
                agentId: execution.agentId,
                storeId: execution.storeId,
                toolCallId: execution.toolCallId,
                idempotencyKey: execution.idempotencyKey,
              },
            }, execution.signal),
          },
        };
      },
      createSendToAgentToolInputs: () => ({
        dependencies: dependencies.sendToAgent,
      }),
      createReactionToolInputs: turn => ({
        dependencies: turn.emitUpdate === undefined
          ? dependencies.reaction
          : {
              ...dependencies.reaction,
              react: args => turn.emitUpdate?.({ type: "react-to-message", ...args }),
            },
      }),
      createRequestBoxHelpToolInputs: (turn): TurnBoxHelpToolFactoryInput => {
        let endRequested = false;
        const pause = () => {
          if (turn.endThisRunAwaitingUser !== undefined) {
            turn.endThisRunAwaitingUser("awaiting box help");
            return;
          }
          const runner = builtRunner;
          if (runner?.endTurnAwaitingUser === undefined) throw new TypeError("box handoff run lifecycle is not bound");
          runner.endTurnAwaitingUser("awaiting box help");
        };
        return { dependencies: {
          getAgentId: () => agentId,
          endTurn: () => { endRequested = true; },
          requestHelp: async request => {
            const start = method(extensions.api("session"), "startHandoff");
            if (start === undefined) throw new TypeError("box handoff session service is not bound");
            const outcome = await start(request);
            if (outcome?.kind === "already-pending" && typeof outcome.requestId === "string" && typeof outcome.instruction === "string") {
              if (endRequested) pause();
              return { kind: "already-pending", requestId: outcome.requestId, instruction: outcome.instruction };
            }
            if (outcome?.kind === "started" && typeof outcome.requestId === "string") return { kind: "started", requestId: outcome.requestId };
            throw new TypeError("box handoff session returned an invalid outcome");
          },
          onSendMessage: (message, timestampMs, metadata) => {
            const update = {
              type: "send-message",
              message,
              timestampMs,
              boxHandoff: metadata,
              ...(turn.ackToken === undefined ? {} : { ackToken: turn.ackToken }),
            };
            if (turn.emitUpdate !== undefined) turn.emitUpdate(update);
            else hooks.transport.onUpdate(update);
            if (endRequested) pause();
          },
        } };
      },
      createAgentManagementToolInputs: () => ({
        dependencies: dependencies.agentManagement,
      }),
      ...(turnInputs === undefined
        ? {}
        : {
            createMcpMetaToolInputs: (
              turn: TurnToolsetTurnInput,
              props,
            ): TurnMcpMetaToolFactoryInput => {
              const suppliedMcpMeta = props.mcp?.mcpMeta ?? turnInputs.mcp?.mcpMeta;
              if (suppliedMcpMeta !== undefined) {
                return {
                  resourceAccessor: props.resourceAccessor,
                  ...suppliedMcpMeta,
                };
              }
              const mcpMode = turn.autoReviewModes.mcp;
              return {
                resourceAccessor: props.resourceAccessor,
                getMcpTools: () => props.mcpTools ?? turn.mcpTools ?? [],
                discoveryOptions: { allowInteractiveMcpAuth: false },
                callOptions: {
                  allowInteractiveMcpAuth: false,
                  validateMcpToolDescriptors: true,
                  smartModeClassifierMode: mcpMode === "enforce",
                  smartModeClassifierShadowMode: mcpMode === "shadow",
                  ...(props.requestContext === undefined
                    ? {}
                    : {
                        requestContext: props.requestContext,
                        ...(props.requestContext.mcpFileSystemOptions === undefined
                          ? {}
                          : { mcpFileSystemOptions: props.requestContext.mcpFileSystemOptions }),
                      }),
                  ...(autoReviewController === undefined || mcpMode !== "enforce"
                    ? {}
                    : {
                        smartModeApprovalProvider: {
                          requestApproval: request =>
                            createSandMcpApprovalProvider({
                              controller: autoReviewController,
                              agentId,
                              getExpiryPolicy: () => sandAutoReviewApprovalExpiryPolicy("turn"),
                            }).requestApproval({
                              fingerprint: request.fingerprint,
                              signal: request.signal,
                              target: {
                                blockReason: request.target.blockReason,
                                serverDisplayName: request.target.serverDisplayName
                                  ?? request.target.serverName
                                  ?? request.target.serverIdentifier,
                                toolName: request.target.toolName,
                                ...(request.target.mcpArguments === undefined
                                  ? {}
                                  : { mcpArguments: request.target.mcpArguments }),
                                ...(request.target.description === undefined
                                  ? {}
                                  : { description: request.target.description }),
                                ...(request.target.proposedAllowRule === undefined
                                  ? {}
                                  : { proposedAllowRule: request.target.proposedAllowRule }),
                              },
                            }),
                        },
                      }),
                },
              };
            },
            createTaskToolInputs: (turn): TurnTaskToolFactoryInput => ({
              resourceAccessor: turnInputs.resourceAccessor as unknown as TurnTaskToolFactoryInput["resourceAccessor"],
              stateHandler: turnInputs.stateHandler as unknown as TurnTaskToolFactoryInput["stateHandler"],
              parentModelInfo: turnInputs.parentModelInfo as unknown as TurnTaskToolFactoryInput["parentModelInfo"],
              getTaskToolConfig: async () => ({
                agentConfig: {
                  ...turnInputs.config,
                  toolsGenerator: () => fencedToolSet([], false),
                },
                promptSession: turnInputs.toolSession,
                summarizationHandler: turnInputs.summarizationHandler,
              }),
              subagentConfigs: (turn.subagentConfigs ?? []) as unknown as TurnTaskToolFactoryInput["subagentConfigs"],
              options: {
                subagentModels: turnInputs.subagentModels,
              } as unknown as TurnTaskToolFactoryInput["options"],
            }),
          }),
      createComputerToolInputs: (turn, _props): TurnComputerToolFactoryInput => {
        const boxAccessor = turn.remoteBoxResourceAccessor;
        if (boxAccessor === undefined) {
          throw new TypeError("remote box resource accessor is not bound");
        }
        return {
          dependencies: createHostComputerToolDependencies({
            resourceAccessor: boxAccessor,
            autoReview: scopedAutoReview,
          ...(persistImageForTurn === undefined ? {} : { persistImage: persistImageForTurn }),
          isUnicodeTypingEnabled: () =>
            method(experiments, "isUnicodeTypingEnabled")?.() ?? false,
          onComputerAction: action => {
            deps.emitGatewayEvent({
              channel: "computer-action",
              payload: { agentId, ...action },
            });
          },
          }),
        };
      },
      createScreenshotToolInputs: (turn, _props): TurnComputerToolFactoryInput => {
        const boxAccessor = turn.remoteBoxResourceAccessor;
        if (boxAccessor === undefined) {
          throw new TypeError("remote box resource accessor is not bound");
        }
        return {
          dependencies: createHostComputerToolDependencies({
            resourceAccessor: boxAccessor,
          ...(persistImageForTurn === undefined ? {} : { persistImage: persistImageForTurn }),
          isUnicodeTypingEnabled: () =>
            method(experiments, "isUnicodeTypingEnabled")?.() ?? false,
          }),
        };
      },
      createBrowserToolInputs: (turn, _props): TurnBrowserToolFactoryInput => {
        const boxAccessor = turn.remoteBoxResourceAccessor;
        if (boxAccessor === undefined) {
          throw new TypeError("remote box resource accessor is not bound");
        }
        return {
          dependencies: createHostBrowserDriverDependencies({
            resourceAccessor: boxAccessor,
          box: remoteBox as unknown as HostBrowserBoxOwner<unknown>,
          getBoxId: () => session.id,
          getDefaultViewId: () => agentId,
          executeShell: createHostShellExecutor({
            resourceAccessor: boxAccessor,
            assertNoPendingApproval: () => autoReviewGate?.assertNoPendingApproval(),
            auditShellCommand: command => {
              method(actionAuditor as DynamicApi, "record")?.({
                agentId,
                occurredAtMs: Date.now(),
                action: {
                  kind: "shellCommand",
                  command,
                  shellKind: "foreground",
                  target: "box",
                },
              });
            },
          }),
          autoReview: scopedAutoReview,
          ...(persistImageForTurn === undefined
            ? {}
            : { getPersistImage: () => persistImageForTurn }),
          }),
        };
      },
      createBoxAwaitToolInputs: (turn, _props): TurnAwaitToolFactoryInput => ({
        resourceAccessor: (() => {
          if (turn.remoteBoxResourceAccessor === undefined) {
            throw new TypeError("remote box resource accessor is not bound");
          }
          return turn.remoteBoxResourceAccessor as unknown as TurnAwaitToolFactoryInput["resourceAccessor"];
        })(),
        options: {
          toolName: SAND_BOX_AWAIT_SHELL_TOOL_NAME,
          toolIdentifier: "BOX_AWAIT",
          terminalsFolder: () => method(remoteBox, "getTerminalsFolder")?.() ?? "",
          enableSubagentAwaiting: false,
          defaultBlockUntilMs: 30_000,
          enableJobCompletionNotifications: true,
        },
      }),
      createExternalReadToolInputs: (_turn, props): TurnReadToolFactoryInput => ({
        resourceAccessor: props.resourceAccessor as unknown as TurnReadToolFactoryInput["resourceAccessor"],
        formattingOptions: SAND_READ_FORMATTING_OPTIONS,
        promptVersion: "latest",
        options: {
          toolName: SAND_EXTERNAL_READ_TOOL_NAME,
          toolIdentifier: "EXTERNAL_READ",
          toolDescription: SAND_EXTERNAL_READ_TOOL_DESCRIPTION,
          // The immutable Mac and Windows carriers contain the lazy Piscina
          // producer but omit pdf-worker.{js,ts}. Leaving the extractor absent
          // preserves ordinary Read while making the unrecoverable PDF branch
          // fail closed in createReadTool.
        },
      }),
      createBoxReadToolInputs: (turn, _props): TurnReadToolFactoryInput => {
        if (turn.remoteBoxResourceAccessor === undefined) {
          throw new TypeError("remote box resource accessor is not bound");
        }
        return {
          resourceAccessor: turn.remoteBoxResourceAccessor as unknown as TurnReadToolFactoryInput["resourceAccessor"],
          formattingOptions: SAND_READ_FORMATTING_OPTIONS,
          promptVersion: "latest",
          options: {
            toolName: SAND_BOX_READ_TOOL_NAME,
            toolIdentifier: "READ",
            toolDescription: SAND_BOX_READ_TOOL_DESCRIPTION,
          },
        };
      },
      ...(turnInputs?.webSearch === undefined
        && method(extensions.api("inference"), "createWebSearch") === undefined
        ? {}
        : {
            createWebSearchToolInputs: (_turn, props): TurnWebSearchToolFactoryInput => {
              const webSearch = props.webSearch
                ?? turnInputs?.webSearch
                ?? createTurnWebAndAwaitProjections(props).webSearch;
              if (webSearch === undefined) throw new TypeError("web search service is not bound");
              return { dependencies: webSearch as unknown as TurnWebSearchToolFactoryInput["dependencies"] };
            },
          }),
      ...(turnInputs?.webFetch === undefined
        && method(extensions.api("inference"), "createWebFetch") === undefined
        ? {}
        : {
            createWebFetchToolInputs: (_turn, props): TurnWebFetchToolFactoryInput => {
              const webFetch = props.webFetch
                ?? turnInputs?.webFetch
                ?? createTurnWebAndAwaitProjections(props).webFetch;
              if (webFetch === undefined) throw new TypeError("web fetch service is not bound");
              return { dependencies: webFetch as unknown as TurnWebFetchToolFactoryInput["dependencies"] };
            },
          }),
      ...(turnInputs?.externalAwait === undefined
        && method(remoteBox, "getTerminalsFolder") === undefined
        ? {}
        : {
            createExternalAwaitToolInputs: (_turn, props): TurnAwaitToolFactoryInput => {
              const externalAwait = props.externalAwait
                ?? turnInputs?.externalAwait
                ?? createTurnWebAndAwaitProjections(props).externalAwait;
              if (externalAwait === undefined) throw new TypeError("external await service is not bound");
              return {
                resourceAccessor: externalAwait.resourceAccessor as unknown as TurnAwaitToolFactoryInput["resourceAccessor"],
                options: externalAwait.options,
                ...(externalAwait.promptVersion === undefined
                  ? {}
                  : { promptVersion: externalAwait.promptVersion }),
              };
            },
          }),
        ...(mcpManagement === undefined
          ? {}
          : {
              createMcpManagementToolInputs: (): TurnMcpManagementToolFactoryInput => ({
          management: mcpManagement,
          getRequestingAgentId: () => session.id,
          isAwaitingUserSelection: () => {
            const owner = builtRunner as { isRunAwaitingUserSelection?: () => boolean } | undefined;
            return owner?.isRunAwaitingUserSelection?.() === true;
          },
          isMultiAccountEnabled: () =>
            method(experiments, "isMcpMultiAccountEnabled")?.() ?? false,
          emitConnectorCard: emission => {
            hooks.transport.onUpdate({
              type: "send-message",
              message: connectorCardEmissionToMessage(emission),
              timestampMs: Date.now(),
            });
          },
              }),
            }),
        ...(!isSharedRoomTurn && cloudAgent !== undefined
          ? {
              createCloudAgentToolInputs: (): TurnCloudAgentToolFactoryInput => ({
                dependencies: {
                  api: cloudAgent.api,
                  launchedIds: cloudAgent.launchedIds,
                  agentDir: cloudAgent.agentDir,
                  writeBoxFile: cloudAgent.writeBoxFile,
                  onLaunched: ({ bcId }) => delegatedStopper.launched(bcId),
                  ...(cloudAgent.readBoxFile === undefined
                    ? {}
                    : { readBoxFile: cloudAgent.readBoxFile }),
                  ...(cloudAgent.watch === undefined
                    ? {}
                    : { watch: cloudAgent.watch }),
                  ...(cloudAgent.reviewAction === undefined
                    ? {}
                    : { reviewAction: cloudAgent.reviewAction }),
                },
              }),
            }
          : {}
        ),
      };
      const state = dependencies.state;
      if (state === undefined) return provider;
      return {
        ...provider,
        createStateToolInputs: () => ({
          dependencies: state,
          context: buildContextToolDependencies({
            state: state.state,
            selfId: session.id,
            ownMemory: session.memory,
            ...(typeof (memory as { options?: { sandRoot?: unknown } }).options?.sandRoot === "string"
              ? { sandRoot: (memory as { options: { sandRoot: string } }).options.sandRoot }
              : {}),
            resolveAgentName: (id) => resolveAgentDisplayName(id) ?? id,
            loadSubagentTranscript: (id) => readOwnedSubagentTranscript(builtRunner, id),
            agents: conversationAccess.agents,
            related: conversationAccess.related,
            ownSource: () => {
              const store = session.agentStore;
              const blobs = method(store, "getBlobStore")?.();
              if (productionContext === undefined || blobs === undefined || typeof blobs.getBlob !== "function") return null;
              const current = method(builtRunner, "getAgentConversationStateStructure")?.() ?? method(store, "getConversationStateStructure")?.();
              if (!hasPromptTranscriptState(current)) return null;
              return createPromptTranscriptSource({ label: resolveAgentDisplayName(session.id) ?? session.id,
                state: () => method(builtRunner, "getAgentConversationStateStructure")?.() ?? method(store, "getConversationStateStructure")?.(),
                getBlob: async (id) => { const bytes: unknown = await blobs.getBlob(productionContext, id); return bytes instanceof Uint8Array ? bytes : undefined; } });
            },
            loadTranscript: async (id) => {
              const store = sessionApi.store as { getAgentTranscriptEntries?: (agentId: string) => Promise<unknown> } | undefined;
              if (store?.getAgentTranscriptEntries == null) return null;
              let entries: unknown;
              try { entries = await store.getAgentTranscriptEntries(id); } catch { return null; }
              if (!Array.isArray(entries)) return null;
              const roster = method(transcript, "listAgentsSync")?.() ?? [];
              const agent = roster.find((item: { id?: string }) => item.id === id) as { name?: string } | undefined;
              return { label: typeof agent?.name === "string" && agent.name.length > 0 ? agent.name : id, entries };
            },
          }),
        }),
      };
    };

    const createTurnToolInputs = (input: ProductionTurnToolInputs) => {
      const dependencies = hostDependencies();
      const projected = createProductionTurnToolInputs(
        input,
        {
          ...(createTurnToolProjections?.(input) ?? {}),
          ...createTurnWebAndAwaitProjections(input),
          ...(hooks.emitUpdate === undefined
            ? {}
            : { emitUpdate: hooks.emitUpdate }),
        },
      );
      return {
        ...projected,
        hostDependencies: dependencies,
        turnToolsetFactoryProvider: createTurnToolsetFactoryProvider(
          dependencies,
          projected,
        ),
      };
    };

    const createProductionTurnSettleHost = (): TurnSettleHost => {
      const runner = builtRunner as {
        readonly isSubagentRunner?: boolean;
        getBlobStore?: () => unknown;
        getConversationStateStructure?: () => unknown;
        getLatestPromptMessages?: () => readonly unknown[];
        currentRunGeneration?: number;
        setAgentConversationStateStructure?: (structure: TurnCheckpoint) => void;
      } | undefined;
      const store = session.agentStore;
      if (
        store == null
        || typeof store.handleCheckpoint !== "function"
        || typeof store.getMetadata !== "function"
      ) throw new TypeError("production Agent checkpoint store is not bound");
      const generation = runner?.currentRunGeneration;
      return {
        isSubagentRunner: isSharedRoomTurn,
        ...(transcriptMirrorForTurn === undefined
          ? {}
          : { transcriptMirror: transcriptMirrorForTurn }),
        getTranscriptId: () => session.id,
        getBlobStore: () => runner?.getBlobStore?.() ?? getAgentBlobStore(
          store as Parameters<typeof getAgentBlobStore>[0],
        ),
        agentStore: () => ({
          handleCheckpoint: (context: unknown, checkpoint: unknown) =>
            store.handleCheckpoint(context, checkpoint),
          getMetadata: (key: string) => store.getMetadata(key),
        }),
        setLocalState: checkpoint => {
          if (typeof runner?.setAgentConversationStateStructure !== "function") {
            throw new TypeError("production Agent local checkpoint store is not bound");
          }
          runner.setAgentConversationStateStructure(checkpoint);
        },
        ownsRunner: () => true,
        isRunSuperseded: () =>
          generation !== undefined
          && runner?.currentRunGeneration !== undefined
          && runner.currentRunGeneration !== generation,
        latestPromptMessages: () => runner?.getLatestPromptMessages?.() ?? [],
        persistAnnouncedAgentProfile: (snapshots, snapshot, identity) => {
          const profilePromptSnapshotStore = asPromptSnapshotStore(snapshots);
          productionSystemPromptAssembly?.persistAnnouncedAgentProfile(
            profilePromptSnapshotStore,
            snapshot,
            identity,
          );
        },
      };
    };

    runnerOptions.createProductionTurnToolsetHost = (
      input: Omit<ProductionTurnToolsetHostInput, "factoryProvider">,
    ) => createProductionTurnToolsetHost({
      ...input,
      factoryProvider: createTurnToolsetFactoryProvider(
        hostDependencies(),
      ),
      ...(projectedLocalToolPermission === undefined
        ? {}
        : { localToolPermission: projectedLocalToolPermission }),
    });

    if (productionContext !== undefined && productionPromptGlue !== undefined) {
      const turnRequestContext = productionRequestContext;
      const turnAutoReviewGate = autoReviewGate;
      if (turnRequestContext === undefined || turnAutoReviewGate === undefined) {
        throw new TypeError("production turn context owners are not bound");
      }
      const autoReviewModes = autoReview.autoReviewModes ?? {
        hostShell: "off",
        boxShell: "off",
        mcp: "off",
        computer: "off",
        automationWrite: "off",
        cloudAgent: "off",
        subagentLaunch: "off",
      };
      const baseTurn: TurnToolsetTurnInput = {
        autoReviewModes,
        subagentConfigs: builtinSubagentConfigs(method(remoteBox, "isAvailable")?.() !== false),
      };
      const staticModelId = process.env.SAND_AGENT_MODEL ?? DEFAULT_SAND_MODEL;
      const inferenceContextWindow = resolveInferenceContextWindowTokens(staticModelId);
      const catalogContext = readOpenRouterModelContextWindow(staticModelId);
      const localBackgroundSummarizationProps = localBackgroundSummarizationPropsForWindow(
        inferenceContextWindow,
        catalogContext?.autoCompactTokenLimit,
      );
      const lazyToolHost = () => createProductionTurnToolsetHost({
        turn: baseTurn,
        factoryProvider: createTurnToolsetFactoryProvider(hostDependencies()),
        isSubagentRunner: false,
        isSharedRoomRunner: isSharedRoomTurn,
        isBoxScopedSubagent: false,
        isComputerUseSubagent: false,
        isBrowserUseSubagent: false,
        isSystemPromptOverridden: typeof overrides.systemPrompt === "string",
        remoteBoxHasDesktop: true,
        getConversationId: () => session.id,
        getRemoteBoxAvailable: () => method(remoteBox, "isAvailable")?.() !== false,
        cloudAgentsDisabledByTeam: () => method(experiments, "isCloudAgentsDisabledByTeam")?.() ?? false,
        spotlightEnabled: () => method(experiments, "isSpotlightEnabled")?.() ?? false,
        isDynamicToolsEnabled: () => method(experiments, "isDynamicToolsEnabled")?.() ?? false,
        isMultitaskEnabled: () => method(experiments, "isMultitaskEnabled")?.() ?? false,
        isSharedRoomBoxToolsEnabled: () => resolveSharedRoomBoxToolsEnabled(process.env.SAND_SHARED_ROOM_BOX_TOOLS),
        ...(projectedLocalToolPermission === undefined
          ? {}
          : { localToolPermission: projectedLocalToolPermission }),
      });
      const getProductionConversationState = () => {
        const runner = builtRunner as {
          getAgentConversationStateStructure?: () => unknown;
        } | undefined;
        if (typeof runner?.getAgentConversationStateStructure === "function") {
          return runner.getAgentConversationStateStructure();
        }
        const store = session.agentStore;
        if (store != null && typeof store.getConversationStateStructure === "function") {
          return store.getConversationStateStructure();
        }
        throw new TypeError("production Agent conversation state is not bound");
      };
      type ScopedAgentOwnerIdentity = {
        readonly agentId: string;
        readonly isSubagentRunner: boolean;
        readonly toolHost: () => TurnToolsetHost;
        readonly interruptRunner: () => { interrupt?: (value: string) => boolean } | undefined;
      };
      const createScopedAgentOwnerInput = (scope: ScopedAgentOwnerIdentity): ProductionTurnRunShellHostInput["createAgentOwnerInput"] => ({ requestId, runOptions, context, cancelThisRun, emitUpdate }) => {
          // grok_bot_loop_detection is not in experiment-config.gen.ts; getDynamicConfig
          // must fail-soft (see SandExperimentService). Env override short-circuits.
          const loopMode = parseSandLoopDetectionMode(process.env.SAND_LOOP_DETECTION_MODE
            ?? method(experiments, "getDynamicConfig")?.("grok_bot_loop_detection")?.mode);
          if (session.agentStore == null || typeof session.agentStore.getBlobStore !== "function") {
            throw new TypeError("production Agent blob store is not bound");
          }
          const liveAutoReviewModes = turnAutoReviewGate.currentModes();
          const autoReviewRequestContext = new RequestContext({
            env: new RequestContextEnv({
              smartModeClassifierAutoModeEnabled: true,
            }),
          });
          const autoReviewInstructions = turnAutoReviewGate.userInstructions();
          const createShellReview = (
            mode: TurnShellAutoReviewInput["mode"],
            surface: TurnShellAutoReviewInput["surface"],
            approvalSurface: "host_shell" | "box_shell",
          ): TurnShellAutoReviewInput | undefined => mode === "off"
            ? undefined
            : {
                mode,
                agentId: scope.agentId,
                surface,
                requestContext: autoReviewRequestContext,
                ...(autoReviewController === undefined
                  ? {}
                  : { controller: autoReviewController }),
                getApprovalExpiryPolicy: () =>
                  sandAutoReviewApprovalExpiryPolicy("turn"),
                smartModeShellApprovalState:
                  turnAutoReviewGate.shellApprovalState(approvalSurface),
                ...(autoReviewInstructions === undefined
                  ? {}
                  : {
                      userAutoRunInstructions: {
                        allowInstructions: autoReviewInstructions.allowInstructions,
                        blockInstructions: autoReviewInstructions.blockInstructions,
                      },
                    }),
                enforceModelFacingShellUiAutomationGuard:
                  liveAutoReviewModes.hostShell === "enforce"
                  || liveAutoReviewModes.computer === "enforce",
              };
          const hostShellReview = createShellReview(
            liveAutoReviewModes.hostShell,
            "host_machine",
            "host_shell",
          );
          const boxShellReview = createShellReview(
            liveAutoReviewModes.boxShell,
            "isolated_box",
            "box_shell",
          );
          const turn: TurnToolsetTurnInput = {
            ...baseTurn,
            emitUpdate,
            cancelThisRun,
            ...(runOptions.ackToken === undefined
              ? {}
              : { ackToken: runOptions.ackToken }),
            ...(hostShellReview === undefined && boxShellReview === undefined
              ? {}
              : {
                  shellAutoReview: {
                    ...(hostShellReview === undefined
                      ? {}
                      : { host: hostShellReview }),
                    ...(boxShellReview === undefined
                      ? {}
                      : { box: boxShellReview }),
                  },
                }),
          };
          return {
            context,
            conversationId: scope.agentId,
            requestId,
            inference: createTypedInferenceOwner(extensions.api("inference").port),
            onRequestId: requestIdForwarder(hooks, "agent"),
            isSubagentRunner: scope.isSubagentRunner,
            isSilenceAllowed: runOptions.isSilenceAllowed === true,
            ...(runOptions.ackToken === undefined
              ? {}
              : { ackToken: runOptions.ackToken }),
            canUseSelfSummary: () => true,
            cancelThisRun: reason => {
              const runner = scope.interruptRunner();
              runner?.interrupt?.(reason.reason);
            },
            createResourceAccessor: localProductionResourceAccessor,
            createRemoteBoxResourceAccessor: productionResourceAccessor,
            createTurnLocalResourceProjectionInput: baseAccessor => {
              const runner = builtRunner;
              if (runner === undefined) {
                throw new TypeError("production turn resource runner is not bound");
              }
              const projectedActionAuditor = asActionAuditor(actionAuditor);
              if (projectedActionAuditor === undefined) {
                throw new TypeError("production turn action auditor is not bound");
              }
              const createSubagentRunner = (
                agentId: string,
                args: SubagentAdapterArgs,
              ): SubagentSession => {
                const childIsComputerUse = isComputerUseSubagentType(args.subagentType);
                const childIsBrowserUse = isBrowserUseSubagentType(args.subagentType);
                const createChildToolHost = () => createProductionTurnToolsetHost({
                  turn: baseTurn,
                  factoryProvider: createTurnToolsetFactoryProvider(hostDependencies(), undefined, agentId),
                  isSubagentRunner: true,
                  isSharedRoomRunner: isSharedRoomTurn,
                  isBoxScopedSubagent: false,
                  isComputerUseSubagent: childIsComputerUse,
                  isBrowserUseSubagent: childIsBrowserUse,
                  isSystemPromptOverridden: typeof overrides.systemPrompt === "string",
                  remoteBoxHasDesktop: true,
                  getConversationId: () => agentId,
                  getRemoteBoxAvailable: () => method(remoteBox, "isAvailable")?.() !== false,
                  cloudAgentsDisabledByTeam: () => method(experiments, "isCloudAgentsDisabledByTeam")?.() ?? false,
                  spotlightEnabled: () => method(experiments, "isSpotlightEnabled")?.() ?? false,
                  isDynamicToolsEnabled: () => method(experiments, "isDynamicToolsEnabled")?.() ?? false,
                  isMultitaskEnabled: () => method(experiments, "isMultitaskEnabled")?.() ?? false,
                  isSharedRoomBoxToolsEnabled: () => resolveSharedRoomBoxToolsEnabled(process.env.SAND_SHARED_ROOM_BOX_TOOLS),
                  ...(projectedLocalToolPermission === undefined
                    ? {}
                    : { localToolPermission: projectedLocalToolPermission }),
                });
                const createChildTurnSettleHost = (): TurnSettleHost => {
                  const runner = child as {
                    getBlobStore?: () => unknown;
                    getLatestPromptMessages?: () => readonly unknown[];
                    currentRunGeneration?: number;
                    setAgentConversationStateStructure?: (structure: TurnCheckpoint) => void;
                  } | undefined;
                  const store = session.agentStore;
                  const generation = runner?.currentRunGeneration;
                  return {
                    isSubagentRunner: true,
                    ...(transcriptMirrorForTurn === undefined
                      ? {}
                      : { transcriptMirror: transcriptMirrorForTurn }),
                    getTranscriptId: () => agentId,
                    getBlobStore: () => runner?.getBlobStore?.() ?? getAgentBlobStore(
                      store as Parameters<typeof getAgentBlobStore>[0],
                    ),
                    agentStore: () => null,
                    setLocalState: checkpoint => {
                      if (typeof runner?.setAgentConversationStateStructure !== "function") {
                        throw new TypeError("production Agent local checkpoint store is not bound");
                      }
                      runner.setAgentConversationStateStructure(checkpoint);
                    },
                    ownsRunner: () => true,
                    isRunSuperseded: () =>
                      generation !== undefined
                      && runner?.currentRunGeneration !== undefined
                      && runner.currentRunGeneration !== generation,
                    latestPromptMessages: () => runner?.getLatestPromptMessages?.() ?? [],
                    persistAnnouncedAgentProfile: (snapshots, snapshot, identity) => {
                      const profilePromptSnapshotStore = asPromptSnapshotStore(snapshots);
                      productionSystemPromptAssembly?.persistAnnouncedAgentProfile(
                        profilePromptSnapshotStore,
                        snapshot,
                        identity,
                      );
                    },
                  };
                };
                const child = deps.buildRunner({
                  ...runnerOptions,
                  conversationId: agentId,
                  transcriptId: agentId,
                  isSubagent: true,
                  subagentType: args.subagentType,
                  initialState: {
                    turns: [],
                    summaryArchives: [],
                    turnTimings: [],
                  },
                  productionTurnRunShell: createProductionTurnRunShellHostInput({
                    createAgentOwnerInput: createScopedAgentOwnerInput({
                      agentId,
                      isSubagentRunner: true,
                      toolHost: createChildToolHost,
                      interruptRunner: () => child as { interrupt?: (value: string) => boolean } | undefined,
                    }),
                    promptOptions: (_prompt, options) => toGeneratedTurnPromptOptions(options),
                    assembleGeneratedTurnAction: productionPromptGlue.assembleGeneratedTurnAction,
                    compactionEpoch: () => {
                      try {
                        const stateful = child as {
                          getAgentConversationStateStructure?: () => { summaryArchives?: readonly unknown[] };
                        } | undefined;
                        const state = stateful?.getAgentConversationStateStructure?.();
                        return Array.isArray(state?.summaryArchives) ? state.summaryArchives.length : 0;
                      } catch {
                        return 0;
                      }
                    },
                    getConversationState: () => {
                      const stateful = child as {
                        getAgentConversationStateStructure?: () => ConversationStateStructure;
                      } | undefined;
                      const state = stateful?.getAgentConversationStateStructure?.();
                      if (state == null) throw new TypeError("production Agent conversation state is not bound");
                      return state;
                    },
                    ...(mcp.mcp != null && typeof mcp.mcp.getTools === "function"
                      ? {
                          mcp: {
                            getTools: (runContext: Context) => mcp.mcp.getTools(runContext),
                            refreshAccountConfig: () => mcp.mcp.refreshAccountConfig(),
                          },
                        }
                      : {}),
                    createSession: owner => ({
                      getModelId: () => owner.runContext.sessions.agent.getModelId(),
                      getExecutor: () => createTextExecutor(owner.runContext.toolSession.getExecutor()),
                    }),
                    context: () => productionContext,
                    createSettleHost: createChildTurnSettleHost,
                    profilePromptSnapshots: () => session.db,
                    isSubagentRunner: true,
                    subagentType: args.subagentType,
                    subagents: { sessions: new Map() },
                    getConversationId: () => agentId,
                    runGeneration: () => (child as { currentRunGeneration?: number } | undefined)?.currentRunGeneration ?? 0,
                    setActiveTurnRequestSource: () => {},
                    beginAutoReviewUserMessageEpoch: () => {},
                    setActiveRunInterrupted: () => {},
                    setAwaitingUserSelection: () => {},
                    isAwaitingUserSelection: () => false,
                    emitRunLifecycle: event => hooks.onRunLifecycle?.(event),
                    emitUpdate: update => hooks.transport.onUpdate(update),
                    ...(hooks.transport.lastReactionApplied === undefined
                      ? {}
                      : { lastReactionApplied: () => hooks.transport.lastReactionApplied?.() === true }),
                    cancelThisRun: () => {},
                  }),
                });
                bindSessionOwnedRunner(child);
                ownedRunners.add(child);
                // The parent's agent store is attached above and the state read falls back to it, so seed the subagent's own empty state or it replays the parent conversation.
                const seedable = child as {
                  setAgentConversationStateStructure?: (structure: unknown) => void;
                };
                if (typeof seedable.setAgentConversationStateStructure === "function") {
                  seedable.setAgentConversationStateStructure(new ConversationStateStructure());
                }
                return {
                  run: async (prompt, options) => {
                    const result = await child.run(prompt, options);
                    if (typeof result !== "object" || result == null) {
                      throw new TypeError("production subagent result is not bound");
                    }
                    const text = Reflect.get(result, "text");
                    const aborted = Reflect.get(result, "aborted");
                    if (typeof text !== "string" || typeof aborted !== "boolean") {
                      throw new TypeError("production subagent result is not bound");
                    }
                    return { text, aborted };
                  },
                  interrupt: reason => {
                    child.interrupt(reason);
                  },
                  stopSubagents: () => child.stopSubagents?.(),
                  getResolvedOutline: () => child.getResolvedOutline(),
                  getObservedToolCallCount: () => child.getObservedToolCallCount(),
                  getActivitySnapshot: () => child.getActivitySnapshot(),
                  getTranscriptPath: () => child.getTranscriptPath(),
                };
              };
              const computerUse = runner.computerUse;
              const createMcpExecutor = method(mcp.mcp, "createExecutor");
              const createMcpStateExecutor = method(mcp.mcp, "createStateExecutor");
              const resolveNeedsAuthSlot = method(mcp.mcp, "resolveNeedsAuthSlot");
              const mcpForTurn: TurnMcpProjectionInput["mcpForTurn"] | undefined =
                createMcpExecutor === undefined || createMcpStateExecutor === undefined
                  ? undefined
                  : {
                      createExecutor: (persistImage, spillLargeText, auditIdentity) => {
                        const inner = createMcpExecutor(persistImage, spillLargeText, auditIdentity);
                        const library = extensions.api("library");
                        const capture = method(library, "runMcpExecution");
                        const credentialOf = method(library, "mainCredential");
                        return capture === undefined || credentialOf === undefined ? inner : captureLibraryMcpExecution({
                          service: { mainCredential: credentialOf, runMcpExecution: capture },
                          agentId: auditIdentity.agentId,
                          storeId: LIBRARY_MAIN_STORE,
                          connectorAccountOf: args => (args.providerIdentifier ?? args.serverIdentifier ?? "default"),
                          inner,
                        });
                      },
                      createStateExecutor: () => createMcpStateExecutor(),
                      ...(resolveNeedsAuthSlot === undefined
                        ? {}
                        : {
                            resolveNeedsAuthSlot: (providerIdentifier: string) =>
                              resolveNeedsAuthSlot(providerIdentifier),
                          }),
                    };
              const mcpProjection: TurnMcpProjectionInput | undefined = mcpForTurn === undefined
                ? undefined
                : {
                    mcpForTurn,
                    persistImage: persistImageForTurn,
                    textSpiller: undefined,
                    isSubagentRunner: scope.isSubagentRunner,
                    beginObservation: observation => {
                      const startedAtMs = Date.now();
                      return errorClass => {
                        if (errorClass === undefined) return;
                        method(telemetry.brain, "reportToolCallError")?.({
                          conversationId: session.id,
                          requestId: observation.requestId,
                          toolName: "CallMcpTool",
                          toolCallId: observation.toolCallId,
                          connector: observation.connector,
                          errorClass,
                          durationMs: Math.max(0, Date.now() - startedAtMs),
                        });
                      };
                    },
                    boundedConnectorTag,
                    mcpErrorClassOf,
                    takeMcpExecErrorClass,
                    emitConnectorCard: emission => {
                      hooks.transport.onUpdate({
                        type: "send-message",
                        message: connectorCardEmissionToMessage({
                          serverId: emission.serverId,
                          variant: emission.variant,
                          connector: emission.connector ?? emission.serverId,
                        }),
                        timestampMs: Date.now(),
                      }, cancelThisRun);
                    },
                    ...(runOptions.ackToken === undefined
                      ? {}
                      : { ackToken: runOptions.ackToken }),
                    cancelThisRun,
                    reportDiagnostic: event => {
                      method(telemetry.logs, "reportHostExtensionDiagnostic")?.({
                        extension: "mcp",
                        ...event,
                      });
                    },
                    errorLogTag,
                  };
              return {
                subagentSessions: runner.subagents.sessions,
                createSubagentRunner,
                subagentDispatcher: {
                  isRunning: agentId => runner.subagents.isRunning(agentId),
                  allocateComputerUseWindow: agentId =>
                    computerUse?.allocateWindow(agentId) ?? null,
                  freeComputerUseWindow: agentId => {
                    computerUse?.freeWindow(agentId);
                  },
                  dispatch: input => runner.subagents.dispatchBackgroundSubagent(input),
                },
                requestContext: turnRequestContext,
                includeTranscripts: !isSharedRoomTurn,
                autoReviewEnforceEnabled: Object.values(autoReviewModes).includes("enforce"),
                ...(autoReview.autoReviewClassifierExecutor === undefined
                  ? {}
                  : { smartModeClassifierExecutor: autoReview.autoReviewClassifierExecutor }),
                shellStreamExecutor: baseAccessor.get(shellStreamExecutorResource),
                backgroundShellExecutor: baseAccessor.get(backgroundShellExecutorResource),
                autoReviewGate: {
                  assertNoPendingApproval: () => turnAutoReviewGate.assertNoPendingApproval(),
                },
                actionAuditor: projectedActionAuditor,
                agentId: session.id,
                ...(mcpProjection === undefined ? {} : { mcp: mcpProjection }),
              };
            },
            blobStore: getAgentBlobStore(
              session.agentStore as Parameters<typeof getAgentBlobStore>[0],
            ),
            toolHost: scope.toolHost(),
            turn,
            staticConfig: {
              modelId: staticModelId,
              loopDetectionMode: loopMode,
              agentTokenLimit: inferenceContextWindow,
              backgroundSummarizationPropsOverride: localBackgroundSummarizationProps,
              conversationId: scope.agentId,
              isBoxScopedSubagent: false,
              isSubagentRunner: scope.isSubagentRunner,
              isSharedRoomRunner: isSharedRoomTurn,
              sandSendMessageDeliveryOwed: method(experiments, "isSendMessageDeliveryOwedEnabled")?.() ?? false,
              systemPromptGenerator: () => productionSystemPromptAssembly?.getSystemPrompt() ?? DEFAULT_SAND_SYSTEM_PROMPT,
              ...(!scope.isSubagentRunner && productionSystemPromptAssembly !== undefined ? {
                messageHistoryModifier: (...args: readonly unknown[]) => {
                  const messages = args[0];
                  if (!Array.isArray(messages)) throw new TypeError("prompt history is not an array");
                  return productionSystemPromptAssembly.appendFrozenSectionUpdates(messages);
                },
              } : {}),
              // Official 0.71 Xai compaction path: model-window-aware early self-summary.
              selfSummaryConfig: {
                flavor: "xai-compact",
                promptVariant: "generalized",
                preserveUserDeliveryTail: SAND_COMPACTION_DELIVERY_TAIL,
                tokenLimit: catalogContext?.autoCompactTokenLimit ?? Math.min(LOCAL_AUTO_COMPACT_TOKEN_LIMIT, Math.floor(inferenceContextWindow * 0.9)),
                canUseSelfSummary: () => true,
              },
            },
            emitUpdate,
            interactionObservers: {},
            loopDetectionPolicy: createSandLoopDetectionPolicy({ mode: loopMode,
              report: event => console.info("[sand:loop-detection]", JSON.stringify({ agentId: scope.agentId, requestId, ...event })) }),
            ...(!scope.isSubagentRunner && promptPrefixObserver !== undefined ? { promptPrefixObserver } : {}),
            diskPressureReminder: foreverBox.diskPressureReminder,
            ...(productionSystemPromptAssembly === undefined
              ? {}
              : (() => {
                  const profilePromptSnapshotStore = asPromptSnapshotStore(session.db);
                  return profilePromptSnapshotStore === undefined
                    ? {}
                    : { profilePromptSnapshotStore };
                })()),
            emittedConnectorCards: new Set(),
          } satisfies ProductionTurnAgentOwnerInput;
        };
      const createMainAgentOwnerInput = createScopedAgentOwnerInput({
        agentId: session.id,
        isSubagentRunner: false,
        toolHost: lazyToolHost,
        interruptRunner: () => builtRunner as { interrupt?: (value: string) => boolean } | undefined,
      });
      runnerOptions.productionTurnRunShell = createProductionTurnRunShellHostInput({
        createAgentOwnerInput: createMainAgentOwnerInput,
        promptOptions: (_prompt, options) => toGeneratedTurnPromptOptions(options),
        assembleGeneratedTurnAction: productionPromptGlue.assembleGeneratedTurnAction,
        compactionEpoch: () => {
          try {
            const state = getProductionConversationState() as { summaryArchives?: readonly unknown[] };
            return Array.isArray(state.summaryArchives) ? state.summaryArchives.length : 0;
          } catch {
            return 0;
          }
        },
        getConversationState: getProductionConversationState,
        ...(mcp.mcp != null && typeof mcp.mcp.getTools === "function"
          ? {
              mcp: {
                getTools: (runContext: Context) => mcp.mcp.getTools(runContext),
                refreshAccountConfig: () => mcp.mcp.refreshAccountConfig(),
              },
            }
          : {}),
        createSession: owner => ({
          getModelId: () => owner.runContext.sessions.agent.getModelId(),
          getExecutor: () => {
            const executor = createAgentPromptSession(extensions.api("inference").port, () => {}, {
              modelId: owner.runContext.sessions.agent.getModelId(), agentId: session.id, isSummarizationSession: true, skipLabeling: true,
            }).getExecutor();
            if (!isTextPromptExecutor(executor)) throw new TypeError("memory inference executor is not bound");
            return createTextExecutor(executor);
          },
        }),
        context: () => productionContext,
        createSettleHost: createProductionTurnSettleHost,
        profilePromptSnapshots: () => session.db,
        memoryStore: () => !isSharedRoomTurn && isTurnMemoryStore(session.memory) ? session.memory : undefined,
        episodeProgress: () => isEpisodeProgress(session.db) ? session.db : undefined,
        isMemorableExchange,
        isSubagentRunner: false,
        subagents: { sessions: new Map() },
        getConversationId: () => session.id,
        runGeneration: () => (builtRunner as { currentRunGeneration?: number } | undefined)?.currentRunGeneration ?? 0,
        setActiveTurnRequestSource: () => {},
        beginAutoReviewUserMessageEpoch: () => {},
        setActiveRunInterrupted: () => {},
        setAwaitingUserSelection: () => {},
        isAwaitingUserSelection: () => false,
        emitRunLifecycle: event => hooks.onRunLifecycle?.(event),
        emitUpdate: update => hooks.transport.onUpdate(update),
        ...(hooks.transport.lastReactionApplied === undefined
          ? {}
          : { lastReactionApplied: () => hooks.transport.lastReactionApplied?.() === true }),
        cancelThisRun: () => {},
      });
    }

    if (deps.createRunStep != null && runnerOptions.productionTurnRunShell === undefined) {
      runnerOptions.runStep = deps.createRunStep({
        session,
        hooks,
        overrides,
        runnerOptions,
        createTurnToolInputs,
      });
    }

    function bindSessionOwnedRunner(runner: Runner): void {
      runner.setAgentStore(session.agentStore, hooks.agentProfileProvider);
      runner.setMemoryStore(session.memory);
      runner.setUserMemory(runnerOptions.userMemory);
      runner.setProjectMemory(runnerOptions.projectMemory);
      runner.setMemorySnapshotStore(session.db);
      runner.setProfilePromptSnapshotStore(session.db);
      runner.setEpisodeProgress(session.db);
      runner.setAutomationStore(session.automations);
      runner.setWorkflowStore(session.workflows);
      runner.setChannelStore(session.channels);
      runner.setMcp(mcp.mcp);
      runner.setMcpManagement(mcp.management);
      runner.setAttachmentIngestor(hooks.ingestAttachment);
      runner.setImagePersister(hooks.persistImage);
      runner.setMediaBytesPersister(hooks.persistMediaBytes);
    }

    const runner = deps.buildRunner(runnerOptions);
    bindSessionOwnedRunner(runner);
    ownedRunners.add(runner);
    builtRunner = runner;
    // Keep the owner-scoped activation anchor stable while retaining the
    // single real buildRunner call needed by post-construction projections.
    // return deps.buildRunner(runnerOptions);
    return runner;
  }

  return {
    createRunner: (session, hooks) => createRunner(session, hooks),
    createGroupMemberRunner: (session, hooks, groupOverrides) =>
      createRunner(session, hooks, {
        ...groupOverrides,
        groupMemberTurn: true
      }),
    canAskLocalToolPermission: agentId =>
      localToolPermissionSurfaces.has(agentId),
    forgetLocalToolPermission: agentId => {
      localToolPermissionSurfaces.get(agentId)?.();
      localToolPermissionSurfaces.delete(agentId);
      method(localToolPermission, "forgetAgent")?.(agentId);
    },
    dispose: async () => {
      reviewBoxes.clear();
      reviewTurnIds.clear();
      delegatedStopHandlers.clear();
      for (const runner of ownedRunners) {
        const candidate = runner as {
          interrupt?(reason?: string): unknown;
          dispose?(): void | Promise<void>;
        };
        candidate.interrupt?.("host shutdown");
        await candidate.dispose?.();
      }
      ownedRunners.clear();
      for (const unsubscribe of localToolPermissionSurfaces.values()) {
        unsubscribe();
      }
      localToolPermissionSurfaces.clear();
      await mirrorOffloadPool?.closeAll();
      mirrorOffloadPool = null;
    }
  };
}
