/**
 * Local-only catalog supplements — entries the anonymous marketplace listing does not return.
 *
 * ## Why these exist
 *
 * `fetchMarketplaceMcpPlugins` makes a SECOND request, `listMarketplacePlugins({ marketplaceId })`,
 * and only inside `if (includesPrivateMarketplaces)`. That flag is computed as
 * `bestEffortToken(getAccessToken) != null` — the server withholds a group of entries from
 * unauthenticated clients, and the local-only build has no token because its `account.login()`
 * is a stub (`source/electron-preload/preload.ts:215`).
 *
 * ## These are real entries, not invented ones
 *
 * Every field below was captured from **official 0.66.0's own catalog response** over CDP on
 * 2026-10-05 (`window.desktop.mcp.catalog()` on the logged-in official build); the numeric ids
 * match the ids the parity script independently reports as missing. Nothing here is authored.
 *
 * The shape is `SandMarketplacePlugin` (the raw wire shape) rather than a hand-written inverse:
 * `marketplacePluginToView` is upstream's own projector, so the view the renderer sees is produced
 * by the same code that produces it for server entries. `tests/local-catalog-supplements.test.mjs`
 * asserts the projection of each entry **deep-equals the captured official view**.
 *
 * ## They install for real
 *
 * `installLocally` -> `fetchPluginServers` first tries the authenticated `getPluginMcpConfig`, but
 * `bestEffortToken` is stubbed to `async () => null` in local mode, so it falls through to
 * `toRawGithubUrl(sourceUrl)` plus a plain unauthenticated `fetch`. The only thing an entry needs
 * is a `sourceUrls` entry pointing at a public GitHub blob.
 *
 * Each `sourceUrls` value below was **fetched and parsed** on 2026-10-05 — all ten return a valid
 * `mcpServers` config from `cursor/plugins@HEAD/third_party/<name>/mcp.json`, the same repository
 * that already serves the 78 entries this build installs today. The manifest at
 * `cursor/plugins@HEAD/.cursor-plugin/marketplace.json` lists all ten; `oh-my-claudecode` is absent
 * from it, consistent with it being a private-marketplace entry.
 *
 * ## Known limitation — `oh-my-claudecode` will not install
 *
 * It has no public repository and is not in the public manifest, so no `sourceUrls` can be derived.
 * It is pinned so the UI matches official, but clicking 添加 raises upstream's own
 * `SandMcpConfigError("The plugin has no publicly readable MCP configuration for local
 * installation.")` — deliberately NOT swallowed into a silent no-op.
 *
 * ## Server always wins
 *
 * `mergeLocalCatalogSupplements` appends a supplement only when the server response does not
 * already carry that id. If the account gate ever opens, the server's fresher copy wins and
 * nothing is duplicated — this pin heals itself rather than fighting the real catalog.
 *
 * @evidence official 0.66.0 catalog, captured 2026-10-05 over CDP, 404 entries, 11 taken
 * @evidence https://raw.githubusercontent.com/cursor/plugins/HEAD/.cursor-plugin/marketplace.json
 * @evidence raw.githubusercontent.com/cursor/plugins/HEAD/third_party/<name>/mcp.json (10/10 fetched)
 */

import { marketplacePluginToView, type SandMarketplacePlugin } from "./mcp-marketplace.js";

const CURSOR_PLUGINS_REPO = "https://github.com/cursor/plugins";

export const LOCAL_CATALOG_SUPPLEMENTS: readonly SandMarketplacePlugin[] = [
  {
    pluginId: "45893415",
    name: "google-slides",
    displayName: "Google Slides",
    description: "Create, edit, and render presentations.",
    category: "Design",
    categoryKey: "DESIGN",
    categoryKeys: ["DESIGN"],
    logoUrl: "https://cursor-cdn.com/plugin-logos/production/b7f4cf5c6c9f4a26.png",
    websiteUrl: "https://cursor.com/",
    repositoryUrl: "https://github.com/cursor/plugins",
    homepage: undefined,
    sourceUrls: ["https://github.com/cursor/plugins/blob/HEAD/third_party/google-slides/mcp.json"],
    connectors: [{"name": "google-slides", "description": ""}],
    skills: [{"name": "google-slides", "description": "Build and edit Google Slides through the google-slides MCP tools - slides, grids of cards and columns, text boxes, shapes, images, tables, styling, layout inspection, and per-slide PNG rendering. Use when creating a deck, laying out slide elements, matching a template, or verifyi", "sourceUrl": "https://github.com/cursor/plugins/blob/e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a/third_party/google-slides/skills/google-slides/SKILL.md"}],
    variableFields: [],
    publisher: {"name": "cursor", "displayName": "Cursor", "isUserOwned": false},
  },
  {
    pluginId: "45893412",
    name: "google-docs",
    displayName: "Google Docs",
    description: "Read, create, and edit documents.",
    category: "Documents And Files",
    categoryKey: "DOCUMENTS_AND_FILES",
    categoryKeys: ["DOCUMENTS_AND_FILES"],
    logoUrl: "https://cursor-cdn.com/plugin-logos/production/333d4ea52e637951.png",
    websiteUrl: "https://cursor.com/",
    repositoryUrl: "https://github.com/cursor/plugins",
    homepage: undefined,
    sourceUrls: ["https://github.com/cursor/plugins/blob/HEAD/third_party/google-docs/mcp.json"],
    connectors: [{"name": "google-docs", "description": ""}],
    skills: [{"name": "google-docs", "description": "Author and edit Google Docs with the google-docs tools - structured writing, character and paragraph styling, lists, tables, images, headers/footers. Use when creating a formatted document, editing document content, or applying styles.", "sourceUrl": "https://github.com/cursor/plugins/blob/e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a/third_party/google-docs/skills/google-docs/SKILL.md"}],
    variableFields: [],
    publisher: {"name": "cursor", "displayName": "Cursor", "isUserOwned": false},
  },
  {
    pluginId: "45893414",
    name: "google-sheets",
    displayName: "Google Sheets",
    description: "Read, write, and append spreadsheet data.",
    category: "MCP",
    categoryKey: undefined,
    categoryKeys: [],
    logoUrl: "https://cursor-cdn.com/plugin-logos/production/e734ff2bf82da6d9.png",
    websiteUrl: "https://cursor.com/",
    repositoryUrl: "https://github.com/cursor/plugins",
    homepage: undefined,
    sourceUrls: ["https://github.com/cursor/plugins/blob/HEAD/third_party/google-sheets/mcp.json"],
    connectors: [{"name": "google-sheets", "description": ""}],
    skills: [{"name": "google-sheets", "description": "Build and edit Google Sheets with the google-sheets tools - values, formatting, charts, conditional formatting, structure, validation, named and protected ranges. Use when creating a spreadsheet or dashboard, formatting cells, adding or fixing charts, or reorganizing tabs and row", "sourceUrl": "https://github.com/cursor/plugins/blob/e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a/third_party/google-sheets/skills/google-sheets/SKILL.md"}],
    variableFields: [],
    publisher: {"name": "cursor", "displayName": "Cursor", "isUserOwned": false},
  },
  {
    pluginId: "57302028",
    name: "onedrive",
    displayName: "OneDrive",
    description: "Browse, search, and read Microsoft OneDrive files.",
    category: "Documents And Files",
    categoryKey: "DOCUMENTS_AND_FILES",
    categoryKeys: ["DOCUMENTS_AND_FILES"],
    logoUrl: "https://cursor-cdn.com/plugin-logos/production/7c941f90ca3f525d.png",
    websiteUrl: "https://cursor.com/",
    repositoryUrl: "https://github.com/cursor/plugins",
    homepage: undefined,
    sourceUrls: ["https://github.com/cursor/plugins/blob/HEAD/third_party/onedrive/mcp.json"],
    connectors: [{"name": "onedrive", "description": ""}],
    skills: [],
    variableFields: [],
    publisher: {"name": "cursor", "displayName": "Cursor", "isUserOwned": false},
  },
  {
    pluginId: "57302029",
    name: "outlook",
    displayName: "Outlook",
    description: "Search, read, and send Microsoft Outlook email, and look up contacts.",
    category: "Inbox And Collaboration",
    categoryKey: "INBOX_AND_COLLABORATION",
    categoryKeys: ["INBOX_AND_COLLABORATION"],
    logoUrl: "https://cursor-cdn.com/plugin-logos/production/cb6c90bd0310f027.png",
    websiteUrl: "https://cursor.com/",
    repositoryUrl: "https://github.com/cursor/plugins",
    homepage: undefined,
    sourceUrls: ["https://github.com/cursor/plugins/blob/HEAD/third_party/outlook/mcp.json"],
    connectors: [{"name": "outlook", "description": ""}],
    skills: [],
    variableFields: [],
    publisher: {"name": "cursor", "displayName": "Cursor", "isUserOwned": false},
  },
  {
    pluginId: "57302030",
    name: "outlook-calendar",
    displayName: "Outlook Calendar",
    description: "List, create, update, and cancel Microsoft Outlook calendar events.",
    category: "Scheduling",
    categoryKey: "SCHEDULING",
    categoryKeys: ["SCHEDULING"],
    logoUrl: "https://cursor-cdn.com/plugin-logos/production/55fc1c026c6d7c50.png",
    websiteUrl: "https://cursor.com/",
    repositoryUrl: "https://github.com/cursor/plugins",
    homepage: undefined,
    sourceUrls: ["https://github.com/cursor/plugins/blob/HEAD/third_party/outlook-calendar/mcp.json"],
    connectors: [{"name": "outlook-calendar", "description": ""}],
    skills: [],
    variableFields: [],
    publisher: {"name": "cursor", "displayName": "Cursor", "isUserOwned": false},
  },
  {
    pluginId: "64745996",
    name: "sharepoint",
    displayName: "SharePoint",
    description: "Search and read Microsoft SharePoint sites, document libraries, files, and lists.",
    category: "MCP",
    categoryKey: undefined,
    categoryKeys: [],
    logoUrl: "https://cursor-cdn.com/plugin-logos/production/d9be0c5f110d3d0d.png",
    websiteUrl: "https://cursor.com/",
    repositoryUrl: "https://github.com/cursor/plugins",
    homepage: undefined,
    sourceUrls: ["https://github.com/cursor/plugins/blob/HEAD/third_party/sharepoint/mcp.json"],
    connectors: [{"name": "sharepoint", "description": ""}],
    skills: [],
    variableFields: [],
    publisher: {"name": "cursor", "displayName": "Cursor", "isUserOwned": false},
  },
  {
    pluginId: "63354504",
    name: "teams",
    displayName: "Teams",
    description: "Search, read, and send Microsoft Teams chats and channel messages.",
    category: "Productivity",
    categoryKey: "PRODUCTIVITY",
    categoryKeys: ["PRODUCTIVITY"],
    logoUrl: "https://cursor-cdn.com/plugin-logos/production/3fe329a5bcf4404f.png",
    websiteUrl: "https://cursor.com/",
    repositoryUrl: "https://github.com/cursor/plugins",
    homepage: undefined,
    sourceUrls: ["https://github.com/cursor/plugins/blob/HEAD/third_party/teams/mcp.json"],
    connectors: [{"name": "teams", "description": ""}],
    skills: [],
    variableFields: [],
    publisher: {"name": "cursor", "displayName": "Cursor", "isUserOwned": false},
  },
  {
    pluginId: "63408931",
    name: "finance",
    displayName: "Finance",
    description: "Link your bank, card, and investment accounts through Plaid so Grok can answer questions about balances, spending, subscriptions, and investments. You'll share contact details, account and balance info, transactions, credit and loans, and investments. Grok syncs and stores your linked account data so the connector can work, and Grok Bot's privacy mode still controls whether your conversations are stored or used for training. Access is read-only, xAI never sees or stores your bank login, and you can unlink accounts anytime from cursor.com.",
    category: "MCP",
    categoryKey: undefined,
    categoryKeys: [],
    logoUrl: "https://cursor-cdn.com/plugin-logos/production/12130046f038dd2b.png",
    websiteUrl: "https://cursor.com/",
    repositoryUrl: "https://github.com/cursor/plugins",
    homepage: undefined,
    sourceUrls: ["https://github.com/cursor/plugins/blob/HEAD/third_party/finance/mcp.json"],
    connectors: [{"name": "finance", "description": ""}],
    skills: [],
    variableFields: [],
    publisher: {"name": "cursor", "displayName": "Cursor", "isUserOwned": false},
  },
  {
    pluginId: "68516160",
    name: "x-money",
    displayName: "X Money",
    description: "Use your X Money Card, send money to users on X, manage your finances, view your balance and browse through your transaction history.",
    category: "MCP",
    categoryKey: undefined,
    categoryKeys: [],
    logoUrl: "https://cursor-cdn.com/plugin-logos/production/31ae197cc16b5b13.png",
    websiteUrl: "https://cursor.com/",
    repositoryUrl: "https://github.com/cursor/plugins",
    homepage: undefined,
    sourceUrls: ["https://github.com/cursor/plugins/blob/HEAD/third_party/x-money/mcp.json"],
    connectors: [{"name": "x-money", "description": ""}],
    skills: [{"name": "x-money-guide", "description": "Read this before the first X Money action in a session and again on any X Money error, refusal, or missing capability. Covers the approval rule for every action that moves money (always ask, every time, no exceptions), how the connection works (connection code plus passkey in the", "sourceUrl": "https://github.com/cursor/plugins/blob/e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a/third_party/x-money/skills/x-money-guide/SKILL.md"}],
    variableFields: [],
    publisher: {"name": "cursor", "displayName": "Cursor", "isUserOwned": false},
  },
  {
    pluginId: "71001007",
    name: "t",
    displayName: "oh-my-claudecode",
    description: "Multi-agent orchestration system for Claude Code",
    category: "MCP",
    categoryKey: undefined,
    categoryKeys: [],
    logoUrl: undefined,
    websiteUrl: undefined,
    repositoryUrl: undefined,
    homepage: undefined,
    sourceUrls: [],
    connectors: [{"name": "t", "description": ""}],
    skills: [{"name": "ai-slop-cleaner", "description": "Clean AI-generated code slop with a regression-safe, deletion-first workflow and optional reviewer-only mode"}, {"name": "agent-doc-discipline", "description": "Writing-time discipline for documents agents consume (the five surfaces, specs, tickets, .omc/skills/) — every rule checkable and carrying a why, steps before reference, one meaning in one home, no restating what the environment already says. Mandatory at drydock seed generation "}, {"name": "architecture-survey", "description": "Periodic architecture survey — walks the module graph and reports ranked deepening candidates (shallow modules, hypothetical seams, logic behind the wrong seam). Survey, not rescue: it finds candidates and hands them to the captain; it never refactors on its own."}, {"name": "ask", "description": "Process-first advisor routing for Claude, Codex, Gemini, Antigravity, Grok, or Cursor via `omc ask`, with artifact capture and no raw CLI assembly"}, {"name": "intent", "description": "Shipyard's internal requirements intake for non-engineer contributors (support/ops) — turn a pasted chat log or verbal problem report into a five-section intent.md through numbered batch questioning with a completion gate, walk it through tracker review with harbor's four records"}, {"name": "ask-navigator", "description": "Shipyard's navigator — chart a foggy effort (destination unclear, questions not yet stateable) into a map of decision tickets on the repo's issue tracker, then work the frontier one ticket per session until the way is clear, and hand the collapsed decisions to /launch as a missio"}, {"name": "autopilot", "description": "Full autonomous execution from idea to working code"}, {"name": "autoresearch", "description": "Stateful single-mission improvement loop with strict evaluator contract, markdown decision logs, and max-runtime stop behavior"}, {"name": "cancel", "description": "Cancel any active OMC mode (autopilot, ralph, ultragoal, swarm, ultrapilot, pipeline, team) and clean up retired legacy state"}, {"name": "configure-notifications", "description": "Configure notification integrations (Telegram, Discord, Slack) via natural language"}, {"name": "debug", "description": "Diagnose the current OMC session or repo state using logs, traces, state, and focused reproduction"}, {"name": "deep-interview", "description": "Socratic deep interview with mathematical ambiguity gating before explicit execution approval"}, {"name": "deepinit", "description": "Deep codebase initialization with hierarchical AGENTS.md documentation"}, {"name": "diagram", "description": "Use the smallest visual when prose must carry structure—control flow, call depth, module ownership, or change shape: pseudocode, call tree, component/file tree, Mermaid diagram, or diff. Skip it when prose already answers the question."}, {"name": "drydock", "description": "Lay the keel of the shipyard harness in any repo — the 4-pillar shared environment (Context, Rules, Tools, Standards) across 5 surfaces (CLAUDE.md, skills, design-system, mcp/cli, shared context) so that every human and agent inherits the same design language and anyone can ship."}, {"name": "execute", "description": "Carry an approved task through to working, verified code"}, {"name": "external-context", "description": "Invoke parallel document-specialist agents for external web searches and documentation lookup"}, {"name": "graph", "description": "Deterministic orchestration graph runtime - declarative DAG pipelines with journal-based crash recovery"}, {"name": "harbor", "description": "Harbor intake for external work — the captain only handles unresolved decisions. Sweeps incoming issues and PRs, verifies every claim before disposition, reuses every decision already made, and hands the maintainer a docket whose pending items each carry one question with options"}, {"name": "hud", "description": "Configure HUD display options (layout, presets, display elements)"}, {"name": "launch", "description": "Shipyard's governed delivery pipeline — converge the mission, synthesize a durable spec, decompose vertical-slice tickets with blocking edges, run the frontier in parallel via team, close with verification, and report with a full decision log. Two entry gates — the yard gate (dry"}, {"name": "loft", "description": "Loft the shape before cutting steel — answer a design question that prose cannot settle by building a throwaway artifact: a pure logic module in a clickable shell, or structurally different UI variants behind one route. The captain reacts to the artifact; the answer folds into th"}, {"name": "map", "description": "The yard's skill map — which skill owns which job, in delivery-loop order. Use when something needs doing but not which of the shipped skills owns it; the map routes, it never executes."}, {"name": "minimal-code-discipline", "description": "YAGNI-ladder coding discipline for writing changes — existence-first, reuse before writing, dependency ladder, shortest correct diff, with non-negotiables that must never be minimized away"}, {"name": "minimal-prose-discipline", "description": "Writing-time discipline for the prose an agent speaks to a human (replies, reports, pointers): a protected core never rewritten (code, commands, paths, errors, negators, numbers), filler dies, no narration, auto-clarity where terse misleads"}, {"name": "omc-doctor", "description": "Diagnose and fix oh-my-claudecode installation issues"}, {"name": "omc-setup", "description": "Install or refresh oh-my-claudecode for plugin, npm, and local-dev setups from the canonical setup flow"}, {"name": "omc-plan", "description": "Strategic planning with optional interview workflow"}, {"name": "pr", "description": "Draft a PR body from OMC's paper trail — the smallest visual that proves the change, evidence consumed from the verify protocol (never re-collected), reversibility from the ADR test on the diff, glossary language throughout."}, {"name": "project-session-manager", "description": "Worktree-first dev environment manager for issues, PRs, and features with optional tmux sessions"}, {"name": "ralph", "description": "Self-referential loop until task completion with configurable verification reviewer"}, {"name": "ralplan", "description": "Consensus planning entrypoint that auto-gates vague ralph/autopilot/team requests before execution"}, {"name": "refit", "description": "Cross-session environment retrospective driven by OMC's own instrumentation — trace timelines, friction reports, logs, and plan notepads. Every finding lands on the surface that owns the fix (deterministic check, steering volume, tooling, or information access); nothing is writte"}, {"name": "release", "description": "Generic release assistant — analyzes repo release rules, caches them in .omc/RELEASE_RULE.md, then guides the release"}, {"name": "remember", "description": "Review reusable project knowledge and decide what belongs in project memory, notepad, or durable docs"}, {"name": "research", "description": "Investigate an open question and return grounded, sourced findings"}, {"name": "omc-review", "description": "Evaluate finished work for defects, risk, and simplification before it ships"}, {"name": "self-improve", "description": "Autonomous evolutionary code improvement engine with tournament selection"}, {"name": "skill", "description": "Manage local skills - list, add, remove, search, edit, setup wizard"}, {"name": "skillify", "description": "Turn a repeatable workflow from the current session into a reusable OMC skill draft"}, {"name": "tdd", "description": "Test-first at pre-agreed seams — one test, one implementation, tracer-bullet red/green; independent expected values; substitutions only at the seam's boundary class; launch Phase 4 reference."}, {"name": "team", "description": "N coordinated agents on shared task list using Claude Code implicit agent teams"}, {"name": "trace", "description": "Evidence-driven tracing lane that orchestrates competing tracer hypotheses in Claude built-in team mode"}, {"name": "ultragoal", "description": "Durable multi-goal workflow that persists plan/ledger artifacts under .omc/ultragoal and prints Claude /goal handoff text for the active session"}, {"name": "verify", "description": "Verify that a change really works before you claim completion"}, {"name": "visual-verdict", "description": "Structured visual QA verdict for screenshot-to-reference comparisons"}, {"name": "wiki", "description": "LLM Wiki — persistent markdown knowledge base that compounds across sessions (Karpathy model)"}],
    variableFields: [],
    marketplace: {"name": "omc", "displayName": "omc", "ownership": "user"},
  },
];

/** The subset of the view shape the merge needs. `marketplacePluginToView` returns a wider object;
 *  typing against this keeps the returned array sortable without casting the comparator to `any`. */
export interface CatalogViewLike {
  readonly id: string;
  readonly displayName: string;
}

/**
 * Merge the pinned entries into a server view list.
 *
 * Returns BOTH the merged views and the raw supplements that were actually added, because the
 * caller needs the raw form for a second purpose the views cannot serve: `installEntry` resolves a
 * plugin through `requirePlugin` -> `this.catalog.get(id)`, an index of raw `SandMarketplacePlugin`.
 * Returning only views produced a row that rendered and then threw `Unknown marketplace plugin` the
 * moment 添加 was clicked.
 *
 * The projection goes through upstream's own `marketplacePluginToView` rather than a hand-written
 * inverse, so a pinned entry reaches the renderer through exactly the same code as a server entry.
 */
export function mergeLocalCatalogSupplements<T extends CatalogViewLike>(
  views: readonly T[],
  supplements: readonly SandMarketplacePlugin[] = LOCAL_CATALOG_SUPPLEMENTS,
): { views: T[]; plugins: SandMarketplacePlugin[] } {
  const present = new Set<string>();
  for (const view of views) {
    if (typeof view.id === "string") present.add(view.id);
  }
  const plugins: SandMarketplacePlugin[] = [];
  const merged = [...views];
  for (const plugin of supplements) {
    if (present.has(plugin.pluginId)) continue;
    present.add(plugin.pluginId);
    plugins.push(plugin);
    merged.push(marketplacePluginToView(plugin) as unknown as T);
  }
  return { views: merged, plugins };
}
