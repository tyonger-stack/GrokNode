import type { z } from "zod";
import { libraryPinSchema } from "./library/schemas.js";

export { libraryPinSchema } from "./library/schemas.js";
export type LibraryPin = z.infer<typeof libraryPinSchema>;

export function libraryPinKey(pin: LibraryPin): string {
  switch (pin.kind) {
    case "page": return pin.page.kind === "canvas"
      ? `canvas:${pin.page.storeId}:${pin.page.canvasId}`
      : `document:${pin.page.storeId}:${pin.page.documentId}`;
    case "media": return pin.media.kind === "link" ? `link:${pin.media.url}` : `${pin.media.kind}:${pin.media.source}`;
    case "external-doc": return `doc:${pin.key}`;
    case "app": return `app:${pin.key}`;
  }
}
