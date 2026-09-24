import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "source", "electron-main", "box", "local-docker-host-connector.ts");

async function loadModule() {
  const result = await build({
    entryPoints: [sourcePath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022",
  });
  const output = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("splits the curl status trailer off the relay probe body", async () => {
  const { parseLocalDockerRelayOutput } = await loadModule();
  assert.deepEqual(parseLocalDockerRelayOutput('{"data":[{"id":"a"}]}\n200 0.052911'), {
    body: '{"data":[{"id":"a"}]}',
    httpStatus: 200,
    elapsedSeconds: 0.052911,
  });
  assert.deepEqual(parseLocalDockerRelayOutput("curl: (7) Failed to connect"), {
    body: "curl: (7) Failed to connect",
    httpStatus: null,
    elapsedSeconds: null,
  });
});

test("reports a relay 403 as an upstream authorization failure", async () => {
  const { localDockerRelayStatusFromProbe } = await loadModule();
  const missingToken = localDockerRelayStatusFromProbe(
    { body: '{"error":"relay token required"}', httpStatus: 403, elapsedSeconds: 0.012 },
    Date.now() - 12,
  );
  assert.equal(missingToken.state, "upstream_403");
  assert.equal(missingToken.code, "RelayTokenRequired");
  assert.equal(missingToken.httpStatus, 403);
  assert.equal(missingToken.latencyMs, 12);
  assert.equal(missingToken.source, "model_list");

  const otherForbidden = localDockerRelayStatusFromProbe(
    { body: '{"error":"forbidden"}', httpStatus: 403, elapsedSeconds: 0.01 },
    Date.now(),
  );
  assert.equal(otherForbidden.state, "upstream_403");
  assert.equal(otherForbidden.code, "OpenCodexUpstreamForbidden");
});

test("separates exhausted quota from ordinary rate limiting", async () => {
  const { localDockerRelayStatusFromProbe } = await loadModule();
  const exhausted = localDockerRelayStatusFromProbe(
    { body: '{"error":"insufficient balance"}', httpStatus: 402, elapsedSeconds: 0.01 },
    Date.now(),
  );
  assert.equal(exhausted.state, "out_of_quota");
  assert.equal(exhausted.httpStatus, 402);

  const throttled = localDockerRelayStatusFromProbe(
    { body: '{"error":"too many requests"}', httpStatus: 429, elapsedSeconds: 0.01 },
    Date.now(),
  );
  assert.equal(throttled.state, "rate_limited");
  assert.equal(throttled.httpStatus, 429);
});

test("flags a relay model list that carries no usable ids", async () => {
  const { localDockerRelayStatusFromProbe } = await loadModule();
  const empty = localDockerRelayStatusFromProbe(
    { body: '{"data":[]}', httpStatus: 200, elapsedSeconds: 0.01 },
    Date.now(),
  );
  assert.equal(empty.state, "model_list_abnormal");

  const idless = localDockerRelayStatusFromProbe(
    { body: '{"data":[{"name":"x"}]}', httpStatus: 200, elapsedSeconds: 0.01 },
    Date.now(),
  );
  assert.equal(idless.state, "model_list_abnormal");

  const healthy = localDockerRelayStatusFromProbe(
    { body: '{"data":[{"id":"ark-code-latest"}]}', httpStatus: 200, elapsedSeconds: 0.031 },
    Date.now(),
  );
  assert.equal(healthy.state, "ok");
  assert.equal(healthy.httpStatus, 200);
  assert.equal(healthy.latencyMs, 31);
});

test("classifies relay transport failures from curl output", async () => {
  const { localDockerRelayStatusFromProbe } = await loadModule();
  const refused = localDockerRelayStatusFromProbe(
    { body: "curl: (7) Failed to connect to 127.0.0.1 port 10100 after 0 ms: Couldn't connect to server", httpStatus: null, elapsedSeconds: null },
    Date.now(),
  );
  assert.equal(refused.state, "connection_failed");
  assert.equal(refused.code, "ECONNREFUSED");

  const timedOut = localDockerRelayStatusFromProbe(
    { body: "curl: (28) Operation too slow. Less than 1 bytes/sec", httpStatus: null, elapsedSeconds: null },
    Date.now(),
  );
  assert.equal(timedOut.state, "response_timeout");
});
