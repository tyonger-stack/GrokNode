import { run } from "./process.mjs";

export const AD_HOC_CODESIGN_IDENTITY = "-";
export const NONINTERACTIVE_CODESIGN_STDIO = Object.freeze([
  "ignore",
  "inherit",
  "inherit",
]);

/**
 * A designated requirement that is stable across re-signs.
 *
 * A bare ad-hoc signature (`--sign -`) gets the default requirement
 * `cdhash H"<cdhash>"`, which is a function of the bundle's bytes. Repackaging changes the bytes,
 * so the cdhash changes, so a keychain ACL recorded from an earlier run records a requirement the
 * current build can never satisfy. Observed on this machine: the keychain item
 * "Grok Node Safe Storage" had the same path `/Applications/Grok Node.app` stacked dozens of times
 * in its decrypt ACL — Electron appended one on every launch, none of them ever matched.
 *
 * Keying the requirement to the bundle identifier makes it content-independent. Verified directly:
 * three different Mach-O binaries signed with this requirement all report an identical designated
 * requirement while their CDHashes differ, whereas the bare form reports a different one per binary.
 *
 * The leading `=` is load-bearing. Per `man codesign` (SPECIFYING REQUIREMENTS), a plain argument is
 * read as a PATH to a requirements file; only an argument beginning with `=` is compiled as literal
 * requirement source. Omitting it yields "No such file or directory" and looks like a quoting bug.
 */
export function adHocDesignatedRequirement(bundleId) {
  if (typeof bundleId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bundleId)) {
    // The identifier is interpolated into a requirement source, so it must not be able to carry a
    // quote, a backslash or whitespace out of the literal.
    throw new TypeError(`A plain bundle identifier is required for the designated requirement, got ${JSON.stringify(bundleId)}`);
  }
  return `=designated => identifier "${bundleId}"`;
}

export function adHocCodesignArguments(target, bundleId) {
  if (typeof target !== "string" || target.length === 0) {
    throw new TypeError("An explicit application bundle path is required for ad-hoc signing.");
  }
  return [
    "--force",
    "--deep",
    "--timestamp=none",
    "--sign",
    AD_HOC_CODESIGN_IDENTITY,
    "--requirements",
    adHocDesignatedRequirement(bundleId),
    target,
  ];
}

export async function signAppBundleAdHoc(target, bundleId, runCommand = run) {
  await runCommand("/usr/bin/codesign", adHocCodesignArguments(target, bundleId), {
    stdio: NONINTERACTIVE_CODESIGN_STDIO,
  });
}
