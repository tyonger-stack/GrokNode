import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bundleServerPort } from "./server-port-bundle.mjs";

const { RunnerRegistry, AgentToAgentMessaging, SandAgentDb } = await bundleServerPort([
  "host/extensions/transcript/runner-registry",
  "host/extensions/transcript/agent-to-agent-messaging",
  "host/extensions/session/agent-db",
]);

test("run start publishes its existing request ID to the owning transcript before messages", () => {
  const updates = [], lifecycle = [];
  const manager = {
    handleAgentUpdate: (event, session) => updates.push({ event, owner: session.id }),
    emitAgentRunLifecycle: event => lifecycle.push(event),
    createAttachmentIngestor() {}, createAssetImagePersister() {}, createMediaBytesPersister() {},
  };
  const registry = new RunnerRegistry(manager);
  const owner = registry.runnerHooksFor({ id: "owner" }, {});
  const other = registry.runnerHooksFor({ id: "other" }, {});
  owner.onRunLifecycle({ type: "started", requestId: "existing-owner-request" });
  other.onRunLifecycle({ type: "started", requestId: "existing-other-request" });
  owner.onRunLifecycle({ type: "ended", requestId: "existing-owner-request" });
  assert.deepEqual(updates, [
    { event: { type: "request-id", requestId: "existing-owner-request" }, owner: "owner" },
    { event: { type: "request-id", requestId: "existing-other-request" }, owner: "other" },
  ]);
  assert.equal(lifecycle.length, 3);
});

test("peer messages persist the sender request ID through queue delay on both transcripts", async t => {
  const root = await mkdtemp(join(tmpdir(), "peer-request-id-"));
  const sender = { id: "sender", db: new SandAgentDb(join(root, "sender.db")) };
  const recipient = { id: "recipient", db: new SandAgentDb(join(root, "recipient.db")) };
  t.after(async () => { sender.db.close(); recipient.db.close(); await rm(root, { recursive: true, force: true }); });
  const requestIds = new Map([["sender", "sender-request"], ["recipient", "unrelated-recipient-request"]]);
  const manager = {
    sessions: { liveSessions: new Map([[sender.id, sender], [recipient.id, recipient]]), isAgentGone: () => false },
    groupChat: { isRemoteRoomAgentId: () => false },
    sessionStore: { listAgents: async () => [{ id: "sender", name: "Sender" }, { id: "recipient", name: "Recipient" }], markSessionActivity() {} },
    productAnalytics: { trackEvent() {} },
    runLifecycle: { lastRequestIdBySession: requestIds },
    roster: { async emitAgentUpdate() {} },
  };
  const messaging = new AgentToAgentMessaging(manager);
  messaging.reviveForAgentInbound = async () => {};
  await messaging.sendToAgent("sender", "recipient", "Synthetic peer message");
  requestIds.set("sender", "later-sender-request");
  messaging.appendAgentInboundEntries(recipient, messaging.pendingAgentInbound.get("recipient"));
  assert.equal(sender.db.getTranscriptEntries()[0].requestId, "sender-request");
  assert.equal(recipient.db.getTranscriptEntries()[0].requestId, "sender-request");
});
