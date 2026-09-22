import { createMcpRuntime } from "../mcp/mcp-runtime.js";
import { registerMcpDesktopIpc, type McpDesktopDeps } from "../mcp/mcp-desktop.js";
import type { DesktopMcpManagerFacade } from "../mcp/desktop-mcp-manager.js";
import { createSandDesktopMcpManager } from "../mcp/desktop-mcp-manager.js";
import { createSandMcpOAuthLoopback } from "../../shared/node/mcp/mcp-oauth-loopback.js";
import { createLocalHttpMcpProxy, type LocalHttpRequest } from "../../shared/node/mcp/local-http-proxy.js";
import type { ElectronProductionAdapterBindings } from "../production-adapters.js";
import type { ProductionDisposable, ProductionMcpService, ProductionServiceContext } from "../main-production-services.js";
import { getSandRootDir } from "../../host/host-paths.js";
import { delay } from "../../shared/node/async.js";
import { cleanupLegacyMcpAuthCredentials } from "../../shared/node/mcp/mcp-auth-cleanup.js";
import { parseAllowedExternalUrl } from "../../shared/external-url-policy.js";
import { reportDesktopEdgeFailure, reportDesktopEdgeFailureClass } from "../desktop-edge-failures.js";
import { requireFunction, requireObject } from "./provider-guards.js";

type McpRuntimeDeps = Parameters<typeof createMcpRuntime<DesktopMcpManagerFacade>>[0];

async function syncLocalMcpServers(context: ProductionServiceContext): Promise<void> {
  const set = context.coordinatorLegs.legs.setHostSettings;
  if (set == null) throw new Error("Local MCP settings cannot reach the VM.");
  await set({ localMcpServers: context.settings.settingsStore.getLocalMcpServers() });
}

function createLocalHttpRequest(context: ProductionServiceContext): LocalHttpRequest {
  return async request => {
    await syncLocalMcpServers(context);
    const call = context.coordinatorLegs.legs.refreshMcp;
    if (call == null) throw new Error("Local MCP runtime cannot reach the VM.");
    return call({ routedAction: "local-http", routedArgs: request });
  };
}

type ProductionMcpOAuthRootRuntimePorts = Pick<McpRuntimeDeps, "settingsStore" | "sandRootDir" | "reportConnectorAuth" | "broadcast" | "refreshHostMcp">;
type ProductionMcpOAuthRootDesktopPorts = Pick<McpDesktopDeps, "createOAuthLoopback" | "fetchTeamPopularity" | "settings" | "wait" | "refreshMcp" | "syncHostSettings">;
type ProductionMcpOAuthResolverDesktopPorts = Omit<McpDesktopDeps, "ipc" | "getManager" | keyof ProductionMcpOAuthRootDesktopPorts>;

export interface ProductionMcpOAuthRootPortProvider {
  readonly runtime: ProductionMcpOAuthRootRuntimePorts;
  readonly desktop: ProductionMcpOAuthRootDesktopPorts;
}

export interface ProductionMcpOAuthPorts {
  readonly resolveRootPorts?: (context: ProductionServiceContext) => ProductionMcpOAuthRootPortProvider;
  readonly resolveRuntimeDeps: (context: ProductionServiceContext) => McpRuntimeDeps;
  readonly resolveDesktopDeps: (
    context: ProductionServiceContext,
    getManager: () => Promise<DesktopMcpManagerFacade>,
  ) => ProductionMcpOAuthResolverDesktopPorts;
}

export interface ProductionMcpOAuthService extends ProductionMcpService {
  registerDesktopIpc(ipc: McpDesktopDeps["ipc"]): ProductionDisposable;
}

function isMcpOAuthService(service: ProductionMcpService): service is ProductionMcpOAuthService {
  return typeof (service as Partial<ProductionMcpOAuthService>).registerDesktopIpc === "function";
}

function reportConnectorAuth(context: ProductionServiceContext, report: unknown): void {
  const telemetry = context.readTelemetry()?.telemetry;
  const callback = telemetry == null ? undefined : Reflect.get(telemetry, "reportConnectorAuth");
  if (typeof callback !== "function") return;
  callback.call(telemetry, report);
}

/**
 * Exact root-owned MCP closures from main.cjs:506056 and 506734. Secrets and
 * manager construction remain separate joins; coordinator resync, refresh,
 * settings, and BrowserWindow broadcast arrive through the lazy root context.
 */
export function createProductionMcpOAuthRootPortProvider(
  context: ProductionServiceContext,
): ProductionMcpOAuthRootPortProvider {
  const settingsStore = context.settings.settingsStore;
  const localHttp = createLocalHttpMcpProxy(createLocalHttpRequest(context));
  return {
    runtime: {
      settingsStore,
      sandRootDir: getSandRootDir,
      reportConnectorAuth: (report) => reportConnectorAuth(context, report),
      broadcast: context.broadcast,
      refreshHostMcp: context.mcpHost.refreshMcp,
    },
    desktop: {
      createOAuthLoopback: async () => {
        const loopback = createSandMcpOAuthLoopback({ completeOAuth: args => localHttp.completeOAuth(args), log: message => console.info(message), onCallback: report => reportConnectorAuth(context, report) });
        return {
          registerPendingAuthFromUrl: async (args) => { await loopback.registerPendingAuthFromUrl(args); },
          dispose: () => loopback.dispose(),
        };
      },
      fetchTeamPopularity: async () => new Map(),
      refreshMcp: async (options) => {
        await syncLocalMcpServers(context);
        const refreshMcp = context.coordinatorLegs.legs.refreshMcp;
        if (typeof refreshMcp !== "function") throw new Error("Coordinator MCP refresh port is unavailable.");
        return await refreshMcp(options);
      },
      syncHostSettings: context.mcpHost.syncHostSettings,
      settings: {
        getMcpCustomInstructionsAccountScope: () => settingsStore.getMcpCustomInstructionsAccountScope(),
        getMcpCustomInstructionsByServerId: () => settingsStore.getMcpCustomInstructionsByServerId(),
        getMcpCustomInstructions: () => settingsStore.getMcpCustomInstructions(),
        getMcpDisabledToolsByServerId: () => settingsStore.getMcpDisabledToolsByServerId(),
      },
      wait: delay,
    },
  };
}

function listBoxMcpServers(context: ProductionServiceContext, serverIdentifiers: unknown): Promise<readonly Record<string, unknown>[]> {
  const list = context.coordinatorLegs.legs.listBoxMcpServers;
  if (typeof list !== "function") return Promise.reject(new Error("Coordinator MCP server-list port is unavailable."));
  return syncLocalMcpServers(context).then(() => list({ serverIdentifiers })).then((response: unknown) => {
    if (typeof response !== "object" || response == null) throw new TypeError("Coordinator MCP server-list returned an invalid response.");
    const servers = Reflect.get(response, "servers");
    if (!Array.isArray(servers) || servers.some((server) => typeof server !== "object" || server == null)) throw new TypeError("Coordinator MCP server-list returned invalid servers.");
    return servers as readonly Record<string, unknown>[];
  });
}

/**
 * Zero-input production join used by the Electron activation boundary. Every
 * runtime/desktop collaborator is resolved from the already-composed root;
 * tests may still provide explicit resolver ports through the public contract.
 */
export function createProductionMcpOAuthPorts(): ProductionMcpOAuthPorts {
  return {
    resolveRootPorts: createProductionMcpOAuthRootPortProvider,
    resolveRuntimeDeps: (context) => ({
      createManager: async (options) => await createSandDesktopMcpManager({
        ...options,
        localHttpRequest: createLocalHttpRequest(context),
        getAccessToken: async (request) => {
          const token = await options.getAccessToken(request);
          if (token == null) throw new Error("MCP manager requires an authenticated account.");
          return token;
        },
      }),
      settingsStore: context.settings.settingsStore,
      pushBoxSecrets: () => context.secretsStores.pushBoxSecrets.push("account_scope"),
      ensureCursorAuthService: async () => await context.requireAccount().getAuthService(),
      getMachineId: () => context.machineId,
      listBoxMcpServers: (serverIdentifiers) => listBoxMcpServers(context, serverIdentifiers),
      reportConnectorAuth: (report) => reportConnectorAuth(context, report),
      reportDiagnostic: (leg, errorClass) => reportDesktopEdgeFailureClass("mcp-manager", leg, errorClass),
      cleanupLegacyAuth: (root) => cleanupLegacyMcpAuthCredentials(root),
      sandRootDir: getSandRootDir,
      reportFailure: (subsystem, leg, error) => reportDesktopEdgeFailure(subsystem, leg, error),
      broadcast: context.broadcast,
      refreshHostMcp: (completion) => { void context.mcpHost.refreshMcp(completion); },
    }),
    resolveDesktopDeps: (context) => ({
      shell: { openExternal: async (url) => await context.native.shell.openExternal(url) },
      parseAllowedExternalUrl,
      peekAccessToken: async () => {
        const auth = await context.requireAccount().getAuthService();
        return await auth.peekAccessToken?.() ?? null;
      },
      onEdgeFailure: (failure) => {
        const telemetry = context.readTelemetry()?.telemetry;
        const report = telemetry == null ? undefined : Reflect.get(telemetry, "reportMcpDesktopEdgeFailure");
        if (typeof report === "function") report.call(telemetry, failure);
        reportDesktopEdgeFailureClass("mcp", failure.leg, failure.errorClass);
      },
    }),
  };
}

/** Artifact anchor: main.cjs:506056, `var mcpRuntime = createMcpRuntime({`. */
export function createProductionMcpOAuthAdapter(
  ports: ProductionMcpOAuthPorts = createProductionMcpOAuthPorts(),
): ElectronProductionAdapterBindings["mcpOAuth"] {
  requireFunction(ports?.resolveRuntimeDeps, "mcpOAuth.resolveRuntimeDeps");
  requireFunction(ports?.resolveDesktopDeps, "mcpOAuth.resolveDesktopDeps");
  return {
    create(context): ProductionMcpOAuthService {
      const rootPorts = ports.resolveRootPorts?.(context);
      const runtimeDeps = { ...ports.resolveRuntimeDeps(context), ...rootPorts?.runtime };
      requireObject(runtimeDeps, "mcpOAuth.runtimeDeps");
      for (const method of ["createManager", "pushBoxSecrets", "ensureCursorAuthService", "getMachineId", "listBoxMcpServers", "reportConnectorAuth", "reportDiagnostic", "cleanupLegacyAuth", "sandRootDir", "reportFailure", "broadcast", "refreshHostMcp"] as const) {
        requireFunction(runtimeDeps[method], `mcpOAuth.${method}`);
      }
      const runtime = createMcpRuntime<DesktopMcpManagerFacade>(runtimeDeps);
      let desktopHandle: ReturnType<typeof registerMcpDesktopIpc> | undefined;
      let disposed = false;
      return {
        async openExternalUrl(value) {
          if (disposed) throw new Error("Electron production MCP adapter is disposed.");
          if (desktopHandle == null) throw new Error("Electron production MCP desktop IPC is not registered.");
          await desktopHandle.openExternalUrl(value);
        },
        async refreshHostMcp(completion) {
          await desktopHandle?.refreshHostMcp(completion);
        },
        async resetMcpManager() {
          await runtime.resetMcpManager();
        },
        async listRoutedTools() {
          if (disposed) throw new Error("Electron production MCP adapter is disposed.");
          return await (await runtime.ensureMcpManager()).listRoutedTools();
        },
        async executeRoutedTool(request) {
          if (disposed) throw new Error("Electron production MCP adapter is disposed.");
          if (typeof request !== "object" || request == null) throw new TypeError("Routed MCP execution requires a request.");
          return await (await runtime.ensureMcpManager()).executeRoutedTool(request as Parameters<DesktopMcpManagerFacade["executeRoutedTool"]>[0]);
        },
        registerDesktopIpc(ipc) {
          if (disposed) throw new Error("Electron production MCP adapter is disposed.");
          if (desktopHandle != null) throw new Error("Electron production MCP desktop IPC is already registered.");
          const desktopDeps = { ...ports.resolveDesktopDeps(context, runtime.ensureMcpManager), ...rootPorts?.desktop } as McpDesktopDeps;
          requireObject(desktopDeps, "mcpOAuth.desktopDeps");
          desktopHandle = registerMcpDesktopIpc({ ...desktopDeps, ipc, getManager: runtime.ensureMcpManager });
          let registrationDisposed = false;
          return {
            async dispose() {
              if (registrationDisposed) return;
              registrationDisposed = true;
              // The IPC registrar owns handler removal.  Keep the desktop
              // handle (and its loopback) owned by the MCP service so the
              // production graph can dispose the runtime before the
              // loopback, matching the immutable quit order.
            },
          };
        },
        async dispose() {
          if (disposed) return;
          disposed = true;
          const current = desktopHandle;
          desktopHandle = undefined;
          const failures: unknown[] = [];
          try { await runtime.dispose(); } catch (error) { failures.push(error); }
          try { await current?.disposeLoopback(); } catch (error) { failures.push(error); }
          if (failures.length === 1) throw failures[0];
          if (failures.length > 1) throw new AggregateError(failures, "Electron production MCP cleanup failed.");
        },
      };
    },
  };
}

export function registerProductionMcpOAuthIpc(
  service: ProductionMcpService,
  ipc: McpDesktopDeps["ipc"],
): ProductionDisposable {
  if (!isMcpOAuthService(service)) throw new TypeError("Electron production MCP service does not expose registerDesktopIpc().");
  return service.registerDesktopIpc(ipc);
}
