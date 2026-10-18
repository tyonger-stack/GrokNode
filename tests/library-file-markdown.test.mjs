import assert from "node:assert/strict";
import { after, test } from "node:test";
import path from "node:path";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { closeLibraryDom } from "./library-dom-teardown.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const window = new Window({ settings: { disableCSSFileLoading: true } });
for (const name of ["window", "document", "HTMLElement", "Element", "Node"]) {
  globalThis[name] = name === "window" ? window : window[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const built = await build({
  stdin: {
    contents: `export {createElement,act} from 'react';
export {createRoot} from 'react-dom/client';
export {FileMarkdown} from './frontend/src/recovered/features/conversation/workspace/file-markdown';`,
    resolveDir: repo,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  loader: { ".css": "empty" },
  logLevel: "silent",
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const host = document.createElement("div");
document.body.append(host);
const root = ui.createRoot(host);

after(async () => {
  await ui.act(async () => root.unmount());
  await closeLibraryDom(window);
});

test("FileMarkdown ports official Iwn/Bwn shell and blue link classes", async () => {
  const source = [
    "# Grok Bot Changelog",
    "",
    "**Sources:**",
    "",
    "- Official: https://x.ai/changelog/bot",
    "- Cross-check: [RSS](https://x.ai/changelog/bot/rss.xml)",
    "",
    "## 0.70.2",
    "",
    "New notes.",
  ].join("\n");

  await ui.act(async () => {
    root.render(ui.createElement(ui.FileMarkdown, { text: source }));
  });

  assert.ok(host.querySelector(".sand-file-markdown.sand-file-markdown--document"));
  assert.ok(host.querySelector(".sand-file-markdown-page"));
  assert.ok(host.querySelector("h1"));
  assert.match(host.querySelector("h1").textContent, /Grok Bot Changelog/);
  assert.ok(host.querySelector("h2"));
  const links = [...host.querySelectorAll("a")];
  assert.ok(links.length >= 2, `expected autolink + markdown link, got ${links.length}`);
  for (const link of links) {
    assert.match(link.className, /sand-l1v4ol/);
    assert.match(link.className, /sand-10kc733/);
    assert.match(link.className, /sand-krqix3/);
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  }
  assert.ok(host.querySelector("ul"));
  assert.ok(host.querySelector("strong"));
});
