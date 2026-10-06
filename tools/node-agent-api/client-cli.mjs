#!/usr/bin/env node
import { resolve } from 'node:path';
import { launchCodex } from './runtime/codex.mjs';
import { readFile } from 'node:fs/promises';
import { createSharedRuntime } from './shared-runtime.mjs';

const [command, botId, ...args] = process.argv.slice(2);
const allowed = new Set(['namespace', 'state-root', 'codex-bin', 'model', 'base-url', 'prompt', 'thread', 'api-origin', 'api-key-file', 'application', 'mode', 'session', 'container', 'workspace']);
let runtime;
try {
  if (!['ensure', 'status', 'desktop', 'codex', 'resume', 'backup', 'recreate'].includes(command) || !botId) throw new Error('Usage: client-cli.mjs ensure|status|desktop|codex|resume|backup|recreate BOT_ID [--thread THREAD_ID] [--container NAME] [--workspace LINUX_PATH] [--state-root PATH] [--api-key-file FILE]');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || !allowed.has(key) || args[i + 1] === undefined || key in options) throw new Error('Invalid CLI option');
    options[key] = args[i + 1];
  }
  const namespace = options.namespace ?? 'grok-node-lab-shared';
  const root = resolve(import.meta.dirname, '../..'), stateRoot = resolve(options['state-root'] ?? `${root}/.lab/shared-runtime`);
  runtime = await createSharedRuntime({ namespace, stateRoot, container: options.container, workspaceRoot: options.workspace });
  const roster = runtime.roster;
  await roster.requireAgent(botId);
  if (command === 'codex' || command === 'resume') {
    if (command === 'resume' && !/^[\w-]{1,128}$/.test(options.thread ?? '')) throw new Error('resume requires a valid --thread');
    process.exitCode = await launchCodex({ namespace, botId, stateRoot, runtime, codexBinary: options['codex-bin'], model: options.model, baseUrl: options['base-url'], threadId: command === 'resume' ? options.thread : undefined }, options.prompt);
  } else if (command === 'desktop') {
    const origin = options['api-origin'] ?? 'http://127.0.0.1:18770';
    if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Local API origin required');
    const key = (await readFile(resolve(options['api-key-file'] ?? `${root}/.lab/node-agent-shared/owner.key`), 'utf8')).trim();
    async function post(route, body) { const r = await fetch(origin + route, { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error('Authenticated desktop request failed'); return r.json(); }
    const mode = options.mode ?? 'view';
    if (!['view', 'control'].includes(mode)) throw new Error('Desktop mode must be view or control');
    let session;
    if (options.session) {
      if (!/^[\w-]{1,128}$/.test(options.session)) throw new Error('Invalid session identifier');
      const response = await fetch(`${origin}/v1/agents/sessions/${options.session}`, { headers: { authorization: 'Bearer ' + key } });
      if (!response.ok) throw new Error('Authenticated session request failed');
      session = await response.json();
      if (session.agent_id !== botId) throw new Error('Session belongs to another bot');
    } else session = await post('/v1/agents/sessions', { agent_id: botId });
    const target = options.application ? { type: 'application', application_id: options.application } : { type: 'desktop' };
    const desktop = await post(`/v1/agents/sessions/${session.id}/desktop`, { mode, target });
    console.log(JSON.stringify({ botId, session_id: session.id, mode, target, desktopUrl: desktop.url, expires_at: desktop.expires_at }));
  } else {
    console.log(JSON.stringify(await runtime[command](botId)));
  }
} catch (error) {
  // Never print subprocess argv or token-bearing registry objects.
  console.error(error?.cmd ? 'Codex command failed' : error.message);
  process.exitCode = 1;
} finally { await runtime?.close?.(); }
