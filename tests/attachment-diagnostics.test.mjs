import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { deflateSync, gzipSync } from "node:zlib";
import test from "node:test";
import {
  decodeBlob, extractAttachmentNotes, scanBlobs, summarizeAudit, summarizeLog,
  sanitizeText, parseArgs, selectContainer, runCommand, collectEvidence, main, SQLITE_COLLECTOR, LIMITS,
} from "../scripts/attachment-diagnostics.mjs";

const script = fileURLToPath(new URL("../scripts/attachment-diagnostics.mjs", import.meta.url));
const agent = "12345678-1234-1234-1234-123456789abc";
const guidance = 'They live on the user\'s computer; the ones marked "also copied into your box" were staged.';
const note = (rows) => `The user attached these files. ${guidance}\n${rows.join("\n")}`;
const staged = "- /media/a.txt (12 B) (also copied into your box at /workspace/uploads/a.txt)";
const unmarked = "- /media/b.txt (2.1 KB)";
const blob = (id, value, encode = (bytes) => bytes) => ({ id, data: encode(Buffer.from(JSON.stringify(value))) });
const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
const failure = "Path is inside a protected host-only store and was refused: /secret/credential";
const tool = (id, overrides = {}) => ({ role: "tool", content: [{
  type: "tool-result", toolName: "Read", toolCallId: id,
  result: failure, experimental_content: [{ type: "text", text: failure }], ...overrides,
}] });

function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "attachment-diag-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function database(file, messages = []) {
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB NOT NULL) STRICT");
  const insert = db.prepare("INSERT INTO blobs VALUES (?, ?)");
  for (const [index, message] of messages.entries()) insert.run(String(index), Buffer.from(JSON.stringify(message)));
  return db;
}
function cli(args, env = process.env) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 15000, maxBuffer: 512 * 1024, env });
}

test("consecutive blobs and multiple notes retain every per-file row, without global regex state", () => {
  const first = note([staged]);
  const second = note([unmarked]);
  const result = scanBlobs([blob("one", user(first)), blob("two", user(second)), blob("three", user(`${first}\n\n${second}`))]);
  assert.equal(result.notes.length, 2);
  assert.equal(result.notes[0].occurrences, 2);
  assert.equal(result.notes[1].occurrences, 2);
  assert.equal(result.notes[0].classification, "staged");
  assert.equal(result.notes[1].classification, "unmarked");
});

test("classification comes from file rows, including mixed notes and escaped JSON", () => {
  const text = note([staged, unmarked]);
  const extracted = extractAttachmentNotes(text);
  assert.equal(extracted[0].classification, "mixed");
  assert.deepEqual(extracted[0].files.map((file) => file.staging), ["marked-staged", "no-staging-marker"]);
  assert.equal(extracted[0].files[0].boxPath, "/workspace/uploads/a.txt");
  assert.equal(extracted[0].files[1].sourcePath, "/media/b.txt");
  assert.equal(extractAttachmentNotes(note([unmarked]))[0].classification, "unmarked");
  assert.deepEqual(extractAttachmentNotes(`The user attached these files. ${guidance}`), []);
  const result = scanBlobs([blob("quoted", JSON.stringify(user(text)))]);
  assert.equal(result.notes[0].classification, "mixed");
  assert.equal(result.notes[0].files.length, 2);
});

test("new per-file on-box locations and copy guidance preserve exact paths", () => {
  const onBox = "/home/box/agent-data/media/report.txt";
  const text = `The user attached these files. Read each file using its recorded location.\n- ${onBox} (22 KB) (stored on your box; read with Read) (also copied into your box at /workspace/uploads/report.txt; read that copy with Read)\n- /media/b.txt (stored on your box; read with Read)`;
  const extracted = extractAttachmentNotes(text)[0];
  assert.equal(extracted.classification, "mixed");
  assert.equal(extracted.files[0].sourcePath, onBox);
  assert.equal(extracted.files[0].sourceLocation, "recorded-on-box");
  assert.equal(extracted.files[0].boxPath, "/workspace/uploads/report.txt");
  assert.equal(extracted.files[1].sourceLocation, "recorded-on-box");
  assert.equal(extracted.files[1].staging, "no-staging-marker");
  const computer = extractAttachmentNotes(note(["- /Users/alice/file.txt (22 KB) (stored on the user's computer; read with ExternalRead)"]))[0].files[0];
  assert.equal(computer.sourcePath, "/Users/alice/file.txt");
  assert.equal(computer.size, "22 KB");
  assert.equal(computer.sourceLocation, "recorded-on-computer");
});

test("zlib, gzip, and plain blobs decode with strict limits and malformed compression fails", () => {
  const text = JSON.stringify(user(note([staged])));
  for (const [format, encode] of [["plain", (b) => b], ["zlib", deflateSync], ["gzip", gzipSync]]) {
    const result = decodeBlob(encode(Buffer.from(text)));
    assert.equal(result.format, format);
    assert.equal(result.text, text);
  }
  assert.throws(() => decodeBlob(gzipSync(Buffer.from("x".repeat(4096))), { maxDecodedBytes: 128 }), /limit/i);
  assert.throws(() => decodeBlob(Buffer.from([0x1f, 0x8b, 0, 0])), /decode/i);
  const result = scanBlobs([blob("z", user(note([staged])), deflateSync), blob("g", user(note([unmarked])), gzipSync)]);
  assert.equal(result.notes.length, 2);
});

test("only tool results supply errors; duplicates deduplicate by toolCallId across blobs and fields", () => {
  const result = scanBlobs([
    blob("system", { role: "system", content: `${failure}\n${note([staged])}` }),
    blob("assistant", { role: "assistant", content: `${failure}\n${note([staged])}` }),
    blob("user", user(failure)),
    blob("one", tool("call-one")), blob("duplicate", tool("call-one")),
    blob("two", tool("call-two", { result: JSON.stringify({ isError: true, content: [{ type: "text", text: failure }] }) })),
    blob("not-failure", tool("call-three", { isError: false, result: `Instructions mention: ${failure}`, experimental_content: [] })),
  ]);
  assert.equal(result.errors.uniqueToolCalls, 2);
  assert.equal(result.errors.categories["protected-store"], 2);
  assert.equal(result.toolErrors.length, 2);
  assert.equal(result.notes.length, 0);
  assert.ok(!JSON.stringify(result).includes("/secret/credential"));
});

test("nested JSON tool errors and unidentified results have explicit accounting", () => {
  const result = scanBlobs([
    blob("a", tool("different", { result: JSON.stringify({ isError: true, error: "Bearer secret-token" }), experimental_content: [] })),
    blob("b", tool(undefined, { result: failure })),
    blob("c", tool(undefined, { result: failure })),
  ]);
  assert.equal(result.errors.uniqueToolCalls, 1);
  assert.equal(result.errors.unidentifiedResults, 1);
  assert.equal(result.errors.categories["other-tool-error"], 1);
  assert.equal(result.errors.categories["protected-store"], 1);
  assert.ok(!JSON.stringify(result).includes("secret-token"));
});

test("audit and log summaries omit raw commands, URLs, credentials and chat text", () => {
  const text = [
    { type: "shell_command", command: "curl -H 'Authorization: Bearer private-secret' https://host/?token=private-secret" },
    { type: "browser_navigation", url: "https://private-secret.example", pageTitle: "private chat" },
    { type: "mcp_tool_call", toolCallId: "private-secret", toolName: "private-secret", status: "error" },
    { type: "mcp_tool_call", toolCallId: "private-secret", status: "error" },
  ].map(JSON.stringify).join("\n");
  const audit = summarizeAudit(text);
  assert.equal(audit.failedToolCalls, 1);
  assert.equal(audit.events.shell_command, 1);
  assert.ok(!JSON.stringify(audit).includes("private-secret"));
  const log = summarizeLog("[local-exec-provider] dropping 3-frame response batch after 5 failed POSTs: Authorization: Bearer private-secret");
  assert.equal(log.failedPostBatches, 1);
  assert.match(log.interpretation, /does not establish.*restart/i);
  assert.ok(!JSON.stringify(log).includes("private-secret"));
  assert.ok(!sanitizeText('Authorization: Bearer private-secret\n{"api_key":"private-secret"}\nhttps://user:private-secret@host/?token=private-secret').includes("private-secret"));
});

test("report contains per-file references but no attachment path or arbitrary blob/call identifiers", () => {
  const result = scanBlobs([blob("credential-as-id", user(note(["- /Users/alice/private-secret.txt (also copied into your box at /workspace/uploads/private-secret.txt)"])))]);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("private-secret"));
  assert.ok(!serialized.includes("credential-as-id"));
  assert.ok(!serialized.includes("alice"));
  assert.equal(result.notes[0].files[0].source.location, "other-path");
  assert.equal(result.notes[0].files[0].box.location, "workspace-uploads");
});

test("container selection is exact, fails for ambiguity, and validates agent paths and options", () => {
  assert.equal(selectContainer(["unrelated-local-vm", "grok-node-local-vm"]), "grok-node-local-vm");
  assert.throws(() => selectContainer(["unrelated-local-vm"]), /container/i);
  assert.throws(() => selectContainer(["grok-node-local-vm", "grok-bot-local-vm"]), /ambiguous/i);
  assert.equal(selectContainer(["grok-node-local-vm", "grok-bot-local-vm"], "grok-bot-local-vm"), "grok-bot-local-vm");
  for (const args of [["../escape"], ["/tmp/agent"], ["--container", "unrelated-local-vm"], ["--wat"], ["--timeout-ms", "0"], ["--timeout-ms", "999999"], [agent, "--db", "/tmp/db"]]) {
    assert.throws(() => parseArgs(args));
  }
});

test("subprocesses have a deadline and output cap; errors never include child stderr", () => {
  assert.throws(() => runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 80 }), /timeout/i);
  assert.throws(() => runCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(65536))"], { maxOutputBytes: 1024 }), /limit/i);
  assert.throws(() => runCommand(process.execPath, ["-e", "process.stderr.write('private-secret'); process.exit(3)"]), (error) => !error.message.includes("private-secret") && error.code === "COMMAND_FAILED");
});

test("startup and local-exec error classes have production input coverage", () => {
  const starting = "The computer is still starting up (downloading its image or booting). Try again in a moment.";
  const window = "start-window exited 1: X connection failed";
  const outside = "Path is outside the allowed local-exec root and was refused: /tmp/private";
  const result = scanBlobs([
    blob("starting", tool("call-start", { isError: true, result: `Error: ${starting}`, experimental_content: [] })),
    blob("window", tool("call-window", { isError: true, result: `Error: ${window}`, experimental_content: [] })),
    blob("outside", tool("call-outside", { isError: true, result: `Error: ${outside}`, experimental_content: [] })),
  ]);
  assert.equal(result.errors.categories["computer-starting"], 1);
  assert.equal(result.errors.categories["start-window"], 1);
  assert.equal(result.errors.categories["local-exec-root"], 1);
  const quoted = scanBlobs([blob("quoted", {
    role: "tool", content: `File contents:\nPath is inside a protected host-only store and was refused: /secret/x`,
  })]);
  assert.equal(quoted.errors.uniqueToolCalls, 0);
});

test("rollback-journal presence refuses snapshots and desensitization covers key shapes", async (t) => {
  const dir = fixture(t);
  const dbPath = path.join(dir, "conversation.db");
  const db = database(dbPath, [user(note([staged]))]);
  db.exec("PRAGMA journal_mode=WAL");
  db.close();
  writeFileSync(`${dbPath}-journal`, "");
  await assert.rejects(collectEvidence({ db: dbPath, timeoutMs: 5000 }), /journal/i);
  assert.match(sanitizeText("key sk-abc123XYZ456 here"), /<REDACTED>/);
  assert.match(sanitizeText("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature here"), /<REDACTED>/);
  assert.match(sanitizeText("-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----"), /<REDACTED>/);
});

test("oversized blobs report partial evidence instead of silent success", () => {
  const big = blob("big", user(note([staged])), (bytes) => Buffer.concat([bytes, Buffer.alloc(5 * 1024 * 1024)]));
  const result = scanBlobs([big]);
  assert.ok(result.coverage.limited || result.errors.uniqueToolCalls >= 0);
});

test("snapshot includes committed WAL rows with DB, WAL and SHM byte-exact preservation", async (t) => {
  const dir = fixture(t);
  const dbPath = path.join(dir, "conversation.db");
  const db = database(dbPath);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
    db.prepare("INSERT INTO blobs VALUES (?, ?)").run("wal-only", deflateSync(Buffer.from(JSON.stringify(user(note([staged, unmarked]))))));
    const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
    const before = files.map((file) => readFileSync(file));
    const report = await collectEvidence(parseArgs(["--db", dbPath]));
    assert.equal(report.status, "ok");
    assert.equal(report.conversation.notes[0].classification, "mixed");
    assert.equal(report.conversation.coverage.totalRows, 1);
    for (const [index, file] of files.entries()) {
      const after = readFileSync(file);
      assert.equal(createHash("sha256").update(after).digest("hex"), createHash("sha256").update(before[index]).digest("hex"), `${path.basename(file)} hash changed`);
      assert.ok(after.equals(before[index]), `${path.basename(file)} bytes changed`);
    }
    assert.deepEqual(readdirSync(dir).sort(), ["conversation.db", "conversation.db-shm", "conversation.db-wal"]);
  } finally { db.close(); }
});

test("closed WAL-mode databases snapshot without sidecars; concurrent changes fail closed", (t) => {
  const dir = fixture(t);
  const agentDir = path.join(dir, agent);
  mkdirSync(agentDir);
  const dbPath = path.join(agentDir, "conversation-blobs.db");
  const db = database(dbPath, [user(note([staged]))]);
  db.exec("PRAGMA journal_mode=WAL");
  db.close();
  assert.equal(readFileSync(dbPath)[18], 2);
  assert.deepEqual(readdirSync(agentDir), ["conversation-blobs.db"]);
  const collector = SQLITE_COLLECTOR.replace('Path("/home/box/sand-data/agents")', `Path(${JSON.stringify(dir)})`);
  const run = (input) => JSON.parse(runCommand("python3", ["-", "container", agent, "3", JSON.stringify(LIMITS)], { input }).toString("utf8"));
  const before = readFileSync(dbPath);
  const closed = run(collector);
  assert.equal(closed.failure, undefined);
  assert.equal(closed.rows.length, 1);
  assert.deepEqual(readFileSync(dbPath), before);
  assert.deepEqual(readdirSync(agentDir), ["conversation-blobs.db"]);
  // Inject source activity after raw copying and before file-set verification.
  // This modifies only the temporary fixture, never any live source database.
  const checkLine = '        require(source_state(db_path) == before, "SOURCE_CHANGED")';
  const changeMain = collector.replace(checkLine, '        info = db_path.stat()\n        os.utime(db_path, ns=(info.st_atime_ns, info.st_mtime_ns + 1000000))\n' + checkLine);
  assert.equal(run(changeMain).failure, "SOURCE_CHANGED");
  const createWal = collector.replace(checkLine, '        Path(str(db_path) + "-wal").write_bytes(b"new writer")\n' + checkLine);
  assert.equal(run(createWal).failure, "SOURCE_CHANGED");
});

test("private replay reads committed WAL without source SHM and excludes uncommitted frames", async (t) => {
  const dir = fixture(t);
  const livePath = path.join(dir, "live.db");
  const db = database(livePath);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA cache_size=2");
    const insert = db.prepare("INSERT INTO blobs VALUES (?, ?)");
    insert.run("committed", Buffer.from(JSON.stringify(user(note([staged])))));
    // A transaction large enough to spill pages into WAL, without a commit frame.
    db.exec("BEGIN");
    for (let index = 0; index < 20; index++) insert.run(`uncommitted-${index}`, Buffer.alloc(8192, 32));
    const standalone = path.join(dir, "wal-copy.db");
    copyFileSync(livePath, standalone);
    copyFileSync(`${livePath}-wal`, `${standalone}-wal`);
    const paths = [livePath, `${livePath}-wal`, `${livePath}-shm`, standalone, `${standalone}-wal`];
    const before = paths.map((file) => readFileSync(file));
    const names = readdirSync(dir).sort();
    for (const dbPath of [livePath, standalone]) {
      const report = await collectEvidence(parseArgs(["--db", dbPath]));
      assert.equal(report.status, "ok");
      assert.equal(report.conversation.coverage.totalRows, 1);
      assert.equal(report.conversation.notes[0].classification, "staged");
    }
    for (const [index, file] of paths.entries()) assert.ok(readFileSync(file).equals(before[index]), `${path.basename(file)} bytes changed`);
    assert.deepEqual(readdirSync(dir).sort(), names, "collector created a source sidecar");
  } finally { db.exec("ROLLBACK"); db.close(); }
});

test("private copies have restrictive permissions and cleanup on success, failure and deadline", (t) => {
  const dir = fixture(t);
  const privateRoot = path.join(dir, "private");
  mkdirSync(privateRoot);
  const dbPath = path.join(dir, "source.db");
  const db = database(dbPath, [user(note([staged]))]);
  const env = { ...process.env, TMPDIR: privateRoot, TMP: privateRoot, TEMP: privateRoot };
  const checkLine = '        require(source_state(db_path) == before, "SOURCE_CHANGED")';
  const run = (input) => JSON.parse(runCommand("python3", ["-", "snapshot", dbPath, "3", JSON.stringify(LIMITS)], { input, env }).toString("utf8"));
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
    db.prepare("INSERT INTO blobs VALUES (?, ?)").run("wal", Buffer.from("{}"));
    const before = ["", "-wal", "-shm"].map((suffix) => readFileSync(dbPath + suffix));
    const permissions = [
      '        require(stat.S_IMODE(Path(work_dir).stat().st_mode) == 0o700, "DIAGNOSTIC_FAILED")',
      '        for private_file in Path(work_dir).iterdir():',
      '            require(stat.S_IMODE(private_file.stat().st_mode) == 0o600, "DIAGNOSTIC_FAILED")',
    ].join("\n");
    assert.equal(run(SQLITE_COLLECTOR.replace(checkLine, permissions + "\n" + checkLine)).failure, undefined);
    assert.deepEqual(readdirSync(privateRoot), []);
    assert.equal(run(SQLITE_COLLECTOR.replace(checkLine, '        raise Failure("SOURCE_CHANGED")\n' + checkLine)).failure, "SOURCE_CHANGED");
    assert.deepEqual(readdirSync(privateRoot), []);
    assert.equal(run(SQLITE_COLLECTOR.replace(checkLine, '        expired()\n' + checkLine)).failure, "COLLECTION_TIMEOUT");
    assert.deepEqual(readdirSync(privateRoot), []);
    for (const [index, suffix] of ["", "-wal", "-shm"].entries()) assert.ok(readFileSync(dbPath + suffix).equals(before[index]));
  } finally { db.close(); }
});

test("source WAL or mmap SHM changes during copying fail closed", (t) => {
  const dir = fixture(t);
  const dbPath = path.join(dir, "source.db");
  const db = database(dbPath);
  const checkLine = '        require(source_state(db_path) == before, "SOURCE_CHANGED")';
  const run = (injection) => JSON.parse(runCommand("python3", ["-", "snapshot", dbPath, "3", JSON.stringify(LIMITS)], {
    input: SQLITE_COLLECTOR.replace(checkLine, injection + "\n" + checkLine),
  }).toString("utf8"));
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
    db.prepare("INSERT INTO blobs VALUES (?, ?)").run("wal", Buffer.from("{}"));
    const walChanged = run('        p = Path(str(db_path) + "-wal")\n        info = p.stat()\n        os.utime(p, ns=(info.st_atime_ns, info.st_mtime_ns + 1000000))');
    assert.equal(walChanged.failure, "SOURCE_CHANGED");
    const shmChanged = run([
      "        import mmap",
      '        with open(str(db_path) + "-shm", "r+b") as f:',
      "            with mmap.mmap(f.fileno(), 0) as mapped:",
      "                original = mapped[100]",
      "                mapped[100] = original ^ 1",
      "                try:",
      '                    require(copy_and_hash(Path(str(db_path) + "-shm"), before["-shm"]) == fingerprints["-shm"], "SOURCE_CHANGED")',
      "                finally:",
      "                    mapped[100] = original",
    ].join("\n"));
    assert.equal(shmChanged.failure, "SOURCE_CHANGED");
  } finally { db.close(); }
});

test("CLI works without Docker, emits only bounded sanitized JSON, and main is importable", async (t) => {
  const dir = fixture(t);
  const dbPath = path.join(dir, "fixture.db");
  database(dbPath, [user(note([staged])), tool("secret-id")]).close();
  const result = cli(["--db", dbPath], { ...process.env, DOCKER_HOST: "tcp://must-not-contact.invalid:2375" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.source.mode, "snapshot");
  assert.equal(report.conversation.errors.uniqueToolCalls, 1);
  assert.ok(!result.stdout.includes("secret-id"));
  assert.ok(!result.stdout.includes("/secret/credential"));
  assert.equal(typeof main, "function");
});

test("plain text notes are labeled fallback evidence; alternate tool content is inspected once", () => {
  const result = scanBlobs([
    { id: "plain", data: Buffer.from(`${note([staged])}\n${failure}`) },
    blob("alternate", tool("alt-call", { result: undefined })),
    blob("duplicate", tool("alt-call")),
  ]);
  assert.equal(result.notes[0].origin, "unstructured-text-note");
  assert.equal(result.errors.uniqueToolCalls, 1);
  assert.equal(result.errors.categories["protected-store"], 1);
});

test("partial DB scans, invalid compressed blobs, and note limits cannot report success", async (t) => {
  const dir = fixture(t);
  const dbPath = path.join(dir, "large.db");
  const db = database(dbPath);
  try {
    const insert = db.prepare("INSERT INTO blobs VALUES (?, ?)");
    db.exec("BEGIN");
    for (let index = 0; index < LIMITS.rows + 1; index++) insert.run(String(index), Buffer.from("{}"));
    db.exec("COMMIT");
  } finally { db.close(); }
  const limited = cli(["--db", dbPath]);
  assert.equal(limited.status, 1);
  const report = JSON.parse(limited.stdout);
  assert.equal(report.status, "partial");
  assert.equal(report.conversation.coverage.omittedRows, 1);
  const invalidPath = path.join(dir, "invalid-compressed.db");
  const invalid = database(invalidPath);
  invalid.prepare("INSERT INTO blobs VALUES (?, ?)").run("bad", Buffer.from([0x1f, 0x8b, 0, 0]));
  invalid.close();
  const broken = cli(["--db", invalidPath]);
  assert.equal(broken.status, 1);
  assert.equal(JSON.parse(broken.stdout).conversation.coverage.decodeFailures, 1);
  const many = scanBlobs([blob("many", user(note(Array.from({ length: LIMITS.files + 1 }, (_, i) => `- /media/${i}.txt`))))]);
  assert.equal(many.coverage.limited, true);
});

test("symlinks are refused, and the actual container collector validates a missing agent", async (t) => {
  const dir = fixture(t);
  const dbPath = path.join(dir, "fixture.db");
  database(dbPath).close();
  const link = path.join(dir, "link.db");
  symlinkSync(dbPath, link);
  assert.equal(cli(["--db", link]).status, 1);
  const collector = SQLITE_COLLECTOR.replace('Path("/home/box/sand-data/agents")', `Path(${JSON.stringify(dir)})`);
  const runMissing = () => {
    const response = runCommand("python3", ["-", "container", agent, "3", JSON.stringify(LIMITS)], { input: collector });
    const result = JSON.parse(response.toString("utf8"));
    assert.equal(result.failure, "AGENT_NOT_FOUND");
    const error = new Error("not displayed"); error.code = result.failure; throw error;
  };
  let output = "";
  assert.equal(await main([agent], { collect: runMissing, write: (text) => { output += text; } }), 1);
  assert.equal(JSON.parse(output).failure.code, "AGENT_NOT_FOUND");
  assert.deepEqual(readdirSync(dir).sort(), ["fixture.db", "link.db"]);
});

test("explicit remote Docker endpoints fail before contacting a daemon", () => {
  const result = cli([agent], { ...process.env, DOCKER_CONTEXT: "", DOCKER_HOST: "tcp://must-not-contact.invalid:2375" });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).failure.code, "LOCAL_DOCKER_REQUIRED");
});

test("nonexistent db, invalid db and nonexistent/invalid agents produce nonzero exit", async (t) => {
  const dir = fixture(t);
  const invalid = path.join(dir, "invalid.db");
  writeFileSync(invalid, "not sqlite private-secret");
  for (const args of [["--db", path.join(dir, "missing.db")], ["--db", invalid], ["../missing-agent"]]) {
    const result = cli(args);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stdout).status, "error");
    assert.ok(!`${result.stdout}${result.stderr}`.includes("private-secret"));
  }
  // Exercise the main error path without needing Docker or an installed sandbox.
  let output = "";
  const code = await main([agent], {
    collect: async () => { const error = new Error("agent not found"); error.code = "AGENT_NOT_FOUND"; throw error; },
    write: (text) => { output += text; },
  });
  assert.equal(code, 1);
  assert.equal(JSON.parse(output).failure.code, "AGENT_NOT_FOUND");
});
