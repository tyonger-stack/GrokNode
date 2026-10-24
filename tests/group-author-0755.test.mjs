import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { parse } from "acorn";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { GROUP_AUTHOR_0755_COMPONENTS, GROUP_AUTHOR_0755_STYLE, patchGroupAuthor0755 } from "../scripts/lib/group-author-0755-patch.mjs";
import { SEARCH_MENU_0753_COMPONENTS } from "../scripts/lib/search-menu-0753-patch.mjs";
import official from "../scripts/lib/group-author-0755-official.json" with { type: "json" };

const catalogAst = parse(SEARCH_MENU_0753_COMPONENTS, { ecmaVersion: "latest", sourceType: "module" });
const catalog = catalogAst.body.find(n => n.type === "FunctionDeclaration" && n.id.name === "RSMCatalogText");
const catalogSource = SEARCH_MENU_0753_COMPONENTS.slice(catalog.start, catalog.end);
const baseline = await readFile(new URL("../src/app/dist/renderer/assets/index-UbX-y3il.js", import.meta.url), "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
const available = { skip: baseline == null ? "pinned renderer not hydrated" : false };
const patched = baseline == null ? null : patchGroupAuthor0755(baseline + "\n" + catalogSource);
const ast = patched == null ? null : parse(patched, { ecmaVersion: "latest", sourceType: "module" });
const native = ast?.body.find(n => n.type === "FunctionDeclaration" && n.id.name === "gMn");
function runtime() {
  const selected = [], agents = [{ id: "red-bot", name: "公文大师", avatarColor: "red" }, { id: "cyan-bot", name: "飞书小秘书", avatarColor: "cyan" }];
  const context = vm.createContext({
    p: { jsx, jsxs, Fragment: React.Fragment }, S: React,
    he: { c: size => Array(size).fill(Symbol.for("react.memo_cache_sentinel")) },
    vt: ({ as = "span", children, rootStyle, ...props }) => jsx(as, { ...props, className: rootStyle?.kMwMTN, children }),
    re: (...values) => values.filter(Boolean).join(" "),
    RLocT: (_en, zh) => zh,
    Ra: () => agents, r1: () => ({ selectAgent: id => selected.push(id), isReadOnly: false, agentId: "group" }), aln: () => null,
  });
  vm.runInContext(catalogSource + GROUP_AUTHOR_0755_COMPONENTS + (native == null ? "" : patched.slice(native.start, native.end)) + ";globalThis.api={Author:RGAuthor,hue:RGAuthorHue,wrap:RGColorAuthorRun,native:typeof gMn==='undefined'?null:gMn};", context);
  return { ...context.api, selected, agents };
}
test("official hues follow each Bot's avatar color and normalize violet", () => {
  const api = runtime();
  assert.equal(api.hue("red-bot", api.agents[0]), "red");
  assert.equal(api.hue("cyan-bot", api.agents[1]), "cyan");
  assert.equal(api.hue("purple-bot", { id: "purple-bot", avatarColor: "violet" }), "purple");
  assert.equal(api.hue("black-bot", { id: "black-bot", avatarColor: "black" }), "gray");
  assert.equal(api.hue("missing-bot", null), api.hue("missing-bot", null));
});
test("the copied author component preserves names and click actions while exposing the sender color", () => {
  const api = runtime();
  const tree = api.Author({ name: "公文大师", hue: "red", onSelect: () => api.selected.push("red-bot") });
  assert.equal(tree.props.style["--sand-transcript-sender-name"], "var(--sand-text-red-primary)");
  tree.props.onClick();
  assert.deepEqual(api.selected, ["red-bot"]);
  assert.match(renderToStaticMarkup(tree), /公文大师/);
  assert.match(tree.props.className, /rg0755-colors/);
  const gray = api.Author({ name: "默认 Bot", hue: "gray" });
  assert.equal(gray.props.style["--sand-transcript-sender-name"], "var(--sand-text-secondary)");
});
test("the real author-run component supplies distinct sender hues without changing bubble content", available, () => {
  const api = runtime();
  const headers = api.agents.map(agent => {
    const tree = api.native({ author: { id: agent.id, name: agent.name }, agent, showsAuthorName: true, showsAuthorAvatar: false, children: jsx("p", { children: "群聊正文" }) });
    const column = tree.props.children[1];
    assert.equal(column.props.children[1].props.children, "群聊正文");
    return column.props.children[0];
  });
  assert.deepEqual(headers.map(header => header.props.hue), ["red", "cyan"]);
  for (const header of headers) assert.match(renderToStaticMarkup(header), /rg0755-colors/);
});
test("both official theme palettes are present and the native compiler cache remains unchanged", available, () => {
  assert(GROUP_AUTHOR_0755_STYLE.includes(official.themes.dark["--sand-text-red-primary"]));
  assert(GROUP_AUTHOR_0755_STYLE.includes(official.themes.light["--sand-text-red-primary"]));
  assert(patched.slice(native.start, native.end).includes("he.c(38)"));
  assert.throws(() => patchGroupAuthor0755(patched), /already applied/);
});
test("the copied functions and styles retain their official artifact fingerprint", async t => {
  const archive = "/Applications/Grok Bot.app/Contents/Resources/app.asar";
  if (await stat(archive).catch(error => { if (error.code === "ENOENT") return null; throw error; }) == null) return t.skip("official comparison artifact unavailable");
  const version = await readFile("/Applications/Grok Bot.app/Contents/Info.plist", "utf8").then(text => text.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)/)?.[1] ?? null).catch(() => null);
  if (version !== "0.75.5") return t.skip(`official app is ${version ?? "unknown"}; the captured fingerprint is pinned to 0.75.5`);
  const { extractFile } = await import("@electron/asar");
  const app = extractFile(archive, official.appFile).toString(), common = extractFile(archive, official.commonFile).toString();
  assert.equal(createHash("sha256").update(app).digest("hex"), official.appSha256);
  for (const code of Object.values(official.functions)) assert(app.includes(code));
  for (const code of Object.values(official.defaults)) assert(common.includes(code));
});
