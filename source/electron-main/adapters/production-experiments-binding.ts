import type { ElectronProductionAdapterBindings } from "../production-adapters.js";
import type { ProductionExperimentsService } from "../main-production-services.js";
import { startSandRpcTraceWindow } from "../../shared/node/cursor-backend/rpc-tracing.js";

export function createElectronProductionExperimentsBinding(): ElectronProductionAdapterBindings["experiments"] {
  return {
    async create(): Promise<ProductionExperimentsService> {
      const listeners = new Set<() => void>();
      let disposed = false;
      const snapshot = Object.freeze({});
      return {
        async ensureService() {
          if (disposed) throw new Error("Local experiments service is disposed.");
          return {
            getSnapshot: () => snapshot,
            applyFeatureFlagOverrideCommand: (_command: unknown) => {},
            refreshNow: async () => {},
          };
        },
        isTelemetryDisabled: () => process.env.SAND_DISABLE_TELEMETRY === "1",
        startRpcTraceWindow: () => startSandRpcTraceWindow(),
        getComputerUseModelOverride: () => undefined,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        getSnapshot: () => snapshot,
        getFeatureFlagOverridesRecord: () => ({}),
        checkFeatureGate: (_name: string) => false,
        getDynamicConfig: (_name: string) => ({}),
        hasLiveStatsigBootstrap: () => false,
        getFlagsAgeMs: () => undefined,
        dispose: async () => { disposed = true; listeners.clear(); },
      };
    },
  };
}
