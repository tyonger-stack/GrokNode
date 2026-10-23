import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

const cache = path.resolve("node_modules/.cache");
await mkdir(cache, { recursive: true });
const root = await mkdtemp(path.join(cache, "local-0721-access-"));
const output = path.join(root, "catalog.mjs");
await build({ entryPoints: ["source/host/extensions/library/catalog.ts"], outfile: output,
  bundle: true, platform: "node", format: "esm", logLevel: "silent" });
const { LibraryCatalog } = await import(pathToFileURL(output).href);
const signal = AbortSignal.timeout(10000);
const context = (catalog, principal) => catalog.identity.resolveCredential(principal.credential, signal);

test("local team grants preserve distinct view/use rights and revocation across restart", () => {
  const options = { dataRoot: path.join(root, "teams"), providerOrigin: "https://groknode.local" };
  let catalog = new LibraryCatalog(options);
  const owner = catalog.identity.createLocalPrincipal("owner-account");
  const member = catalog.identity.createLocalPrincipal("member-account");
  const outsider = catalog.identity.createLocalPrincipal("outsider-account");
  const own = context(catalog, owner), invited = context(catalog, member), other = context(catalog, outsider);
  catalog.identity.assignAgent({ ...owner, agentId: "bot-a" }, true);
  catalog.access.registerOwner({ kind: "agent", id: "bot-a" }, owner);
  const team = catalog.access.createTeam(own, "Local team");
  catalog.access.setMember(own, { teamId: team.teamId, accountId: member.accountId, principalId: member.principalId, role: "member" });
  const grant = { kind: "agent", id: "bot-a", recipient: { kind: "team", teamId: team.teamId }, expiresAtMs: null, actions: ["view"] };
  catalog.access.setGrant(own, grant, true);
  assert.doesNotThrow(() => catalog.identity.requireAgent(invited, "bot-a"));
  assert.throws(() => catalog.identity.requireAgent(invited, "bot-a", "use"), /Agent membership required/);
  assert.throws(() => catalog.identity.requireAgent(other, "bot-a"), /Agent membership required/);
  assert.throws(() => catalog.access.setGrant(invited, grant, false), /Resource owner required/);
  assert.throws(() => catalog.access.setMember(invited, { teamId: team.teamId, accountId: outsider.accountId,
    principalId: outsider.principalId, role: "admin" }), /administrator required/);
  catalog.close();
  catalog = new LibraryCatalog(options);
  assert.equal(catalog.access.listTeams(context(catalog, member))[0].teamId, team.teamId);
  assert.doesNotThrow(() => catalog.identity.requireAgent(context(catalog, member), "bot-a"));
  catalog.access.setMember(context(catalog, owner), { teamId: team.teamId, accountId: member.accountId,
    principalId: member.principalId, role: null });
  assert.throws(() => catalog.identity.requireAgent(context(catalog, member), "bot-a"), /Agent membership required/);
  catalog.access.setGrant(context(catalog, owner), { ...grant, recipient: { kind: "person", accountId: member.accountId,
    principalId: member.principalId }, expiresAtMs: Date.now() - 1 }, true);
  assert.throws(() => catalog.identity.requireAgent(context(catalog, member), "bot-a"), /Agent membership required/);
  assert.throws(() => catalog.access.setMember(context(catalog, owner), { teamId: team.teamId, accountId: owner.accountId,
    principalId: owner.principalId, role: null }), /owner cannot/);
  catalog.close();
});

test("all four original Library pin targets roundtrip, merge idempotently and remain scoped", () => {
  const options = { dataRoot: path.join(root, "pins"), providerOrigin: "https://groknode.local" };
  let catalog = new LibraryCatalog(options);
  const owner = catalog.identity.createLocalPrincipal("account");
  const member = catalog.identity.createLocalPrincipal("account");
  catalog.identity.assignAgent({ ...owner, agentId: "bot-a" }, true);
  catalog.identity.assignAgent({ ...member, agentId: "bot-a" }, true);
  const pins = [
    { kind: "page", page: { kind: "document", storeId: "node-store", documentId: "doc-test" } },
    { kind: "media", media: { kind: "file", source: "sand://file/test.csv", name: "test.csv", timestampMs: null } },
    { kind: "external-doc", key: "https://example.com/doc" },
    { kind: "app", key: "app-test" },
  ];
  const own = context(catalog, owner);
  assert.equal(catalog.pins.merge(own, "bot-a", pins).length, 4);
  assert.equal(catalog.pins.merge(own, "bot-a", pins).length, 4);
  assert.equal(catalog.pins.list(context(catalog, member), "bot-a").length, 0);
  catalog.close();
  catalog = new LibraryCatalog(options);
  assert.equal(catalog.pins.list(context(catalog, owner), "bot-a").length, 4);
  assert.equal(catalog.pins.set(context(catalog, owner), "bot-a", pins[0], false).length, 3);
  assert.throws(() => catalog.pins.list(context(catalog, owner), "bot-b"), /Agent membership required/);
  catalog.close();
});

test.after(async () => { await rm(root, { recursive: true, force: true }); });
