import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter, on } from 'node:events';
import { bundleServerPort } from './server-port-bundle.mjs';

const m = await bundleServerPort([
  'host/review-private-box', 'packages/context/core',
  'packages/local-exec/background-shell-lifecycle', 'packages/local-exec/background-shell-observability',
  'packages/agent-exec/background-shell', 'packages/agent-exec/shell',
  'packages/proto/generated/agent/v1/background_shell_exec_pb',
  'host/runner/background-work',
]);
const evidence = new URL('../../.omo/evidence/private-stdin-20261019/', import.meta.url);
await mkdir(evidence, { recursive: true });
async function record(name, observable) {
  await writeFile(new URL(`${name}.json`, evidence), JSON.stringify({ scenario: name, invocation: 'node --test tests/server-port-private-stdin.test.mjs', observable, passed: true }, null, 2));
}
const readCommand = `node -e 'require("node:readline").createInterface({input:process.stdin,terminal:false}).once("line",()=>{console.log("received");process.exit(0)})'`;
async function harness(t, legacy = false) {
  const dir = await mkdtemp(path.join(tmpdir(), 'private-stdin-test-'));
  const running = new Map(); const commands = []; const contexts = []; const workingDirectories = [];
  let sequence = 0;
  let discardPrivacyFlag = legacy;
  const completions = [];
  const factory = new m.FileLoggingShellFactory({
    async spawn(ctx, executor) {
      const controller = new AbortController();
      const shell = new m.CoreBackgroundShell(ctx.shellId, controller);
      const iterator = executor.execute(ctx.ctx, { command: ctx.command, signal: controller.signal })[Symbol.asyncIterator]();
      const ready = await iterator.next();
      assert.equal(ready.value.type, 'stdin_ready');
      shell.stdin = ready.value.stdin; shell.pid = ready.value.pid;
      completions.push((async () => {
        for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
          if (next.value.type === 'exit') shell.markCompleted({ code: next.value.code, aborted: next.value.aborted });
        }
      })());
      return shell;
    },
  }, dir);
  const core = {
    async *execute(_ctx, args) {
      const child = spawn('/bin/sh', ['-c', `exec ${args.command}`], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
      const events = new EventEmitter();
      const iterator = on(events, 'event');
      child.stdout.on('data', data => events.emit('event', { type: 'stdout', data: data.toString() }));
      child.stderr.on('data', data => events.emit('event', { type: 'stderr', data: data.toString() }));
      child.on('exit', code => events.emit('event', { type: 'exit', code, aborted: args.signal?.aborted ?? false, localExecutionTimeMs: 0 }));
      child.on('error', () => events.emit('event', { type: 'exit', code: 1, aborted: false, localExecutionTimeMs: 0 }));
      const abort = () => child.kill();
      args.signal?.addEventListener('abort', abort, { once: true });
      try {
        yield { type: 'stdin_ready', stdin: child.stdin, pid: child.pid };
        for await (const [event] of iterator) { yield event; if (event.type === 'exit') break; }
      } finally { args.signal?.removeEventListener('abort', abort); await iterator.return(); child.kill(); }
    },
  };
  async function start(ctx, args) {
    const decoded = m.BackgroundShellSpawnArgs.fromBinary(args.toBinary());
    if (discardPrivacyFlag) decoded.suppressStdinLogging = false;
    const id = ++sequence;
    commands.push(decoded.command); contexts.push(ctx);
    workingDirectories.push(decoded.workingDirectory);
    const shell = await factory.spawn({ ctx, shellId: id, command: decoded.command, workingDirectory: dir,
      enableWriteShellStdinTool: decoded.enableWriteShellStdinTool, suppressStdinLogging: decoded.suppressStdinLogging }, core);
    running.set(id, shell);
    return new m.BackgroundShellSpawnResult({ result: { case: 'success', value: { shellId: id, pid: shell.pid, command: decoded.command, workingDirectory: dir } } });
  }
  const kills = [];
  const remoteAccessor = { get(resource) {
    if (resource === m.backgroundShellExecutorResource) return { execute: start };
    if (resource === m.writeBackgroundShellInputExecutorResource) return { execute: async (_ctx, args) => {
      const decoded = m.WriteShellStdinArgs.fromBinary(args.toBinary());
      const shell = running.get(decoded.shellId);
      assert.ok(shell?.stdin);
      await new Promise((resolve, reject) => shell.stdin.write(decoded.chars, error => error ? reject(error) : resolve()));
      return new m.WriteShellStdinResult({ result: { case: 'success', value: {} } });
    } };
    if (resource === m.shellExecutorResource) return { execute: async (ctx, args) => {
      assert.equal(ctx.canceled, false);
      assert.equal(args.workingDirectory, '/workspace');
      assert.match(args.command, /^kill -TERM [1-9][0-9]*$/);
      const pid = Number(args.command.split(' ').at(-1));
      assert.ok([...running.values()].some(shell => shell.pid === pid));
      kills.push(pid);
      try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      return { result: { case: 'success', value: { exitCode: 0 } } };
    } };
    throw new Error('unexpected resource');
  } };
  const box = {
    ensureReady: async () => ({ remoteAccessor, terminalsFolder: path.join(dir, 'terminals') }),
    getAgentWindowIndex: () => 1,
    uploadFile: async (_ctx, _id, file, bytes) => writeFile(file, bytes),
    downloadFile: async (_ctx, _id, file) => readFile(file),
  };
  t.after(async () => {
    for (const shell of running.values()) shell.abort();
    await Promise.all(completions);
    await rm(dir, { recursive: true, force: true });
  });
  const terminal = async id => {
    for (let i = 0; i < 200; i++) {
      const output = await readFile(path.join(dir, 'terminals', `${id}.txt`), 'utf8').catch(() => '');
      if (m.parseShellTerminalFooter(output).isComplete) return output;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('terminal did not complete');
  };
  return { dir, box, start, running, terminal, kills, commands, contexts, workingDirectories, useLegacyDaemon: () => { discardPrivacyFlag = true; } };
}

test('proto field16 survives the real binary roundtrip', async () => {
  const args = new m.BackgroundShellSpawnArgs({ suppressStdinLogging: true });
  assert.equal(Buffer.from(args.toBinary()).toString('hex'), '800101');
  assert.equal(m.BackgroundShellSpawnArgs.fromBinary(args.toBinary()).suppressStdinLogging, true);
  assert.equal(new m.BackgroundShellSpawnArgs().suppressStdinLogging, false);
  await record('proto-field16', { wireHex: '800101', roundtrip: true, defaultFalse: true });
});
for (const protectedInput of [true, false]) test(`FileLoggingShellFactory real process stdin suppression=${protectedInput}`, async t => {
  const h = await harness(t);
  const started = await h.start(m.createContext(), new m.BackgroundShellSpawnArgs({ command: readCommand, enableWriteShellStdinTool: true, suppressStdinLogging: protectedInput }));
  const id = started.result.value.shellId;
  const value = protectedInput ? 'synthetic-private-input' : 'nonsecret-control-input';
  h.running.get(id).stdin.write(`${value}\n`);
  const output = await h.terminal(id);
  assert.equal(output.includes('received'), true);
  assert.equal(output.includes(value), !protectedInput);
  assert.equal(output.includes('[stdin]'), !protectedInput);
  await record(`logger-${protectedInput ? 'protected' : 'ordinary'}`, { processReceived: true, valueLogged: !protectedInput, stdinMarkerLogged: !protectedInput, exitCode: m.parseShellTerminalFooter(output).exitCode });
});
test('canary admits protected daemon and secret data never enters command or terminal', async t => {
  const h = await harness(t);
  const context = m.createContext();
  const adapter = await m.createReviewPrivateBox({ agentId: 'a', box: h.box, context });
  assert.ok(adapter);
  const result = await adapter.spawn({ command: readCommand, suppressStdinLogging: true, signal: new AbortController().signal });
  assert.equal(result.stdinLoggingSuppressed, true);
  await adapter.writeStdin(result.shellId, 'synthetic-private-input\n');
  const output = await h.terminal(result.shellId);
  assert.equal(output.includes('received'), true);
  assert.equal(output.includes('synthetic-private-input'), false);
  assert.equal(h.commands.join('\n').includes('synthetic-private-input'), false);
  assert.equal(h.workingDirectories.every(dir => dir === '/workspace'), true);
  await adapter.terminate(result.shellId);
  assert.equal(h.kills.length, 0);
  assert.equal(h.contexts.every(ctx => ctx !== context), true);
  await record('adapter-protected', { canaries: h.commands.filter(command => command.includes('__PRIVATE_STDIN_CANARY__')).length, stdinLoggingSuppressed: result.stdinLoggingSuppressed, secretInCommand: false, secretInTerminal: false, finishedPidNotKilled: true, freshContexts: true });
});
test('canary refuses a legacy daemon that discards the flag', async t => {
  const h = await harness(t, true);
  const adapter = await m.createReviewPrivateBox({ agentId: 'a', box: h.box, context: m.createContext() });
  assert.equal(adapter, undefined);
  assert.equal(h.commands.length, 1);
  await record('adapter-legacy', { refused: true, secretProcessStarted: false });
});
test('spawn rechecks capability after daemon support changes', async t => {
  const h = await harness(t);
  const adapter = await m.createReviewPrivateBox({ agentId: 'a', box: h.box, context: m.createContext() });
  assert.ok(adapter);
  h.useLegacyDaemon();
  await assert.rejects(adapter.spawn({ command: readCommand, suppressStdinLogging: true, signal: new AbortController().signal }), { code: 'unsupported_stdin_privacy' });
  assert.equal(h.commands.every(command => command.includes('__PRIVATE_STDIN_CANARY__')), true);
  await record('adapter-capability-change', { initialProbePassed: true, changedDaemonRefused: true, secretProcessStarted: false });
});
test('canceled caller never starts a private process', async t => {
  const h = await harness(t);
  const [context, cancel] = m.createContext().withCancel();
  cancel();
  assert.equal(await m.createReviewPrivateBox({ agentId: 'a', box: h.box, context }), undefined);
  assert.equal(h.commands.length, 0);
  await record('adapter-canceled-caller', { refused: true, processCount: 0 });
});
test('abort terminates only the owned positive pid with a fresh cleanup context', async t => {
  const h = await harness(t);
  const adapter = await m.createReviewPrivateBox({ agentId: 'a', box: h.box, context: m.createContext() });
  assert.ok(adapter);
  const controller = new AbortController();
  const result = await adapter.spawn({ command: readCommand, suppressStdinLogging: true, signal: controller.signal });
  const pid = h.running.get(result.shellId).pid;
  controller.abort();
  for (let i = 0; i < 100 && h.kills.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(h.kills, [pid]);
  await adapter.terminate(99999999);
  assert.deepEqual(h.kills, [pid]);
  await assert.rejects(adapter.writeStdin(result.shellId, 'never-sent'), { code: 'unknown_shell' });
  await record('adapter-abort', { killedOwnPid: true, foreignShellIgnored: true, subsequentWriteRefused: true });
});
