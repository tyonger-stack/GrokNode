import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { rewritePdfAssetReferences } from "../scripts/renderer-production-build.mjs";

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "renderer-pdf-ref-"));
  await mkdir(path.join(root, "assets"), { recursive: true });
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(root, name), text);
  return root;
}

const WORKER = 'const DA="pdf.worker.min-qwK7q_zL.mjs";';

test("legacy absolute /upstream/ PDF.js reference is rewritten to ./", async () => {
  const root = await fixture({ "assets/index.js": `${WORKER}import("/upstream/assets/pdf-WLgSwHwh.js");` });
  try {
    const result = await rewritePdfAssetReferences(root);
    assert.equal(result.replacements["/upstream/assets/pdf-WLgSwHwh.js"].count, 1);
    assert.match(await readFile(path.join(root, "assets/index.js"), "utf8"), /import\("\.\/pdf-WLgSwHwh\.js"\)/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runtime-resolved PDF.js reference (c74a820 resolveShippedViewerAsset) is accepted when shipped", async () => {
  const root = await fixture({
    "assets/index.js": `${WORKER}function nv(e,t){return new URL(\`\${new URL(t).protocol==="file:"?"./assets/":"/upstream/assets/"}\${e}\`,t).href}nv("pdf-WLgSwHwh.js");`,
    "assets/pdf-WLgSwHwh.js": "export {};",
  });
  try {
    const result = await rewritePdfAssetReferences(root);
    assert.equal(result.replacements["/upstream/assets/pdf-WLgSwHwh.js"].count, 0);
    assert.equal(result.replacements["/upstream/assets/pdf-WLgSwHwh.js"].runtimeResolved, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runtime-resolved reference still fails closed when the PDF.js runtime is not shipped", async () => {
  const root = await fixture({ "assets/index.js": `${WORKER}nv("./assets/");nv("pdf-WLgSwHwh.js");` });
  try {
    await assert.rejects(rewritePdfAssetReferences(root), /Renderer PDF reference was not emitted: \/upstream\/assets\/pdf-WLgSwHwh\.js/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
