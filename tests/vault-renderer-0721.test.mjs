import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { closeLibraryDom } from "./library-dom-teardown.mjs";
import {
  VAULT_RENDERER_MARK,
  buildVaultRendererBundle,
  patchVaultSettingsSources,
} from "../scripts/lib/vault-renderer-patch.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const window = new Window();
for (const name of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Element", "Node", "MutationObserver", "getComputedStyle", "performance"]) {
  globalThis[name] = name === "window" ? window : name === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[name] ?? globalThis[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = globalThis.ResizeObserver ?? class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
const evidence = process.env.R1_EVIDENCE_DIR;
function record(name, value) {
  if (evidence === undefined) return;
  mkdirSync(evidence, { recursive: true });
  if (typeof value === "string") writeFileSync(path.join(evidence, name + ".html"), value);
  else writeFileSync(path.join(evidence, name + ".json"), JSON.stringify(value, null, 2));
}

async function loadHost() {
  const built = await buildVaultRendererBundle();
  const context = {
    S: React,
    p: jsxRuntime,
    Wr: ReactDOM,
    window,
    document: window.document,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    structuredClone,
    TextEncoder,
    TextDecoder,
    URL,
    Intl,
    crypto,
    performance,
    navigator: window.navigator,
    requestAnimationFrame: typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (callback) => setTimeout(() => callback(Date.now()), 16),
    cancelAnimationFrame: typeof window.cancelAnimationFrame === "function"
      ? window.cancelAnimationFrame.bind(window)
      : clearTimeout,
    ResizeObserver: globalThis.ResizeObserver,
    MutationObserver: window.MutationObserver,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLSelectElement: window.HTMLSelectElement,
    Element: window.Element,
    Node: window.Node,
    ShadowRoot: window.ShadowRoot ?? class {},
    getComputedStyle: window.getComputedStyle.bind(window),
    location: window.location,
    history: window.history,
    CSS: window.CSS ?? { supports: () => false, escape: (value) => String(value) },
    reportError: (error) => console.error(error),
  };
  vm.runInNewContext(built.bundle, context);
  assert.equal(typeof context.__sandVaultRendererNS.RVaultSettingsHost, "function");
  return { built, host: context.__sandVaultRendererNS.RVaultSettingsHost };
}

function credential() {
  return [
    { id: "login-1", title: "Example", username: "user@example.test", notes: "", sites: ["https://example.com"], createdAtMs: 1, updatedAtMs: 1 },
    { id: "card-1", title: "Card 4242", username: "", notes: "", sites: [], card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2029, holderName: "Synthetic User", billingAddressId: "", billingAddress: { line1: "", line2: "", city: "", region: "", postalCode: "", country: "" } }, createdAtMs: 1, updatedAtMs: 1 },
    { id: "contact-1", title: "Billing contact", username: "", notes: "", sites: [], contact: { name: "Synthetic Contact", line1: "", line2: "", city: "", region: "", postalCode: "", country: "", phone: "", email: "contact@example.test", defaultShipping: true }, createdAtMs: 1, updatedAtMs: 1 },
  ];
}

function mockDesktop() {
  const calls = { list: 0, mutations: [] };
  const items = credential();
  return {
    calls,
    listGrokBotVaultCredentials: async () => {
      calls.list += 1;
      return items;
    },
    putGrokBotVaultCredential: async (input) => {
      calls.mutations.push(["put", input]);
      return items[0];
    },
    createGrokBotVaultLogins: async (input) => {
      calls.mutations.push(["createLogins", input]);
      return input.logins.map(() => ({ kind: "imported" }));
    },
    updateGrokBotVaultCard: async (input) => {
      calls.mutations.push(["updateCard", input]);
      return items[1];
    },
    putGrokBotVaultContact: async (input) => {
      calls.mutations.push(["putContact", input]);
      return items[2];
    },
    createGrokBotVaultCard: async (input) => {
      calls.mutations.push(["createCard", input]);
      return items[1];
    },
    deleteGrokBotVaultCredential: async (input) => {
      calls.mutations.push(["delete", input]);
    },
    readGrokBotCardPhoto: async () => ({ outcome: "unavailable" }),
    cancelGrokBotCardPhotoRead: async () => undefined,
  };
}

async function render(t, ui, Host) {
  const host = window.document.createElement("div");
  host.setAttribute("data-vault-test-root", "");
  window.document.body.append(host);
  const root = ui.createRoot(host);
  t.after(async () => {
    await ui.act(async () => root.unmount());
    host.remove();
    await closeLibraryDom(window);
  });
  await ui.act(async () => root.render(ui.createElement(Host, {})));
  for (let index = 0; index < 6; index += 1) {
    await ui.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return host;
}

test("original 0721 Vault settings render list, cards, and contacts through the local bridge", async (t) => {
  const ui = { createElement: React.createElement, createRoot, act: React.act };
  const { built, host: Host } = await loadHost();
  const desktop = mockDesktop();
  window.desktop = { vault: desktop };
  const host = await render(t, ui, Host);
  const text = host.textContent ?? "";
  assert.equal(desktop.calls.list >= 1, true);
  assert.equal(text.includes("example.com"), true, host.outerHTML);
  assert.equal(text.includes("user@example.test"), true);
  assert.equal(text.includes("visa"), true);
  assert.equal(text.includes("Synthetic Contact"), true);
  assert.equal(host.querySelectorAll("button").length > 3, true);
  assert.equal(built.bundle.includes(VAULT_RENDERER_MARK), true);
  assert.equal(/createRoot\s*\(/u.test(built.bundle), false);
  assert.equal(/new\s+MutationObserver/u.test(built.bundle), false);
  record("vault-render-host", host.outerHTML);
  record("vault-render-summary", {
    bundleBytes: built.bundle.length,
    styleBytes: built.generated.style.length,
    listCalls: desktop.calls.list,
    buttons: host.querySelectorAll("button").length,
  });
  delete window.desktop;
});

test("settings source patch adds the original Vault id, label, icon, and one host render branch", async () => {
  const view = await readFile(path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/view.tsx"), "utf8");
  const surface = await readFile(path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/desktop-surface.tsx"), "utf8");
  const patched = patchVaultSettingsSources({ view, surface });
  assert.match(patched.view, /"general" | "router" | "vault" | "usage" | "beta"/);
  assert.match(patched.view, /id: "vault", label: "Vault", icon: "vault"/);
  assert.equal(patched.surface.includes('if (section === "vault") return <RVaultSettingsHost focusSetting={null} />;'), true);
  assert.equal(patched.surface.split("RVaultSettingsHost").length - 1, 2);
  assert.throws(() => patchVaultSettingsSources(patched), /already applied/);
  record("vault-settings-patch", {
    sectionId: "vault",
    label: "Vault",
    icon: "vault",
    upstreamRegistryEvidence: "D6 uses id=vault, label id=GAYFP2, icon=vault",
  });
});

test("generated original module preserves the pinned CSV reader and planner closure", async () => {
  const source = readFileSync(path.join(repoRoot, "frontend/src/recovered/features/vault/upstream-vault-settings.generated.mjs"), "utf8");
  assert.match(source, /chunk-csv-parse-C5LpQq5n\.js/);
  assert.match(source, /function Me2?\(/);
  assert.match(source, /login_uri|login_username|login_password/);
  assert.match(source, /NoteType:Credit Card/);
  assert.match(source, /batchCreateGrokBotVaultCredentials|createGrokBotVaultLogins/);
  assert.match(source, /b272ee13db0fb9106f9276a46a8e47baf688c8d5ac1b1dc400df6fcba9e76996/);
});

