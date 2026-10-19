import test from "node:test";
import { mkdtemp, rm, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { build } from "esbuild";

test("private form transport crosses the real Connect/protobuf box daemon without logging input", async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "box-review-transport-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await build({ entryPoints: [new URL("./fixtures/server-port-box-transport.mjs", import.meta.url).pathname],
    bundle: true, platform: "node", format: "cjs", write: false, mainFields: ["module", "main"], logLevel: "silent" });
  const file = path.join(root, "fixture.cjs"); await writeFile(file, result.outputFiles[0].text);
  const { runBoxTransportScenario } = createRequire(import.meta.url)(file);
  await runBoxTransportScenario(path.join(root, "workspace"));
});
