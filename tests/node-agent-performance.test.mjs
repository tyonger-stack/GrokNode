import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { summarize, runWorker } from '../tools/node-agent-api/bench/performance.mjs';

const sourceRoot = process.env.NODE_AGENT_BENCH_SOURCE_ROOT ?? path.resolve(import.meta.dirname, '..');
test('nearest-rank summaries do not fabricate missing observations', () => {
  assert.equal(summarize([]).localDispatchMs.p95, null);
  assert.equal(summarize(Array.from({ length: 100 }, (_, i) => ({ localDispatchMs: i + 1 }))).localDispatchMs.p95, 95);
});
test('real HTTP/Harness/store round trip persists before SSE and dispatches once', async () => {
    const oldHome = process.env.HOME;
    const result = await runWorker({ sourceRoot, warmup: 0, samples: 1, scenario: 'replay' });
    assert.deepEqual(result.failures, []);
    const row = result.rows[0];
    assert.equal(row.durableBeforeObserved, true); assert.equal(row.exactlyOneTurn, true);
    assert.ok(row.counters.storeWrites > 0); assert.equal(row.counters.realDockerCalls, 0);
    assert.equal(result.cleanup.children, 0); assert.equal(result.cleanup.stateRemoved, true);
    assert.deepEqual(result.cleanup.credentialAudit.violations, []);
    assert.ok(result.cleanup.credentialAudit.symlinksChecked >= 1);
    assert.equal(process.env.HOME, oldHome);
});
test('injected Harness reply delay belongs after local dispatch', async () => {
  const result = await runWorker({ sourceRoot, harnessDelayMs: 80, warmup: 0, samples: 1 });
  assert.deepEqual(result.failures, []);
  const row = result.rows[0]; assert.ok(row.httpAcceptedMs - row.localDispatchMs >= 70);
});
test('stalled Harness turn has unknown outcome and is never replayed', async () => {
  const result = await runWorker({ sourceRoot, stallMethod: 'turn/start', timeoutMs: 200, samples: 0, warmup: 0, scenario: 'timeout' });
  assert.deepEqual(result.rows, [{ unknown: true, turnStart: 1 }]);
});
