#!/usr/bin/env node
/**
 * Local, read-only source evidence. JSON goes to stdout. Bounded private DB/WAL
 * copies are removed after collection. Run with Node 26.5.x and Python 3
 * (inside the sandbox in Docker mode): attachment-diagnostics.mjs [UUID|latest] [--container NAME]
 *          attachment-diagnostics.mjs --db /absolute/path/to/snapshot.db
 * --timeout-ms 15000 sets the total collection budget (maximum 30000).
 * Exit 0 = collected evidence, 1 = failure or incomplete evidence. Observed tool
 * failures are findings, not collector failures. No network probes or repairs.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, lstatSync, openSync, closeSync, readSync, fstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync, gunzipSync } from "node:zlib";

export const CONTAINER_CANDIDATES = Object.freeze(["grok-node-local-vm", "grok-bot-local-vm"]);
export const LIMITS = Object.freeze({
  timeoutMs: 15000, maxTimeoutMs: 30000, snapshotBytes: 128 * 1024 * 1024,
  rows: 2000, blobBytes: 4 * 1024 * 1024, decodedBlobBytes: 8 * 1024 * 1024,
  storedBytes: 16 * 1024 * 1024, decodedBytes: 32 * 1024 * 1024,
  transferBytes: 24 * 1024 * 1024, tailBytes: 128 * 1024,
  notes: 60, files: 400, toolErrors: 200, nodes: 100000, reportBytes: 256 * 1024,
});
const AGENTS_DIR = "/home/box/sand-data/agents";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_RULES = [
  ["protected-store", /protected host-only store/i, /^(?:Error:\s*)?Path is inside a protected host-only store and was refused:/im],
  ["local-exec-root", /outside the allowed local-exec root/i, /^(?:Error:\s*)?Path (?:is|resolves through a symlink to) outside the allowed local-exec root and was refused:/im],
  ["computer-starting", /still starting up \(downloading its image/i, /^(?:Error:\s*)?The computer is still starting up \(downloading its image/im],
  ["start-window", /start-window (?:failed|exited)/i, /^(?:Error:\s*)?(?:[^\n]{0,80}: )?start-window (?:failed|exited)\b/im],
];
const FAILURE_MESSAGES = {
  INVALID_ARGUMENT: "Invalid arguments. Use --help; agent must be a UUID, and --db cannot be combined with an agent or container.",
  CONTAINER_NOT_FOUND: "No selected, running sandbox container was found.",
  AMBIGUOUS_CONTAINER: "Ambiguous container selection. Specify --container grok-node-local-vm or grok-bot-local-vm.",
  LOCAL_DOCKER_REQUIRED: "A local Docker Unix socket is required; remote Docker endpoints are not contacted.",
  COMMAND_FAILED: "A required local command failed; raw stdout/stderr were omitted.",
  COMMAND_TIMEOUT: "Local command timeout exceeded the collection budget.",
  COMMAND_LIMIT: "Local command output exceeded the byte limit.",
  AGENT_NOT_FOUND: "The selected agent directory or its conversation database does not exist.",
  DB_NOT_FOUND: "The requested database does not exist or is not a regular file.",
  DB_INVALID: "The database is not readable SQLite with a blobs(id, data) table.",
  UNSAFE_PATH: "A symlink or path outside the selected agent directory was refused.",
  JOURNAL_PRESENT: "A rollback journal is present. Retry after the writer settles; the source was not opened by SQLite.",
  SOURCE_CHANGED: "The source database or sidecar set changed while copying. Retry after activity settles; no inconsistent snapshot was used.",
  SNAPSHOT_LIMIT: "The database or sidecars exceed the bounded snapshot size.",
  COLLECTION_TIMEOUT: "The SQLite collection deadline expired.",
  COLLECTION_LIMIT: "Collection exceeded a directory, data, or output limit.",
  BLOB_LIMIT: "Blob decoding exceeded the byte limit.",
  BLOB_DECODE: "Could not decode a compressed blob.",
  PROTOCOL_INVALID: "The collector returned an invalid bounded response.",
  REPORT_LIMIT: "The sanitized report exceeded the output limit.",
  DIAGNOSTIC_FAILED: "Local diagnostic collection failed; raw error details were omitted.",
};
export class DiagnosticError extends Error {
  constructor(code) { super(FAILURE_MESSAGES[code] ?? FAILURE_MESSAGES.DIAGNOSTIC_FAILED); this.code = code; }
}
const fail = (code) => { throw new DiagnosticError(code); };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const ref = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 16);

// Defense in depth for callers of this helper. The report itself uses allowlisted
// fields and fingerprints instead of attempting to redact arbitrary chat text.
export function sanitizeText(value, maxLength = 300) {
  return String(value)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, "<REDACTED>")
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi, "<REDACTED_URL>")
    .replace(/\b(?:Bearer|Basic)\s+[^\s"',;]+/gi, "<REDACTED>")
    .replace(/(["']?(?:authorization|cookie|set-cookie|(?:api[_-]?)?key|[\w-]*token|password|secret)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi, "$1<REDACTED>")
    .replace(/\b(?:sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, "<REDACTED>")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, maxLength);
}

export function parseArgs(argv) {
  const options = { agent: "latest", timeoutMs: LIMITS.timeoutMs };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") { options.help = true; continue; }
    if (["--db", "--container", "--timeout-ms"].includes(arg)) {
      if (seen.has(arg) || !argv[index + 1] || argv[index + 1].startsWith("--")) fail("INVALID_ARGUMENT");
      seen.add(arg);
      const value = argv[++index];
      if (arg === "--db") options.db = path.resolve(value);
      if (arg === "--container") options.container = value;
      if (arg === "--timeout-ms") {
        if (!/^\d+$/.test(value) || +value < 100 || +value > LIMITS.maxTimeoutMs) fail("INVALID_ARGUMENT");
        options.timeoutMs = +value;
      }
    } else {
      if (seen.has("agent") || (arg !== "latest" && !UUID.test(arg))) fail("INVALID_ARGUMENT");
      seen.add("agent");
      options.agent = arg;
    }
  }
  if (options.container && !CONTAINER_CANDIDATES.includes(options.container)) fail("INVALID_ARGUMENT");
  if (options.db && (seen.has("agent") || options.container)) fail("INVALID_ARGUMENT");
  return options;
}

export function selectContainer(names, requested) {
  if (requested && !CONTAINER_CANDIDATES.includes(requested)) fail("INVALID_ARGUMENT");
  const matches = CONTAINER_CANDIDATES.filter((name) => names.includes(name) && (!requested || requested === name));
  if (!matches.length) fail("CONTAINER_NOT_FOUND");
  if (matches.length > 1) fail("AMBIGUOUS_CONTAINER");
  return matches[0];
}

export function runCommand(command, args, { timeoutMs = LIMITS.timeoutMs, maxOutputBytes = 512 * 1024, input, env = process.env } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIMITS.maxTimeoutMs ||
      !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > LIMITS.transferBytes) fail("INVALID_ARGUMENT");
  try {
    return execFileSync(command, args, {
      input, env, encoding: null, stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"],
      timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: maxOutputBytes,
    });
  } catch (error) {
    if (error.code === "ETIMEDOUT") fail("COMMAND_TIMEOUT");
    if (error.code === "ENOBUFS" || error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") fail("COMMAND_LIMIT");
    fail("COMMAND_FAILED");
  }
}

export function decodeBlob(data, { maxDecodedBytes = LIMITS.decodedBlobBytes } = {}) {
  const bytes = Buffer.from(data);
  if (bytes.length > LIMITS.blobBytes || maxDecodedBytes < 1 || maxDecodedBytes > LIMITS.decodedBlobBytes) fail("BLOB_LIMIT");
  const format = bytes[0] === 0x1f && bytes[1] === 0x8b ? "gzip"
    : (bytes[0] & 15) === 8 && bytes.length > 1 && ((bytes[0] << 8) + bytes[1]) % 31 === 0 ? "zlib" : "plain";
  let decoded = bytes;
  if (format !== "plain") {
    try { decoded = (format === "gzip" ? gunzipSync : inflateSync)(bytes, { maxOutputLength: maxDecodedBytes }); }
    catch (error) { fail(error.code === "ERR_BUFFER_TOO_LARGE" ? "BLOB_LIMIT" : "BLOB_DECODE"); }
  }
  if (decoded.length > maxDecodedBytes) fail("BLOB_LIMIT");
  return { format, text: decoded.toString("utf8"), bytes: decoded.length };
}

const absoluteFilePath = (value) => /^(?:\/|[A-Za-z]:[\\/])/.test(value) && !/[\u0000-\u001f\u007f]/.test(value);
// Parse only the formatter's header followed by contiguous per-file list rows.
// A fresh matchAll iterator per invocation cannot carry lastIndex across blobs.
export function extractAttachmentNotes(text) {
  const notes = [];
  let filesSeen = 0;
  for (const match of text.matchAll(/(?:^|\n)The user attached (?:a file|these files)\.[^\n]*\n((?:- [^\n]+(?:\n|$))+)/g)) {
    const files = [];
    for (const line of match[1].trimEnd().split("\n")) {
      let sourcePath = line.slice(2).trim();
      const marker = / \(also copied into your box at (.+?)(?:; read that copy with Read)?\)$/.exec(sourcePath);
      const boxPath = marker?.[1];
      if (marker) sourcePath = sourcePath.slice(0, marker.index);
      const location = / \((stored on your box; read with Read|stored on the user's computer; read with ExternalRead)\)$/.exec(sourcePath);
      if (location) sourcePath = sourcePath.slice(0, location.index);
      const sourceLocation = location ? (location[1].startsWith("stored on your box") ? "recorded-on-box" : "recorded-on-computer") : "unspecified";
      const size = / \((\d+(?:\.\d+)? (?:B|KB|MB|GB))\)$/.exec(sourcePath);
      if (size) sourcePath = sourcePath.slice(0, size.index);
      if (!absoluteFilePath(sourcePath) || (boxPath != null && !absoluteFilePath(boxPath))) continue;
      if (++filesSeen > LIMITS.files) fail("COLLECTION_LIMIT");
      files.push({ sourcePath, sourceLocation, ...(size ? { size: size[1] } : {}), staging: boxPath ? "marked-staged" : "no-staging-marker", ...(boxPath ? { boxPath } : {}) });
    }
    if (!files.length) continue;
    if (notes.length >= LIMITS.notes) fail("COLLECTION_LIMIT");
    const marked = files.filter((file) => file.boxPath).length;
    notes.push({ classification: marked === files.length ? "staged" : marked ? "mixed" : "unmarked", files });
  }
  return notes;
}
function fileReference(value) {
  return { ref: ref(value), location: value.startsWith("/workspace/uploads/") ? "workspace-uploads"
    : value.startsWith("/media/") ? "media" : value.startsWith("/home/box/agent-data/") ? "agent-data"
    : value.startsWith(`${AGENTS_DIR}/`) ? "agent-store" : "other-path" };
}
function parseNestedJson(value) {
  for (let depth = 0; depth < 3 && typeof value === "string"; depth++) {
    try { value = JSON.parse(value); } catch { break; }
  }
  return value;
}
function textParts(content) {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => typeof part === "string" ? [part] : part?.type === "text" && typeof part.text === "string" ? [part.text] : []);
}

export function scanBlobs(blobs, { deadline = Infinity } = {}) {
  const notes = new Map(), errors = new Map();
  const coverage = { scannedRows: 0, jsonBlobs: 0, nonJsonBlobs: 0, unstructuredTextBlobs: 0, decodeFailures: 0,
    formats: { plain: 0, zlib: 0, gzip: 0 }, decodedBytes: 0, limited: false };
  let nodes = 0, fileCount = 0;
  const budget = (depth) => {
    if (Date.now() >= deadline) fail("COLLECTION_TIMEOUT");
    if (++nodes > LIMITS.nodes || depth > 32) fail("COLLECTION_LIMIT");
  };
  function addNotes(text, blobRef, origin) {
    for (const note of extractAttachmentNotes(text)) {
      const key = ref(JSON.stringify(note.files));
      const existing = notes.get(key);
      if (existing) { existing.occurrences++; if (existing.blobRefs.length < 3 && !existing.blobRefs.includes(blobRef)) existing.blobRefs.push(blobRef); continue; }
      if (notes.size >= LIMITS.notes || fileCount + note.files.length > LIMITS.files) { coverage.limited = true; continue; }
      fileCount += note.files.length;
      notes.set(key, { ref: key, classification: note.classification, origin, occurrences: 1, blobRefs: [blobRef],
        files: note.files.map((file) => ({ source: fileReference(file.sourcePath), sourceLocation: file.sourceLocation, staging: file.staging,
          ...(file.size ? { size: file.size } : {}), ...(file.boxPath ? { box: fileReference(file.boxPath) } : {}) })) });
    }
  }
  function addToolError(part, blobRef, fallbackId) {
    const texts = [];
    let flagged = false;
    let explicitlySuccessful = false;
    function payload(value, depth = 0) {
      budget(depth);
      value = parseNestedJson(value);
      if (typeof value === "string") { texts.push(value); return; }
      if (Array.isArray(value)) { for (const child of value) payload(child, depth + 1); return; }
      if (!record(value)) return;
      flagged ||= value.isError === true || value.is_error === true || value.status === "error" || value.type === "error";
      explicitlySuccessful ||= value.isError === false || value.is_error === false;
      for (const key of ["text", "error", "message", "content", "experimental_content", "result", "output", "value"]) {
        if (value[key] !== undefined) payload(value[key], depth + 1);
      }
    }
    payload(part);
    // Quoted refusal text inside an otherwise successful payload is content,
    // not a tool refusal: only explicit error flags consult the loose matcher.
    if (!flagged && explicitlySuccessful) return;
    const categories = ERROR_RULES.filter(([, anywhere, anchored]) => texts.some((text) =>
      (flagged ? anywhere : anchored).test(text))).map(([key]) => key);
    if (!flagged && !categories.length) return;
    if (!categories.length) categories.push("other-tool-error");
    const callId = part.toolCallId ?? part.tool_call_id ?? part.tool_use_id ?? fallbackId;
    const identified = typeof callId === "string" && callId.length > 0;
    const key = identified ? `call:${ref(callId)}` : `result:${ref(JSON.stringify([part.toolName, [...new Set(texts)], categories]))}`;
    const existing = errors.get(key);
    if (existing) { for (const category of categories) existing.categories.add(category); existing.occurrences++; return; }
    errors.set(key, { callRef: key, identified, categories: new Set(categories), blobRef, occurrences: 1 });
  }
  // Only traverse message envelopes. Never interpret arbitrary objects in tool
  // arguments, system prompts, schemas or assistant prose as transcript events.
  function visit(value, blobRef, depth = 0) {
    budget(depth);
    value = parseNestedJson(value);
    if (Array.isArray(value)) { for (const child of value) visit(child, blobRef, depth + 1); return; }
    if (!record(value)) return;
    if (typeof value.role === "string") {
      if (value.role === "user") for (const text of textParts(value.content)) addNotes(text, blobRef, "user-message-note");
      if (value.role === "tool") {
        if (typeof value.content === "string") addToolError({ ...value, result: value.content }, blobRef, value.tool_call_id ?? value.id);
        if (Array.isArray(value.content)) for (const part of value.content) {
          if (["tool-result", "tool_result"].includes(part?.type)) addToolError(part, blobRef, value.id);
        }
      }
      return;
    }
    if (["tool-result", "tool_result"].includes(value.type)) { addToolError(value, blobRef); return; }
    if (record(value.userMessage) && typeof value.userMessage.text === "string") addNotes(value.userMessage.text, blobRef, "user-message-note");
    for (const key of ["messages", "message", "rootPromptMessages", "appendedRootPromptMessages"]) {
      if (value[key] !== undefined) visit(value[key], blobRef, depth + 1);
    }
  }
  for (const blob of blobs) {
    if (Date.now() >= deadline) fail("COLLECTION_TIMEOUT");
    if (coverage.scannedRows >= LIMITS.rows) { coverage.limited = true; break; }
    coverage.scannedRows++;
    let decoded;
    try { decoded = decodeBlob(blob.data ?? Buffer.from(blob.text ?? "")); }
    catch { coverage.decodeFailures++; continue; }
    coverage.formats[decoded.format]++;
    coverage.decodedBytes += decoded.bytes;
    if (coverage.decodedBytes > LIMITS.decodedBytes) { coverage.limited = true; break; }
    const blobRef = ref(blob.id);
    let value;
    try { value = JSON.parse(decoded.text); coverage.jsonBlobs++; }
    catch {
      coverage.nonJsonBlobs++;
      // Binary/protobuf blobs are expected. Plain notes are a labeled fallback,
      // never a source of inferred tool errors or model claims.
      if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(decoded.text)) {
        coverage.unstructuredTextBlobs++;
        try { addNotes(decoded.text, blobRef, "unstructured-text-note"); } catch { coverage.limited = true; }
      }
      continue;
    }
    try { visit(value, blobRef); } catch { coverage.limited = true; break; }
  }
  const categories = Object.fromEntries([...ERROR_RULES.map(([key]) => key), "other-tool-error"].map((key) => [key, 0]));
  for (const error of errors.values()) for (const category of error.categories) categories[category]++;
  return { coverage, notes: [...notes.values()], errors: {
    uniqueToolCalls: [...errors.values()].filter((error) => error.identified).length,
    unidentifiedResults: [...errors.values()].filter((error) => !error.identified).length, categories,
  }, toolErrors: [...errors.values()].slice(0, LIMITS.toolErrors).map((error) => ({ ...error, categories: [...error.categories] })),
  omittedToolErrorDetails: Math.max(0, errors.size - LIMITS.toolErrors) };
}

export function summarizeAudit(text) {
  const events = { mcp_tool_call: 0, shell_command: 0, browser_navigation: 0, computer_use_session: 0, other: 0 };
  const failures = new Set();
  let invalidLines = 0, unidentifiedFailures = 0;
  const lines = text.split("\n").filter((line) => line.trim());
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { invalidLines++; continue; }
    if (!record(event)) { invalidLines++; continue; }
    events[Object.hasOwn(events, event.type) ? event.type : "other"]++;
    if (event.type === "mcp_tool_call" && ["error", "failed"].includes(event.status)) {
      if (typeof event.toolCallId === "string" && event.toolCallId) failures.add(event.toolCallId);
      else unidentifiedFailures++;
    }
  }
  return { sampledLines: lines.length, events, failedToolCalls: failures.size, unidentifiedFailures, invalidLines };
}
export function summarizeLog(text) {
  const lines = text.split("\n");
  const failedPostBatches = lines.filter((line) => /dropping \d+-frame response batch after \d+ failed POSTs/.test(line)).length;
  return { sampledLines: lines.filter(Boolean).length, failedPostBatches,
    attachmentErrorMentions: Object.fromEntries(ERROR_RULES.map(([key, pattern]) => [key, lines.filter((line) => pattern.test(line)).length])),
    interpretation: "Log mentions are observations, not tool-call counts. A failed POST batch does not establish a host restart or its cause." };
}

// Runs unchanged locally for --db and inside the selected container. Source DB,
// WAL and SHM are read only through O_RDONLY descriptors, never SQLite (mode=ro
// still writes SHM readmarks). Stable file-set copies are checked twice, and only
// a private DB/WAL copy is opened by SQLite; private SHM recovery includes WAL
// commits. Byte/deadline limits cover copies, verification and in-memory backup.
export const SQLITE_COLLECTOR = String.raw`
import base64, hashlib, json, os, re, signal, sqlite3, stat, sys, tempfile, time
from pathlib import Path

class Failure(Exception):
    pass

def require(condition, code):
    if not condition:
        raise Failure(code)

mode, target, budget, limits_json = sys.argv[1:]
limits = json.loads(limits_json)
deadline = time.monotonic() + float(budget)
def expired(*args):
    raise Failure("COLLECTION_TIMEOUT")
signal.signal(signal.SIGALRM, expired)
signal.setitimer(signal.ITIMER_REAL, float(budget))
def check_time():
    if time.monotonic() >= deadline:
        expired()

def regular(p, missing="DB_NOT_FOUND"):
    try:
        info = p.lstat()
    except FileNotFoundError:
        raise Failure(missing)
    require(not stat.S_ISLNK(info.st_mode), "UNSAFE_PATH")
    require(stat.S_ISREG(info.st_mode), missing)
    return info

def read_tail(p):
    try:
        regular(p)
        fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as f:
            info = os.fstat(f.fileno())
            require(stat.S_ISREG(info.st_mode), "UNSAFE_PATH")
            start = max(0, info.st_size - limits["tailBytes"])
            f.seek(start)
            data = f.read(limits["tailBytes"])
        if start:
            data = data.split(b"\n", 1)[1] if b"\n" in data else b""
        # Exclude an incomplete last JSON/log line from this concurrent tail.
        if data and not data.endswith(b"\n"):
            data = data.rsplit(b"\n", 1)[0] + b"\n" if b"\n" in data else b""
        return {"status": "ok", "text": data.decode("utf-8", "replace"), "truncated": start > 0}
    except FileNotFoundError:
        return {"status": "missing"}
    except Failure as e:
        if str(e) == "COLLECTION_TIMEOUT":
            raise
        return {"status": "missing" if str(e) == "DB_NOT_FOUND" else "unavailable"}
    except OSError:
        return {"status": "unavailable"}

def signature(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

def source_state(db_path):
    state = {}
    for suffix in ["", "-wal", "-shm", "-journal"]:
        p = Path(str(db_path) + suffix)
        try:
            info = regular(p)
        except Failure as e:
            if str(e) != "DB_NOT_FOUND":
                raise
            state[suffix] = None
            continue
        cap = 4 * 1024 * 1024 if suffix == "-shm" else limits["snapshotBytes"]
        require(info.st_size <= cap, "SNAPSHOT_LIMIT")
        state[suffix] = signature(info)
    require(state[""] is not None, "SOURCE_CHANGED")
    return state

def copy_and_hash(p, expected, destination=None):
    check_time()
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source_file:
        require(signature(os.fstat(source_file.fileno())) == expected, "SOURCE_CHANGED")
        digest = hashlib.sha256()
        copied = 0
        output = None
        try:
            if destination is not None:
                output = os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb")
            while copied < expected[2]:
                check_time()
                chunk = source_file.read(min(1024 * 1024, expected[2] - copied))
                require(bool(chunk), "SOURCE_CHANGED")
                copied += len(chunk)
                digest.update(chunk)
                if output is not None:
                    output.write(chunk)
            require(not source_file.read(1), "SOURCE_CHANGED")
            require(signature(os.fstat(source_file.fileno())) == expected, "SOURCE_CHANGED")
            require(signature(regular(p)) == expected, "SOURCE_CHANGED")
        finally:
            if output is not None:
                output.close()
    return digest.digest()

def populate_snapshot(db_path, snapshot):
    before = source_state(db_path)
    # Do not attempt rollback recovery or take a snapshot amid a rollback commit.
    require(before["-journal"] is None, "JOURNAL_PRESENT")
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="sand-attach-snapshot-") as work_dir:
        private_db = Path(work_dir) / "conversation.db"
        fingerprints = {}
        for suffix, expected in before.items():
            if expected is not None:
                destination = Path(str(private_db) + suffix) if suffix in ["", "-wal"] else None
                fingerprints[suffix] = copy_and_hash(Path(str(db_path) + suffix), expected, destination)
        require(source_state(db_path) == before, "SOURCE_CHANGED")
        # Check full bytes as well as stat/header changes: SHM can change via mmap
        # without an mtime update. Source SHM is only hashed, never copied/opened
        # by SQLite. A second pass detects a changed or torn DB/WAL/SHM sample.
        for suffix, expected in before.items():
            if expected is not None:
                require(copy_and_hash(Path(str(db_path) + suffix), expected) == fingerprints[suffix], "SOURCE_CHANGED")
        require(source_state(db_path) == before, "SOURCE_CHANGED")
        with private_db.open("rb") as f:
            header = f.read(100)
        require(header.startswith(b"SQLite format 3\x00") and len(header) == 100, "DB_INVALID")
        # The WAL is deliberately present beside the private DB. A writable
        # private connection rebuilds its own SHM and consumes committed frames;
        # immutable=1 must not be used here because it can ignore an existing WAL.
        private = sqlite3.connect(private_db.as_uri() + "?mode=rw", uri=True, timeout=0.2)
        try:
            private.execute("PRAGMA query_only=ON")
            private.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
            page_size = private.execute("PRAGMA page_size").fetchone()[0]
            pages = private.execute("PRAGMA page_count").fetchone()[0]
            require(pages * page_size <= limits["snapshotBytes"], "SNAPSHOT_LIMIT")
            def progress(status, remaining, total):
                check_time()
                require(total * page_size <= limits["snapshotBytes"], "SNAPSHOT_LIMIT")
            private.backup(snapshot, pages=128, progress=progress, sleep=0.01)
        finally:
            private.close()

def collect():
    global target
    agent = None
    if mode == "container":
        root = Path("/home/box/sand-data/agents")
        require(root.is_dir() and not root.is_symlink(), "AGENT_NOT_FOUND")
        uuid = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")
        if target == "latest":
            choices = []
            with os.scandir(root) as entries:
                for count, entry in enumerate(entries):
                    require(count < 5000, "COLLECTION_LIMIT")
                    check_time()
                    if not uuid.fullmatch(entry.name) or not entry.is_dir(follow_symlinks=False):
                        continue
                    db = Path(entry.path) / "conversation-blobs.db"
                    try:
                        info = regular(db)
                        newest = info.st_mtime_ns
                        wal = Path(str(db) + "-wal")
                        if wal.exists():
                            newest = max(newest, regular(wal).st_mtime_ns)
                        choices.append((newest, entry.name))
                    except Failure:
                        continue
            require(bool(choices), "AGENT_NOT_FOUND")
            target = max(choices)[1]
        require(uuid.fullmatch(target) is not None, "UNSAFE_PATH")
        agent = root / target
        require(agent.is_dir(), "AGENT_NOT_FOUND")
        require(not agent.is_symlink() and agent.resolve().parent == root.resolve(), "UNSAFE_PATH")
        db_path = agent / "conversation-blobs.db"
        regular(db_path, "AGENT_NOT_FOUND")
    else:
        require(mode == "snapshot", "INVALID_ARGUMENT")
        db_path = Path(target)
        regular(db_path)
    snapshot = sqlite3.connect(":memory:")
    try:
        populate_snapshot(db_path, snapshot)
        snapshot.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
        columns = {row[1] for row in snapshot.execute("PRAGMA table_info(blobs)")}
        require({"id", "data"}.issubset(columns), "DB_INVALID")
        total = snapshot.execute("SELECT count(*) FROM blobs").fetchone()[0]
        metadata = snapshot.execute("SELECT rowid, substr(id,1,256), length(data) FROM blobs ORDER BY rowid DESC LIMIT ?", (limits["rows"],)).fetchall()
        rows, stored, skipped = [], 0, 0
        for rowid, blob_id, size in metadata:
            check_time()
            if size is None or size > limits["blobBytes"] or stored + size > limits["storedBytes"]:
                skipped += 1
                continue
            data = snapshot.execute("SELECT data FROM blobs WHERE rowid=?", (rowid,)).fetchone()[0]
            require(isinstance(data, bytes), "DB_INVALID")
            stored += len(data)
            rows.append({"id": str(blob_id), "data": base64.b64encode(data).decode("ascii")})
        rows.reverse()
        result = {"rows": rows, "coverage": {"totalRows": total, "selectedRows": len(metadata), "skippedRows": skipped,
                  "omittedRows": max(0, total - len(metadata)), "storedBytes": stored}, "agent": target if agent else None}
    finally:
        snapshot.close()
    if agent:
        attachments = agent / "attachments"
        if not attachments.exists():
            result["attachments"] = {"status": "missing"}
        elif attachments.is_symlink() or not attachments.is_dir():
            result["attachments"] = {"status": "unavailable"}
        else:
            files, limited = [], False
            with os.scandir(attachments) as entries:
                for index, entry in enumerate(entries):
                    check_time()
                    if index >= 200:
                        limited = True
                        break
                    if entry.is_file(follow_symlinks=False):
                        info = entry.stat(follow_symlinks=False)
                        files.append({"path": entry.path, "bytes": info.st_size})
            result["attachments"] = {"status": "ok", "files": files, "truncated": limited}
        result["audit"] = read_tail(agent / "audit.jsonl")
        result["hostLog"] = read_tail(Path("/tmp/sand-host.log"))
    return result

try:
    result = collect()
    check_time()
    encoded = json.dumps(result, separators=(",", ":")).encode("utf-8")
    require(len(encoded) <= limits["transferBytes"], "COLLECTION_LIMIT")
    sys.stdout.buffer.write(encoded)
except Failure as e:
    sys.stdout.write(json.dumps({"failure": str(e)}))
except sqlite3.Error:
    sys.stdout.write(json.dumps({"failure": "COLLECTION_TIMEOUT" if time.monotonic() >= deadline else "DB_INVALID"}))
except Exception:
    sys.stdout.write(json.dumps({"failure": "DIAGNOSTIC_FAILED"}))
`;

function dockerBinary() {
  const candidates = ["/usr/local/bin/docker", path.join(os.homedir(), ".orbstack/bin/docker"), "/opt/homebrew/bin/docker", "/Applications/Docker.app/Contents/Resources/bin/docker"];
  return candidates.find((candidate) => { try { accessSync(candidate, constants.X_OK); return true; } catch { return false; } }) ?? "docker";
}
function localTail(file) {
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (!info.isFile()) return { status: "unavailable" };
    const length = Math.min(info.size, LIMITS.tailBytes), start = info.size - length;
    const bytes = Buffer.alloc(length);
    const read = readSync(fd, bytes, 0, length, start);
    let text = bytes.subarray(0, read).toString("utf8");
    if (start) text = text.includes("\n") ? text.slice(text.indexOf("\n") + 1) : "";
    if (!text.endsWith("\n")) text = text.includes("\n") ? text.slice(0, text.lastIndexOf("\n") + 1) : "";
    return { status: "ok", text, truncated: start > 0 };
  } catch (error) { return { status: error.code === "ENOENT" ? "missing" : "unavailable" }; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function tailSummary(tail, summarize) {
  if (!tail || tail.status !== "ok") return { status: ["missing", "unavailable"].includes(tail?.status) ? tail.status : "not-collected" };
  if (typeof tail.text !== "string" || Buffer.byteLength(tail.text) > LIMITS.tailBytes * 3) fail("PROTOCOL_INVALID");
  return { status: "ok", truncated: tail.truncated === true, ...summarize(tail.text) };
}

export async function collectEvidence(options) {
  // Validate even for importers bypassing parseArgs.
  const validated = parseArgs(options.db ? ["--db", options.db, "--timeout-ms", String(options.timeoutMs ?? LIMITS.timeoutMs)]
    : [options.agent ?? "latest", ...(options.container ? ["--container", options.container] : []), "--timeout-ms", String(options.timeoutMs ?? LIMITS.timeoutMs)]);
  if (options.db && (options.container || (options.agent && options.agent !== "latest"))) fail("INVALID_ARGUMENT");
  options = validated;
  const deadline = Date.now() + options.timeoutMs;
  function remaining() { const value = deadline - Date.now(); if (value <= 0) fail("COLLECTION_TIMEOUT"); return value; }
  let container, command, commandArgs, env = process.env;
  if (options.db) {
    try { if (!lstatSync(options.db).isFile()) fail("DB_NOT_FOUND"); }
    catch (error) { if (error instanceof DiagnosticError) throw error; fail("DB_NOT_FOUND"); }
    command = "python3";
    commandArgs = [];
  } else {
    command = dockerBinary();
    const localCommand = (args) => runCommand(command, args, { timeoutMs: remaining(), maxOutputBytes: 16384 }).toString("utf8").trim();
    // Context inspection reads local Docker configuration only. Explicit --host
    // pins subsequent commands so a context change cannot redirect collection.
    let endpoint = process.env.DOCKER_CONTEXT ? "" : process.env.DOCKER_HOST ?? "";
    if (!endpoint) {
      const context = process.env.DOCKER_CONTEXT || localCommand(["context", "show"]);
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(context)) fail("LOCAL_DOCKER_REQUIRED");
      endpoint = localCommand(["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]);
    }
    if (!/^unix:\/\/\/[^\u0000-\u0020]+$/.test(endpoint)) fail("LOCAL_DOCKER_REQUIRED");
    env = { ...process.env };
    for (const key of ["DOCKER_CONTEXT", "DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete env[key];
    const prefix = ["--host", endpoint];
    const names = runCommand(command, [...prefix, "ps", "--filter", "name=^/(grok-node-local-vm|grok-bot-local-vm)$", "--format", "{{.Names}}"], { timeoutMs: remaining(), maxOutputBytes: 16384, env }).toString("utf8").trim().split("\n");
    container = selectContainer(names, options.container);
    commandArgs = [...prefix, "exec", "-i", container, "python3"];
  }
  const budget = Math.max(0.001, (remaining() - 50) / 1000);
  const raw = runCommand(command, [...commandArgs, "-", options.db ? "snapshot" : "container", options.db ?? options.agent, String(budget), JSON.stringify(LIMITS)],
    { input: SQLITE_COLLECTOR, timeoutMs: remaining(), maxOutputBytes: LIMITS.transferBytes, env });
  let collected;
  try { collected = JSON.parse(raw.toString("utf8")); } catch { fail("PROTOCOL_INVALID"); }
  if (collected.failure) fail(Object.hasOwn(FAILURE_MESSAGES, collected.failure) ? collected.failure : "DIAGNOSTIC_FAILED");
  if (!Array.isArray(collected.rows) || collected.rows.length > LIMITS.rows || !record(collected.coverage)) fail("PROTOCOL_INVALID");
  let bytes = 0;
  const blobs = collected.rows.map((row) => {
    if (typeof row.id !== "string" || typeof row.data !== "string" || row.data.length > Math.ceil(LIMITS.blobBytes / 3) * 4) fail("PROTOCOL_INVALID");
    const data = Buffer.from(row.data, "base64"); bytes += data.length;
    if (bytes > LIMITS.storedBytes) fail("PROTOCOL_INVALID");
    return { id: row.id, data };
  });
  const conversation = scanBlobs(blobs, { deadline });
  Object.assign(conversation.coverage, collected.coverage);
  const incomplete = conversation.coverage.limited || conversation.coverage.decodeFailures > 0 || collected.coverage.skippedRows > 0 || collected.coverage.omittedRows > 0;
  const report = { schemaVersion: 1, status: incomplete ? "partial" : "ok", collectedAt: new Date().toISOString(),
    source: options.db ? { mode: "snapshot", databaseRef: ref(options.db) } : { mode: "local-docker", container, agentId: collected.agent, selection: options.agent === "latest" ? "latest database/WAL mtime" : "explicit UUID" },
    limits: LIMITS, conversation,
    observations: [
      "Staging classifications reflect per-file markers in recorded attachment notes. An absent marker does not prove a staging failure; a present marker does not prove current file availability.",
      "Blob rows are sampled by insertion rowid, not transcript chronology. Binary/protobuf blobs are not interpreted as messages; unstructured notes are labeled separately.",
      "Tool errors come only from tool results, deduplicated by toolCallId; unidentified results use a content fingerprint. Unflagged results are counted only for recognized refusal/startup messages. Audit and log counts are separate samples and must not be added to tool-call counts.",
      "Paths, blob IDs, and tool call IDs are fingerprinted. Raw chat, tool arguments/results, commands, URLs, and credentials are omitted.",
    ] };
  if (container) {
    if (!UUID.test(collected.agent ?? "")) fail("PROTOCOL_INVALID");
    const attachments = collected.attachments;
    report.attachments = attachments?.status === "ok" ? { status: "ok", truncated: attachments.truncated === true,
      files: (attachments.files ?? []).slice(0, 200).map((file) => ({ ...fileReference(file.path), bytes: file.bytes })) } : { status: attachments?.status ?? "not-collected" };
    report.audit = tailSummary(collected.audit, summarizeAudit);
    report.hostLog = tailSummary(collected.hostLog, summarizeLog);
    const root = process.env.SAND_DATA_ROOT || path.join(os.homedir(), container === "grok-node-local-vm" ? ".groknode" : ".grokbot");
    report.localExecLog = tailSummary(localTail(path.join(root, "local-exec-daemon.log")), summarizeLog);
    if ([report.attachments, report.audit, report.hostLog, report.localExecLog].some((section) => section.status === "unavailable")) report.status = "partial";
    report.observations.push("Directory inventory and bounded log tails are separate observations taken after the DB backup. Missing optional files are reported as missing, not as a healthy state.");
  }
  remaining();
  return report;
}

const HELP = `Usage: node scripts/attachment-diagnostics.mjs [UUID|latest] [--container NAME] [--timeout-ms MS]
       node scripts/attachment-diagnostics.mjs --db /path/to/snapshot.db [--timeout-ms MS]
Known containers: ${CONTAINER_CANDIDATES.join(", ")}. Ambiguity requires --container.
Local Docker Unix socket only. Python 3 is required locally for --db, or in the container.
--db selects a standalone snapshot (or an open local WAL fixture); no Docker or logs are read.
JSON report goes to stdout. Source DB/WAL/SHM are never opened by SQLite.
Private DB/WAL copies (directory 0700, files 0600) are removed after collection.
Raw database/chat/log contents are not emitted.
Default total budget 15000ms, maximum 30000ms. All byte/row limits appear in the report.
Exit 0: evidence collected. Exit 1: invalid inputs, collection failure, or partial DB evidence.
`;

export async function main(argv = process.argv.slice(2), { collect = collectEvidence, write = (text) => process.stdout.write(text) } = {}) {
  try {
    const options = parseArgs(argv);
    if (options.help) { write(HELP); return 0; }
    const report = await collect(options);
    const output = JSON.stringify(report, null, 2) + "\n";
    if (Buffer.byteLength(output) > LIMITS.reportBytes) fail("REPORT_LIMIT");
    write(output);
    return report.status === "ok" ? 0 : 1;
  } catch (error) {
    const code = Object.hasOwn(FAILURE_MESSAGES, error?.code) ? error.code : "DIAGNOSTIC_FAILED";
    write(JSON.stringify({ schemaVersion: 1, status: "error", failure: { code, message: FAILURE_MESSAGES[code] } }, null, 2) + "\n");
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
