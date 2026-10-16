import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  LIBRARY_HOST_ANCHOR,
  LIBRARY_HOST_CALL,
  buildLibraryHostBundle,
  patchOriginalLibraryHost,
} from "../scripts/lib/library-host-renderer-patch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PINNED = path.join(REPO, "src/app/dist/renderer/assets/index-UbX-y3il.js");
const SETTINGS_BRANCH = 't.kind==="settings"?p.jsx(h3n,{agentId:t.id})';

function overviewFixture() {
  return `function p3n(n){return n.kind==="overview"?p.jsxs(p.Fragment,{children:[p.jsxs("div",{children:[null,p.jsx(K2n,{agentId:t.id,labelledBy:ye,onCreateRoutine:xe,${LIBRARY_HOST_ANCHOR.slice(LIBRARY_HOST_ANCHOR.indexOf("onOpenRoutine"))}]}):${SETTINGS_BRANCH}:p.jsx(_0n,{})})}`;
}

test("概览锚点把资料库插在例行任务和原导航之间，设置页不挂", async () => {
  const bundle = await buildLibraryHostBundle();
  const source = overviewFixture();
  const patched = patchOriginalLibraryHost(source, bundle);
  assert.equal(patched.split(LIBRARY_HOST_CALL).length - 1, 1);
  const callAt = patched.indexOf(LIBRARY_HOST_CALL);
  const navAt = patched.indexOf("p.jsx(D2n,");
  const settingsAt = patched.indexOf(SETTINGS_BRANCH);
  assert.ok(callAt > 0 && callAt < navAt, "资料库必须在 D2n 之前");
  assert.ok(settingsAt > navAt, "设置分支仍在概览分支之后");
  assert.equal(patched.slice(settingsAt).includes(LIBRARY_HOST_CALL), false);
  assert.equal(bundle.includes("new MutationObserver"), false);
  assert.equal(bundle.includes("createRoot("), false);
  assert.equal(bundle.includes("S.useState"), true);
  assert.equal(bundle.includes("p.jsx"), true);
  assert.throws(() => patchOriginalLibraryHost(source + source, bundle), /exactly once/);
});

test("钉死的概览 chunk 只插入一次，注入块可解析", async (t) => {
  if (!existsSync(PINNED)) {
    t.skip("src/app/dist is gitignored and only exists after npm run bootstrap");
    return;
  }
  const bundle = await buildLibraryHostBundle();
  const patched = patchOriginalLibraryHost(await readFile(PINNED, "utf8"), bundle);
  assert.equal(patched.split(LIBRARY_HOST_CALL).length - 1, 1);
  const mark = patched.lastIndexOf("/* sand-library-host */");
  const injected = patched.slice(mark);
  assert.equal(injected.includes("new MutationObserver"), false);
  assert.equal(injected.includes("createRoot("), false);
  const dir = await mkdtemp(path.join(tmpdir(), "library-host-parse-"));
  const file = path.join(dir, "host.mjs");
  try {
    await writeFile(file, patched);
    const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
