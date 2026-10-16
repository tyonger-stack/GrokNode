import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "source/electron-main/history-mouse-navigation.ts";

async function loadTsModule(relativePath, { transform } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "history-mouse-nav-"));
  const out = path.join(dir, "out.mjs");
  const plugins = [];
  if (typeof transform === "function") {
    plugins.push({
      name: "mutate-source",
      setup(b) {
        b.onLoad({ filter: /history-mouse-navigation\.ts$/ }, async (args) => {
          const original = await readFile(args.path, "utf8");
          return { contents: transform(original), loader: "ts" };
        });
      },
    });
  }
  await build({
    entryPoints: [path.join(repoRoot, relativePath)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    outfile: out,
    logLevel: "silent",
    plugins,
  });
  try {
    return await import(`${out}?t=${Date.now()}-${Math.random()}`);
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

const mod = await loadTsModule(SOURCE);

test("LAe / NAe / UAe / DAe map directions like 0.71.2", () => {
  assert.equal(mod.directionFromAppCommand("browser-backward"), -1);
  assert.equal(mod.directionFromAppCommand("browser-forward"), 1);
  assert.equal(mod.directionFromAppCommand("browser-refresh"), null);

  assert.equal(mod.directionFromMouseButton("back"), -1);
  assert.equal(mod.directionFromMouseButton("forward"), 1);
  assert.equal(mod.directionFromMouseButton("left"), null);

  assert.equal(mod.directionFromSwipe("left"), -1);
  assert.equal(mod.directionFromSwipe("right"), 1);
  assert.equal(mod.directionFromSwipe("up"), null);

  assert.equal(mod.isHistoryDirection(-1), true);
  assert.equal(mod.isHistoryDirection(1), true);
  assert.equal(mod.isHistoryDirection(0), false);
  assert.equal(mod.isHistoryDirection("back"), false);
});

test("FAe consumeMouse emits on mouseDown once and records mouseUp for pairing", () => {
  let t = 1000;
  const d = mod.createMouseHistoryDebouncer(() => t);

  assert.equal(d.consumeMouse("mouseDown", -1), true);
  assert.equal(d.consumeMouse("mouseDown", -1), false, "repeat mouseDown while held is suppressed");
  assert.equal(d.consumeMouse("mouseUp", -1), false);
  // Within 50ms, swipe/command for same direction is suppressed
  t = 1020;
  assert.equal(d.consumeSwipe(-1), false);
  t = 1060;
  assert.equal(d.consumeSwipe(-1), true, "after 50ms window swipe is allowed");
});

test("FAe consumeCommand with pairCommands dedupes the second of a Linux pair", () => {
  const d = mod.createMouseHistoryDebouncer(() => 5000, { pairCommands: true });

  assert.equal(d.consumeCommand(-1), true, "first command emits");
  assert.equal(d.consumeCommand(-1), false, "paired duplicate suppressed");
  assert.equal(d.consumeCommand(-1), true, "third (new pair start) emits");
});

test("FAe consumeCommand without pairCommands uses swipe debounce only", () => {
  let t = 0;
  const d = mod.createMouseHistoryDebouncer(() => t, { pairCommands: false });

  assert.equal(d.consumeMouse("mouseDown", 1), true);
  assert.equal(d.consumeCommand(1), false, "command suppressed while mouse held");
  assert.equal(d.consumeMouse("mouseUp", 1), false);
  t = 10;
  assert.equal(d.consumeCommand(1), false, "command suppressed within 50ms of mouseUp");
  t = 60;
  assert.equal(d.consumeCommand(1), true);
});

test("FAe consumeGuest refuses while mouse or paired command owns the direction", () => {
  const d = mod.createMouseHistoryDebouncer(() => 0, { pairCommands: true });
  assert.equal(d.consumeGuest(-1), true);
  assert.equal(d.consumeMouse("mouseDown", -1), true);
  assert.equal(d.consumeGuest(-1), false);
  assert.equal(d.consumeMouse("mouseUp", -1), false);
  assert.equal(d.consumeCommand(1), true);
  assert.equal(d.consumeGuest(1), false, "guest blocked after paired command flag set");
});

test("mutation: swapping LAe back/forward polarity fails the mapping contract", async () => {
  const mutated = await loadTsModule(SOURCE, {
    transform: (src) => {
      const next = src
        .replace(
          'return command === "browser-backward" ? -1 : command === "browser-forward" ? 1 : null;',
          'return command === "browser-backward" ? 1 : command === "browser-forward" ? -1 : null;',
        );
      assert.notEqual(next, src, "mutation did not change LAe");
      return next;
    },
  });
  assert.equal(mutated.directionFromAppCommand("browser-backward"), 1);
  assert.notEqual(
    mutated.directionFromAppCommand("browser-backward"),
    mod.directionFromAppCommand("browser-backward"),
  );
});

test("mutation: dropping the 50ms mouseUp pairing window breaks debounce contract", async () => {
  const mutated = await loadTsModule(SOURCE, {
    transform: (src) => {
      const next = src.replace(
        "now() - lastMouseUp.at < 50",
        "now() - lastMouseUp.at < 0",
      );
      assert.notEqual(next, src, "mutation did not change the 50ms window");
      return next;
    },
  });
  let t = 1000;
  const d = mutated.createMouseHistoryDebouncer(() => t);
  assert.equal(d.consumeMouse("mouseDown", -1), true);
  assert.equal(d.consumeMouse("mouseUp", -1), false);
  t = 1010;
  // Mutated: window is 0ms, so immediate swipe must be allowed — baseline forbids this
  assert.equal(d.consumeSwipe(-1), true);
  // Reconstruct baseline state at same clock: down then up at 1000, check at 1010
  let bt = 1000;
  const b = mod.createMouseHistoryDebouncer(() => bt);
  assert.equal(b.consumeMouse("mouseDown", -1), true);
  assert.equal(b.consumeMouse("mouseUp", -1), false);
  bt = 1010;
  assert.equal(b.consumeSwipe(-1), false, "baseline still pairs within 50ms");
});

test("channel and event names match 0.71.2 anchors", () => {
  assert.equal(mod.MOUSE_HISTORY_GUEST_IPC_CHANNEL, "sand:mouse-history-navigation");
  assert.equal(mod.MOUSE_HISTORY_NAVIGATION_EVENT, "mouse-history-navigation");
});
