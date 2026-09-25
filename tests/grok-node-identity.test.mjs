import assert from "node:assert/strict";
import { build, transform } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("Grok Node owns the groknode URL scheme while the parser stays scheme-tolerant", async () => {
  const identityBundle = await bundle("source/shared/node/grok-node-identity.ts", "grok-node-scheme-");
  try {
    assert.equal(identityBundle.module.GROK_NODE_DEEP_LINK_SCHEME, "groknode");
  } finally {
    await identityBundle.dispose();
  }
  const loaded = await bundle("source/shared/deep-link.ts", "grok-node-deep-link-");
  try {
    const { parseSandDeepLink, SAND_DEEP_LINK_PROTOCOL_SCHEMES } = loaded.module;
    assert.deepEqual([...SAND_DEEP_LINK_PROTOCOL_SCHEMES].sort(), ["groknode", "sand"]);
    // Grok Node's own scheme parses every custom-protocol route.
    const open = parseSandDeepLink("groknode://app/v1/open");
    assert.equal(open?.link.route, "open");
    const info = parseSandDeepLink("groknode://app/v1/info?topic=deep-links");
    assert.equal(info?.link.route, "info");
    // Canonical URLs stay on the ecosystem `sand` scheme so shared links keep working.
    assert.equal(open?.canonicalUrl, "sand://app/v1/open");
    // The official schemes keep parsing when delivered via argv or `open -a`.
    assert.equal(parseSandDeepLink("sand://app/v1/open")?.link.route, "open");
    assert.equal(parseSandDeepLink("grokbot://app/v1/bot-template?id=_jOdbfkB16zxu7MRcmReE")?.link.route, "bot-template");
    assert.equal(parseSandDeepLink("https://x.ai/bot/_jOdbfkB16zxu7MRcmReE")?.link.route, "bot-template");
    // Grok Node's own scheme also accepts bot-template links; the canonical URL
    // stays on the ecosystem grokbot:// form so both schemes dedupe together.
    const gnTemplate = parseSandDeepLink("groknode://app/v1/bot-template?id=_jOdbfkB16zxu7MRcmReE");
    assert.equal(gnTemplate?.link.route, "bot-template");
    assert.equal(gnTemplate?.link.templateId, "_jOdbfkB16zxu7MRcmReE");
    assert.equal(gnTemplate?.link.source, "protocol");
    assert.equal(gnTemplate?.canonicalUrl, "grokbot://app/v1/bot-template?id=_jOdbfkB16zxu7MRcmReE");
    // Unrelated schemes still fail closed.
    assert.equal(parseSandDeepLink("grokbot://app/v1/unknown"), null);
    assert.equal(parseSandDeepLink("other://app/v1/open"), null);
  } finally {
    await loaded.dispose();
  }
});

test("argv deep-link extraction accepts the groknode scheme", async () => {
  const loaded = await bundle("source/electron-main/deep-link/deep-link-controller.ts", "grok-node-argv-");
  try {
    const candidates = loaded.module.extractDeepLinkCandidatesFromArgv([
      "/Applications/Grok Node.app/Contents/MacOS/Grok Bot",
      "groknode://app/v1/open",
      "sand://app/v1/open",
      "grokbot://app/v1/bot-template?id=_jOdbfkB16zxu7MRcmReE",
      "https://x.ai/bot/_jOdbfkB16zxu7MRcmReE",
      "--enable-features=X",
    ]);
    assert.deepEqual(candidates, [
      "groknode://app/v1/open",
      "sand://app/v1/open",
      "grokbot://app/v1/bot-template?id=_jOdbfkB16zxu7MRcmReE",
      "https://x.ai/bot/_jOdbfkB16zxu7MRcmReE",
    ]);
  } finally {
    await loaded.dispose();
  }
});

test("the packaged app claims groknode always and grokbot only without the official app", async () => {
  const packageMacos = await readFile(path.join(repoRoot, "scripts/package-macos.mjs"), "utf8");
  const verify = await readFile(path.join(repoRoot, "scripts/verify.mjs"), "utf8");
  const packageVerification = await readFile(path.join(repoRoot, "scripts/lib/macos-package-verification.mjs"), "utf8");
  const verification = await import(pathToFileURL(path.join(repoRoot, "scripts/lib/macos-package-verification.mjs")).href);
  assert.match(packageMacos, /CFBundleURLName<\/key><string>Grok Node links<\/string>/);
  assert.match(packageMacos, /resolveGrokbotClaimMode\(process\.env\.GROK_NODE_CLAIM_GROKBOT\)/);
  assert.match(packageMacos, /claimMode === "always" \|\| \(claimMode === "auto" && !officialInstalled\)/);
  assert.doesNotMatch(packageMacos, /Grok Bot reconstructed links/);
  assert.match(verify, /verifyReconstructedUrlSchemeIsolation\(\{ reconstructedApp: verifiedApp \}\)/);
  assert.match(packageVerification, /export async function verifyReconstructedUrlSchemeIsolation/);
  assert.match(packageVerification, /export async function officialGrokBotAppInstalled/);
  assert.match(packageVerification, /export function resolveGrokbotClaimMode/);
  assert.match(packageVerification, /const official = officialInstalled \?\? await officialGrokBotAppInstalled\(\)/);
  assert.match(packageVerification, /claimsGrokbot && official && !allowGrokbotClaim/);
  assert.match(packageVerification, /must not claim the official sand URL scheme/);
  assert.match(packageVerification, /urlSchemeOptions \?\? \{\}/);
  // The claim-mode override is a pure function, so it is covered cross-platform.
  assert.equal(verification.resolveGrokbotClaimMode(undefined), "auto");
  assert.equal(verification.resolveGrokbotClaimMode(""), "auto");
  assert.equal(verification.resolveGrokbotClaimMode(" ALWAYS "), "always");
  assert.equal(verification.resolveGrokbotClaimMode("never"), "never");
  assert.throws(() => verification.resolveGrokbotClaimMode("sometimes"), /GROK_NODE_CLAIM_GROKBOT must be one of/);
});

test("the URL scheme gate adapts to the official Grok Bot's presence", { skip: process.platform !== "darwin" }, async () => {
  const verification = await import(pathToFileURL(path.join(repoRoot, "scripts/lib/macos-package-verification.mjs")).href);
  const plistWithSchemes = (schemes) => [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\"><dict><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array>",
    ...schemes.map((scheme) => `<string>${scheme}</string>`),
    "</array></dict></array></dict></plist>",
  ].join("");
  const plistWithBundleId = (bundleId) => [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    `<plist version=\"1.0\"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string></dict></plist>`,
  ].join("");
  const temp = await mkdtemp(path.join(os.tmpdir(), "grok-node-scheme-gate-"));
  const makeApp = async (root, name, contents) => {
    const appDir = path.join(root, name);
    await mkdir(path.join(appDir, "Contents"), { recursive: true });
    await writeFile(path.join(appDir, "Contents", "Info.plist"), contents);
    return appDir;
  };
  try {
    // A groknode-only claim passes in both machine states.
    const grokNodeOnly = await makeApp(temp, "Grok Node.app", plistWithSchemes(["groknode"]));
    assert.equal((await verification.verifyReconstructedUrlSchemeIsolation({ reconstructedApp: grokNodeOnly, officialInstalled: true })).scheme, "groknode");
    assert.equal((await verification.verifyReconstructedUrlSchemeIsolation({ reconstructedApp: grokNodeOnly, officialInstalled: false })).scheme, "groknode");
    // grokbot is claimable only while the official Grok Bot is absent.
    const grokNodeBoth = await makeApp(temp, "Grok Node Both.app", plistWithSchemes(["groknode", "grokbot"]));
    assert.equal((await verification.verifyReconstructedUrlSchemeIsolation({ reconstructedApp: grokNodeBoth, officialInstalled: false })).scheme, "groknode+grokbot");
    await assert.rejects(
      verification.verifyReconstructedUrlSchemeIsolation({ reconstructedApp: grokNodeBoth, officialInstalled: true }),
      /must not claim the official grokbot URL scheme while the official Grok Bot is installed/,
    );
    // An explicit distribution build (GROK_NODE_CLAIM_GROKBOT=always) may claim
    // grokbot even while the official app is installed on the build machine.
    assert.equal((await verification.verifyReconstructedUrlSchemeIsolation({ reconstructedApp: grokNodeBoth, officialInstalled: true, allowGrokbotClaim: true })).scheme, "groknode+grokbot");
    // sand is never claimable and groknode is always required.
    await assert.rejects(
      verification.verifyReconstructedUrlSchemeIsolation({ reconstructedApp: await makeApp(temp, "Grok Node Sand.app", plistWithSchemes(["groknode", "sand"])), officialInstalled: false }),
      /must not claim the official sand URL scheme/,
    );
    await assert.rejects(
      verification.verifyReconstructedUrlSchemeIsolation({ reconstructedApp: await makeApp(temp, "Grok Node None.app", plistWithSchemes(["grokbot"])), officialInstalled: false }),
      /has no groknode URL registration/,
    );
    // Official detection scans both Applications roots and requires the official bundle id.
    const homeDir = path.join(temp, "home");
    const sysDir = path.join(temp, "sys");
    await mkdir(path.join(homeDir, "Applications"), { recursive: true });
    await mkdir(sysDir, { recursive: true });
    assert.equal(await verification.officialGrokBotAppInstalled(homeDir, sysDir), false);
    await makeApp(sysDir, "Grok Bot.app", plistWithBundleId("com.anysphere.sand"));
    assert.equal(await verification.officialGrokBotAppInstalled(homeDir, sysDir), true);
    await makeApp(sysDir, "Grok Bot.app", plistWithBundleId("com.example.other"));
    assert.equal(await verification.officialGrokBotAppInstalled(homeDir, sysDir), false);
    // Real-machine detection stays environment-independent: it returns a
    // boolean on any host, regardless of whether this machine happens to have
    // the official app installed (CI runners do not).
    assert.equal(typeof (await verification.officialGrokBotAppInstalled()), "boolean");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("the channel diagnostic resolves the Mac settings file from the app's own data root", async () => {
  const { resolveMacSettingsPath } = await import(pathToFileURL(path.join(repoRoot, "scripts/diagnose-channel.mjs")).href);
  assert.equal(
    resolveMacSettingsPath("grok-node-local-vm", {}),
    path.join(os.homedir(), ".groknode", "settings.json"),
  );
  assert.equal(
    resolveMacSettingsPath("grok-bot-local-vm", {}),
    path.join(os.homedir(), ".grokbot", "settings.json"),
  );
  assert.equal(resolveMacSettingsPath("grok-node-local-vm", { SAND_DATA_ROOT: "/tmp/grok-node-root" }), "/tmp/grok-node-root/settings.json");
  const diagnose = await readFile(path.join(repoRoot, "scripts/diagnose-channel.mjs"), "utf8");
  assert.doesNotMatch(diagnose, /join\(homedir\(\), "\.grokbot", "settings\.json"\)/);
});

test("StepFun secrets no longer fall back to a sibling app's data root", async () => {
  const stepfun = await readFile(path.join(repoRoot, "source/electron-main/account/stepfun-transcribe.ts"), "utf8");
  assert.doesNotMatch(stepfun, /"\.grokbot", "box-secrets\.json"/);
  assert.match(stepfun, /getBoxSecretsStorePath\(\)/);
});

test("the packaged Grok Node presents its own app name and coordinator process name", async () => {
  const main = await readFile(path.join(repoRoot, "source/electron-main/main.ts"), "utf8");
  const launcher = await readFile(path.join(repoRoot, "source/electron-main/coordinator/coordinator-launcher.ts"), "utf8");
  const services = await readFile(path.join(repoRoot, "source/electron-main/main-production-services.ts"), "utf8");
  // AST-level ordering: inside startElectronMainProduction, the
  // setName("Grok Node") call must execute before
  // createElectronMainProductionComposition, which eagerly snapshots
  // app.getName() for the app menu and window title. Parsing the transpiled
  // module keeps the assertion immune to comment edits and identifier renames.
  const { parse } = await import("acorn");
  const { full: walkFull } = await import("acorn-walk");
  const { code } = await transform(main, { loader: "ts", format: "esm", target: "es2022" });
  const program = parse(code, { ecmaVersion: "latest", sourceType: "module" });
  let entry = null;
  walkFull(program, (node) => {
    if (node.type === "FunctionDeclaration" && node.id?.name === "startElectronMainProduction") entry = node;
  });
  assert.ok(entry != null, "startElectronMainProduction exists");
  const statementOf = { setName: -1, composition: -1 };
  entry.body.body.forEach((statement, index) => {
    walkFull(statement, (node) => {
      if (node.type !== "CallExpression") return;
      const callee = node.callee;
      const calleeName = callee.type === "MemberExpression"
        ? (callee.property?.name ?? callee.property?.value ?? null)
        : callee.type === "Identifier" ? callee.name : null;
      if (calleeName === "setName" && node.arguments.some((argument) => argument.type === "Literal" && argument.value === "Grok Node")) statementOf.setName = index;
      if (calleeName === "createElectronMainProductionComposition") statementOf.composition = index;
    });
  });
  assert.ok(statementOf.setName >= 0, "packaged Grok Node sets its app name inside startElectronMainProduction");
  assert.ok(statementOf.composition > statementOf.setName, "setName must run before the composition snapshots the app name");
  assert.doesNotMatch(main, /deps\.app\.setName\?\.\("Grok Node"\)/);
  assert.match(launcher, /export function resolveCoordinatorServiceName/);
  assert.match(launcher, /serviceName: resolveCoordinatorServiceName\(\)/);
  assert.match(services, /serviceName === resolveCoordinatorServiceName\(\)/);
  assert.doesNotMatch(services, /=== COORDINATOR_SERVICE_NAME/);
  const loaded = await bundle("source/electron-main/coordinator/coordinator-launcher.ts", "grok-node-coordinator-");
  try {
    assert.equal(loaded.module.resolveCoordinatorServiceName("/Applications/Grok Node.app/Contents/MacOS/Grok Bot"), "grok-node-agent-coordinator");
    assert.equal(loaded.module.resolveCoordinatorServiceName("/Applications/Grok Bot.app/Contents/MacOS/Grok Bot"), "sand-node-agent-coordinator");
  } finally {
    await loaded.dispose();
  }
});
