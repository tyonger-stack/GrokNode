// 0.71.2 / 0.68.1 computer display (P2-8). Matches image start-desktop.sh
// SCREEN_WIDTH/HEIGHT defaults when the local-docker connector passes them.
export const SAND_MONITOR_WIDTH = 1920;
export const SAND_MONITOR_HEIGHT = 1200;
export function displaySpaceSentence({ width = SAND_MONITOR_WIDTH, height = SAND_MONITOR_HEIGHT }: { width?: number; height?: number } = {}): string { return `Display is ${width}×${height}. Computer click/move/scroll x,y are pixels in that space (origin top-left); never emit coordinates outside 0..${width - 1} × 0..${height - 1}.`; }
