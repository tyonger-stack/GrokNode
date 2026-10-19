import assert from "node:assert/strict";
import test from "node:test";
import { bundleServerPort } from "./server-port-bundle.mjs";
const m = await bundleServerPort(["host/runner/loop-detection-policy"]);
const user = { role: "user", content: "Do the task" };
const pair = (toolName = "Shell", args = { command: "cat result" }, result = "unchanged") => [
  { role: "assistant", content: [{ type: "tool-call", toolName, args }] },
  { role: "tool", content: [{ type: "tool-result", result }] },
];
const repeat = (count, fn = () => pair()) => [user, ...Array.from({ length: count }, (_, i) => fn(i)).flat()];

test("loop policy modes separate observation from reminder application", () => {
  const messages = repeat(3);
  for (const mode of ["off", "shadow", "on"]) {
    const reports = [];
    const policy = m.createSandLoopDetectionPolicy({ mode, report: report => reports.push(report) });
    const note = policy.inspect(messages);
    assert.equal(note !== null, mode === "on");
    assert.equal(reports.length, mode === "off" ? 0 : mode === "shadow" ? 1 : 2);
    assert.ok(!JSON.stringify(reports).includes("cat result"));
  }
  assert.equal(m.parseSandLoopDetectionMode("enabled"), "off");
});

test("only a current repeated suffix counts, and alternating tool cycles are detected", () => {
  assert.equal(m.detectSandMessageLoop(repeat(2)), null);
  assert.equal(m.detectSandMessageLoop([...repeat(3), ...pair("Read", { path: "new-progress" })]), null);
  const alternating = repeat(6, i => pair("Shell", { command: i % 2 ? "pwd" : "ls" }));
  assert.equal(m.detectSandMessageLoop(alternating).period, 2);
  assert.equal(m.detectSandMessageLoop([...repeat(3), user, ...pair()]), null);
});

test("changing results, wait progress and invited retries receive the formal exemptions", () => {
  assert.equal(m.detectSandMessageLoop(repeat(5, i => pair("AwaitShell", { shell_id: "s" }, `step ${i}`))), null);
  assert.equal(m.detectSandMessageLoop(repeat(4, () => pair("AwaitShell", { shell_id: "s" }))), null);
  assert.equal(m.detectSandMessageLoop(repeat(5, () => pair("AwaitShell", { shell_id: "s" }))).repetitions, 5);
  assert.equal(m.detectSandMessageLoop(repeat(20, i => pair("Shell", {}, `step ${i}`))), null);
  assert.equal(m.detectSandMessageLoop(repeat(21, i => pair("Shell", {}, `step ${i}`))).repetitions, 21);
  assert.equal(m.detectSandMessageLoop(repeat(8, () => pair("Shell", {}, "The page changed after review"))), null);
  const images = repeat(8, i => pair("Computer", { action: "screenshot" }, [{ type: "image", data: `image-${i}` }]));
  assert.equal(m.detectSandMessageLoop(images), null);
  assert.equal(m.normalizeSandToolResultForComparison("2026-10-19T12:00:00Z elapsed 12ms <image:20:abcdef1234567890>"),
    "<ts> elapsed <dur> <image:20:abcdef1234567890>");
});

test("outbound flood and real executor middleware inject one reminder before the next request", () => {
  assert.equal(m.detectSandMessageLoop(repeat(8, i => pair("SendMessage", { message: `result ${i}` }))).loopKind, "multi_message_outbound_flood");
  const messages = repeat(2), requests = [];
  const wrapped = m.withSandLoopDetection({ getMessages: () => messages, getState: () => messages,
    clearMessages: () => messages.splice(0), appendMessages: value => messages.push(...(Array.isArray(value) ? value : [value])),
    stream: () => { requests.push([...messages]); return "stream"; } }, m.createSandLoopDetectionPolicy({ mode: "on", report() {} }));
  wrapped.stream({}); wrapped.appendMessages(pair()); wrapped.stream({}); wrapped.stream({});
  assert.equal(requests[1].at(-1).role, "user");
  assert.equal(requests[1].length, requests[2].length);
});

test("shadow mode observes a looping stream without stopping it or recording its text", async () => {
  const reports = [], text = "The synthetic repeated sentence. ".repeat(300);
  const policy = m.createSandLoopDetectionPolicy({ mode: "shadow", report: value => reports.push(value) });
  const response = policy.observeStream({ fullStream: (async function* () { yield { type: "text-delta", textDelta: text }; yield { type: "finish" }; })() });
  const chunks = []; for await (const chunk of response.fullStream) chunks.push(chunk);
  assert.equal(chunks.length, 2); assert.equal(chunks[0].textDelta, text);
  assert.equal(reports[0].loopKind, "single_message_single_line");
  assert.ok(!JSON.stringify(reports).includes("synthetic"));
});
