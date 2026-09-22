import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

const source = await readFile(new URL("../source/electron-main/coordinator/local-coordinator-runtime.ts", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "ts", format: "esm" });
const { createLocalCoordinatorRuntime } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

test("a local coordinator starts without an account and delivers an early renderer request", async () => {
  let launches = 0;
  let closes = 0;
  let received;
  const port = { postMessage() {} };
  const controller = createLocalCoordinatorRuntime(() => {
    launches += 1;
    return { requestRendererPort: sink => sink(port), revokeRendererPortRequest() {}, restart: async () => {}, dispose: async () => { closes += 1; } };
  });
  controller.requestRendererPort(value => { received = value; });
  await controller.start();
  await controller.start();
  assert.equal(launches, 1);
  assert.equal(received, port);
  await controller.dispose();
  await controller.dispose();
  await controller.restart();
  assert.equal(closes, 1);
  assert.equal(launches, 1);
});

test("a failed local launch surfaces its error and can be retried", async () => {
  let attempts = 0;
  const controller = createLocalCoordinatorRuntime(() => {
    attempts += 1;
    if (attempts === 1) throw new Error("spawn failed");
    return { requestRendererPort() {}, revokeRendererPortRequest() {}, restart: async () => {}, dispose: async () => {} };
  });
  await assert.rejects(controller.start(), /spawn failed/);
  await controller.start();
  assert.equal(attempts, 2);
  await controller.dispose();
});
