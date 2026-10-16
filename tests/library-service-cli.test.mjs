import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(root, "tools", "library-service", "cli.mjs");
const work = mkdtempSync(path.join(root, "node_modules", ".cache", "cli-test-"));
test.after(() => rmSync(work, { recursive: true, force: true }));

const runCli = (args) =>
  new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root, timeout: 120000 }, (error, stdout, stderr) => {
      resolve({ exit: error?.code ?? 0, stdout, stderr });
    });
  });
const dataRoot = path.join(work, "data");
const origin = "https://127.0.0.1:18443";
const base = ["--data-root", dataRoot, "--origin", origin];

test("help works without data-root", async () => {
  const help = await runCli(["--help"]);
  assert.equal(help.exit, 0);
  assert.ok(help.stdout.includes("provision") && help.stdout.includes("serve"));
});

test("provision to an existing 0644 file enforces 0600 and keeps stdout secret-free", async () => {
  const out = path.join(work, "owner.json");
  writeFileSync(out, "{}", { mode: 0o644 });
  assert.equal(statSync(out).mode & 0o777, 0o644);
  const first = await runCli([...base, "provision", "--out", out]);
  assert.equal(first.exit, 0);
  assert.equal(statSync(out).mode & 0o777, 0o600);
  assert.ok(!first.stdout.includes("credential"));
  const record = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(typeof record.credential === "string" && record.credential.length > 0);
  assert.equal(statSync(out).mode & 0o777, 0o600);
});

test("provision without --out issues the credential on stdout", async () => {
  const result = await runCli([...base, "provision"]);
  assert.equal(result.exit, 0);
  const record = JSON.parse(result.stdout);
  assert.ok(typeof record.credential === "string" && record.credential.length > 0);
});

test("status reports the configured origin", async () => {
  const result = await runCli([...base, "status"]);
  assert.equal(result.exit, 0);
  assert.equal(JSON.parse(result.stdout).origin, origin);
  assert.ok(existsSync(dataRoot));
});
