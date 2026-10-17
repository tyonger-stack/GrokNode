import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const cacheDir = path.join(root, "node_modules", ".cache");
await mkdir(cacheDir, { recursive: true });
const jsToTs = { name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null; }); } };

async function load(entry, name) {
  const outfile = path.join(cacheDir, `${name}.cjs`);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error", plugins: [jsToTs], external: ["electron"] });
  return createRequire(import.meta.url)(outfile);
}

const service = await load("source/host/extensions/box-timezone/box-timezone-service.ts", "box-timezone-service");
const registry = await load("source/host/extensions/registry.ts", "box-timezone-registry");

function fakeSettings(initial) {
  let zone = initial;
  const listeners = new Set();
  return {
    getUserTimeZone: () => zone,
    subscribeToUserTimeZone: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    set(next) { zone = next; for (const listener of listeners) listener(next); },
    listeners,
  };
}

test("the applier is disabled when the box has no sand-box-timezone command", () => {
  assert.equal(service.SAND_BOX_TIMEZONE_COMMAND, "/usr/local/bin/sand-box-timezone");
  assert.equal(service.createBoxTimezoneApplier({ log() {}, commandPath: path.join(os.tmpdir(), "missing-sand-box-timezone") }), undefined);
});

test("the applier runs `<command> apply <zone>` and logs its output", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "box-tz-"));
  const command = path.join(dir, "sand-box-timezone");
  const argsFile = path.join(dir, "args");
  writeFileSync(command, `#!/bin/sh\necho "$@" > "${argsFile}"\necho "timezone set to $2"\n`);
  chmodSync(command, 0o755);
  const logs = [];
  const apply = service.createBoxTimezoneApplier({ log: (line) => logs.push(line), commandPath: command });
  await apply("Asia/Shanghai");
  assert.equal(readFileSync(argsFile, "utf8").trim(), "apply Asia/Shanghai");
  assert.deepEqual(logs, ["box-timezone: timezone set to Asia/Shanghai"]);
});

test("the service applies the current zone on start and each later change once", async () => {
  const settings = fakeSettings("Asia/Shanghai");
  const applied = [];
  const svc = service.createBoxTimezoneService({ ...settings, applyZone: async (zone) => { applied.push(zone); }, log() {} });
  svc.start();
  await svc.settled();
  settings.set("Asia/Shanghai");
  await svc.settled();
  settings.set("Europe/Paris");
  await svc.settled();
  settings.set(undefined);
  await svc.settled();
  assert.deepEqual(applied, ["Asia/Shanghai", "Europe/Paris"]);
  svc.dispose();
  assert.equal(settings.listeners.size, 0);
});

test("a failed apply is logged and does not block a later zone", async () => {
  const settings = fakeSettings("Bad/Zone");
  const logs = [];
  const applied = [];
  const svc = service.createBoxTimezoneService({ ...settings, applyZone: async (zone) => { if (zone === "Bad/Zone") throw new Error("boom"); applied.push(zone); }, log: (line) => logs.push(line) });
  svc.start();
  await svc.settled();
  assert.match(logs[0], /^box-timezone: could not set the box clock to Bad\/Zone/);
  settings.set("UTC");
  await svc.settled();
  assert.deepEqual(applied, ["UTC"]);
});

test("box-timezone runs after settings in the host extension order", () => {
  const order = registry.HOST_EXTENSION_ORDER;
  assert.ok(order.includes("box-timezone"));
  assert.ok(order.indexOf("box-timezone") > order.indexOf("settings"));
});
