/**
 * P2-7: Bot can change its own title / avatar_shape / avatar_color via update_state.
 * Official anchors: editSandProfile + GROK_BOT_MARK_SHAPES / GROK_BOT_COLORS in host-main.cjs.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const cacheDir = path.join(root, "node_modules", ".cache");
await mkdir(cacheDir, { recursive: true });

const jsToTs = {
  name: "js-to-ts",
  setup(builder) {
    builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
      const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
      return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null;
    });
  },
};

async function load(entry, name) {
  const outfile = path.join(cacheDir, `${name}-bot-self-edit.cjs`);
  await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    logLevel: "error",
    plugins: [jsToTs],
    external: ["electron"],
  });
  return createRequire(import.meta.url)(outfile);
}

const mark = await load("source/shared/agents/grok-bot-mark.ts", "mark");
const profile = await load("source/host/agents/agent-profile.ts", "profile");
const stateMod = await load("source/host/extensions/memory/agent-state.ts", "agent-state");
const tool = await load("source/host/runner/tools/sand-state-tool.ts", "sand-state");

const OFFICIAL_SHAPES = [
  "blob", "pebble", "bean", "egg", "squircle", "tablet", "capsule", "cylinder",
  "hex", "gem", "crystal", "wedge", "shield", "dome", "arch", "cloud", "teardrop",
  "leaf", "square", "sparkle", "clover", "flower", "heart", "house", "star",
];
const OFFICIAL_COLORS = [
  "black", "brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray",
];

function stubStateDeps(agentDir) {
  return {
    agentId: "agent-a",
    agentDir,
    sandRoot: path.dirname(path.dirname(agentDir)),
    memory: { addMemory: () => ({ content: "x" }), removeMemoryByContent: () => true },
    membership: { read: () => new Set(), join: () => true, leave: () => true },
    channels: { remove: () => true },
    automations: {
      upsert: () => null,
      update: () => null,
      setEnabled: () => null,
      get: () => null,
      remove: () => false,
    },
    workflows: { create: () => null, update: () => null, remove: () => false },
  };
}

test("mark catalogs match official GROK_BOT_MARK_SHAPES / GROK_BOT_COLORS ids", () => {
  assert.deepEqual([...mark.GROK_BOT_MARK_SHAPES], OFFICIAL_SHAPES);
  assert.deepEqual([...mark.GROK_BOT_MARK_COLORS], OFFICIAL_COLORS);
  assert.equal(mark.isGrokBotMarkShape("squircle"), true);
  assert.equal(mark.isGrokBotMarkShape("circle"), false);
  assert.equal(mark.isGrokBotMarkColor("violet"), true);
  assert.equal(mark.isGrokBotMarkColor("purple"), false);
});

test("editSandProfile merges title, shape, and color into profile.json", async () => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "bot-profile-"));
  try {
    profile.editSandProfile(agentDir, { name: "Grok Node", description: "helper" });
    profile.editSandProfile(agentDir, {
      title: "Designer",
      avatarShape: "squircle",
      avatarColor: "cyan",
    });
    const written = JSON.parse(await readFile(profile.getSandProfilePath(agentDir), "utf8"));
    assert.equal(written.name, "Grok Node");
    assert.equal(written.description, "helper");
    assert.equal(written.title, "Designer");
    assert.equal(written.avatarShape, "squircle");
    assert.equal(written.avatarColor, "cyan");
    profile.editSandProfile(agentDir, { title: "" });
    const cleared = JSON.parse(await readFile(profile.getSandProfilePath(agentDir), "utf8"));
    assert.equal(cleared.title, "");
    assert.equal(cleared.avatarShape, "squircle");
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("createSandAgentState.updateProfile writes profile and describes changes", async () => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "bot-state-"));
  try {
    const state = stateMod.createSandAgentState(stubStateDeps(agentDir));
    const empty = await state.updateProfile({});
    assert.equal(empty.ok, false);
    assert.match(empty.reason, /nothing to change/);

    const blankName = await state.updateProfile({ name: "   " });
    assert.equal(blankName.ok, false);

    const ok = await state.updateProfile({
      title: "Researcher",
      avatarShape: "hex",
      avatarColor: "violet",
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.detail, "Updated your title, avatar shape, avatar color.");
    assert.equal(ok.message, ok.detail);

    const written = JSON.parse(await readFile(path.join(agentDir, "profile.json"), "utf8"));
    assert.equal(written.title, "Researcher");
    assert.equal(written.avatarShape, "hex");
    assert.equal(written.avatarColor, "violet");
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("update_state profile.set schema and route accept title/shape/color", async () => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "bot-route-"));
  try {
    const params = tool.sandUpdateStateParameters;
    const parsed = params.parse({
      target: "profile",
      action: "set",
      title: "Ops",
      avatar_shape: "star",
      avatar_color: "orange",
    });
    assert.equal(parsed.avatar_shape, "star");
    assert.equal(parsed.avatar_color, "orange");

    assert.throws(
      () => params.parse({ target: "profile", action: "set", avatar_shape: "not-a-shape" }),
      /Invalid|invalid|enum/i,
    );

    const state = stateMod.createSandAgentState(stubStateDeps(agentDir));
    const outcome = await tool.applySandStateUpdate(
      {
        target: "profile",
        action: "set",
        title: "Ops",
        avatar_shape: "star",
        avatar_color: "orange",
      },
      { state },
    );
    assert.equal(outcome.ok, true);
    assert.match(outcome.detail, /Updated your title, avatar shape, avatar color/);
    const written = JSON.parse(await readFile(path.join(agentDir, "profile.json"), "utf8"));
    assert.equal(written.avatarShape, "star");
    assert.equal(written.avatarColor, "orange");
    assert.equal(written.title, "Ops");
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("profile.set operation prose mentions title, avatar_shape, avatar_color", () => {
  assert.match(tool.OPERATIONS.profile.set, /title/);
  assert.match(tool.OPERATIONS.profile.set, /avatar_shape/);
  assert.match(tool.OPERATIONS.profile.set, /avatar_color/);
});
