import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { transform } from "esbuild";
import { openUpstream0755 } from "./upstream-0755.mjs";
import { bundleUpstreamModule } from "./upstream-module.mjs";
import { extractUpstreamDeclarations } from "./upstream-declarations.mjs";

export const VISUALIZATION_0721_ENTRY = "dist/renderer/assets/chunk-visualization-document-BO2hVAw0.js";
export const VISUALIZATION_0721_EXPORTS = Object.freeze([
  "buildVisualizationDocument", "parseVisualizationFragment", "parseVisualizationFrameMessage",
  "VISUALIZATION_DOCUMENTED_TOKENS", "VISUALIZATION_FRAGMENT_MAX_BYTES",
  "VISUALIZATION_RUNTIMES", "VISUALIZATION_RUNTIME_GLOBALS", "VISUALIZATION_RUNTIME_MARKERS",
  "visualizationBoundsMessage", "visualizationInlineBounds", "isVisualizationThemeVariables",
]);

export async function stageVisualization0721({ stageRoot, archive } = {}) {
  if (!stageRoot) throw new TypeError("stageVisualization0721 requires stageRoot");
  archive ??= await openUpstream0755();
  const runtime = await bundleUpstreamModule({ archive, entry: VISUALIZATION_0721_ENTRY,
    exports: VISUALIZATION_0721_EXPORTS });
  const assets = path.join(stageRoot, "dist/renderer/assets");
  await mkdir(assets, { recursive: true });
  const outputs = [];
  const write = async (file, code) => {
    await writeFile(path.join(assets, file), code);
    outputs.push({ path: `dist/renderer/assets/${file}`, bytes: Buffer.byteLength(code),
      sha256: createHash("sha256").update(code).digest("hex") });
  };
  await write("grok-node-0721-visualization.mjs", runtime.code);
  for (const [runtimeName, file, name] of [
    ["d3", "chunk-visualization-d3-runtime.gen-C5Md8kl5.js", "VISUALIZATION_D3_RUNTIME_JS"],
    ["three", "chunk-visualization-three-runtime.gen-SrPEWFTp.js", "VISUALIZATION_THREE_RUNTIME_JS"],
  ]) {
    const bundle = await bundleUpstreamModule({ archive, entry: `dist/renderer/assets/${file}`, exports: [name] });
    await write(`grok-node-0721-${runtimeName}.mjs`, bundle.code);
    runtime.modules.push(...bundle.modules);
  }
  const protocolSource = "dist/electron-main/main-core.cjs";
  const protocol = extractUpstreamDeclarations({ code: archive.read(protocolSource).toString("utf8"),
    exports: { createVisualizationDocumentStore: "UV" }, bindings: { Response: "globalThis.Response" }, strict: true });
  const protocolBundle = await transform(protocol.code, { format: "cjs", target: "node22", legalComments: "none" });
  const protocolPath = "dist/upstream-0721/visualization-protocol.cjs";
  await mkdir(path.join(stageRoot, "dist/upstream-0721"), { recursive: true });
  await writeFile(path.join(stageRoot, protocolPath), protocolBundle.code);
  outputs.push({ path: protocolPath, bytes: Buffer.byteLength(protocolBundle.code),
    sha256: createHash("sha256").update(protocolBundle.code).digest("hex") });
  runtime.modules.push({ path: protocolSource, inputSha256: protocol.inputSha256,
    ranges: protocol.provenance, exports: ["createVisualizationDocumentStore"] });
  const provenance = { version: archive.identity.version, sourceAsarSha256: archive.identity.asarSha256,
    extraction: "lexical-declaration-closure", inputs: archive.provenance(),
    modules: runtime.modules, outputs };
  await writeFile(path.join(stageRoot, "dist/renderer-0721-visualization.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  return provenance;
}
