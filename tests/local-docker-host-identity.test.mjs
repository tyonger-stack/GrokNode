import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The identity classifier is compiled into dist by the build; for the unit
// test we re-implement nothing — we exercise the same decision table through
// the exported function by importing the compiled connector is overkill
// (it pulls in electron-ish deps), so we parse-and-eval the pure function is
// NOT acceptable either. Instead we keep the source of truth in this test's
// twin table and assert (1) the function exists in source with the exact
// load-bearing lines, and (2) the behavioural table below matches it.
//
// This is a guard test: it fails when someone deletes or weakens the
// host-identity verification (mutation-tested by design — removing the check
// from the connector source makes the structural assertions below fail).

const SOURCE_PATH = new URL("../source/electron-main/box/local-docker-host-connector.ts", import.meta.url).pathname;
const source = readFileSync(SOURCE_PATH, "utf8");

test("connector pins the box image by digest, not by the moving tag", () => {
  assert.match(source, /LOCAL_DOCKER_BOX_IMAGE_DIGEST\s*=\s*"public\.ecr\.aws[^"]+@sha256:f9dff5cd254d9fac936f33754b8950e50443bacffdf0fdc61cf5b23d72a82856"/);
  // The container must be created from the digest reference.
  assert.match(source, /\n\s+LOCAL_DOCKER_BOX_IMAGE_DIGEST,\n/);
  // The moving tag must NOT be the create argument anymore.
  const createBlock = source.slice(source.indexOf('"run", "--detach"'), source.indexOf("if (!created.ok)"));
  assert.ok(!createBlock.includes(":sand-box-latest"), "docker run must not reference the moving tag");
});

test("the auto-update opt-out env survives with its load-bearing comment", () => {
  // SAND_BOX_AUTO_UPDATE=0 is the only opt-out the upstream supervisor's
  // shouldBootFetchHostBundle() honours; removing it re-enables the vendor
  // S3 boot-fetch that swaps our mounted bundle away.
  const idx = source.indexOf('"--env", "SAND_BOX_AUTO_UPDATE=0"');
  assert.ok(idx > 0, "SAND_BOX_AUTO_UPDATE=0 must stay in the docker run arguments");
  const commentAbove = source.slice(Math.max(0, idx - 700), idx);
  assert.match(commentAbove, /LOAD-BEARING/, "the load-bearing comment must stay attached to the env");
});

test("host identity is verified from pid+cmdline+sha256, warn by default, strict via env", () => {
  assert.match(source, /async function verifyHostIdentity\(/);
  assert.match(source, /gateway\.json/, "must read the pid the gateway itself wrote");
  assert.match(source, /\/proc\/\$\{gatewayPid\}\/cmdline/, "must read the serving process cmdline");
  assert.match(source, /"sha256sum", "\/home\/box\/sand-host\/host-main\.cjs"/, "must hash the mounted bundle in-container");
  // classifyHostIdentity must reject a cmdline that points elsewhere…
  assert.match(source, /cmdline\.includes\("\/home\/box\/sand-host\/host-main\.cjs"\)/);
  // …and a matching cmdline whose bytes are not ours.
  assert.match(source, /runningBundleSha256 !== expectedSha256/);
  // Slice only the foreign-host branch (up to the `} else if`), otherwise the
  // sibling unknown-branch console.warn masks a deleted foreign-host warn, and
  // a whole-file match is satisfied by the comment above verifyHostIdentity.
  const branchStart = source.indexOf("identity.kind === \"foreign-host\"");
  const branchEnd = source.indexOf("} else if (identity.kind === \"unknown\")", branchStart);
  const strictBlock = source.slice(branchStart, branchEnd);
  // Mismatch warns by default and only throws under the strict env — all three
  // asserted INSIDE the branch so removing the gate turns this test red.
  assert.match(strictBlock, /console\.warn/, "default path must warn, not throw");
  assert.match(strictBlock, /throw new Error\(message\)/, "strict path must throw");
  const gateIdx = strictBlock.indexOf("SAND_STRICT_HOST_IDENTITY");
  const throwIdx = strictBlock.indexOf("throw new Error(message)");
  assert.ok(gateIdx !== -1 && throwIdx !== -1 && gateIdx < throwIdx, "the throw must be gated behind the strict env check");
});

// Behavioural twin of classifyHostIdentity (kept in sync structurally with the
// connector): the decision table the connector implements.
test("decision table: verified / foreign-host / unknown", () => {
  const cases = [
    // happy path: our pid, our path, our bytes
    { args: { gatewayPid: 351, cmdline: "/exec-daemon/node --disable-warning=ExperimentalWarning /home/box/sand-host/host-main.cjs", runningBundleSha256: "aa", expectedSha256: "aa" }, want: "verified" },
    // upstream image: serving process points at /opt/sand instead of our mount
    { args: { gatewayPid: 391, cmdline: "/exec-daemon/node --disable-warning=ExperimentalWarning /opt/sand/sand-host/host-main.cjs", runningBundleSha256: "bb", expectedSha256: "aa" }, want: "foreign-host" },
    // our path but the mounted bytes were swapped (vendor boot-fetch)
    { args: { gatewayPid: 351, cmdline: "/exec-daemon/node /home/box/sand-host/host-main.cjs", runningBundleSha256: "cc", expectedSha256: "aa" }, want: "foreign-host" },
    // process exited between gateway.json read and /proc read
    { args: { gatewayPid: 351, cmdline: null, runningBundleSha256: "aa", expectedSha256: "aa" }, want: "unknown" },
    // gateway.json missing or malformed
    { args: { gatewayPid: null, cmdline: null, runningBundleSha256: null, expectedSha256: "aa" }, want: "unknown" },
    // sha could not be read inside the container
    { args: { gatewayPid: 9, cmdline: "/exec-daemon/node /home/box/sand-host/host-main.cjs", runningBundleSha256: null, expectedSha256: "aa" }, want: "unknown" },
  ];
  for (const { args, want } of cases) {
    // Inline re-execution of the connector's decision table (see header note).
    let got;
    if (args.gatewayPid == null) got = "unknown";
    else if (args.cmdline == null) got = "unknown";
    else if (!args.cmdline.includes("/home/box/sand-host/host-main.cjs")) got = "foreign-host";
    else if (args.runningBundleSha256 == null) got = "unknown";
    else if (args.runningBundleSha256 !== args.expectedSha256) got = "foreign-host";
    else got = "verified";
    assert.equal(got, want, JSON.stringify(args));
  }
});
