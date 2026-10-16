import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// P1-8: align Grok Node full-chat search with official 0.71.2.
// Official host-main.cjs:
//   - content-search starts the FTS5 index unconditionally (Telemetry only)
//   - isGlobalSearchEnabled: async () => true
//   - searchAgents / searchMedia always call the manager (no isEnabled gate)
// Mutation-tested: re-gating any of these must turn the assertions red.

const EXTENSION_PATH = new URL(
  "../source/host/extensions/content-search/extension.ts",
  import.meta.url,
).pathname;
const GATEWAY_PATH = new URL("../source/host/host-gateway-api.ts", import.meta.url).pathname;

const extension = readFileSync(EXTENSION_PATH, "utf8");
const gateway = readFileSync(GATEWAY_PATH, "utf8");

test("content-search no longer depends on the experiments gate", () => {
  assert.match(
    extension,
    /dependencies:\s*\[\s*HostExtensions\.Telemetry\s*\]/,
    "official 0.71 drops Experiments; Telemetry alone must remain",
  );
  assert.ok(
    !extension.includes("getFeatureGateProperty"),
    "must not subscribe to sand_global_search",
  );
  assert.ok(
    !extension.includes("checkFeatureGate"),
    "isEnabled must not consult Statsig / FLAGS",
  );
  assert.ok(
    !extension.includes("applyGate"),
    "the gated start/stop helper must stay deleted",
  );
});

test("content-search starts the FTS index unconditionally", () => {
  assert.match(extension, /index\.start\(\)/, "index must start on extension boot");
  assert.match(
    extension,
    /subscribe\(\(mutation\)\s*=>\s*index\.applyMutation\(mutation\)\)/,
    "transcript mutations must always feed the index",
  );
  assert.match(
    extension,
    /isEnabled:\s*\(\)\s*=>\s*true/,
    "residual isEnabled callers must see constant true",
  );
});

test("gateway exposes isGlobalSearchEnabled as always true", () => {
  const idx = gateway.indexOf("isGlobalSearchEnabled:");
  assert.ok(idx > 0, "isGlobalSearchEnabled handler must exist");
  const block = gateway.slice(idx, idx + 120);
  assert.match(
    block,
    /isGlobalSearchEnabled:\s*async\s*\(\)\s*=>\s*true/,
    "must match official hardcode so renderer globalSearchGate flips on",
  );
  assert.ok(
    !block.includes('api("content-search")'),
    "must not delegate enablement back through the gated extension",
  );
});

test("gateway searchAgents and searchMedia always reach the manager", () => {
  const agentsIdx = gateway.indexOf("searchAgents:");
  const mediaIdx = gateway.indexOf("searchMedia:");
  assert.ok(agentsIdx > 0 && mediaIdx > 0, "both search RPCs must exist");

  // Bound each method to its own assignment so a sibling comment cannot mask a regression.
  const agentsEnd = gateway.indexOf("\n    searchMedia:", agentsIdx);
  const mediaEnd = gateway.indexOf("\n    createAgent:", mediaIdx);
  const agentsBlock = gateway.slice(agentsIdx, agentsEnd > 0 ? agentsEnd : agentsIdx + 280);
  const mediaBlock = gateway.slice(mediaIdx, mediaEnd > 0 ? mediaEnd : mediaIdx + 280);

  assert.match(
    agentsBlock,
    /searchAgents:\s*\(args:\s*any\)\s*=>\s*\n?\s*method\(manager,\s*"searchAgents"\)/,
    "searchAgents must call the manager directly",
  );
  assert.match(
    mediaBlock,
    /searchMedia:\s*\(args:\s*any\)\s*=>\s*\n?\s*method\(manager,\s*"searchMedia"\)/,
    "searchMedia must call the manager directly",
  );
  assert.ok(
    !agentsBlock.includes("isEnabled"),
    "searchAgents must not early-return [] when the gate is off",
  );
  assert.ok(
    !mediaBlock.includes("isEnabled"),
    "searchMedia must not early-return [] when the gate is off",
  );
});
