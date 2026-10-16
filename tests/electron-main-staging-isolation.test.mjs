import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { copySourceAppForStaging } from "../scripts/lib/build-asar.mjs";

for (const linkedDist of [false, true]) {
  test(`staging isolates pinned inputs with ${linkedDist ? "symlinked" : "ordinary"} dist`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "grok-staging-isolation-"));
    try {
      const source = path.join(root, "source");
      const dist = linkedDist ? path.join(root, "pinned-dist") : path.join(source, "dist");
      const stage = path.join(root, "stage");
      await mkdir(source, { recursive: true });
      await mkdir(path.join(dist, "electron-main"), { recursive: true });
      await mkdir(path.join(dist, "deps"), { recursive: true });
      await writeFile(path.join(source, "package.json"), '{"name":"staging-input"}\n');
      const original = "initializeSecureStorage();\n";
      const main = path.join(dist, "electron-main/main.cjs");
      await writeFile(main, original);
      await writeFile(path.join(dist, "deps/pinned.txt"), "pinned dependency\n");
      if (linkedDist) await symlink(dist, path.join(source, "dist"), "dir");

      await copySourceAppForStaging(source, stage);
      assert.equal(await readFile(path.join(stage, "dist/electron-main/main.cjs"), "utf8"), original);
      await writeFile(path.join(stage, "dist/electron-main/main.cjs"), "// staged guard\n" + original);
      await rm(path.join(stage, "dist/deps"), { recursive: true });
      assert.equal(await readFile(main, "utf8"), original, "activation writes must not reach the pinned input");
      assert.equal(await readFile(path.join(dist, "deps/pinned.txt"), "utf8"), "pinned dependency\n");
      assert.equal((await lstat(path.join(stage, "dist"))).isSymbolicLink(), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
