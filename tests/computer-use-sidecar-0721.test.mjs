import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { signAppBundleAdHoc } from "../scripts/lib/codesign.mjs";
import { reconstructedBundleId } from "../scripts/lib/config.mjs";
import {
  COMPUTER_USE_SIDECAR_IDENTITY,
  describeComputerUseSidecarSignature,
  explicitComputerUseSidecarSource,
  packagedComputerUseSidecarPath,
  signAppBundlePreservingComputerUseSidecar,
  stageComputerUseSidecar0721,
} from "../scripts/lib/computer-use-sidecar-0721.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const officialHelper = "/Applications/Grok Bot.app/Contents/Helpers/Grok Bot Computer Use.app";
const darwin = process.platform === "darwin";

const codesign = (args) => spawnSync("/usr/bin/codesign", args, { encoding: "utf8" });

function plist({ bundleId, executable }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleExecutable</key><string>${executable}</string>
</dict></plist>`;
}

async function makeExecutableBundle(app, { bundleId, executable }) {
  const main = path.join(app, "Contents", "MacOS", executable);
  await mkdir(path.dirname(main), { recursive: true });
  await cp("/bin/echo", main);
  await writeFile(path.join(app, "Contents", "Info.plist"), plist({ bundleId, executable }));
  return main;
}

test("the sidecar source is only the explicit GROK_NODE_SIDECAR_APP value", () => {
  assert.equal(explicitComputerUseSidecarSource({}), "");
  assert.equal(explicitComputerUseSidecarSource({ GROK_NODE_SIDECAR_APP: "  " }), "");
  assert.equal(explicitComputerUseSidecarSource({ GROK_BOT_OFFICIAL_APP: "/Applications/Grok Bot.app" }), "");
  assert.equal(explicitComputerUseSidecarSource({ GROK_BOT_SIDECAR_APP: "/Applications/Grok Bot.app/Contents/Helpers/Grok Bot Computer Use.app" }), "");
  assert.equal(explicitComputerUseSidecarSource({ GROK_NODE_SIDECAR_APP: " /tmp/helper.app " }), "/tmp/helper.app");
  const source = readFileSync(path.join(repoRoot, "scripts/lib/computer-use-sidecar-0721.mjs"), "utf8");
  assert.doesNotMatch(source, /GROK_BOT_SIDECAR_APP/);
  assert.doesNotMatch(source, /GROK_BOT_OFFICIAL_APP/);
  assert.doesNotMatch(source, /\/Applications\/Grok Bot\.app/);
  assert.match(source, /GROK_NODE_SIDECAR_APP/);
  assert.match(source, /\/usr\/bin\/ditto/);
  const cleanBuild = readFileSync(path.join(repoRoot, "scripts/lib/clean-build.mjs"), "utf8");
  assert.match(cleanBuild, /stageComputerUseSidecar0721\(\{ outputRoot \}\)/);
});

test("staging fails closed when no explicit source is set", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "cua-missing-"));
  try {
    await assert.rejects(
      () => stageComputerUseSidecar0721({ outputRoot, env: {} }),
      /GROK_NODE_SIDECAR_APP/,
    );
    assert.equal(existsSync(path.join(outputRoot, "dist/deps/computer-use-sidecar")), false);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("staging rejects an ad-hoc bundle and leaves no packable copy", { skip: !darwin }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cua-adhoc-"));
  const outputRoot = path.join(root, "out");
  const fake = path.join(root, COMPUTER_USE_SIDECAR_IDENTITY.appName);
  await mkdir(outputRoot, { recursive: true });
  try {
    await makeExecutableBundle(fake, COMPUTER_USE_SIDECAR_IDENTITY);
    const signed = codesign([
      "--force",
      "--timestamp=none",
      "--sign",
      "-",
      "--requirements",
      `=designated => identifier "${COMPUTER_USE_SIDECAR_IDENTITY.bundleId}"`,
      fake,
    ]);
    assert.equal(signed.status, 0, signed.stderr);
    await assert.rejects(
      () => stageComputerUseSidecar0721({ outputRoot, helperSource: fake }),
      /Team ID is absent/,
    );
    assert.equal(existsSync(path.join(outputRoot, "dist/deps/computer-use-sidecar")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("staging ditto-copies an explicit verified helper without changing its signature", { skip: !darwin }, async (t) => {
  if (!existsSync(officialHelper)) return t.skip("official helper is not installed");
  const verified = codesign(["--verify", "--deep", "--strict", officialHelper]);
  if (verified.status !== 0) {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "cua-bad-official-"));
    try {
      await assert.rejects(
        () => stageComputerUseSidecar0721({ outputRoot, helperSource: officialHelper }),
        /codesign|Team ID|authority|spctl|designated/i,
      );
      assert.equal(existsSync(path.join(outputRoot, "dist/deps/computer-use-sidecar")), false);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), "cua-stage-"));
  const source = path.join(root, COMPUTER_USE_SIDECAR_IDENTITY.appName);
  const outputRoot = path.join(root, "out");
  try {
    const copied = spawnSync("/usr/bin/ditto", [officialHelper, source], { encoding: "utf8" });
    assert.equal(copied.status, 0, copied.stderr);
    const marked = spawnSync("/usr/bin/xattr", ["-w", "user.grok_cua_marker", "kept", source], { encoding: "utf8" });
    assert.equal(marked.status, 0, marked.stderr);
    const manifest = await stageComputerUseSidecar0721({ outputRoot, helperSource: source });
    const destination = path.join(outputRoot, "dist/deps/computer-use-sidecar", COMPUTER_USE_SIDECAR_IDENTITY.appName);
    const destinationSignature = await describeComputerUseSidecarSignature(destination);
    assert.equal(destinationSignature.cdhash, manifest.source.cdhash);
    assert.equal(destinationSignature.teamId, COMPUTER_USE_SIDECAR_IDENTITY.teamId);
    assert.equal(manifest.destination.cdhash, manifest.source.cdhash);
    const executable = path.join(destination, "Contents", "MacOS", COMPUTER_USE_SIDECAR_IDENTITY.executable);
    const executableSha = createHash("sha256").update(await readFile(executable)).digest("hex");
    assert.equal(manifest.inventory.executableSha256, executableSha);
    assert.equal(manifest.inventory.fileCount, manifest.inventory.files.length);
    assert.ok(manifest.inventory.fileCount > 0);
    const marker = spawnSync("/usr/bin/xattr", ["-p", "user.grok_cua_marker", destination], { encoding: "utf8" });
    assert.equal(marker.status, 0, marker.stderr);
    assert.equal(marker.stdout.trim(), "kept");
    const assessment = spawnSync("/usr/sbin/spctl", ["--assess", "--type", "execute", destination], { encoding: "utf8" });
    assert.equal(assessment.status, 0, assessment.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packaging holds the helper outside the app while the deep ad-hoc sign runs", { skip: !darwin }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cua-seal-"));
  const app = path.join(root, "Shell.app");
  try {
    await makeExecutableBundle(app, { bundleId: reconstructedBundleId, executable: "Grok Bot" });
    const framework = path.join(app, "Contents", "Frameworks", "Echo");
    await mkdir(path.dirname(framework), { recursive: true });
    await cp("/bin/echo", framework);
    const helper = packagedComputerUseSidecarPath(app);
    await makeExecutableBundle(helper, {
      bundleId: COMPUTER_USE_SIDECAR_IDENTITY.bundleId,
      executable: COMPUTER_USE_SIDECAR_IDENTITY.executable,
    });
    const signed = codesign([
      "--force",
      "--timestamp=none",
      "--sign",
      "-",
      "--requirements",
      `=designated => identifier "${COMPUTER_USE_SIDECAR_IDENTITY.bundleId}"`,
      helper,
    ]);
    assert.equal(signed.status, 0, signed.stderr);
    const before = await describeComputerUseSidecarSignature(helper);
    let heldDuringSign = false;
    await signAppBundlePreservingComputerUseSidecar(app, reconstructedBundleId, {
      sign: async (target, bundleId) => {
        assert.equal(existsSync(helper), false, "the deep sign must not be able to see the helper");
        heldDuringSign = existsSync(`${target}.computer-use-sidecar-held`);
        await signAppBundleAdHoc(target, bundleId);
      },
    });
    assert.equal(heldDuringSign, true, "the helper has to be held outside the bundle, not deleted");
    assert.equal(existsSync(`${app}.computer-use-sidecar-held`), false);
    const after = await describeComputerUseSidecarSignature(helper);
    assert.equal(after.cdhash, before.cdhash);
    assert.equal(after.teamId, before.teamId);
    assert.equal(after.designatedRequirement, before.designatedRequirement);
    assert.match(after.designatedRequirement, new RegExp(COMPUTER_USE_SIDECAR_IDENTITY.bundleId));
    const parent = codesign(["-d", "-r-", app]);
    assert.match(parent.stdout, new RegExp(`identifier "${reconstructedBundleId}"`));
    assert.doesNotMatch(after.designatedRequirement, new RegExp(reconstructedBundleId));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed deep sign restores the original helper", { skip: !darwin }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cua-restore-"));
  const app = path.join(root, "Shell.app");
  try {
    await makeExecutableBundle(app, { bundleId: reconstructedBundleId, executable: "Grok Bot" });
    const helper = packagedComputerUseSidecarPath(app);
    await makeExecutableBundle(helper, {
      bundleId: COMPUTER_USE_SIDECAR_IDENTITY.bundleId,
      executable: COMPUTER_USE_SIDECAR_IDENTITY.executable,
    });
    const signed = codesign(["--force", "--timestamp=none", "--sign", "-", helper]);
    assert.equal(signed.status, 0, signed.stderr);
    const before = await describeComputerUseSidecarSignature(helper);
    await assert.rejects(
      () => signAppBundlePreservingComputerUseSidecar(app, reconstructedBundleId, {
        sign: async () => {
          throw new Error("sign failed");
        },
      }),
      /sign failed/,
    );
    assert.equal(existsSync(helper), true);
    assert.equal(existsSync(`${app}.computer-use-sidecar-held`), false);
    const after = await describeComputerUseSidecarSignature(helper);
    assert.equal(after.cdhash, before.cdhash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deep ad-hoc signing rewrites a helper left in Contents/Helpers", { skip: !darwin }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cua-helpers-"));
  const app = path.join(root, "Shell.app");
  try {
    await makeExecutableBundle(app, { bundleId: reconstructedBundleId, executable: "Grok Bot" });
    const helper = path.join(app, "Contents", "Helpers", COMPUTER_USE_SIDECAR_IDENTITY.appName);
    await makeExecutableBundle(helper, {
      bundleId: COMPUTER_USE_SIDECAR_IDENTITY.bundleId,
      executable: COMPUTER_USE_SIDECAR_IDENTITY.executable,
    });
    const signed = codesign([
      "--force",
      "--timestamp=none",
      "--sign",
      "-",
      "--requirements",
      `=designated => identifier "${COMPUTER_USE_SIDECAR_IDENTITY.bundleId}"`,
      helper,
    ]);
    assert.equal(signed.status, 0, signed.stderr);
    const before = await describeComputerUseSidecarSignature(helper);
    await signAppBundleAdHoc(app, reconstructedBundleId);
    const after = await describeComputerUseSidecarSignature(helper);
    assert.notEqual(after.cdhash, before.cdhash, "Contents/Helpers is nested code and --deep re-signs it");
    assert.notEqual(after.designatedRequirement, before.designatedRequirement);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
