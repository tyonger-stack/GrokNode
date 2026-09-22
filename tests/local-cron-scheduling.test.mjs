import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");

async function load(name) {
  const cache = path.join(root, "node_modules", ".cache");
  await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(path.join(cache, "local-cron-"));
  const outfile = path.join(temporary, name + ".cjs");
  await build({
    entryPoints: [path.join(root, "source/host/extensions/automations/" + name + ".ts")],
    outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent",
  });
  return { module: createRequire(import.meta.url)(outfile), dispose: () => rm(temporary, { recursive: true }) };
}

test("cron routines run from the local scheduler when cloud credentials are absent", async () => {
  const loaded = await load("sand-automation-cloud-sync");
  const ledger = path.join(await mkdtemp(path.join(root, "node_modules", ".cache", "cron-ledger-")), "ledger.json");
  try {
    let backendCalls = 0;
    const sync = new loaded.module.SandAutomationCloudSync({
      client: new Proxy({}, { get: () => () => { backendCalls += 1; throw new Error("backend"); } }),
      hasCredential: () => false,
      listAgentIds: async () => [],
      listAutomations: async () => [],
      onFailure() {}, onRecovery() {}, onSchedulingAuthorityChanged() {},
    });
    const automation = { id: "routine", trigger: { type: "cron", schedule: "* * * * *" } };
    assert.equal(sync.shouldScheduleLocally({ agentId: "agent", automation }), true);
    const fired = [];
    const scheduler = new loaded.module.LocalCronScheduler({
      ledgerPath: ledger,
      now: () => Date.parse("2026-09-22T03:00:30Z"),
      listAutomations: async () => [{ agentId: "agent", automation: { ...automation, isEnabled: true, createdAt: Date.parse("2026-09-22T02:59:00Z") } }],
      fire: async (agentId, item) => fired.push([agentId, item.id]),
    });
    await scheduler.tick();
    await scheduler.tick();
    assert.deepEqual(fired, [["agent", "routine"]]);
    assert.equal(backendCalls, 0);
  } finally { await loaded.dispose(); }
});
