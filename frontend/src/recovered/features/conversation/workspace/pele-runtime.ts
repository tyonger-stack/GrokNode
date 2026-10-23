import { detectType, load, registered, render } from "./pele-engine/chunk-lazy-D8SAdX1p.js";
import type { PeleRuntime } from "./pele";

export async function loadShippedPeleRuntime(): Promise<PeleRuntime> {
  return {
    async render(id, code) {
      const type = detectType(code);
      if (type == null) throw new Error("unsupported pele diagram");
      if (!registered(type)) {
        const loaded = await load(type);
        if (!loaded) throw new Error("pele diagram type failed to load");
      }
      const rendered = render(code, { idPrefix: id, images: false, links: false });
      if (rendered.svg === "") throw new Error("pele diagram rendered empty");
      return { svg: rendered.svg };
    },
  };
}
