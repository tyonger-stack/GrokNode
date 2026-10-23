import { join } from "node:path";

export const VISUALIZATION_SCHEME = "sand-visualization";

export interface VisualizationDocumentStore {
  stage(input: { readonly html: string }): { readonly frameUrl: string };
  serve(request: Request): Response;
}

interface VisualizationProtocol {
  registerSchemesAsPrivileged(schemes: { scheme: string; privileges: {
    standard: boolean; secure: boolean; supportFetchAPI: boolean; corsEnabled: boolean;
  } }[]): void;
  handle(scheme: string, handler: (request: Request) => Response): void;
  unhandle(scheme: string): void;
}

function isDocumentStore(value: unknown): value is VisualizationDocumentStore {
  return typeof value === "object" && value !== null && "stage" in value && typeof value.stage === "function" &&
    "serve" in value && typeof value.serve === "function";
}

export function loadVisualizationDocumentStore(isEnabled: () => boolean): VisualizationDocumentStore {
  const loaded: unknown = require(join(__dirname, "../upstream-0721/visualization-protocol.cjs"));
  if (typeof loaded !== "object" || loaded === null || !("createVisualizationDocumentStore" in loaded) ||
      typeof loaded.createVisualizationDocumentStore !== "function") {
    throw new Error("Grok Bot 0.72.1 visualization protocol is missing");
  }
  const store: unknown = loaded.createVisualizationDocumentStore(isEnabled);
  if (!isDocumentStore(store)) throw new Error("Invalid upstream visualization protocol factory");
  return store;
}

export function registerVisualizationScheme(protocol: Pick<VisualizationProtocol, "registerSchemesAsPrivileged">): void {
  protocol.registerSchemesAsPrivileged([{ scheme: VISUALIZATION_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
}

export function createVisualizationProtocol(protocol: Pick<VisualizationProtocol, "handle" | "unhandle">,
  store: VisualizationDocumentStore): { readonly stage: VisualizationDocumentStore["stage"]; dispose(): void } {
  protocol.handle(VISUALIZATION_SCHEME, (request) => store.serve(request));
  return { stage: (input) => store.stage(input), dispose: () => protocol.unhandle(VISUALIZATION_SCHEME) };
}
