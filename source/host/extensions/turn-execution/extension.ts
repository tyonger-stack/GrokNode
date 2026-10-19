import { defineHostExtension } from "../../../internal/host-extensions.js";
import { HostExtensions } from "../extension-ids.generated.js";
import { TurnExecutionRegistry } from "./turn-execution-service.js";

export const turnExecutionExtension = defineHostExtension({ id: HostExtensions.TurnExecution, dependencies: [], start: context => { const registry = new TurnExecutionRegistry(false); context.onStop(() => registry.dispose()); return registry; } });

