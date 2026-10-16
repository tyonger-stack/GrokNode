import { closeSync, fstatSync, openSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

import { normalizeLibraryOrigin } from "../../shared/library/links.js";

// Container-side identities for the opt-in Node Library HTTPS receiver.
// TLS bytes stay on the Mac; only readonly bind mounts enter the container.
export const LIBRARY_TLS_CONTAINER_DIR = "/home/box/library-tls";
export const LIBRARY_TLS_CONTAINER_KEY_FILE = `${LIBRARY_TLS_CONTAINER_DIR}/key.pem`;
export const LIBRARY_TLS_CONTAINER_CERT_FILE = `${LIBRARY_TLS_CONTAINER_DIR}/cert.pem`;
// Inside the container the receiver binds 0.0.0.0; reachability stays
// loopback-only because the host-side publish is pinned to 127.0.0.1.
export const LIBRARY_CONTAINER_LISTEN_HOST = "0.0.0.0";
// Host ports already published by the local VM. A library origin carrying one
// of these is rejected instead of emitting a duplicate --publish entry.
export const RESERVED_LIBRARY_PUBLISHED_HOST_PORTS = [1337, 1339, 1340, 6080, 6081, 8790] as const;

export interface LibraryDockerForwarding {
  readonly origin: string;
  readonly port: number;
  readonly keyFile: string;
  readonly certFile: string;
}

function failClosed(message: string): never {
  throw new Error(`Library container forwarding disabled: ${message}`);
}

// Resolve operator symlinks, then prove the target opens and is a regular
// file. A bare statSync would follow the link but never proves readability,
// and the resolved path below is what actually enters the --mount argument.
function resolveReadableFile(envName: string, target: string): string {
  if (!isAbsolute(target)) failClosed(`${envName} must be an absolute path.`);
  if (/[,\0\n\r]/u.test(target)) failClosed(`${envName} contains a rejected mount-argument character.`);
  let resolved: string;
  try {
    resolved = realpathSync(target);
  } catch {
    failClosed(`${envName} does not resolve to a readable file.`);
  }
  if (/[,\0\n\r]/u.test(resolved)) failClosed(`${envName} resolves to a rejected mount-argument path.`);
  let fd: number | null = null;
  try {
    fd = openSync(resolved, "r");
    if (!fstatSync(fd).isFile()) failClosed(`${envName} is not a regular file.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Library container forwarding disabled")) throw error;
    failClosed(`${envName} is not a readable file.`);
  } finally {
    if (fd !== null) closeSync(fd);
  }
  return resolved;
}

// Opt-in is explicit: all three Mac-side variables must be present. Returns
// null when none is set so the container args stay byte-identical. Any
// partial configuration fails closed. Returned paths are symlink-resolved
// absolute paths, which is exactly what enters the readonly --mount. File
// contents are never read into memory and never appear in errors; only env
// names, the origin, and the port do.
export function resolveLibraryDockerForwarding(env: NodeJS.ProcessEnv = process.env): LibraryDockerForwarding | null {
  const originRaw = env.SAND_LIBRARY_ORIGIN ?? "";
  const keyFile = env.SAND_LIBRARY_TLS_KEY_FILE ?? "";
  const certFile = env.SAND_LIBRARY_TLS_CERT_FILE ?? "";
  if (originRaw === "" && keyFile === "" && certFile === "") return null;
  if (originRaw === "") failClosed("SAND_LIBRARY_ORIGIN is required.");
  if (keyFile === "" || certFile === "") failClosed("SAND_LIBRARY_TLS_KEY_FILE and SAND_LIBRARY_TLS_CERT_FILE are both required.");
  let origin: string;
  try {
    origin = normalizeLibraryOrigin(originRaw);
  } catch {
    failClosed("SAND_LIBRARY_ORIGIN must be an HTTPS origin.");
  }
  const url = new URL(origin);
  if (url.port === "") failClosed(`Library origin ${origin} carries no explicit port for publishing.`);
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) failClosed(`Library origin ${origin} carries no usable port.`);
  if ((RESERVED_LIBRARY_PUBLISHED_HOST_PORTS as readonly number[]).includes(port)) {
    failClosed(`Library origin port ${port} is already published by the local VM.`);
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname.includes(":")) {
    failClosed("IPv6 origins are unsupported by the IPv4 Docker publish; set SAND_LIBRARY_ORIGIN=https://127.0.0.1:<port>.");
  }
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    failClosed(`Library origin ${origin} is not loopback; external origins are a separate design.`);
  }
  const keyResolved = resolveReadableFile("SAND_LIBRARY_TLS_KEY_FILE", keyFile);
  const certResolved = resolveReadableFile("SAND_LIBRARY_TLS_CERT_FILE", certFile);
  if (keyResolved === certResolved) failClosed("SAND_LIBRARY_TLS_KEY_FILE and SAND_LIBRARY_TLS_CERT_FILE must be different files.");
  return { origin, port, keyFile: keyResolved, certFile: certResolved };
}

// Rendered docker arguments for one validated forwarding. Mounts are
// readonly; the container receives env references, never secret bytes.
export function libraryDockerForwardingArgs(forwarding: LibraryDockerForwarding): string[] {
  return [
    "--mount", `type=bind,src=${forwarding.keyFile},dst=${LIBRARY_TLS_CONTAINER_KEY_FILE},readonly`,
    "--mount", `type=bind,src=${forwarding.certFile},dst=${LIBRARY_TLS_CONTAINER_CERT_FILE},readonly`,
    "--env", `SAND_LIBRARY_ORIGIN=${forwarding.origin}`,
    "--env", `SAND_LIBRARY_TLS_KEY_FILE=${LIBRARY_TLS_CONTAINER_KEY_FILE}`,
    "--env", `SAND_LIBRARY_TLS_CERT_FILE=${LIBRARY_TLS_CONTAINER_CERT_FILE}`,
    "--env", `SAND_LIBRARY_LISTEN_HOST=${LIBRARY_CONTAINER_LISTEN_HOST}`,
    "--env", "SAND_LIBRARY_INTERNAL_CONTAINER=1",
    "--publish", `127.0.0.1:${forwarding.port}:${forwarding.port}`,
  ];
}
