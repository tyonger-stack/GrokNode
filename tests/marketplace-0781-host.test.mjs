import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");

async function bundle(entryPoint, temporary, name) {
  const outfile = path.join(temporary, name + ".cjs");
  await build({ entryPoints: [path.join(root, entryPoint)], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
  return createRequire(import.meta.url)(outfile);
}

const temporary = await mkdtemp(path.join(root, "node_modules", ".cache", "marketplace-0781-host-"));
try {
  const { officialNativeCatalogEntries } = await bundle("source/shared/node/mcp/mcp-native-entries.ts", temporary, "native-entries");
  const { marketplacePluginToView } = await bundle("source/shared/node/mcp/mcp-marketplace.ts", temporary, "marketplace");
  const { SandMcpCatalogFlow } = await bundle("source/shared/node/mcp/mcp-catalog-flow.ts", temporary, "catalog");
  const { fetchTeamPluginPopularity } = await bundle("source/electron-main/mcp/mcp-team-popularity.ts", temporary, "team-popularity");

  test("official's native catalogue entries localize per the persisted preference", () => {
    const zh = officialNativeCatalogEntries({ preference: "zh-CN", systemTags: [] });
    assert.equal(zh.length, 2, "official 0.78.1 carries exactly two native entries");
    assert.deepEqual(zh.map((entry) => entry.id), ["native:onepassword", "native:email"], "official's own id scheme");
    const [onepassword, email] = zh;
    assert.equal(onepassword.displayName, "1Password", "official's lRe keeps 1Password a plain string");
    assert.equal(onepassword.description, "让 Grok Bot 使用你的 1Password 登录信息在它自己的电脑上登录网站。每个请求都由你在 1Password 中批准，Grok Bot 永远看不到这些值");
    assert.equal(onepassword.category, "密码管理器");
    assert.equal(onepassword.websiteUrl, "https://1password.com");
    assert.equal(email.displayName, "邮箱");
    assert.equal(email.description, "为 Grok Bot 提供专属域名下的邮箱地址。收到的邮件只会通过你设置的例行任务唤醒 Bot。");
    assert.equal(email.category, "收件箱与协作");
    assert.equal(email.websiteUrl, undefined, "official's email entry carries no websiteUrl");

    const en = officialNativeCatalogEntries({ preference: "en", systemTags: [] });
    assert.equal(en[0].description, "Let Grok Bot sign in to sites on its computer with your 1Password logins. You approve each request in 1Password, and Grok Bot never sees the values");
    assert.equal(en[0].category, "Password Managers");
    assert.equal(en[1].displayName, "Email");
    assert.equal(en[1].category, "Inbox and Collaboration");
  });

  test("a follow-system preference resolves against the OS tags, per catalogue read", () => {
    const zhSystem = officialNativeCatalogEntries({ preference: "follow-system", systemTags: ["zh-Hans-CN"] });
    assert.equal(zhSystem[1].displayName, "邮箱", "a Chinese system resolves the email entry in Chinese");
    const enSystem = officialNativeCatalogEntries({ preference: "follow-system", systemTags: ["en-US"] });
    assert.equal(enSystem[1].displayName, "Email", "an English system resolves the email entry in English");
  });

  test("the native entries carry official's exact field set — no pluginName, no iconUrl", () => {
    for (const entry of officialNativeCatalogEntries({ preference: "zh-CN", systemTags: [] })) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ["category", "categoryKey", "categoryKeys", "description", "displayName", "id", "name", "native", "publisher"].concat(
          entry.websiteUrl == null ? [] : ["websiteUrl"],
        ),
        "official's Vb emits exactly these fields",
      );
      assert.equal(entry.iconUrl, undefined, "official resolves native icons from the name, not the catalogue");
      assert.equal(entry.pluginName, undefined);
      assert.equal(entry.connectors, undefined);
      assert.equal(entry.skills, undefined);
    }
  });

  test("the catalogue sorts by popularityRank ascending with nulls last, displayName as the tie-break", async () => {
    const flow = new SandMcpCatalogFlow({
      localOnly: true,
      getMachineId: async () => "sort-test",
      fetchMarketplace: async () => ({
        includesPrivateMarketplaces: false,
        plugins: [
          { pluginId: "4", name: "n4", displayName: "Zero", description: "", category: "MCP", connectors: [], skills: [], mcpServers: [], variableFields: [] },
          { pluginId: "1", name: "n1", displayName: "Beta", description: "", category: "MCP", connectors: [], skills: [], mcpServers: [], variableFields: [], popularityRank: 7 },
          { pluginId: "2", name: "n2", displayName: "Alpha", description: "", category: "MCP", connectors: [], skills: [], mcpServers: [], variableFields: [], popularityRank: 7 },
          { pluginId: "3", name: "n3", displayName: "Ranked", description: "", category: "MCP", connectors: [], skills: [], mcpServers: [], variableFields: [], popularityRank: 2 },
        ],
      }),
    });
    const views = await flow.getCatalog(null);
    const names = views.map((view) => view.displayName);
    assert.deepEqual(
      names.slice(0, 3),
      ["Ranked", "Alpha", "Beta"],
      "the ranked entries lead, popularityRank ascending with displayName.localeCompare as the tie-break",
    );
    assert.ok(names.indexOf("Zero") > names.indexOf("Beta"), "an unranked entry follows every ranked one");
    assert.ok(names.length > 4, "the pinned supplements ride along, unranked, behind the ranked entries");
  });

  test("the view projection carries popularityRank through, official's proto field 44", () => {
    const plugin = {
      pluginId: "1", name: "n", displayName: "N", description: "", category: "MCP",
      connectors: [], skills: [], mcpServers: [], variableFields: [], popularityRank: 44,
    };
    assert.equal(marketplacePluginToView(plugin).popularityRank, 44);
    assert.equal(marketplacePluginToView({ ...plugin, popularityRank: undefined }).popularityRank, undefined);
  });

  test("team popularity maps the dashboard counts and fails closed", async () => {
    const counts = [{ pluginId: 2, memberInstallCount: 7 }, { pluginId: "big", memberInstallCount: 3 }];
    const map = await fetchTeamPluginPopularity({
      client: {
        getMe: async () => ({ teamId: "team-1" }),
        getTeamPluginPopularity: async () => ({ counts }),
      },
    });
    assert.equal(map.get("2"), 7);
    assert.equal(map.get("big"), 3, "bigint ids stringify into the same key space the catalogue reads");
    const noTeam = await fetchTeamPluginPopularity({
      client: {
        getMe: async () => ({}),
        getTeamPluginPopularity: async () => { throw new Error("unreachable"); },
      },
    });
    assert.equal(noTeam.size, 0, "a personal account has no team counts");
    const failing = await fetchTeamPluginPopularity({
      client: {
        getMe: async () => { throw new Error("dashboard down"); },
        getTeamPluginPopularity: async () => ({ counts: [] }),
      },
    });
    assert.equal(failing.size, 0, "a failed dashboard call must not break the marketplace render");
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
