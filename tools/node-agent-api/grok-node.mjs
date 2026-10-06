import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ApiError, identifier } from './errors.mjs';
import { OWNER, BOT, resourceNames } from './runtime/common.mjs';

const run = promisify(execFile);
const METHODS = new Set(['listAgents', 'getForeverBoxStatus', 'ensureForeverBox', 'getAgentTranscript', 'sendPrompt', 'createAgent', 'promptAcceptanceStatus']);
const gatewayProgram = String.raw`
const fs=require('node:fs');
const g=JSON.parse(fs.readFileSync('/home/box/sand-data/gateway.json','utf8'));
const token=g.token??g.authToken;
if(!token)throw new Error('Gateway authentication unavailable');
(async()=>{const method=process.argv[1],body=process.argv[2];const response=await fetch('http://127.0.0.1:1340/api/'+method,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body,signal:AbortSignal.timeout(20000)});if(!response.ok){console.log(JSON.stringify({node_api_upstream_error:response.status}));process.exitCode=1;return}console.log(JSON.stringify(await response.json()))})().catch(()=>{console.error('Gateway unavailable');process.exitCode=1});`;

export function createGrokNodeAdapter({ container = 'grok-node-local-vm', allowWrites = false, execute = run } = {}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container)) throw new Error('Invalid container name');
  if (allowWrites && !container.startsWith('grok-node-lab-')) throw new Error('Writes require an experimental GrokNode container');
  async function writeGuard(botId) {
    if (!allowWrites) throw new ApiError(403, 'writes_disabled', 'Writes are enabled only for an experimental GrokNode backend');
    let info;
    try { info = JSON.parse((await execute('docker', ['inspect', container], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })).stdout)[0]; }
    catch { throw new ApiError(502, 'upstream_unavailable', 'Experimental container ownership unavailable'); }
    const labels = info?.Config?.Labels ?? {}, namespace = labels[OWNER];
    try { resourceNames(namespace, 'validate'); } catch { throw new ApiError(403, 'unsafe_backend', 'Experimental namespace label required'); }
    if (info.Name !== '/' + container || !container.startsWith(namespace + '-') || !Array.isArray(info.Mounts) || info.Mounts.some(mount => mount.Type === 'bind' || mount.Destination === '/root/.codex') || (botId && labels[BOT] && labels[BOT] !== botId)) throw new ApiError(403, 'unsafe_backend', 'Container ownership or mount isolation check failed');
  }
  async function call(method, args = {}) {
    if (!METHODS.has(method)) throw new Error('Unsupported gateway method');
    try {
      const result = await execute('docker', ['exec', container, 'node', '-e', gatewayProgram, '--', method, JSON.stringify(args)], { timeout: 25000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      return JSON.parse(result.stdout);
    } catch { throw new ApiError(502, 'upstream_unavailable', 'GrokNode gateway unavailable; outcome may be unknown'); }
  }
  async function agents() {
    const rows = await call('listAgents');
    if (!Array.isArray(rows)) throw new ApiError(502, 'upstream_schema', 'Unexpected GrokNode roster');
    return rows.filter(a => typeof a.id === 'string').map(a => ({ object: 'node.agent', id: a.id, name: String(a.name ?? a.id), description: String(a.description ?? ''), backend: 'grok_node' }));
  }
  async function requireAgent(id) { identifier(id); const agent = (await agents()).find(a => a.id === id); if (!agent) throw new ApiError(404, 'not_found', 'Bot not found'); return agent; }
  async function desktop(id) {
    await requireAgent(id);
    const status = await call('getForeverBoxStatus', { id });
    if (status.state !== 'running' || !status.vncUrl) throw new ApiError(409, 'desktop_unavailable', 'Bot desktop is not running');
    const url = new URL(status.vncUrl);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:' || !['6080','6081'].includes(url.port)) throw new ApiError(502, 'upstream_schema', 'Unsupported desktop endpoint');
    const embedded = url.searchParams.get('path') ?? '';
    const query = embedded.indexOf('?');
    const display = query < 0 ? '1' : new URLSearchParams(embedded.slice(query + 1)).get('token');
    if (!display || !/^[1-9][0-9]{0,2}$/.test(display)) throw new ApiError(502, 'upstream_schema', 'Invalid desktop display');
    return { object: 'node.environment', id: 'nenv_' + id, agent_id: id, type: 'grok_node', isolation: 'shared_container_separate_display', container, display: Number(display), websocketUrl: `ws://127.0.0.1:${url.port}/websockify${url.port === '6081' ? '?token=' + display : ''}` };
  }
  return {
    agents, requireAgent, desktop, writesEnabled: allowWrites,
    // Internal bridge to existing authenticated GrokNode APIs. REST routes
    // remain explicit; callers cannot select arbitrary gateway methods.
    gateway: call,
    async items(id) { await requireAgent(id); const rows = await call('getAgentTranscript', { id }); return Array.isArray(rows) ? rows : rows.entries ?? []; },
    async input(id, text, requestId) { await writeGuard(id); await requireAgent(id); return call('sendPrompt', { agentId: id, prompt: text, clientNonce: requestId }); },
    async createAgent(input) { await writeGuard(); return call('createAgent', { name: input.name, description: input.description ?? '', origin: 'user', isKickstartRequested: false, isIntroductionSuppressed: true }); },
    async viewerAsset(asset) {
      if (!/^(vnc\.html|(?:app|core|vendor)\/[A-Za-z0-9_./-]+|(?:defaults|mandatory)\.json)$/.test(asset) || asset.split('/').includes('..')) throw new ApiError(404, 'not_found', 'Asset not found');
      try { const result = await execute('docker', ['exec', container, 'cat', '/usr/share/novnc/' + asset], { encoding: null, timeout: 10000, maxBuffer: 4 * 1024 * 1024 }); return result.stdout; }
      catch { throw new ApiError(404, 'not_found', 'Asset unavailable'); }
    },
  };
}
