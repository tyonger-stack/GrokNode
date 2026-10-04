import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { adHocCodesignArguments, adHocDesignatedRequirement } from "../scripts/lib/codesign.mjs";
import { reconstructedBundleId } from "../scripts/lib/config.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the designated requirement is a literal source, not a file path", () => {
  // `man codesign` (SPECIFYING REQUIREMENTS): a plain -r argument is read as a PATH; only one
  // beginning with `=` is compiled as literal requirement text. Without the `=`, codesign fails
  // with "No such file or directory" and it reads like a shell-quoting bug.
  const requirement = adHocDesignatedRequirement(reconstructedBundleId);
  assert.equal(requirement, '=designated => identifier "com.anysphere.sand.reconstructed"');
  assert.ok(requirement.startsWith("="), "a missing leading `=` turns the requirement into a filename");
});

test("the codesign argument list carries the requirement", () => {
  const args = adHocCodesignArguments("/Applications/Grok Node.app", reconstructedBundleId);
  assert.deepEqual(args, [
    "--force",
    "--deep",
    "--timestamp=none",
    "--sign",
    "-",
    "--requirements",
    '=designated => identifier "com.anysphere.sand.reconstructed"',
    "/Applications/Grok Node.app",
  ]);
  // The requirement has to be a distinct argv entry, not a substring of one.
  assert.equal(args.filter((a) => a.startsWith("=designated")).length, 1);
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
  // And the ordinary shapes still work.
  for (const ok of ["com.anysphere.sand.reconstructed", "a", "com.x.fidelity.build.abc123", "a-b_c.d"]) {
    assert.equal(adHocDesignatedRequirement(ok), `=designated => identifier "${ok}"`);
  }
});

test("the requirement is content-independent, unlike a bare ad-hoc signature", () => {
  // This is the whole point of the change, so assert it against codesign itself rather than
  // against our own construction of the argument string.
  if (process.platform !== "darwin") return;
  const requirement = adHocDesignatedRequirement(reconstructedBundleId);
  const dir = mkdtempSync(path.join(tmpdir(), "grok-dr-"));
  // codesign -d splits its display output across both streams: the `Executable=` header and the
  // -vvv block go to STDERR, but the requirement printed by -r- goes to STDOUT. Reading the wrong one
  // returns "" and the equality check below then passes vacuously.
  // `-r-` and `-vvv` must also be separate calls: combining them makes -vvv suppress the requirement
  // block entirely.
  const display = (args) => spawnSync("/usr/bin/codesign", ["-d", ...args], { encoding: "utf8" });
  const read = (file) =>
    display(["-r-", file]).stdout?.split("\n").find((line) => line.includes("designated"))?.trim() ?? "";
  const cdhash = (file) => display(["-vvv", file]).stderr?.match(/^CDHash=(\w+)/m)?.[1] ?? "";
  const sign = (src, dest, withRequirement) => {
    cpSync(src, dest);
    const args = ["--force", "--timestamp=none", "--sign", "-"];
    if (withRequirement) args.push("--requirements", requirement);
    const result = spawnSync("/usr/bin/codesign", [...args, dest], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`codesign failed for ${dest}: ${result.stderr}`);
  };

  const a = path.join(dir, "a");
  const b = path.join(dir, "b");
  sign("/bin/echo", a, true);
  sign("/bin/cat", b, true);

  assert.notEqual(cdhash(a), cdhash(b), "the two binaries should differ, otherwise this proves nothing");
  assert.equal(read(a), read(b), "different bytes must still produce the same designated requirement");
  assert.equal(read(a), 'designated => identifier "com.anysphere.sand.reconstructed"');

  // The behaviour this replaces: without -r, each binary gets a cdhash-keyed requirement, so a
  // keychain ACL recorded from one can never be satisfied by the other.
  const bareA = path.join(dir, "bare-a");
  const bareB = path.join(dir, "bare-b");
  sign("/bin/echo", bareA, false);
  sign("/bin/cat", bareB, false);
  assert.match(read(bareA), /cdhash H"/, "a bare ad-hoc signature should key its requirement to the cdhash");
  assert.notEqual(read(bareA), read(bareB));
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
