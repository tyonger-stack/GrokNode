import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export { minimalAgentSummary, buildSummary } from "./source/host/extensions/session/session-summaries.ts";export { listAgents, summarizeAgentById } from "./source/host/extensions/session/session-roster.ts";export { writeSandGroupConfig } from "./source/host/groups/group-store.ts";', resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
const api = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "group-roster-summary-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dir = path.join(directory, "project-group");
  await mkdir(dir);
  await writeFile(path.join(dir, "store.db"), "fixture");
  await writeFile(path.join(dir, "profile.json"), JSON.stringify({ name: "项目群", description: "", title: "", avatarColor: "violet", avatarShape: "circle" }));
  const args = { dbPath: path.join(dir, "store.db"), dirName: "project-group", includeBlank: true };
  const host = { rootDir: directory, isAgentBeingDeleted: () => false, memory: { agentHasContent: () => false }, loadCachedExtras: async () => null, recoverAgentWithMissingDb: async () => null, pruneExtrasCache() {} };
  return { dir, args, host };
}
test("normal and minimal summaries carry the persisted group identity and member IDs", async t => {
  const { dir, args } = await fixture(t);
  api.writeSandGroupConfig(dir, { version: 1, memberIds: ["one", "two"] });
  for (const summary of [api.minimalAgentSummary(args), await api.buildSummary(args)]) {
    assert.equal(summary.isGroup, true);
    assert.deepEqual(summary.memberIds, ["one", "two"]);
  }
});
test("listing, one-agent refresh, and degraded summaries expose the same group", async t => {
  const { dir, args, host } = await fixture(t);
  api.writeSandGroupConfig(dir, { version: 1, memberIds: ["one", "two"] });
  const summaries = [await api.summarizeAgentById(host, args.dirName), ...(await api.listAgents(host))];
  host.loadCachedExtras = async () => { throw new Error("fixture database unavailable"); };
  summaries.push(...(await api.listAgents(host)));
  for (const summary of summaries) {
    assert.equal(summary.isGroup, true);
    assert.deepEqual(summary.memberIds, ["one", "two"]);
  }
});
test("member edits are visible on the next summary without changing the profile", async t => {
  const { dir, args } = await fixture(t);
  api.writeSandGroupConfig(dir, { version: 1, memberIds: ["one", "two"] });
  assert.deepEqual((await api.buildSummary(args)).memberIds, ["one", "two"]);
  api.writeSandGroupConfig(dir, { version: 1, memberIds: ["two", "three"] });
  assert.deepEqual((await api.buildSummary(args)).memberIds, ["two", "three"]);
});
test("private Bots and malformed group files remain private", async t => {
  const { dir, args } = await fixture(t);
  assert.equal((await api.buildSummary(args)).isGroup, false);
  await writeFile(path.join(dir, "group.json"), "invalid JSON");
  assert.equal((await api.buildSummary(args)).isGroup, false);
  assert.deepEqual((await api.buildSummary(args)).memberIds, []);
});
