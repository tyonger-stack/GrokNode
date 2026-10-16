import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "library-http-")));
const run = (command, args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) rejectPromise(new Error(`${command} failed: ${stderr || error.message}`));
      else resolvePromise(stdout);
    });
  });

const freePort = () =>
  new Promise((resolvePromise, rejectPromise) => {
    const probe = net.createServer();
    probe.once("error", rejectPromise);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close((error) => (error ? rejectPromise(error) : resolvePromise(port)));
    });
  });

await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", "ca-key.pem", "-out", "ca-cert.pem", "-days", "2", "-nodes", "-subj", "/CN=grok-node-library-test-ca"], { cwd: tmp });
await run("openssl", ["req", "-newkey", "rsa:2048", "-keyout", "server-key.pem", "-out", "server.csr", "-nodes", "-subj", "/CN=127.0.0.1"], { cwd: tmp });
writeFileSync(path.join(tmp, "san.ext"), "subjectAltName=IP:127.0.0.1,DNS:localhost\n");
await run("openssl", ["x509", "-req", "-in", "server.csr", "-CA", "ca-cert.pem", "-CAkey", "ca-key.pem", "-CAcreateserial", "-out", "server-cert.pem", "-days", "2", "-extfile", "san.ext"], { cwd: tmp });
const ca = readFileSync(path.join(tmp, "ca-cert.pem"), "utf8");
const tls = { key: readFileSync(path.join(tmp, "server-key.pem")), cert: readFileSync(path.join(tmp, "server-cert.pem")) };
const port = await freePort();
assert.ok(port > 0);
const origin = `https://127.0.0.1:${port}`;
mkdirSync(path.join(root, "node_modules", ".cache"), { recursive: true });
const cacheDir = realpathSync(mkdtempSync(path.join(root, "node_modules", ".cache", "library-http-")));

await build({
  stdin: {
    contents: [
      `export * from ${JSON.stringify(path.join(root, "source", "host", "extensions", "library", "extension.ts"))};`,
      `export * from ${JSON.stringify(path.join(root, "source", "host", "extensions", "library", "http-server.ts"))};`,
      `export * from ${JSON.stringify(path.join(root, "source", "host", "extensions", "library", "http-routes.ts"))};`,
      `export * from ${JSON.stringify(path.join(root, "source", "host", "extensions", "library", "http-markdown.ts"))};`,
    ].join("\n"),
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["undici"],
  outfile: path.join(cacheDir, "library-http-bundle.mjs"),
  logLevel: "error",
});
const lib = await import(pathToFileURL(path.join(cacheDir, "library-http-bundle.mjs")).href);

const signal = () => AbortSignal.timeout(10000);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const SOURCE = "# Real Title\n\nBody with ![pic](asset:pic.png)\n";
const BUNDLE_JSON = JSON.stringify({ version: 1, runtimeEsm: "export function mountCanvas() {}", userModule: "export const value = 1;" });
const DATA_JSON = JSON.stringify({ hello: 1 });

let service = lib.createLibraryHostService({ dataRoot: path.join(tmp, "data"), providerOrigin: origin });
const ownerCredential = service.mainCredential();
const owner = service.catalog.identity.resolveCredential(ownerCredential, signal()).principal;
const member = service.catalog.identity.createLocalPrincipal(owner.accountId);
const outsider = service.catalog.identity.createLocalPrincipal(owner.accountId);
service.catalog.identity.assignTeam({ ...owner, teamId: "team-local" }, true);
service.catalog.identity.assignTeam({ ...member, teamId: "team-local" }, true);
const storeId = `node-store:${randomUUID()}`;
service.catalog.identity.registerStore({ accountId: owner.accountId, principalId: owner.principalId, storeId, teamId: "team-local" });
service.catalog.identity.assignAgent({ ...owner, agentId: "bot" }, true);
const docStore = encodeURIComponent(storeId);
const publishedDoc = await service.publishNativeArtifact({
  input: { kind: "document", source: SOURCE, assets: [{ name: "pic.png", bytes: PNG }] },
  execution: { credential: ownerCredential, agentId: "bot", storeId, toolCallId: "t1", idempotencyKey: "doc-1" },
}, signal());
assert.equal(publishedDoc.url, `${origin}/documents/${docStore}/${publishedDoc.identity.ref.documentId}`);
const documentId = publishedDoc.identity.ref.documentId;
const publishedCanvas = await service.publishNativeArtifact({
  input: { kind: "canvas", title: "Real Canvas", renderBundleGzip: gzipSync(Buffer.from(BUNDLE_JSON, "utf8")), dataJson: Buffer.from(DATA_JSON, "utf8") },
  execution: { credential: ownerCredential, agentId: "bot", storeId, toolCallId: "t2", idempotencyKey: "canvas-1" },
}, signal());
assert.equal(publishedCanvas.url, `${origin}/canvas/${docStore}/${publishedCanvas.identity.ref.canvasId}`);
const canvasId = publishedCanvas.identity.ref.canvasId;
const docPath = `/documents/${docStore}/${documentId}`;
const canvasPath = `/canvas/${docStore}/${canvasId}`;
const sourceHash = createHash("sha256").update(SOURCE, "utf8").digest("hex");
const pngHash = createHash("sha256").update(PNG).digest("hex");

let receiver = await lib.startLibraryHttpServer({ service, providerOrigin: origin, host: "127.0.0.1", port, tls });
assert.equal(receiver.origin, origin);

test.after(async () => {
  await receiver.close().catch(() => undefined);
  try {
    service.dispose();
  } catch {
    // Already disposed by the restart path.
  }
  rmSync(cacheDir, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
  assert.equal(existsSync(cacheDir), false);
  assert.equal(existsSync(tmp), false);
});

function call({ method = "GET", target, cookie = null, body = null, headers = {} }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = https.request(
      { host: "127.0.0.1", port, path: target, method, ca, headers: { connection: "close", ...(cookie === null ? {} : { cookie }), ...headers } },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolvePromise({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
        response.on("error", rejectPromise);
      },
    );
    request.on("error", rejectPromise);
    if (body !== null) request.write(body);
    request.end();
  });
}

async function sessionFor(credential) {
  const response = await call({ method: "POST", target: "/session", body: JSON.stringify({ credential }), headers: { "content-type": "application/json" } });
  assert.equal(response.status, 200);
  const setCookie = response.headers["set-cookie"] ?? [];
  assert.ok(setCookie.length > 0 && (setCookie[0] ?? "").includes("__Host-library_session="));
  assert.ok((setCookie[0] ?? "").includes("Secure") && (setCookie[0] ?? "").includes("HttpOnly"));
  return (setCookie[0] ?? "").split(";")[0] ?? "";
}

const ownerCookie = await sessionFor(ownerCredential);
const memberCookie = await sessionFor(member.credential);
const outsiderCookie = await sessionFor(outsider.credential);
const textOf = (response) => response.body.toString("utf8");

test("unauthenticated and forged sessions cannot read", async () => {
  assert.equal((await call({ target: docPath })).status, 401);
  assert.equal((await call({ target: docPath, cookie: "__Host-library_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).status, 401);
  const bad = await call({ method: "POST", target: "/session", body: JSON.stringify({ credential: "bogus" }), headers: { "content-type": "application/json" } });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers["set-cookie"], undefined);
});

test("owner reads the real document page and raw source with stable hashes", async () => {
  const page = await call({ target: docPath, cookie: ownerCookie });
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"] ?? "", /text\/html/);
  const html = textOf(page);
  assert.ok(html.includes("Real Title") && html.includes("Body with") && html.includes(`${origin}/documents/`));
  assert.ok(html.includes(`${origin}/documents/${docStore}/${documentId}/assets/pic.png`));
  assert.ok(!html.includes(ownerCredential) && !html.includes(ownerCookie));
  const raw = await call({ target: `${docPath}/raw`, cookie: ownerCookie });
  assert.equal(raw.status, 200);
  assert.equal(textOf(raw), SOURCE);
  assert.equal(raw.headers.etag, `"${sourceHash}"`);
  const cached = await call({ target: `${docPath}/raw`, cookie: ownerCookie, headers: { "if-none-match": `"${sourceHash}"` } });
  assert.equal(cached.status, 304);
});

test("private to team to private reauthorizes every requester", async () => {
  assert.equal((await call({ target: docPath, cookie: memberCookie })).status, 404);
  assert.equal((await call({ target: docPath, cookie: outsiderCookie })).status, 404);
  assert.equal((await call({ target: canvasPath, cookie: memberCookie })).status, 404);
  await service.setDocumentVisibility({ locator: { storeId, documentId }, visibility: "team-view", credential: ownerCredential }, signal());
  await service.setCanvasVisibility({ locator: { kind: "store", storeId, canvasId }, visibility: "team-view", credential: ownerCredential }, signal());
  assert.equal((await call({ target: docPath, cookie: memberCookie })).status, 200);
  assert.equal(textOf(await call({ target: `${docPath}/raw`, cookie: memberCookie })), SOURCE);
  assert.equal((await call({ target: docPath, cookie: outsiderCookie })).status, 404);
  const canvasPage = await call({ target: canvasPath, cookie: memberCookie });
  assert.equal(canvasPage.status, 200);
  assert.ok(textOf(canvasPage).includes("mountCanvas"));
  const payload = await call({ target: `${canvasPath}/payload`, cookie: memberCookie });
  assert.equal(payload.status, 200);
  const parsed = JSON.parse(textOf(payload));
  assert.equal(parsed.dataJsonText, DATA_JSON);
  assert.ok(String(parsed.bundleJsonText).includes("mountCanvas"));
  assert.equal(parsed.share.visibility, "team-view");
  assert.ok(!textOf(payload).includes(member.credential));
  await service.setDocumentVisibility({ locator: { storeId, documentId }, visibility: "private", credential: ownerCredential }, signal());
  await service.setCanvasVisibility({ locator: { kind: "store", storeId, canvasId }, visibility: "private", credential: ownerCredential }, signal());
  assert.equal((await call({ target: docPath, cookie: memberCookie })).status, 404);
  assert.equal((await call({ target: canvasPath, cookie: memberCookie })).status, 404);
  assert.equal((await call({ target: docPath, cookie: ownerCookie })).status, 200);
});

test("assets serve authorized bytes with etag reuse", async () => {
  await service.setDocumentVisibility({ locator: { storeId, documentId }, visibility: "team-view", credential: ownerCredential }, signal());
  try {
    const asset = await call({ target: `${docPath}/assets/pic.png`, cookie: memberCookie });
    assert.equal(asset.status, 200);
    assert.match(asset.headers["content-type"] ?? "", /image\/png/);
    assert.equal(createHash("sha256").update(asset.body).digest("hex"), pngHash);
    assert.ok((asset.headers.etag ?? "").length > 0);
    const cached = await call({ target: `${docPath}/assets/pic.png`, cookie: memberCookie, headers: { "if-none-match": asset.headers.etag ?? "" } });
    assert.equal(cached.status, 304);
    assert.equal((await call({ target: `${docPath}/assets/pic.png`, cookie: outsiderCookie })).status, 404);
    assert.equal((await call({ target: `${docPath}/assets/nope.png`, cookie: memberCookie })).status, 404);
  } finally {
    await service.setDocumentVisibility({ locator: { storeId, documentId }, visibility: "private", credential: ownerCredential }, signal());
  }
});

test("malformed paths and methods fail without catalog access", async () => {
  const bad = [
    "/documents/../canvas/x",
    "/documents/a/b/c",
    `/documents/${docStore}/UPPER`,
    `/canvas/${docStore}/not-a-uuid`,
    `${docPath}?rev=1`,
    `${docPath}/raw?rev=1`,
    "/nope",
    "/documents",
    `/documents/${docStore}/${documentId}/assets/../pic.png`,
  ];
  for (const target of bad) assert.equal((await call({ target, cookie: ownerCookie })).status, 404, target);
  assert.equal((await call({ method: "POST", target: docPath, cookie: ownerCookie })).status, 405);
  assert.equal((await call({ method: "DELETE", target: docPath, cookie: ownerCookie })).status, 405);
});

test("logout destroys the session and restart keeps content with fresh sessions", async () => {
  const gone = await call({ method: "DELETE", target: "/session", cookie: memberCookie });
  assert.equal(gone.status, 200);
  assert.equal((await call({ target: docPath, cookie: memberCookie })).status, 401);
  await receiver.close();
  service.dispose();
  service = lib.createLibraryHostService({ dataRoot: path.join(tmp, "data"), providerOrigin: origin });
  receiver = await lib.startLibraryHttpServer({ service, providerOrigin: origin, host: "127.0.0.1", port, tls });
  assert.equal((await call({ target: docPath, cookie: ownerCookie })).status, 401);
  const fresh = await sessionFor(ownerCredential);
  const page = await call({ target: docPath, cookie: fresh });
  assert.equal(page.status, 200);
  assert.ok(textOf(page).includes("Real Title"));
  const raw = await call({ target: `${docPath}/raw`, cookie: fresh });
  assert.equal(raw.headers.etag, `"${sourceHash}"`);
});

test("titled asset refs render images and link URLs escape exactly once", () => {
  const base = "https://127.0.0.1:9/documents/s/d/assets";
  const titled = lib.renderMarkdownBody('See ![pic](asset:pic.png "caption") end.\n', ["pic.png"], base);
  assert.ok(titled.includes(`${base}/pic.png`));
  assert.ok(!titled.includes("asset:pic.png"));
  const plain = lib.renderMarkdownBody("See ![pic](pic.png) end.\n", ["pic.png"], base);
  assert.ok(!plain.includes("<img"));
  const linked = lib.renderMarkdownBody("[link](https://example.test/?a=1&b=2)\n", [], base);
  assert.ok(linked.includes('href="https://example.test/?a=1&amp;b=2"'));
  assert.ok(!linked.includes("&amp;amp;"));
});

test("receiver config boundaries fail closed", () => {
  const saved = { ...process.env };
  try {
    delete process.env.SAND_LIBRARY_ORIGIN;
    delete process.env.SAND_LIBRARY_TLS_KEY_FILE;
    delete process.env.SAND_LIBRARY_TLS_CERT_FILE;
    delete process.env.SAND_LIBRARY_LISTEN_HOST;
    delete process.env.SAND_LIBRARY_INTERNAL_CONTAINER;
    delete process.env.SAND_LIBRARY_PUBLIC_OK;
    assert.equal(lib.resolveLibraryHttpConfigFromEnv(origin), null);
    process.env.SAND_LIBRARY_ORIGIN = origin;
    assert.throws(() => lib.resolveLibraryHttpConfigFromEnv(origin), /TLS/);
    process.env.SAND_LIBRARY_TLS_KEY_FILE = path.join(tmp, "server-key.pem");
    process.env.SAND_LIBRARY_TLS_CERT_FILE = path.join(tmp, "server-cert.pem");
    process.env.SAND_LIBRARY_LISTEN_HOST = "0.0.0.0";
    assert.throws(() => lib.resolveLibraryHttpConfigFromEnv(origin), /PUBLIC_OK/);
    process.env.SAND_LIBRARY_INTERNAL_CONTAINER = "1";
    const internal = lib.resolveLibraryHttpConfigFromEnv(origin);
    assert.equal(internal.host, "0.0.0.0");
    assert.equal(internal.port, port);
    process.env.SAND_LIBRARY_ORIGIN = `https://[::1]:${port}`;
    assert.throws(() => lib.resolveLibraryHttpConfigFromEnv(`https://[::1]:${port}`), /IPv6/);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
