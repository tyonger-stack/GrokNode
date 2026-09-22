import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { parse } from "acorn";
import { patchOriginalAutoReviewApproval } from "../scripts/lib/auto-review-renderer-patch.mjs";

const source = await readFile(new URL("../src/app/dist/renderer/assets/view-QqBtBG74.js", import.meta.url), "utf8");
const patched = patchOriginalAutoReviewApproval(source);
const ast = parse(patched, { sourceType: "module", ecmaVersion: "latest" });
function harness() {
  const changes = [], context = { Error, W: (s, rule) => ({ ...s, allowInstructions: [...s.allowInstructions, rule] }), D: value => changes.push(value), H: value => changes.push({ ...value, cleared: true }) };
  vm.createContext(context);
  for (const name of ["ne", "de", "pe"]) {
    const fn = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === name);
    vm.runInContext(patched.slice(fn.start, fn.end), context);
  }
  return { ...context, changes };
}

test("packaged Always allow only sends always after successful persistence", async () => {
  const h = harness(); let saved = false;
  await h.pe({ agentId: "a", entryId: "e", requestId: "r", resolution: "always", loadAlwaysAllow: () => h.de({ load: async () => {}, snapshots: { get: () => ({ status: "ready", value: { allowInstructions: [] } }) }, setInstructions: async () => { saved = true; } }, "rule"), resolveAutoReviewApproval: async input => { assert.ok(saved); assert.equal(input.resolution, "always"); return "resolved"; } });
  assert.equal(h.changes.at(-1).status, "always");
});

test("packaged missing-rule and persistence errors stay actionable without single-use approval", async () => {
  const h = harness(); let resolved = 0;
  for (const rule of [undefined, "rule"]) {
    await assert.rejects(() => h.pe({ agentId: "a", entryId: "e", requestId: "r", resolution: "always", loadAlwaysAllow: () => h.de({ load: async () => { throw new Error("offline"); } }, rule), resolveAutoReviewApproval: async () => { resolved++; return "resolved"; } }));
  }
  assert.equal(resolved, 0);
  assert.equal(h.changes.at(-1).cleared, true);
  assert.ok(patched.includes('role:"alert"'));
});

test("renderer patch fails closed on missing anchors", () => {
  assert.throws(() => patchOriginalAutoReviewApproval(patched), /missing or ambiguous/);
});
