import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  adHocCodesignArguments,
  adHocDesignatedRequirement,
  adHocRequirementCodesignArguments,
  signAppBundleAdHoc,
} from "../scripts/lib/codesign.mjs";
import { reconstructedBundleId } from "../scripts/lib/config.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// `codesign -d` splits its display output across both streams: the `Executable=` header and the
// -vvv block go to STDERR, but the requirement printed by -r- goes to STDOUT. Reading the wrong one
// returns "" and assertions then pass vacuously.
const display = (args) => spawnSync("/usr/bin/codesign", ["-d", ...args], { encoding: "utf8" });
const requirementOf = (file) =>
  display(["-r-", file]).stdout?.split("\n").find((line) => line.includes("designated"))?.trim() ?? "";
const identifierOf = (file) =>
  display(["-vv", file]).stderr?.match(/^Identifier=(.*)$/m)?.[1]?.trim() ?? "";
const cdhashOf = (file) => display(["-vvv", file]).stderr?.match(/^CDHash=(\w+)/m)?.[1] ?? "";
// The command path is the first argument, exactly as `run` receives it. Hardcoding the path here
// instead would make codesign treat its own argv[0] as the thing to sign.
const codesign = (command, ...args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return { status: result.status, stderr: result.stderr ?? "" };
};

/** A bundle with a nested Mach-O in Frameworks, i.e. the layout that `--deep` walks. */
function makeBundle(dir, { bundleId = reconstructedBundleId, name = "Grok Node" } = {}) {
  // Each bundle needs its own path: signing one in place would overwrite the state another
  // assertion is about to read, and the comparison would silently compare a path with itself.
  const app = path.join(dir, `${name}.app`);
  const main = path.join(app, "Contents", "MacOS", "Grok Bot");
  const nested = path.join(app, "Contents", "Frameworks", "Echo Framework");
  mkdirSync(path.dirname(main), { recursive: true });
  mkdirSync(path.dirname(nested), { recursive: true });
  cpSync("/bin/echo", main);
  // A different filename gives this a different code identifier, so a requirement naming the app's
  // identifier can be detected on it.
  cpSync("/bin/echo", nested);
  writeFileSync(
    path.join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleExecutable</key><string>Grok Bot</string>
</dict></plist>`,
  );
  return { app, main, nested };
}

test("the designated requirement is a literal source, not a file path", () => {
  // `man codesign` (SPECIFYING REQUIREMENTS): a plain -r argument is read as a PATH; only one
  // beginning with `=` is compiled as literal requirement text. Without the `=`, codesign fails
  // with "No such file or directory" and it reads like a shell-quoting bug.
  const requirement = adHocDesignatedRequirement(reconstructedBundleId);
  assert.equal(requirement, '=designated => identifier "com.anysphere.sand.reconstructed"');
  assert.ok(requirement.startsWith("="), "a missing leading `=` turns the requirement into a filename");
});

test("the bundle is signed twice: deep without a requirement, then top level with one", () => {
  assert.deepEqual(adHocCodesignArguments("/Applications/Grok Node.app"), [
    "--force",
    "--deep",
    "--timestamp=none",
    "--sign",
    "-",
    "/Applications/Grok Node.app",
  ]);
  assert.deepEqual(adHocRequirementCodesignArguments("/Applications/Grok Node.app", reconstructedBundleId), [
    "--force",
    "--timestamp=none",
    "--sign",
    "-",
    "--requirements",
    '=designated => identifier "com.anysphere.sand.reconstructed"',
    "/Applications/Grok Node.app",
  ]);
  // The requirement has to be a distinct argv entry, not a substring of one.
  assert.equal(
    adHocRequirementCodesignArguments("/x", reconstructedBundleId).filter((a) => a.startsWith("=designated")).length,
    1,
  );
  // Regression guard for the bug that broke packaging: --deep on this pass stamps the app's
  // requirement onto nested code whose own identifier is different, and verification then fails.
  assert.ok(
    !adHocRequirementCodesignArguments("/x", reconstructedBundleId).includes("--deep"),
    "the requirement pass must not be --deep",
  );
});

test("a bundle identifier cannot escape the requirement literal", () => {
  // The identifier is interpolated into requirement source, so a quote, backslash or space in it
  // would close the literal and append arbitrary requirement text.
  for (const hostile of [
    'com.x" or (anchor "apple") and true or "',
    "com.x\\",
    "com.x or true",
    'com.x" ) and (identifier "com.evil',
    "",
    "com.x\n",
  ]) {
    assert.throws(
      () => adHocDesignatedRequirement(hostile),
      TypeError,
      `identifier ${JSON.stringify(hostile)} should have been rejected`,
    );
  }
  for (const ok of ["com.anysphere.sand.reconstructed", "a", "com.x.fidelity.build.abc123", "a-b_c.d"]) {
    assert.equal(adHocDesignatedRequirement(ok), `=designated => identifier "${ok}"`);
  }
});

test("both passes together leave the bundle verifiable, stable at the top, untouched inside", async () => {
  if (process.platform !== "darwin") return;
  const dir = mkdtempSync(path.join(tmpdir(), "grok-dr-bundle-"));
  const { app, main, nested } = makeBundle(dir);

  const calls = [];
  await signAppBundleAdHoc(app, reconstructedBundleId, async (command, args) => {
    calls.push(args);
    const result = codesign(command, ...args);
    if (result.status !== 0) throw new Error(`codesign ${args.join(" ")}: ${result.stderr}`);
  });
  assert.equal(calls.length, 2, "the first attempt at this only made one call and failed verification");

  const verify = codesign("/usr/bin/codesign", "--verify", "--deep", "--strict", app);
  assert.equal(verify.status, 0, `bundle must verify: ${verify.stderr}`);

  // The top level and the main executable are what the keychain ACL records, and they share the
  // bundle identifier, so both must carry the content-independent requirement.
  assert.equal(requirementOf(app), 'designated => identifier "com.anysphere.sand.reconstructed"');
  assert.equal(requirementOf(main), 'designated => identifier "com.anysphere.sand.reconstructed"');
  // Nested code legitimately has its own identifier, so it must keep the default requirement.
  // If the requirement pass were --deep, this would read the app's identifier instead and
  // verification above would fail.
  assert.notEqual(identifierOf(nested), reconstructedBundleId);
  assert.match(requirementOf(nested), /cdhash H"/);

  // The property the change exists for: a repackage that changes every byte must not change the
  // requirement the keychain compares against.
  const before = { requirement: requirementOf(app), cdhash: cdhashOf(app) };
  const rebuilt = makeBundle(dir, { name: "Grok Node Rebuilt" });
  // Change the bytes so the rebuild is a genuinely different build, not a re-read of the same one.
  writeFileSync(rebuilt.main, `${readFileSync(rebuilt.main, "utf8")}\n`);
  await signAppBundleAdHoc(rebuilt.app, reconstructedBundleId, async (command, args) => {
    const result = codesign(command, ...args);
    if (result.status !== 0) throw new Error(`codesign ${args.join(" ")}: ${result.stderr}`);
  });
  assert.notEqual(cdhashOf(rebuilt.app), before.cdhash, "the two bundles should differ, else this proves nothing");
  assert.equal(requirementOf(rebuilt.app), before.requirement, "the requirement must survive a rebuild");

  // And the failure mode it replaces, stated rather than assumed.
  const bare = makeBundle(dir, { name: "Grok Node Bare" });
  codesign("/usr/bin/codesign", ...adHocCodesignArguments(bare.app));
  assert.match(requirementOf(bare.app), /cdhash H"/);
  assert.notEqual(requirementOf(bare.app), requirementOf(rebuilt.app));
});

test("both packaging entry points sign with the identifier they actually install", () => {
  // The fidelity diagnostic build rewrites CFBundleIdentifier to a per-archive value. A
  // designated requirement naming the wrong identifier would never match its own bundle.
  const main = readFileSync(path.join(repoRoot, "scripts", "package-macos.mjs"), "utf8");
  assert.match(main, /signAppBundleAdHoc\(outputApp, reconstructedBundleId\)/);
  assert.doesNotMatch(main, /signAppBundleAdHoc\(outputApp\)/, "the bundle id must be passed, not defaulted");

  const diagnostic = readFileSync(path.join(repoRoot, "scripts", "package-fidelity-diagnostic.mjs"), "utf8");
  assert.match(diagnostic, /signAppBundleAdHoc\(stagedApp, diagnosticBundleId\)/);
  // The same value has to reach both the plist and the signature.
  assert.match(
    diagnostic,
    /const diagnosticBundleId = `com\.anysphere\.sand\.reconstructed\.fidelity\.diagnostic\.build\$\{shortHash\}`;/,
  );
  assert.match(diagnostic, /"-replace", "CFBundleIdentifier", "-string", diagnosticBundleId/);
});
