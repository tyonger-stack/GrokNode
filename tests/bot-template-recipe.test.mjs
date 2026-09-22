import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "node_modules/.cache/bot-template-recipe.mjs");
await mkdir(path.dirname(output), { recursive: true });
await build({ entryPoints: [path.join(root, "source/shared/bot-template-recipe.ts")], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "error" });
const { parseBotTemplateRecipe } = await import(pathToFileURL(output).href);
const recipe = {
  profile: { name: "Example", description: "Actual instructions" },
  memory: [{ kind: "profile", content: "A remembered preference", createdAt: null }],
  skills: [{ name: "Design", description: "Design a Bot", content: "# Design\nFull instructions" }],
  routines: [{ name: "Audit", slug: "audit", description: "Weekly audit", content: "---\ncron: 49 8 * * 1\n---\nCheck routines" }],
  plugins: [{ name: "Example plugin", pluginId: "plugin-one", description: "Plugin description" }],
  gettingStarted: { skill: "Design" },
};
test("complete recipes retain actual instructions and all four detail categories", () => {
  assert.deepEqual(parseBotTemplateRecipe(JSON.stringify(recipe)), recipe);
});
test("summary-only or malformed recipes do not silently become empty detail categories", () => {
  assert.throws(() => parseBotTemplateRecipe(JSON.stringify({ profile: recipe.profile })));
  assert.throws(() => parseBotTemplateRecipe(JSON.stringify({ ...recipe, skills: [{ name: "No content" }] })));
  assert.throws(() => parseBotTemplateRecipe(JSON.stringify({ ...recipe, gettingStarted: { skill: "Missing" } })));
});
