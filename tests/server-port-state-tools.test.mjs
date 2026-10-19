import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({ stdin: { resolveDir: new URL("..", import.meta.url).pathname,
  contents: 'export * from "./source/host/runner/tools/sand-split-state-tools.ts"; export * from "./source/host/runner/tools/sand-state-tool.ts"; export * from "./source/packages/context/core.ts";' },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
async function invoke(tools, name, args) {
  const tool = tools.find(item => item.name === name);
  assert.ok(tool, name);
  return tool.execute(m.createContext(), { executeToolCall: async (ctx, _initial, _id, run) => run(ctx) },
    (async function* () { yield JSON.stringify(args); })(), { toolCallId: name });
}
const ok = detail => ({ ok: true, detail });

test("split profile preserves omitted fields and writes settings only when supplied", async () => {
  const profile = { name: "Existing", title: "Before" }, settings = { hiddenFromSidebar: false }, writes = [];
  const tools = m.createSandSplitStateTools({ state: {
    updateProfile: async fields => { writes.push("profile"); Object.assign(profile, fields); return ok("profile"); },
    updateSettings: async fields => { writes.push("settings"); Object.assign(settings, fields); return ok("settings"); },
  } });
  await invoke(tools, "UpdateProfile", { title: "After", hidden_from_sidebar: true });
  assert.deepEqual(profile, { name: "Existing", title: "After" });
  assert.deepEqual(settings, { hiddenFromSidebar: true });
  assert.deepEqual(writes, ["profile", "settings"]);
  writes.length = 0;
  await invoke(tools, "UpdateProfile", { notify_on_updates: false });
  assert.deepEqual(writes, ["settings"]);
});

test("split routines use the legacy parser and cannot bypass a denied review", async () => {
  const writes = [];
  let allowed = false;
  const deps = { state: { createAutomation: async value => { writes.push(value); return ok("created"); } },
    reviewAutomationWrite: async () => ({ allowed, reason: "denied" }) };
  const args = { action: "create", name: "Check", prompt: "Report status", schedule: "17 8 * * 1-5" };
  await invoke(m.createSandSplitStateTools(deps), "UpdateRoutine", args);
  assert.deepEqual(writes, []);
  allowed = true;
  await invoke(m.createSandSplitStateTools(deps), "UpdateRoutine", args);
  await invoke([m.createSandStateTool(deps)], "update_state", { ...args, target: "routine" });
  assert.deepEqual(writes, [
    { spec: { name: "Check", prompt: "Report status", trigger: { type: "cron", schedule: "17 8 * * 1-5" }, isEnabled: true } },
    { spec: { name: "Check", prompt: "Report status", trigger: { type: "cron", schedule: "17 8 * * 1-5" }, isEnabled: true } },
  ]);
});

test("split state actions retain pending-approval guards and reject foreign target arguments", async () => {
  let writes = 0;
  const tools = m.createSandSplitStateTools({ assertNoPendingAutoReviewApproval() { throw new Error("pending"); },
    state: { clearAvatar: async () => { writes++; return ok("cleared"); } } });
  const blocked = await invoke(tools, "UpdateAvatar", { action: "clear" });
  assert.equal(blocked.result.case, "error");
  assert.equal(writes, 0);
  await assert.rejects(invoke(tools, "UpdateAvatar", { action: "clear", target: "profile" }), /Unrecognized key/);
  assert.equal(writes, 0);
  assert.ok(tools.every(tool => tool.contextType.type === "dynamic"));
});

test("profile failure prevents subsequent settings writes", async () => {
  let settingsWrites = 0;
  const tools = m.createSandSplitStateTools({ state: {
    updateProfile: async () => ({ ok: false, reason: "protected" }),
    updateSettings: async () => { settingsWrites++; return ok("settings"); },
  } });
  await invoke(tools, "UpdateProfile", { name: "New", hidden_from_sidebar: true });
  assert.equal(settingsWrites, 0);
});
