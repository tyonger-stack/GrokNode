import type { McpServerConfig } from "./mcp-display-runtime.js";
import {
  bestEffortToken,
  createDashboardClient,
  CURSOR_MARKETPLACE_REQUEST_TIMEOUT_MS,
} from "../marketplace/cursor-marketplace-client.js";
import { rememberPluginLogoUrl } from "../marketplace/cursor-marketplace-logo-registry.js";
export { bestEffortToken } from "../marketplace/cursor-marketplace-client.js";
export { resolvePluginLogo } from "./mcp-marketplace-logo.js";
import {
  createDeadlinePolicy,
  realClock,
  type DeadlinePolicy,
} from "../../../internal/scheduling.js";
import {
  pluginVariablesSchemaToFields,
  type PluginVariableField,
} from "./mcp-plugin-variables.js";
export interface SandMarketplacePlugin {
  pluginId: string;
  name: string;
  /**
   * The plugin's OWN name (`Plugin.name` on the wire), carried separately from `name`.
   *
   * `name` is `mcpServers[0].name ?? plugin.name` — the first MCP server's name, which is often a
   * generic handle rather than the plugin's identity. Official 0.66 emits both, and the renderer's
   * vendor-override probe (`Re()` = `Te[vendor] ?? …`) reads `pluginName` FIRST and only then
   * `name`. Measured on the official build's own 404-entry catalog: `pluginName` is present on all
   * 404, and on 85 of them it differs from `name` (`aikido` → `aikido-cursor-plugin`,
   * `aws-mcp` → `aws-amplify` / `aws-core` / `sagemaker-ai`, `oh-my-claudecode`'s `name` is the
   * literal `"t"` while `pluginName` is `oh-my-claudecode`).
   *
   * @evidence official 0.66 `dist/electron-main/main-app.cjs`:
   *   `return{pluginId:e.id.toString(),name:r,pluginName:e.name,displayName:…}` where
   *   `r = e.mcpServers[0]?.name ?? e.name`. So the field is `Plugin.name` verbatim, not derived.
   *
   * Dropping it is a projection loss of the same class as the `categoryKeys` one that already bit
   * this build twice: the renderer's model already reads `pluginName`, and without it the probe
   * silently falls back to `name` and can miss a `Te` override whose key is the plugin's real name.
   */
  pluginName: string;
  displayName: string;
  description: string;
  category: string;
  /** Upstream's first curated key, e.g. `"PRODUCTIVITY"`. Official exposes it to the renderer. */
  categoryKey: string | undefined;
  /** Upstream's full curated key list. Multi-valued, and load-bearing for bucketing. */
  categoryKeys: string[];
  logoUrl: string | undefined;
  /**
   * Upstream's top-level `websiteUrl` — the publisher's own site (`https://cursor.com/` for Gmail).
   * This is what the detail page's `信息 · 网站` row shows, and it is NOT the same value as
   * `repositoryUrl`. Collapsing the two (the earlier shape) rendered `github.com` where official
   * renders `cursor.com`.
   */
  websiteUrl: string | undefined;
  /** Upstream's `repositoryUrl` — the target behind the `查看源码` link. */
  repositoryUrl: string | undefined;
  /**
   * The link target used by `查看源码`. Kept separate from `websiteUrl` on purpose: official shows
   * the website host in `信息 · 网站` and the repository href in `查看源码` for the same entry.
   */
  homepage: string | undefined;
  sourceUrls: string[];
  connectors: Array<{ name: string; description: string }>;
  skills: Array<{ name: string; description: string; sourceUrl?: string }>;
  variableFields: PluginVariableField[];
  marketplace?: {
    name: string;
    displayName: string;
    ownership: "team" | "user";
  };
  publisher?: { name: string; displayName: string; isUserOwned: boolean };
}
export function marketplacePluginToView(plugin: SandMarketplacePlugin) {
  return {
    id: plugin.pluginId,
    name: plugin.name,
    // Official 0.66 `marketplacePluginToView` (`T7t`) emits `pluginName` between `name` and
    // `displayName`: `{id:e.pluginId,name:e.name,pluginName:e.pluginName,displayName:…}`.
    // Position matters only for readability, but the field's PRESENCE is load-bearing — the
    // renderer's vendor probe reads it before `name`.
    pluginName: plugin.pluginName,
    displayName: plugin.displayName,
    description: plugin.description,
    category: plugin.category,
    // Upstream's renderer receives both the first curated key and the whole array — the homepage's
    // bucketing (`Re()`) is driven by the array, and a key missing from the bucket table is dropped
    // rather than defaulted. This view is the second projection between the wire and the renderer
    // (the first is `toPlugin`), so both fields have to be carried here too or the renderer silently
    // falls back to the single human-readable label.
    categoryKey: plugin.categoryKey,
    categoryKeys: plugin.categoryKeys,
    // Both URL fields have to survive this projection as well. This is the second of two hops
    // between the wire and the renderer, and it has already silently dropped `categoryKeys` once —
    // adding a field to `toPlugin` alone leaves the renderer with `undefined`.
    websiteUrl: plugin.websiteUrl,
    repositoryUrl: plugin.repositoryUrl,
    homepage: plugin.homepage,
    iconUrl: plugin.logoUrl,
    connectors: plugin.connectors,
    skills: plugin.skills,
    ...(plugin.variableFields.length > 0
      ? { fields: plugin.variableFields }
      : {}),
    ...(plugin.marketplace == null ? {} : { marketplace: plugin.marketplace }),
    ...(plugin.publisher == null ? {} : { publisher: plugin.publisher }),
  };
}
export function toRawGithubUrl(blobUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(blobUrl);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com") return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 5 || parts[2] !== "blob") return null;
  const [owner, repo, , ref, ...rest] = parts;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rest.join("/")}`;
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value != null && !Array.isArray(value);
export function normalizeServer(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const { transport, ...rest } = value;
  if (typeof transport === "string" && rest.type == null) {
    if (transport === "sse") rest.type = "sse";
    else if (transport === "http" || transport === "streamableHttp")
      rest.type = "http";
  }
  return rest;
}
export function normalizePluginConfig(
  raw: unknown,
  safeParse: (value: unknown) => { success: boolean; data?: McpServerConfig },
): Record<string, McpServerConfig> {
  if (!isObject(raw)) return {};
  const candidate = isObject(raw.mcpServers) ? raw.mcpServers : raw,
    servers: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(candidate)) {
    if (!isObject(value)) continue;
    const parsed = safeParse(normalizeServer(value));
    if (parsed.success && parsed.data != null) servers[name] = parsed.data;
  }
  return servers;
}
export interface MarketplaceDeps {
  bestEffortToken(getAccessToken: unknown): Promise<unknown>;
  createClient(getAccessToken: unknown, getMachineId: unknown): any;
  timeoutMs: number;
  rememberPluginLogoUrl(url: string): void;
  safeParseServer(value: unknown): { success: boolean; data?: McpServerConfig };
  fetch(url: string, signal: AbortSignal): Promise<Response>;
  fetchTimeoutMs: number;
  fetchDeadline?: DeadlinePolicy;
}
export type MarketplaceListingDeps = Pick<
  MarketplaceDeps,
  "bestEffortToken" | "createClient" | "timeoutMs" | "rememberPluginLogoUrl"
>;
const defaultMarketplaceListingDependencies: MarketplaceListingDeps = {
  bestEffortToken,
  createClient: createDashboardClient,
  timeoutMs: CURSOR_MARKETPLACE_REQUEST_TIMEOUT_MS,
  rememberPluginLogoUrl,
};
function toPlugin(
  plugin: any,
  deps: Pick<MarketplaceDeps, "rememberPluginLogoUrl">,
): SandMarketplacePlugin | null {
  const skills = plugin.skills.map((skill: any) => ({
    name: skill.name,
    description: skill.description ?? "",
    ...(skill.sourceUrl != null && skill.sourceUrl.length > 0
      ? { sourceUrl: skill.sourceUrl }
      : {}),
  }));
  if (plugin.mcpServers.length === 0 && skills.length === 0) return null;
  const publisher = plugin.publisher,
    logoUrl = publisher?.logoUrl || plugin.logoUrl || undefined;
  if (logoUrl != null) deps.rememberPluginLogoUrl(logoUrl);
  const marketplace = plugin.marketplace;
  // `curatedCategoryKeys` is a string[] (proto: aiserver/v1 Plugin.curatedCategoryKeys) and the
  // official build exposes BOTH the first key and the whole array to the renderer. Upstream's
  // bucketing is `Re()` = `Te[vendor] ?? union(Le[normalize(k)] for k in categoryKeys)` — the array
  // is load-bearing, because a key missing from `Le` is dropped rather than defaulted, so the
  // *absence* of e.g. AGENT_ORCHESTRATION is what keeps `Adapter` out of every bucket while `Bird`
  // (which also carries INBOX_AND_COLLABORATION) lands in 通信. Keeping only the first element and
  // dropping the rest made the homepage a strict subset of official's and forced fitted
  // per-vendor rules downstream; pass the real shape through instead.
  const categoryKeys: string[] = plugin.curatedCategoryKeys.filter(
    (value: string) => value.length > 0,
  );
  const categoryKey = categoryKeys[0];
  return {
    pluginId: plugin.id.toString(),
    name: plugin.mcpServers[0]?.name ?? plugin.name,
    // Official 0.66 `main-app.cjs`: `name:r,pluginName:e.name` with
    // `r = e.mcpServers[0]?.name ?? e.name`. The plugin's own name, NOT the server handle above.
    pluginName: plugin.name,
    displayName:
      plugin.displayName.length > 0 ? plugin.displayName : plugin.name,
    description: plugin.description ?? "",
    categoryKey,
    categoryKeys,
    category:
      categoryKey == null
        ? "MCP"
        : categoryKey
            .toLowerCase()
            .split("_")
            .map((word: string) =>
              word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word,
            )
            .join(" "),
    logoUrl,
    // `websiteUrl` and `repositoryUrl` are two different upstream fields and upstream keeps them
    // apart: Gmail renders `cursor.com` in `信息 · 网站` and links `查看源码` at
    // `https://github.com/cursor/plugins`.
    //
    // `websiteUrl` lives on the PUBLISHER, not on the plugin. Upstream's own mapper reads
    // `websiteUrl: $t(n?.websiteUrl)` with `n = e.publisher` and hoists it to the top level of
    // the view object, which is why an official catalog entry has a top-level `websiteUrl` even
    // though the `Plugin` message has no such field. The `Publisher` message does declare it.
    //
    // Reading `plugin.websiteUrl` — the obvious guess, and what this used to do — is always
    // `undefined` because `Plugin` has no top-level website field, so the 网站 row silently fell
    // back to the repository host and rendered `github.com` on every entry.
    //
    // Do not "simplify" this back to `plugin.publisher?.websiteUrl == null ? undefined : …` on
    // the grounds that our own publisher projection only shows name/displayName/isUserOwned: that
    // projection is lossy and is the reason this was ever wrong.
    websiteUrl: publisher?.websiteUrl || undefined,
    repositoryUrl: plugin.repositoryUrl || undefined,
    homepage: plugin.repositoryUrl || undefined,
    sourceUrls: plugin.mcpServers
      .map((server: any) => server.sourceUrl ?? "")
      .filter((url: string) => url.length > 0),
    connectors: plugin.mcpServers.map((server: any) => ({
      name: server.name,
      description: server.description ?? "",
    })),
    skills,
    variableFields: pluginVariablesSchemaToFields(plugin.variables?.toJson()),
    ...(marketplace != null &&
    (marketplace.teamId != null || marketplace.userId != null)
      ? {
          marketplace: {
            name: marketplace.name,
            displayName:
              marketplace.displayName != null &&
              marketplace.displayName.length > 0
                ? marketplace.displayName
                : marketplace.name,
            ownership:
              marketplace.teamId != null
                ? ("team" as const)
                : ("user" as const),
          },
        }
      : {}),
    ...(publisher == null
      ? {}
      : {
          publisher: {
            name: publisher.name,
            displayName:
              publisher.displayName.length > 0
                ? publisher.displayName
                : publisher.name,
            isUserOwned: publisher.isUserOwned,
          },
        }),
  };
}
export async function fetchMarketplaceMcpPlugins(
  getAccessToken: unknown,
  getMachineId: unknown,
  deps: MarketplaceListingDeps = defaultMarketplaceListingDependencies,
): Promise<{
  plugins: SandMarketplacePlugin[];
  includesPrivateMarketplaces: boolean;
}> {
  const client = deps.createClient(getAccessToken, getMachineId),
    response = await client.listMarketplacePlugins(
      { excludeCloudAgentPlugins: true },
      { timeoutMs: deps.timeoutMs },
    ),
    byId = new Map<string, SandMarketplacePlugin>();
  const add = (plugin: any) => {
    const converted = toPlugin(plugin, deps);
    if (converted != null) byId.set(converted.pluginId, converted);
  };
  response.plugins.forEach(add);
  const includesPrivateMarketplaces =
    (await deps.bestEffortToken(getAccessToken)) != null;
  if (includesPrivateMarketplaces) {
    let marketplaces: any[] = [];
    try {
      marketplaces = (
        await client.listMarketplaces({}, { timeoutMs: deps.timeoutMs })
      ).marketplaces.filter(
        (item: any) => item.teamId != null || item.userId != null,
      );
    } catch {}
    const lists = await Promise.all(
      marketplaces.map(async (marketplace) => {
        try {
          return (
            await client.listMarketplacePlugins(
              { marketplaceId: marketplace.id, excludeCloudAgentPlugins: true },
              { timeoutMs: deps.timeoutMs },
            )
          ).plugins;
        } catch {
          return [];
        }
      }),
    );
    lists.flat().forEach(add);
  }
  return {
    plugins: [...byId.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    ),
    includesPrivateMarketplaces,
  };
}
const parseConfigText = (
  text: string,
  deps: MarketplaceDeps,
): Record<string, McpServerConfig> => {
  try {
    return normalizePluginConfig(JSON.parse(text), deps.safeParseServer);
  } catch {
    return {};
  }
};
export async function fetchPluginServers(
  plugin: SandMarketplacePlugin,
  getAccessToken: unknown,
  getMachineId: unknown,
  deps: MarketplaceDeps,
): Promise<Record<string, McpServerConfig>> {
  if ((await deps.bestEffortToken(getAccessToken)) != null) {
    try {
      const response = await deps
          .createClient(getAccessToken, getMachineId)
          .getPluginMcpConfig(
            { pluginId: BigInt(plugin.pluginId) },
            { timeoutMs: deps.timeoutMs },
          ),
        parsed = parseConfigText(response.configJson ?? "", deps);
      if (Object.keys(parsed).length > 0) return parsed;
    } catch {}
  }
  const fetchDeadline =
    deps.fetchDeadline ??
    createDeadlinePolicy(realClock, {
      name: "mcp-marketplace-fetch",
      timeoutMs: deps.fetchTimeoutMs,
    });
  for (const sourceUrl of plugin.sourceUrls) {
    const raw = toRawGithubUrl(sourceUrl);
    if (raw == null) continue;
    try {
      const response = await fetchDeadline.run((signal) =>
        deps.fetch(raw, signal),
      );
      if (!response.ok) continue;
      const servers = parseConfigText(await response.text(), deps);
      if (Object.keys(servers).length > 0) return servers;
    } catch {}
  }
  return {};
}
