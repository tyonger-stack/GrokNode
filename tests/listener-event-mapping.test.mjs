import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const cacheDir = path.join(root, "node_modules", ".cache");
await mkdir(cacheDir, { recursive: true });

const jsToTs = { name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null; }); } };

const mappingOut = path.join(cacheDir, "listener-event-mapping-shared.cjs");
await build({ entryPoints: [path.join(root, "source/shared/listener-events.ts")], bundle: true, platform: "node", format: "cjs", outfile: mappingOut, logLevel: "error" });
const shared = createRequire(import.meta.url)(mappingOut);

const triggerOut = path.join(cacheDir, "listener-event-mapping-trigger.cjs");
await build({ entryPoints: [path.join(root, "source/host/automations/automation-trigger.ts")], bundle: true, platform: "node", format: "cjs", outfile: triggerOut, logLevel: "error", plugins: [jsToTs] });
const triggers = createRequire(import.meta.url)(triggerOut);

const repo = (name = "acme/app") => ({ full_name: name });
const sender = (login = "alice") => ({ login });
const pullRequest = (overrides = {}) => ({ title: "Fix login", html_url: "https://github.com/acme/app/pull/7", user: { login: "bob" }, ...overrides });

test("github pull_request actions map to official kinds", () => {
  assert.equal(shared.githubWebhookToListenerEvent("pull_request", { action: "opened", repository: repo(), sender: sender(), pull_request: pullRequest() }).kind, "pr-opened");
  assert.equal(shared.githubWebhookToListenerEvent("pull_request", { action: "synchronize", repository: repo(), sender: sender(), pull_request: pullRequest() }).kind, "pr-pushed");
  assert.equal(shared.githubWebhookToListenerEvent("pull_request", { action: "closed", repository: repo(), sender: sender(), pull_request: pullRequest({ merged: true }) }).kind, "pr-merged");
  assert.equal(shared.githubWebhookToListenerEvent("pull_request", { action: "closed", repository: repo(), sender: sender(), pull_request: pullRequest({ merged: false }) }), null);
  assert.equal(shared.githubWebhookToListenerEvent("pull_request", { action: "reopened", repository: repo(), sender: sender(), pull_request: pullRequest() }), null);
  assert.equal(shared.githubWebhookToListenerEvent("pull_request", { action: "review_requested", repository: repo(), sender: sender(), pull_request: pullRequest() }).kind, "review-requested");
});

test("github review, comment, issue and ci events map to official kinds", () => {
  assert.equal(shared.githubWebhookToListenerEvent("pull_request_review", { repository: repo(), sender: sender(), pull_request: pullRequest(), review: { state: "approved" } }).kind, "review-approved");
  assert.equal(shared.githubWebhookToListenerEvent("pull_request_review", { repository: repo(), sender: sender(), pull_request: pullRequest(), review: { state: "changes_requested" } }).kind, "review-changes-requested");
  assert.equal(shared.githubWebhookToListenerEvent("pull_request_review_comment", { action: "created", repository: repo(), sender: sender(), pull_request: pullRequest() }).kind, "inline-review-comment");
  // issue_comment only counts on PRs, mirroring pr-comment semantics.
  assert.equal(shared.githubWebhookToListenerEvent("issue_comment", { action: "created", repository: repo(), sender: sender(), issue: { title: "T", html_url: "u", user: { login: "bob" }, pull_request: {} } }).kind, "pr-comment");
  assert.equal(shared.githubWebhookToListenerEvent("issue_comment", { action: "created", repository: repo(), sender: sender(), issue: { title: "T", user: { login: "bob" } } }), null);
  assert.equal(shared.githubWebhookToListenerEvent("issues", { action: "assigned", repository: repo(), sender: sender(), issue: { title: "Bug", html_url: "u", user: { login: "bob" } } }).kind, "issue-assigned");
  const ci = { repository: repo(), sender: sender(), check_run: { status: "completed", conclusion: "success", name: "build", html_url: "u", check_suite: { head_branch: "main" } } };
  assert.equal(shared.githubWebhookToListenerEvent("check_run", ci).kind, "ci-passed");
  assert.equal(shared.githubWebhookToListenerEvent("check_run", { ...ci, check_run: { ...ci.check_run, conclusion: "failure" } }).kind, "ci-failed");
  assert.equal(shared.githubWebhookToListenerEvent("check_run", { ...ci, check_run: { ...ci.check_run, conclusion: "neutral" } }), null);
});

test("github canonical event carries matcher fields", () => {
  const event = shared.githubWebhookToListenerEvent("pull_request", { action: "opened", repository: repo(), sender: sender("carol"), pull_request: pullRequest() });
  assert.equal(event.source, "github");
  assert.equal(event.repo, "acme/app");
  assert.equal(event.actor, "carol");
  assert.equal(event.prOwner, "bob");
  assert.equal(event.title, "Fix login");
  assert.equal(typeof event.timestampMs, "number");
  // Malformed repo never becomes an event.
  assert.equal(shared.githubWebhookToListenerEvent("pull_request", { action: "opened", repository: { full_name: "not-a-repo" }, sender: sender(), pull_request: pullRequest() }), null);
  assert.equal(shared.githubWebhookToListenerEvent("push", { repository: repo(), sender: sender() }), null);
  // GitHub's urlencoded default (`payload=<json>`) unwraps before mapping.
  const formEncoded = JSON.stringify({ action: "opened", repository: repo(), sender: sender(), pull_request: pullRequest() });
  assert.equal(shared.githubWebhookToListenerEvent("pull_request", { payload: formEncoded }).kind, "pr-opened");
});

test("slack events api envelope maps to canonical slack events", () => {
  const mention = shared.slackEventToListenerEvent({ team_id: "T1", event: { type: "app_mention", channel: "C123", user: "U9", text: "hello bot", ts: "1.2", thread_ts: "1.1" } });
  assert.equal(mention.source, "slack");
  assert.equal(mention.channel, "C123");
  assert.equal(mention.sender, "@U9");
  assert.equal(mention.isMention, true);
  assert.equal(mention.text, "hello bot");
  const message = shared.slackEventToListenerEvent({ team_id: "T1", event: { type: "message", channel: "C123", user: "U9", text: "plain" } });
  assert.equal(message.isMention, false);
  // Noisy subtypes are dropped, file shares kept.
  assert.equal(shared.slackEventToListenerEvent({ team_id: "T1", event: { type: "message", subtype: "message_changed", channel: "C1", user: "U1", text: "x" } }), null);
  assert.notEqual(shared.slackEventToListenerEvent({ team_id: "T1", event: { type: "message", subtype: "file_share", channel: "C1", user: "U1", text: "x" } }), null);
  const reaction = shared.slackEventToListenerEvent({ team_id: "T1", event: { type: "reaction_added", channel: "C1", user: "U1", reaction: "thumbsup", item: { channel: "C42" } } });
  assert.equal(reaction.reactionEmoji, ":thumbsup:");
  assert.equal(reaction.channel, "C42");
  assert.equal(shared.slackEventToListenerEvent({ team_id: "T1" }), null);
});

test("urlencoded slack payload is unwrapped and url_verification is detected", () => {
  const inner = JSON.stringify({ team_id: "T1", event: { type: "message", channel: "C1", user: "U1", text: "hi" } });
  assert.equal(shared.isSlackEventsApiEnvelope({ payload: inner }), true);
  assert.equal(shared.slackEventToListenerEvent({ payload: inner }).text, "hi");
  assert.equal(shared.slackUrlVerificationChallenge({ payload: JSON.stringify({ type: "url_verification", challenge: "abc123" }) }), "abc123");
  assert.equal(shared.slackUrlVerificationChallenge({ team_id: "T1", event: { type: "message" } }), null);
});

test("injected events match official listener triggers", () => {
  const githubTrigger = triggers.parseStoredTrigger({ type: "github", repo: "acme/app", events: ["pr-opened", "ci-failed"], ciBranch: "main" });
  const opened = shared.githubWebhookToListenerEvent("pull_request", { action: "opened", repository: repo(), sender: sender(), pull_request: pullRequest() });
  const ciFailed = shared.githubWebhookToListenerEvent("check_run", { repository: repo(), sender: sender(), check_run: { status: "completed", conclusion: "failure", name: "build", check_suite: { head_branch: "main" } } });
  assert.equal(triggers.triggerMatchesEvent(githubTrigger, opened), true);
  assert.equal(triggers.triggerMatchesEvent(githubTrigger, ciFailed), true);
  // Wrong repo and wrong branch do not match.
  assert.equal(triggers.triggerMatchesEvent(githubTrigger, { ...opened, repo: "other/repo" }), false);
  assert.equal(triggers.triggerMatchesEvent(githubTrigger, { ...ciFailed, branch: "dev" }), false);
  const slackTrigger = triggers.parseStoredTrigger({ type: "slack", channel: "*", match: { kind: "mention" } });
  const mention = shared.slackEventToListenerEvent({ team_id: "T1", event: { type: "app_mention", channel: "C1", user: "U1", text: "hi" } });
  const plain = shared.slackEventToListenerEvent({ team_id: "T1", event: { type: "message", channel: "C1", user: "U1", text: "hi" } });
  assert.equal(triggers.triggerMatchesEvent(slackTrigger, mention), true);
  assert.equal(triggers.triggerMatchesEvent(slackTrigger, plain), false);
});

test("host admission check accepts canonical shapes and rejects junk", () => {
  assert.equal(shared.isValidListenerEvent({ source: "slack", channel: "C1", sender: "@U1" }), true);
  assert.equal(shared.isValidListenerEvent({ source: "github", repo: "a/b", kind: "pr-opened", actor: "x" }), true);
  assert.equal(shared.isValidListenerEvent({ source: "github", repo: "a/b", kind: "made-up", actor: "x" }), false);
  assert.equal(shared.isValidListenerEvent({ source: "teams", channel: "x" }), false);
  assert.equal(shared.isValidListenerEvent(null), false);
  assert.equal(shared.isValidListenerEvent("hello"), false);
  assert.equal(shared.isValidListenerEvent({ source: "slack", sender: "@U1" }), false);
});
