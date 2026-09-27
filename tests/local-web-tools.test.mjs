import assert from "node:assert/strict";
import test from "node:test";

import { load } from "./support/local-web-tools-loader.mjs";

// Only the deterministic case lives here. Everything that needs the public
// internet lives in local-web-tools-network.test.mjs, which the CI check job
// deliberately leaves out: it has turned the required gate red three times on
// runner-network wobble alone, twice as a ~10s timeout and once as an instant
// failure 40ms in, with no change to the code under test. Coverage is
// unchanged — `npm test` still runs both files — but the mandatory gate no
// longer depends on the runner's egress.
//
// The unreachable-host case below stays here because it asserts a *failure*:
// `.invalid` is reserved by RFC 2606 and never resolves, so the result is the
// same with or without a network.
test("the local web fetch service reports a clear error for an unreachable host", async () => {
  const mod = await load("local-web-tools.mjs");
  const service = mod.createLocalWebFetchService();
  const result = await service({}, "https://this-host-does-not-exist.invalid/");
  assert.ok("error" in result, "an unreachable host must surface an error");
  assert.equal(result.isTimeout, undefined);
});
