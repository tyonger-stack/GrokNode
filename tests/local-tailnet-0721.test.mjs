import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, chmod, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

const cache = path.resolve("node_modules/.cache");
await mkdir(cache, { recursive: true });
const root = await mkdtemp(path.join(cache, "local-tailnet-0721-"));
const output = path.join(root, "tailnet.mjs");
await build({ entryPoints: ["source/electron-main/tailnet/local-tailnet.ts"], outfile: output,
  bundle: true, platform: "node", format: "esm", logLevel: "silent" });
const { createLocalTailnet } = await import(pathToFileURL(output).href);
const key = randomBytes(32);
const codec = {
  isEncryptionAvailable: () => true,
  encryptString(value) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
  },
  decryptString(value) {
    const decipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8");
  },
};

test("Tailnet uses real CLI argv, encrypted credentials and persisted team scope", async () => {
  const log = path.join(root, "argv.jsonl"), cli = path.join(root, "tailscale-fixture");
  await writeFile(cli, `#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2);
let secretSeen=false,secretMode=null;
const flag=args.find(x=>x.startsWith('--client-secret=file:'));
if(flag){const p=flag.slice('--client-secret=file:'.length);secretSeen=fs.readFileSync(p,'utf8')==='synthetic-secret';secretMode=fs.statSync(p).mode&0o777;}
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args,secretSeen,secretMode})+'\\n');
console.log(JSON.stringify({BackendState:'Running',CurrentTailnet:{MagicDNSSuffix:'org.example.ts.net'},Self:{ID:'fixture',Online:true}}));
`);
  await chmod(cli, 0o700);
  let allow = true;
  const options = { dataRoot: path.join(root, "data"), codec, cliPath: cli,
    requireTeam: async (teamId, action) => { if (!allow || teamId !== "team-a") throw new Error("denied"); } };
  let service = createLocalTailnet(options);
  const disabled = await service.getTeamTailnet({ teamId: "team-a" });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.connected, false);
  await service.updateTeamTailnet({ teamId: "team-a", enabled: true, consent: true,
    magicDnsSuffix: "org.example.ts.net", tags: ["tag:fixture"] });
  await service.updateTeamTailnetCredential({ teamId: "team-a", clientId: "synthetic-client", clientSecret: "synthetic-secret" });
  service = createLocalTailnet(options);
  assert.equal((await service.getTeamTailnet({ teamId: "team-a" })).credentialConfigured, true);
  assert.equal((await service.connectTeamTailnet({ teamId: "team-a" })).connected, true);
  const lines = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  const connect = lines.find(x => x.args[0] === "up");
  assert.equal(connect.secretSeen, true);
  assert.equal(connect.secretMode, 0o600);
  assert.ok(connect.args.includes("--advertise-tags=tag:fixture"));
  assert.ok(!JSON.stringify(lines).includes("synthetic-secret"));
  for (const file of await readdir(path.join(root, "data/tailnet"))) {
    assert.ok(file.endsWith(".enc"));
    assert.ok(!(await readFile(path.join(root, "data/tailnet", file))).includes(Buffer.from("synthetic-secret")));
  }
  allow = false;
  await assert.rejects(service.connectTeamTailnet({ teamId: "team-a" }), /denied/);
  assert.equal((await readFile(log, "utf8")).trim().split("\n").length, lines.length);
});

test("Tailnet rejects missing consent, DNS mismatch and unavailable encryption", async () => {
  const cli = path.join(root, "tailscale-fixture");
  const base = { dataRoot: path.join(root, "other"), codec, cliPath: cli, requireTeam: async () => {} };
  const service = createLocalTailnet(base);
  await assert.rejects(service.updateTeamTailnet({ teamId: "team-b", enabled: true, consent: false }), /consent/);
  const state = await service.updateTeamTailnet({ teamId: "team-b", enabled: true, consent: true,
    magicDnsSuffix: "foreign.example.ts.net" });
  assert.equal(state.connected, false);
  assert.equal(state.rejection, "tailnet-mismatch");
  const locked = createLocalTailnet({ ...base, codec: { ...codec, isEncryptionAvailable: () => false } });
  await assert.rejects(locked.getTeamTailnet({ teamId: "team-b" }), /secure storage is unavailable/);
});

test.after(async () => { await rm(root, { recursive: true, force: true }); });
