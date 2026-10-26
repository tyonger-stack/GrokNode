/**
 * Inspect the installed-application data each app actually holds.
 *
 * Read-only: calls the bridge's read-only list/effectivePlugins/catalog calls and
 * reports the shape and contents. It installs, removes and authenticates nothing.
 */

import { CdpSession } from "./cdp-probe.mjs";

const PORT = Number(process.argv[2] ?? 9224);
const session = await CdpSession.open(PORT);

const out = await session.evaluate(`(async () => {
  const d = window.desktop;
  const report = {};
  const safe = async (name, fn) => {
    try {
      const value = await fn();
      report[name] = { ok: true, value };
    } catch (error) {
      report[name] = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  await safe("mcp.list", () => d.mcp.list());
  await safe("mcp.effectivePlugins", () => d.mcp.effectivePlugins());
  await safe("mcp.catalog", () => d.mcp.catalog());
  await safe("mcp.teamPopularity", () => d.mcp.teamPopularity());
  await safe("skills.list", () => d.skills.list());
  return report;
})()`);

for (const [name, result] of Object.entries(out)) {
  console.log(`\n########## ${name}`);
  if (!result.ok) {
    console.log("  ERROR:", result.error);
    continue;
  }
  const value = result.value;
  if (Array.isArray(value)) {
    console.log(`  array length ${value.length}`);
    console.log(`  first entry keys: ${value.length > 0 ? Object.keys(value[0]).join(", ") : "(none)"}`);
    console.log(JSON.stringify(value.slice(0, 40), null, 1).slice(0, 4000));
  } else if (value != null && typeof value === "object") {
    console.log(`  object keys: ${Object.keys(value).join(", ")}`);
    console.log(JSON.stringify(value, null, 1).slice(0, 4000));
  } else {
    console.log("  value:", JSON.stringify(value));
  }
}

session.close();
