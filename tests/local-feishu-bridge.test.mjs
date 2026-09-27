import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("feishu bridge delivery state machine", () => {
  const result = spawnSync(
    "/usr/bin/python3",
    [path.join(root, "scripts/feishu-inbox/test_bridge.py")],
    { encoding: "utf8", timeout: 30_000 },
  );
  const output = result.stdout + result.stderr;
  if (result.status !== 0 || !output.includes("OK")) {
    throw new Error("python bridge tests failed:\n" + output);
  }
});

test("feishu webhook ingress http entry", () => {
  const result = spawnSync(
    "/usr/bin/python3",
    [path.join(root, "scripts/feishu-inbox/test_ingress.py")],
    { encoding: "utf8", timeout: 60_000 },
  );
  const output = result.stdout + result.stderr;
  if (result.status !== 0 || !output.includes("OK")) {
    throw new Error("python ingress tests failed:\n" + output);
  }
});
