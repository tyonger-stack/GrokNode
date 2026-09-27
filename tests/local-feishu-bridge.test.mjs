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

// The ingress payload is AES-256-CBC encrypted by Feishu and the decryptor
// binds CommonCrypto through /usr/lib/libSystem.B.dylib, so this test can only
// execute on macOS. The ubuntu job skips it; the check-darwin job runs this
// file so the assertion is still enforced in CI rather than silently dropped.
const ingressSkip =
  process.platform === "darwin"
    ? false
    : "ingress decrypt needs macOS CommonCrypto (/usr/lib/libSystem.B.dylib)";

test("feishu webhook ingress http entry", { skip: ingressSkip }, () => {
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
