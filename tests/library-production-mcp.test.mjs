import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
const out = mkdtempSync(path.resolve("node_modules/.cache/library-mcp-"));
test.after(() => rmSync(out, { recursive: true, force: true }));
await build({stdin:{contents:'export * from "./source/host/extensions/library/extension.ts"; export * from "./source/shared/library/mcp-result-hook.ts";',resolveDir:process.cwd()},bundle:true,platform:"node",format:"esm",external:["undici"],outfile:path.join(out,"library.mjs"),logLevel:"silent"});
const lib = await import(path.join(out,"library.mjs"));
const raw = id => ({ result:{ case:"success", value:{ content:[], structuredContent:{ url:`https://www.notion.so/${id}` } } } });
const notify = (id, toolCallId = undefined) => lib.notifyLibraryMcpResult({
  providerIdentifier:"Notion:notion", toolName:"notion-create-pages", ...(toolCallId === undefined ? {} : { toolCallId }), agentId:"existing-bot", displayName:"Notion",
  args:{ page_id:id }, raw:raw(id),
});
function serviceIn(name) {
  const service = lib.createLibraryHostService({dataRoot:path.join(out,name),transcript:{listAgentIds:()=>["existing-bot"],getAgentTranscriptPage:()=>({entries:[]})}});
  return {service,credential:service.mainCredential()};
}
test("captured executor context uses generated execId when notification omits toolCallId",async()=>{
 const {service,credential}=serviceIn("execid");
 try {
  let capturedSignal;
  const validating = lib.captureLibraryMcpExecution({
   service:{
    mainCredential:()=>credential,
    runMcpExecution:(args,signal,work)=>{capturedSignal=signal;return service.runMcpExecution(args,signal,work);},
   },
   agentId:"existing-bot",storeId:lib.LIBRARY_MAIN_STORE,connectorAccountOf:args=>args.providerIdentifier ?? "default",
   inner:{async execute(){notify("1234567890abcdef1234567890abcdef")}},
  });
  await validating.execute({}, {providerIdentifier:"Notion:notion"}, {execId:"generated-exec-1"});
  assert.equal(Object.prototype.toString.call(capturedSignal),"[object AbortSignal]");
  assert.equal(typeof capturedSignal.addEventListener,"function");
  assert.equal(capturedSignal.aborted,false);
  assert.equal((await service.listLibraryDocs({credential,agentId:"existing-bot"},AbortSignal.timeout(5000))).docs.length,1);
 } finally {service.dispose();}
});
test("production executor wrapper registers concurrent completions under each captured identity",async()=>{
 const {service,credential}=serviceIn("concurrent");
 try {
  let release; const gate=new Promise(resolve=>{release=resolve;});
  const executor = id => lib.captureLibraryMcpExecution({service,agentId:"existing-bot",storeId:lib.LIBRARY_MAIN_STORE,connectorAccountOf:args=>args.providerIdentifier ?? "default",inner:{async execute(){if(id.endsWith("1")) await gate;notify(id,id);}}});
  const first=executor("1234567890abcdef1234567890abcde1").execute({}, {providerIdentifier:"Notion:notion",toolCallId:"1234567890abcdef1234567890abcde1"});
  const second=executor("1234567890abcdef1234567890abcde2").execute({}, {providerIdentifier:"Notion:notion",toolCallId:"1234567890abcdef1234567890abcde2"});
  await second; release(); await first;
  const docs=await service.listLibraryDocs({credential,agentId:"existing-bot"},AbortSignal.timeout(5000));
  assert.equal(docs.docs.length,2);
 } finally {service.dispose();}
});
test("host runner wires the capture around its actual MCP executor",()=>{
 const source=readFileSync(path.resolve("source/host/host-runner-composition.ts"),"utf8");
 assert.match(source,/const inner = createMcpExecutor\(persistImage, spillLargeText, auditIdentity\)/);
 assert.match(source,/return capture === undefined \|\| credentialOf === undefined \? inner : captureLibraryMcpExecution\(\{/);
 assert.match(source,/runMcpExecution: capture/);
});
