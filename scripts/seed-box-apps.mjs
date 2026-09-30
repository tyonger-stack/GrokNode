#!/usr/bin/env node
/**
 * Seeds the box's app declarations.
 *
 * `scripts/box-apps.d/*.sh` is the source of truth for what the box should have
 * installed; the in-box host re-applies everything in `/workspace/box-apps.d`
 * on every boot (source/host/box/box-desktop-apps.ts), so a rebuilt container
 * restores the apps and their dock entries without a human in the loop.
 *
 * Seeding is idempotent and deliberately re-runs the declarations: the copy
 * bumps each script's mtime, which is half of the reconciler's stamp key, so a
 * seed is also "apply now".
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(repoRoot, "scripts", "box-apps.d");
const remoteDir = "/workspace/box-apps.d";
/** Mirrors the Grok Node / Grok Bot container names from the identity split. */
const CANDIDATE_CONTAINERS = ["grok-node-local-vm", "grok-bot-local-vm"];
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.sh$/;

function run(binary, args, { input } = {}) {
  return new Promise(resolve => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => resolve({ code: null, stdout, stderr: String(error) }));
    child.on("close", code => resolve({ code, stdout, stderr }));
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

function parseArgs(argv) {
  const args = { container: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--container" && argv[i + 1] != null) args.container = argv[i + 1];
  }
  return args;
}

async function resolveContainer(explicit) {
  if (explicit != null) return explicit;
  for (const candidate of CANDIDATE_CONTAINERS) {
    const result = await run("docker", ["inspect", "-f", "{{.State.Running}}", candidate]);
    if (result.code === 0 && result.stdout.trim() === "true") return candidate;
  }
  return undefined;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scripts = readdirSync(sourceDir)
    .filter(name => SAFE_NAME.test(name))
    .sort();
  if (scripts.length === 0) {
    console.error(`no *.sh declarations in ${sourceDir}`);
    process.exitCode = 1;
    return;
  }

  const container = await resolveContainer(args.container);
  if (container == null) {
    console.error(
      `no running local-docker box container found (looked at ${CANDIDATE_CONTAINERS.join(", ")}). ` +
      "Start Grok Node's computer first, or pass --container <name>."
    );
    process.exitCode = 1;
    return;
  }

  // Root-owned on purpose: the in-box host runs as uid 0 and refuses scripts it
  // does not own, so a `box`-writable copy of the directory is not an escalation
  // path. The guard is on each file, not the directory, because /workspace
  // itself is box-owned.
  const prepare = await run("docker", [
    "exec", container, "bash", "-c",
    `mkdir -p ${remoteDir} && chown 0:0 ${remoteDir} && chmod 0755 ${remoteDir}`
  ]);
  if (prepare.code !== 0) {
    console.error(`could not prepare ${remoteDir} in ${container}: ${prepare.stderr.trim()}`);
    process.exitCode = 1;
    return;
  }

  for (const name of scripts) {
    const contents = readFileSync(path.join(sourceDir, name));
    const result = await run(
      "docker",
      ["exec", "-i", container, "bash", "-c",
        `cat > ${remoteDir}/${name} && chown 0:0 ${remoteDir}/${name} && chmod 0755 ${remoteDir}/${name}`],
      { input: contents }
    );
    if (result.code !== 0) {
      console.error(`failed to seed ${name}: ${result.stderr.trim()}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`seeded ${remoteDir}/${name} (${contents.byteLength} bytes) in ${container}`);
  }
  console.log(
    "the in-box host applies these on its next boot; touch the file or re-run this command to force a re-apply"
  );
}

await main();
