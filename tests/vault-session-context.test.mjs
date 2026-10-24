import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "node_modules/.cache/vault-session-context.cjs");

async function load() {
  await mkdir(path.dirname(output), { recursive: true });
  await build({
    stdin: {
      contents: [
        'export {parseVaultSessionSnapshot} from "./source/shared/vault.ts";',
        'export {createContextTools, renderVaultCatalog, renderVaultLogin} from "./source/host/runner/tools/context-tools.ts";',
        'export {SettingsService} from "./source/host/extensions/settings/settings-service.ts";',
        'export {createLocalBackendHandlers0721} from "./source/electron-main/local-backend-handlers-0721.ts";',
        'export {canUseGrokBotVault} from "./source/host/runner/vault-session-access.ts";',
      ].join("\n"),
      resolveDir: root,
      loader: "ts",
    },
    outfile: output,
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    logLevel: "error",
  });
  return createRequire(import.meta.url)(output);
}

const snapshot = {
  version: 1,
  updatedAtMs: 1000,
  logins: [{
    id: "login-1",
    title: "Example",
    username: "user@example.test",
    notes: "private note",
    sites: ["https://example.com"],
    password: "synthetic-password",
    updatedAtMs: 1000,
    card: { number: "4242424242424242", securityCode: "123" },
  }],
  contacts: [{
    id: "contact-1",
    title: "Office",
    name: "Synthetic User",
    line1: "1 Example Way",
    line2: "",
    city: "Example City",
    region: "CA",
    postalCode: "00000",
    country: "US",
    phone: "555-0100",
    email: "user@example.test",
    defaultShipping: true,
    updatedAtMs: 1000,
  }],
};

test("session Vault context keeps login/contact data and strips cards", async () => {
  const modules = await load();
  const parsed = modules.parseVaultSessionSnapshot(snapshot);
  assert.equal(parsed.logins[0].password, "synthetic-password");
  assert.equal(parsed.contacts[0].phone, "555-0100");
  assert.equal(JSON.stringify(parsed).includes("4242424242424242"), false);
  assert.equal(JSON.stringify(parsed).includes("securityCode"), false);
  assert.equal(modules.parseVaultSessionSnapshot({ ...snapshot, logins: [{ ...snapshot.logins[0], password: 42 }] }), null);
});

test("Vault tools separate metadata lookup from password resolution", async () => {
  const modules = await load();
  const parsed = modules.parseVaultSessionSnapshot(snapshot);
  const tools = modules.createContextTools({
    state: { writeMemory: async () => ({ ok: true, detail: "saved" }), removeMemory: async () => ({ ok: true, detail: "removed" }) },
    selfId: "agent-1",
    listFacts: () => [],
    loadTranscript: async () => null,
    related: () => [],
    vault: () => parsed,
  });
  const names = tools.map((tool) => tool.name);
  assert.equal(names.includes("vault_list"), true);
  assert.equal(names.includes("vault_get_login"), true);
  const catalog = JSON.parse(modules.renderVaultCatalog(parsed));
  assert.equal(JSON.stringify(catalog).includes("synthetic-password"), false);
  assert.equal(JSON.stringify(catalog).includes("private note"), false);
  assert.equal(catalog.logins[0].username, "user@example.test");
  assert.equal(JSON.parse(modules.renderVaultLogin(parsed, "login-1")).password, "synthetic-password");
  assert.throws(() => modules.renderVaultLogin(parsed, "missing"), /No saved Vault login/);
});

test("session Vault context stays in memory and out of host settings reads", async (t) => {
  const modules = await load();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "vault-session-settings-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const settingsPath = path.join(temporary, "settings.json");
  const service = new modules.SettingsService(settingsPath);
  const parsed = modules.parseVaultSessionSnapshot(snapshot);
  service.setHostSettings({ grokBotVaultContext: parsed });
  assert.equal(service.getGrokBotVaultContext().logins[0].password, "synthetic-password");
  assert.equal(Object.hasOwn(service.getHostSettings(), "grokBotVaultContext"), false);
  const notificationsBefore = service.getHostSettings().notifications;
  assert.throws(() => service.setHostSettings({
    notifications: { isEnabled: true },
    grokBotVaultContext: { version: 1, logins: "malformed", contacts: [] },
  }), /Invalid Grok Bot Vault session context/);
  assert.deepEqual(service.getHostSettings().notifications, notificationsBefore);
  assert.equal(service.getGrokBotVaultContext(), undefined);
  const raw = await readFile(settingsPath, "utf8");
  assert.equal(raw.includes("synthetic-password"), false);
  assert.equal(raw.includes("grokBotVaultContext"), false);
});

test("Vault settings use the shipped 0.75.5 privacy and empty-state copy", async () => {
  const { upstreamVaultMessages0755 } = await import("../frontend/src/recovered/features/vault/upstream-vault-messages-0755.mjs");
  const { upstreamVaultMessages } = await import("../frontend/src/recovered/features/vault/upstream-vault-messages.generated.mjs");
  assert.equal(upstreamVaultMessages0755.en.PgseLK[0],
    "Grok Bot never sees a saved card's number or security code. It can see logins and contact info so it can type them in for you.");
  assert.equal(upstreamVaultMessages0755["zh-CN"].PgseLK[0],
    "Grok Bot 永远看不到已保存卡片的卡号或安全码。它可以查看登录信息和联系信息，以便替你填写。");
  assert.match(upstreamVaultMessages0755["zh-CN"].mx2Qib[0], /新项目/);
  assert.equal(upstreamVaultMessages["zh-CN"].NLLW52[0], "登录信息");
  assert.equal(upstreamVaultMessages["zh-CN"].Ccpbzh[0], "卡片");
  assert.equal(upstreamVaultMessages["zh-CN"].OBRLoG[0], "联系信息");
  assert.equal(upstreamVaultMessages["zh-CN"]["R/b23j"][0], "搜索保险库");
  assert.equal(upstreamVaultMessages["zh-CN"]["2HFHfz"][0],
    "Grok Bot 永远看不到已保存卡片的卡号或安全码。它可以看到登录信息和联系信息，以便替你填写。");
});

test("Vault IPC rejects values outside the local backend bounds", async () => {
  const modules = await load();
  let writes = 0;
  const handlers = modules.createLocalBackendHandlers0721(() => ({
    vault: {
      putGrokBotVaultCredential: async () => { writes += 1; },
      createGrokBotVaultLogins: async () => { writes += 1; return []; },
    },
  }));
  assert.throws(() => handlers.putGrokBotVaultCredential({
    id: "login-1", title: "Example", username: "user@example.test", notes: "",
    sites: Array.from({ length: 11 }, () => "example.com"), password: "synthetic-password",
  }));
  assert.throws(() => handlers.createGrokBotVaultLogins({
    logins: Array.from({ length: 1001 }, () => ({
      title: "Example", username: "user@example.test", notes: "", sites: ["example.com"], password: "x",
    })),
  }));
  assert.equal(writes, 0);
});

test("Vault session access is limited to the primary one-to-one agent", async () => {
  const modules = await load();
  const base = { isSharedRoomTurn: false, isSubagentRunner: false, agentId: "agent-1", sessionId: "agent-1" };
  assert.equal(modules.canUseGrokBotVault(base), true);
  assert.equal(modules.canUseGrokBotVault({ ...base, isSharedRoomTurn: true }), false);
  assert.equal(modules.canUseGrokBotVault({ ...base, isSubagentRunner: true }), false);
  assert.equal(modules.canUseGrokBotVault({ ...base, agentId: "child-agent" }), false);
});
