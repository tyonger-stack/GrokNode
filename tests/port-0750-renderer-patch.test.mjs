import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { parse } from "acorn";
import { Window } from "happy-dom";
import { closeLibraryDom } from "./library-dom-teardown.mjs";
import {
  buildPort0750HostBundle,
  patchPort0750Plugins,
  patchPort0750Settings,
} from "../scripts/lib/port-0750-renderer-patch.mjs";

const rendererDir = path.resolve(import.meta.dirname, "../src/app/dist/renderer/assets");
const settingsAnchor = "a.jsx(Te,{children:a.jsx(Sa,{auth:t})})";
const pluginsAnchor = "children:[t.jsx(Ws,{labelledBy:w,children:J.map";

const dom = new Window({ settings: { disableCSSFileLoading: true } });
globalThis.window = dom;
globalThis.document = dom.document;
globalThis.HTMLElement = dom.HTMLElement;
globalThis.Element = dom.Element;
globalThis.Node = dom.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const jsxRuntime = await import("react/jsx-runtime");
const { createRoot } = await import("react-dom/client");

function desktop() {
  const gates = { featureGates: { grok_bot_memory_import: true, grok_bot_vault_cards: true } };
  return {
    agent: { getMainAgent: async () => "main-bot" },
    experiments: { initialSnapshot: gates, getSnapshot: async () => gates },
    mcp: {
      list: async () => ({ servers: [] }),
      add: async () => ({ state: { servers: [] } }),
      remove: async () => ({ state: { servers: [] } }),
      effectivePlugins: async () => [],
      uninstallPlugin: async () => ({ state: { servers: [] }, removed: true }),
    },
    vault: {
      createGrokBotVaultCard: async () => ({ outcome: "saved" }),
      readGrokBotCardPhoto: async () => ({ outcome: "read", number: "", expMonth: 1, expYear: 2030, cardholderName: "" }),
      cancelGrokBotCardPhotoRead: async () => {},
    },
  };
}

async function renderPack(bundle, exportName, binding) {
  dom.desktop = desktop();
  const namespace = vm.runInNewContext(`${bundle}\n${exportName}`, {
    ...binding,
    window: dom,
    document: dom.document,
    console,
    setTimeout: dom.setTimeout.bind(dom),
    clearTimeout: dom.clearTimeout.bind(dom),
    queueMicrotask,
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const Component = exportName === "RPort0750Settings" ? namespace.RPort0750SettingsPack : namespace.RPort0750PluginsPack;
  await React.act(async () => { root.render(React.createElement(Component)); });
  await React.act(async () => { await Promise.resolve(); });
  await React.act(async () => { await Promise.resolve(); });
  return { host, root };
}

test.after(() => {
  closeLibraryDom(dom);
});

test("settings and plugins bundles mount the recovered hosts on the chunk React", async () => {
  const [settingsBundle, pluginsBundle] = await Promise.all([
    buildPort0750HostBundle("settings"),
    buildPort0750HostBundle("plugins"),
  ]);
  assert.doesNotMatch(settingsBundle, /Choose file|New card/);
  assert.match(settingsBundle, /\(de,a\);$/);
  assert.match(pluginsBundle, /Plugins in effect/);
  assert.match(pluginsBundle, /Custom MCP servers/);
  assert.match(pluginsBundle, /\(C,t\);$/);
  assert.doesNotMatch(settingsBundle, /node_modules\/react/);
  assert.doesNotMatch(pluginsBundle, /createRoot\(/);

  const settings = await renderPack(settingsBundle, "RPort0750Settings", { de: React, a: jsxRuntime });
  assert.equal(settings.host.querySelectorAll("button, input, textarea").length, 0);
  await React.act(async () => { settings.root.unmount(); });

  const plugins = await renderPack(pluginsBundle, "RPort0750Plugins", { C: React, t: jsxRuntime });
  assert.ok(plugins.host.querySelector("[aria-label='Plugins in effect']"));
  assert.ok(plugins.host.querySelector("[aria-label='Custom MCP servers']"));
  await React.act(async () => { plugins.root.unmount(); });
});

test("the patch applies once to the checksum-pinned settings and plugins chunks", async (t) => {
  let entries;
  try {
    entries = await readdir(rendererDir);
  } catch {
    t.skip("src/app/dist is gitignored and only exists after bootstrap");
    return;
  }
  let settings = null;
  let plugins = null;
  for (const name of entries.filter((entry) => entry.endsWith(".js"))) {
    const text = await readFile(path.join(rendererDir, name), "utf8");
    if (text.includes(settingsAnchor)) settings = text;
    if (text.includes(pluginsAnchor)) plugins = text;
  }
  if (settings == null || plugins == null) {
    t.skip("0.18 settings or plugins anchor is absent");
    return;
  }
  const [settingsBundle, pluginsBundle] = await Promise.all([
    buildPort0750HostBundle("settings"),
    buildPort0750HostBundle("plugins"),
  ]);
  const generalBefore = 'Q=x==="general"?a.jsx(Te,{children:a.jsx(Sa,{auth:t})}):null';
  const generalAfter = 'Q=x==="general"?a.jsx(Te,{children:a.jsx(Sa,{auth:t})}):x==="router"?a.jsx(RRouterPanel,{}):null';
  assert.equal(settings.split(generalBefore).length, 2);
  const routed = settings.replace(generalBefore, generalAfter);
  assert.equal(routed.split(settingsAnchor).length, 2);
  const patchedSettings = patchPort0750Settings(routed, settingsBundle);
  const patchedPlugins = patchPort0750Plugins(plugins, pluginsBundle);
  assert.match(patchedSettings, /x==="router"\?a\.jsx\(RRouterPanel,\{\}\)/);
  assert.match(patchedSettings, /x==="general"\?a\.jsx\(Te,\{children:\[a\.jsx\(Sa,\{auth:t\}\),a\.jsx\(RPort0750Settings\.RPort0750SettingsPack,\{\}\)\]\}\)/);
  assert.match(patchedPlugins, /t\.jsx\(RPort0750Plugins\.RPort0750PluginsPack,\{\}\),t\.jsx\(Ws,\{labelledBy:w,children:J\.map/);
  assert.doesNotThrow(() => parse(patchedSettings, { ecmaVersion: "latest", sourceType: "module" }));
  assert.doesNotThrow(() => parse(patchedPlugins, { ecmaVersion: "latest", sourceType: "module" }));
  assert.throws(() => patchPort0750Settings(patchedSettings, settingsBundle), /already exists/);
  assert.throws(() => patchPort0750Plugins(patchedPlugins, pluginsBundle), /already exists/);
});
