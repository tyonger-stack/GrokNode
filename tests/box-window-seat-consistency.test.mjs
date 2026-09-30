import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load(out, entry) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", out);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    packages: "external",
    banner: { js: "import { createRequire as __cr } from \"node:module\"; const require = __cr(import.meta.url);" },
    plugins: [{
      name: "js-to-ts",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
          const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
          if (!candidate.startsWith(repoRoot + "/source")) return null;
          return existsSync(candidate) ? { path: candidate } : null;
        });
      }
    }]
  });
  return import(pathToFileURL(outfile).href);
}

const hostBoxEntry = "source/host/extensions/forever-box/host-box.ts";
const sharedEntry = "source/host/box/shared-desktop-sand-box.ts";

/** A fork VNC URL exactly as loopback-sand-box mints it. */
function forkUrl(index) {
  return `http://127.0.0.1:6081/vnc.html?path=${encodeURIComponent(`websockify?token=${index}`)}`;
}

test("vncUrlDisplayToken reads the display a fork URL streams", async () => {
  const mod = await load("box-window-seat-token.mjs", hostBoxEntry);
  assert.equal(mod.vncUrlDisplayToken(forkUrl(4)), 4);
  assert.equal(mod.vncUrlDisplayToken(forkUrl(2)), 2);
  // Primary URLs carry no token at all.
  assert.equal(mod.vncUrlDisplayToken("http://127.0.0.1:6080/vnc.html"), undefined);
  assert.equal(mod.vncUrlDisplayToken(null), undefined);
  assert.equal(mod.vncUrlDisplayToken(undefined), undefined);
});

test("buildWindows exposes only the index the agent currently holds", async () => {
  const mod = await load("box-window-seat-token.mjs", hostBoxEntry);
  // Reproduces the live misrouting: the agent was re-assigned from :5 to :4
  // and both URLs are still cached, so the panel must pick :4, not :5.
  const box = new mod.HostBox({
    getAgentWindowIndex: () => 4,
    ensureReady: async () => ({ vncUrl: "http://127.0.0.1:6080/vnc.html" }),
    ensureWindow: async (_ctx, _agentId, windowIndex) => ({ windowIndex, vncUrl: forkUrl(windowIndex) }),
    runState: async () => "running",
  });
  box.vncUrls.set("a", "http://127.0.0.1:6080/vnc.html");
  box.forkVncUrls.set("a", new Map([[5, forkUrl(5)], [4, forkUrl(4)]]));

  const windows = box.buildWindows("a");
  assert.equal(windows.length, 1, "only the live seat is exposed");
  assert.equal(windows[0].windowIndex, 4);
  assert.equal(mod.vncUrlDisplayToken(windows[0].vncUrl), 4, "the streamed display is the seat the agent holds");
});

test("buildWindows falls back to the primary URL for a primary seat", async () => {
  const mod = await load("box-window-seat-token.mjs", hostBoxEntry);
  const box = new mod.HostBox({
    getAgentWindowIndex: () => 1,
    runState: async () => "running",
  });
  box.vncUrls.set("a", "http://127.0.0.1:6080/vnc.html");
  const windows = box.buildWindows("a");
  assert.equal(windows.length, 1);
  assert.equal(windows[0].windowIndex, 0);
  assert.equal(windows[0].vncUrl, "http://127.0.0.1:6080/vnc.html");
});

test("a stale-only cache cannot leak a wrong display past runningStatus", async () => {
  const mod = await load("box-window-seat-token.mjs", hostBoxEntry);
  // The agent holds :4 but only a :5 URL survives in the cache. buildWindows
  // has no :4 entry, so it falls back to the highest index — and that fallback
  // must still be rejected by the guard rather than streamed to the panel.
  const box = new mod.HostBox({
    getAgentWindowIndex: () => 4,
    runState: async () => "running",
  });
  box.vncUrls.set("a", "http://127.0.0.1:6080/vnc.html");
  box.forkVncUrls.set("a", new Map([[5, forkUrl(5)]]));

  assert.throws(
    () => box.runningStatus("a", "http://127.0.0.1:6080/vnc.html"),
    (error) => error instanceof mod.SandBoxWindowSeatMismatchError
      && error.seatIndex === 4
      && error.urlToken === 5,
    "a panel must never stream a display the agent does not hold",
  );
});

test("a genuinely mismatched URL is rejected by runningStatus", async () => {
  const mod = await load("box-window-seat-token.mjs", hostBoxEntry);
  // Inner box claims the agent holds :4 but only ever minted a :5 URL, and
  // reports no window index from buildWindows' perspective (undefined cache
  // hit is impossible here, so the seat is authoritative).
  const box = new mod.HostBox({
    getAgentWindowIndex: () => 4,
    runState: async () => "running",
  });
  box.forkVncUrls.set("a", new Map([[4, forkUrl(5)]])); // right index, wrong token
  assert.throws(
    () => box.runningStatus("a", "http://127.0.0.1:6080/vnc.html"),
    (error) => error instanceof mod.SandBoxWindowSeatMismatchError
      && error.seatIndex === 4
      && error.urlToken === 5,
  );
});

test("loadAssignments reports a persisted seat that collides with a live one", async () => {
  const mod = await load("box-window-assignments.mjs", sharedEntry);
  const { createContext } = await load("box-window-context.mjs", "source/packages/context/core.ts");
  const ctx = createContext();
  const conflicts = [];
  // "live" already holds display :2 in memory; the persisted file also claims
  // :2 for "other". That collision used to be skipped in silence.
  const desktop = new mod.SharedDesktopSandBox({
    maxWindows: () => 5,
    ensureReady: async () => ({ remoteAccessor: {}, vncUrl: "" }),
    downloadFile: async () => Buffer.from(JSON.stringify({
      assignments: { other: 2, fresh: 3 },
    })),
    runState: async () => "running",
    listBoxes: async () => [{ agentId: "live", running: true }],
  }, {
    persistAssignments: true,
    onAssignmentConflict: (detail) => conflicts.push(detail),
  });

  // Seed the in-memory seat the way a live allocation would.
  desktop.assignWindow("live");
  await desktop.ensureAssignmentsLoaded(ctx);

  const collision = conflicts.find((c) => c.agentId === "other" && c.windowIndex === 2);
  assert.ok(collision, "the collision is reported, not silent");
  assert.equal(collision.heldBy, "live");
  assert.equal(desktop.getAgentWindowIndex("fresh"), 3, "non-colliding seats still load");
});
