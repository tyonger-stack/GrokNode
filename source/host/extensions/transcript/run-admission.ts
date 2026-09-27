/** Admission gate for run dispatch: a pure triage of incoming turns before they
 * hit the scheduler. Borrows OpenMausBot's admit() shape (steer/queue/start/
 * refuse over a small surface set) in minimal form: GrokNode runs are
 * single-worker per agent, so this gate only sheds unattended load when the
 * queue is already deep. Interactive turns always queue - never refuse a
 * user.
 */
export type AdmissionSurface =
  | "user"
  | "group"
  | "automation"
  | "connector"
  | "agent";

export type AdmissionVerdict =
  | { readonly action: "start" | "queue" }
  | { readonly action: "refuse"; readonly code: "queue_full" };

export interface AdmissionInput {
  readonly surface: AdmissionSurface;
  /** Current pending depth for the agent (all lanes). */
  readonly queueDepth: number;
  readonly maxQueueDepth: number;
  readonly hasActiveRun: boolean;
}

/** Surfaces that may be refused under pressure: scheduled and machine-driven
 * traffic whose miss is observable via telemetry. User and agent traffic is
 * never refused here. */
const REFUSABLE_SURFACES: ReadonlySet<AdmissionSurface> = new Set([
  "automation",
  "connector",
]);

export function admitRun(input: AdmissionInput): AdmissionVerdict {
  if (!REFUSABLE_SURFACES.has(input.surface)) return { action: "queue" };
  if (input.maxQueueDepth <= 0) return { action: "queue" };
  if (input.queueDepth >= input.maxQueueDepth)
    return { action: "refuse", code: "queue_full" };
  return input.hasActiveRun ? { action: "queue" } : { action: "start" };
}

function readIntEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
): number {
  const parsed = Number.parseInt(env[name]?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

export function resolveMaxRunQueueDepth(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return readIntEnv(env, "SAND_RUN_QUEUE_MAX", 32, 0);
}
