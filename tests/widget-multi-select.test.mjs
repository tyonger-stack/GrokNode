import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const cacheDir = path.join(root, "node_modules", ".cache");
await mkdir(cacheDir, { recursive: true });
const jsToTs = { name: "js-to-ts", setup(builder) { builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => { const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts")); return candidate.startsWith(path.join(root, "source")) && existsSync(candidate) ? { path: candidate } : null; }); } };

async function load(entry, name) {
  const outfile = path.join(cacheDir, `${name}-multi-select.cjs`);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error", plugins: [jsToTs], external: ["electron"] });
  return createRequire(import.meta.url)(outfile);
}

const widgets = await load("source/shared/sand-widgets.ts", "sand-widgets");
const sendSchema = await load("source/host/runner/tools/send-message-schema.ts", "send-message-schema");

const toppings = { prompt: "Which toppings?", multiSelect: true, options: [{ label: "Cheese", value: "Add cheese" }, { label: "Olives" }, { label: "Basil", value: "Add\n basil" }] };

test("the widget schema keeps multiSelect instead of stripping it", () => {
  const parsed = widgets.sandWidgetSchema.parse(toppings);
  assert.equal(parsed.multiSelect, true);
  assert.equal(widgets.sandWidgetInputSchema.parse(JSON.stringify(toppings)).multiSelect, true);
  assert.equal(widgets.sandWidgetSchema.parse({ ...toppings, multiSelect: undefined }).multiSelect, undefined);
  assert.equal(widgets.sandWidgetSchema.shape.multiSelect.description, "When true, several options may apply. The user toggles any subset, then submits once. Picked values return in one reply, one per line.");
});

test("a multi-select reply maps each line back to its option label", () => {
  assert.equal(widgets.getWidgetAnswerLabel(toppings, "Add cheese\nOlives\n\nAdd basil\nExtra sauce"), "Cheese\nOlives\nBasil\nExtra sauce");
  assert.deepEqual(widgets.splitMultiSelectAnswer("  a \n\n b\n"), ["a", "b"]);
});

test("single-select replies keep exact matching", () => {
  const single = { ...toppings, multiSelect: undefined };
  assert.equal(widgets.getWidgetAnswerLabel(single, "Add cheese"), "Cheese");
  assert.equal(widgets.getWidgetAnswerLabel(single, "Add cheese\nOlives"), "Add cheese\nOlives");
});

test("the SendMessage widget description lists multiSelect", () => {
  const description = sendSchema.sendMessageParameters._def.schema.shape.widget.description;
  assert.match(description, /options: \[\{ label, value\?, description\?, style\? \}\], multiSelect\?, allowCustom\?, dismissOnMoveOn\? \}/);
});
