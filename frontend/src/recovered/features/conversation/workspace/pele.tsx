import { useEffect, useState, type ReactNode } from "react";
import { MermaidDiagram, type MermaidRuntimeLoader } from "./mermaid";

export const PELE_GATE_NAME = "sand_enable_pele_diagrams";

export const PELE_THEME_VARIABLES: readonly string[] = [
  "--pele-bg",
  "--pele-fg",
  "--pele-muted",
  "--pele-line",
  "--pele-surface",
  "--pele-surface-alt",
  "--pele-border",
  "--pele-accent",
  "--pele-critical",
  "--pele-radius",
  "--pele-series-1",
  "--pele-series-2",
  "--pele-series-3",
  "--pele-series-4",
  "--pele-series-5",
  "--pele-series-6",
  "--pele-series-7",
  "--pele-series-8",
];

export type DiagramSyntax = "mermaid" | "pele";

export function selectDiagramSyntax(args: {
  readonly isPeleGateOn: boolean;
  readonly devOverride?: DiagramSyntax | null;
}): DiagramSyntax {
  return args.devOverride ?? (args.isPeleGateOn ? "pele" : "mermaid");
}

export interface PeleRuntime {
  render(id: string, code: string): Promise<{ readonly svg: string }>;
}

export type PeleRuntimeLoader = () => Promise<PeleRuntime>;

export interface PeleDiagramResult {
  readonly kind: "ok" | "invalid" | "unavailable";
  readonly svg?: string;
}

export function PeleDiagram(props: {
  readonly code: string;
  readonly fallback: ReactNode;
  readonly loadRuntime?: PeleRuntimeLoader;
}): ReactNode {
  const [result, setResult] = useState<PeleDiagramResult | null>(null);
  useEffect(() => {
    let active = true;
    setResult(null);
    if (props.loadRuntime == null) {
      setResult({ kind: "unavailable" });
      return undefined;
    }
    const load = props.loadRuntime;
    void load().then(
      (runtime) => runtime.render(`sand-pele-${props.code.length.toString(36)}`, props.code),
      () => null,
    ).then((rendered) => {
      if (!active) return;
      if (rendered == null || typeof rendered.svg !== "string" || rendered.svg === "") {
        setResult({ kind: "invalid" });
      } else {
        setResult({ kind: "ok", svg: rendered.svg });
      }
    });
    return () => {
      active = false;
    };
  }, [props.code, props.loadRuntime]);
  if (result == null) return props.fallback;
  if (result.kind !== "ok" || result.svg == null) return props.fallback;
  return <div aria-label="Pele diagram" className="sand-pele" dangerouslySetInnerHTML={{ __html: result.svg }} />;
}

export function DiagramBlock(props: {
  readonly language: string;
  readonly code: string;
  readonly fallback: ReactNode;
  readonly peleEnabled?: boolean;
  readonly loadPeleRuntime?: PeleRuntimeLoader;
  readonly loadMermaidRuntime?: MermaidRuntimeLoader;
  readonly mermaidTheme?: "light" | "dark";
}): ReactNode {
  if (props.language === "pele") {
    if (props.peleEnabled !== true) return props.fallback;
    return <PeleDiagram code={props.code} fallback={props.fallback} loadRuntime={props.loadPeleRuntime} />;
  }
  if (props.language === "mermaid") {
    return <MermaidDiagram code={props.code} fallback={props.fallback} loadRuntime={props.loadMermaidRuntime} theme={props.mermaidTheme} />;
  }
  return props.fallback;
}
