import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const outfile = path.join(repoRoot, 'node_modules', '.cache', 'vnc-preload-input-gate.cjs');
await build({
  entryPoints: [path.join(repoRoot, 'source/electron-preload/preload-vnc.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  logLevel: 'error',
  external: ['node:*', 'electron'],
});
const channelsOut = path.join(repoRoot, 'node_modules', '.cache', 'vnc-shared-channels.cjs');
await build({
  stdin: {
    contents: [
      'export * from "' + path.join(repoRoot, 'source/electron-preload/preload-vnc.ts') + '";',
      'export { VNC_ACCEPTS_INPUT_CHANNEL } from "' + path.join(repoRoot, 'source/shared/vnc-control-input.ts') + '";',
      'export { VNC_INTERACTIVE_CHANNEL } from "' + path.join(repoRoot, 'source/shared/vnc-interactive.ts') + '";',
    ].join('\n'),
    resolveDir: repoRoot,
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: channelsOut,
  logLevel: 'error',
});
const { createVncInputSwitch, installVncInputGate } = require(outfile);
const { VNC_ACCEPTS_INPUT_CHANNEL, VNC_INTERACTIVE_CHANNEL } = require(channelsOut);

function fakeIpc() {
  const listeners = new Map();
  return {
    listeners,
    on(channel, listener) {
      const list = listeners.get(channel) ?? [];
      list.push(listener);
      listeners.set(channel, list);
    },
    emit(channel, payload) {
      for (const listener of listeners.get(channel) ?? []) listener({}, payload);
    },
  };
}

function fakeWindow() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    emit(type) {
      for (const listener of listeners.get(type) ?? []) listener({ type });
    },
  };
}

test('input only flows when the page is interactive and control was taken', () => {
  const inputSwitch = createVncInputSwitch(true, false);
  assert.equal(inputSwitch.canInput(), false, 'view-only never forwards input');
  inputSwitch.setAcceptsInput(true);
  assert.equal(inputSwitch.canInput(), true);
  inputSwitch.setInteractive(false);
  assert.equal(inputSwitch.canInput(), false, 'a non-interactive page stays blocked even with control taken');
  inputSwitch.setInteractive(true);
  assert.equal(inputSwitch.canInput(), true);
});

test('acceptsInput defaults to view-only', () => {
  assert.equal(createVncInputSwitch().acceptsInput(), false);
});

test('gate listens on both channels, ignores non-boolean payloads and reports changes', () => {
  const ipc = fakeIpc();
  const inputSwitch = createVncInputSwitch(true, false);
  const changes = [];
  installVncInputGate({
    ipc,
    window: null,
    onAcceptsInput: (value) => inputSwitch.setAcceptsInput(value),
    onInteractive: (value) => inputSwitch.setInteractive(value),
    onGateChange: () => changes.push(inputSwitch.canInput()),
  });
  ipc.emit(VNC_ACCEPTS_INPUT_CHANNEL, 'true');
  ipc.emit(VNC_INTERACTIVE_CHANNEL, 1);
  assert.equal(changes.length, 0, 'non-boolean payloads are ignored');
  ipc.emit(VNC_ACCEPTS_INPUT_CHANNEL, true);
  assert.deepEqual(changes, [true]);
  ipc.emit(VNC_INTERACTIVE_CHANNEL, false);
  assert.deepEqual(changes, [true, false]);
  ipc.emit(VNC_ACCEPTS_INPUT_CHANNEL, false);
  assert.deepEqual(changes, [true, false, false]);
});

test('pagehide fails both gates closed', () => {
  const ipc = fakeIpc();
  const windowPort = fakeWindow();
  const inputSwitch = createVncInputSwitch(true, true);
  installVncInputGate({
    ipc,
    window: windowPort,
    onAcceptsInput: (value) => inputSwitch.setAcceptsInput(value),
    onInteractive: (value) => inputSwitch.setInteractive(value),
  });
  assert.equal(inputSwitch.canInput(), true);
  windowPort.emit('pagehide');
  assert.equal(inputSwitch.canInput(), false);
  assert.equal(inputSwitch.isInteractive(), false);
  assert.equal(inputSwitch.acceptsInput(), false);
});
