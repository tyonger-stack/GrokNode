import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { patchOriginalAgentModelCard } from "../scripts/lib/agent-model-renderer-patch.mjs";
import {
  COMPONENT_SOURCE,
  H3N_RETURN_WITH_DATA,
  H3N_RETURN_WITH_MODEL,
  NONE_SENTINEL,
  REQUIRED_CHUNK_BINDINGS,
  REUSED_CLASSES,
  assertAgentDataClassesResolve,
  patchOriginalAgentDataCards,
} from "../scripts/lib/agent-data-cards-renderer-patch.mjs";

const assetsRoot = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets");
const originalBundle = await readFile(path.join(assetsRoot, "index-UbX-y3il.js"), "utf8").catch(() => null);
const bundleSkip = originalBundle == null ? "src/app/dist is gitignored and only exists after npm run bootstrap; bundle assertions skipped." : false;
// The data-cards patch anchors on the agent-model patch's OUTPUT, so stage it first.
const bundle = originalBundle == null ? null : patchOriginalAgentModelCard(originalBundle);

const MAIN_EDGE_PATH = new URL("../source/electron-main/main-edge.ts", import.meta.url).pathname;
const PRELOAD_PATH = new URL("../source/electron-preload/preload.ts", import.meta.url).pathname;
const RPC_TABLE_PATH = new URL("../source/shared/rpc/main.ts", import.meta.url).pathname;
const READER_PATH = new URL("../source/electron-main/box/agent-data-reader.ts", import.meta.url).pathname;
const CLEAN_BUILD_PATH = new URL("../scripts/clean-build.mjs", import.meta.url).pathname;

const mainEdgeSource = await readFile(MAIN_EDGE_PATH, "utf8");
const preloadSource = await readFile(PRELOAD_PATH, "utf8");
const rpcTableSource = await readFile(RPC_TABLE_PATH, "utf8");
const readerSource = await readFile(READER_PATH, "utf8");
const cleanBuildSource = await readFile(CLEAN_BUILD_PATH, "utf8");

async function readPinnedStylesheets() {
  let sheets = "";
  for (const name of await readdir(assetsRoot).catch(() => [])) {
    if (name.endsWith(".css")) sheets += await readFile(path.join(assetsRoot, name), "utf8");
  }
  return sheets;
}

function topLevelBindings(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const names = new Set();
  const collect = (node) => {
    if (!node) return;
    if (node.type === "Identifier") names.add(node.name);
    else if (node.type === "ObjectPattern") for (const property of node.properties) collect(property.type === "RestElement" ? property.argument : property.value);
    else if (node.type === "ArrayPattern") for (const element of node.elements) collect(element);
    else if (node.type === "AssignmentPattern") collect(node.left);
    else if (node.type === "RestElement") collect(node.argument);
  };
  for (const statement of ast.body) {
    if ((statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") && statement.id) names.add(statement.id.name);
    else if (statement.type === "VariableDeclaration") for (const declarator of statement.declarations) collect(declarator.id);
    else if (statement.type === "ImportDeclaration") for (const specifier of statement.specifiers) names.add(specifier.local.name);
  }
  return names;
}

test("the injected source carries no backticks and no template syntax", () => {
  assert.equal(COMPONENT_SOURCE.includes("`"), false);
  assert.equal(COMPONENT_SOURCE.includes("${"), false);
});

test("every user-visible label is a direct RLocT literal pair (main-i18n scans literals, not helpers)", () => {
  const labels = ["Soul", "Memory", "Bot profile", "Audit", "Workflows", "View", "Hide", "Retry", "Loading…", "Bot data"];
  for (const label of labels) {
    assert.ok(COMPONENT_SOURCE.includes(`RLocT("${label}"`), `missing RLocT pair for ${label}`);
  }
});

test("the injected component parses on its own (with the chunk runtime stubbed)", () => {
  const harness = `const p={},S={useState:()=>[null,()=>{}],useEffect:()=>{},useRef:()=>({current:0})},re=()=>"",vt=null,so=null;function RLocT(a){return a}\n${COMPONENT_SOURCE}\nexport{RAgentDataCards};`;
  assert.doesNotThrow(() => parse(harness, { ecmaVersion: "latest", sourceType: "module" }));
});

test("the cards hook state survives group bots: the isGroup guard sits after every hook call", () => {
  const guardIndex = COMPONENT_SOURCE.indexOf("if(t.isGroup)return null;");
  assert.ok(guardIndex > 0, "isGroup guard must exist");
  for (const hook of ["S.useState(", "S.useEffect(", "S.useRef("]) {
    const lastIndex = COMPONENT_SOURCE.lastIndexOf(hook);
    assert.ok(lastIndex >= 0 && lastIndex < guardIndex, `${hook} calls must precede the isGroup guard (rules of hooks)`);
  }
});

test("the cards are appended once to h3n after the model card and the chunk still parses as a module", { skip: bundleSkip }, () => {
  const patched = patchOriginalAgentDataCards(bundle);
  assert.equal(patched.split("function RAgentDataCards(").length - 1, 1);
  assert.equal(patched.split(H3N_RETURN_WITH_DATA).length - 1, 1);
  assert.equal(patched.includes(H3N_RETURN_WITH_MODEL), false);
  // Anchor ordering inside the children array: identity, notifications, model card, data cards.
  const children = patched.slice(patched.indexOf(H3N_RETURN_WITH_DATA), patched.indexOf(H3N_RETURN_WITH_DATA) + 200);
  assert.ok(children.indexOf("RAgentModelCard") < children.indexOf("RAgentDataCards"));
  // main-i18n appends the RLocT runtime after this pass; mimic that before parsing for real.
  const dir = mkdtempSync(path.join(tmpdir(), "agent-data-chunk-"));
  const file = path.join(dir, "chunk.mjs");
  writeFileSync(file, `${patched}\nfunction RLocT(en,zh){return en}\n`);
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
});

test("a second application fails closed instead of injecting twice", { skip: bundleSkip }, () => {
  const patched = patchOriginalAgentDataCards(bundle);
  assert.throws(() => patchOriginalAgentDataCards(patched), /already injected/);
});

test("the patch refuses to run before the agent-model patch has landed", () => {
  const bare = `function other(){}\n${H3N_RETURN_WITH_MODEL.replace("p.jsx(RAgentModelCard,{agent:t}),", "")}\n`;
  assert.throws(() => patchOriginalAgentDataCards(bare), /agent-model patch/);
});

test("every chunk identifier the cards reach for is a module-level binding", { skip: bundleSkip }, () => {
  const bindings = topLevelBindings(patchOriginalAgentDataCards(bundle));
  for (const name of [...REQUIRED_CHUNK_BINDINGS, "RAgentModelCard", "RAgentDataCards", "RAgentDataNone"]) {
    assert.ok(bindings.has(name), `${name} must be bound on the module Program body`);
  }
});

test("the reused card classes all resolve in the pinned CSS", { skip: bundleSkip }, async () => {
  const css = await readPinnedStylesheets();
  assert.equal(assertAgentDataClassesResolve(css), REUSED_CLASSES.length);
  assert.throws(() => assertAgentDataClassesResolve(css.replaceAll(".sand-cq4si4", ".sand-zzzzzz")), /sand-cq4si4/);
});

test("the pipeline runs the data-cards patch after agent-model and before the i18n passes", () => {
  const afterModel = cleanBuildSource.indexOf("await applyOriginalRendererAgentModel({ stageRoot })");
  const dataCards = cleanBuildSource.indexOf("await applyOriginalRendererAgentDataCards({ stageRoot })");
  const mainI18n = cleanBuildSource.indexOf("await applyOriginalRendererMainI18n({ stageRoot })");
  assert.ok(afterModel >= 0 && dataCards > afterModel, "data-cards patch must run after the agent-model patch (it anchors on its output)");
  assert.ok(mainI18n >= 0 && dataCards < mainI18n, "data-cards patch must run before main-i18n appends the RLocT runtime");
});

test("the main edge serves the three reader methods and validates ids before reading", () => {
  for (const method of ["getAgentDataOverview", "getAgentMemoryLog", "getAgentWorkflowContent"]) {
    assert.ok(mainEdgeSource.includes(`${method}: async (raw) =>`), `main-edge must serve ${method}`);
  }
  assert.match(mainEdgeSource, /import \{ readAgentDataOverview, readAgentMemoryLog, readAgentWorkflowContent \} from "\.\/box\/agent-data-reader\.js";/);
  // The handlers pass the raw strings through: normalization lives in the reader and must stay there.
  assert.match(mainEdgeSource, /readAgentDataOverview\(agentId\)/);
});

test("the preload exposes the three bridges on the agent family", () => {
  for (const bridge of [
    'getAgentDataOverview: (agentId: string) => edge("getAgentDataOverview", { agentId })',
    'getAgentMemoryLog: (agentId: string, month: string) => edge("getAgentMemoryLog", { agentId, month })',
    'getAgentWorkflowContent: (slug: string) => edge("getAgentWorkflowContent", { slug })',
  ]) {
    assert.ok(preloadSource.includes(bridge), `preload must expose ${bridge}`);
  }
});

test("the RPC method table registers the three methods with object args", () => {
  for (const entry of [
    "getAgentDataOverview: { args: \"object\" }",
    "getAgentMemoryLog: { args: \"object\" }",
    "getAgentWorkflowContent: { args: \"object\" }",
  ]) {
    assert.ok(rpcTableSource.includes(entry), `rpc table must register ${entry}`);
  }
});

test("the reader whitelist is fixed and validation precedes every path build", () => {
  // Ids / months / slugs are normalized before any command string is built.
  for (const fn of ["readAgentDataOverview", "readAgentMemoryLog", "readAgentWorkflowContent"]) {
    const fnIndex = readerSource.indexOf(`export async function ${fn}`);
    assert.ok(fnIndex > 0, `${fn} must exist`);
    const body = readerSource.slice(fnIndex, readerSource.indexOf("}", readerSource.indexOf("normalize", fnIndex)));
    assert.match(body, /normalizeAgentId|normalizeMemoryMonth|normalizeWorkflowSlug/);
  }
  // The only box paths in the module are the five whitelisted subtrees.
  const readerCode = readerSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const forbidden = ["box-secrets", "host-secrets", "connector-secrets", "local-mcp-credentials", "teach-queue-key", "settings.json", "gateway.json"];
  for (const secret of forbidden) {
    assert.equal(readerCode.includes(secret), false, `reader must never reference ${secret}`);
  }
  const pathRoots = [...readerCode.matchAll(/const ([A-Z_]+) = `?\$\{BOX_DATA_ROOT\}[^`]*`?;/g)].map((m) => m[1]);
  assert.deepEqual(pathRoots.sort(), ["AGENT_DATA_ROOT", "USER_MEMORY_ROOT", "WORKFLOW_ROOT"].sort());
});

test("every read is byte-capped below the docker runner output window", () => {
  assert.match(readerSource, /TEXT_READ_CAP_BYTES = 128 \* 1024/);
  assert.match(readerSource, /AUDIT_TAIL_BYTES = 96 \* 1024/);
  // runDocker keeps only the LAST 200 KB of oversized output; a cap at or above that
  // window would silently lose the head of the file, so the caps must stay below it.
  const caps = [...readerSource.matchAll(/(\d+) \* 1024/g)].map((m) => Number(m[1]) * 1024);
  for (const cap of caps) assert.ok(cap < 200_000, `cap ${cap} must stay below runDocker's 200 KB output window`);
  assert.match(readerSource, /head -c \$\{TEXT_READ_CAP_BYTES \+ 1\}/);
  assert.match(readerSource, /tail -c \$\{AUDIT_TAIL_BYTES \+ 1\}/);
});

test("the audit parser drops a torn first line instead of guessing", () => {
  assert.match(readerSource, /!lines\[0\]\.trimStart\(\)\.startsWith\("\{"\)\s*\?\s*lines = lines\.slice\(1\)|trimStart\(\)\.startsWith/);
  assert.match(readerSource, /entries\.slice\(-AUDIT_MAX_ENTRIES\)\.reverse\(\)/);
});

test("the reader heals a leaked container pause before probing", () => {
  assert.match(readerSource, /\{\{\.State\.Paused\}\}/);
  assert.match(readerSource, /\["unpause", LOCAL_DOCKER_BOX_CONTAINER\]/);
});

test("the component guards loads against the none sentinel and races with sequence counters", () => {
  assert.ok(COMPONENT_SOURCE.includes(NONE_SENTINEL));
  assert.match(COMPONENT_SOURCE, /memSeq\.current!==n/);
  assert.match(COMPONENT_SOURCE, /wfSeq\.current!==n/);
});
