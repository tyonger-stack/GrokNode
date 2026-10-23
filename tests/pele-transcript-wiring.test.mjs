import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Window } from "happy-dom";
import path from "node:path";
import { closeLibraryDom } from "./library-dom-teardown.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const dom = new Window({ settings: { disableCSSFileLoading: true } });
globalThis.window = dom;
globalThis.document = dom.document;
globalThis.HTMLElement = dom.HTMLElement;
globalThis.Element = dom.Element;
globalThis.Node = dom.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function setGate(enabled) {
  const gates = { featureGates: { sand_enable_pele_diagrams: enabled } };
  dom.desktop = { experiments: { initialSnapshot: gates, getSnapshot: async () => gates } };
}

const built = await build({
  stdin: {
    contents: `export { act, createElement } from "react"; export { createRoot } from "react-dom/client"; export { AssistantMessageContent } from "./frontend/src/recovered/features/conversation/workspace/transcript";`,
    resolveDir: repo,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  loader: { ".css": "empty" },
  plugins: [{
    name: "pele-runtime-stub",
    setup(api) {
      api.onResolve({ filter: /\/pele-runtime(?:\.ts)?$/ }, () => ({ path: "pele-runtime", namespace: "pele-stub" }));
      api.onLoad({ filter: /.*/, namespace: "pele-stub" }, () => ({
        contents: "export async function loadShippedPeleRuntime(){ return { async render(){ return { svg: '<svg class=\"pele-from-runtime\" xmlns=\"http://www.w3.org/2000/svg\"></svg>' }; } }; }",
        loader: "js",
      }));
    },
  }],
  logLevel: "silent",
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const host = document.createElement("div");
document.body.append(host);
let root = ui.createRoot(host);
const source = "```pele\ninfo\ntitle Hello from Pele\n```";

async function show(enabled) {
  setGate(enabled);
  await ui.act(() => { root.unmount(); });
  root = ui.createRoot(host);
  await ui.act(async () => {
    root.render(ui.createElement(ui.AssistantMessageContent, { text: source }));
  });
  for (let step = 0; step < 4; step += 1) await ui.act(async () => { await Promise.resolve(); });
}

test.after(() => {
  try { root.unmount(); } catch { /* already unmounted */ }
  closeLibraryDom(dom);
});

test("a pele fence draws when the local gate is on", async () => {
  await show(true);
  assert.ok(host.querySelector(".sand-pele svg.pele-from-runtime"));
  assert.doesNotMatch(host.textContent, /Hello from Pele/);
});

test("a pele fence stays source text when the gate is off", async () => {
  await show(false);
  assert.equal(host.querySelector(".sand-pele"), null);
  assert.match(host.textContent, /Hello from Pele/);
});
