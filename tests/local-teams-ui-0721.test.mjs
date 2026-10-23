import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { parse } from "acorn";
import { applyLocalTeamsRendererPatch, buildLocalTeamsHostBundle, localTeamsStylePlugin, patchLocalTeamsSettingsPanel, patchLocalTeamsSettingsRegistry, LOCAL_TEAMS_PANEL_ANCHOR, LOCAL_TEAMS_REGISTRY_ANCHOR } from "../scripts/lib/local-teams-renderer-patch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidence = path.resolve(process.env.LOCAL_TEAMS_EVIDENCE_DIR ?? path.join(root, ".omo/evidence/local-teams-ui-0721"));
await mkdir(evidence, { recursive: true });
const compiled = await build({ absWorkingDir: root, entryPoints: ["frontend/src/recovered/features/local-teams-0721/bridge.ts"], bundle: true, platform: "node", format: "esm", write: false });
await writeFile(path.join(evidence, "bridge.mjs"), compiled.outputFiles[0].text);
const { localTeamsDesktop, grantFromForm, safeSignInUrl } = await import(path.join(evidence, "bridge.mjs"));
const status = { available: true, canManage: true, enabled: false, connected: false, magicDnsSuffix: null,
  detectedMagicDnsSuffix: "tail1234.ts.net", credentialConfigured: false, postureClientAvailable: false, signInUrl: null, rejection: null };

test("bridge forwards the exact local contracts and reads never connect", async () => {
  const calls = [], team = { teamId: "node-team:test", name: "Test", role: "owner" };
  const record = (method, result) => async (...args) => { calls.push({ method, args }); return result; };
  const api = localTeamsDesktop({ teams: { list: record("list", [team]), create: record("create", team),
    listMembers: record("listMembers", [{ accountId: "local", principalId: "owner", role: "owner" }]), setMember: record("setMember"),
    getAgentAccess: record("getAgentAccess", []), setAccessGrant: record("setAccessGrant", []) },
  tailnet: { getTeamTailnet: record("getTeamTailnet", { ...status, clientSecret: "MUST-NOT-RETURN" }), updateTeamTailnet: record("updateTeamTailnet", status),
    updateTeamTailnetCredential: record("updateTeamTailnetCredential", status), discoverTeamTailnetSuffix: record("discoverTeamTailnetSuffix", { magicDnsSuffix: "tail1234.ts.net", signInUrl: null, failureReason: null }), connectTeamTailnet: record("connectTeamTailnet", status) } });
  await api.list(); await api.create("Test"); await api.listMembers(team.teamId);
  const read = await api.getTailnet(team.teamId); await api.discover(team.teamId);
  assert.equal("clientSecret" in read, false);
  assert.equal(calls.some(c => c.method === "connectTeamTailnet"), false);
  await api.setMember({ teamId: team.teamId, accountId: "local", principalId: "member", role: "admin" });
  await api.setMember({ teamId: team.teamId, accountId: "local", principalId: "member", role: null });
  const grant = { kind: "agent", id: "bot-1", recipient: { kind: "team", teamId: team.teamId }, actions: ["view", "use", "create-automation"], expiresAtMs: null };
  await api.getAgentAccess("bot-1"); await api.setAccessGrant(grant, true); await api.setAccessGrant(grant, false);
  await api.updateTailnet({ teamId: team.teamId, enabled: true, magicDnsSuffix: "tail1234.ts.net", consent: true });
  await api.updateCredential({ teamId: team.teamId, clientId: "client", clientSecret: "fixture-secret" });
  await api.updateCredential({ teamId: team.teamId, remove: true }); await api.connect(team.teamId);
  assert.deepEqual(calls.map(c => c.method), ["list", "create", "listMembers", "getTeamTailnet", "discoverTeamTailnetSuffix", "setMember", "setMember", "getAgentAccess", "setAccessGrant", "setAccessGrant", "updateTeamTailnet", "updateTeamTailnetCredential", "updateTeamTailnetCredential", "connectTeamTailnet"]);
  assert.deepEqual(calls[0].args, []);
  assert.deepEqual(calls[3].args, [{ teamId: team.teamId }]);
  assert.deepEqual(calls[8].args, [{ grant, enabled: true }]);
  assert.deepEqual(calls[9].args, [{ grant, enabled: false }]);
  assert.deepEqual(calls[10].args, [{ teamId: team.teamId, enabled: true, magicDnsSuffix: "tail1234.ts.net", consent: true }]);
  assert.deepEqual(calls[12].args, [{ teamId: team.teamId, remove: true }]);
  await writeFile(path.join(evidence, "contract-calls.json"), JSON.stringify(calls, (key, value) => key === "clientSecret" ? "[fixture redacted]" : value, 2));
});

test("unknown recipients stay visible, credential errors cannot echo secrets, grants validate expiry", async () => {
  const api = localTeamsDesktop({ teams: { setMember: async () => { throw new Error("Recipient must be an enrolled local principal"); } }, tailnet: { updateTeamTailnetCredential: async () => { throw new Error("fixture-secret"); } } });
  await assert.rejects(api.setMember({ teamId: "t", accountId: "a", principalId: "unknown", role: "member" }), /enrolled local principal/);
  await assert.rejects(api.updateCredential({ teamId: "t", clientId: "c", clientSecret: "fixture-secret" }), error => !error.message.includes("fixture-secret"));
  const form = new FormData();
  for (const [key, value] of Object.entries({ kind: "store", resourceId: "store-1", recipientKind: "person", accountId: "a", principalId: "p", actions: "view", expires: "" })) form.append(key, value);
  assert.deepEqual(grantFromForm(form), { kind: "store", id: "store-1", recipient: { kind: "person", accountId: "a", principalId: "p" }, actions: ["view"], expiresAtMs: null });
  form.set("expires", "2000-01-01T00:00"); assert.throws(() => grantFromForm(form), /future/);
  form.set("expires", ""); form.delete("actions"); assert.throws(() => grantFromForm(form));
  assert.equal(safeSignInUrl("javascript:alert(1)"), null);
  assert.equal(safeSignInUrl("https://login.tailscale.com/a/test"), "https://login.tailscale.com/a/test");
  await writeFile(path.join(evidence, "failure-contracts.json"), JSON.stringify({ unknownRecipientVisible: true, credentialErrorRedacted: true, expiredGrantRejected: true, emptyActionsRejected: true, unsafeSignInRejected: true }, null, 2));
});

test("real old renderer settings patch parses, composes with Router, and rejects anchor drift", async () => {
  const renderer = path.join(evidence, "renderer"); await mkdir(path.join(renderer, "assets"), { recursive: true });
  for (const name of ["index-UbX-y3il.js", "index-BlqerJhg.js"]) await cp(path.join(root, "src/app/dist/renderer/assets", name), path.join(renderer, "assets", name));
  const result = await applyLocalTeamsRendererPatch(renderer);
  assert.equal(result.applied, true); assert.equal(result.files.length, 2);
  const bundle = await buildLocalTeamsHostBundle();
  const panel = await readFile(path.join(renderer, "assets/index-BlqerJhg.js"), "utf8");
  parse(panel, { ecmaVersion: "latest", sourceType: "module" });
  assert.ok(panel.includes('x==="local-teams"?a.jsx(Te,{children:a.jsx(RLocalTeams0721.RLocalTeamsHost,{})})'));
  assert.ok(bundle.includes("})(de,a)")); assert.ok(!/createRoot|MutationObserver/.test(bundle));
  assert.throws(() => patchLocalTeamsSettingsPanel(panel, bundle), /already exists/);
  assert.throws(() => patchLocalTeamsSettingsRegistry("no anchor"), /exactly once/);
  assert.throws(() => patchLocalTeamsSettingsRegistry(LOCAL_TEAMS_REGISTRY_ANCHOR.repeat(2)), /exactly once/);
  const withRouter = `${LOCAL_TEAMS_PANEL_ANCHOR}x==="router"?a.jsx(RRouterPanel,{}):null`;
  assert.ok(patchLocalTeamsSettingsPanel(withRouter, bundle).includes('x==="router"?a.jsx(RRouterPanel,{})'));
  await writeFile(path.join(evidence, "renderer-validation.json"), JSON.stringify({ ...result, parses: true, sharesReact: true, routerPreserved: true, rejectsDrift: true }, null, 2));
});

test("build browser interaction fixture from production mount", async () => {
  const source = `import React from 'react'; import * as jsx from 'react/jsx-runtime'; import {createRoot} from 'react-dom/client';
const de=React,a=jsx;
${await buildLocalTeamsHostBundle()}
const calls=window.__calls=[]; let teams=[],members=[{accountId:'local',principalId:'owner',role:'owner'}],grants=[];
let status=${JSON.stringify(status)};
const record=(name,fn)=>async (arg)=>{calls.push({name,arg:arg&&'clientSecret' in arg?{...arg,clientSecret:'[redacted]'}:arg});return fn(arg);};
window.desktop={teams:{list:record('list',()=>structuredClone(teams)),create:record('create',a=>{const t={teamId:'node-team:'+teams.length,name:a.name,role:'owner'};teams.push(t);return t}),
listMembers:record('listMembers',()=>structuredClone(members)),setMember:record('setMember',a=>{if(a.accountId!=='local'||!['owner','member'].includes(a.principalId))throw Error('Recipient must be an enrolled local principal');members=members.filter(m=>m.principalId!==a.principalId);if(a.role)members.push(a)}),
getAgentAccess:record('getAgentAccess',()=>structuredClone(grants)),setAccessGrant:record('setAccessGrant',a=>{if(a.grant.recipient.kind==='person'&&a.grant.recipient.principalId!=='member')throw Error('Recipient must be an enrolled local principal');grants=a.enabled?[a.grant]:[];return structuredClone(grants)})},
tailnet:{getTeamTailnet:record('getTeamTailnet',()=>structuredClone(status)),discoverTeamTailnetSuffix:record('discoverTeamTailnetSuffix',()=>({magicDnsSuffix:status.detectedMagicDnsSuffix,signInUrl:null,failureReason:null})),
updateTeamTailnet:record('updateTeamTailnet',a=>{status={...status,...a};return structuredClone(status)}),updateTeamTailnetCredential:record('updateTeamTailnetCredential',a=>{status={...status,credentialConfigured:!a.remove};return structuredClone(status)}),
connectTeamTailnet:record('connectTeamTailnet',()=>{status={...status,connected:true};return structuredClone(status)})}};
window.__setRole=(role)=>{teams=teams.map(t=>({...t,role}));status.canManage=role!=='member'};
window.__setStatus=(patch)=>Object.assign(status,patch);
function Settings(){const [open,setOpen]=React.useState(false);return <><nav><button onClick={()=>setOpen(!open)}>Local teams & Tailnet</button></nav>{open?<RLocalTeams0721.RLocalTeamsHost/>:<h1>Settings fixture</h1>}</>};
createRoot(document.getElementById('root')).render(<Settings/>);`;
  const result = await build({ absWorkingDir: root, stdin: { contents: source, loader: "tsx", resolveDir: root }, bundle: true, format: "iife", write: false, jsx: "automatic", plugins: [localTeamsStylePlugin()] });
  await writeFile(path.join(evidence, "browser-fixture.js"), result.outputFiles[0].text);
  await writeFile(path.join(evidence, "browser-fixture.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local teams contract fixture</title><style>:root{--sand-text-primary:#292929;--sand-text-secondary:#666;--sand-text-tertiary:#777;--sand-bg-elevated:#fff;--sand-border-secondary-translucent:#ddd;--sand-border-tertiary-translucent:#e4e4e4;--sand-border-primary-translucent:#999;--cursor-font-size-base:13px;--cursor-radius-xl:12px}body{margin:0;background:#fafafa;font-family:system-ui}#root{max-width:780px;margin:auto}nav{padding:16px}</style><div id="root"></div><script src="/browser-fixture.js"></script></html>`);
  assert.ok(result.outputFiles[0].text.includes("RLocalTeamsHost"));
});

if (process.env.LOCAL_TEAMS_UI_SERVE === "1") {
  createServer(async (request, response) => {
    try {
      const file = request.url === "/browser-fixture.js" ? "browser-fixture.js" : "browser-fixture.html";
      response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : "text/html");
      response.end(await readFile(path.join(evidence, file)));
    } catch { response.statusCode = 503; response.end("Fixture build pending"); }
  }).listen(18721, "127.0.0.1", () => console.log("LOCAL_TEAMS_UI_FIXTURE http://127.0.0.1:18721"));
}
