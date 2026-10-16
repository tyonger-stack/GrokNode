import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { patchWaitingOnResults } from "../scripts/lib/waiting-on-results-renderer-patch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chunk = path.join(root, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const pinnedSkip = !existsSync(chunk);

test("P2-2: Await activity label becomes Waiting on results", { skip: pinnedSkip }, () => {
  const source = readFileSync(chunk, "utf8");
  const patched = patchWaitingOnResults(source);
  assert.ok(patched.includes('Ja("waiting","Waiting on results","hourglass")'));
  assert.equal(patched.includes('Ja("waiting","Waiting on a command","hourglass")'), false);
  // Sibling copy unchanged
  assert.ok(patched.includes("Waiting on another agent"));
});

test("P2-2 MUTATION: leaving Waiting on a command fails the patch guard", { skip: pinnedSkip }, () => {
  const source = readFileSync(chunk, "utf8");
  const broken = source; // identity
  assert.throws(() => {
    const once = patchWaitingOnResults(source);
    // Re-apply must fail-closed
    patchWaitingOnResults(once);
  });
  assert.ok(broken.includes("Waiting on a command"));
});

test("P2-2: main-i18n activity table keys MsZyH5 wording", () => {
  const i18n = readFileSync(path.join(root, "scripts/lib/main-i18n-patch.mjs"), "utf8");
  assert.ok(i18n.includes('\\"Waiting on results\\":\\"正在等待结果\\"'));
  assert.equal(i18n.includes('\\"Waiting on a command\\":\\"正在等待命令完成\\"'), false);
});
