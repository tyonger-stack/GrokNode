import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { stageVisualization0721 } from "../scripts/lib/visualization-0721.mjs";

const snapshot = fileURLToPath(new URL("../../rea-grokbot-0755/asar/app.asar", import.meta.url));

test("transplanted SandViz builds a sealed D3 document and validates actual frame messages", {
  skip: !existsSync(snapshot) && "0.75.5 snapshot is absent",
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "grok-sandviz-"));
  try {
    const provenance = await stageVisualization0721({ stageRoot: root });
    const runtimePath = path.join(root, "dist/renderer/assets/grok-node-0721-visualization.mjs");
    const runtime = await import(pathToFileURL(runtimePath).href);
    const d3 = await import(pathToFileURL(path.join(root, "dist/renderer/assets/grok-node-0721-d3.mjs")).href);
    const fragment = runtime.parseVisualizationFragment('<script data-runtime="d3"></script><h1>Graph</h1>');
    assert.deepEqual(fragment, { html: "<h1>Graph</h1>", runtimes: ["d3"] });
    const themeVariables = Object.fromEntries(Object.values(runtime.VISUALIZATION_DOCUMENTED_TOKENS)
      .flat().map((key) => [key, "#123456"]));
    themeVariables["--sand-shadow-popover"] = "none";
    themeVariables["--cursor-font-family-sans"] = "sans-serif";
    assert.equal(runtime.isVisualizationThemeVariables(themeVariables), true);
    const textStyle = { fontSize: "14px", lineHeight: "20px", fontWeight: "400", letterSpacing: "0px" };
    const document = runtime.buildVisualizationDocument({ title: "Graph <sample>", theme: "light",
      themeVariables, fragment, typography: { body: textStyle, small: textStyle, label: textStyle,
        h1: textStyle, h2: textStyle, h3: textStyle }, runtimeSources: { d3: d3.VISUALIZATION_D3_RUNTIME_JS } });
    assert.match(document, /Graph &lt;sample&gt;/);
    assert.match(document, /connect-src 'none'/);
    assert.match(document, /frame-src 'none'/);
    assert.ok(document.includes(d3.VISUALIZATION_D3_RUNTIME_JS));
    assert.deepEqual(runtime.parseVisualizationFrameMessage({ type: "visualization-height", height: 123.5 }),
      { kind: "height", contentHeightPx: 124 });
    assert.equal(runtime.parseVisualizationFrameMessage({ type: "visualization-height", height: -1 }), null);
    assert.equal(runtime.parseVisualizationFrameMessage({ type: "visualization-state", state: '{"answer":42}' }), null);
    assert.deepEqual(runtime.parseVisualizationFrameMessage({ type: "visualization-wheel", deltaY: 18 }), {
      kind: "wheel", deltaMode: 0, deltaX: 0, deltaY: 18,
    });
    assert.equal(runtime.parseVisualizationFrameMessage({ type: "openExternal", url: "https://example.com" }), null);
    assert.ok(provenance.modules.every((module) => module.inputSha256.length === 64));
    assert.ok(provenance.modules.every((module) => !module.path.includes("index.eager-app")));
    const source = await readFile(runtimePath, "utf8");
    assert.doesNotMatch(source, /from\s*["']\.\//);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
