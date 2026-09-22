export type SandBoxRuntime = "local-docker";

export const DEFAULT_SAND_BOX_RUNTIME: SandBoxRuntime = "local-docker";

export function isSandBoxRuntime(value: unknown): value is SandBoxRuntime {
  return value === "local-docker";
}
