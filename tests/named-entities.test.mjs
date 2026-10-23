import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
const built = await build({
  stdin: {
    contents: `export { decodeNamedHtml } from "./frontend/src/recovered/features/conversation/workspace/named-entities";`,
    resolveDir: repo,
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
const entities = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));

test("named HTML entities used by formulas expand", () => {
  assert.equal(entities.decodeNamedHtml("&alpha; + &amp; &#39;"), "α + & '");
  assert.equal(entities.decodeNamedHtml("&notanentity;"), "&notanentity;");
});
