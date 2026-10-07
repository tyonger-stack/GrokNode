#!/usr/bin/env node
import { createInterface } from 'node:readline';

if (process.argv.includes('--version')) {
  console.log('codex-cli 0.160.0');
} else {
  let thread = 0, turn = 0;
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  createInterface({ input: process.stdin }).on('line', line => {
    const message = JSON.parse(line);
    if (!message.id) return;
    let result = {};
    if (message.method === 'thread/start') result = { thread: { id: 'bench-thread-' + ++thread } };
    if (message.method === 'thread/resume') result = { thread: { id: message.params.threadId } };
    if (message.method === 'thread/read') result = { thread: { turns: [] } };
    if (message.method === 'turn/start') result = { turn: { id: 'bench-turn-' + ++turn, status: 'inProgress' } };
    if (message.method === 'bench/notify') { send(message.params); return; }
    if (message.method === process.env.BENCH_STALL_METHOD) return;
    setTimeout(() => send({ id: message.id, result }), message.method === 'turn/start' ? Number(process.env.BENCH_HARNESS_DELAY_MS || 0) : 0);
  });
}
