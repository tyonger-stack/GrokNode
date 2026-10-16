/**
 * Node-owned Library rollout gates.
 *
 * The 0.18 recovered Statsig registry predates all four modern Library
 * branches. Grok Node cannot obtain those backend assignments, so these gates
 * are deliberately Node-owned rather than pretended to be recovered upstream
 * flags. Default on makes the implemented services reachable through the
 * existing desktop gate API; `SAND_LIBRARY_FEATURE_GATES` is the Node user
 * configuration surface. A standard `SAND_FEATURE_GATE_OVERRIDES` entry still
 * wins, preserving normal experiment override semantics.
 */
export const LIBRARY_FEATURE_GATES = [
  "grok_bot_library_v2",
  "grok_bot_library_pages",
  "grok_bot_documents_ui",
  "grok_bot_library_external_docs",
] as const;
export type LibraryFeatureGate = (typeof LIBRARY_FEATURE_GATES)[number];
const ALIASES: Readonly<Record<LibraryFeatureGate, string>> = {
  grok_bot_library_v2: "v2",
  grok_bot_library_pages: "pages",
  grok_bot_documents_ui: "documents",
  grok_bot_library_external_docs: "external_docs",
};
function enabled(value: string): boolean {
  return value === "1" || value === "true" || value === "on";
}
function parsePairs(raw: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const pair of raw.split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    pairs.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  return pairs;
}
export function isLibraryFeatureGate(name: string): name is LibraryFeatureGate {
  return (LIBRARY_FEATURE_GATES as readonly string[]).includes(name);
}
export function resolveLibraryFeatureGate(name: string, env: NodeJS.ProcessEnv = process.env): boolean | undefined {
  if (!isLibraryFeatureGate(name)) return undefined;
  const generic = env.SAND_FEATURE_GATE_OVERRIDES;
  if (generic != null && generic.length > 0) {
    for (const pair of generic.split(",")) {
      const [key, value] = pair.split("=", 2).map(part => part.trim());
      if (key === name) return enabled(value ?? "");
    }
  }
  const raw = env.SAND_LIBRARY_FEATURE_GATES;
  if (raw == null || raw.length === 0) return true;
  const pairs = parsePairs(raw);
  const value = pairs.get(name) ?? pairs.get(ALIASES[name]);
  if (value !== undefined) return enabled(value);
  const all = pairs.get("all");
  return all === undefined ? true : enabled(all);
}
