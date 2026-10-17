import { TITLE_BY_KIND, type TurnTrayTitleKind } from "./agent-run-error-title-copy.js";

export interface HostTrayTitle {
  readonly title: string;
  readonly titleKind?: TurnTrayTitleKind;
}

export function trayTitleFallback(kind: TurnTrayTitleKind): string {
  const descriptor = TITLE_BY_KIND[kind];
  return descriptor.message ?? String(descriptor.id ?? "");
}

export function hostTrayTitle(args: {
  kind: TurnTrayTitleKind;
  description?: { readonly title?: unknown };
}): HostTrayTitle {
  const overriddenTitle = args.description?.title;
  if (typeof overriddenTitle === "string") return { title: overriddenTitle };
  return { title: trayTitleFallback(args.kind), titleKind: args.kind };
}
