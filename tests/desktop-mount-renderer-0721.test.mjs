import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildDesktopMountRenderer0721 } from "../scripts/lib/desktop-mount-renderer-0721.mjs";

const built = await buildDesktopMountRenderer0721();
const context = vm.createContext({ console, URL, URLSearchParams, performance, setTimeout, clearTimeout,
  TextEncoder, TextDecoder, AbortController, Uint8Array });
vm.runInContext(built.code, context);
const factory = vm.runInContext("RDesktopMountUpstream0721.createMountRenderer", context);
const plain = value => JSON.parse(JSON.stringify(value));
function atom(initial) {
  let value = initial;
  const listeners = new Set();
  return { get: () => value, subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    set(next) { value = next; for (const callback of listeners) callback(); } };
}

function fixture() {
  const agent = { id: "bot-one", name: "Evidence Bot", isGroup: false, lastMessagePreview: "Latest reply" };
  const roster = atom({ agents: { rows: [agent] }, agentsById: new Map([[agent.id, agent]]), hasCompleteRoster: true });
  const experiments = atom({ featureGates: { sand_desktop_mount: true } });
  const boot = atom({ status: "ready" });
  const calls = [], recoveries = [], discarded = [], choices = [];
  let handlers, failure;
  class SourceFailure extends Error { constructor(code) { super(code); this.failure = { code }; } }
  const client = { roster: { snapshots: roster }, experiments: { snapshots: experiments }, boot,
    desktopWindow: { ingestFocusAgent: input => calls.push(["focus", input]) },
    drafts: { recoverDraft: (...args) => recoveries.push(args) } };
  const parts = factory({ client, React: {}, jsx: {}, compiler: {}, Menu: {}, Icon: {}, SourceFailure,
    agentName: agent => agent.name, useSnapshot: () => undefined, platform: "darwin", translate: () => "",
    sendPrompt: async (_client, input) => { calls.push(["send", input]); if (failure) throw new SourceFailure(failure); },
    reportPromise: promise => { void promise.catch(() => {}); }, reportError: error => { throw error; } });
  const source = { subscribe(next) { handlers = next; return () => { handlers = undefined; }; },
    async mount(target) { return { mount: target }; }, async unmount() { return { mount: null }; },
    async offerChoices(input) { choices.push(input); }, async offerPreview() {} };
  const controller = parts.createController({ source, client, choicesOf: parts.choicesOf,
    previewOf: parts.previewOf, discardStaged: path => discarded.push(path) });
  return { agent, parts, controller, calls, recoveries, discarded, choices, roster, experiments,
    emit: input => handlers["prompt-submitted"](input), fail: value => { failure = value; } };
}

test("original mount controller sends once through the client and offers real SVG bot choices", async () => {
  const f = fixture();
  const target = f.parts.makeTarget(f.agent);
  assert.equal(target.agentId, f.agent.id);
  assert.equal(target.name, f.agent.name);
  assert.match(target.markSvgDataUrl, /^data:image\/svg\+xml/);
  await f.controller.mount(target);
  assert.equal(f.choices[0].choices[0].agentId, f.agent.id);
  const attachments = [{ path: "/staged/chart.png", name: "chart.png", size: 12 }];
  f.emit({ agentId: f.agent.id, prompt: "Read this", attachments });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.filter(call => call[0] === "send").length, 1);
  assert.deepEqual(plain(f.calls.find(call => call[0] === "send")[1]), { agentId: f.agent.id, prompt: "Read this", attachments });
  assert.equal(f.recoveries.length, 0);
  f.controller.dispose();
});

test("original send refusal recovers the prompt and staged attachment draft", async () => {
  const f = fixture();
  await f.controller.mount(f.parts.makeTarget(f.agent));
  f.fail("send/attachment-commit-failed");
  const attachments = [{ path: "/staged/failure.txt", name: "failure.txt", size: 4 }];
  f.emit({ agentId: f.agent.id, prompt: "  Keep my draft  ", attachments });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(plain(f.recoveries), [[f.agent.id, { prompt: "Keep my draft", attachments }]]);
  assert.equal(f.discarded.length, 0);
  f.controller.dispose();
});

test("foreign submitted attachments are discarded and gate changes unmount the bot", async () => {
  const f = fixture();
  await f.controller.mount(f.parts.makeTarget(f.agent));
  f.emit({ agentId: "another-bot", prompt: "wrong target", attachments: [{ path: "/staged/foreign", name: "foreign", size: 1 }] });
  assert.deepEqual(f.discarded, ["/staged/foreign"]);
  assert.equal(f.calls.length, 0);
  f.experiments.set({ featureGates: { sand_desktop_mount: false } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.controller.snapshots.get().mount, null);
  f.controller.dispose();
});
