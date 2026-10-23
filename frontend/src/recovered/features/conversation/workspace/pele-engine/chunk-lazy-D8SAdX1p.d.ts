export function detectType(source: string): string | null;
export function registered(type: string): boolean;
export function load(type: string): Promise<boolean>;
export function render(source: string, options?: {
  readonly idPrefix?: string;
  readonly fontFamily?: string;
  readonly images?: boolean;
  readonly links?: boolean;
}): { readonly svg: string; readonly width: number; readonly height: number };
