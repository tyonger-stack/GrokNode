import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadRecovery() {
  const dir = await mkdtemp(path.join(tmpdir(), "renderer-crash-recovery-"));
  const out = path.join(dir, "out.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/electron-main/renderer-crash-recovery.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    outfile: out,
    logLevel: "silent",
  });
  try {
    return await import(out);
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

function harness({ crashed = false, answer = "reload" } = {}) {
  let clock = 0;
  const queue = [];
  const listeners = [];
  const calls = { reload: 0, quit: 0, ask: 0, loops: [] };
  const contents = {
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    isCrashed: () => crashed,
    on(event, listener) { assert.equal(event, "render-process-gone"); listeners.push(listener); },
  };
  const options = {
    isQuitting: () => false,
    reload: () => { calls.reload += 1; },
    askToReloadOrQuit: async () => { calls.ask += 1; return answer; },
    quit: () => { calls.quit += 1; },
    reportAskFailure: (error) => { throw error; },
    reportCrashLoop: (record) => calls.loops.push(record),
    now: () => clock,
    schedule: (task) => queue.push(task),
  };
  return {
    contents,
    options,
    calls,
    advance(ms) { clock += ms; },
    gone(reason = "crashed") { for (const listener of listeners) listener({}, { reason }); },
    async drain() { while (queue.length > 0) { queue.shift()(); await Promise.resolve(); await Promise.resolve(); } },
  };
}

test("a crashed renderer is reloaded on the next task, a clean exit is not", async () => {
  const mod = await loadRecovery();
  const h = harness();
  mod.installRendererCrashRecovery(h.contents, h.options);
  h.gone("clean-exit");
  await h.drain();
  assert.equal(h.calls.reload, 0);
  for (const reason of ["crashed", "oom", "killed", "abnormal-exit"]) h.gone(reason);
  assert.equal(h.calls.reload, 0, "reload must wait for the scheduled task");
  await h.drain();
  assert.equal(h.calls.ask, 1, "fourth crash inside the window is a crash loop");
  assert.equal(h.calls.reload, 4, "three automatic reloads plus the dialog's reload answer");
  assert.deepEqual(h.calls.loops, [{ kind: "crash_loop", reloads: 3 }]);
});

test("crash loop asks once and honours quit", async () => {
  const mod = await loadRecovery();
  const h = harness({ answer: "quit" });
  mod.installRendererCrashRecovery(h.contents, h.options);
  for (let i = 0; i < 6; i += 1) h.gone();
  await h.drain();
  assert.equal(h.calls.ask, 1, "crashes while the dialog is pending do not stack dialogs");
  assert.equal(h.calls.quit, 1);
  assert.equal(h.calls.reload, 3);
});

test("crash loop reload answer reloads; crashes outside the minute window keep auto-reloading", async () => {
  const mod = await loadRecovery();
  const h = harness();
  mod.installRendererCrashRecovery(h.contents, h.options);
  for (let i = 0; i < 5; i += 1) {
    h.gone();
    await h.drain();
    h.advance(mod.RENDERER_CRASH_LOOP_WINDOW_MS);
  }
  assert.equal(h.calls.ask, 0);
  assert.equal(h.calls.reload, 5);
  for (let i = 0; i < 4; i += 1) h.gone();
  await h.drain();
  assert.equal(h.calls.ask, 1);
  assert.equal(h.calls.reload, 9, "five spaced reloads, three window-local reloads, one dialog reload");
});

test("an already crashed renderer recovers on install; destroyed contents never reload", async () => {
  const mod = await loadRecovery();
  const crashed = harness({ crashed: true });
  mod.installRendererCrashRecovery(crashed.contents, crashed.options);
  await crashed.drain();
  assert.equal(crashed.calls.reload, 1);

  const destroyed = harness();
  mod.installRendererCrashRecovery(destroyed.contents, destroyed.options);
  destroyed.gone();
  destroyed.contents.destroyed = true;
  await destroyed.drain();
  assert.equal(destroyed.calls.reload, 0);
});

test("main window installs the recovery and the crash-loop dialog uses the 0.71.2 copy", async () => {
  const main = await readFile(path.join(repoRoot, "source/electron-main/main.ts"), "utf8");
  assert.match(main, /installRendererCrashRecovery\(window\.webContents,/);
  assert.match(main, /buttons: \[copy\.reloadButton, withAppName\(copy\.quitButton\)\]/);
  const activation = await readFile(path.join(repoRoot, "scripts/electron-main-production-activation.mjs"), "utf8");
  assert.match(activation, /createElectronProductionNativeBindings\(\{[^}]*\bdialog \}\)/);
  const messages = await readFile(path.join(repoRoot, "source/electron-main/i18n/desktop-messages.ts"), "utf8");
  assert.ok(messages.includes('crashLoopMessage: "窗口反复崩溃。请重新加载或退出 {0}。"'));
  assert.ok(messages.includes('crashLoopMessage: "The {0} window keeps crashing. Reload it or quit."'));
});
