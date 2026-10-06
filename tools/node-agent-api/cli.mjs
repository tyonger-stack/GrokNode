#!/usr/bin/env node
import path from 'node:path';
import { startNodeAgentApi } from './server.mjs';
import { createGrokNodeAdapter } from './grok-node.mjs';
import { createCodexAdapter } from './codex.mjs';
import { createHarness } from './runtime/harness.mjs';
import { recoverServiceLocks } from './persistence.mjs';
import { createSharedRuntime } from './shared-runtime.mjs';

const flags = process.argv.slice(2), options = {};
for (let i = 0; i < flags.length; i += 2) {
  const name = flags[i];
  if (!['--port','--state','--container','--allow-writes','--backend','--runtime-state','--namespace','--model','--base-url','--recover','--workspace'].includes(name) || flags[i + 1] === undefined || Object.hasOwn(options, name)) throw new Error('Usage: cli.mjs [--backend codex|grok] [--container NAME] [--workspace LINUX_PATH] [--port PORT] [--state DIRECTORY] [--recover true|false]');
  options[name] = flags[i + 1];
}
const port = Number(options['--port'] ?? 18770);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
if (options['--allow-writes'] !== undefined && !['true','false'].includes(options['--allow-writes'])) throw new Error('Invalid write policy');
const root = path.resolve(import.meta.dirname, '../..'), stateDirectory = path.resolve(options['--state'] ?? path.join(root, '.lab/node-agent-shared'));
if (options['--recover'] === 'true') await recoverServiceLocks(stateDirectory);
const backend = options['--backend'] ?? 'codex';
let adapter;
if (backend === 'grok') adapter = createGrokNodeAdapter({ container: options['--container'] ?? 'grok-node-local-vm', allowWrites: options['--allow-writes'] === 'true' });
else if (backend === 'codex') {
  const namespace = options['--namespace'] ?? 'grok-node-lab-shared', stateRoot = path.resolve(options['--runtime-state'] ?? path.join(root, '.lab/shared-runtime'));
  const runtime = await createSharedRuntime({ container: options['--container'] ?? 'grok-node-local-vm', stateRoot, namespace, workspaceRoot: options['--workspace'] });
  const roster = { ...runtime.roster,
    async agents() { return (await runtime.roster.agents()).map(row => ({ ...row, backend: 'codex_harness' })); },
    async createAgent(input) { const result = await runtime.roster.gateway('createAgent', { name: input.name, description: input.description ?? '', origin: 'user', isKickstartRequested: false, isIntroductionSuppressed: true }); const row = result.agent ?? result; if (typeof row.id !== 'string') throw new Error('GrokNode did not return a bot identifier'); return { object: 'node.agent', id: row.id, name: row.name, description: row.description ?? '', backend: 'codex_harness' }; },
  };
  const harness = createHarness({ runtime, namespace, stateRoot, model: options['--model'], baseUrl: options['--base-url'] });
  adapter = createCodexAdapter({ runtime, harness, roster, namespace, stateRoot, artifactRoot: path.join(stateDirectory, 'artifacts') });
} else throw new Error('Unknown backend');
const service = await startNodeAgentApi({ adapter, stateDirectory, port });
console.log(JSON.stringify({ service: 'Node Agent API', version: '0.3.0', backend, origin: service.origin, ui: service.origin + '/ui/', owner_key_file: service.keyFile, writes_enabled: adapter.writesEnabled }));
async function stop() { await service.close(); process.exit(0); }
process.once('SIGTERM', () => { void stop(); }); process.once('SIGINT', () => { void stop(); });
