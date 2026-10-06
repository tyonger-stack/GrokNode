import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { EventEmitter } from 'node:events';
import { prepareCodex } from './codex.mjs';

export const RPC_METHODS = new Set(['environment/info', 'thread/start', 'thread/list', 'thread/read', 'thread/resume', 'thread/unsubscribe', 'thread/backgroundTerminals/terminate', 'turn/start', 'turn/interrupt']);
const environments = [{ environmentId: 'bot', cwd: '/workspace', runtimeWorkspaceRoots: ['/workspace'] }];
const approvedShellTool = { type: 'function', name: 'node_approved_shell', description: 'Execute a shell command in this bot Linux workspace only after explicit user approval. A declined request performs no command.', inputSchema: { type: 'object', additionalProperties: false, required: ['command'], properties: { command: { type: 'string', minLength: 1, maxLength: 8192 } } }, deferLoading: false };
export function validateBotId(id) {
  if (typeof id !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,127}$/u.test(id)) throw new Error('Invalid botId');
  return id;
}
export function rpcParams(method, params = {}, workspaceRoot = '/workspace') {
  if (!RPC_METHODS.has(method)) throw new Error('RPC method unavailable');
  const fields = {
    'environment/info': [], 'thread/start': [], 'thread/list': ['cursor'],
    'thread/read': ['threadId'], 'thread/resume': ['threadId'], 'thread/unsubscribe': ['threadId'],
    'thread/backgroundTerminals/terminate': ['threadId', 'processId'],
    'turn/start': ['threadId', 'input'], 'turn/interrupt': ['threadId', 'turnId'],
  }[method];
  if (!params || Array.isArray(params) || typeof params !== 'object' || Object.keys(params).some(k => !fields.includes(k))) throw new Error('Invalid RPC parameters');
  for (const key of fields.filter(k => k.endsWith('Id'))) if (typeof params[key] !== 'string' || !/^[\w-]{1,128}$/.test(params[key])) throw new Error('Invalid RPC identifier');
  if (params.cursor != null && (typeof params.cursor !== 'string' || params.cursor.length > 2048)) throw new Error('Invalid cursor');
  if (method === 'thread/backgroundTerminals/terminate' && !/^[0-9]{1,10}$/.test(params.processId)) throw new Error('Invalid process identifier');
  if (method === 'turn/start' && (!Array.isArray(params.input) || params.input.length !== 1 || params.input[0]?.type !== 'text' || typeof params.input[0].text !== 'string' || !params.input[0].text.trim() || params.input[0].text.length > 64000 || Object.keys(params.input[0]).some(k => !['type', 'text'].includes(k)))) throw new Error('Invalid text input');
  if (method === 'environment/info') return { environmentId: 'bot' };
  if (method === 'thread/start' || method === 'turn/start') return { ...params, environments: workspaceRoot === '/workspace' ? environments : [{ environmentId: 'bot', cwd: workspaceRoot, runtimeWorkspaceRoots: [workspaceRoot] }], ...(method === 'thread/start' ? { experimentalRawEvents: false, dynamicTools: [approvedShellTool] } : {}) };
  if (method === 'thread/read') return { ...params, includeTurns: true };
  if (method === 'thread/list') return { ...params, limit: 50 };
  return params;
}

export function createHarness({ runtime, namespace, stateRoot, model, baseUrl, binary = 'codex', spawnProcess = spawn, timeoutMs = 60000 }) {
  const events = new EventEmitter();
  const sessions = new Map();
  const secrets = new Set();
  function redact(value) {
    if (typeof value === 'string') {
      for (const secret of secrets) value = value.split(secret).join('[redacted]');
      return value.replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer [redacted]');
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, /^(?:authorization|authToken|accessToken|apiKey|secret|bearerToken)$/i.test(k) ? '[redacted]' : redact(v)]));
    return value;
  }
  async function connect(botId) {
    validateBotId(botId);
    if (sessions.has(botId)) return sessions.get(botId);
    const pending = start(botId);
    sessions.set(botId, pending);
    try { return await pending; } catch (error) { sessions.delete(botId); throw error; }
  }
  async function start(botId) {
    await runtime.ensure(botId);
    const registry = await runtime.descriptor(botId), status = await runtime.status(botId);
    const entry = registry.environments[0];
    if (entry.transport === 'stdio') {
      if (!isAbsolute(entry.program) || !Array.isArray(entry.args) || !entry.args.includes('exec-server') || !entry.args.includes('stdio') || !entry.args.includes('--no-new-privs')) throw new Error('Managed container stdio executor required');
    } else {
      const url = new URL(status.execServerUrl);
      if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('Owned loopback executor required');
      secrets.add(entry.authToken);
    }
    const command = await prepareCodex({ runtime, namespace, stateRoot, botId, codexBinary: binary, model, baseUrl });
    if (!isAbsolute(command.cwd)) throw new Error('Private Harness home unavailable');
    const child = spawnProcess(binary, ['app-server', '--strict-config', '-c', 'mcp_servers={}', '-c', 'features.apps=false', '-c', 'features.plugins=false'], { cwd: command.cwd, env: command.env, stdio: ['pipe','pipe','pipe'] });
    const calls = new Map(), approvals = new Map();
    let seq = 0, buffer = '', closed = false, diagnostic = '';
    const emit = message => events.emit('event', { botId, message: redact(message) });
    function stop() {
      if (closed) return;
      closed = true;
      for (const call of calls.values()) { clearTimeout(call.timer); call.reject(new Error('Harness disconnected; outcome unknown; no replay. ' + diagnostic)); }
      calls.clear(); approvals.clear(); sessions.delete(botId);
      emit({ method: 'lab/status', params: { status: 'unknown', replayed: false } });
    }
    child.on('error', stop); child.on('exit', stop);
    child.stderr.on('data', bytes => { diagnostic = redact((diagnostic + bytes.toString()).slice(-4096)); });
    function send(message) { if (closed) throw new Error('Harness disconnected'); child.stdin.write(JSON.stringify(message) + '\n'); }
    function request(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => { calls.delete(id); reject(new Error('RPC timeout; outcome unknown; no replay')); }, timeoutMs);
        calls.set(id, { resolve, reject, timer });
        try { send({ id, method, params }); } catch (error) { clearTimeout(timer); calls.delete(id); reject(error); }
      });
    }
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 8 * 1024 * 1024) { child.kill(); stop(); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let m;
        try { m = JSON.parse(line); } catch { child.kill(); stop(); return; }
        if (m.method) {
          if (m.id != null) approvals.set(m.id, m);
          emit(m);
        } else if (calls.has(m.id)) {
          const call = calls.get(m.id); calls.delete(m.id); clearTimeout(call.timer);
          if (m.error) call.reject(new Error(`RPC rejected (${m.error.code ?? 'unknown'}): ${redact(m.error.message ?? '')}`)); else call.resolve(redact(m.result));
        }
      }
    });
    try {
      await request('initialize', { clientInfo: { name: 'grok-node-agent-api', version: '0.3.0' }, capabilities: { experimentalApi: true } });
      send({ method: 'initialized' });
      await request('environment/info', { environmentId: 'bot' });
    } catch (error) { child.kill(); stop(); throw error; }
    return { request, approvals, send, child, codexHome: command.cwd };
  }
  return {
    redact,
    subscribe(listener) { events.on('event', listener); return () => events.off('event', listener); },
    async request(botId, method, params) { const safe = rpcParams(method, params, runtime.workspaceRoot ?? '/workspace'); return (await connect(botId)).request(method, safe); },
    async answer(botId, id, result) {
      const s = await connect(botId), approval = s.approvals.get(id);
      if (!approval) throw new Error('Approval no longer pending');
      const method = approval.method;
      if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/call'].includes(method)) throw new Error('Approval type unavailable');
      if (method === 'item/tool/call') { if (!Array.isArray(result?.contentItems) || typeof result.success !== 'boolean') throw new Error('Invalid tool response'); }
      else if (!result || Object.keys(result).length !== 1 || !['accept','decline','cancel'].includes(result.decision)) throw new Error('Invalid approval answer');
      s.send({ id, result }); s.approvals.delete(id);
      events.emit('event', { botId, message: { method: 'lab/approvalAnswered', params: { id, result } } });
      return { answered: true };
    },
    async pending(botId) { const s = await connect(botId); return [...s.approvals.values()].map(redact); },
    async home(botId) { return (await connect(botId)).codexHome; },
    async disconnect(botId) { const current = sessions.get(botId); if (current) { const value = await current; const exited = new Promise(resolve => value.child.once('exit', resolve)); value.child.kill(); await exited; if (sessions.get(botId) === current) sessions.delete(botId); } },
    async close() { for (const p of sessions.values()) { try { (await p).child.kill(); } catch {} } sessions.clear(); },
  };
}
