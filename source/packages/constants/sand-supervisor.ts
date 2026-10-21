export const SAND_SUPERVISOR_DIR = "/tmp/sand-supervisor";
export const SAND_SUPERVISOR_COMMAND_PATH = `${SAND_SUPERVISOR_DIR}/command.json`;
export const SAND_SUPERVISOR_COMMAND_PART_PATH = `${SAND_SUPERVISOR_COMMAND_PATH}.part`;
export const SAND_SUPERVISOR_STATUS_PATH = `${SAND_SUPERVISOR_DIR}/status.json`;
export const SAND_SUPERVISOR_ACKS_DIR = `${SAND_SUPERVISOR_DIR}/acks`;
export const SAND_SUPERVISOR_STAGED_BUNDLE_PATH = `${SAND_SUPERVISOR_DIR}/incoming-host-bundle.tgz`;
export const SAND_SUPERVISOR_STAGED_BUNDLE_PART_PATH = `${SAND_SUPERVISOR_STAGED_BUNDLE_PATH}.part`;
export const SAND_SUPERVISOR_DESKTOP_HEALTH_PATH = `${SAND_SUPERVISOR_DIR}/desktop-health.json`;
export const SAND_BOX_AGENT_DATA_ROOT = "/home/box/sand-data";
export const SAND_BOX_HOST_UPGRADE_MARKER_PATH = `${SAND_BOX_AGENT_DATA_ROOT}/.sand-host-upgrade.json`;

// The in-box host bundle root is a property of the UPSTREAM IMAGE, not of this
// app: the image's own /usr/local/bin/sand-supervisor-contract.mjs hardcodes
// the host dir and spawns `node <HOST_DIR>/host-main.cjs` with that path, so a
// reconstructed bundle mounted anywhere else is a dead file while the upstream
// host keeps serving :1340.
//
// The root therefore moves TOGETHER WITH THE IMAGE PIN — they are one fact,
// not two. Known upstream layouts:
//
//   /home/box   host dir /home/box/sand-host   deps /home/box/deps
//               image universal@sha256:f9dff5cd… (git-sha 12c7367, Chrome 151)
//
//   /opt/sand   host dir /opt/sand/sand-host   deps /opt/sand/deps
//               image universal@sha256:8c489b5f… (the pinned image, git-sha
//               2e44baf, Chrome 155); universal@sha256:a8813ae… shares this
//               layout
//
// BEFORE CHANGING EITHER VALUE: read the target image's
// /usr/local/bin/sand-supervisor-contract.mjs and confirm its host dir and
// deps dir, then move the pin and this root in the same commit.
export const SAND_BOX_HOST_BUNDLE_ROOT_ENV = "SAND_BOX_HOST_BUNDLE_ROOT";
export const SAND_BOX_HOST_BUNDLE_ROOT = "/opt/sand";
export const SAND_BOX_HOST_DIR = `${SAND_BOX_HOST_BUNDLE_ROOT}/sand-host`;
export const SAND_BOX_HOST_ENTRY = `${SAND_BOX_HOST_DIR}/host-main.cjs`;
export const SAND_BOX_HOST_VERSION_PATH = `${SAND_BOX_HOST_DIR}/version`;
export const SAND_BOX_DEPS_DIR = `${SAND_BOX_HOST_BUNDLE_ROOT}/deps`;
// The reconstructed host resolves its own exec-daemon entry as
// `../box-exec-daemon/main.cjs` relative to the host entry, so the mount has
// to sit next to the host dir, not under it.
export const SAND_BOX_EXEC_DAEMON_DIR = `${SAND_BOX_HOST_BUNDLE_ROOT}/box-exec-daemon`;

// In-box consumers resolve the root from the environment the desktop shell
// passes in, so the mounted paths and the running host cannot drift apart if
// the upstream image moves the root again.
export function resolveSandBoxHostBundleRoot(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[SAND_BOX_HOST_BUNDLE_ROOT_ENV]?.trim();
  return raw != null && raw.length > 0 ? raw : SAND_BOX_HOST_BUNDLE_ROOT;
}

export function resolveSandBoxHostDir(env: NodeJS.ProcessEnv = process.env): string {
  return `${resolveSandBoxHostBundleRoot(env)}/sand-host`;
}
export const SAND_HOST_UPGRADE_MAX_DEFER_MS = 6 * 60 * 60 * 1_000;

export type SandSupervisorCommand = {
  id: string;
  kind: string;
  issuedAtMs: number;
  reason?: string;
  mode?: string;
  version?: string;
  bundlePath?: string;
  forceNow?: true;
};

export type BuildSandSupervisorCommandArgs = Omit<SandSupervisorCommand, "issuedAtMs"> & { nowMs: number };

export function buildSandSupervisorCommand(args: BuildSandSupervisorCommandArgs): SandSupervisorCommand {
  const command: SandSupervisorCommand = { id: args.id, kind: args.kind, issuedAtMs: args.nowMs };
  if (args.reason !== undefined) command.reason = args.reason;
  if (args.kind === "upgrade") {
    if (args.mode !== undefined) command.mode = args.mode;
    if (args.version !== undefined) command.version = args.version;
    if (args.bundlePath !== undefined) command.bundlePath = args.bundlePath;
    if (args.forceNow === true) command.forceNow = true;
  }
  return command;
}

export const serializeSandSupervisorCommand = (command: SandSupervisorCommand): string => JSON.stringify(command);
export const isSandHostUpgradeAvailable = (current: string, target: string | null | undefined): boolean => target != null && target.length > 0 && current !== target;
