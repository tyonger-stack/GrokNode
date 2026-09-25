import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function bundle(entry, prefix) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), prefix));
  const output = path.join(temporary, "module.mjs");
  await build({ entryPoints: [path.join(repoRoot, entry)], outfile: output, bundle: true, format: "esm", platform: "node", target: "node22" });
  const module = await import(pathToFileURL(output).href + "?" + Date.now());
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("Grok Node identity only opts in for the packaged Grok Node.app bundle", async () => {
  const loaded = await bundle("source/shared/node/grok-node-identity.ts", "grok-node-identity-");
  try {
    const identity = loaded.module;
    assert.equal(identity.isGrokNodePackagedApp("/Applications/Grok Node.app/Contents/MacOS/Grok Bot"), true);
    assert.equal(identity.isGrokNodePackagedApp("/Applications/Grok Bot.app/Contents/MacOS/Grok Bot"), false);
    assert.equal(identity.isGrokNodePackagedApp("/Users/Apple/Documents/grokbot/.tools/node-26/bin/node"), false);
    assert.equal(identity.isGrokNodePackagedApp(), false);
    assert.equal(identity.getGrokNodeProductionRootDir("/Users/Apple"), "/Users/Apple/.groknode");
    assert.equal(
      identity.getGrokNodeUserDataDir("/Users/Apple/Library/Application Support"),
      "/Users/Apple/Library/Application Support/Grok Node"
    );
    assert.equal(identity.GROK_NODE_DOCKER_CONTAINER, "grok-node-local-vm");
  } finally {
    await loaded.dispose();
  }
});

test("packaged Grok Node preserves an explicit data-root override", async () => {
  const loaded = await bundle("source/electron-main/startup/desktop-user-data-bootstrap.ts", "grok-node-bootstrap-");
  const originalExecPath = process.execPath;
  const paths = new Map();
  const env = { SAND_DATA_ROOT: "/tmp/grok-node-custom-root" };
  const app = {
    isPackaged: true,
    getPath: (name) => name === "appData" ? "/tmp/Application Support" : paths.get(name),
    setPath: (name, value) => paths.set(name, value),
  };
  try {
    process.execPath = "/Applications/Grok Node.app/Contents/MacOS/Grok Bot";
    loaded.module.bootstrapDesktopUserData({ app, isLabBuild: false, argv: [], env });
    assert.equal(env.SAND_DATA_ROOT, "/tmp/grok-node-custom-root");
    assert.equal(paths.get("userData"), "/tmp/Application Support/Grok Node");
  } finally {
    process.execPath = originalExecPath;
    await loaded.dispose();
  }
});

test("packaged Grok Node uses separate defaults without overrides", async () => {
  const loaded = await bundle("source/electron-main/startup/desktop-user-data-bootstrap.ts", "grok-node-defaults-");
  const originalExecPath = process.execPath;
  const paths = new Map();
  const env = {};
  const app = {
    isPackaged: true,
    getPath: (name) => name === "appData" ? "/tmp/Application Support" : paths.get(name),
    setPath: (name, value) => paths.set(name, value),
  };
  try {
    process.execPath = "/Applications/Grok Node.app/Contents/MacOS/Grok Bot";
    loaded.module.bootstrapDesktopUserData({ app, isLabBuild: false, argv: [], env });
    assert.equal(env.SAND_DATA_ROOT, path.join(os.homedir(), ".groknode"));
    assert.equal(paths.get("userData"), "/tmp/Application Support/Grok Node");
    assert.equal(paths.get("sessionData"), "/tmp/Application Support/Grok Node");
  } finally {
    process.execPath = originalExecPath;
    await loaded.dispose();
  }
});

test("startup, data-root and local-docker wiring reference the Grok Node identity", async () => {
  const bootstrap = await readFile(path.join(repoRoot, "source/electron-main/startup/desktop-user-data-bootstrap.ts"), "utf8");
  const hostPaths = await readFile(path.join(repoRoot, "source/host/host-paths.ts"), "utf8");
  const connector = await readFile(path.join(repoRoot, "source/electron-main/box/local-docker-host-connector.ts"), "utf8");
  assert.match(bootstrap, /isGrokNodePackagedApp/);
  assert.match(bootstrap, /SAND_DATA_ROOT_ENV/);
  assert.match(hostPaths, /isGrokNodePackagedApp/);
  assert.match(hostPaths, /getGrokNodeProductionRootDir/);
  assert.match(connector, /GROK_NODE_DOCKER_CONTAINER/);
  assert.match(connector, /LOCAL_DOCKER_WORKSPACE_VOLUME/);
  assert.match(connector, /LOCAL_DOCKER_DATA_VOLUME/);
  assert.doesNotMatch(connector, /grok-bot-local-vm-workspace/);
});
