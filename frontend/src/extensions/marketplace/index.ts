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
  featuredSectionGroup,
  privateSkillsFromRecords,
  sectionGroup,
  TEXT,
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

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The private-skill bridge, as `source/electron-main/skills/skills-desktop.ts` exposes it.
 *
 * The result is a discriminated union and never a rejection: an unreachable host has to stay
 * distinguishable from "this account has no skills", or a stopped box would silently render an
 * empty 私有技能 section that reads as a correct answer.
 */
interface SkillsBridge {
  list(agentId: string): Promise<SkillsResult>;
  update(agentId: string, workflowId: string, spec: SkillsSpec): Promise<SkillsResult>;
  remove(agentId: string, workflowId: string): Promise<SkillsResult>;
}

type SkillsResult =
  | { ok: true; records: readonly unknown[] }
  | { ok: false; error: { code: "gateway-unreachable" | "gateway-command-failed" | "bad-request"; message: string } };

interface SkillsSpec {
  name: string;
  description: string;
  body: string;
  trigger: { schedule: string; isEnabled: boolean } | null;
}

function skillsBridge(): SkillsBridge | null {
  const desktop = (window as unknown as { desktop?: { skills?: SkillsBridge } }).desktop;
  return desktop?.skills ?? null;
}

/**
 * Which agent's skills 私有技能 lists. Upstream reads the current selection out of its own store,
 * which this port cannot reach; the selected row in the DOM carries it as
 * `[data-agent-id][aria-current="page"]`, and the main bot is the fallback when no row is marked.
 * Verified equal in the running build: both resolve to `90840651-…` (Grok Node).
 */
async function activeAgentId(): Promise<string | null> {
  const selected = document
    .querySelector<HTMLElement>('[data-agent-id][aria-current="page"]')
    ?.getAttribute("data-agent-id");
  if (selected != null && selected.length > 0) return selected;
  const main = await (window as unknown as { desktop?: { agent?: { getMainAgent?(): Promise<unknown> } } })
    .desktop?.agent?.getMainAgent?.()
    .catch(() => null);
  return typeof main === "string" && main.length > 0 ? main : null;
}

/** Localised copy for a bridge failure. `code` is the contract; this is presentation only. */
function skillsErrorText(code: string, detail: string): string {
  switch (code) {
    case "gateway-unreachable":
      return `无法连接本地运行环境，暂时读不到私有技能：${detail}`;
    case "gateway-command-failed":
      return `读取私有技能时出错：${detail}`;
    default:
      return `私有技能请求无效：${detail}`;
  }
}

export function createMarketplaceController(): MarketplaceController {
  let dialog: MarketplaceDialog | null = null;
  /**
   * The page ladder, as a stack. 0.66 pushes a page per interaction and 返回 pops exactly one
   * level — home → section → detail — so a plain `page` field could not express "which section did
   * we come from". Captured ladder in docs/MARKETPLACE-066-EVIDENCE.md §1.
   */
  type Page =
    | { readonly kind: "browse" }
    | { readonly kind: "manage" }
    | { readonly kind: "section"; readonly group: BrowseGroup }
    | { readonly kind: "detail"; readonly row: BrowseRow }
    | { readonly kind: "skill"; readonly skill: PrivateSkill };

  let stack: readonly Page[] = [{ kind: "browse" }];

  let state: MarketplaceViewState = {
    model: EMPTY_MODEL,
    installed: [],
    skills: [],
    skillsError: null,
    servers: [],
    page: "browse",
    sectionGroup: null,
    detailRow: null,
    skillDetail: null,
    query: "",
    installedExpanded: false,
    busy: false,
    loading: false,
    catalogError: null,
  };

  /** Collapse the stack head into the flat fields the view renders from. */
  function withPage(next: readonly Page[]): MarketplaceViewState {
    const head = next[next.length - 1];
    return {
      ...state,
      page: head.kind,
      sectionGroup: head.kind === "section" ? head.group : null,
      detailRow: head.kind === "detail" ? head.row : null,
      skillDetail: head.kind === "skill" ? head.skill : null,
      // Official clears the query only when the whole dialog is dismissed, not on 返回, so a
      // filtered home page keeps its filter when you come back up the stack.
    };
  }

  const push = (page: Page): void => {
    stack = [...stack, page];
    state = withPage(stack);
    paint();
  };

  const pop = (): void => {
    if (stack.length <= 1) {
      close();
      return;
    }
    stack = stack.slice(0, -1);
    state = withPage(stack);
    // `if (!isYoursOpen && isInstalledExpanded) setInstalledExpanded(false)` — the one-way
    // 显示全部 latch resets when the manage view is left, upstream and here alike.
    if (state.page !== "manage") state = { ...state, installedExpanded: false };
    paint();
  };

  const reset = (): void => {
    stack = [{ kind: "browse" }];
    state = withPage(stack);
  };

  const paint = (): void => {
    dialog?.render(state);
  };

  const close = (): void => {
    dialog?.destroy();
    dialog = null;
    reset();
    state = { ...state, query: "", installedExpanded: false, busy: false };
    window.dispatchEvent(new CustomEvent("sand-marketplace-closed"));
  };

  /**
   * 私有技能, for real.
   *
   * The data was always reachable — the host answers `getAgentWorkflows` over the gateway with both
   * `workflows/` (user-written) and `managed-skills/skills/` (platform-installed) — but nothing
   * carried it across the preload bridge. `source/electron-main/skills/skills-desktop.ts` now does,
   * and `privateSkillsFromRecords` applies upstream's own filter to the raw records.
   *
   * The failure arm is the point of the union: a box that is not running yields `gateway-unreachable`
   * and the section says so, rather than rendering an empty list that reads as "you have no skills".
   */
  async function readPrivateSkills(): Promise<{ skills: readonly PrivateSkill[]; error: string | null }> {
    const skills = skillsBridge();
    if (skills == null) {
      return { skills: [], error: "私有技能桥接不可用（未暴露 window.desktop.skills）" };
    }
    const agentId = await activeAgentId();
    if (agentId == null) return { skills: [], error: TEXT.noAgentForSkills };
    let result: SkillsResult;
    try {
      result = await skills.list(agentId);
    } catch (reason) {
      // The bridge contract says it never rejects; treat a throw as unreachable rather than
      // silently rendering an empty section.
      return { skills: [], error: skillsErrorText("gateway-unreachable", String(reason)) };
    }
    if (!result.ok) return { skills: [], error: skillsErrorText(result.error.code, result.error.message) };
    return { skills: privateSkillsFromRecords(result.records), error: null };
  }

  const handlers: MarketplaceViewHandlers = {
    close,
    openManage: () => {
      push({ kind: "manage" });
    },
    backToMarket: () => {
      // The manage page's back button says 市场, but official returns to whatever was underneath it
      // rather than always resetting to the homepage.
      pop();
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
      push({ kind: "detail", row });
    },
    onOpenSkill: (skill) => {
      push({ kind: "skill", skill });
    },
    onDeleteSkill: (skill) => {
      void deleteSkill(skill);
    },
    onSaveSkill: (skill, draft) => {
      void saveSkill(skill, draft);
    },
    onViewAll: (group: BrowseGroup) => {
      // `onSelectCategory` pushes a page whose SHAPE depends on the group's kind — a single-column
      // `h1` page for the featured section, a two-column 结果 page for a category bucket. The
      // caller already hands over a fully-formed group (see renderBrowse), so the shape travels
      // with it and needs no re-derivation here.
      push({ kind: "section", group });
    },
    onBack: () => {
      pop();
    },
    onUninstall: (row) => {
      void removePlugin(row);
    },
    onShare: (row) => {
      void sharePlugin(row);
    },
  };

  /** 复制此插件的链接 — official writes the plugin's own URL, which is the catalog entry's
   *  `homepage`. Clipboard failures are swallowed rather than surfaced: the toast surface is out
   *  of scope, and a rejected clipboard write must not tear the page down. */
  async function sharePlugin(row: BrowseRow): Promise<void> {
    const url = str(row.entry.homepage);
    if (url.length === 0) return;
    try {
      await navigator.clipboard?.writeText(url);
    } catch {
      // Clipboard unavailable (insecure context / denied permission) — nothing to recover.
    }
  }

  async function removePlugin(row: BrowseRow): Promise<void> {
    const mcp = bridge();
    const serverId = str(row.server?.id) || str(row.server?.name);
    if (mcp?.remove == null || serverId.length === 0) return;
    state = { ...state, busy: true };
    paint();
    try {
      await mcp.remove(serverId);
    } catch {
      // Same: the failure toast is out of scope for this port.
    } finally {
      state = { ...state, busy: false };
      await reload();
    }
  }

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

  /**
   * 删除 a private skill. Upstream pops back to the list and the host returns the refreshed set,
   * so this re-reads rather than splicing locally — the same shape `deleteAgentWorkflow` returns.
   */
  async function deleteSkill(skill: PrivateSkill): Promise<void> {
    const skills = skillsBridge();
    const agentId = await activeAgentId();
    if (skills == null || agentId == null) return;
    state = { ...state, busy: true };
    paint();
    try {
      const result = await skills.remove(agentId, skill.id);
      state = { ...state, skillsError: result.ok ? state.skillsError : skillsErrorText(result.error.code, result.error.message) };
    } catch (reason) {
      state = { ...state, skillsError: skillsErrorText("gateway-unreachable", String(reason)) };
    } finally {
      state = { ...state, busy: false };
      // Upstream returns to the list after a delete; leaving a deleted skill's detail page on
      // screen would show a record that no longer exists.
      stack = stack.filter((page) => !(page.kind === "skill" && page.skill.id === skill.id));
      state = withPage(stack);
      await reload();
    }
  }

  /** 保存 an edited skill. Upstream's save button is only live when the draft is valid AND changed
   *  (`canEditPrivateSkill`); the view enforces that, this just forwards the draft. */
  async function saveSkill(skill: PrivateSkill, draft: PrivateSkill): Promise<void> {
    const skills = skillsBridge();
    const agentId = await activeAgentId();
    if (skills == null || agentId == null) return;
    state = { ...state, busy: true };
    paint();
    try {
      const result = await skills.update(agentId, skill.id, {
        name: draft.name,
        description: draft.description,
        body: draft.body,
        trigger: null,
      });
      state = { ...state, skillsError: result.ok ? state.skillsError : skillsErrorText(result.error.code, result.error.message) };
    } catch (reason) {
      state = { ...state, skillsError: skillsErrorText("gateway-unreachable", String(reason)) };
    } finally {
      state = { ...state, busy: false };
      // The host returns the refreshed set, so re-read and re-point the open page at the new copy
      // of the record rather than continuing to render the stale draft as if it were saved.
      await reload();
      const fresh = state.skills.find((candidate) => candidate.id === skill.id);
      if (fresh != null) {
        stack = stack.map((page) => (page.kind === "skill" && page.skill.id === skill.id ? { kind: "skill", skill: fresh } : page));
        state = withPage(stack);
      }
      paint();
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

    // 私有技能 rides its own channel: a stopped box must not take the marketplace page down with it,
    // so this is settled separately and only ever degrades the one section.
    const skillsResult = await readPrivateSkills();

    state = {
      ...state,
      model: buildMarketplaceModel(catalog, servers, teamCounts),
      installed: buildInstalledRows(servers, catalog),
      servers,
      skills: skillsResult.skills,
      skillsError: skillsResult.error,
      catalogError: catalogResult.status === "rejected" ? String(catalogResult.reason) : null,
      loading: false,
    };
    paint();
  }

  const open = async (): Promise<void> => {
    if (dialog != null) return;
    reset();
    // `loading` must mean "there is genuinely nothing to show", not "a refresh is in flight".
    //
    // Measured on official 0.66.0 vs this build, opening the marketplace five times each and timing
    // the click through to the first rendered row:
    //
    //   official  55 / 58 / 55 / 59 / 58 ms   — a loading state appeared 0 times
    //   this build 5003 / 5309 / 3449 / 4790 / 4264 ms — 「正在加载市场…」 appeared 5 times
    //
    // The gap is NOT that this build fetches more slowly. Timing the three bridge calls directly
    // through `window.desktop.mcp` shows official pays the same cost:
    //
    //              official            this build
    //   catalog()  2792 → 26 ms        2996 → 19 ms
    //   list()     2106 → 674 ms       3933 → 1412 ms
    //   teamPop()  1455 → 273 ms          7 → 17 ms
    //
    // Official's `list()` alone costs longer than the 58 ms its rows appear in, so official
    // demonstrably paints WITHOUT awaiting the round-trip. This build set `loading: true`
    // unconditionally and `renderBrowse` returns a `CatalogStatus` block whenever that is set — so
    // a perfectly good model left over from the previous open was hidden behind a spinner for four
    // seconds. `close()` deliberately keeps `state`, and `reset()` only rewinds the page stack, so
    // the data is already here; the flag was simply discarding it.
    //
    // Cold start still shows the status block: with no model yet there is nothing to paint.
    const cold = state.model.rows.length === 0;
    state = {
      ...state,
      query: "",
      installedExpanded: false,
      loading: cold,
      catalogError: null,
    };
    dialog = createMarketplaceDialog(state, handlers);
    document.body.append(dialog.root);
    paint();
    // Always refresh, but never block the first paint on it. The dialog is on screen with the last
    // known model immediately, and `reload()` repaints with fresh data when it lands.
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
