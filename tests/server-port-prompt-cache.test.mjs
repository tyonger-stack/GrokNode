import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { bundleServerPort } from "./server-port-bundle.mjs";

const m = await bundleServerPort(["host/runner/frozen-prompt-section", "host/runner/prompt-prefix-observation", "host/extensions/session/agent-db",
  "packages/redaction/core-message", "packages/redaction/classification"]);

test("frozen sections announce live changes once and refresh only at the next summary", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "frozen-sections-"));
  const db = new m.SandAgentDb(path.join(directory, "store.db"));
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  let epoch = 0;
  const live = { timezone: "TZ-A", automations: "ROUTINE-A", agent_directory: "BOT-A", mcp_instructions: "MCP-A" };
  const make = () => m.createFrozenPromptSections({ snapshots: () => db, compactionEpoch: () => epoch, enabled: () => true,
    renderers: Object.fromEntries(Object.keys(live).map(name => [name, () => live[name]])) });
  const sections = make();
  for (const name of Object.keys(live)) assert.equal(sections.render(name), live[name]);
  live.automations = "ROUTINE-B"; live.agent_directory = "BOT-B"; live.mcp_instructions = "MCP-B";
  assert.equal(sections.render("automations"), "ROUTINE-A");
  const messages = [m.toRedactedCoreMessage({ role: "user", content: "QUERY" }, 3)];
  const changed = sections.appendUpdates(messages);
  assert.equal(changed.length, 2);
  assert.equal(changed[1]._privacyMode, 3);
  assert.equal(db.getPromptSectionSnapshot("automations").announcedRender, "ROUTINE-B");
  assert.equal(db.getPromptSectionSnapshot("mcp_instructions").announcedRender, undefined);
  assert.equal(sections.appendUpdates(changed), changed);
  assert.equal(make().render("automations"), "ROUTINE-A");
  epoch = 1;
  assert.equal(sections.render("automations"), "ROUTINE-B");
  assert.equal(sections.render("mcp_instructions"), "MCP-B");
  live.timezone = "";
  assert.equal(sections.render("timezone"), "TZ-A");
  db.clearConversation();
  assert.equal(sections.render("agent_directory"), "BOT-B");
});

test("prefix diagnostics distinguish changed schemas and tool order without recording content", () => {
  const state = new Map(), reports = [];
  const store = { getPromptSectionSnapshot: name => state.get(name), setPromptSectionSnapshot: (name, value) => state.set(name, value) };
  const input = { snapshots: () => store, compactionEpoch: () => 0, sections: () => [{ name: "automations", render: "PRIVATE-ROUTINE" }], report: report => reports.push(report) };
  const observer = m.createPromptPrefixObserver(input);
  const request = { reason: "agent", messages: [{ role: "system", content: "PRIVATE-SYSTEM" }, { role: "user", content: "PRIVATE-QUESTION" }],
    tools: [{ name: "One", parameters: { type: "object" } }, { name: "Two", parameters: { type: "object" } }] };
  observer.observe(request).onUsage({ inputTokens: 100, cacheReadTokens: 80 });
  m.createPromptPrefixObserver(input).observe({ ...request, tools: [...request.tools].reverse() });
  assert.deepEqual(reports.at(-1).changedTools, ["~order"]);
  observer.observe({ ...request, tools: [{ name: "One", parameters: { type: "string" } }, request.tools[1]] });
  assert.ok(reports.at(-1).changedTools.includes("One"));
  const serialized = JSON.stringify({ reports, state: [...state] });
  for (const content of ["PRIVATE-SYSTEM", "PRIVATE-QUESTION", "PRIVATE-ROUTINE"]) assert.equal(serialized.includes(content), false);
  assert.equal(reports.find(report => report.phase === "usage").cacheReadTokens, 80);
});

test("summary metadata and tool-less auxiliary requests cannot overwrite the main prefix", () => {
  const state = new Map(), reports = [];
  const observer = m.createPromptPrefixObserver({ snapshots: () => ({ getPromptSectionSnapshot: key => state.get(key), setPromptSectionSnapshot: (key, value) => state.set(key, value) }),
    compactionEpoch: () => 0, sections: () => [], report: value => reports.push(value) });
  const request = { reason: "agent", messages: [{ role: "system", content: "MAIN" }], tools: [{ name: "One" }] };
  observer.observe(request);
  const main = state.get("_prefix_observation");
  observer.observe({ ...request, messages: [{ role: "user", content: "SUMMARY", providerOptions: { cursor: { inferenceReason: "agent-summarization" } } }] });
  assert.equal(state.get("_prefix_observation"), main);
  observer.observe({ ...request, tools: [] });
  assert.equal(state.get("_prefix_observation"), main);
  observer.observe(request);
  assert.deepEqual(reports.at(-1).changedSections, []);
});
