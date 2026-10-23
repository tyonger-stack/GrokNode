import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { adHocRequirementCodesignArguments, signAppBundleAdHoc } from "./codesign.mjs";

const exec = promisify(execFile);

export const COMPUTER_USE_SIDECAR_IDENTITY = Object.freeze({
  appName: "Grok Bot Computer Use.app",
  bundleId: "co.anysphere.grok-bot-computer-use",
  executable: "CUGrokBotService",
  teamId: "DCNK4UB866",
});

// The packaged helper lives in the unpacked runtime, not Contents/Helpers.
// codesign --deep rewrites bundles under Contents/Helpers (measured: Team ID
// DCNK4UB866 became an ad-hoc cdhash). It does not currently walk
// Resources/app.asar.unpacked, but that is an observation, not a contract.
export const COMPUTER_USE_SIDECAR_UNPACKED_RELATIVE = path.join(
  "Contents",
  "Resources",
  "app.asar.unpacked",
  "dist",
  "deps",
  "computer-use-sidecar",
  COMPUTER_USE_SIDECAR_IDENTITY.appName,
);

export const GROK_NODE_SIDECAR_APP = "GROK_NODE_SIDECAR_APP";

export function explicitComputerUseSidecarSource(env = process.env) {
  const raw = env?.[GROK_NODE_SIDECAR_APP];
  return typeof raw === "string" ? raw.trim() : "";
}

export function packagedComputerUseSidecarPath(appPath) {
  return path.join(appPath, COMPUTER_USE_SIDECAR_UNPACKED_RELATIVE);
}

async function command(file, args) {
  try {
    const { stdout, stderr } = await exec(file, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    return { stdout, stderr };
  } catch (error) {
    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
    const stdout = typeof error.stdout === "string" ? error.stdout.trim() : "";
    throw new Error(`${file} ${args.join(" ")} failed: ${stderr || stdout || error.message}`);
  }
}

function field(text, name) {
  const value = text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim() ?? "";
  return value === "not set" ? "" : value;
}

export async function describeComputerUseSidecarSignature(target) {
  const displayed = await command("/usr/bin/codesign", ["-d", "-vvv", target]);
  const requirement = await command("/usr/bin/codesign", ["-d", "-r-", target]);
  const text = `${displayed.stdout}\n${displayed.stderr}`;
  const designatedRequirement = `${requirement.stdout}\n${requirement.stderr}`
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("designated =>")) ?? "";
  return {
    identifier: field(text, "Identifier"),
    teamId: field(text, "TeamIdentifier"),
    cdhash: field(text, "CDHash"),
    signature: field(text, "Signature"),
    authorities: [...text.matchAll(/^Authority=(.*)$/gm)].map((match) => match[1].trim()),
    designatedRequirement,
  };
}

async function inventoryBundle(root) {
  const files = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Computer use sidecar must not contain symlinks: ${full}`);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Computer use sidecar contains an unsupported entry: ${full}`);
      const bytes = await readFile(full);
      files.push({
        path: path.relative(root, full).split(path.sep).join("/"),
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mode: (await lstat(full)).mode & 0o777,
      });
    }
  };
  await walk(root);
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return files;
}

export async function verifyOfficialComputerUseSidecar(target) {
  const info = await lstat(target).catch(() => null);
  if (!info) throw new Error(`Computer use sidecar source is missing: ${target}`);
  if (info.isSymbolicLink()) throw new Error(`Computer use sidecar source must be the bundle itself, not a symlink: ${target}`);
  if (!info.isDirectory()) throw new Error(`Computer use sidecar source is not a bundle directory: ${target}`);
  if (path.basename(target) !== COMPUTER_USE_SIDECAR_IDENTITY.appName) {
    throw new Error(`Computer use sidecar source must be named ${COMPUTER_USE_SIDECAR_IDENTITY.appName}: ${target}`);
  }
  const executable = path.join(target, "Contents", "MacOS", COMPUTER_USE_SIDECAR_IDENTITY.executable);
  if (!(await stat(executable).catch(() => null))?.isFile()) {
    throw new Error(`Computer use sidecar executable is missing: ${executable}`);
  }
  const plist = path.join(target, "Contents", "Info.plist");
  const bundleId = (await command("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", plist])).stdout.trim();
  const bundleExecutable = (await command("/usr/bin/plutil", ["-extract", "CFBundleExecutable", "raw", plist])).stdout.trim();
  if (bundleId !== COMPUTER_USE_SIDECAR_IDENTITY.bundleId || bundleExecutable !== COMPUTER_USE_SIDECAR_IDENTITY.executable) {
    throw new Error(`Computer use sidecar Info.plist identity is ${bundleId} / ${bundleExecutable}`);
  }
  await command("/usr/bin/codesign", ["--verify", "--deep", "--strict", target]);
  const signature = await describeComputerUseSidecarSignature(target);
  if (signature.identifier !== COMPUTER_USE_SIDECAR_IDENTITY.bundleId) {
    throw new Error(`Computer use sidecar identifier is ${signature.identifier || "absent"}`);
  }
  if (signature.teamId !== COMPUTER_USE_SIDECAR_IDENTITY.teamId) {
    throw new Error(`Computer use sidecar Team ID is ${signature.teamId || "absent"}, expected ${COMPUTER_USE_SIDECAR_IDENTITY.teamId}`);
  }
  if (signature.signature === "adhoc" || signature.authorities.length === 0) {
    throw new Error("Computer use sidecar signature is ad-hoc");
  }
  const authorityMatches = signature.authorities.some((authority) =>
    authority.startsWith("Developer ID Application:") && authority.endsWith(`(${COMPUTER_USE_SIDECAR_IDENTITY.teamId})`));
  if (!authorityMatches) {
    throw new Error(`Computer use sidecar authority is not the expected Developer ID: ${signature.authorities.join("; ") || "none"}`);
  }
  if (!signature.designatedRequirement.includes(`identifier "${COMPUTER_USE_SIDECAR_IDENTITY.bundleId}"`)
    || !signature.designatedRequirement.includes(COMPUTER_USE_SIDECAR_IDENTITY.teamId)) {
    throw new Error("Computer use sidecar designated requirement does not name the expected bundle and team");
  }
  if (!signature.cdhash) throw new Error("Computer use sidecar cdhash is missing");
  await command("/usr/sbin/spctl", ["--assess", "--type", "execute", target]);
  return signature;
}

export async function stageComputerUseSidecar0721({ outputRoot, helperSource, env = process.env } = {}) {
  if (typeof outputRoot !== "string" || outputRoot.length === 0) throw new TypeError("outputRoot is required");
  const source = (helperSource ?? explicitComputerUseSidecarSource(env)).trim();
  if (!source) {
    throw new Error("Computer use sidecar source is required. Set GROK_NODE_SIDECAR_APP to the signed helper bundle. This Grok Node build does not read a Grok Bot install path.");
  }
  const sourceSignature = await verifyOfficialComputerUseSidecar(source);
  const sourceFiles = await inventoryBundle(source);
  const destinationRoot = path.join(outputRoot, "dist/deps/computer-use-sidecar");
  const destinationApp = path.join(destinationRoot, COMPUTER_USE_SIDECAR_IDENTITY.appName);
  await rm(destinationRoot, { recursive: true, force: true });
  await mkdir(destinationRoot, { recursive: true });
  try {
    await command("/usr/bin/ditto", [source, destinationApp]);
    const destinationSignature = await verifyOfficialComputerUseSidecar(destinationApp);
    if (destinationSignature.cdhash !== sourceSignature.cdhash || destinationSignature.teamId !== sourceSignature.teamId) {
      throw new Error("Ditto changed the computer use sidecar signature");
    }
    const destinationFiles = await inventoryBundle(destinationApp);
    if (JSON.stringify(destinationFiles) !== JSON.stringify(sourceFiles)) {
      throw new Error("Ditto changed the computer use sidecar file inventory");
    }
    const executable = destinationFiles.find((entry) => entry.path === `Contents/MacOS/${COMPUTER_USE_SIDECAR_IDENTITY.executable}`);
    if (!executable) throw new Error("Computer use sidecar executable is missing from the staged copy");
    const manifest = {
      schemaVersion: 1,
      identity: COMPUTER_USE_SIDECAR_IDENTITY,
      source: {
        path: source,
        identifier: sourceSignature.identifier,
        teamId: sourceSignature.teamId,
        cdhash: sourceSignature.cdhash,
        authorities: sourceSignature.authorities,
        designatedRequirement: sourceSignature.designatedRequirement,
      },
      destination: {
        cdhash: destinationSignature.cdhash,
        teamId: destinationSignature.teamId,
        identifier: destinationSignature.identifier,
      },
      inventory: {
        fileCount: destinationFiles.length,
        totalBytes: destinationFiles.reduce((sum, entry) => sum + entry.bytes, 0),
        executableSha256: executable.sha256,
        files: destinationFiles,
      },
    };
    await writeFile(path.join(destinationRoot, "sidecar-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Computer use sidecar: ditto ${destinationFiles.length} files (${manifest.inventory.totalBytes} bytes), ${destinationSignature.teamId} ${destinationSignature.cdhash}`);
    return manifest;
  } catch (error) {
    await rm(destinationRoot, { recursive: true, force: true });
    throw error;
  }
}

async function directoryExists(target) {
  return (await stat(target).catch(() => null))?.isDirectory() === true;
}

async function restoreHeldSidecar(helper, held) {
  if (await directoryExists(held)) {
    await rm(helper, { recursive: true, force: true });
    await rename(held, helper);
    return;
  }
  if (!(await directoryExists(helper))) {
    throw new Error("Computer use sidecar disappeared during ad-hoc signing");
  }
}

export async function signAppBundlePreservingComputerUseSidecar(appPath, bundleId, {
  sign = signAppBundleAdHoc,
} = {}) {
  if (typeof appPath !== "string" || appPath.length === 0) {
    throw new TypeError("An explicit application bundle path is required for ad-hoc signing.");
  }
  const helper = packagedComputerUseSidecarPath(appPath);
  if (!(await directoryExists(helper))) {
    throw new Error(`Packaged computer use sidecar is missing: ${helper}`);
  }
  const before = await describeComputerUseSidecarSignature(helper);
  const held = `${appPath}.computer-use-sidecar-held`;
  await rm(held, { recursive: true, force: true });
  await rename(helper, held);
  try {
    await sign(appPath, bundleId);
  } finally {
    await restoreHeldSidecar(helper, held);
  }
  await command("/usr/bin/codesign", adHocRequirementCodesignArguments(appPath, bundleId));
  const after = await describeComputerUseSidecarSignature(helper);
  if (after.cdhash !== before.cdhash || after.teamId !== before.teamId || after.identifier !== before.identifier
    || after.designatedRequirement !== before.designatedRequirement) {
    throw new Error("Ad-hoc packaging changed the computer use sidecar signature");
  }
  await command("/usr/bin/codesign", ["--verify", "--deep", "--strict", helper]);
  await command("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
  return { before, after };
}
