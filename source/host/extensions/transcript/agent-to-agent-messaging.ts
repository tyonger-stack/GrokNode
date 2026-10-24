import {
  buildAgentInboundWakePrompt,
  clampAgentMessage,
} from "../../agents/agent-messaging.js";
import { sandErrorDetail } from "../../ports/telemetry.js";
import { entryRaisesUserActivitySignal } from "../../../shared/transcript.js";
import { describeAgentRunError } from "./agent-run-error.js";
import { loadAgentInboundImages } from "./send-message-shaping.js";
import { nextEntryId } from "./transcript-entry-ids.js";
import { getTranscript } from "./transcript-store.js";
import { classifyAgentError } from "./turn-runtime.js";
import type { TranscriptManagerLike } from "./transcript-hub.js";
import type { DelegatedStopOutcome } from "../../runner/tools/sand-subagent-management-tools.js";

export interface AgentInboundMessage {
  from: { id: string; name: string };
  text: string;
  timestampMs: number;
  requestId?: string;
  images?: readonly { url: string; alt?: string }[];
  priority?: boolean;
  isDisplayed?: boolean;
  isRedriven?: boolean;
}
export function partitionAgentInbound<T extends { priority?: boolean }>(
  messages: readonly T[],
): { priority: T[]; rest: T[] } {
  const priority: T[] = [],
    rest: T[] = [];
  for (const message of messages)
    (message.priority === true ? priority : rest).push(message);
  return { priority, rest };
}
export function prioritizeAgentInbound<T extends { priority?: boolean }>(
  messages: readonly T[],
): T[] {
  const parts = partitionAgentInbound(messages);
  return [...parts.priority, ...parts.rest];
}
export function mergeAgentInboundQueue<T extends { priority?: boolean }>(
  queued: readonly T[],
  deferred: readonly T[],
): T[] {
  const newer = partitionAgentInbound(queued),
    older = partitionAgentInbound(deferred);
  return [...newer.priority, ...older.priority, ...older.rest, ...newer.rest];
}

export class AgentToAgentMessaging {
  readonly pendingAgentInbound = new Map<string, AgentInboundMessage[]>();
  readonly revivingAgentInboundIds = new Set<string>();
  readonly activeBatches = new Map<string, readonly AgentInboundMessage[]>();
  readonly activeMessages = new Map<string, AgentInboundMessage>();
  readonly withdrawnMessages = new WeakSet<AgentInboundMessage>();
  readonly settledMessages = new WeakSet<AgentInboundMessage>();
  constructor(readonly tm: TranscriptManagerLike) {}

  async stopDelegatedFromAgent(fromAgentId: string, visitedAgentIds: readonly string[] = []): Promise<readonly DelegatedStopOutcome[]> {
    const targets = new Set([...this.pendingAgentInbound.keys(), ...this.activeBatches.keys(), ...this.activeMessages.keys()]);
    const outcomes: DelegatedStopOutcome[] = [];
    for (const id of targets) {
      const pending = this.pendingAgentInbound.get(id) ?? [];
      const batch = this.activeBatches.get(id) ?? [];
      const owned = [...pending, ...batch].filter(message => message.priority === true && message.from.id === fromAgentId && !this.withdrawnMessages.has(message) && !this.settledMessages.has(message));
      if (owned.length === 0) continue;
      const base = { kind: "peer" as const, id, name: id };
      if (visitedAgentIds.includes(id)) { outcomes.push({ ...base, result: "unreachable", detail: "Delegation cycle; the caller was not interrupted." }); continue; }
      for (const message of owned) this.withdrawnMessages.add(message);
      this.pendingAgentInbound.set(id, pending.filter(message => !this.withdrawnMessages.has(message)));
      const active = this.activeMessages.get(id);
      const lane = this.tm.runLifecycle.runScheduler?.getActiveLane(id);
      const isOwnedActive = active !== undefined && active.priority === true && active.from.id === fromAgentId;
      if (!isOwnedActive || lane === "user" || this.tm.turnRuntime.activeRequestSources.get(id) !== "agent") {
        outcomes.push({ ...base, result: isOwnedActive ? "unreachable" : "stopped", detail: "Pending handoff withdrawn; unrelated active work was not interrupted." });
        continue;
      }
      const runner = this.tm.runnerRegistry.runners.get(id);
      if (runner === undefined) { outcomes.push({ ...base, result: "unreachable", detail: "The active delegated runner is unavailable." }); continue; }
      this.tm.backgroundWakes.dmPreemptedWakeAgentIds.delete(id);
      try {
        try { runner.stopSubagents?.(); } finally { runner.interrupt("Stopped by the agent that delegated this work."); }
        outcomes.push({ ...base, result: "stopped", stopDescendants: true });
      } catch (error) { outcomes.push({ ...base, result: "failed", detail: error instanceof Error ? error.message : String(error) }); }
    }
    return outcomes;
  }

  async sendToAgent(
    fromAgentId: string,
    toAgentId: string,
    text: string,
    images: readonly { url: string; alt?: string }[] = [],
    priority = false,
  ): Promise<string> {
    const message = clampAgentMessage(text);
    if (message.length === 0) return "Message was empty; nothing was sent.";
    if (toAgentId === fromAgentId) return "An agent can't message itself.";
    if (this.tm.sessions.isAgentGone(toAgentId))
      return "That agent no longer exists.";
    if (this.tm.groupChat.isRemoteRoomAgentId(toAgentId))
      return "That is a shared chat hosted by another user; agents can't message it directly.";
    const roster = await this.tm.sessionStore.listAgents();
    const target = roster.find((agent: any) => agent.id === toAgentId);
    if (target == null) return `No agent found with id ${toAgentId}.`;
    if (target.isGroup) {
      const ack = await this.tm.postToGroup(
        fromAgentId,
        toAgentId,
        message,
        priority,
      );
      const notes: string[] = [];
      if (images.length > 0)
        notes.push(
          `Note: the attached image${images.length === 1 ? " was" : "s were"} NOT delivered — group messages are text-only for now; send images to an agent directly.`,
        );
      if (priority)
        notes.push(
          "Note: priority is 1:1 only — this post did not interrupt members.",
        );
      return notes.length === 0 ? ack : `${ack} ${notes.join(" ")}`;
    }
    this.tm.productAnalytics.trackEvent("sand.agent_message.sent", {
      from_agent_id: fromAgentId,
      to_agent_id: toAgentId,
      is_group_target: false,
      is_priority: priority,
    });
    const sender = roster.find((agent: any) => agent.id === fromAgentId);
    this.tm.sessions.liveSessions
      .get(fromAgentId)
      ?.db.addConversationPartner(toAgentId);
    this.appendAgentOutboundEntry(
      fromAgentId,
      { id: toAgentId, name: target.name, kind: "agent" },
      message,
      Date.now(),
      images,
    );
    const inbound: AgentInboundMessage = {
      from: { id: fromAgentId, name: sender?.name ?? "An agent" },
      text: message,
      timestampMs: Date.now(),
      requestId: this.tm.runLifecycle.lastRequestIdBySession.get(fromAgentId),
      ...(images.length === 0 ? {} : { images }),
      ...(priority ? { priority: true } : {}),
    };
    const queued = this.pendingAgentInbound.get(toAgentId) ?? [];
    if (priority) {
      this.pendingAgentInbound.set(toAgentId, [inbound, ...queued]);
      this.steerRecipientForPriorityPeer(toAgentId);
    } else {
      queued.push(inbound);
      this.pendingAgentInbound.set(toAgentId, queued);
    }
    void this.reviveForAgentInbound(toAgentId);
    return priority
      ? `Sent to ${target.name} as a priority message — it will interrupt their current non-user work and wake them now. This is asynchronous — if they reply, it'll arrive later as a new message that wakes you; don't wait on it now.`
      : `Sent to ${target.name}. This is asynchronous — if they reply, it'll arrive later as a new message that wakes you; don't wait on it now.`;
  }

  steerRecipientForPriorityPeer(agentId: string): void {
    const scheduler = this.tm.runLifecycle.runScheduler;
    if (scheduler == null || scheduler.getActiveLane(agentId) === "user")
      return;
    const reason = "superseded by a priority agent message";
    const wasInFlight = this.tm.runLifecycle.runningAgentIds().has(agentId);
    const hadGroupRun =
      this.tm.runnerRegistry.activeGroupMemberRunners
        .get(agentId)
        ?.interrupt(reason) ?? false;
    if (hadGroupRun) this.tm.groupChat.dmPreemptedGroupMemberIds.add(agentId);
    const hadDirectRun =
      this.tm.runnerRegistry.runners.get(agentId)?.interrupt(reason) ?? false;
    if (hadDirectRun)
      this.tm.backgroundWakes.dmPreemptedWakeAgentIds.add(agentId);
    if (hadDirectRun || hadGroupRun || wasInFlight)
      this.tm.telemetry.reportTurnInterrupt({
        conversationId: agentId,
        reason: "agent_steer",
        hadActiveRun: hadDirectRun || hadGroupRun,
        wasInFlight,
      });
  }

  async reviveForAgentInbound(agentId: string): Promise<void> {
    if (
      !this.tm.execution.canExecute ||
      this.revivingAgentInboundIds.has(agentId)
    )
      return;
    this.revivingAgentInboundIds.add(agentId);
    try {
      while ((this.pendingAgentInbound.get(agentId)?.length ?? 0) > 0) {
        const messages = prioritizeAgentInbound(
          this.pendingAgentInbound.get(agentId) ?? [],
        );
        this.pendingAgentInbound.delete(agentId);
        await this.runAgentInboundWake(agentId, messages);
      }
    } finally {
      this.revivingAgentInboundIds.delete(agentId);
    }
  }

  async runAgentInboundWake(
    agentId: string,
    messages: readonly AgentInboundMessage[],
  ): Promise<void> {
    if (messages.length === 0 || !this.tm.execution.canExecute) return;
    let session: any;
    try {
      session = await this.tm.sessions.resolveBackgroundSession(agentId);
    } catch {
      return;
    }
    if (
      this.tm.groupChat.isGroupSession(session) ||
      this.tm.groupChat.isRemoteRoomSession(session)
    )
      return;
    this.appendAgentInboundEntries(
      session,
      messages.filter((message) => message.isDisplayed !== true),
    );
    const runner = this.tm.runnerRegistry.getRunner(session);
    this.activeBatches.set(agentId, [...(this.activeBatches.get(agentId) ?? []), ...messages]);
    this.tm.runLifecycle.beginSessionRun(session);
    try { await this.tm.runLifecycle.enqueueExclusiveRun(
      session.id,
      async () => {
        this.tm.turnRuntime.activeRequestPrompts.delete(session.id);
        this.tm.turnRuntime.activeRequestSources.set(session.id, "agent");
        this.tm.backgroundWakes.dmPreemptedWakeAgentIds.delete(session.id);
        try {
          for (const [index, message] of messages.entries()) {
            if (this.withdrawnMessages.has(message)) continue;
            if (
              index > 0 &&
              (this.pendingAgentInbound.get(agentId) ?? []).some(
                (pending) => pending.priority === true,
              )
            ) {
              const deferred = messages
                .slice(index)
                .map((remaining) => ({ ...remaining, isDisplayed: true }));
              this.pendingAgentInbound.set(
                agentId,
                mergeAgentInboundQueue(
                  this.pendingAgentInbound.get(agentId) ?? [],
                  deferred,
                ),
              );
              return;
            }
            const selectedImages = await loadAgentInboundImages(message.images);
            if (this.withdrawnMessages.has(message)) continue;
            this.activeMessages.set(agentId, message);
            const result = await runner.run(
              buildAgentInboundWakePrompt(message),
              {
                hidden: true,
                isSilenceAllowed: true,
                ...(selectedImages.length === 0 ? {} : { selectedImages }),
              },
            ).finally(() => {
              if (this.activeMessages.get(agentId) === message) this.activeMessages.delete(agentId);
              this.settledMessages.add(message);
            });
            const preempted =
              this.tm.backgroundWakes.dmPreemptedWakeAgentIds.delete(
                session.id,
              );
            if (result.aborted && result.quiescedForUpgrade !== true) {
              if (!preempted || this.tm.sessions.isAgentGone(agentId)) return;
              const redrivable = messages
                .slice(index)
                .filter((remaining) => remaining.isRedriven !== true && !this.withdrawnMessages.has(remaining))
                .map((remaining) => ({
                  ...remaining,
                  isDisplayed: true,
                  isRedriven: true,
                }));
              if (redrivable.length > 0)
                this.pendingAgentInbound.set(
                  agentId,
                  mergeAgentInboundQueue(
                    this.pendingAgentInbound.get(agentId) ?? [],
                    redrivable,
                  ),
                );
              return;
            }
          }
          await this.tm.roster.emitAgentUpdate(session.id);
        } catch (error) {
          this.tm.telemetry.reportAgentError({
            source: "agent",
            conversationId: session.id,
            requestId: this.tm.runLifecycle.lastRequestIdBySession.get(
              session.id,
            ),
            error: classifyAgentError(error),
            detail: sandErrorDetail(error),
          });
          this.tm.trayErrors.pushError({
            agentId: session.id,
            title: "Message from another agent failed",
            ...describeAgentRunError(error),
          });
        } finally {
        }
      },
      { lane: "agent", source: "agent" },
    ); } finally {
      const remaining = (this.activeBatches.get(agentId) ?? []).filter(message => !messages.includes(message));
      if (remaining.length === 0) this.activeBatches.delete(agentId);
      else this.activeBatches.set(agentId, remaining);
      const active = this.activeMessages.get(agentId);
      if (active !== undefined && messages.includes(active)) this.activeMessages.delete(agentId);
      this.tm.runLifecycle.endSessionRun(session);
    }
  }

  appendAgentInboundEntries(
    session: any,
    messages: readonly AgentInboundMessage[],
  ): void {
    const isActive = session.id === this.tm.sessions.activeSession?.id;
    let raisesActivity = false;
    for (const message of messages) {
      session.db.addConversationPartner(message.from.id);
      const entries = isActive
        ? getTranscript()
        : session.db.getTranscriptEntries();
      const entry = {
        kind: "message",
        id: nextEntryId(entries, "user-message"),
        role: "user",
        content: message.text,
        isStreaming: false,
        timestampMs: message.timestampMs,
        fromAgent: message.from,
        ...(message.requestId == null ? {} : { requestId: message.requestId }),
        ...(message.images?.length ? { images: message.images } : {}),
      };
      raisesActivity ||= entryRaisesUserActivitySignal(entry);
      if (isActive) this.tm.appendEntry(entry);
      else session.db.appendTranscriptEntry(entry);
    }
    if (!isActive) {
      if (raisesActivity) this.tm.sessionStore.markSessionActivity(session);
      void this.tm.roster.emitAgentUpdate(session.id);
    }
  }
  appendAgentOutboundEntry(
    fromAgentId: string,
    toAgent: { readonly kind?: string; readonly [key: string]: unknown },
    text: string,
    timestampMs: number,
    images: readonly { url: string; alt?: string }[] = [],
  ): void {
    const session = this.tm.sessions.liveSessions.get(fromAgentId);
    if (session == null) return;
    const isActive = session.id === this.tm.sessions.activeSession?.id;
    const requestId = this.tm.runLifecycle.lastRequestIdBySession.get(fromAgentId);
    const entry = {
      kind: "message",
      id: nextEntryId(
        isActive ? getTranscript() : session.db.getTranscriptEntries(),
        "assistant-message",
      ),
      role: "assistant",
      content: text,
      isStreaming: false,
      timestampMs,
      toAgent,
      ...(requestId == null ? {} : { requestId }),
      ...(images.length === 0 ? {} : { images }),
    };
    if (isActive) this.tm.appendEntry(entry);
    else {
      session.db.appendTranscriptEntry(entry);
      if (entryRaisesUserActivitySignal(entry))
        this.tm.sessionStore.markSessionActivity(session);
      void this.tm.roster.emitAgentUpdate(session.id);
    }
  }
}
