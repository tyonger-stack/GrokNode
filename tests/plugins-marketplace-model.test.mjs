import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CATEGORY_BUCKET_LABELS,
  CATEGORY_BUCKET_ORDER,
  FOR_YOU_ROW_LIMIT,
  HOMEPAGE_PREVIEW_LIMIT,
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
const MODEL_SRC = readFileSync(MODEL, "utf8");

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
  };
  // `Agent Orchestration` and `MCP` are deliberately NOT in that table. Upstream's `Le` — transcribed
  // verbatim from chunk-marketplace-browse-model-DoOY91TS.js — has 14 entries and names neither, so
  // those rows resolve to no bucket at all. Asserted separately below.
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

/* ------------------------------------------------------------------ *
 * 私有技能 — upstream's converter and edit rule, executed
 * ------------------------------------------------------------------ */

import {
  canEditPrivateSkill,
  privateSkillsFromRecords,
  skillSubtitle,
} from "../frontend/src/extensions/marketplace/model.ts";

/** A raw `WorkflowRecord` as the gateway returns it. */
function record(overrides = {}) {
  return {
    id: "add-connector",
    name: "add-connector",
    description: "Walk through connecting a new MCP connector.",
    body: "Do the thing.",
    trigger: null,
    source: "managed",
    sourceRef: null,
    pluginId: null,
    publishedByCurrentUser: false,
    isEnabledForAgent: true,
    filePath: "/home/box/sand-data/managed-skills/skills/add-connector/SKILL.md",
    helperScripts: [],
    createdAt: 1,
    ...overrides,
  };
}

test("私有技能 keeps managed and workflow skills and drops automations", () => {
  // The live call for this account returns 31 managed + 9 workflow + 1 automation. The automation is
  // a schedule projection, not a skill, and upstream drops it (`view-B5Ug8wEm.js#L802`).
  const skills = privateSkillsFromRecords([
    record({ id: "a", source: "managed" }),
    record({ id: "b", source: "workflow", filePath: "/home/box/sand-data/workflows/b/SKILL.md" }),
    record({ id: "c", source: "automation" }),
  ]);
  assert.deepEqual(skills.map((s) => s.id), ["a", "b"]);
  assert.equal(skills[0].source, "managed");
  assert.equal(skills[1].source, "workflow");
  assert.equal(skills[0].enabled, true);
});

test("私有技能 counts a plugin skill only when the user published it", () => {
  assert.deepEqual(
    privateSkillsFromRecords([record({ source: "plugin", publishedByCurrentUser: true })]).map((s) => s.id),
    ["add-connector"],
  );
  assert.deepEqual(
    privateSkillsFromRecords([record({ source: "plugin", publishedByCurrentUser: false })]),
    [],
    "a plugin you merely installed is not a private skill",
  );
});

test("私有技能 drops malformed records instead of rendering them half-empty", () => {
  assert.deepEqual(privateSkillsFromRecords([record({ name: 42 })]), []);
  assert.deepEqual(privateSkillsFromRecords([record({ id: null })]), []);
  assert.deepEqual(privateSkillsFromRecords([null, "x", 7, []]), []);
  // Optional fields degrade to empty rather than to `undefined`.
  const [skill] = privateSkillsFromRecords([{ id: "z", name: "Z", source: "workflow" }]);
  assert.equal(skill.description, "");
  assert.equal(skill.body, "");
  assert.equal(skill.filePath, "");
  assert.equal(skill.enabled, false);
  assert.equal(skill.pluginId, null);
});

test("the provenance label is 已发布 only for plugin, 本地创建 otherwise", () => {
  const base = { id: "x", name: "x", description: "d", body: "", filePath: "", enabled: true, pluginId: null };
  assert.equal(skillSubtitle({ ...base, source: "plugin" }), "已发布 · d");
  assert.equal(skillSubtitle({ ...base, source: "managed" }), "本地创建 · d");
  assert.equal(skillSubtitle({ ...base, source: "workflow" }), "本地创建 · d");
  // Upstream falls back to a generic noun when there is no description.
  assert.equal(skillSubtitle({ ...base, source: "workflow", description: "" }), "本地创建 · 技能");
});

test("only a user-written skill can be edited, and only with a valid, changed draft", () => {
  const skill = { source: "workflow", name: "n", description: "d", body: "b" };
  assert.equal(canEditPrivateSkill(skill, { name: "n2", description: "d", body: "b" }), true);
  // No change → nothing to save.
  assert.equal(canEditPrivateSkill(skill, { name: "n", description: "d", body: "b" }), false);
  // Any blank field → invalid.
  assert.equal(canEditPrivateSkill(skill, { name: "", description: "d", body: "b" }), false);
  assert.equal(canEditPrivateSkill(skill, { name: "n", description: "  ", body: "b" }), false);
  assert.equal(canEditPrivateSkill(skill, { name: "n", description: "d", body: "" }), false);
  // Platform-installed skills are never editable, however valid the draft.
  const managed = { ...skill, source: "managed" };
  assert.equal(canEditPrivateSkill(managed, { name: "n2", description: "d", body: "b" }), false);
  const plugin = { ...skill, source: "plugin" };
  assert.equal(canEditPrivateSkill(plugin, { name: "n2", description: "d", body: "b" }), false);
});

/* ------------------------------------------------------------------------ *
 * Official 0.66 homepage, captured live over CDP on 2026-10-04.
 *
 * Both apps were running (official 0.66.0 on :9224, this build on :9232) and
 * the same dumper walked the same dialog, so these are like-for-like reads of
 * two live builds rather than two readings of the same app.
 * ------------------------------------------------------------------------ */

const OFFICIAL_HOMEPAGE_066 = {
  为你推荐: ["Agent Compatibility", "Aikido", "Aleph", "Algolia Productivity"],
  精选插件: ["Gmail", "Google Calendar", "Google Drive", "Granola"],
  团队插件: ["oh-my-claudecode"],
  登录与凭据管理: ["1Password"],
  效率: ["Adobe Developer App Builder", "Airtable", "Asana", "Atlassian"],
  通信: ["ActiveCampaign", "AgentMail", "Ando", "Bird"],
  设计: ["Canva", "Docs Canvas", "Figma", "Google Slides"],
  代码: ["Amazon Location Service", "Appwrite", "AWS Amplify", "AWS Core"],
  数据: ["Amplitude", "Antimetal", "Apify", "Astronomer"],
  销售: ["Adspirer", "Amplemarket", "Apollo.io", "Attio"],
  财务: ["1inch", "Aave", "Airwallex AgentOS", "Airwallex Developer"],
  研究: ["Ahrefs", "Context.dev", "Context7", "Crustdata"],
  支持: ["Intercom", "MailerLite", "Plain"],
};

test("上游 Le 表逐字转写：14 条，AGENT_ORCHESTRATION 与 MCP 不在其中 → 落空", () => {
  // Verbatim from `const Le={…}` in the official 0.66 browse-model chunk. The two absences are the
  // load-bearing part: upstream's Re() flat-maps Le[normalize(k)] and DROPS every key that misses
  // rather than defaulting, so an unmapped category yields no bucket and the entry simply does not
  // appear in any homepage section.
  const catalog = [
    { id: "1", displayName: "Amazon Location Service", category: "Infrastructure" },
    { id: "2", displayName: "Appwrite", category: "Infrastructure" },
    { id: "3", displayName: "AWS Amplify", category: "Infrastructure" },
    { id: "4", displayName: "AWS Core", category: "Infrastructure" },
    { id: "5", displayName: "Adapter", category: "Agent Orchestration" },
    { id: "6", displayName: "Arize", category: "Agent Orchestration" },
    { id: "7", displayName: "ActiveCampaign", category: "Inbox And Collaboration" },
    { id: "8", displayName: "Something", category: "MCP" },
  ];
  const model = buildMarketplaceModel(catalog, [], {});
  const names = (bucket) =>
    (model.categoryGroups.find((g) => g.key === `marketplace:category:${bucket}`)?.items ?? []).map((i) => i.name);

  // 代码 is exactly official's four Infrastructure rows — which is what the live build shows, and
  // it holds BECAUSE Agent Orchestration maps to nothing, not because it was mapped to code.
  assert.deepEqual(names("code"), OFFICIAL_HOMEPAGE_066.代码);
  assert.ok(!names("code").includes("Adapter"), "AGENT_ORCHESTRATION is absent from Le → no bucket");
  assert.ok(!names("code").includes("Arize"));
  // MCP is not in the official 15-value enum either, so its 151 rows are unplaced upstream too.
  assert.ok(!model.rows.some((r) => r.name === "Something" && names("code").includes(r.name)));
  // Only the mapped categories produce sections at all.
  assert.deepEqual(model.categoryGroups.map((g) => g.key), [
    // Section order follows CATEGORY_BUCKET_ORDER, where `communication` precedes `code`.
    "marketplace:category:communication",
    "marketplace:category:code",
  ]);
});

test("上游 Te 表逐字转写：16 个厂商 override，且只按 pluginName / name 查", () => {
  const model = buildMarketplaceModel(
    [
      { id: "s", name: "slack", displayName: "Slack" },
      { id: "n", name: "notion", displayName: "Notion" },
      { id: "nw", name: "notion-workspace", displayName: "Notion Workspace" },
      { id: "gh", name: "github", displayName: "GitHub" },
      { id: "ghp", name: "github-plugin", displayName: "GitHub Plugin" },
      { id: "ce", name: "compound-engineering", displayName: "Compound Engineering" },
      { id: "c7", name: "context7", displayName: "Context7" },
      { id: "c7p", name: "context7-plugin", displayName: "Context7 Plugin" },
      { id: "pl", name: "parallel", displayName: "Parallel" },
      // displayName must NOT be consulted — upstream's Ue() reads pluginName then name only.
      { id: "x", name: "some-unknown-slug", displayName: "Slack" },
    ],
    [],
    {},
  );
  const bucketOf = (label) => {
    const g = model.categoryGroups.find((x) => x.items.some((i) => i.name === label));
    return g ? g.key.replace("marketplace:category:", "") : null;
  };
  assert.equal(bucketOf("Slack"), "communication");
  assert.equal(bucketOf("Notion"), "productivity");
  assert.equal(bucketOf("Notion Workspace"), "productivity");
  assert.equal(bucketOf("GitHub"), "code");
  assert.equal(bucketOf("GitHub Plugin"), "code");
  assert.equal(bucketOf("Compound Engineering"), "code");
  assert.equal(bucketOf("Context7"), "research");
  assert.equal(bucketOf("Context7 Plugin"), "research");
  assert.deepEqual(bucketOf("Parallel") === "research" || bucketOf("Parallel") === "data", true);
  // `some-unknown-slug` has no `Te` row and no category, so it is unplaced — displayName "Slack"
  // must not rescue it.
  assert.equal(bucketOf("some-unknown-slug"), null);
});

test("categoryKeys 数组求并集：一条可落多个桶，缺失的 key 被丢弃而非兜底", () => {
  // Official's Re(): `categoryKeys ?? (categoryKey === undefined ? [category] : [categoryKey])`,
  // flat-mapped through Le. This is why Canva shows in BOTH 效率 and 设计 on 0.66.
  const model = buildMarketplaceModel(
    [{ id: "c", name: "some-canva-slug", displayName: "Canva-like", categoryKeys: ["PRODUCTIVITY", "DESIGN", "MCP"] }],
    [],
    {},
  );
  const buckets = model.categoryGroups
    .filter((g) => g.items.some((i) => i.name === "Canva-like"))
    .map((g) => g.key.replace("marketplace:category:", ""));
  assert.deepEqual(buckets.sort(), ["design", "productivity"], "MCP must be dropped, not defaulted");
  // categoryKey (singular) still works, and beats `category`.
  const single = buildMarketplaceModel(
    [{ id: "d", name: "x", displayName: "X", category: "MCP", categoryKey: "INFRASTRUCTURE" }],
    [],
    {},
  );
  assert.ok(single.categoryGroups.some((g) => g.key === "marketplace:category:code" && g.items.some((i) => i.name === "X")));
});

test("官方 0.66 首页区块表：13 个区块，查看全部 只在 >4 行时出现", () => {
  // 支持 renders 3 rows and official gives it NO 查看全部, while every 4-row section gets one.
  // That is the rule `sliceForPreview` implements, pinned to a capture rather than to my reasoning.
  const threeRows = sliceForPreview(
    ["Intercom", "MailerLite", "Plain"].map((displayName) => entry({ id: displayName, displayName })),
    true,
    HOMEPAGE_PREVIEW_LIMIT,
  );
  assert.equal(threeRows.visible.length, 3);
  assert.equal(threeRows.hiddenCount, 0, "官方 支持 只有 3 行且没有查看全部 —— 未达上限即无可展开项");
  const fourRows = sliceForPreview(
    OFFICIAL_HOMEPAGE_066.数据.map((displayName) => entry({ id: displayName, displayName })),
    true,
    HOMEPAGE_PREVIEW_LIMIT,
  );
  assert.equal(fourRows.visible.length, 4, "a 4-row section is exactly at the preview cap, so it still has 查看全部");
  assert.equal(fourRows.hiddenCount, 0);
  // And official's section set is these 13 titles, in this order.
  assert.deepEqual(Object.keys(OFFICIAL_HOMEPAGE_066), [
    "为你推荐", "精选插件", "团队插件", "登录与凭据管理",
    "效率", "通信", "设计", "代码", "数据", "销售", "财务", "研究", "支持",
  ]);
});

test("厂商级 override 锚定官方实渲染：Canva→设计、MailerLite→支持", () => {
  // Both are single-row observations off the running 0.66, and both are counterexamples to a
  // pure category→bucket rule: Canva is catalogued PRODUCTIVITY yet renders in 设计, and MailerLite
  // is catalogued INBOX_AND_COLLABORATION yet renders in 支持. Feeding official's own catalog through
  // this model, each override independently makes its section reproduce official's rows.
  const catalog = [
    { id: "c1", name: "canva", displayName: "Canva", category: "Productivity" },
    { id: "c2", displayName: "Docs Canvas", category: "Canvas" },
    { id: "c3", name: "figma", displayName: "Figma", category: "Productivity" },
    { id: "c4", displayName: "Google Slides", category: "Design" },
    { id: "s1", displayName: "Intercom", category: "Customer Support" },
    { id: "s2", name: "mailerlite", displayName: "MailerLite", category: "Inbox And Collaboration" },
    { id: "s3", displayName: "Plain", category: "Customer Support" },
    { id: "x1", name: "mobbin", displayName: "Mobbin", category: "Design" },
  ];
  const names = (model, bucket) =>
    (model.categoryGroups.find((g) => g.key === `marketplace:category:${bucket}`)?.items ?? []).map((i) => i.name);
  const model = buildMarketplaceModel(catalog, [], []);

  // 只比对预览窗口（前 4）——官方 0.66 的区块也是这个规则
  assert.deepEqual(names(model, "design").slice(0, 4), ["Canva", "Docs Canvas", "Figma", "Google Slides"]);
  assert.deepEqual(names(model, "support"), ["Intercom", "MailerLite", "Plain"]);
  // Mobbin is plain DESIGN and must stay in the design bucket on its own merits — the compensation
  // is pinned to the `canva` slug, not a blanket re-route of everything Productivity-shaped. Figma
  // reaches 设计 through the genuine upstream `Te` row, which is what proves both paths coexist.
  assert.ok(names(model, "design").includes("Mobbin"));

  // The unresolved sibling is pinned as a known gap, not silently dropped: Bird renders in 通信 in
  // 0.66 even though Adapter — earlier in catalog order under the same AGENT_ORCHESTRATION key —
  // does not, and no field we can read separates them. If a future capture explains it, this is the
  // assertion to update first.
  assert.match(MODEL_SRC, /DATA-GAP COMPENSATIONS — NOT upstream rules/);
  assert.match(MODEL_SRC, /AGENT_ORCHESTRATION\|INBOX_AND_COLLABORATION/);
  // The compensations are keyed the way upstream keys Te — pluginName/name — so they only fire on a
  // real catalog row whose slug matches. Assert that scoping explicitly.
  assert.match(MODEL_SRC, /vendor-pinned rather than category-wide on purpose/);
});

// ── categoryKeys passthrough (2026-10-04) ──────────────────────────────────────
// `mcp.catalog()` used to keep only the first curated key, so the renderer's `Re()` always saw a
// single value and the homepage came out a strict subset of official's. The bridge now forwards
// `categoryKey` + the whole `categoryKeys` array, and the two fitted stand-ins must yield to it.

test("a real categoryKeys array drives bucketing and outranks the fitted stand-ins", () => {
  const names = (model, bucket) =>
    (model.categoryGroups.find((g) => g.key === `marketplace:category:${bucket}`)?.items ?? []).map((i) => i.name);
  // Canary is deliberately a DIFFERENT vendor from canva/mailerlite, so this asserts the upstream
  // path (array -> Le) rather than either compensation.
  const withKeys = [
    entry({ name: "canary", displayName: "Canary", category: "Productivity", categoryKeys: ["DESIGN"] }),
    entry({ name: "figma", displayName: "Figma", category: "Productivity", categoryKeys: ["PRODUCTIVITY", "DESIGN"] }),
  ];
  const withArray = buildMarketplaceModel(withKeys, [], []);
  assert.ok(names(withArray, "design").includes("Canary"), "array value must place Canary in 设计");
  assert.ok(names(withArray, "design").includes("Figma"), "genuine upstream Te[f] must still win");

  // Without the array the fitted compensation is still allowed to stand in.
  const withoutKeys = [entry({ name: "canva", displayName: "Canva", category: "Productivity" })];
  assert.ok(
    names(buildMarketplaceModel(withoutKeys, [], []), "design").includes("Canva"),
    "compensation must still cover the degraded catalog shape",
  );

  // With the array, the compensation steps aside — Canva is PRODUCTIVITY only, so it must NOT be
  // force-routed into 设计 any more. This is what would silently regress if the gate were removed.
  const canvaWithKeys = [entry({ name: "canva", displayName: "Canva", category: "Productivity", categoryKeys: ["PRODUCTIVITY"] })];
  assert.ok(
    !names(buildMarketplaceModel(canvaWithKeys, [], []), "design").includes("Canva"),
    "a real PRODUCTIVITY-only key list must not be overridden by the fitted rule",
  );
});

test("a key missing from the bucket table drops the entry out of every bucket", () => {
  const names = (model, bucket) =>
    (model.categoryGroups.find((g) => g.key === `marketplace:category:${bucket}`)?.items ?? []).map((i) => i.name);
  // Upstream: `Le[k]` undefined contributes nothing. AGENT_ORCHESTRATION is not in the 0.66 table,
  // so a bare AGENT_ORCHESTRATION entry belongs nowhere — this is what makes official's 通信 omit
  // Adapter while still showing Bird (whose keys also carry INBOX_AND_COLLABORATION).
  const rows = [
    entry({ name: "adapter", displayName: "Adapter", category: "Agent Orchestration", categoryKeys: ["AGENT_ORCHESTRATION"] }),
    entry({ name: "bird", displayName: "Bird", category: "Agent Orchestration", categoryKeys: ["AGENT_ORCHESTRATION", "INBOX_AND_COLLABORATION"] }),
  ];
  const model = buildMarketplaceModel(rows, [], []);
  const comm = names(model, "communication");
  assert.ok(comm.includes("Bird"), "Bird reaches 通信 through its second key");
  assert.ok(!comm.includes("Adapter"), "Adapter must land in NO bucket, not 通信");
});
