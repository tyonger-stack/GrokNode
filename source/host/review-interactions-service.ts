import type { TranscriptManager } from "./extensions/transcript/transcript-manager.js";
import type { PrivateUserFormBox } from "./runner/browser/user-form-fill.js";
import { createPrivateUserFormFill } from "./runner/browser/user-form-fill.js";
import { ReviewTranscriptStore } from "./extensions/transcript/review-transcript-store.js";
import { createReviewDraftStore } from "./extensions/transcript/review-draft-store.js";
import { bindReviewMcp, createReviewDraftExecute } from "./review-mcp-execution.js";
import { DraftSends, type DraftStore } from "./extensions/transcript/draft-sends.js";
import { createDraftExternalMessageTool } from "./runner/tools/draft-external-message-tool.js";
import { createDraftAttachmentPreparer, type DraftAttachmentDependencies, type DraftAttachmentTool } from "./runner/tools/draft-attachments.js";
import { createUserFormTools } from "./runner/tools/user-form-tool.js";
import { UserFormService } from "./extensions/session/user-form-service.js";
import type { ReviewInteractionsPort } from "./extensions/transcript/review-interactions-port.js";
import { discardDraftRequestSchema, sendDraftRequestSchema } from "../shared/external-drafts.js";
import type { DraftExecute } from "./runner/tools/draft-connector.js";
import { randomUUID } from "node:crypto";
import type { ReviewAttachmentResolver } from "./review-attachments.js";

export interface ReviewInteractionsDependencies {
  readonly transcript: TranscriptManager;
  readonly mcp: unknown;
  readonly resolvePrivateBox: (agentId: string) => Promise<PrivateUserFormBox | undefined>;
  // Authorized attachment resolution. Absent means every attachment send is refused.
  readonly resolveAttachment?: ReviewAttachmentResolver;
  readonly onError?: (code: string, error: unknown) => void;
}

export interface ReviewTurnScope {
  readonly agentId: string;
  readonly requestId: string;
  readonly endThisRunAwaitingUser: (reason: string) => void;
  // Feeds turn delivery stats/ack after the entry is durable. The entry is never
  // written twice: TurnRuntime fulfills ack on reviewEntryId without re-appending.
  readonly onCardShown?: (entryId: string, message: Readonly<Record<string, unknown>>) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function createReviewInteractions(deps: ReviewInteractionsDependencies): ReviewInteractionsPort & {
  toolsForTurn(scope: ReviewTurnScope): readonly unknown[];
  onTurnStarted(agentId: string, requestId: string): void;
  stopAgent(agentId: string): void;
} {
  const transcripts = new ReviewTranscriptStore(deps.transcript);
  const draftStore = createReviewDraftStore(transcripts);
  const report = (code: string, error: unknown): void => {
    try {
      deps.onError?.(code, error);
    } catch {
      console.warn("review_interactions_reporter_failed");
    }
    if (deps.onError == null) console.warn(code);
  };
  const turns = new Map<string, { readonly requestId: string; readonly onCardShown: ReviewTurnScope["onCardShown"] }>();
  const cached = new Map<string, { readonly sends: DraftSends; readonly execute: DraftExecute }>();
  const sendsFor = (agentId: string): { readonly sends: DraftSends; readonly execute: DraftExecute } => {
    const hit = cached.get(agentId);
    if (hit !== undefined) return hit;
    // One DraftSends per agent: execute is bound to that agent, so a shared
    // instance would send under the wrong identity and its sweep could mark a
    // live send from another agent unconfirmed.
    const binding = bindReviewMcp(deps.mcp, agentId);
    const execute = createReviewDraftExecute(binding, {
      // Slot comes from the bound authoritative authslot; never guessed here.
      // Agent-scoped append only: never the pipeline card that would switch sessions.
      onNeedsAuth: ({ serverName }) =>
        transcripts.open(agentId).then(session => {
          session.append({ type: "connector", connector: serverName, variant: "connect", reason: "Connect the account before sending this draft." }, {});
        }).catch(error => report("draft_auth_card_failed", error)),
    });
    const store: DraftStore = {
      read: key => key.agentId === agentId ? draftStore.read(key) : Promise.resolve(null),
      compareAndSet: (expected, next) => expected.agentId === agentId && next.agentId === agentId
        ? draftStore.compareAndSet(expected, next)
        : Promise.resolve(false),
      // The shared store scans every agent; scoping here keeps each sweep on
      // its own stranded entries without touching centralized code.
      listSending: async () => (await draftStore.listSending()).filter(entry => entry.agentId === agentId),
    };
    const prepared = createDraftAttachmentPreparer({
      listTools: async (): Promise<readonly DraftAttachmentTool[]> => {
        if (binding === null) return [];
        const discovered: unknown = await binding.listTools();
        const list: readonly unknown[] = Array.isArray(discovered) ? discovered : [];
        const tools: DraftAttachmentTool[] = [];
        for (const tool of list) {
          if (!isRecord(tool)) continue;
          if (typeof tool.providerIdentifier !== "string" || typeof tool.toolName !== "string") continue;
          tools.push({ providerIdentifier: tool.providerIdentifier, toolName: tool.toolName, inputSchema: tool.inputSchema });
        }
        return tools;
      },
      // Default deny: only an explicitly wired resolver can authorize ids.
      // The anonymous closure drops nothing: agentId is bound here so the resolver can check ownership.
      resolveAttachment: request => deps.resolveAttachment?.({ ...request, agentId }) ?? Promise.resolve(null),
    });
    const sends = new DraftSends({
      store,
      execute,
      // Durable writes already emit roster updates inside the review store.
      onUpdate: () => undefined,
      // Never block the send RPC on the hidden resume turn; wake in background.
      onSettled: (entry, prompt) => {
        void transcripts.wake(entry.agentId, prompt).catch(error => report("draft_settle_wake_failed", error));
        return Promise.resolve();
      },
      prepareAttachments: prepared,
    });
    const entry = { sends, execute };
    cached.set(agentId, entry);
    return entry;
  };
  const userForms = new UserFormService({
    privateFill: createPrivateUserFormFill(deps.resolvePrivateBox),
    emitForm: (agentId, message) => transcripts.open(agentId).then(session => {
      const entryId = session.append(message, {});
      turns.get(agentId)?.onCardShown?.(entryId, message);
      return entryId;
    }),
    onStateChange: async (agentId, entryId, receipt) => {
      // Receipts carry status/ids only, never values; the client maps
      // userFormState/formResolution straight from these strings.
      const session = await transcripts.open(agentId);
      session.update(entryId, entry => ({
        ...entry,
        userFormState: receipt.status,
        ...(receipt.status === "shown" ? {} : { formResolution: receipt.status }),
      }));
    },
    onReceipt: async (agentId, receipt) => {
      // Recovery lease is a fresh random token bound to exactly this receipt:
      // any routine or new user turn that merely shares the agent id cannot inherit held values.
      const recoveryTurnId = randomUUID();
      userForms.activateResumeTurn(agentId, recoveryTurnId, receipt.requestId);
      // Full typed receipt: ids, statuses, reasons and submit flags only, never values.
      // The model needs fields/remapFieldIds to know which targets to remap.
      await transcripts.wake(
        agentId,
        JSON.stringify({ type: "user-form", ...receipt }),
        recoveryTurnId,
      ).catch(error => report("user_form_receipt_wake_failed", error));
    },
    onError: code => report(code, undefined),
  });
  return {
    sendDraft: request => sendsFor(sendDraftRequestSchema.parse(request).agentId).sends.sendDraft(request),
    discardDraft: request => sendsFor(discardDraftRequestSchema.parse(request).agentId).sends.discardDraft(request),
    submitUserForm: request => userForms.submit(request),
    dismissUserForm: async request => userForms.dismiss(request),
    onTurnStarted: (agentId, requestId) => {
      // Metadata only: the lease is bound at receipt time to its own recovery turn id,
      // so starting a turn never rebinds another form`s held values to this turn.
      turns.set(agentId, { requestId, onCardShown: turns.get(agentId)?.onCardShown });
    },
    toolsForTurn: scope => {
      turns.set(scope.agentId, { requestId: scope.requestId, onCardShown: scope.onCardShown });
      const agent = sendsFor(scope.agentId);
      const draft = createDraftExternalMessageTool({
        execute: agent.execute,
        emitDraft: async emission => {
        const entryId = await draftStore.publish(scope.agentId, emission);
        scope.onCardShown?.(entryId, emission.message);
        return entryId;
      },
      });
      const forms = createUserFormTools({
        userForms,
        getAgentId: () => scope.agentId,
        getTurnId: () => scope.requestId,
        endThisRunAwaitingUser: scope.endThisRunAwaitingUser,
      });
      return [draft, ...forms];
    },
    onTurnEnded: (agentId, requestId) => {
      if (turns.get(agentId)?.requestId === requestId) turns.delete(agentId);
      // Pending forms survive the original turn end; only submitted ones settle.
      userForms.settleTurn(agentId, requestId);
    },
    stopAgent: agentId => {
      // Draft sends are user-authorized clicks; stopping the bot never revokes them.
      userForms.settleTurn(agentId, turns.get(agentId)?.requestId ?? "", "stopped");
      turns.delete(agentId);
    },
    recover: async () => {
      // Memory first: expireAll awaits its state callbacks, so no receipt lands after the sweep.
      await userForms.expireAll();
      for (const agentId of await transcripts.listAgentIds()) {
        const session = await transcripts.open(agentId);
        for (const entry of session.readEntries()) {
          if (!isRecord(entry.message) || entry.message.type !== "user-form") continue;
          const state: unknown = entry.userFormState;
          const settled = entry.formResolution !== undefined && entry.formResolution !== null;
          const open = state === undefined || state === "pending" || state === "shown";
          if (settled || !open) continue;
          // Restart orphan: request memory is gone and values were never persisted.
          session.update(entry.id, current => {
            const currentState: unknown = current.userFormState;
            const currentSettled = current.formResolution !== undefined && current.formResolution !== null;
            const stillOpen = currentState === undefined || currentState === "pending" || currentState === "shown";
            return currentSettled || !stillOpen ? current : { ...current, userFormState: "expired", formResolution: "expired" };
          });
        }
        // Uniform stranded sweep, never a resend: each agent instance only sees
        // its own entries, and live sends stay claimed by their instance.
        await sendsFor(agentId).sends.sweepStrandedDraftSends();
      }
    },
    dispose: () => {
      // Instances are dropped, not cancelled: in-flight user sends keep going.
      turns.clear();
      cached.clear();
      // Pending form values and timers belong to this instance and die with it.
      userForms.dispose();
    },
  };
}
