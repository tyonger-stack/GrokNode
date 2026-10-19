import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parse } from "acorn";
import { buildServerPortCardsBundle, patchServerPortCardsSource } from "../scripts/lib/server-port-cards-renderer-patch.mjs";

test("review renderer patch binds the actual checksum renderer and remains idempotent", async t => {
  const source = await readFile(new URL("../src/app/dist/renderer/assets/index-UbX-y3il.js", import.meta.url), "utf8").catch(error => {
    if (error.code === "ENOENT") return null; throw error;
  });
  if (source === null) { t.skip("checksum-pinned renderer not hydrated"); return; }
  const bundle = await buildServerPortCardsBundle();
  const changed = patchServerPortCardsSource(source, bundle);
  const tree = parse(changed, { sourceType: "module", ecmaVersion: "latest" });
  assert.ok(tree.body.some(node => node.type === "FunctionDeclaration" && node.id.name === "RServerPortCard"));
  assert.equal(patchServerPortCardsSource(changed, bundle), changed);
  assert.throws(() => patchServerPortCardsSource(source.replace('respondToWidget:j=>e.respondToWidget(j),', ""), bundle));
});
