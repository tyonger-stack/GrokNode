import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load(out, entry) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", out);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    packages: "external",
    banner: { js: "import { createRequire as __cr } from \"node:module\"; const require = __cr(import.meta.url);" },
    plugins: [{
      name: "js-to-ts",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
          const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
          if (!candidate.startsWith(repoRoot + "/source")) return null;
          return existsSync(candidate) ? { path: candidate } : null;
        });
      }
    }]
  });
  return import(pathToFileURL(outfile).href);
}

const module = await load("box-desktop-apps.mjs", "source/host/box/box-desktop-apps.ts");

const SCRIPTS_DIR = "/workspace/box-apps.d";
const STAMP_PATH = "/var/lib/sand/box-desktop-apps.stamp.json";

/** A reconciler wired to fakes, so every test states exactly what it controls. */
function harness(options = {}) {
  const runs = [];
  const stampWrites = [];
  const logs = [];
  let stamp;
  const reconciler = module.createBoxDesktopAppsReconciler({
    scriptsDir: SCRIPTS_DIR,
    stampPath: STAMP_PATH,
    getuid: () => 0,
    readScripts: async () =>
      options.listing ?? { present: true, files: [{ name: "10-wechat.sh", size: 10, mtimeMs: 1_000, uid: 0 }] },
    readStamp: async () => stamp,
    writeStamp: async (_path, contents) => {
      stampWrites.push(contents);
      stamp = contents;
    },
    runScript: async (scriptPath, timeoutMs) => {
      runs.push({ scriptPath, timeoutMs });
      return (options.run ?? (() => ({ code: 0, timedOut: false, output: "" })))(scriptPath);
    },
    log: message => logs.push(message)
  });
  return {
    runs,
    stampWrites,
    logs,
    stamp: () => stamp,
    reconcile: () => reconciler.reconcile()
  };
}

test("a missing box-apps.d costs nothing: no runs, no stamp write", async () => {
  const box = harness({ listing: { present: false, files: [] } });
  const result = await box.reconcile();

  assert.equal(result.status, "no-scripts-dir");
  assert.equal(box.runs.length, 0);
  assert.equal(box.stampWrites.length, 0);
});

test("an empty box-apps.d reports no-scripts without stamping", async () => {
  const box = harness({ listing: { present: true, files: [] } });
  const result = await box.reconcile();

  assert.equal(result.status, "no-scripts");
  assert.equal(box.runs.length, 0);
  assert.equal(box.stampWrites.length, 0);
});

test("the first boot runs the declaration and records its stamp", async () => {
  const box = harness();
  const result = await box.reconcile();

  assert.equal(result.status, "reconciled");
  assert.equal(result.applied, 1);
  assert.deepEqual(box.runs, [{ scriptPath: `${SCRIPTS_DIR}/10-wechat.sh`, timeoutMs: module.BOX_DESKTOP_APPS_SCRIPT_TIMEOUT_MS }]);
  const stamped = JSON.parse(box.stampWrites[0]);
  assert.equal(stamped.version, 1);
  // mtimeMs:size is the key, so re-seeding the same bytes (new mtime) re-applies.
  assert.equal(stamped.entries["10-wechat.sh"], "1000:10");
});

test("a second boot on the same rootfs skips the script instead of re-running it", async () => {
  const box = harness();
  await box.reconcile();
  const second = await box.reconcile();

  assert.equal(box.runs.length, 1, "the expensive install must not repeat on every boot");
  assert.equal(second.skipped, 1);
  assert.equal(second.applied, 0);
  assert.equal(second.outcomes[0].state, "skipped");
});

test("only scripts whose revision changed re-run; a new one is applied", async () => {
  const first = harness({
    listing: {
      present: true,
      files: [
        { name: "10-wechat.sh", size: 10, mtimeMs: 1_000, uid: 0 },
        { name: "20-other.sh", size: 4, mtimeMs: 2_000, uid: 0 }
      ]
    }
  });
  await first.reconcile();
  assert.deepEqual(first.runs.map(run => run.scriptPath), [
    `${SCRIPTS_DIR}/10-wechat.sh`,
    `${SCRIPTS_DIR}/20-other.sh`
  ]);

  const secondRuns = [];
  const secondStamp = first.stamp();
  const second = module.createBoxDesktopAppsReconciler({
    scriptsDir: SCRIPTS_DIR,
    stampPath: STAMP_PATH,
    getuid: () => 0,
    readScripts: async () => ({
      present: true,
      files: [
        { name: "10-wechat.sh", size: 10, mtimeMs: 9_999, uid: 0 }, // re-seeded: new mtime
        { name: "20-other.sh", size: 4, mtimeMs: 2_000, uid: 0 }, // untouched
        { name: "30-new.sh", size: 6, mtimeMs: 3_000, uid: 0 } // never applied
      ]
    }),
    readStamp: async () => secondStamp,
    writeStamp: async () => {},
    runScript: async scriptPath => {
      secondRuns.push(scriptPath);
      return { code: 0, timedOut: false, output: "" };
    }
  });

  const result = await second.reconcile();
  assert.deepEqual(secondRuns, [
    `${SCRIPTS_DIR}/10-wechat.sh`,
    `${SCRIPTS_DIR}/30-new.sh`
  ]);
  assert.equal(result.applied, 2);
  assert.equal(result.skipped, 1);
});

test("a failing script is reported, never stamped, and does not block its neighbours", async () => {
  const box = harness({
    listing: {
      present: true,
      files: [
        { name: "10-wechat.sh", size: 10, mtimeMs: 1_000, uid: 0 },
        { name: "20-broken.sh", size: 4, mtimeMs: 2_000, uid: 0 }
      ]
    },
    run: scriptPath =>
      scriptPath.endsWith("20-broken.sh")
        ? { code: 7, timedOut: false, output: "dpkg: error\nboom" }
        : { code: 0, timedOut: false, output: "" }
  });
  const result = await box.reconcile();

  assert.equal(result.applied, 1);
  assert.equal(result.failed, 1);
  const failed = result.outcomes.find(outcome => outcome.name === "20-broken.sh");
  assert.equal(failed.state, "failed");
  assert.equal(failed.exitCode, 7);
  assert.match(failed.detail, /boom/);
  const stamped = JSON.parse(box.stampWrites[0]);
  assert.equal(stamped.entries["20-broken.sh"], undefined, "a failure must retry next boot");
  assert.equal(stamped.entries["10-wechat.sh"], "1000:10");
});

test("a timeout is its own outcome and is not stamped", async () => {
  const box = harness({ run: () => ({ code: null, timedOut: true, output: "…" }) });
  const result = await box.reconcile();

  assert.equal(result.failed, 1);
  assert.equal(result.outcomes[0].state, "timed-out");
  assert.equal(JSON.parse(box.stampWrites[0]).entries["10-wechat.sh"], undefined);
});

test("on a uid-0 host a box-writable script is rejected without running", async () => {
  const box = harness({
    listing: { present: true, files: [{ name: "10-wechat.sh", size: 10, mtimeMs: 1_000, uid: 1000 }] }
  });
  const result = await box.reconcile();

  assert.equal(box.runs.length, 0, "executing a box-owned script as root is the escalation this blocks");
  assert.equal(result.rejected, 1);
  assert.equal(result.outcomes[0].state, "rejected");
  assert.match(result.outcomes[0].detail, /uid 1000/);
  assert.equal(JSON.parse(box.stampWrites[0]).entries["10-wechat.sh"], undefined);
});

test("a non-root host skips the ownership check and says so", async () => {
  const box = harness({
    listing: { present: true, files: [{ name: "10-wechat.sh", size: 10, mtimeMs: 1_000, uid: 1000 }] }
  });
  const result = await module.createBoxDesktopAppsReconciler({
    scriptsDir: SCRIPTS_DIR,
    stampPath: STAMP_PATH,
    getuid: () => 1000,
    readScripts: async () => ({
      present: true,
      files: [{ name: "10-wechat.sh", size: 10, mtimeMs: 1_000, uid: 1000 }]
    }),
    readStamp: async () => undefined,
    writeStamp: async () => {},
    runScript: async () => ({ code: 0, timedOut: false, output: "" }),
    log: message => box.logs.push(message)
  }).reconcile();

  assert.equal(result.applied, 1);
  assert.ok(box.logs.some(line => /not uid 0/.test(line)));
});

test("a corrupt stamp re-applies everything instead of trusting it", async () => {
  const stamp = module.parseBoxDesktopAppsStamp("{not json");
  assert.deepEqual(stamp, {});
  assert.deepEqual(module.parseBoxDesktopAppsStamp(undefined), {});
  assert.deepEqual(module.parseBoxDesktopAppsStamp(JSON.stringify({ entries: { "10-wechat.sh": "1000:10" } })), {
    "10-wechat.sh": "1000:10"
  });
  // A hostile name in the stamp must not become a run target.
  assert.deepEqual(
    module.parseBoxDesktopAppsStamp(JSON.stringify({ entries: { "../evil.sh": "1:1", "ok.sh": "1:1" } })),
    { "ok.sh": "1:1" }
  );
});

test("an unwritable stamp is reported, not thrown: the scripts already ran", async () => {
  const runs = [];
  const result = await module.createBoxDesktopAppsReconciler({
    scriptsDir: SCRIPTS_DIR,
    stampPath: STAMP_PATH,
    getuid: () => 0,
    readScripts: async () => ({
      present: true,
      files: [{ name: "10-wechat.sh", size: 10, mtimeMs: 1_000, uid: 0 }]
    }),
    readStamp: async () => undefined,
    writeStamp: async () => { throw new Error("EROFS: read-only file system"); },
    runScript: async scriptPath => {
      runs.push(scriptPath);
      return { code: 0, timedOut: false, output: "" };
    }
  }).reconcile();

  assert.equal(runs.length, 1);
  assert.equal(result.applied, 1);
  assert.match(result.stampError, /EROFS/);
});

test("script names are restricted to plain .sh files inside the directory", () => {
  assert.equal(module.isBoxDesktopAppScriptName("10-wechat.sh"), true);
  assert.equal(module.isBoxDesktopAppScriptName("a_b-c.1.sh"), true);
  assert.equal(module.isBoxDesktopAppScriptName("../escape.sh"), false);
  assert.equal(module.isBoxDesktopAppScriptName("nested/dir.sh"), false);
  assert.equal(module.isBoxDesktopAppScriptName(".hidden.sh"), false);
  assert.equal(module.isBoxDesktopAppScriptName("wechat.txt"), false);
  assert.equal(module.isBoxDesktopAppScriptName("10-wechat.sh; rm -rf /"), false);
});

test("the summary names the scripts that need attention", () => {
  const summary = module.summarizeBoxDesktopAppReconcile({
    status: "reconciled",
    applied: 1,
    skipped: 2,
    failed: 1,
    rejected: 0,
    outcomes: [
      { name: "10-wechat.sh", state: "applied", exitCode: 0 },
      { name: "20-broken.sh", state: "failed", exitCode: 7, detail: "dpkg: error" }
    ]
  });
  assert.match(summary, /applied 1, skipped 2, failed 1/);
  assert.match(summary, /20-broken\.sh: failed \(dpkg: error\)/);
  assert.equal(
    module.summarizeBoxDesktopAppReconcile({ status: "no-scripts-dir", applied: 0, skipped: 0, failed: 0, rejected: 0, outcomes: [] }),
    "no box-apps.d directory"
  );
});

test("the stamp must not live on a volume, or a rebuild would skip its own install", () => {
  // The stamp describes the box root filesystem. /home/box/sand-data and
  // /workspace both come back on named volumes after a container rebuild, so a
  // stamp there would suppress the reinstall that the rebuild just wiped.
  assert.ok(STAMP_PATH.startsWith("/var/lib/sand/"), `stamp moved to ${STAMP_PATH}`);
  assert.equal(module.BOX_DESKTOP_APPS_STAMP_PATH.includes("/workspace"), false);
  assert.equal(module.BOX_DESKTOP_APPS_STAMP_PATH.includes("sand-data"), false);
  // The intent, by contrast, must be on the persistent volume.
  assert.ok(module.BOX_DESKTOP_APPS_DIR.startsWith("/workspace/"));
});

test("the host only runs the reconciler in-box, next to the existing provisioner", () => {
  const extension = readFileSync(
    path.join(repoRoot, "source/host/extensions/forever-box/extension.ts"),
    "utf8"
  );
  const guard = 'if (process.env.SAND_HOST_IN_BOX === "1") void provisionBoxDesktopApps()';
  assert.ok(extension.includes(guard), "the reconciler must stay behind the in-box guard");
  // It must not be awaited on the boot path: a 770MB unpack cannot gate the gateway.
  assert.ok(!/await provisionBoxDesktopApps\(\)/.test(extension));
  assert.ok(extension.includes("box desktop apps were not provisioned"));
});

test("the WeChat declaration carries the launcher plank needs and stays re-runnable", () => {
  const declaration = readFileSync(
    path.join(repoRoot, "scripts/box-apps.d/10-wechat.sh"),
    "utf8"
  );
  // The vendor wechat.desktop has no StartupWMClass, which is why the dock slot
  // stayed empty; the launcher below is the actual fix.
  assert.match(declaration, /^StartupWMClass=wechat$/m);
  assert.match(declaration, /Exec=\/usr\/bin\/wechat %U/);
  assert.match(declaration, /Icon=\/usr\/share\/icons\/hicolor\/512x512\/apps\/wechat\.png/);
  // Idempotence: the install is guarded by the binary, and the launcher is
  // rewritten unconditionally so a deleted one heals.
  assert.match(declaration, /if \[ ! -x "\$\{BINARY\}" \]; then/);
  assert.ok(!/if \[ ! -f "\$\{LAUNCHER\}" \]/.test(declaration));
  // It must read the deb from the persistent volume, not from the rootfs.
  assert.match(declaration, /^DEB=\/workspace\/installers\/wechat\.deb$/m);
});
