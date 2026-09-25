import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  outputApp,
  outputDir,
  reconstructedBundleId,
  reconstructedName
} from "./lib/config.mjs";
import { buildFidelityReconstructedAsar } from "./clean-build.mjs";
import { signAppBundleAdHoc } from "./lib/codesign.mjs";
import { officialGrokBotAppInstalled, resolveGrokbotClaimMode, verifyOfficialMacReference, verifyReconstructedMacPackage } from "./lib/macos-package-verification.mjs";
import { run } from "./lib/process.mjs";
import { SYSTEM_TOOLS } from "./lib/system-tools.mjs";

if (process.platform !== "darwin") {
  throw new Error("The reconstructed macOS application can only be packaged on macOS.");
}

// Keep the checksum-pinned shipped renderer as the polished UI authority. Small
// reconstructed UI extensions are installed by the clean preload, leaving the
// original renderer chunks byte-for-byte intact.
const { builtAsar, builtAsarUnpacked, runtimeApp } = await buildFidelityReconstructedAsar();
// Keep the signed release audit separate from the reconstructed package audit:
// the official app is reference-only and is never used as the runtime payload.
await verifyOfficialMacReference({ runtimeApp });
await mkdir(outputDir, { recursive: true });
await rm(outputApp, { recursive: true, force: true });
await run(SYSTEM_TOOLS.ditto, [runtimeApp, outputApp]);
// The source DMG's quarantine/provenance applies to Anysphere's signed artifact,
// not to this differently identified local reconstruction. Leaving it attached
// makes Gatekeeper reject the otherwise valid ad-hoc signature before launch.
await run(SYSTEM_TOOLS.xattr, ["-cr", outputApp]);

const resources = path.join(outputApp, "Contents", "Resources");
const packagedAsar = path.join(resources, "app.asar");
const packagedUnpacked = `${packagedAsar}.unpacked`;
await rm(packagedAsar, { force: true });
await rm(packagedUnpacked, { recursive: true, force: true });
await cp(builtAsar, packagedAsar);
await cp(builtAsarUnpacked, packagedUnpacked, {
  recursive: true,
  dereference: false,
  preserveTimestamps: true
});

const infoPlist = path.join(outputApp, "Contents", "Info.plist");
await run(SYSTEM_TOOLS.plutil, ["-remove", "ElectronAsarIntegrity", infoPlist]);
await run(SYSTEM_TOOLS.plutil, ["-replace", "CFBundleIdentifier", "-string", reconstructedBundleId, infoPlist]);
await run(SYSTEM_TOOLS.plutil, ["-replace", "CFBundleDisplayName", "-string", reconstructedName, infoPlist]);
// The official Grok Bot bundle owns the `sand` and `grokbot` URL schemes. When
// it is installed, Grok Node registers only its own `groknode` scheme so
// LaunchServices keeps routing sand:// and grokbot:// links to the official
// app; when it is absent, Grok Node additionally claims `grokbot` so x.ai
// share buttons keep working on machines without the official app. The claim
// is a package-time snapshot of this machine; GROK_NODE_CLAIM_GROKBOT=
// auto|always|never pins it for packages distributed to other machines. The
// runtime parser accepts both protocols either way.
const claimMode = resolveGrokbotClaimMode(process.env.GROK_NODE_CLAIM_GROKBOT);
const officialInstalled = await officialGrokBotAppInstalled();
const claimsGrokbot = claimMode === "always" || (claimMode === "auto" && !officialInstalled);
if (claimsGrokbot && officialInstalled) {
  console.warn("GROK_NODE_CLAIM_GROKBOT: this package claims grokbot while the official Grok Bot is installed on this machine; deploy it only on machines without the official app.");
}
const urlSchemes = ["groknode", ...(claimsGrokbot ? ["grokbot"] : [])];
const urlSchemesXml = urlSchemes.map((scheme) => `<string>${scheme}</string>`).join("");
await run(SYSTEM_TOOLS.plutil, ["-remove", "CFBundleURLTypes", infoPlist]);
await run(SYSTEM_TOOLS.plutil, ["-insert", "CFBundleURLTypes", "-xml", `<array><dict><key>CFBundleTypeRole</key><string>Viewer</string><key>CFBundleURLName</key><string>Grok Node links</string><key>CFBundleURLSchemes</key><array>${urlSchemesXml}</array></dict></array>`, infoPlist]);
console.log(`Registered URL schemes: ${urlSchemes.join(", ")} (claim mode: ${claimMode}, official Grok Bot ${officialInstalled ? "installed" : "not installed"})`);
// Keep CFBundleName/CFBundleExecutable as "Grok Bot": Electron derives the
// expected nested helper names from it, and this build intentionally reuses the
// exact ABI-matched 0.18 runtime. CFBundleDisplayName provides the fork's name.

await rm(path.join(outputApp, "Contents", "_CodeSignature"), { recursive: true, force: true });
try {
  await signAppBundleAdHoc(outputApp);
} catch (error) {
  // macOS can transiently deny replacement of a nested framework signature
  // immediately after the copied runtime was in use. A second idempotent pass
  // succeeds once the kernel releases that code object.
  console.warn(`Initial ad-hoc signing pass failed; retrying once: ${String(error)}`);
  await signAppBundleAdHoc(outputApp);
}
await run(SYSTEM_TOOLS.codesign, ["--verify", "--deep", "--strict", outputApp]);
const verification = await verifyReconstructedMacPackage({
  officialApp: runtimeApp,
  reconstructedApp: outputApp,
  sourceUnpackedRoot: builtAsarUnpacked,
  packagedUnpackedRoot: packagedUnpacked,
  urlSchemeOptions: { allowGrokbotClaim: claimMode === "always" },
});

console.log(`Packaged application: ${outputApp} (${verification.runtime.nodeFileCount} native manifest entries, ${verification.runtime.runtimeFileCount} unpacked runtime files)`);
