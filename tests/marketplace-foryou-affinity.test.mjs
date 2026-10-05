import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

/**
 * `selectForYou`（官方 `te`）的 affinity 键守卫。
 *
 * ## 这个 bug 是什么
 *
 * 官方的 `te` 读的是**条目自己的 `category` 标签**：
 *   `affinityStrength: r.category.trim().length === 0 ? 0 : (affinityByCategory.get(collated(r.category)) ?? 0)`
 *
 * 本仓库此前用 `bucketsOf(entry)` 算 affinity，理由听起来很顺：既然首页分区也按桶分组，
 * affinity 跟着同一套分组走应该才对。但桶表 `Le` **没有 `MCP` 的映射**（也没有
 * `AGENT_ORCHESTRATION`），于是所有 `category: "MCP"` 的条目 affinity 恒为 0，
 * **结构上永远不可能被选中** —— 实测 403 条里有 151 条如此。
 *
 * ## 为什么它长期没被发现
 *
 * 官方与本地渲染出来的那 4 行都「看起来像字母序」，很容易被读成巧合或个性化推荐。
 * 真正把它坐实的是一次交叉实验：用**官方自己的 catalog + 官方自己界面上的
 * 「已安装 16 个」**喂进本仓库的 `selectForYou` ——
 *   · category 标签版 → `Agent Compatibility / Aikido / Aleph / Algolia Productivity`（与官方逐条一致）
 *   · 桶版           → `ActiveCampaign / AgentMail / Ando / Bird`
 * 而官方那 4 个赢家的 `categoryKey` 全是 `undefined`，在桶表里**落不到任何桶**，
 * 所以桶版不是「算错」，是**根本选不到它们**。
 *
 * 下面的用例把这个判别力固定下来：既用官方实机数据做端到端复现，也用最小夹具
 * 证明「共享 category 标签但落不到任何桶」的两条也会互相给 affinity。
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(path.join(repoRoot, ...p), "utf8");

const FIXTURE = JSON.parse(read("tests", "fixtures", "official-foryou-attribution.json"));

const outfile = path.join(repoRoot, "node_modules", ".cache", "tests-foryou-model.mjs");
await build({
  entryPoints: [path.join(repoRoot, "frontend/src/extensions/marketplace/model.ts")],
  bundle: true, platform: "node", format: "esm", outfile, packages: "external", logLevel: "error",
});
const { buildMarketplaceModel, selectForYou, FOR_YOU_ROW_LIMIT } = await import(`file://${outfile}`);

/** `toRow` matches a server by displayName — that is the model's only "installed" signal. */
const asInstalled = (displayName) => ({ id: `syn-${displayName}`, name: displayName });

test("给定官方自己的 catalog 与它界面上的已装名单，复现官方渲染的那 4 行", () => {
  assert.equal(FIXTURE.catalog.length, 403, "夹具是官方实机的全量 catalog");
  assert.equal(FIXTURE.officialInstalledNames.length, 16, "官方界面写的是「已安装 16 个」");

  const model = buildMarketplaceModel(
    FIXTURE.catalog,
    FIXTURE.officialInstalledNames.map(asInstalled),
    {},
  );
  assert.deepEqual(
    model.forYou.map((row) => row.name),
    FIXTURE.officialForYou,
    "category 标签版的 affinity 必须逐条复现官方",
  );
});

test("那 4 个赢家全都落不到任何桶 —— 所以桶版不是算错，是选不到", () => {
  // 这是上面那条的因果解释：若赢家都在某个桶里，「用桶也算得对」就无法被排除。
  const byName = new Map(FIXTURE.catalog.map((e) => [e.displayName, e]));
  const model = buildMarketplaceModel(FIXTURE.catalog, FIXTURE.officialInstalledNames.map(asInstalled), {});
  for (const winner of FIXTURE.officialForYou) {
    const entry = byName.get(winner);
    assert.ok(entry, `夹具里应有 ${winner}`);
    const inBucket = model.categoryGroups.some((g) => g.items.some((r) => r.id === entry.id));
    assert.equal(inBucket, false, `${winner} 竟然落进了某个分区，判别前提被破坏`);
  }
  // 桶表确实不认 MCP —— 这正是 affinity 被清零的机制
  const mcpRows = FIXTURE.catalog.filter((e) => String(e.category) === "MCP");
  assert.ok(mcpRows.length > 100, `MCP 类条目应占相当比例，实测 ${mcpRows.length}`);
  const anyMcpInBucket = mcpRows.some((e) => model.categoryGroups.some((g) => g.items.some((r) => r.id === e.id)));
  assert.equal(anyMcpInBucket, false, "MCP 类不应出现在任何分区里（Le 无该映射）");
});

test("最小判别：同 category 标签、但都落不到桶的两条，必须互相给 affinity", () => {
  // 不依赖大夹具，把机制单独钉死。桶版在这里必然给 0 → 一个都选不出来。
  const catalog = [
    { id: "inst", displayName: "Installed One", name: "installed-one", category: "MCP" },
    { id: "cand", displayName: "Candidate One", name: "candidate-one", category: "MCP" },
    { id: "other", displayName: "Candidate Two", name: "candidate-two", category: "Design" },
  ];
  const rows = catalog.map((entry) => ({ entry, id: entry.id, name: entry.displayName, isInstalled: entry.id === "inst" }));
  assert.deepEqual(selectForYou(rows, {}, 1).map((r) => r.name), ["Candidate One"], "唯一有 affinity 的候选应被选中");
});

test("反向判别：同桶但不同 category 标签的两条，不应互相给 affinity", () => {
  // 若有人把 affinity 又改回按桶算，这条会立刻红。
  const catalog = [
    { id: "inst", displayName: "Installed One", name: "installed-one", category: "Productivity" },
    { id: "cand", displayName: "Candidate One", name: "candidate-one", category: "Productivity" },
    { id: "other", displayName: "Candidate Two", name: "candidate-two", category: "Data" },
  ];
  const rows = catalog.map((entry) => ({ entry, id: entry.id, name: entry.displayName, isInstalled: entry.id === "inst" }));
  assert.deepEqual(selectForYou(rows, {}, 2).map((r) => r.name), ["Candidate One"], "只有 category 标签相同的那条拿到 affinity");
});

test("selectForYou 不得再走 bucketsOf —— 那是这个 bug 的根", () => {
  const src = read("frontend", "src", "extensions", "marketplace", "model.ts");
  const start = src.indexOf("export function selectForYou");
  assert.ok(start > 0, "找不到 selectForYou");
  const end = src.indexOf("interface Scored", start);
  assert.ok(end > start, "切片的结束锚点必须真的在起点之后");
  const body = src.slice(start, end);
  assert.doesNotMatch(body, /bucketsOf/, "affinity 计算里不应再出现 bucketsOf");
  assert.match(body, /categoryAffinityKey/, "affinity 键必须走 categoryAffinityKey");
  assert.match(
    src,
    /function categoryAffinityKey\(entry: CatalogEntry\): string \{\s*return str\(entry\.category\)\.trim\(\);/,
    "categoryAffinityKey 只能返回 category 标签本身",
  );
});

test("行数上限仍是 4（FOR_YOU_ROW_LIMIT）", () => {
  assert.equal(FOR_YOU_ROW_LIMIT, 4);
  const catalog = Array.from({ length: 20 }, (_, i) => ({
    id: `c${i}`, displayName: `Cand ${String(i).padStart(2, "0")}`, name: `c${i}`, category: "MCP",
  }));
  const rows = [
    { entry: { id: "i", displayName: "Inst", name: "i", category: "MCP" }, id: "i", name: "Inst", isInstalled: true },
    ...catalog.map((entry) => ({ entry, id: entry.id, name: entry.displayName, isInstalled: false })),
  ];
  assert.equal(selectForYou(rows, {}, FOR_YOU_ROW_LIMIT).length, 4);
});
