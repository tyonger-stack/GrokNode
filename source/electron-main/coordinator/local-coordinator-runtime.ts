import type { CoordinatorRuntime } from "./coordinator-runtime.js";

export function createLocalCoordinatorRuntime(createRuntime: () => CoordinatorRuntime) {
  let runtime: CoordinatorRuntime | undefined;
  let requester: ((port: unknown) => void) | undefined;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  return {
    async start(): Promise<void> {
      if (disposed || runtime !== undefined) return;
      const started = createRuntime();
      runtime = started;
      if (requester !== undefined) started.requestRendererPort(requester);
    },
    requestRendererPort(sink: (port: unknown) => void): void {
      if (disposed) return;
      requester = sink;
      runtime?.requestRendererPort(sink);
    },
    async restart(): Promise<void> {
      if (disposed) return;
      if (runtime === undefined) { await this.start(); return; }
      await runtime.restart();
    },
    dispose(): Promise<void> {
      if (disposal !== undefined) return disposal;
      disposed = true;
      requester = undefined;
      runtime?.revokeRendererPortRequest();
      disposal = runtime?.dispose() ?? Promise.resolve();
      return disposal;
    },
  };
}
