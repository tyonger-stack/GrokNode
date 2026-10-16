import type { CanvasDecodedContent } from "./canvas-protocol.js";
import {
  renderLibraryCanvasFrameHtml,
  type LibraryCanvasFrameTheme,
} from "../../../shared/library/canvas-frame.js";

export type LibraryHttpCanvasTheme = LibraryCanvasFrameTheme;

export function renderLibraryHttpCanvasFrame(
  content: CanvasDecodedContent,
  theme: LibraryHttpCanvasTheme,
  title: string,
): string {
  return renderLibraryCanvasFrameHtml(content, theme, title);
}
