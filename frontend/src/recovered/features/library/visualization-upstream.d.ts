export interface VisualizationFramePorts {
  readonly contentHeight?: (heightPx: number | undefined) => { readonly height: number; readonly maxHeight: number };
  readonly [port: string]: unknown;
}
export interface VisualizationAttachedFrame {
  arm(): void;
  dispose(): void;
}
export interface VisualizationFrameApi {
  attach(slot: Element, args: { readonly frameUrl: string; readonly title: string; readonly className: string }): HTMLIFrameElement;
  bounds(size: { readonly heightPx?: number }): { readonly height: number; readonly maxHeight: number };
  pointerRelease(frame: HTMLIFrameElement, onRelease: () => void): VisualizationAttachedFrame;
  readonly Stage: unknown;
}
export function frameDeclarations(ports: VisualizationFramePorts): VisualizationFrameApi;
export interface VisualizationHeightPorts {
  readonly debounce: (options: { readonly name: string; readonly delayMs: number }) => {
    wrap<T extends (value: number) => void>(fn: T): T & { dispose(): void };
  };
  readonly [port: string]: unknown;
}
export interface VisualizationHeightController {
  report(contentHeightPx: number): void;
  dispose(): void;
}
export interface VisualizationHeightApi {
  height(contentHeightPx: number): number;
  contentHeight(frameHeightPx: number): number;
  controller(args: { readonly appliedHeightPx?: number; readonly apply: (value: number) => void }): VisualizationHeightController;
}
export function heightDeclarations(ports: VisualizationHeightPorts): VisualizationHeightApi;
export type VisualizationThemeName = "light" | "dark";
export interface VisualizationThemePorts {
  assert(condition: unknown, message: string | (() => string)): void;
  readonly [port: string]: unknown;
}
export function themeDeclarations(ports: VisualizationThemePorts): {
  readonly theme: {
    readonly variables: {
      readonly light: Readonly<Record<string, string>>;
      readonly dark: Readonly<Record<string, string>>;
    };
    readonly typography: unknown;
  };
  readonly series: (appearance: string) => Readonly<Record<string, string>>;
};
