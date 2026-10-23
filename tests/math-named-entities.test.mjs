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

const built = await build({
  stdin: {
    contents: `export { act, createElement } from "react"; export { createRoot } from "react-dom/client"; export { AssistantMath } from "./frontend/src/recovered/features/conversation/workspace/math";`,
    resolveDir: repo,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  logLevel: "silent",
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const host = document.createElement("div");
document.body.append(host);
const root = ui.createRoot(host);

test.after(async () => {
  await ui.act(async () => { root.unmount(); });
  closeLibraryDom(dom);
});

test("formula text expands the named entity table before KaTeX", async () => {
  let seen = null;
  const loadRuntime = async () => ({
    renderToString(expression) {
      seen = expression;
      return `<span class="katex">${expression}</span>`;
    },
  });
  await ui.act(async () => {
    root.render(ui.createElement(ui.AssistantMath, { expression: String.raw`\alpha = &alpha;`, displayMode: false, loadRuntime }));
  });
  await ui.act(async () => { await Promise.resolve(); });
  assert.equal(seen, String.raw`\alpha = α`);
  assert.match(host.querySelector(".katex").textContent, /α/);
});
