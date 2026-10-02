import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

import { insertMainAgentGates } from "../scripts/lib/grok-main-agent-gate-patch.mjs";

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

/**
 * Bundles several modules into ONE output so they share module-level state. The plain
 * `load()` helper emits a separate bundle per entry, which would give the service and the
 * gate registry independent copies of their own modules — the pin would then never be seen.
 */
async function loadTogether(out, entry) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", out);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    stdin: { contents: entry, resolveDir: repoRoot, sourcefile: "test-entry.ts", loader: "ts" },
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

const contract = await load("grok-main-agent-contract.mjs", "source/shared/node/grok-bot-main-agent.ts");

// A stand-in for the bundled FLAGS table, in the EXACT shape of the pristine
// src/app/dist/host/host-main.cjs (2-space entry indent, 4-space field indent) so the test
// exercises the same anchors the real bundle will be patched with.
const TABLE_FIXTURE = `var FLAGS = {
  sand_get_grok_bot_ios: {
    client: true,
    default: false
  },
  sand_usage_page: {
    client: true,
    default: false
  }
};
`;

test("the ported isMain predicate marks exactly one agent, and only while nothing else competes", () => {
  const pointer = { kind: "known", agentId: "bot-1" };
  assert.equal(contract.isGrokBotMainAgent({ pointer, agentId: "bot-1", otherCandidateCount: 0 }), true, "the agent the pointer names is the main bot");
  assert.equal(contract.isGrokBotMainAgent({ pointer, agentId: "bot-2", otherCandidateCount: 0 }), false, "no other agent is ever the main bot");
  assert.equal(contract.isGrokBotMainAgent({ pointer: { kind: "known", agentId: null }, agentId: "bot-1", otherCandidateCount: 0 }), false, "an empty pointer marks nobody");
  assert.equal(contract.isGrokBotMainAgent({ pointer: { kind: "unknown" }, agentId: "bot-1", otherCandidateCount: 0 }), false, "an unresolved pointer marks nobody");
  assert.equal(contract.isGrokBotMainAgent({ pointer, agentId: "bot-1", otherCandidateCount: 2 }), false, "upstream's x.length === 0 clause: other candidates suppress it");
});

test("the ported chooser rule is a four-way AND, exactly as upstream's a3e()/Zge is", () => {
  const open = { onboardingFinished: true, mainAgentEnabled: true, forceSelection: true, pointer: { kind: "known", agentId: null } };
  assert.equal(contract.isGrokBotMainAgentSelectionEligible(open), true, "all four inputs present opens the chooser");
  for (const [drop, value] of [["onboardingFinished", false], ["mainAgentEnabled", false], ["forceSelection", false]]) {
    assert.equal(contract.isGrokBotMainAgentSelectionEligible({ ...open, [drop]: value }), false, `${drop}=false must keep it shut`);
  }
});

test("an unresolved pointer can never open the chooser; a set pointer closes it for good", () => {
  assert.equal(contract.isGrokBotMainAgentSelectionEligible({ onboardingFinished: true, mainAgentEnabled: true, forceSelection: true, pointer: { kind: "unknown" } }), false);
  assert.equal(contract.isGrokBotMainAgentSelectionEligible({ onboardingFinished: true, mainAgentEnabled: true, forceSelection: true, pointer: { kind: "known", agentId: "bot-1" } }), false);
});

test("dismissing the forced chooser latches it shut; eligibility alone does not", () => {
  let state = contract.reduceGrokBotMainAgentChooser(contract.GROK_BOT_MAIN_AGENT_CHOOSER_CLOSED, { type: "eligible" });
  assert.equal(state.kind, "open");
  state = contract.reduceGrokBotMainAgentChooser(state, { type: "dismiss" });
  assert.deepEqual(state, { kind: "closed", reason: "dismissed", sawPointer: false });
  assert.equal(contract.reduceGrokBotMainAgentChooser(state, { type: "eligible" }), state, "a dismissed chooser must not re-arm");
});

test("ensure reports hasMainAgent once one is set, and present otherwise", () => {
  assert.deepEqual(contract.resolveGrokBotDefaultMainAgentOutcome({ gateEnabled: true, mainAgentId: "bot-1" }), { agentId: "bot-1", outcome: "hasMainAgent" });
  assert.deepEqual(contract.resolveGrokBotDefaultMainAgentOutcome({ gateEnabled: true, mainAgentId: null }), { agentId: null, outcome: "present" });
  assert.deepEqual(contract.resolveGrokBotDefaultMainAgentOutcome({ gateEnabled: true, mainAgentId: "bot-1", busy: true }), { agentId: "bot-1", outcome: "busy" });
});

test("main agent ids normalize the way the server's optional field does", () => {
  assert.equal(contract.normalizeGrokBotMainAgentId("bot-1"), "bot-1");
  assert.equal(contract.normalizeGrokBotMainAgentId("  bot-1  "), "bot-1");
  assert.equal(contract.normalizeGrokBotMainAgentId(""), null);
  assert.equal(contract.normalizeGrokBotMainAgentId(undefined), null);
});

test("every upstream ensure outcome is representable", () => {
  assert.deepEqual([...contract.GROK_BOT_DEFAULT_MAIN_AGENT_OUTCOMES], ["created", "present", "hasMainAgent", "tombstoned", "pinnedFull", "busy"]);
  for (const outcome of contract.GROK_BOT_DEFAULT_MAIN_AGENT_OUTCOMES) assert.equal(contract.isGrokBotDefaultMainAgentOutcome(outcome), true);
  assert.equal(contract.isGrokBotDefaultMainAgentOutcome("nope"), false);
});

test("the gate patch inserts both gates with the backend's current value, and is idempotent", () => {
  const first = insertMainAgentGates(TABLE_FIXTURE);
  assert.equal(first.applied, true, first.reason);
  assert.match(first.text, / {2}sand_grok_main_agent: \{\n {4}client: true,\n {4}default: true\n {2}\}/);
  assert.match(first.text, / {2}sand_grok_force_main_agent_selection: \{\n {4}client: true,\n {4}default: true\n {2}\}/);
  const second = insertMainAgentGates(first.text);
  assert.equal(second.applied, false, "a second pass must not double-insert");
  assert.equal(second.reason, "already-present");
  assert.equal((second.text.match(/sand_grok_main_agent: \{/g) ?? []).length, 1);
});

test("the gate patch fails closed when its anchor is missing or ambiguous", () => {
  const missing = insertMainAgentGates("var FLAGS = {};");
  assert.deepEqual({ applied: missing.applied, reason: missing.reason }, { applied: false, reason: "anchor-missing" });
  const entry = "  sand_usage_page: {\n    client: true,\n    default: false\n  },";
  const ambiguous = insertMainAgentGates(`var FLAGS = {\n${entry}\n${entry}\n};`);
  assert.equal(ambiguous.applied, false);
  assert.match(ambiguous.reason, /^anchor-ambiguous:/, "an ambiguous neighbour must refuse rather than guess");
});

test("the patch really lands on the pristine host bundle, and the result still parses", () => {
  const pristine = path.join(repoRoot, "src", "app", "dist", "host", "host-main.cjs");
  if (!existsSync(pristine)) return; // upstream artifact not hydrated in this checkout
  const result = insertMainAgentGates(readFileSync(pristine, "utf8"));
  assert.equal(result.applied, true, `the pristine bundle must match an anchor, got ${result.reason}`);
  const outfile = path.join(repoRoot, "node_modules", ".cache", "grok-main-agent-patched-host.cjs");
  mkdirSync(path.dirname(outfile), { recursive: true });
  writeFileSync(outfile, result.text);
  // A brace or quote slip inside a 25 MB bundle shows up as a syntax error here rather than
  // at runtime: string surgery on minified code is only trustworthy if the real parser agrees.
  execFileSync(process.execPath, ["--check", outfile], { stdio: "pipe" });
});

test("the ported row projection reserves the corner badge for the main bot, last", async () => {
  const { projectSidebarAgentStatus, MAIN_BOT_BADGE_LABEL } = await load("grok-main-agent-row.mjs", "frontend/src/recovered/features/conversation/workspace/sidebar-agent-status.ts");
  assert.equal(MAIN_BOT_BADGE_LABEL, "Main Bot", "official i18n V8a0q9 is 「主 Bot」 / \"Main Bot\"");
  // Expanded row: an idle main bot takes the corner.
  assert.equal(projectSidebarAgentStatus({ layout: "expanded", isMain: true }).corner, "main");
  // …but a running dot outranks it, exactly as official s1e does.
  assert.equal(projectSidebarAgentStatus({ layout: "expanded", isMain: true, isRunning: true }).corner, "running");
  // …and an unread/blocked marker takes the trailing slot on an expanded row.
  const unread = projectSidebarAgentStatus({ layout: "expanded", isMain: true, hasUnread: true });
  assert.equal(unread.corner, "main");
  assert.equal(unread.trailing, "marker");
  // Pinned/collapsed rows: marker → running → main, in that order.
  assert.equal(projectSidebarAgentStatus({ layout: "pinned", isMain: true, waitingReason: "needs you" }).corner, "marker");
  assert.equal(projectSidebarAgentStatus({ layout: "pinned", isMain: true, isRunning: true }).corner, "running");
  assert.equal(projectSidebarAgentStatus({ layout: "pinned", isMain: true }).corner, "main");
  // A non-main row never gets it.
  assert.equal(projectSidebarAgentStatus({ layout: "pinned" }).corner, null);
  assert.equal(projectSidebarAgentStatus({ layout: "expanded" }).corner, null);
});

test("the ported row action replaces Delete on a main bot, and never offers both", async () => {
  const { agentRowActions, isReplaceMainAgentAction } = await load("grok-main-agent-row-actions.mjs", "frontend/src/production/agent-row-actions-model.ts");
  const base = { isHidden: false, includeDelete: true, includeReplaceMainAgent: true };
  const asMain = agentRowActions({ ...base, isMain: true });
  assert.equal(asMain.some(isReplaceMainAgentAction), true, "a main bot offers replace");
  assert.equal(asMain.some((action) => action.id === "delete-agent"), false, "…and not delete in the same slot");
  assert.equal(asMain.find(isReplaceMainAgentAction)?.label, "Replace with different Bot", "official English for i18n EmmHd+");
  const asOther = agentRowActions({ ...base, isMain: false });
  assert.equal(asOther.some(isReplaceMainAgentAction), false);
  assert.equal(asOther.some((action) => action.id === "delete-agent"), true, "an ordinary bot keeps delete");
  // The seam is what enables the item, not isMain alone.
  assert.equal(agentRowActions({ isHidden: false, isMain: true }).some(isReplaceMainAgentAction), false, "no callback → no item");
});

test("the ported UI seam exists end to end, and the 0.18 baseline still has no chooser", () => {
  const renderer = readFileSync(path.join(repoRoot, "frontend", "src", "production", "ProductionRenderer.tsx"), "utf8");
  for (const seam of ["getMainAgent", "setMainAgent", "MainAgentChooserDialog", "onReplaceMainAgent"]) {
    assert.match(renderer, new RegExp(seam), `${seam} must be wired`);
  }
  const sidebar = readFileSync(path.join(repoRoot, "frontend", "src", "recovered", "features", "conversation", "workspace", "sidebar.tsx"), "utf8");
  assert.match(sidebar, /isGrokBotMainAgent\(/, "the sidebar must decide isMain through the ported predicate, not inline");
  assert.match(sidebar, /MAIN_BOT_BADGE_LABEL/, "the row's accessible name must carry the badge label");
});

test("the gate patch is wired into the clean build", () => {
  const cleanBuild = readFileSync(path.join(repoRoot, "scripts", "clean-build.mjs"), "utf8");
  assert.match(cleanBuild, /applyGrokMainAgentGatePatch/);
});

test("the host refuses main-agent writes with the gate off, and still reads the id", async () => {
  const { SettingsService, isGrokBotMainAgentEnabled, pinGrokBotMainAgentGateReader } = await loadTogether("grok-main-agent-host.mjs", `
export { SettingsService } from "./source/host/extensions/settings/settings-service.ts";
export { isGrokBotMainAgentEnabled, pinGrokBotMainAgentGateReader } from "./source/host/extensions/settings/main-agent-gate.ts";
`);
  const dir = mkdtempSync(path.join(tmpdir(), "grok-main-agent-"));
  try {
    const service = new SettingsService(path.join(dir, "settings.json"));
    assert.equal(isGrokBotMainAgentEnabled(), false, "an unregistered gate reader must read as disabled, never enabled");
    assert.equal(service.getHostSettings().mainAgentId, null, "reads never need the gate, and start empty");

    // Asserted by error NAME, not class identity: this test and the service each get their
    // own bundle, so the two copies of GrokBotMainAgentRefusedError are distinct classes.
    assert.throws(() => service.setHostSettings({ mainAgentId: "bot-1" }), (error) => error?.name === "GrokBotMainAgentRefusedError", "writes must be refused while the gate is off");
    assert.equal(service.getHostSettings().mainAgentId, null, "a refused write must not have mutated anything");

    pinGrokBotMainAgentGateReader(() => true);
    try {
      service.setHostSettings({ mainAgentId: "bot-1" });
      assert.equal(service.getHostSettings().mainAgentId, "bot-1", "with the gate on the write lands");
      service.setHostSettings({ mainAgentId: "bot-2" });
      assert.equal(service.getHostSettings().mainAgentId, "bot-2", "the main bot can be replaced");
      service.setHostSettings({ mainAgentId: null });
      assert.equal(service.getHostSettings().mainAgentId, null, "null clears the main agent");
    } finally {
      pinGrokBotMainAgentGateReader(null);
    }
  } finally {
    assert.equal(isGrokBotMainAgentEnabled(), false, "unpinning must return the gate to disabled");
  }
});

test("the desktop facade mirrors upstream's three-method shape", async () => {
  const mainEdgeSource = readFileSync(path.join(repoRoot, "source", "electron-main", "main-edge.ts"), "utf8");
  for (const method of ["getHostMainAgent", "setHostMainAgent", "ensureHostMainAgent"]) assert.match(mainEdgeSource, new RegExp(method), `${method} must be served by the main edge`);
  const preload = readFileSync(path.join(repoRoot, "source", "electron-preload", "preload.ts"), "utf8");
  for (const bridged of ["getMainAgent", "setMainAgent", "ensureMainAgent"]) assert.match(preload, new RegExp(bridged), `${bridged} must be bridged for the renderer`);
});

test("the renderer baseline has no chooser, so nothing in this port invents one", () => {
  const chunkRoot = path.join(repoRoot, "src", "app", "dist", "renderer", "assets");
  if (!existsSync(chunkRoot)) return; // pristine artifact not hydrated in this checkout
  for (const name of ["mainAgentEnabled", "sawPointer", "pointerUnknown"]) {
    let hits = 0;
    for (const file of readdirSyncSafe(chunkRoot)) {
      try { hits += (readFileSync(path.join(chunkRoot, file), "utf8").match(new RegExp(name, "g")) ?? []).length; } catch { /* binary or unreadable: not counted as evidence */ }
    }
    assert.equal(hits, 0, `${name} must stay absent from the 0.18 baseline — the chooser is not ours to author`);
  }
});

function readdirSyncSafe(dir) {
  try { return readdirSync(dir); } catch { return []; }
}
