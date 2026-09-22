import type {
  ProductionCoordinatorAuthStatus,
  ProductionCoordinatorGatewayConnector,
  ProductionCoordinatorPorts,
} from "../coordinator/production-provider.js";
import type { ProductionServiceContext } from "../main-production-services.js";
import type { BoxConnectionInfo } from "../../shared/node/egress-tunnel/box-connection.js";
import { createSettingsRoutedHostConnector } from "../box/local-docker-host-connector.js";

function requireFunction(value: unknown, label: string): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") {
    throw new Error(`Electron production coordinator gateway requires ${label}.`);
  }
}

/**
 * Exact root handoff for the coordinator's generated GrokBot gateway client.
 * The connector remains account-scoped and process-owned; coordinator account
 * authorization/transition ports are intentionally supplied by the separate
 * coordinator binding and are not inferred here.
 */
export function createProductionCoordinatorGatewayBinding(): Pick<
  ProductionCoordinatorPorts<ProductionCoordinatorAuthStatus>,
  "createGatewayConnector"
> {
  return {
    createGatewayConnector(context: ProductionServiceContext): ProductionCoordinatorGatewayConnector {
      const local = createSettingsRoutedHostConnector(context.settings.settingsStore);
      requireFunction(local?.connect, "local Docker gateway connector.connect()");
      const wrappedBase: {
        connect(): Promise<BoxConnectionInfo>;
        recreate?: (...args: any[]) => unknown;
        forceRecreate?: (...args: any[]) => unknown;
      } = {
        connect: async () => await local.connect() as BoxConnectionInfo,
      };
      if (local.recreate != null) wrappedBase.recreate = local.recreate.bind(local);
      if (local.forceRecreate != null) wrappedBase.forceRecreate = local.forceRecreate.bind(local);
      return context.connectorEgress.wrap(wrappedBase) as unknown as ProductionCoordinatorGatewayConnector;
    },
  };
}
