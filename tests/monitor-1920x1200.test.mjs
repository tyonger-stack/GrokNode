import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("P2-8: SAND_MONITOR is official 1920×1200", () => {
  const source = readFileSync(path.join(root, "source/host/box/box-monitor-layout.ts"), "utf8");
  assert.match(source, /SAND_MONITOR_WIDTH = 1920/);
  assert.match(source, /SAND_MONITOR_HEIGHT = 1200/);
  assert.doesNotMatch(source, /SAND_MONITOR_WIDTH = 1280/);
  assert.doesNotMatch(source, /SAND_MONITOR_HEIGHT = 800/);
});

test("P2-8: local-docker schema v9 passes SCREEN_WIDTH/HEIGHT 1920×1200", () => {
  const source = readFileSync(
    path.join(root, "source/electron-main/box/local-docker-host-connector.ts"),
    "utf8",
  );
  // v9 is the revert to the older image and the /home/box layout; the screen
  // geometry from v7 still has to ride along with it.
  assert.match(source, /LOCAL_DOCKER_SCHEMA_VERSION = "9"/);
  assert.match(source, /SCREEN_WIDTH=1920/);
  assert.match(source, /SCREEN_HEIGHT=1200/);
  assert.doesNotMatch(source, /LOCAL_DOCKER_SCHEMA_VERSION = "6"/);
});
