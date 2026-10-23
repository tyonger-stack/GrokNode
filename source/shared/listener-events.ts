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
    return { source: "slack", channel: reactionChannel, sender, text: "", isMention: false, reactionEmoji: `:${reaction}:`, timestampMs: now() };
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

/** Host-side admission check for locally injected events (the gateway command input is not trusted by shape alone). */
export function isValidListenerEvent(event: unknown): event is CanonicalListenerEvent {
  if (!record(event)) return false;
  if (event.source === "slack") return typeof event.channel === "string" && event.channel.length > 0 && typeof event.sender === "string" && event.sender.length > 0;
  if (event.source === "github") return typeof event.repo === "string" && isValidGithubRepo(event.repo) && typeof event.kind === "string" && (GITHUB_EVENT_KINDS as readonly string[]).includes(event.kind) && typeof event.actor === "string" && event.actor.length > 0;
  return false;
}
