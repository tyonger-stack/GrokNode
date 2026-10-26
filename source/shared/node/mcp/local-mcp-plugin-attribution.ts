/**
 * Local-install plugin attribution.
 *
 * Official 0.75.8 keeps the installed-app set in the Anysphere account: `getMcpState()` rows
 * carry `pluginId`, and `getEffectivePlugins()` returns
 * `{pluginId, name, displayName, installMode, isEnabled, mcpServerNames}` (measured live against
 * official 0.75.8: 21 plugin records, 17 server rows, 14 of them carrying a `pluginId`).
 *
 * Grok Node has no account credential — the desktop account service is the local-only stub in
 * `electron-main/adapters/account-oauth.ts`, whose `getValidAccessToken` throws
 * "Cursor cloud authentication is unavailable in the local-only build." — so the account set is
 * unreachable. The same contract is therefore reconstructed from the LOCAL install state: every
 * locally installed marketplace plugin records the catalog plugin it came from.
 *
 * The renderer contract is upstream's own and is what makes the grouping work:
 * `view-B5Ug8wEm.js` `rt(servers, catalog, effectivePlugins)` only folds a connector into its
 * catalog plugin row when `server.pluginId === catalogEntry.id` AND that plugin appears in
 * `effectivePlugins` as installed. Without both, upstream degrades to one row per connector and
 * the per-plugin subtitle (upstream `Wl`/`yi`: "N connectors · N skills") is lost — which is
 * exactly how Grok Node's marketplace currently renders 8 loose connectors instead of installed
 * plugins.
 */

/** One locally installed marketplace plugin, keyed by the local MCP server name that carries it. */
export interface LocalMcpPluginAttribution {
  /** Upstream catalog plugin id (the catalog view entry's `id`). */
  readonly pluginId: string;
  /** Upstream `Plugin.name` — the marketplace's own name, not the MCP server handle. */
  readonly name: string;
  /** Upstream display name. */
  readonly displayName: string;
  /** Upstream connector names this plugin contributed, when it contributed any. */
  readonly mcpServerNames?: readonly string[];
}

/** The `effectivePlugins` record shape upstream 0.75.8 exposes to the renderer. */
export interface EffectivePluginRecord {
  readonly pluginId: string;
  readonly name: string;
  readonly displayName: string;
  readonly installMode: "user" | "team-default" | "team-required";
  readonly isEnabled: boolean;
  readonly mcpServerNames?: readonly string[];
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return names.length === 0 ? undefined : names;
}

/**
 * Normalizes the persisted attribution map. Entries without a usable `pluginId` are dropped
 * rather than half-kept: a connector whose plugin id is unknown must stay a plain connector row,
 * because claiming a plugin id that the catalog does not contain would silently mis-group it.
 */
export function normalizeLocalMcpPluginAttribution(raw: unknown): Record<string, LocalMcpPluginAttribution> {
  const normalized: Record<string, LocalMcpPluginAttribution> = {};
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return normalized;
  for (const [serverName, value] of Object.entries(raw)) {
    if (serverName.length === 0 || typeof value !== "object" || value == null || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const pluginId = typeof record.pluginId === "string" ? record.pluginId.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const displayName = typeof record.displayName === "string" ? record.displayName.trim() : "";
    if (pluginId.length === 0 || name.length === 0 || displayName.length === 0) continue;
    const mcpServerNames = stringList(record.mcpServerNames);
    normalized[serverName] = { pluginId, name, displayName, ...(mcpServerNames == null ? {} : { mcpServerNames }) };
  }
  return normalized;
}

/**
 * Folds the per-server attribution map into one record per installed plugin, in upstream 0.75.8's
 * `getEffectivePlugins()` shape. A plugin installed through several connectors appears once,
 * carrying every connector name it contributed.
 */
export function toEffectivePluginRecords(attribution: Readonly<Record<string, LocalMcpPluginAttribution>>): EffectivePluginRecord[] {
  const byPlugin = new Map<string, { record: LocalMcpPluginAttribution; serverNames: Set<string> }>();
  for (const [serverName, record] of Object.entries(attribution)) {
    const existing = byPlugin.get(record.pluginId);
    if (existing == null) {
      byPlugin.set(record.pluginId, { record, serverNames: new Set(record.mcpServerNames ?? []) });
      continue;
    }
    for (const name of record.mcpServerNames ?? []) existing.serverNames.add(name);
    existing.serverNames.add(serverName);
  }
  return [...byPlugin.values()].map(({ record, serverNames }) => ({
    pluginId: record.pluginId,
    name: record.name,
    displayName: record.displayName,
    installMode: "user" as const,
    isEnabled: true,
    ...(serverNames.size === 0 ? {} : { mcpServerNames: [...serverNames] }),
  }));
}

/** The catalog view entry the renderer matches servers against (`Ue`: `id`, `name`, `displayName`). */
export interface CatalogPluginView {
  readonly id: string;
  readonly name: string;
  readonly pluginName?: string;
  readonly displayName: string;
  readonly connectors?: readonly { readonly name: string }[];
}

/**
 * Derives the plugin attribution of local servers that were installed before the attribution was
 * recorded, and keeps the recorded entries untouched.
 *
 * A local server key is `"<plugin display name>:<connector name>"` — the shape
 * `installLocally` writes (`plugin.displayName + ":" + name`). The connector name is the key the
 * plugin's own MCP config used, which is also the `connectors[].name` the catalog publishes, so a
 * server is attributed to the unique catalog entry that publishes that connector under that
 * display name.
 *
 * An ambiguous match is left unattributed on purpose: a connector that cannot be traced to
 * exactly one plugin must keep rendering as a plain connector row rather than be folded into a
 * plugin it may not belong to.
 */
export function reconcileLocalPluginAttribution(
  serverNames: readonly string[],
  attribution: Readonly<Record<string, LocalMcpPluginAttribution>>,
  catalogViews: readonly CatalogPluginView[],
): Record<string, LocalMcpPluginAttribution> {
  const merged: Record<string, LocalMcpPluginAttribution> = { ...attribution };
  for (const serverName of serverNames) {
    if (merged[serverName] != null) continue;
    const separator = serverName.indexOf(":");
    if (separator <= 0) continue;
    const displayName = serverName.slice(0, separator).trim();
    const connectorName = serverName.slice(separator + 1).trim();
    if (displayName.length === 0 || connectorName.length === 0) continue;
    const connectorMatches = catalogViews.filter((view) =>
      (view.connectors ?? []).some((connector) => connector.name.toLowerCase() === connectorName.toLowerCase()),
    );
    const named = connectorMatches.filter(
      (view) => view.displayName.toLowerCase() === displayName.toLowerCase() || view.name.toLowerCase() === displayName.toLowerCase(),
    );
    const candidates = named.length > 0 ? named : connectorMatches;
    const view = candidates.length === 1 ? candidates[0] : undefined;
    if (view == null) continue;
    merged[serverName] = {
      pluginId: view.id,
      name: view.pluginName ?? view.name,
      displayName: view.displayName,
      mcpServerNames: [connectorName],
    };
  }
  return merged;
}
