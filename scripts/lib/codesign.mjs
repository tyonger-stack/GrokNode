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

/** First pass: sign everything, nested code included, with the default requirements. */
export function adHocCodesignArguments(target) {
  if (typeof target !== "string" || target.length === 0) {
    throw new TypeError("An explicit application bundle path is required for ad-hoc signing.");
  }
  return [
    "--force",
    "--deep",
    "--timestamp=none",
    "--sign",
    AD_HOC_CODESIGN_IDENTITY,
    target,
  ];
}

/**
 * Second pass: give the top-level bundle a content-independent designated requirement.
 *
 * This pass must NOT be `--deep`. `--deep` applies the same arguments to every nested framework and
 * helper, so it would stamp `identifier "com.anysphere.sand.reconstructed"` onto
 * `Electron Framework.framework`, whose own identifier is `com.github.Electron.framework`. A
 * requirement that names a different identifier than the code it is attached to does not describe
 * that code, and `codesign --verify --deep --strict` then fails with
 * "nested code is modified or invalid" — which is exactly how the first attempt at this broke
 * packaging.
 *
 * ⚠️ 2026-10-05 实测**推翻**了这段推理的前提。
 * 原文断言「只签顶层就够，要紧的 ACL 是主可执行文件那条，嵌套代码保持 cdhash 默认、那是正确的」。
 * 当时能拿到的直接证据是：主可执行文件的 DR **确实**已经是稳定的
 * `identifier "com.anysphere.sand.reconstructed"`（`codesign -d -r-` 实读），而钥匙串弹窗
 * **照旧每次启动都出现、点「始终允许」也存不下来**。既然主可执行文件这一环已经修好而现象不变，
 * 「要紧的 ACL 是主可执行文件那条」就不成立。
 *
 * 现在已定位到的那条不稳定 requirement 在哪：同一时刻 `Electron Framework.framework` 的 DR 仍是
 *   `cdhash H"d84843427fa9ef8bf4ceb62748dcbdeff4deabcd"`
 * 即 **cdhash 型、每次重打包就变**；而 `safeStorage` 的实现就在这个 dylib 里（框架二进制带
 * 11 处 `safeStorage` / 11 处 `OSCrypt` 字符串，主程序经 `@rpath` 动态链接它）。
 * 本机读不到钥匙串条目 ACL 记录的 requirement 原文（三条路都试过），所以
 * 「ACL 里记的就是框架那条 cdhash」**仍是假设、未闭环**；但「主可执行文件那条不是问题所在」
 * 已由上面的实测排除。
 *
 * 因此这里**只**改注释、不改签名方案：给框架签**它自己的** identifier DR
 * （`com.github.Electron.framework`）在原理上是准确的、且跨重打包稳定，但那是改动构建产物的
 * 方案，得先闭环假设、并与重新打包的窗口一起安排，不在本次范围内顺手做。
 * 注意它与上面「`-r` 绝不能带 `--deep`」不矛盾：那次的错是把**顶层 app 的** identifier 贴到
 * 框架上（指向别的 identifier 的 requirement 根本不描述那段代码，`--verify --deep --strict`
 * 报 `nested code is modified or invalid`）；框架用自己的 identifier 是另一回事。
 */
export function adHocRequirementCodesignArguments(target, bundleId) {
  return [
    "--force",
    "--timestamp=none",
    "--sign",
    AD_HOC_CODESIGN_IDENTITY,
    "--requirements",
    adHocDesignatedRequirement(bundleId),
    target,
  ];
}

export async function signAppBundleAdHoc(target, bundleId, runCommand = run) {
  await runCommand("/usr/bin/codesign", adHocCodesignArguments(target), {
    stdio: NONINTERACTIVE_CODESIGN_STDIO,
  });
  await runCommand("/usr/bin/codesign", adHocRequirementCodesignArguments(target, bundleId), {
    stdio: NONINTERACTIVE_CODESIGN_STDIO,
  });
}
