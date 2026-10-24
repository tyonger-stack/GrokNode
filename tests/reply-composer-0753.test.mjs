import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "acorn";
import { extractFile } from "@electron/asar";
import { patchReplyComposer0753, REPLY_COMPOSER_0753_CSS } from "../scripts/lib/reply-composer-0753-patch.mjs";
import official from "../scripts/lib/reply-composer-0753-official.json" with { type: "json" };
import { createReplyRuntime, expandReplyTree, findReplyNodes } from "./reply-composer-0753-harness.mjs";

const original = await readFile(new URL("../src/app/dist/renderer/assets/index-UbX-y3il.js", import.meta.url), "utf8").catch(() => null);
const skip = original == null ? "pinned renderer not hydrated" : false;
const asar = process.env.GROK_NODE_REPLY_TEST_ASAR;
const source = asar ? extractFile(asar, "dist/renderer/assets/index-UbX-y3il.js").toString() : original == null ? null : patchReplyComposer0753(original).text;
const textOf = tree => findReplyNodes(tree, node => typeof node.props?.children === "string").map(node => node.props.children).join("");

test("ported official pill has a separate dismiss button and keeps the complete quote", { skip }, () => {
  const runtime = createReplyRuntime(source);
  const events = [];
  const text = "一段用于验证引用条的很长文字。".repeat(30);
  const tree = expandReplyTree(runtime.Kvn({ preview: { kind: "assistant-text", text }, onOpen: () => events.push("open"), onClear: () => events.push("clear") }));
  const buttons = findReplyNodes(tree, node => node.type === "button");
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].props["aria-label"], "跳转到被回复的消息");
  assert.equal(buttons[1].props["aria-label"], "取消回复");
  assert.equal(textOf(tree), text);
  assert.deepEqual(findReplyNodes(tree, node => node.type === "svg").map(node => node.props["data-icon"]), ["close"]);
  buttons[0].props.onClick();
  assert.deepEqual(events, ["open"]);
  buttons[1].props.onClick();
  assert.deepEqual(events, ["open", "clear"]);
  let prevented = false;
  buttons[0].props.onMouseDown({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test("reply labels follow the selected language", { skip }, () => {
  const runtime = createReplyRuntime(source, { locale: "en" });
  const tree = expandReplyTree(runtime.Kvn({ preview: { kind: "user-text", text: "Quoted text" }, onOpen() {}, onClear() {} }));
  assert.deepEqual(findReplyNodes(tree, node => node.type === "button").map(node => node.props["aria-label"]), ["Jump to replied message", "Cancel reply"]);
});

test("composer frame uses the official border width, radii and inherited height", { skip }, () => {
  const runtime = createReplyRuntime(source);
  for (const [isExpanded, radius] of [[false, "22px"], [true, "18px"]]) {
    const frame = runtime.Xlt({ isExpanded, style: { height: "130px" }, className: "sand-prompt-shell", children: "editor" });
    assert.ok(frame.props.className.includes("r0753-composer"));
    assert.equal(frame.props.style["--x-borderWidth"], "0.5px");
    assert.equal(frame.props.style["--x-borderRadius"], radius);
    assert.equal(frame.props.style.height, "130px");
    assert.equal(frame.props.children, "editor");
  }
  assert.equal(runtime.LAe("pill"), Infinity);
  assert.equal(runtime.LAe("quote"), 96);
  assert.equal(runtime.zvn("pill"), 16);
});

test("opening a reply navigates to its existing or off-screen target without clearing it", { skip }, () => {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const callbacks = [];
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.type === "Property" && node.key?.name === "onOpenReplyTarget" && node.value.type === "ArrowFunctionExpression") callbacks.push(node.value);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  };
  visit(ast);
  assert.equal(callbacks.length, 1);
  const callback = source.slice(callbacks[0].start, callbacks[0].end);
  for (const inScope of [true, false]) {
    const events = [];
    const context = { replyTargetId: "message-42", isEntryInScope: () => inScope, scrollToEntry: id => events.push(["scroll", id]), revealEntry: id => events.push(["reveal", id]) };
    new Function("e", `return (${callback});`)(context)();
    assert.deepEqual(events, [[inScope ? "scroll" : "reveal", "message-42"]]);
    assert.equal(context.replyTargetId, "message-42");
  }
});

test("official CSS and both palettes stay scoped to the transplanted composer", () => {
  assert.equal(official.themes.light["--sand-bg-elevated"], "#ffffff");
  assert.equal(official.themes.dark["--sand-bg-elevated"], "#1f1f1f");
  assert.match(REPLY_COMPOSER_0753_CSS, /\.sand-shell\[data-theme="cursor-dark"\] \.r0753-composer/);
  assert.ok(official.css.includes("box-shadow:inset 0 0 0 1px var(--sand-border-secondary-translucent)"));
  assert.ok(official.css.includes("text-overflow:ellipsis"));
  assert.ok(official.css.includes("white-space:nowrap"));
  assert.doesNotMatch(official.css, /\.sand-[a-z0-9]+(?![\w-])/, "copied atomic selectors must use the private namespace");
});

test("official component bytes match their recorded source artifact", async t => {
  const bytes = await readFile("/tmp/official0753/dist/renderer/assets/index.eager-app-DjFE9lSq.js").catch(() => null);
  if (bytes == null) return t.skip("official reference artifact not present");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), official.sha256.app);
  const text = bytes.toString();
  const nodes = parse(text, { ecmaVersion: "latest", sourceType: "module" }).body;
  for (const [name, component] of Object.entries(official.sources)) {
    const node = nodes.find(node => node.type === "FunctionDeclaration" && node.id?.name === name);
    assert.equal(component.replaceAll("r0753-sand-", "sand-"), text.slice(node.start, node.end));
  }
});

test("the build patch is idempotent and keeps composer memo slots within bounds", { skip }, () => {
  assert.equal(patchReplyComposer0753(source).applied, false);
  const node = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body.find(node => node.type === "FunctionDeclaration" && node.id?.name === "S9n");
  const component = source.slice(node.start, node.end);
  const size = Number(component.match(/he\.c\((\d+)\)/)[1]);
  const maximum = Math.max(...[...component.matchAll(/\be\[(\d+)\]/g)].map(match => Number(match[1])));
  assert.ok(maximum < size);
  assert.throws(() => patchReplyComposer0753(original.replace("he.c(215)", "he.c(214)")), /anchor missing or ambiguous/);
});
