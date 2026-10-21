import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Contract for the in-box layout of the local-docker VM.
//
// The upstream image decides where the host bundle is launched FROM: the
// image's own /usr/local/bin/sand-supervisor-contract.mjs hardcodes the host
// dir and spawns `node <HOST_DIR>/host-main.cjs`.
//
// Two upstream layouts are known:
//   image git-sha 12c7367 (universal@sha256:f9dff5cd…, Chrome 151)
//     → /home/box/sand-host, deps /home/box/deps
//   image git-sha 726deab (universal@sha256:a8813ae…, Chrome 154)
//     → /opt/sand/sand-host, deps /opt/sand/deps
//
// The pinned image and the root are ONE fact — they move together. This test
// pins the CURRENT pairing and locks the wiring that follows from it:
//   1. the desktop shell must mount its reconstructed bundle at the image's
//      entry path, or the bundle is a dead file while the upstream host
//      keeps serving :1340 (the 2026-10-01 silent-failure mode);
//   2. the tree-sitter deps and NODE_PATH must point at the image's deps dir
//      (it moved with the host root);
//   3. the exec-daemon mount must sit next to the host dir, because the
//      reconstructed host resolves `../box-exec-daemon/main.cjs` relative to
//      its own entry;
//   4. the in-container env must carry the root, so the running host derives
//      the same paths the shell mounted to;
//   5. a leftover container from a previous layout must be replaced, not
//      rejected as an "unexpected image".
//
// This is a guard test: it fails when someone reintroduces a hardcoded copy
// of the other layout's path, which is what silently disabled the host-side
// rebuild features for three days in 2026-10.

const PINNED_DIGEST = "public.ecr.aws/k0i0n2g5/cursorenvironments/universal@sha256:f9dff5cd254d9fac936f33754b8950e50443bacffdf0fdc61cf5b23d72a82856";
const PINNED_ROOT = "/home/box";
const PINNED_HOST_ENTRY = `${PINNED_ROOT}/sand-host/host-main.cjs`;
const PINNED_SCHEMA_VERSION = "9";

const CONNECTOR_PATH = new URL("../source/electron-main/box/local-docker-host-connector.ts", import.meta.url).pathname;
const CONSTANTS_PATH = new URL("../source/packages/constants/sand-supervisor.ts", import.meta.url).pathname;
const HOST_UPGRADE_PATH = new URL("../source/host/extensions/host-upgrade/host-bundle-upgrade.ts", import.meta.url).pathname;
const EXEC_DAEMON_PATH = new URL("../source/host/box/exec-daemon-process.ts", import.meta.url).pathname;

const connector = readFileSync(CONNECTOR_PATH, "utf8");
const constants = readFileSync(CONSTANTS_PATH, "utf8");
const hostUpgrade = readFileSync(HOST_UPGRADE_PATH, "utf8");
const execDaemon = readFileSync(EXEC_DAEMON_PATH, "utf8");

test("the host bundle root lives in one shared constant", () => {
  assert.ok(constants.includes(`export const SAND_BOX_HOST_BUNDLE_ROOT = "${PINNED_ROOT}"`), "the root must match the pinned image's layout");
  assert.match(constants, /export const SAND_BOX_HOST_DIR = `\$\{SAND_BOX_HOST_BUNDLE_ROOT\}\/sand-host`/);
  assert.match(constants, /export const SAND_BOX_HOST_ENTRY = `\$\{SAND_BOX_HOST_DIR\}\/host-main\.cjs`/);
  assert.match(constants, /export const SAND_BOX_DEPS_DIR = `\$\{SAND_BOX_HOST_BUNDLE_ROOT\}\/deps`/);
  assert.match(constants, /export const SAND_BOX_EXEC_DAEMON_DIR = `\$\{SAND_BOX_HOST_BUNDLE_ROOT\}\/box-exec-daemon`/);
});

test("the pinned image and the root are one fact, and they agree", () => {
  // The digest and the root must describe the SAME upstream build. Changing
  // one without the other is exactly how the 2026-10-01 silent failure
  // happened (new image, old mount path).
  assert.ok(connector.includes(`LOCAL_DOCKER_BOX_IMAGE_DIGEST = "${PINNED_DIGEST}"`), "the pinned image must match the pinned layout");
  assert.ok(constants.includes(`export const SAND_BOX_HOST_BUNDLE_ROOT = "${PINNED_ROOT}"`), "the pinned layout must match the pinned image");
  // The other known layout must not leak into the live wiring.
  assert.ok(!connector.includes("dst=/opt/sand/sand-host/host-main.cjs"), "the /opt/sand mount destination must not be hardcoded");
  assert.ok(!connector.includes("SAND_TREE_SITTER_NODE_DEPS=/opt/sand/deps"), "the /opt/sand deps path must not be hardcoded");
});

test("the bundle is mounted at the image's host entry path", () => {
  assert.match(connector, /"--mount", `type=bind,src=\$\{hostBundle\.path\},dst=\$\{SAND_BOX_HOST_ENTRY\},readonly`/);
  // The destination must be DERIVED from the shared constant, never a literal:
  // a hardcoded copy is what made the 2026-10-01 image swap a silent failure
  // (bundle mounted at the old path, upstream host kept serving :1340).
  assert.ok(!connector.includes("dst=/home/box/sand-host/host-main.cjs"), "the host mount destination must not be a literal");
  assert.ok(!connector.includes("dst=/opt/sand/sand-host/host-main.cjs"), "the host mount destination must not be a literal");
  assert.ok(!connector.includes("dst=/home/box/box-exec-daemon"), "the exec-daemon mount destination must not be a literal");
});

test("deps and NODE_PATH point at the image's deps dir", () => {
  assert.match(connector, /SAND_TREE_SITTER_NODE_DEPS=\$\{SAND_BOX_DEPS_DIR\}/);
  assert.match(connector, /NODE_PATH=\$\{SAND_BOX_DEPS_DIR\}/);
  assert.ok(!connector.includes("SAND_TREE_SITTER_NODE_DEPS=/home/box/deps"), "the deps path must not be a literal");
  assert.ok(!connector.includes("SAND_TREE_SITTER_NODE_DEPS=/opt/sand/deps"), "the deps path must not be a literal");
});

test("the exec-daemon mount lands where the host resolves it", () => {
  // The reconstructed host resolves its exec-daemon entry relative to its own
  // entry file, so the mount must be a sibling of the host dir.
  assert.match(execDaemon, /BOX_EXEC_DAEMON_ENTRY_RELATIVE = "\.\.\/box-exec-daemon\/main\.cjs"/);
  assert.match(connector, /"--mount", `type=bind,src=\$\{dirname\(hostBundle\.boxExecDaemonPath\)\},dst=\$\{SAND_BOX_EXEC_DAEMON_DIR\},readonly`/);
});

test("the container env carries the root so the in-box host agrees", () => {
  assert.match(connector, /"--env", `SAND_BOX_HOST_BUNDLE_ROOT=\$\{SAND_BOX_HOST_BUNDLE_ROOT\}`/);
  // The in-box host must read that env instead of pinning a path itself.
  assert.match(hostUpgrade, /resolveSandBoxHostDir\(\)/);
  assert.ok(!hostUpgrade.includes('"/home/box/sand-host/version"'), "the version-marker path must not be hardcoded in the host");
});

test("a leftover container from the previous layout is replaced, not rejected", () => {
  // The schema version bump is what turns "different image" from a hard
  // error into an automatic replace. Without it the app would refuse to
  // start against its own previous container.
  assert.ok(connector.includes(`export const LOCAL_DOCKER_SCHEMA_VERSION = "${PINNED_SCHEMA_VERSION}"`), "the schema version must move with the layout");
  assert.match(connector, /const layoutChanged = inspected\.schemaVersion !== LOCAL_DOCKER_SCHEMA_VERSION/);
  const imageGuard = connector.slice(
    connector.indexOf("const layoutChanged = inspected.schemaVersion"),
    connector.indexOf("if (inspected.exists && (layoutChanged ||"),
  );
  assert.match(imageGuard, /!layoutChanged/, "the unexpected-image error must be skipped when the layout changed");
  assert.match(imageGuard, /throw new Error\(`Local Docker VM container uses unexpected image/, "the guard must still exist for same-layout containers");
});
