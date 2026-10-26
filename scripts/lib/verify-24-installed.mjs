/**
 * Verify that every plugin/skill installed in the official Grok Bot can be installed in
 * Grok Node.
 *
 * For each of the 24 official installed entries this checks, from Grok Node's own live
 * bridge and box:
 *   - catalog presence  : does Grok Node's catalog carry a matching plugin entry?
 *   - connector presence : does Grok Node's catalog entry carry the same connector?
 *   - skill presence     : does the plugin's skill set exist in Grok Node's box skills?
 *   - installed state    : is it already installed in Grok Node, and with what status?
 *
 * Read-only: it queries the catalog and the installed list. It installs nothing.
 */

import { CdpSession } from "./cdp-probe.mjs";

/** The 24 entries observed installed in the official 0.75.8 manage page. */
const OFFICIAL_INSTALLED = [
  { name: "Gmail", connectors: 1, skills: 0 },
  { name: "Google Calendar", connectors: 1, skills: 0 },
  { name: "Notion", connectors: 1, skills: 14 },
  { name: "Google Drive", connectors: 1, skills: 1 },
  { name: "Google Slides", connectors: 1, skills: 1 },
  { name: "Outlook Calendar", connectors: 1, skills: 0 },
  { name: "Granola", connectors: 1, skills: 3 },
  { name: "Canva", connectors: 1, skills: 6 },
  { name: "Slack", connectors: 1, skills: 8 },
  { name: "Google Sheets", connectors: 1, skills: 1 },
  { name: "Browser Use", connectors: 1, skills: 1 },
  { name: "Google Docs", connectors: 1, skills: 1 },
  { name: "Hugging Face", connectors: 1, skills: 18 },
  { name: "Context7", connectors: 1, skills: 1 },
  { name: "GitHub", connectors: 1, skills: 0 },
  { name: "Origin", connectors: 1, skills: 0 },
  { name: "Cursor Team Kit", connectors: 0, skills: 18 },
  { name: "Agent Compatibility", connectors: 0, skills: 1 },
  { name: "Cursor SDK", connectors: 0, skills: 1 },
  { name: "pstack", connectors: 0, skills: 58 },
  { name: "Remotion", connectors: 0, skills: 12 },
  { name: "Grok Voice", connectors: 0, skills: 4 },
  { name: "Docker", connectors: 0, skills: 11 },
  { name: "邮箱", connectors: 0, skills: 0 },
];

const PORT = Number(process.argv[2] ?? 9224);
const session = await CdpSession.open(PORT);

const data = await session.evaluate(`(async () => {
  const d = window.desktop;
  const catalog = await d.mcp.catalog();
  const installed = await d.mcp.list();
  return { catalog, installed };
})()`);

const catalog = data.catalog ?? [];
const installed = data.installed?.servers ?? [];

console.log(`catalog entries: ${catalog.length}`);
console.log(`installed servers: ${installed.length}\n`);

const normalize = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

console.log("| # | official entry | connectors | skills | catalog match | connector | skill count | installed |");
console.log("|---|---|---|---|---|---|---|---|");

const rows = [];
for (const [index, entry] of OFFICIAL_INSTALLED.entries()) {
  const target = normalize(entry.name);
  const matches = catalog.filter((item) =>
    normalize(item.displayName) === target ||
    normalize(item.pluginName) === target ||
    normalize(item.name) === target);
  const connectorHit = matches.find((item) => (item.connectors ?? []).length > 0);
  const chosen = connectorHit ?? matches[0];
  const installedHit = installed.find((server) =>
    normalize(server.name).includes(target) || normalize(server.serverIdentifier).includes(target));
  const skillCount = chosen?.skills?.length ?? 0;
  rows.push({
    index: index + 1,
    name: entry.name,
    connectors: entry.connectors,
    skills: entry.skills,
    inCatalog: matches.length > 0,
    catalogName: chosen?.displayName ?? null,
    connectorCount: chosen?.connectors?.length ?? 0,
    skillCount,
    skillCountMatches: entry.skills === 0 || skillCount === entry.skills,
    installed: installedHit?.status ?? null,
  });
}

for (const row of rows) {
  const connectorOk = row.connectors === 0 ? "n/a" : row.connectorCount > 0 ? "yes" : "NO";
  const skillOk = row.skills === 0 ? "n/a" : row.skillCount === row.skills ? `yes (${row.skillCount})` : `NO (${row.skillCount})`;
  console.log(
    `| ${row.index} | ${row.name} | ${row.connectors} | ${row.skills} | ` +
    `${row.inCatalog ? `yes (${row.catalogName ?? "?"})` : "MISSING"} | ${connectorOk} | ${skillOk} | ${row.installed ?? "-"} |`,
  );
}

const missing = rows.filter((row) => !row.inCatalog);
const connectorMissing = rows.filter((row) => row.connectors > 0 && row.connectorCount === 0);
const skillMismatch = rows.filter((row) => row.skills > 0 && row.skillCount !== row.skills);
console.log(`\ncatalog missing: ${missing.length} -> ${missing.map((row) => row.name).join(", ") || "(none)"}`);
console.log(`connector missing: ${connectorMissing.length} -> ${connectorMissing.map((row) => row.name).join(", ") || "(none)"}`);
console.log(`skill-count mismatch: ${skillMismatch.length} -> ${skillMismatch.map((row) => `${row.name} want ${row.skills} got ${row.skillCount}`).join(", ") || "(none)"}`);

session.close();
