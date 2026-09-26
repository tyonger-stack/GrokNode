import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { parse } from "acorn";
import { patchOriginalAutoReviewApproval } from "../scripts/lib/auto-review-renderer-patch.mjs";

const rendererDir = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets");
const RENDERER_ANCHOR = "async function de(t,e){if(e===void 0)";

async function findRendererSource() {
  let entries;
  try {
    entries = await readdir(rendererDir);
  } catch {
    return null;
  }
  const candidates = entries.filter((name) => name.startsWith("view-") && name.endsWith(".js")).sort();
  for (const name of candidates) {
    const text = await readFile(path.join(rendererDir, name), "utf8");
    if (text.includes(RENDERER_ANCHOR)) return { name, text };
  }
  return null;
}

const found = await findRendererSource();
const source = found?.text ?? null;
const bundleSkip = found
  ? false
  : "src/app/dist is gitignored and only exists after `npm run bootstrap` (macOS DMG mount); bundle assertions skipped.";

const syntheticSource = [
  'function ne(t){switch(t.status){case"ready":return t.value;default:return}}',
  'async function de(t,e){if(e===void 0)return"approved";try{await t.load();const s=ne(t.snapshots.get());return s==null?"approved":(await t.setInstructions(W(s,e)),"always")}catch{return"approved"}}',
  'async function pe(t){const{agentId:e,entryId:s,requestId:n,resolution:a,loadAlwaysAllow:l,resolveAutoReviewApproval:i}=t;let o=a;a==="always"&&(o=await l());try{const r=await i({entryId:s,requestId:n,resolution:o,agentId:e});D({agentId:e,entryId:s,status:r==="stale"?"expired":o})}catch{H({agentId:e,entryId:s})}}',
  "function me(t){const e=P.c(43);return e}",
  "function call(t){i(L),pe({entryId:t})}",
  "function settle(p){p.then(()=>i(void 0),()=>i(void 0))}",
  "function note(){_=ue(u,N)}",
  "const surface={loadAlwaysAllow:()=>de(r.autoReviewInstructions,N)}",
  "// :j=e[42],j}function we(t)",
  "function we(t){return t}",
].join("\n");

test("renderer patch applies to the anchor fixture and stays fail-closed", () => {
  const patched = patchOriginalAutoReviewApproval(syntheticSource);
  assert.ok(patched.includes("Always allow all Shell commands on this local Docker VM."));
  assert.ok(patched.includes("No reusable rule is available."));
  assert.ok(patched.includes('a.surface==="box_shell"'));
  assert.ok(patched.includes('role:"alert"'));
  assert.ok(patched.includes("setArError"));
  assert.ok(patched.includes("throw error"));
  assert.ok(!patched.includes(RENDERER_ANCHOR), "patched fixture must not retain the original loader");
  assert.throws(() => patchOriginalAutoReviewApproval(patched), /missing or ambiguous/);
});

test("patched anchor fixture still parses as a module", () => {
  const patched = patchOriginalAutoReviewApproval(syntheticSource);
  assert.doesNotThrow(() => parse(patched, { sourceType: "module", ecmaVersion: "latest" }));
});

function harness(bundleText) {
  const patched = patchOriginalAutoReviewApproval(bundleText);
  const ast = parse(patched, { sourceType: "module", ecmaVersion: "latest" });
  const LOCAL_DOCKER_SHELL_RULE = "Always allow all Shell commands on this local Docker VM.";
  const changes = [], savedRules = [], context = { Error, W: (s, rule) => { savedRules.push(rule); return { ...s, allowInstructions: [...s.allowInstructions, rule] }; }, D: value => changes.push(value), H: value => changes.push({ ...value, cleared: true }) };
  vm.createContext(context);
  for (const name of ["ne", "de", "pe"]) {
    const fn = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === name);
    vm.runInContext(patched.slice(fn.start, fn.end), context);
  }
  return { ...context, changes, savedRules, patched, LOCAL_DOCKER_SHELL_RULE };
}

test(`packaged host Shell Always allow persists the exact rule after successful persistence (${found?.name ?? "bundle missing"})`, { skip: bundleSkip }, async () => {
  const h = harness(source);
  await h.pe({ agentId: "a", entryId: "e", requestId: "r", resolution: "always", loadAlwaysAllow: () => h.de({ load: async () => {}, snapshots: { get: () => ({ status: "ready", value: { allowInstructions: [] } }) }, setInstructions: async () => {} }, "rule", "host_shell"), resolveAutoReviewApproval: async input => {
    assert.deepEqual(h.savedRules, ["rule"]);
    assert.equal(input.resolution, "always");
    return "resolved";
  } });
  assert.equal(h.changes.at(-1).status, "always");
});

test(`packaged Docker VM Shell Always allow persists one grant for every VM command (${found?.name ?? "bundle missing"})`, { skip: bundleSkip }, async () => {
  const h = harness(source);
  await h.pe({ agentId: "a", entryId: "e", requestId: "r", resolution: "always", loadAlwaysAllow: () => h.de({ load: async () => {}, snapshots: { get: () => ({ status: "ready", value: { allowInstructions: [] } }) }, setInstructions: async () => {} }, "exact pwd rule", "box_shell"), resolveAutoReviewApproval: async input => {
    assert.deepEqual(h.savedRules, [h.LOCAL_DOCKER_SHELL_RULE]);
    assert.equal(input.resolution, "always");
    return "resolved";
  } });
  assert.equal(h.changes.at(-1).status, "always");
  assert.ok(h.patched.includes(`a.surface==="box_shell"?"${h.LOCAL_DOCKER_SHELL_RULE}":N`));
});

test(`packaged missing-rule and persistence errors stay actionable without single-use approval (${found?.name ?? "bundle missing"})`, { skip: bundleSkip }, async () => {
  const h = harness(source); let resolved = 0;
  for (const rule of [undefined, "rule"]) {
    await assert.rejects(() => h.pe({ agentId: "a", entryId: "e", requestId: "r", resolution: "always", loadAlwaysAllow: () => h.de({ load: async () => { throw new Error("offline"); } }, rule), resolveAutoReviewApproval: async () => { resolved++; return "resolved"; } }));
  }
  assert.equal(resolved, 0);
  assert.equal(h.changes.at(-1).cleared, true);
  assert.ok(h.patched.includes('role:"alert"'));
});

test(`renderer patch fails closed on missing anchors (${found?.name ?? "bundle missing"})`, { skip: bundleSkip }, () => {
  assert.throws(() => patchOriginalAutoReviewApproval(patchOriginalAutoReviewApproval(source)), /missing or ambiguous/);
});
