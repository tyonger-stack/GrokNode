import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CATEGORY_BUCKET_LABELS,
  CATEGORY_BUCKET_ORDER,
  FOR_YOU_ROW_LIMIT,
  MANAGE_VISIBLE_ROWS,
  buildInstalledRows,
  buildMarketplaceModel,
  searchRows,
  sectionKeyOf,
  selectForYou,
  showAllLabel,
  sliceForPreview,
  statusLabel,
  statusTone,
} from "../frontend/src/extensions/marketplace/model.ts";

const MODEL = path.join(import.meta.dirname, "..", "frontend/src/extensions/marketplace/model.ts");

function entry(overrides = {}) {
  return {
    id: "id-" + Math.random().toString(36).slice(2, 8),
    name: "vendor-tool",
    displayName: "Vendor Tool",
    description: "Does a thing.",
    category: "Productivity",
    iconUrl: "https://example.test/icon.png",
    connectors: [{ name: "c" }],
    skills: [],
    ...overrides,
  };
}

function server(name, overrides = {}) {
  return {
    id: "s-" + name,
    name,
    status: "connected",
    statusDetail: "",
    toolCount: 3,
    accountKey: "default",
    isTeamServer: false,
    ...overrides,
  };
}

test("category bucket order and labels are the official 0.66 set", () => {
  // Transcribed from `const Ce = [...]` in chunk-marketplace-browse-model-DoOY91TS.js. The order
  // is the single source of truth for how the homepage stacks its category sections.
  assert.deepEqual([...CATEGORY_BUCKET_ORDER], [
    "credentials", "productivity", "communication", "design", "code",
    "data", "sales", "finance", "research", "support",
  ]);
  assert.equal(CATEGORY_BUCKET_LABELS.credentials, "登录与凭据管理");
  assert.equal(CATEGORY_BUCKET_LABELS.productivity, "效率");
  assert.equal(CATEGORY_BUCKET_LABELS.support, "支持");
});

test("the four upstream preview caps are not conflated", () => {
  // Xe=6 drives the manage view's first-page installed rows; le=4 drives homepage category groups.
  // Merging them is the single easiest way to make the two pages look wrong.
  assert.equal(MANAGE_VISIBLE_ROWS, 6);
  assert.equal(FOR_YOU_ROW_LIMIT, 4);
});

test("sliceForPreview only hides rows when the section is collapsible", () => {
  assert.deepEqual(sliceForPreview([1, 2, 3], false, 2), { visible: [1, 2, 3], hiddenCount: 0 });
  assert.deepEqual(sliceForPreview([1, 2, 3], true, 2), { visible: [1, 2], hiddenCount: 1 });
  assert.deepEqual(sliceForPreview([1, 2], true, 2), { visible: [1, 2], hiddenCount: 0 });
});

test("sectionKeyOf routes featured and team entries to their own keys", () => {
  const rows = buildMarketplaceModel(
    [
      entry({ id: "f", category: "Featured" }),
      entry({ id: "t", marketplace: { displayName: "Acme" } }),
      entry({ id: "p", category: "Productivity" }),
    ],
    [],
    {},
  ).rows;
  assert.equal(sectionKeyOf(rows.find((r) => r.id === "f")), "category:featured");
  assert.equal(sectionKeyOf(rows.find((r) => r.id === "t")), "team-plugins");
  assert.equal(sectionKeyOf(rows.find((r) => r.id === "p")), "category:productivity");
});

test("an entry carrying a marketplace field is a team plugin, not a popular one", () => {
  // Upstream: `teamPlugins` (se) filters on `e.marketplace != null`; `popularPlugins` (re) is a
  // different set. Conflating them would put team entries in the wrong section.
  const model = buildMarketplaceModel(
    [entry({ id: "team1", marketplace: { displayName: "Acme" } }), entry({ id: "plain", category: "Sales" })],
    [],
    { team1: 9 },
  );
  assert.deepEqual(model.team.map((r) => r.id), ["team1"]);
  assert.equal(model.team[0].isTeam, true);
  assert.equal(model.team[0].teamName, "Acme");
});

test("empty buckets are omitted rather than rendered as empty headings", () => {
  // `Ce.flatMap(...)` only emits keys that have members — this is why the live capture shows 8 of
  // the 10 buckets. A build that renders all ten gains two headings the official build never has.
  const model = buildMarketplaceModel([entry({ id: "a", category: "Sales" })], [], {});
  const keys = model.categoryGroups.map((g) => g.key);
  assert.ok(keys.includes("marketplace:category:sales"));
  assert.ok(!keys.includes("marketplace:category:research"));
  assert.ok(!keys.includes("marketplace:category:credentials"));
});

test("category groups keep Ce order regardless of catalog order", () => {
  // Uses the human labels this build's catalog actually ships (it has no `categoryKey`), which
  // normalise onto the same upstream enum values: "Inbox And Collaboration" -> INBOX_AND_COLLABORATION.
  const model = buildMarketplaceModel(
    [
      entry({ id: "s", category: "Sales" }),
      entry({ id: "c", category: "Inbox And Collaboration" }),
      entry({ id: "p", category: "Productivity" }),
    ],
    [],
    {},
  );
  assert.deepEqual(
    model.categoryGroups.map((g) => g.key),
    [
      "marketplace:category:productivity",
      "marketplace:category:communication",
      "marketplace:category:sales",
    ],
  );
});

test("the human catalog labels collapse onto upstream's buckets", () => {
  // The 16 category strings this build's catalog actually contains, and where `Le` puts each.
  // `MCP` is deliberately absent: it has no counterpart in upstream's 15-value enum, so it is
  // recorded as an uncertainty rather than poured into an arbitrary bucket.
  const expected = {
    "Inbox And Collaboration": "communication",
    Scheduling: "communication",
    Payments: "finance",
    "Finance And Legal": "finance",
    Canvas: "design",
    Design: "design",
    "Documents And Files": "productivity",
    Productivity: "productivity",
    "Data Analytics": "data",
    Sales: "sales",
    Research: "research",
    "Customer Support": "support",
    Infrastructure: "code",
    "Agent Orchestration": "code",
  };
  for (const [label, bucket] of Object.entries(expected)) {
    const model = buildMarketplaceModel([entry({ id: label, category: label })], [], {});
    assert.deepEqual(
      model.categoryGroups.map((g) => g.key),
      [`marketplace:category:${bucket}`],
      `${label} should land in ${bucket}`,
    );
  }
  const mcp = buildMarketplaceModel([entry({ id: "mcp", category: "MCP" })], [], {});
  assert.deepEqual(mcp.categoryGroups, [], "an unmapped category must not be forced into a bucket");
});

test("vendor overrides win over the catalog category, as Te does upstream", () => {
  // Te hard-codes vendor -> bucket (slack -> communication, github -> code, context7 -> research).
  // A row whose category says Productivity but whose vendor is slack belongs in communication.
  const model = buildMarketplaceModel(
    [entry({ id: "slack", name: "slack", displayName: "Slack", category: "Productivity" })],
    [],
    {},
  );
  assert.deepEqual(
    model.categoryGroups.map((g) => g.key),
    ["marketplace:category:communication"],
  );
});

test("selectForYou never returns an installed entry and honours the limit", () => {
  const catalog = [
    entry({ id: "keep", displayName: "Keep" }),
    ...Array.from({ length: 8 }, (_, i) => entry({ id: `c${i}`, displayName: `C${i}` })),
  ];
  const installedServer = server("Keep:keep");
  const model = buildMarketplaceModel(catalog, [installedServer], {});
  const picks = selectForYou(model.rows, {}, FOR_YOU_ROW_LIMIT);
  assert.ok(picks.length <= FOR_YOU_ROW_LIMIT);
  assert.ok(!picks.some((row) => row.id === "keep"), "an installed entry must never be recommended");
});

test("selectForYou prefers team-signal entries, matching upstream's R = {team:0, affinity:1}", () => {
  const catalog = [
    entry({ id: "plain1", displayName: "Plain One", category: "Sales" }),
    entry({ id: "teamHit", displayName: "Team Hit", category: "Sales" }),
    entry({ id: "teamHit2", displayName: "Team Hit Two", category: "Sales" }),
  ];
  const model = buildMarketplaceModel(catalog, [], {});
  const picks = selectForYou(model.rows, { teamHit: 5, teamHit2: 3 }, 2);
  assert.deepEqual(picks.slice(0, 2).map((r) => r.id), ["teamHit", "teamHit2"]);
});

test("installed rows read the subtitle as upstream concatenates it — no separator", () => {
  // The official grid literally renders "1 个连接器14 项技能".
  const catalog = [entry({ id: "g", name: "Gmail", displayName: "Gmail", connectors: [{}], skills: [{}, {}] })];
  const rows = buildInstalledRows([server("Gmail:gmail")], catalog);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Gmail");
  assert.equal(rows[0].subtitle, "1 个连接器2 项技能");
  assert.equal(rows[0].status, "connected");
});

test("a configured server with no catalog entry still produces a row", () => {
  // Upstream builds installed rows from the server list, so a skill-only plugin with no connector
  // still appears. Dropping these would silently shrink the manage grid.
  const rows = buildInstalledRows([server("Cursor Team Kit")], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Cursor Team Kit");
  assert.equal(rows[0].subtitle, "1 个连接器");
});

test("status tone and label match the official status map", () => {
  assert.equal(statusTone("connected"), "connected");
  assert.equal(statusTone("needsAuth"), "warn");
  assert.equal(statusTone("needsGrant"), "warn");
  assert.equal(statusTone("error"), "error");
  assert.equal(statusTone("initializing"), "neutral");
  assert.equal(statusTone("disconnected"), "neutral");
  assert.equal(statusTone("disabledByTeamAdminPolicy"), "neutral");
  // An unknown status is passed through unchanged rather than being coerced to a known label.
  assert.equal(statusTone("somethingNew"), "neutral");

  assert.equal(statusLabel("connected"), "已连接");
  assert.equal(statusLabel("disconnected"), "已断开连接");
  assert.equal(statusLabel("error"), "错误");
  assert.equal(statusLabel("initializing"), "启动中");
  assert.equal(statusLabel("needsAuth"), "需要认证");
  assert.equal(statusLabel("needsGrant"), "需要你批准");
  assert.equal(statusLabel("disabledByTeamAdminPolicy"), "已被团队管理员停用");
  assert.equal(statusLabel("brandNewStatus"), "brandNewStatus");
});

test("显示全部 N 个插件 reports the TOTAL count, not the hidden remainder", () => {
  // Upstream: `_plural({id:"Wy8KR2", values:{0: rows.length}})` — `rows.length`, while the visible
  // window is 6. Using the remainder would read "显示全部 7 个插件" against a 13-plugin list.
  assert.equal(showAllLabel(13), "显示全部 13 个插件");
  assert.equal(showAllLabel(8), "显示全部 8 个插件");
});

test("search matches name, description and category", () => {
  const rows = buildMarketplaceModel(
    [
      entry({ id: "a", displayName: "Gmail", description: "mail", category: "Productivity" }),
      entry({ id: "b", displayName: "Notion", description: "notes", category: "Productivity" }),
    ],
    [],
    {},
  ).rows;
  assert.deepEqual(searchRows(rows, "gmail").map((r) => r.id), ["a"]);
  assert.deepEqual(searchRows(rows, "notes").map((r) => r.id), ["b"]);
  assert.equal(searchRows(rows, "").length, 2);
});
