import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const repo = fileURLToPath(new URL("../", import.meta.url));
const evidence = process.env.LIBRARY_0721_EVIDENCE_DIR;
const base = evidence ? path.resolve(evidence) : path.join(repo, "node_modules/.cache");
await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, "library-http-0721-"));
const output = path.join(root, "runtime.mjs");
const built = await build({
  stdin: { resolveDir: repo, contents: [
    "host/extensions/library/extension", "host/extensions/library/http",
    "host/extensions/library/http-routes", "host/extensions/transcript/visualization-pages",
    "shared/library/schemas", "shared/library-pins",
  ].map(name => `export * from "./source/${name}.ts";`).join("\n") },
  outfile: output, bundle: true, platform: "node", format: "esm", external: ["undici"],
  metafile: true, logLevel: "silent",
});
const lib = await import(pathToFileURL(output).href);
await writeFile(path.join(root, "bundle-inputs.json"), JSON.stringify(built.metafile, null, 2));
const observations = [];
test.after(async () => {
  if (evidence) await writeFile(path.join(root, "responses.json"), JSON.stringify(observations,
    (key, value) => key === "credential" ? "[test credential redacted]" : value, 2));
  else await rm(root, { recursive: true, force: true });
});

async function fixture(t, name) {
  const dataRoot = path.join(root, name);
  const agentDir = path.join(dataRoot, "agent-a");
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const pages = lib.createVisualizationPages({ agentId: "agent-a", agentDir });
  const html = "<h1>Persisted visual</h1>";
  const { sha256 } = await pages.save(html);
  let reads = 0;
  const options = { dataRoot, providerOrigin: "https://groknode.local", transcript: {
    getAgentTranscriptPage: () => [],
    readVisualizationFragment: async args => { reads++; return pages.read(args); },
  } };
  let service = lib.createLibraryHostService(options);
  const owner = service.catalog.identity.createLocalPrincipal("owner");
  const foreign = service.catalog.identity.createLocalPrincipal("foreign");
  service.catalog.identity.assignAgent({ ...owner, agentId: "agent-a" }, true);
  service.catalog.access.registerOwner({ kind: "agent", id: "agent-a" }, owner);
  let dispatch = lib.createLibraryHttpDispatcher(service);
  const call = async (method, args, credential = owner.credential) => {
    const response = await dispatch({ method, args }, credential, AbortSignal.timeout(5000));
    observations.push({ scenario: name, method, args, principal: credential === owner.credential ? "owner" : "other", response });
    return response;
  };
  const ok = async (method, args, credential) => {
    const response = await call(method, args, credential);
    assert.equal(response.status, 200, `${method}: ${JSON.stringify(response.body)}`);
    return response.body.result;
  };
  t.after(() => service.dispose());
  return { owner, foreign, call, ok, pages, html, sha256, agentDir,
    service: () => service, reads: () => reads,
    restart() { service.dispose(); service = lib.createLibraryHostService(options); dispatch = lib.createLibraryHttpDispatcher(service); },
  };
}

const pins = [
  { kind: "page", page: { kind: "document", storeId: "node-store", documentId: "doc-test" } },
  { kind: "page", page: { kind: "canvas", storeId: "node-store", canvasId: "123e4567-e89b-12d3-a456-426614174000" } },
  { kind: "media", media: { kind: "link", url: "https://example.com", timestampMs: null } },
  ...["image", "video", "file"].map(kind => ({ kind: "media", media: { kind, source: `sand://file/${kind}`, name: kind, timestampMs: 123 } })),
  { kind: "external-doc", key: "external-document" },
  { kind: "app", key: "app-test" },
];
const pinKeys = values => values.map(lib.libraryPinKey).sort();

test("authenticated pin methods persist every variant, merge idempotently and isolate principals", async t => {
  const f = await fixture(t, "pins");
  assert.deepEqual(await f.ok("listLibraryPins", { agentId: "agent-a" }), []);
  assert.deepEqual(await f.ok("setLibraryPin", { agentId: "agent-a", pin: pins[0], isPinned: true }), [pins[0]]);
  assert.deepEqual(pinKeys(await f.ok("mergeLibraryPins", { agentId: "agent-a", pins })), pinKeys(pins));
  assert.equal((await f.ok("mergeLibraryPins", { agentId: "agent-a", pins })).length, pins.length);
  assert.equal((await f.call("listLibraryPins", { agentId: "agent-a" }, f.foreign.credential)).status, 403);
  assert.equal((await f.call("setLibraryPin", { agentId: "agent-a", pin: pins[0], isPinned: false }, f.foreign.credential)).status, 403);
  assert.equal((await f.call("mergeLibraryPins", { agentId: "agent-a", pins }, f.foreign.credential)).status, 403);
  f.service().catalog.identity.assignAgent({ ...f.foreign, agentId: "agent-a" }, true);
  assert.deepEqual(await f.ok("listLibraryPins", { agentId: "agent-a" }, f.foreign.credential), []);
  f.restart();
  assert.deepEqual(pinKeys(await f.ok("listLibraryPins", { agentId: "agent-a" })), pinKeys(pins));
  assert.equal((await f.ok("setLibraryPin", { agentId: "agent-a", pin: pins[0], isPinned: false })).length, pins.length - 1);
  assert.equal((await f.call("listLibraryPins", { agentId: "foreign-agent" })).status, 403);
});

test("team and access methods enforce ownership, view/use rights and revocation", async t => {
  const f = await fixture(t, "teams");
  const team = await f.ok("createLocalTeam", { name: "  Local team  " });
  assert.deepEqual(team, { teamId: team.teamId, name: "Local team", role: "owner" });
  assert.deepEqual(await f.ok("listLocalTeams", {}), [team]);
  assert.deepEqual(await f.ok("listLocalTeams", {}, f.foreign.credential), []);
  assert.deepEqual(await f.ok("checkLocalTeamAccess", { teamId: team.teamId, action: "manage" }), { authorized: true });
  assert.equal((await f.call("checkLocalTeamAccess", { teamId: team.teamId, action: "view" }, f.foreign.credential)).status, 403);
  const member = { teamId: team.teamId, accountId: f.foreign.accountId, principalId: f.foreign.principalId, role: "member" };
  assert.equal(await f.ok("setLocalTeamMember", member), null);
  assert.deepEqual(await f.ok("checkLocalTeamAccess", { teamId: team.teamId, action: "view" }, f.foreign.credential), { authorized: true });
  assert.equal((await f.call("checkLocalTeamAccess", { teamId: team.teamId, action: "manage" }, f.foreign.credential)).status, 403);
  assert.equal((await f.ok("listLocalTeamMembers", { teamId: team.teamId })).length, 2);
  assert.equal((await f.call("listLocalTeamMembers", { teamId: team.teamId }, f.foreign.credential)).status, 403);
  assert.equal((await f.call("setLocalTeamMember", { ...member, role: "admin" }, f.foreign.credential)).status, 403);
  assert.equal((await f.call("setLocalTeamMember", { ...member, accountId: f.owner.accountId, principalId: f.owner.principalId, role: null })).status, 403);
  const grant = { kind: "agent", id: "agent-a", recipient: { kind: "team", teamId: team.teamId }, expiresAtMs: null, actions: ["view"] };
  assert.deepEqual(await f.ok("setLocalAccessGrant", { grant, enabled: true }), [grant]);
  assert.deepEqual(await f.ok("getLocalAgentAccess", { agentId: "agent-a" }), [grant]);
  assert.equal((await f.call("getLocalAgentAccess", { agentId: "agent-a" }, f.foreign.credential)).status, 403);
  assert.equal((await f.call("setLocalAccessGrant", { grant, enabled: false }, f.foreign.credential)).status, 403);
  assert.deepEqual(await f.ok("listLibraryPins", { agentId: "agent-a" }, f.foreign.credential), []);
  const invited = () => f.service().catalog.identity.resolveCredential(f.foreign.credential, AbortSignal.timeout(5000));
  assert.throws(() => f.service().catalog.identity.requireAgent(invited(), "agent-a", "use"));
  f.restart();
  assert.equal((await f.ok("listLocalTeams", {}, f.foreign.credential))[0].role, "member");
  assert.deepEqual(await f.ok("getLocalAgentAccess", { agentId: "agent-a" }), [grant]);
  assert.equal(await f.ok("setLocalTeamMember", { ...member, role: null }), null);
  assert.equal((await f.call("checkLocalTeamAccess", { teamId: team.teamId, action: "view" }, f.foreign.credential)).status, 403);
  assert.equal((await f.call("listLibraryPins", { agentId: "agent-a" }, f.foreign.credential)).status, 403);
  assert.deepEqual(await f.ok("setLocalAccessGrant", { grant, enabled: false }), []);
  const personGrant = { ...grant, recipient: { kind: "person", accountId: f.foreign.accountId, principalId: f.foreign.principalId }, actions: ["view", "use", "create-automation"] };
  assert.deepEqual(await f.ok("setLocalAccessGrant", { grant: personGrant, enabled: true }), [personGrant]);
  assert.doesNotThrow(() => f.service().catalog.identity.requireAgent(invited(), "agent-a", "use"));
  await f.ok("setLocalAccessGrant", { grant: { ...personGrant, expiresAtMs: 1 }, enabled: true });
  assert.equal((await f.call("listLibraryPins", { agentId: "agent-a" }, f.foreign.credential)).status, 403);
});

test("visualization envelopes read the saved fragment and deny foreign callers before storage", async t => {
  const f = await fixture(t, "visualization");
  const args = { agentId: "agent-a", entryId: "entry-a", documentSha256: f.sha256 };
  assert.equal((await f.call("readVisualizationFragment", args, f.foreign.credential)).status, 403);
  assert.equal(f.reads(), 0);
  assert.deepEqual(await f.ok("readVisualizationFragment", args), { html: f.html });
  f.restart();
  assert.deepEqual(await f.ok("readVisualizationFragment", args), { html: f.html });
  assert.equal(await readFile(path.join(f.agentDir, "visualizations", `${f.sha256}.html`), "utf8"), f.html);
  await writeFile(path.join(f.agentDir, "visualizations", `${f.sha256}.html`), "tampered");
  assert.equal((await f.call("readVisualizationFragment", args)).status, 500);
});

test("every local method rejects invalid params and identity injection without mutating storage", async t => {
  const f = await fixture(t, "invalid");
  const malformed = {
    listLibraryPins: { agentId: "agent-a\0" },
    setLibraryPin: { agentId: "agent-a", pin: { kind: "page", page: { kind: "document", storeId: "../escape", documentId: "doc-test" } }, isPinned: true },
    mergeLibraryPins: { agentId: "agent-a", pins: Array(1001).fill(pins[0]) },
    readVisualizationFragment: { agentId: "agent-a", entryId: "entry-a", documentSha256: "bad" },
    listLocalTeams: { credential: f.foreign.credential },
    checkLocalTeamAccess: { teamId: "team", action: "owner" },
    createLocalTeam: { name: " " },
    listLocalTeamMembers: { teamId: "" },
    setLocalTeamMember: { teamId: "team", accountId: "a", principalId: "p", role: "owner" },
    getLocalAgentAccess: { agentId: "" },
    setLocalAccessGrant: { grant: { kind: "agent", id: "agent-a", recipient: { kind: "person", accountId: "a", principalId: "p" }, expiresAtMs: null, actions: ["admin"] }, enabled: true },
  };
  for (const [method, args] of Object.entries(malformed)) assert.equal((await f.call(method, args)).status, 400, method);
  const valid = {
    listLibraryPins: { agentId: "agent-a" }, setLibraryPin: { agentId: "agent-a", pin: pins[0], isPinned: true },
    mergeLibraryPins: { agentId: "agent-a", pins: [] },
    readVisualizationFragment: { agentId: "agent-a", entryId: "entry-a", documentSha256: f.sha256 },
    listLocalTeams: {}, createLocalTeam: { name: "valid" }, listLocalTeamMembers: { teamId: "team" },
    checkLocalTeamAccess: { teamId: "team", action: "view" },
    setLocalTeamMember: { teamId: "team", accountId: "a", principalId: "p", role: null },
    getLocalAgentAccess: { agentId: "agent-a" },
    setLocalAccessGrant: { grant: { kind: "store", id: "store", recipient: { kind: "team", teamId: "team" }, expiresAtMs: null, actions: ["view"] }, enabled: true },
  };
  for (const [method, args] of Object.entries(valid)) {
    assert.equal((await f.call(method, args, null)).status, 401, method);
    assert.equal((await f.call(method, args, "invalid-credential")).status, 401, method);
    assert.equal((await f.call(method, { ...args, credential: f.foreign.credential })).status, 400, method);
  }
  for (const method of ["mainCredential", "executionBase", "dispose", "constructor", "__proto__"]) {
    assert.equal((await f.call(method, {})).status, 400, method);
  }
  assert.deepEqual(await f.ok("listLibraryPins", { agentId: "agent-a" }), []);
  assert.deepEqual(await f.ok("listLocalTeams", {}), []);
  assert.equal(f.reads(), 0);
});

test("schemas reject malformed results and routing preserves the authenticated POST boundary", () => {
  assert.deepEqual(lib.parseLibraryHttpRoute("POST", "/rpc"), { kind: "rpc" });
  assert.deepEqual(lib.libraryHttpRouteMethod({ kind: "rpc" }), ["POST"]);
  for (const target of ["/rpc/", "/rpc?method=dispose", "/rpc#fragment", "/../rpc", "/%72pc"]) {
    assert.equal(lib.parseLibraryHttpRoute("POST", target), null);
  }
  const badResults = { listLibraryPins: [{}], setLibraryPin: null, mergeLibraryPins: [null],
    checkLocalTeamAccess: { authorized: false },
    readVisualizationFragment: { html: 42 }, listLocalTeams: [{ teamId: "x", name: "x", role: "superuser" }],
    createLocalTeam: { teamId: "x", name: "x", role: "member" },
    listLocalTeamMembers: [{ accountId: "x", principalId: "x", role: null }],
    setLocalTeamMember: true, getLocalAgentAccess: [{}], setLocalAccessGrant: [{}] };
  for (const [method, result] of Object.entries(badResults)) {
    assert.equal(lib.libraryResultSchemas[method].safeParse(result).success, false, method);
  }
  assert.equal(lib.libraryHttpEnvelopeSchema.safeParse({ method: "listLocalTeams", args: {}, credential: "injected" }).success, false);
});
