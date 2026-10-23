import { GITHUB_EVENT_KINDS, isValidGithubRepo, REACTION_EMOJI_PATTERN, normalizeReactionEmoji } from "./automations.js";

/**
 * Local listener-event ingestion (Grok Node).
 *
 * In the hosted product, Slack/GitHub listener events reach the box through
 * the Cursor backend relay: the server normalizes platform deliveries into
 * the wire shape that `mapRelayWireEvent` (host extensions/automations/
 * backend-relay-source.ts) accepts, and `SandTriggerHub.triggerMatchesEvent`
 * consumes the canonical result. Grok Node has no backend relay, so platform
 * deliveries arrive through the local webhook listener instead
 * (electron-main/webhook-automation-listener.ts). These pure helpers translate
 * a GitHub webhook delivery (the `x-github-event` header plus the JSON body)
 * and a Slack Events API envelope into the SAME canonical event shape the
 * relay produces, so the existing matching/firing pipeline consumes them
 * unchanged. Only kinds already declared in GITHUB_EVENT_KINDS are produced —
 * no new event vocabulary is invented here.
 */

export type CanonicalListenerEvent = Record<string, unknown> & { readonly source: "slack" | "github" };

const MAX_EVENT_TEXT_CHARS = 8_000;
const MAX_EVENT_FIELD_CHARS = 220;

/**
 * The only webhook-forward outcomes that prove the presented routine key was
 * verified host-side (automation-runtime.ts emits 404/401 before any key
 * check, 202 after a verified key fired the routine, 409 after a verified
 * key found the routine paused). The ingestion gate and its tests share this
 * table so the cross-file contract lives in one place.
 */
export const INGESTION_VERIFIED_FORWARD_STATUSES: readonly number[] = [202, 409];

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value != null && !Array.isArray(value); }
function str(value: unknown): string { return typeof value === "string" ? value : ""; }
function fieldOf(owner: unknown, key: string): unknown { return record(owner) ? owner[key] : undefined; }
function clampText(value: string): string { return value.length > MAX_EVENT_TEXT_CHARS ? value.slice(0, MAX_EVENT_TEXT_CHARS) : value; }

/** Form-encoded platform deliveries (`payload=<json>`, GitHub's and Slack's urlencoded default) unwrap to the inner object. */
export function unwrapJsonPayloadField(payload: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof payload.payload !== "string") return payload;
  try {
    const parsed = JSON.parse(payload.payload) as unknown;
    return record(parsed) ? parsed : null;
  } catch { return null; }
}

/** Slack Events API bodies may arrive JSON-direct or urlencoded (`payload=<json>`); unwrap to the inner object. */
export function unwrapSlackEventsApiPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  return unwrapJsonPayloadField(payload);
}

export function isSlackEventsApiEnvelope(payload: Record<string, unknown>): boolean {
  const inner = unwrapSlackEventsApiPayload(payload);
  if (inner == null) return false;
  if (inner.type === "url_verification" && typeof inner.challenge === "string") return true;
  return typeof inner.team_id === "string" && record(inner.event);
}

export function slackUrlVerificationChallenge(payload: Record<string, unknown>): string | null {
  const inner = unwrapSlackEventsApiPayload(payload);
  if (inner?.type !== "url_verification") return null;
  return typeof inner.challenge === "string" && inner.challenge.length > 0 ? inner.challenge : null;
}

/** Slack Events API envelopes carry no delivery header; the envelope's own event_id is the platform's retry identity. */
export function slackEventDeliveryId(payload: Record<string, unknown>): string | undefined {
  const inner = unwrapSlackEventsApiPayload(payload);
  if (inner == null) return undefined;
  for (const candidate of [inner.event_id, record(inner.event) ? inner.event.event_id : undefined]) {
    if (typeof candidate === "string" && candidate.length > 0 && candidate.length <= MAX_EVENT_FIELD_CHARS) return candidate;
    if (typeof candidate === "number" && Number.isSafeInteger(candidate)) return String(candidate);
  }
  return undefined;
}

/**
 * Map a Slack Events API envelope to the canonical slack event. Channel is
 * kept as the raw channel id: the hosted relay resolves channel names
 * server-side, which a local receiver cannot do without a Slack API token.
 * Listeners scoped to a named channel should use the `*` (any-scope) trigger
 * or configure the channel id directly.
 */
export function slackEventToListenerEvent(payload: Record<string, unknown>, now: () => number = Date.now): CanonicalListenerEvent | null {
  const inner = unwrapSlackEventsApiPayload(payload);
  if (inner == null || typeof inner.team_id !== "string" || !record(inner.event)) return null;
  const event = inner.event;
  const channel = str(event.channel), user = str(event.user), ts = str(event.ts), threadTs = str(event.thread_ts);
  if (channel.length === 0 || user.length === 0) return null;
  const sender = `@${user}`;
  if (event.type === "app_mention") {
    return { source: "slack", channel, sender, text: clampText(str(event.text)), isMention: true, ...(ts ? { ts } : {}), ...(threadTs ? { threadTs } : {}), timestampMs: now() };
  }
  if (event.type === "reaction_added") {
    const reaction = normalizeReactionEmoji(str(event.reaction));
    if (!REACTION_EMOJI_PATTERN.test(reaction)) return null;
    const item = record(event.item) ? event.item : null;
    const reactionChannel = str(item?.channel) || channel;
    // bySelf triggers mean "the installing user reacted". The Events API
    // envelope's authorizations[] list the installing user ids, so a reaction
    // by one of them carries isSelf, mirroring the hosted relay's field.
    const installers = Array.isArray(inner.authorizations)
      ? inner.authorizations.map((entry) => str(fieldOf(entry, "user_id"))).filter((id) => id.length > 0)
      : [];
    const isSelf = installers.includes(user);
    return { source: "slack", channel: reactionChannel, sender, text: "", isMention: false, reactionEmoji: `:${reaction}:`, ...(isSelf ? { isSelf: true } : {}), timestampMs: now() };
  }
  if (event.type === "message") {
    // Skip noisy/derived subtypes (edits, joins, bot echo); plain user messages
    // and file shares are the deliveries a routine listener cares about.
    const subtype = str(event.subtype);
    if (subtype !== "" && subtype !== "file_share") return null;
    return { source: "slack", channel, sender, text: clampText(str(event.text)), isMention: false, ...(ts ? { ts } : {}), ...(threadTs ? { threadTs } : {}), timestampMs: now() };
  }
  return null;
}

/** Map a GitHub webhook delivery (`x-github-event` header value + parsed body) to the canonical github event. */
export function githubWebhookToListenerEvent(eventName: string | undefined, rawPayload: Record<string, unknown>, now: () => number = Date.now): CanonicalListenerEvent | null {
  if (eventName == null || eventName.length === 0) return null;
  const payload = unwrapJsonPayloadField(rawPayload) ?? rawPayload;
  const repository = record(payload.repository) ? payload.repository : null;
  const repo = str(repository?.full_name);
  if (!isValidGithubRepo(repo)) return null;
  const actor = str(fieldOf(payload.sender, "login")) || "someone";
  const pullRequestOf = (): Record<string, unknown> | null => (record(payload.pull_request) ? payload.pull_request : null);
  const kindKind = (kind: string): string | null => ((GITHUB_EVENT_KINDS as readonly string[]).includes(kind) ? kind : null);
  let kind: string | null = null, title = "", url = "", prOwner = "", branch = "";
  if (eventName === "pull_request") {
    const pullRequest = pullRequestOf();
    if (pullRequest == null) return null;
    const action = str(payload.action);
    title = str(pullRequest.title); url = str(pullRequest.html_url); prOwner = str(fieldOf(pullRequest.user, "login"));
    if (action === "opened") kind = "pr-opened";
    else if (action === "synchronize") kind = "pr-pushed";
    else if (action === "closed" && pullRequest.merged === true) kind = "pr-merged";
    else if (action === "review_requested") kind = "review-requested";
  } else if (eventName === "pull_request_review") {
    const pullRequest = pullRequestOf();
    if (pullRequest == null) return null;
    title = str(pullRequest.title); url = str(pullRequest.html_url); prOwner = str(fieldOf(pullRequest.user, "login"));
    const state = str(fieldOf(payload.review, "state"));
    if (state === "approved") kind = "review-approved";
    else if (state === "changes_requested") kind = "review-changes-requested";
    else if (state === "commented") kind = "review-commented";
  } else if (eventName === "pull_request_review_comment" && str(payload.action) === "created") {
    const pullRequest = pullRequestOf();
    if (pullRequest == null) return null;
    title = str(pullRequest.title); url = str(pullRequest.html_url); prOwner = str(fieldOf(pullRequest.user, "login"));
    kind = "inline-review-comment";
  } else if (eventName === "issue_comment" && str(payload.action) === "created") {
    const issue = record(payload.issue) ? payload.issue : null;
    if (issue == null || !record(issue.pull_request)) return null;
    title = str(issue.title); url = str(issue.html_url); prOwner = str(fieldOf(issue.user, "login"));
    kind = "pr-comment";
  } else if (eventName === "issues" && str(payload.action) === "assigned") {
    const issue = record(payload.issue) ? payload.issue : null;
    if (issue == null) return null;
    title = str(issue.title); url = str(issue.html_url); prOwner = str(fieldOf(issue.user, "login"));
    kind = "issue-assigned";
  } else if (eventName === "check_run" && str(fieldOf(payload.check_run, "status")) === "completed") {
    const checkRun = record(payload.check_run) ? payload.check_run : null;
    const suite = record(fieldOf(checkRun, "check_suite")) ? fieldOf(checkRun, "check_suite") as Record<string, unknown> : null;
    branch = str(fieldOf(suite, "head_branch"));
    const conclusion = str(fieldOf(checkRun, "conclusion"));
    if (conclusion === "success") kind = "ci-passed";
    else if (conclusion === "failure" || conclusion === "timed_out") kind = "ci-failed";
    title = str(fieldOf(checkRun, "name")); url = str(fieldOf(checkRun, "html_url"));
  }
  const verifiedKind = kindKind(kind ?? "");
  if (verifiedKind == null) return null;
  return {
    source: "github", repo, kind: verifiedKind, title: clampText(title), actor,
    ...(url ? { url } : {}), ...(prOwner ? { prOwner } : {}), ...(branch ? { branch } : {}), timestampMs: now(),
  };
}

/**
 * Host-side admission check for locally injected events (the gateway command input is not trusted by shape alone).
 * Enforces at least what the mappers guarantee, so the raw gateway-command path
 * (which bypasses the mappers) cannot push oversized or malformed fields into
 * the model-facing trigger context.
 */
export function isValidListenerEvent(event: unknown): event is CanonicalListenerEvent {
  if (!record(event)) return false;
  if (event.source === "slack") {
    if (typeof event.channel !== "string" || event.channel.length === 0 || event.channel.length > MAX_EVENT_FIELD_CHARS) return false;
    if (typeof event.sender !== "string" || event.sender.length === 0 || event.sender.length > MAX_EVENT_FIELD_CHARS) return false;
    if (typeof event.text !== "undefined" && !(typeof event.text === "string" && event.text.length <= MAX_EVENT_TEXT_CHARS)) return false;
    if (event.reactionEmoji !== undefined && !(typeof event.reactionEmoji === "string" && /^:[a-z0-9_+-]+:$/.test(event.reactionEmoji))) return false;
    if (event.isMention !== undefined && typeof event.isMention !== "boolean") return false;
    if (event.isSelf !== undefined && typeof event.isSelf !== "boolean") return false;
    return true;
  }
  if (event.source === "github") {
    if (typeof event.repo !== "string" || !isValidGithubRepo(event.repo)) return false;
    if (typeof event.kind !== "string" || !(GITHUB_EVENT_KINDS as readonly string[]).includes(event.kind)) return false;
    if (typeof event.actor !== "string" || event.actor.length === 0 || event.actor.length > MAX_EVENT_FIELD_CHARS) return false;
    if (event.title !== undefined && !(typeof event.title === "string" && event.title.length <= MAX_EVENT_TEXT_CHARS)) return false;
    if (event.prOwner !== undefined && !(typeof event.prOwner === "string" && event.prOwner.length <= MAX_EVENT_FIELD_CHARS)) return false;
    if (event.branch !== undefined && !(typeof event.branch === "string" && event.branch.length <= MAX_EVENT_FIELD_CHARS)) return false;
    if (event.url !== undefined && !(typeof event.url === "string" && event.url.length <= 2_048)) return false;
    return true;
  }
  return false;
}
