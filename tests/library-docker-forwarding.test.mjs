import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const repoRoot = new URL("..", import.meta.url).pathname;
const require = createRequire(path.join(repoRoot, "package.json"));
const { buildSync } = require("esbuild");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function bundle(entry) {
  const built = buildSync({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: repoRoot,
    external: ["electron"],
  });
  const dir = mkdtempSync(path.join(tmpdir(), "libfwd-"));
  const out = path.join(dir, "bundle.cjs");
  writeFileSync(out, built.outputFiles[0].text);
  return { dir, out };
}
async function load(entry) {
  const { dir, out } = bundle(entry);
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function fixtureFiles() {
  const dir = mkdtempSync(path.join(tmpdir(), "libtls-"));
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  writeFileSync(key, "-----BEGIN FAKE KEY-----\nkey-bytes-fixture\n-----END FAKE KEY-----\n");
  writeFileSync(cert, "-----BEGIN FAKE CERT-----\ncert-bytes-fixture\n-----END FAKE CERT-----\n");
  return { dir, key, cert };
}

const config = await load("source/electron-main/box/library-docker-config.ts");
const connector = await load("source/electron-main/box/local-docker-host-connector.ts");

const BASE_FIXTURE = {
  token: "fixture-token-0123456789abcdef",
  hostBundle: {
    path: "/fixture/host-main.cjs",
    sha256: "a".repeat(64),
    boxExecDaemonPath: "/fixture/box-exec-daemon/main.cjs",
    boxExecDaemonSha256: "b".repeat(64),
  },
  authMounts: [],
};

test("unconfigured env resolves null and renders byte-identical run args", () => {
  assert.equal(config.resolveLibraryDockerForwarding({}), null);
  const args = connector.buildLocalDockerBoxRunArgs({ ...BASE_FIXTURE, library: null });
  // +4: SCREEN_WIDTH/SCREEN_HEIGHT env (port/0712 P2-8)
  // +2: SAND_BOX_HOST_BUNDLE_ROOT env (the in-box host bundle root is
  // declared once and travels into the container, so the shell and the
  // running host cannot disagree about where the bundle lives).
  assert.equal(args.length, 59);
  assert.equal(sha256(JSON.stringify(args)), "f8466f88108fa610e2fb504f5ed9382c2d27f2b72de0cc1f8cba7472595641b3");
  assert.ok(!JSON.stringify(args).includes("SAND_LIBRARY_"), "no library env leaks into unconfigured runs");
});

test("configured fixture renders readonly mounts, internal env, and loopback publish", () => {
  const { dir, key, cert } = fixtureFiles();
  try {
    const forwarding = config.resolveLibraryDockerForwarding({
      SAND_LIBRARY_ORIGIN: "https://127.0.0.1:8443",
      SAND_LIBRARY_TLS_KEY_FILE: key,
      SAND_LIBRARY_TLS_CERT_FILE: cert,
    });
    assert.deepEqual(forwarding, { origin: "https://127.0.0.1:8443", port: 8443, keyFile: realpathSync(key), certFile: realpathSync(cert) });
    const args = config.libraryDockerForwardingArgs(forwarding);
    assert.equal(args.length, 16);
    assert.ok(args.includes("type=bind,src=" + forwarding.keyFile + ",dst=/home/box/library-tls/key.pem,readonly"));
    assert.ok(args.includes("type=bind,src=" + forwarding.certFile + ",dst=/home/box/library-tls/cert.pem,readonly"));
    assert.ok(args.includes("SAND_LIBRARY_ORIGIN=https://127.0.0.1:8443"));
    assert.ok(args.includes("SAND_LIBRARY_TLS_KEY_FILE=/home/box/library-tls/key.pem"));
    assert.ok(args.includes("SAND_LIBRARY_TLS_CERT_FILE=/home/box/library-tls/cert.pem"));
    assert.ok(args.includes("SAND_LIBRARY_LISTEN_HOST=0.0.0.0"));
    assert.ok(args.includes("SAND_LIBRARY_INTERNAL_CONTAINER=1"));
    assert.ok(args.includes("127.0.0.1:8443:8443"));
    assert.ok(!args.includes("SAND_LIBRARY_PUBLIC_OK=1"), "container must not claim public exposure");
    const rendered = JSON.stringify(args);
    assert.ok(!rendered.includes("key-bytes-fixture") && !rendered.includes("cert-bytes-fixture"), "secret bytes never enter args");
    const runArgs = connector.buildLocalDockerBoxRunArgs({ ...BASE_FIXTURE, library: forwarding });
    assert.equal(runArgs.length, 59 + 16);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const origin of ["https://[::1]:18443", "https://[0:0:0:0:0:0:0:1]:18443", "https://[::ffff:127.0.0.1]:18443", "https://[2001:db8::1]:18443"]) {
  test(`IPv6 origin ${origin} is rejected with an IPv4 configuration remedy`, () => {
    const { dir, key, cert } = fixtureFiles();
    try {
      assert.throws(() => config.resolveLibraryDockerForwarding({
        SAND_LIBRARY_ORIGIN: origin,
        SAND_LIBRARY_TLS_KEY_FILE: key,
        SAND_LIBRARY_TLS_CERT_FILE: cert,
      }), /IPv6.*SAND_LIBRARY_ORIGIN=https:\/\/127\.0\.0\.1:<port>/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("reserved published host ports are rejected", () => {
  const { dir, key, cert } = fixtureFiles();
  try {
    for (const port of [1337, 1339, 1340, 6080, 6081, 8790]) {
      assert.throws(
        () => config.resolveLibraryDockerForwarding({
          SAND_LIBRARY_ORIGIN: `https://127.0.0.1:${port}`,
          SAND_LIBRARY_TLS_KEY_FILE: key,
          SAND_LIBRARY_TLS_CERT_FILE: cert,
        }),
        /already published/,
        `port ${port} must be rejected`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("partial or unreadable configuration fails closed", () => {
  const { dir, key, cert } = fixtureFiles();
  try {
    assert.throws(() => config.resolveLibraryDockerForwarding({ SAND_LIBRARY_ORIGIN: "https://127.0.0.1:8443" }), /TLS/);
    assert.throws(() => config.resolveLibraryDockerForwarding({ SAND_LIBRARY_TLS_KEY_FILE: key }), /ORIGIN/);
    assert.throws(() => config.resolveLibraryDockerForwarding({
      SAND_LIBRARY_ORIGIN: "http://127.0.0.1:8443",
      SAND_LIBRARY_TLS_KEY_FILE: key,
      SAND_LIBRARY_TLS_CERT_FILE: cert,
    }), /HTTPS/);
    assert.throws(() => config.resolveLibraryDockerForwarding({
      SAND_LIBRARY_ORIGIN: "https://127.0.0.1",
      SAND_LIBRARY_TLS_KEY_FILE: key,
      SAND_LIBRARY_TLS_CERT_FILE: cert,
    }), /explicit port/);
    assert.throws(() => config.resolveLibraryDockerForwarding({
      SAND_LIBRARY_ORIGIN: "https://127.0.0.1:8443",
      SAND_LIBRARY_TLS_KEY_FILE: path.join(dir, "missing.pem"),
      SAND_LIBRARY_TLS_CERT_FILE: cert,
    }), /readable file/);
    assert.throws(() => config.resolveLibraryDockerForwarding({
      SAND_LIBRARY_ORIGIN: "https://127.0.0.1:8443",
      SAND_LIBRARY_TLS_KEY_FILE: "relative/key.pem",
      SAND_LIBRARY_TLS_CERT_FILE: cert,
    }), /absolute path/);
    assert.throws(() => config.resolveLibraryDockerForwarding({
      SAND_LIBRARY_ORIGIN: "https://127.0.0.1:8443",
      SAND_LIBRARY_TLS_KEY_FILE: key + ",readonly",
      SAND_LIBRARY_TLS_CERT_FILE: cert,
    }), /rejected mount-argument/);
    assert.throws(() => config.resolveLibraryDockerForwarding({
      SAND_LIBRARY_ORIGIN: "https://127.0.0.1:8443",
      SAND_LIBRARY_TLS_KEY_FILE: key,
      SAND_LIBRARY_TLS_CERT_FILE: key,
    }), /different files/);
    assert.throws(() => config.resolveLibraryDockerForwarding({
      SAND_LIBRARY_ORIGIN: "https://example.com:8443",
      SAND_LIBRARY_TLS_KEY_FILE: key,
      SAND_LIBRARY_TLS_CERT_FILE: cert,
    }), /not loopback/);
    assert.throws(() => config.resolveLibraryDockerForwarding({
      SAND_LIBRARY_ORIGIN: "https://127.0.0.1:8443",
      SAND_LIBRARY_TLS_KEY_FILE: dir,
      SAND_LIBRARY_TLS_CERT_FILE: cert,
    }), /regular file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("operator symlinks resolving to regular files are accepted", () => {
  const { dir, key, cert } = fixtureFiles();
  try {
    const link = path.join(dir, "key-link.pem");
    symlinkSync(key, link);
    const forwarding = config.resolveLibraryDockerForwarding({
      SAND_LIBRARY_ORIGIN: "https://127.0.0.1:8443",
      SAND_LIBRARY_TLS_KEY_FILE: link,
      SAND_LIBRARY_TLS_CERT_FILE: cert,
    });
    assert.equal(forwarding.keyFile, realpathSync(key));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("internal container flag only admits the 0.0.0.0 bind", async () => {
  const server = await load("source/host/extensions/library/http-server.ts");
  const { dir, key, cert } = fixtureFiles();
  const saved = { ...process.env };
  try {
    process.env.SAND_LIBRARY_ORIGIN = "https://127.0.0.1:8443";
    process.env.SAND_LIBRARY_TLS_KEY_FILE = key;
    process.env.SAND_LIBRARY_TLS_CERT_FILE = cert;
    process.env.SAND_LIBRARY_LISTEN_HOST = "0.0.0.0";
    process.env.SAND_LIBRARY_INTERNAL_CONTAINER = "1";
    delete process.env.SAND_LIBRARY_PUBLIC_OK;
    const accepted = server.resolveLibraryHttpConfigFromEnv("https://127.0.0.1:8443");
    assert.equal(accepted.host, "0.0.0.0");
    assert.equal(accepted.port, 8443);
    process.env.SAND_LIBRARY_LISTEN_HOST = "192.168.1.5";
    assert.throws(() => server.resolveLibraryHttpConfigFromEnv("https://127.0.0.1:8443"), /PUBLIC_OK/);
  } finally {
    process.env = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
