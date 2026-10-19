import { z } from "zod";
import { defineCommunicateTool } from "./communicate-tool.js";
import type { Context } from "../../../packages/context/core.js";

export interface RunningSubagentInfo {
  readonly subagentId: string;
  readonly subagentType: string;
  readonly title: string;
  readonly elapsedMs: number;
  readonly toolCallCount: number;
  readonly recentActivity: readonly string[];
  readonly transcriptPath?: string | null;
}

export interface SubagentManagementController<_Context = Context> {
  listRunningSubagents(): readonly RunningSubagentInfo[];
  getRunningSubagent(subagentId: string): RunningSubagentInfo | undefined;
  steerSubagent(subagentId: string, message: string): "steered" | "not-running" | string;
  abortSubagent(subagentId: string): string | Promise<string>;
  stopDelegatedWork?(args: DelegatedStopRequest): Promise<readonly DelegatedStopOutcome[]>;
  reviewSteer?(
    context: Context,
    request: { readonly subagentId: string; readonly message: string; readonly toolCallId: string },
  ): Promise<{ readonly allowed: boolean; readonly reason: string }>;
}

export interface DelegatedStopRequest { readonly visitedAgentIds?: readonly string[]; readonly toolCallId?: string }
export interface DelegatedStopOutcome {
  readonly stopDescendants?: boolean;
  readonly kind: "peer" | "cloud_agent";
  readonly id: string;
  readonly name: string;
  readonly result: "stopped" | "not_running" | "unreachable" | "failed" | "stale";
  readonly detail?: string;
}

export const checkSubagentParameters = z.object({
  subagent_id: z.string().trim().optional().describe(
    "The Agent ID of the subagent to inspect (from the Task tool result that dispatched it). Omit to list every subagent currently running.",
  ),
});

export const messageSubagentParameters = z.object({
  subagent_id: z.string().trim().min(1).describe(
    "The Agent ID of the running subagent to message (from the Task tool result that dispatched it).",
  ),
  message: z.string().trim().min(1).describe(
    "The instruction to inject. The subagent interrupts what it is doing, reads this, and continues from where it was with its context intact.",
  ),
});

export const stopSubagentParameters = z.object({
  subagent_id: z.string().trim().optional().describe(
    "The Agent ID of the running subagent to abort (from the Task tool result that dispatched it).",
  ),
  all: z.boolean().optional().describe("Stop every background subagent you dispatched and reachable work you delegated. Do not combine with subagent_id."),
}).refine(args => (args.all === true) !== Boolean(args.subagent_id), { message: "Pass exactly one of subagent_id or all: true." });

export async function stopAllRunningSubagents(controller: SubagentManagementController, request: DelegatedStopRequest = {}) {
  const running = controller.listRunningSubagents();
  const outcomes = await Promise.all(running.map(async info => {
    try { return { info, result: await controller.abortSubagent(info.subagentId) }; }
    catch (error) { return { info, result: "failed", error: error instanceof Error ? error.message : String(error) }; }
  }));
  const stopped: RunningSubagentInfo[] = [], alreadyFinished: RunningSubagentInfo[] = [];
  const failed: { readonly subagentId: string; readonly error: string }[] = [];
  for (const outcome of outcomes) {
    if (outcome.result === "ok" || outcome.result === "aborted") stopped.push(outcome.info);
    else if (outcome.result === "not-running") alreadyFinished.push(outcome.info);
    else failed.push({ subagentId: outcome.info.subagentId, error: outcome.error ?? outcome.result });
  }
  let delegated: readonly DelegatedStopOutcome[] = [];
  if (controller.stopDelegatedWork !== undefined) {
    try { delegated = await controller.stopDelegatedWork(request); }
    catch (error) { delegated = [{ kind: "peer", id: "", name: "delegated work", result: "failed", detail: error instanceof Error ? error.message : String(error) }]; }
  }
  return { stopped, alreadyFinished, failed, delegated, delegatedWorkUnavailable: controller.stopDelegatedWork === undefined };
}

function formatStopAll(report: Awaited<ReturnType<typeof stopAllRunningSubagents>>): string {
  const lines = [`Stopped ${report.stopped.length} subagent(s); ${report.alreadyFinished.length} already finished; ${report.failed.length} failed.`];
  for (const item of report.stopped) lines.push(`- ${item.subagentId}: stopped`);
  for (const item of report.alreadyFinished) lines.push(`- ${item.subagentId}: already finished`);
  for (const item of report.failed) lines.push(`- ${item.subagentId}: could NOT be stopped; ${item.error}`);
  for (const item of report.delegated) lines.push(`- ${item.kind} ${item.id} (${item.name}): ${item.result}${item.detail === undefined ? "" : `; ${item.detail}`}`);
  if (report.delegatedWorkUnavailable) lines.push("Delegated peer/cloud work is unreachable from this controller and may still be running.");
  lines.push("Do not resume or redispatch stopped work unless the user asks again. Independent background shell processes are not subagents; terminate them by their reported PIDs.");
  return lines.join("\n");
}

export function elapsedLabel(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1_000));
  if (totalSeconds < 90) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export function describeRunningSubagent(
  info: RunningSubagentInfo,
  options: { readonly detailed: boolean },
): string {
  const header = `- ${info.subagentId} [${info.subagentType}] "${info.title}" — running for ${elapsedLabel(info.elapsedMs)}, ${info.toolCallCount} tool call(s)`;
  if (!options.detailed) return header;
  const lines = [header];
  if (info.recentActivity.length > 0) {
    lines.push("  Recent activity (oldest → newest):");
    for (const entry of info.recentActivity) lines.push(`    ${entry}`);
  } else {
    lines.push("  No tool activity recorded yet.");
  }
  if (info.transcriptPath != null) {
    lines.push(`  Full transcript (read it for the complete play-by-play): ${info.transcriptPath}`);
  }
  return lines.join("\n");
}

export function notRunningMessage(
  subagentId: string,
  running: readonly RunningSubagentInfo[],
): string {
  const base = `No subagent "${subagentId}" is currently running. It may have already finished (you're revived automatically with a finished subagent's result), or the id is wrong.`;
  return running.length === 0
    ? `${base} No subagents are running right now.`
    : `${base} Currently running: ${running.map((info) => info.subagentId).join(", ")}.`;
}

export function createSubagentManagementTools(
  controller: SubagentManagementController,
) {
  return [
    defineCommunicateTool(controller, {
      id: "CHECK_SUBAGENT",
      name: "CheckSubagent",
      description: "Check how a background subagent you dispatched (via Task) is doing without waiting for it to finish. Returns its status, how long it has been running, the tool calls it has made recently, and a path to its live transcript you can Read for the full play-by-play. Pass the subagent's Agent ID (from the Task result), or omit it to list every running subagent. Use this when a subagent — especially a computerUse one driving the box desktop — is taking a long time or might be stuck or looping, so you can decide whether to MessageSubagent it or StopSubagent it. This is read-only; it's not polling for completion (you're revived automatically when a subagent finishes).",
      parameters: checkSubagentParameters,
      async execute(_context, args: z.infer<typeof checkSubagentParameters>, dependencies) {
        const id = args.subagent_id;
        if (id == null || id.length === 0) {
          const running = dependencies.listRunningSubagents();
          if (running.length === 0) return "No background subagents are running right now.";
          return [
            `${running.length} subagent(s) running:`,
            ...running.map((info) => describeRunningSubagent(info, { detailed: false })),
            "Pass a subagent_id to see its recent activity and transcript path.",
          ].join("\n");
        }
        const info = dependencies.getRunningSubagent(id);
        return info == null
          ? notRunningMessage(id, dependencies.listRunningSubagents())
          : describeRunningSubagent(info, { detailed: true });
      },
    }),
    defineCommunicateTool(controller, {
      id: "MESSAGE_SUBAGENT",
      name: "MessageSubagent",
      description: "Force a message into a running background subagent to course-correct it without aborting it. The subagent interrupts its current step, reads your message, and continues from where it was (its context is preserved — it does not start over). Use this to unstick or redirect a subagent that is looping, stuck, or heading the wrong way — for example to tell a computerUse subagent to try a different element, that the user just signed in so it can proceed, or to wrap up and report what it has. Pass the subagent's Agent ID (from the Task result). You're still revived with its result when it finishes; to follow up AFTER a subagent has already finished, use Task with the resume parameter instead.",
      parameters: messageSubagentParameters,
      async execute(context: Context, args: z.infer<typeof messageSubagentParameters>, dependencies) {
        if (dependencies.reviewSteer != null) {
          const review = await dependencies.reviewSteer(context, {
            subagentId: args.subagent_id,
            message: args.message,
            toolCallId: dependencies.toolCallId,
          });
          if (!review.allowed) return review.reason;
        }
        if (dependencies.steerSubagent(args.subagent_id, args.message) === "not-running") {
          return notRunningMessage(args.subagent_id, dependencies.listRunningSubagents());
        }
        return `Message delivered to subagent ${args.subagent_id}. It will interrupt what it's doing, take your message into account, and keep working. You'll be revived with its result when it finishes \u2014 don't wait on it.`;
      },
    }),
    defineCommunicateTool(controller, {
      id: "STOP_SUBAGENT",
      name: "StopSubagent",
      description: "Stop a background subagent you dispatched, or pass all:true to stop every running child and reachable work you delegated to peers/cloud agents. Use all:true when the user asks to stop the current work. Results distinguish stopped, already finished and failures; unreachable work may still run. Do not combine all:true with subagent_id. Independent shell processes need their own termination.",
      parameters: stopSubagentParameters,
      async execute(_context, args: z.infer<typeof stopSubagentParameters>, dependencies) {
        if (args.all === true) return formatStopAll(await stopAllRunningSubagents(dependencies, { toolCallId: dependencies.toolCallId }));
        const id = args.subagent_id;
        if (id === undefined || id.length === 0) throw new Error("Stop target was not parsed");
        const result = await dependencies.abortSubagent(id);
        if (result === "not-running") {
          return notRunningMessage(id, dependencies.listRunningSubagents());
        }
        if (result !== "ok" && result !== "aborted") return `Could not stop subagent ${id}: ${result}`;
        return `Stopping subagent ${id}. It will be torn down and won't report back.`;
      },
    }),
  ];
}
