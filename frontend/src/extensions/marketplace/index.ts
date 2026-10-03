/**
 * Marketplace controller: owns the dialog lifecycle and feeds it from the existing local bridge.
 *
 * Backend impact: none. Everything both pages render is already reachable from `window.desktop`:
 *
 *   mcp.catalog()        393 entries, identical shape to the official build's
 *                        (id, name, displayName, description, category, iconUrl, connectors[],
 *                         skills[], fields[], publisher)
 *   mcp.list()           the configured servers with `status` / `statusDetail` / `toolCount`
 *   mcp.teamPopularity() the team install-count feed (empty in this login-free build)
 *   mcp.install / mcp.authenticate / mcp.remove / mcp.uninstallPlugin
 *                        the action verbs behind 添加 / 连接
 *
 * The one surface with no local source is 私有技能. Upstream feeds it from
 * `Ti(Bi(agentId), [])` — an agent-scoped query whose result never crosses the preload bridge in
 * this build, and whose backing store is an opaque `sand-client-persistence` blob. Rather than
 * invent a list, `readPrivateSkills` returns an empty list and the section renders upstream's own
 * empty-state string. Wiring a real source is a separate, explicitly-scoped backend change.
 */

import {
  buildInstalledRows,
  buildMarketplaceModel,
  type BrowseGroup,
  type BrowseRow,
  type CatalogEntry,
  type InstalledRow,
  type MarketplaceModel,
  type McpServer,
  type PrivateSkill,
} from "./model.js";
import {
  createMarketplaceDialog,
  type MarketplaceDialog,
  type MarketplaceViewHandlers,
  type MarketplaceViewState,
} from "./view.js";

interface DockMcpBridge {
  catalog(): Promise<readonly CatalogEntry[]>;
  list(): Promise<{ servers?: readonly McpServer[] }>;
  teamPopularity?(): Promise<Record<string, number>>;
  install?(request: unknown): Promise<unknown>;
  authenticate?(serverId: string, accountKey?: unknown, trigger?: unknown): Promise<unknown>;
  remove?(serverId: string): Promise<unknown>;
  uninstallPlugin?(pluginId: string): Promise<unknown>;
  onAuthCompleted?(listener: (payload: unknown) => void): () => void;
}

function bridge(): DockMcpBridge | null {
  const desktop = (window as unknown as { desktop?: { mcp?: DockMcpBridge } }).desktop;
  return desktop?.mcp ?? null;
}

export interface MarketplaceController {
  open(): Promise<void>;
  close(): void;
  readonly isOpen: () => boolean;
}

const EMPTY_MODEL: MarketplaceModel = buildMarketplaceModel([], [], {});

export function createMarketplaceController(): MarketplaceController {
  let dialog: MarketplaceDialog | null = null;
  let state: MarketplaceViewState = {
    model: EMPTY_MODEL,
    installed: [],
    skills: [],
    servers: [],
    page: "browse",
    query: "",
    installedExpanded: false,
    busy: false,
    loading: false,
    catalogError: null,
  };

  const paint = (): void => {
    dialog?.render(state);
  };

  const close = (): void => {
    dialog?.destroy();
    dialog = null;
    // `if (!isYoursOpen && isInstalledExpanded) setInstalledExpanded(false)` — the one-way
    // 显示全部 latch resets when the manage view is left, upstream and here alike.
    state = { ...state, page: "browse", query: "", installedExpanded: false, busy: false };
    window.dispatchEvent(new CustomEvent("sand-marketplace-closed"));
  };

  /** Private skills have no local source yet — see the module note. */
  function readPrivateSkills(): readonly PrivateSkill[] {
    return [];
  }

  const handlers: MarketplaceViewHandlers = {
    close,
    openManage: () => {
      state = { ...state, page: "manage" };
      paint();
    },
    backToMarket: () => {
      state = { ...state, page: "browse", installedExpanded: false };
      paint();
    },
    onQuery: (value) => {
      state = { ...state, query: value };
      paint();
    },
    onToggleInstalledExpanded: () => {
      state = { ...state, installedExpanded: true };
      paint();
    },
    onAdd: (row: BrowseRow) => {
      void addPlugin(row);
    },
    onAuthenticate: (serverId) => {
      void authenticate(serverId);
    },
    onOpenRow: (row) => {
      // Upstream pushes a plugin-detail pane here. That pane is a third surface, outside the two
      // this port reproduces, so the row is inert rather than opening an invented view.
      void row;
    },
    onOpenSkill: () => {
      // Same: the skill detail surface is out of scope for this port.
    },
    onViewAll: (_group: BrowseGroup) => {
      // `onSelectCategory` pushes a `plugin-section` page. This port reproduces the two pages the
      // brief names, so 查看全部 keeps the row set and does not navigate.
    },
  };

  async function addPlugin(row: BrowseRow): Promise<void> {
    const mcp = bridge();
    if (mcp?.install == null) return;
    state = { ...state, busy: true };
    paint();
    try {
      await mcp.install({ pluginId: row.id, catalogEntry: row.entry });
    } catch {
      // Upstream surfaces an add-pending pill and then a toast; the toast surface is out of scope,
      // so the row simply returns to its idle state.
    } finally {
      state = { ...state, busy: false };
      await reload();
    }
  }

  async function authenticate(serverId: string): Promise<void> {
    const mcp = bridge();
    if (mcp?.authenticate == null) return;
    state = { ...state, busy: true };
    paint();
    try {
      await mcp.authenticate(serverId, "default", "marketplace");
    } catch {
      // Same: no toast surface in this port.
    } finally {
      state = { ...state, busy: false };
      await reload();
    }
  }

  async function reload(): Promise<void> {
    const mcp = bridge();
    if (mcp == null) return;
    // The catalog is a network call to the marketplace endpoint. When it fails the page must not
    // render as if the account simply has no plugins — an empty marketplace reads as a broken
    // build, and upstream has a dedicated `CatalogStatus` surface for exactly this state. Keep the
    // failure visible and retry on the next open.
    const [catalogResult, listResult, teamPopularity] = await Promise.allSettled([
      mcp.catalog(),
      mcp.list(),
      mcp.teamPopularity?.().catch(() => ({}) as Record<string, number>) ?? Promise.resolve({}),
    ]);

    const servers =
      listResult.status === "fulfilled" ? (listResult.value.servers ?? []) : state.servers;
    const catalog =
      catalogResult.status === "fulfilled" ? catalogResult.value : state.model.rows;
    const teamCounts =
      teamPopularity.status === "fulfilled"
        ? (teamPopularity.value as Record<string, number>)
        : {};

    state = {
      ...state,
      model: buildMarketplaceModel(catalog, servers, teamCounts),
      installed: buildInstalledRows(servers, catalog),
      servers,
      skills: readPrivateSkills(),
      catalogError: catalogResult.status === "rejected" ? String(catalogResult.reason) : null,
      loading: false,
    };
    paint();
  }

  const open = async (): Promise<void> => {
    if (dialog != null) return;
    state = {
      ...state,
      page: "browse",
      query: "",
      installedExpanded: false,
      loading: true,
      catalogError: null,
    };
    dialog = createMarketplaceDialog(state, handlers);
    document.body.append(dialog.root);
    paint();
    // Paint once more with real data; the first paint carries the empty model so the dialog is on
    // screen immediately instead of blocking on the catalog round-trip.
    await reload();
  };

  return {
    open,
    close,
    isOpen: () => dialog != null,
  };
}

/** Re-exported so the dock can narrow the installed-row type without importing the model directly. */
export type { InstalledRow };
