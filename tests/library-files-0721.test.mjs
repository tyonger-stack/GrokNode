import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidence = process.env.LIBRARY_FILES_EVIDENCE;
const target = evidence ? path.resolve(evidence) : path.join(repo, "node_modules/.cache");
mkdirSync(target, { recursive: true });
const base = realpathSync(target);
const run = mkdtempSync(path.join(base, "library-files-"));
const bundle = path.join(run, "module.mjs");
await build({ stdin: { contents: `export * from './source/host/extensions/library/library-files.ts';
  export {LibraryCatalog} from './source/host/extensions/library/catalog.ts';
  export {createContext} from './source/packages/context/core.ts';`, resolveDir: repo },
  outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node26", packages: "external", logLevel: "silent" });
const api = await import(pathToFileURL(bundle).href);
const outcomes = [];
test.after(() => {
  if (evidence) writeFileSync(path.join(run, "results.json"), JSON.stringify(outcomes, null, 2));
  else rmSync(run, { recursive: true, force: true });
});
function record(scenario, value) {
  outcomes.push({ scenario, passed: true, ...value });
}
function fixture(t, scenario, maxFileBytes = 1024 * 1024) {
  const directory = path.join(run, scenario);
  const dataRoot = path.join(directory, "data");
  const sourceRoot = path.join(directory, "box");
  mkdirSync(sourceRoot, { recursive: true, mode: 0o700 });
  const baseOptions = { dataRoot, sourceRoot, providerOrigin: "https://groknode.local", maxFileBytes };
  const catalog = new api.LibraryCatalog(baseOptions);
  const options = { ...baseOptions, catalog };
  const owner = catalog.identity.createLocalPrincipal("account-a");
  const peer = catalog.identity.createLocalPrincipal("account-a");
  const stranger = catalog.identity.createLocalPrincipal("account-b");
  const agentId = "agent-a", storeId = "store-a";
  catalog.identity.registerStore({ ...owner, storeId, teamId: null });
  for (const member of [owner, peer, stranger]) catalog.identity.assignAgent({ ...member, agentId }, true);
  const binding = { credential: owner.credential, agentId, storeId };
  const signal = new AbortController().signal;
  let service = api.createLibraryFilesService(options);
  t.after(() => { service.close(); catalog.close(); });
  const policy = { defaultScope: "bot", privateScopeOffered: false };
  return {
    options, directory, catalog, owner, peer, stranger, binding, signal,
    get service() { return service; },
    port(p = policy) { return service.forExecution(binding, p); },
    source(name, bytes = Buffer.from([0, 255, 254, 128, 10, 0, 65])) {
      const file = path.join(sourceRoot, name);
      writeFileSync(file, bytes, { mode: 0o600 });
      return file;
    },
    save(sourcePath, extra = {}, p = policy) {
      return service.forExecution(binding, p).save({ signal }, { sourcePath, scope: "bot", replace: false, ...extra });
    },
    list(scope = "bot", b = binding) { return service.list(b, scope, signal); },
    read(name, scope = "bot", b = binding) { return service.read(b, scope, name, signal); },
    restart() { service.close(); service = api.createLibraryFilesService(options); },
  };
}
async function invoke(port, args) {
  const tool = api.createSaveToLibraryTool(port);
  const calls = [];
  const result = await tool.execute(api.createContext(), {
    async executeToolCall(ctx, initial, id, execute, complete) {
      const result = await execute(ctx);
      calls.push({ id, initial: initial.toJson(), completed: complete(result).toJson() });
      return result;
    },
  }, (async function* () { yield JSON.stringify(args); })(), { toolCallId: "save-file-call" });
  return { result: result.toJson(), calls };
}

test("SaveToLibrary stores arbitrary binary bytes and empty files, reopens after restart", async t => {
  const f = fixture(t, "binary-restart");
  const binary = Buffer.from(Array.from({ length: 65537 }, (_, i) => i % 256));
  const source = f.source("report.xlsx", binary);
  const response = await invoke(f.port(), { path: source });
  assert.equal(response.result.success.currentStep, 'Saved "report.xlsx" (65537 bytes) in the bot\'s shared Library.');
  assert.equal(response.calls.length, 1);
  const file = f.list()[0];
  assert.equal(file.sha256, createHash("sha256").update(binary).digest("hex"));
  f.restart();
  assert.deepEqual(Buffer.from(f.read("report.xlsx").bytes), binary);
  assert.deepEqual(f.list(), [file]);
  await f.save(f.source("empty", Buffer.alloc(0)));
  assert.equal(f.read("empty").bytes.length, 0);
  record("binary-restart", { response, file, dataRoot: f.options.dataRoot });
});

test("collisions allocate flat names and replace updates only the exact name", async t => {
  const f = fixture(t, "names-replace");
  const source = f.source("archive.tar.gz");
  await f.save(source);
  const second = await f.save(source);
  assert.equal(second.name, "archive.tar (2).gz");
  await f.save(source);
  const original = f.read("archive.tar.gz").file;
  const secondOriginal = f.read(second.name).file;
  f.source("archive.tar.gz", Buffer.from("replacement"));
  const replacement = await invoke(f.port(), { path: source, replace: true });
  assert.equal(replacement.result.success.currentStep, 'Replaced "archive.tar.gz" (11 bytes) in the bot\'s shared Library.');
  assert.equal(f.list().length, 3);
  const replaced = f.read("archive.tar.gz");
  assert.equal(replaced.file.id, original.id);
  assert.equal(replaced.file.revision, 2);
  assert.equal(replaced.file.createdAtMs, original.createdAtMs);
  assert.equal(Buffer.from(replaced.bytes).toString(), "replacement");
  assert.deepEqual(f.read(second.name).file, secondOriginal);
  const absent = await f.save(source, { name: "new-name", replace: true });
  assert.equal(absent.replaced, false);
  assert.equal(absent.name, "new-name");
  record("names-replace", { replacement, files: f.list(), dataRoot: f.options.dataRoot });
});

test("two processes allocate distinct names without lost updates", async t => {
  const f = fixture(t, "concurrent-connections");
  const sourcePath = f.source("same.pdf");
  const worker = `const {module,options,binding,sourcePath}=JSON.parse(process.argv[1]);
    const {createLibraryFilesService,LibraryCatalog}=await import(module);
    const catalog=new LibraryCatalog(options);
    const service=createLibraryFilesService({...options,catalog});
    try {
      const port=service.forExecution(binding,{defaultScope:'bot',privateScopeOffered:false});
      const results=[];
      for(let i=0;i<6;i++) results.push(await port.save({signal:new AbortController().signal},
        {sourcePath,scope:'bot',replace:false}));
      console.log(JSON.stringify(results));
    } finally { service.close(); catalog.close(); }`;
  const { catalog: _live, ...serializable } = f.options;
  const args = ["--input-type=module", "-e", worker, JSON.stringify({ module: pathToFileURL(bundle).href,
    options: serializable, binding: f.binding, sourcePath })];
  const processes = await Promise.all([promisify(execFile)(process.execPath, args), promisify(execFile)(process.execPath, args)]);
  const results = processes.flatMap(result => JSON.parse(result.stdout));
  assert.equal(new Set(results.map(r => r.name)).size, 12);
  assert.equal(f.list().length, 12);
  record("concurrent-connections", { processes, results, dataRoot: f.options.dataRoot });
});

test("private default requires approval and commits the approved bytes", async t => {
  const f = fixture(t, "private-approval");
  const source = f.source("personal.bin");
  const original = readFileSync(source);
  const requests = [];
  const policy = { defaultScope: "private", privateScopeOffered: true, async approvePrivate(request) {
    requests.push({ name: request.name, sha256: request.sha256, sizeBytes: request.sizeBytes,
      principalId: request.context.principal.principalId, replace: request.replace });
    assert.deepEqual(f.list("private"), []);
    writeFileSync(source, "different bytes after approval was requested");
    return { kind: "approved" };
  } };
  const response = await invoke(f.port(policy), { path: source });
  assert.match(response.result.success.currentStep, /the user's private Library/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].sha256, createHash("sha256").update(original).digest("hex"));
  assert.deepEqual(Buffer.from(f.read("personal.bin", "private").bytes), original);
  assert.deepEqual(f.list(), []);
  f.restart();
  assert.deepEqual(Buffer.from(f.read("personal.bin", "private").bytes), original);
  assert.throws(() => f.list("private", { ...f.binding, credential: f.peer.credential }), /Store owner required/);
  record("private-approval", { requests, response, files: f.list("private"), dataRoot: f.options.dataRoot });
});

test("private denial, unavailable scope, cancellation and revoked membership never save", async t => {
  const f = fixture(t, "private-refusals");
  const source = f.source("secret.bin");
  const denied = await invoke(f.port({ defaultScope: "private", privateScopeOffered: true,
    approvePrivate: async () => ({ kind: "refused", message: "User declined" }) }), { path: source });
  assert.equal(denied.result.success.currentStep, "Not saved: User declined");
  const unavailable = await invoke(f.port({ defaultScope: "private", privateScopeOffered: false }), { path: source });
  assert.match(unavailable.result.success.currentStep, /^Not saved: no one's private files/);
  assert.deepEqual(f.list("private"), []);
  assert.deepEqual(f.list(), []);
  const abort = new AbortController();
  await assert.rejects(f.port({ defaultScope: "private", privateScopeOffered: true, approvePrivate: async () => {
    abort.abort(new Error("approval cancelled")); return { kind: "approved" };
  } }).save({ signal: abort.signal }, { sourcePath: source, scope: "private", replace: false }), /approval cancelled/);
  await assert.rejects(f.save(source, { scope: "private" }, { defaultScope: "private", privateScopeOffered: true,
    approvePrivate: async () => {
      f.catalog.identity.assignAgent({ ...f.owner, agentId: f.binding.agentId }, false);
      return { kind: "approved" };
    } }), /Agent membership required/);
  f.catalog.identity.assignAgent({ ...f.owner, agentId: f.binding.agentId }, true);
  assert.deepEqual(f.list("private"), []);
  record("private-refusals", { denied, unavailable, files: f.list("private"), dataRoot: f.options.dataRoot });
});

test("membership, credential, account and owner boundaries protect file operations", async t => {
  const f = fixture(t, "ownership");
  const source = f.source("owned.bin");
  await f.save(source);
  const peer = { ...f.binding, credential: f.peer.credential };
  assert.deepEqual(Buffer.from(f.read("owned.bin", "bot", peer).bytes), readFileSync(source));
  for (const binding of [{ ...f.binding, credential: "forged" }, { ...f.binding, credential: f.stranger.credential },
    { ...f.binding, agentId: "not-enrolled" }, { ...f.binding, storeId: "missing-store" }]) {
    assert.throws(() => f.list("bot", binding));
    assert.throws(() => f.read("owned.bin", "bot", binding));
    assert.throws(() => f.service.remove(binding, "bot", "owned.bin", f.signal));
    await assert.rejects(f.service.forExecution(binding, { defaultScope: "bot", privateScopeOffered: false })
      .save({ signal: f.signal }, { sourcePath: source, scope: "bot", replace: true }));
  }
  assert.throws(() => f.service.remove(peer, "bot", "owned.bin", f.signal), /Store owner required/);
  f.catalog.identity.assignAgent({ ...f.peer, agentId: f.binding.agentId }, false);
  assert.throws(() => f.read("owned.bin", "bot", peer), /Agent membership required/);
  assert.equal(f.list().length, 1);
  record("ownership", { file: f.list()[0], rejectedBindings: 4, dataRoot: f.options.dataRoot });
});

test("traversal, outside roots, symlinks, hard links, directories and oversized files are refused", async t => {
  const f = fixture(t, "safe-paths", 16);
  const source = f.source("safe.bin");
  const outside = path.join(f.directory, "outside.bin");
  writeFileSync(outside, "outside");
  const symlink = path.join(f.options.sourceRoot, "symlink");
  symlinkSync(source, symlink);
  const symlinkDir = path.join(f.options.sourceRoot, "directory-link");
  symlinkSync(f.options.sourceRoot, symlinkDir);
  const hardlink = path.join(f.options.sourceRoot, "hardlink");
  const linked = f.source("linked.bin");
  linkSync(linked, hardlink);
  const cases = ["relative.bin", outside, `${f.options.sourceRoot}/../box/safe.bin`, symlink,
    path.join(symlinkDir, "safe.bin"), hardlink, f.options.sourceRoot, f.source("large", Buffer.alloc(17)),
    path.join(f.options.sourceRoot, "missing")];
  for (const sourcePath of cases) await assert.rejects(f.save(sourcePath));
  for (const name of ["../escape", "/absolute", "a/b", "a\\b", ".", "..", "nul\0name", " "]) {
    await assert.rejects(f.save(source, { name }));
  }
  assert.deepEqual(f.list(), []);
  const response = await invoke(f.port(), { path: outside });
  assert.match(response.result.error.error, /outside the trusted box root/);
  const destination = path.join(f.options.dataRoot, "library/files");
  symlinkSync(f.options.sourceRoot, destination);
  await assert.rejects(f.save(source), /symlink/);
  assert.deepEqual(f.list(), []);
  rmSync(destination);
  record("safe-paths", { rejectedSourceCases: cases.length, rejectedNameCases: 8, response, dataRoot: f.options.dataRoot });
});

test("stored hash tampering and unsafe content modes fail closed, deletion persists", async t => {
  const f = fixture(t, "hash-delete");
  await f.save(f.source("tamper.bin"));
  const file = f.list()[0];
  const blob = path.join(f.options.dataRoot, "library/files", file.id, file.sha256);
  const bytes = readFileSync(blob);
  chmodSync(blob, 0o644);
  assert.throws(() => f.read(file.name), /Unsafe Library file/);
  chmodSync(blob, 0o600);
  writeFileSync(blob, Buffer.alloc(bytes.length, 42));
  assert.throws(() => f.read(file.name), /Content hash mismatch/);
  writeFileSync(blob, bytes);
  const secondLink = path.join(f.directory, "blob-link");
  linkSync(blob, secondLink);
  assert.throws(() => f.read(file.name), /Unsafe Library file/);
  rmSync(secondLink);
  const moved = path.join(f.directory, "blob-copy");
  writeFileSync(moved, bytes, { mode: 0o600 });
  rmSync(blob);
  symlinkSync(moved, blob);
  assert.throws(() => f.read(file.name), /symlink/);
  rmSync(blob);
  writeFileSync(blob, bytes, { mode: 0o600 });
  assert.equal(f.service.remove(f.binding, "bot", file.name, f.signal), true);
  assert.equal(f.service.remove(f.binding, "bot", file.name, f.signal), false);
  f.restart();
  assert.equal(f.read(file.name), null);
  assert.deepEqual(f.list(), []);
  record("hash-delete", { removed: file, files: f.list(), dataRoot: f.options.dataRoot });
});

test("a failed replacement preserves the committed file and tool reports an error", async t => {
  const f = fixture(t, "failed-replace");
  const source = f.source("stable.bin");
  const originalBytes = readFileSync(source);
  await f.save(source);
  const original = f.list()[0];
  const filesRoot = path.join(f.options.dataRoot, "library/files");
  chmodSync(filesRoot, 0o755);
  writeFileSync(source, "replacement");
  const response = await invoke(f.port(), { path: source, replace: true });
  assert.match(response.result.error.error, /directory must be private/);
  chmodSync(filesRoot, 0o700);
  f.restart();
  assert.deepEqual(f.list(), [original]);
  assert.deepEqual(Buffer.from(f.read(original.name).bytes), originalBytes);
  record("failed-replace", { response, file: original, dataRoot: f.options.dataRoot });
});
