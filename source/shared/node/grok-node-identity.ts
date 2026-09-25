import { join } from "node:path";

/**
 * Grok Node product identity.
 *
 * The reconstructed macOS app intentionally keeps CFBundleName "Grok Bot"
 * (Electron derives the nested helper names from it), so without this fork
 * both apps would share the default Electron userData directory,
 * ~/.grokbot, and the local Docker VM name. These constants give Grok Node
 * its own identity so it can run side-by-side with the official Grok Bot.
 *
 * Detection is deliberately narrow: only the packaged "Grok Node.app"
 * bundle opts in. Dev runs, fidelity builds, the in-container host, and the
 * test runner all keep the legacy shared identity. Explicit env overrides
 * (SAND_DATA_ROOT / SAND_USER_DATA_DIR) always win over these defaults.
 */
export const GROK_NODE_APP_BUNDLE_MARKER = "Grok Node.app";
export const GROK_NODE_USER_DATA_DIRNAME = "Grok Node";
export const GROK_NODE_DATA_ROOT_DIRNAME = ".groknode";
export const GROK_NODE_DOCKER_CONTAINER = "grok-node-local-vm";

export function isGrokNodePackagedApp(execPath: string = process.execPath): boolean {
  return execPath.includes(GROK_NODE_APP_BUNDLE_MARKER);
}

export function getGrokNodeProductionRootDir(homeDir: string): string {
  return join(homeDir, GROK_NODE_DATA_ROOT_DIRNAME);
}

export function getGrokNodeUserDataDir(appDataDir: string): string {
  return join(appDataDir, GROK_NODE_USER_DATA_DIRNAME);
}
