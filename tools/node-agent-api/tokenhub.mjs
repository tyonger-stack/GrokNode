import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, open, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { ApiError, badRequest, object } from './errors.mjs';
import { atomicJson, readPrivateJson } from './persistence.mjs';
import { modelId } from './models.mjs';
import { isBuiltinRevision } from './inference-config.mjs';
import { privateDirectory } from './runtime/common.mjs';

export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export function endpointUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw badRequest('Invalid model API URL'); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)))) throw badRequest('Use HTTPS or a local HTTP model API, without credentials or query parameters');
  if (['169.254.169.254', 'metadata.google.internal'].includes(url.hostname)) throw badRequest('Metadata endpoints are not model APIs');
  return url.href.replace(/\/+$/, '');
}

// 已保存的内置直连地址。活动 revision 不是内置 id，或还没有地址时返回 null。
export async function savedDirectBaseUrl(directory) {
  const state = await readPrivateJson(join(directory, 'tokenhub.json'), null);
  if (!state || !Array.isArray(state.revisions)) return null;
  const row = state.revisions.find(item => item.id === state.active);
  if (!row || !isBuiltinRevision(row.id) || typeof row.base_url !== 'string' || !row.base_url) return null;
  return row.base_url;
}

export async function createTokenHub(directory, { baseUrl = null, apiKey = null, wireApi = null, models = [], fetcher = fetch, nodeBinary = process.execPath } = {}) {
  await privateDirectory(directory);
  const file = join(directory, 'tokenhub.json'), keyFile = join(directory, 'tokenhub.master.key');
  let master;
  try { const handle = await open(keyFile, constants.O_RDONLY | constants.O_NOFOLLOW); try { if (!(await handle.stat()).isFile()) throw new Error('Unsafe TokenHub key file'); master = await handle.readFile(); } finally { await handle.close(); } await chmod(keyFile, 0o600); }
  catch (error) { if (error.code !== 'ENOENT') throw error; master = randomBytes(32); await writeFile(keyFile, master, { flag: 'wx', mode: 0o600 }); }
  if (master.length !== 32) throw new Error('Invalid TokenHub storage key');
  function encrypt(value) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', master, iv), data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }; }
  function decrypt(value) { if (!value) return ''; const decipher = createDecipheriv('aes-256-gcm', master, Buffer.from(value.iv, 'base64')); decipher.setAuthTag(Buffer.from(value.tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8'); }
  if (baseUrl) baseUrl = endpointUrl(baseUrl);
  if (apiKey != null && String(apiKey).trim()) {
    if (typeof apiKey !== 'string' || apiKey.length > 8192 || /[\r\n]/.test(apiKey)) throw new Error('Invalid API key');
    apiKey = apiKey.trim();
  } else apiKey = null;
  if (wireApi != null && wireApi !== 'chat' && wireApi !== 'responses') throw new Error('Invalid model API protocol');
  const listed = (Array.isArray(models) ? models : []).map(id => ({ id: modelId(id), name: id, reasoning_efforts: [] }));
  if (new Set(listed.map(row => row.id)).size !== listed.length) throw badRequest('Duplicate model identifiers');
  // 无密钥的 Responses 直连不启桥，Codex 自己说 Responses。有密钥或 Chat 协议才启本地 Node 桥，密钥留在 Mac。
  function freshRevision() {
    if (!baseUrl) return { id: 'unconfigured', base_url: null, wire_api: 'chat', key: null, models: listed, tests: [] };
    const wire = wireApi ?? (apiKey ? 'chat' : 'responses');
    if (!apiKey && wire === 'responses') return { id: 'direct', base_url: baseUrl, wire_api: 'responses', key: null, models: listed, tests: [] };
    return { id: 'th_' + randomBytes(12).toString('hex'), base_url: baseUrl, wire_api: wire, key: apiKey ? encrypt(apiKey) : null, models: listed, tests: [] };
  }
  let state = await readPrivateJson(file, null), dirty = false;
  if (!state) {
    const row = freshRevision();
    state = { active: row.id, revisions: [row] };
    dirty = true;
  }
  if (!Array.isArray(state.revisions) || !state.revisions.some(row => row.id === state.active)) throw new Error('Invalid TokenHub state');
  for (const row of state.revisions) {
    if (row.base_url != null && row.base_url !== '') endpointUrl(row.base_url);
    else row.base_url = null;
    if (!['chat', 'responses'].includes(row.wire_api)) throw new Error('Invalid TokenHub protocol');
    decrypt(row.key);
    if (!Array.isArray(row.models) || !Array.isArray(row.tests)) throw new Error('Invalid TokenHub state');
  }
  if (!dirty && baseUrl) {
    const row = state.revisions.find(item => item.id === state.active);
    // 只在活动 revision 仍是内置直连时跟随本次启动参数。已经 PATCH 出的 th_* 版本保持不变。
    if (row && isBuiltinRevision(row.id)) {
      const wantsBridge = !!apiKey || wireApi === 'chat';
      if (row.id === 'unconfigured' || wantsBridge) {
        const next = freshRevision();
        state.revisions.push(next); state.active = next.id; dirty = true;
      } else if (row.base_url !== baseUrl) {
        row.base_url = baseUrl; row.wire_api = 'responses'; row.key = null; row.models = []; row.tests = []; dirty = true;
      }
    }
  }
  if (dirty) await atomicJson(file, state);
  let saving = Promise.resolve(), fault, worker;
  const bridgeToken = randomBytes(32).toString('base64url');
  const current = () => { if (fault) throw fault; return state.revisions.find(row => row.id === state.active); };
  const publicSettings = row => ({ object: 'node.tokenhub', revision: row.id, base_url: row.base_url ?? '', wire_api: row.wire_api, key_saved: !!row.key, models: row.models, tests: row.tests });
  function redact(error) { let message = String(error?.message ?? error); for (const row of state.revisions) { const key = decrypt(row.key); if (key) message = message.split(key).join('[redacted]'); } return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 600); }
  function mutate(operation) {
    const task = saving.then(async () => {
      if (fault) throw fault;
      const next = structuredClone(state), result = await operation(next);
      try { await atomicJson(file, next); } catch { fault = new ApiError(503, 'tokenhub_persistence_failed', 'TokenHub settings could not be saved'); throw fault; }
      state = next; if (worker) worker.child.stdin.write(JSON.stringify({ revisions: state.revisions.map(row => ({ ...row, api_key: decrypt(row.key), key: undefined })) }) + '\n');
      return result;
    }); saving = task.catch(() => {}); return task;
  }
  async function request(row, suffix, body, signal) {
    const key = decrypt(row.key), headers = { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) };
    let res;
    try { res = await fetcher(row.base_url + suffix, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000) }); }
    catch (error) { throw new ApiError(502, 'model_endpoint_unavailable', 'Model API request failed: ' + redact(error)); }
    if (!res.ok) throw new ApiError(502, 'model_endpoint_rejected', 'Model API returned HTTP ' + res.status);
    const chunks = []; let bytes = 0;
    for await (const chunk of res.body) { bytes += chunk.byteLength; if (bytes > 2 * 1024 * 1024) throw new ApiError(502, 'model_endpoint_schema', 'Model API response exceeds limit'); chunks.push(Buffer.from(chunk)); }
    const text = Buffer.concat(chunks).toString('utf8');
    try { return JSON.parse(text); } catch { throw new ApiError(502, 'model_endpoint_schema', 'Model API returned invalid JSON'); }
  }
  function requireEndpoint(row) {
    if (!row.base_url) throw new ApiError(409, 'endpoint_unconfigured', 'Configure a model API URL before calling the endpoint');
  }
  async function bridge() {
    if (worker) return worker.ready;
    const child = spawn(nodeBinary, [join(import.meta.dirname, 'tokenhub-worker.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: directory } });
    let buffer = '', settled = false;
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new ApiError(503, 'tokenhub_bridge_unavailable', 'TokenHub protocol adapter did not start')); }, 10000);
      child.once('error', () => { clearTimeout(timer); worker = undefined; reject(new ApiError(503, 'tokenhub_bridge_unavailable', 'TokenHub protocol adapter could not be started')); });
      child.stdout.on('data', data => { buffer += data; const end = buffer.indexOf('\n'); if (end < 0 || settled) return; settled = true; clearTimeout(timer); try { const value = JSON.parse(buffer.slice(0, end)); if (!value.port) throw new Error(); resolve(value.port); } catch { reject(new ApiError(503, 'tokenhub_bridge_unavailable', 'TokenHub protocol adapter failed to start')); } });
      child.once('exit', () => { clearTimeout(timer); worker = undefined; if (!settled) reject(new ApiError(503, 'tokenhub_bridge_unavailable', 'TokenHub protocol adapter stopped')); });
    });
    worker = { child, ready }; child.stderr.on('data', () => {});
    child.stdin.write(JSON.stringify({ token: bridgeToken, revisions: state.revisions.map(row => ({ ...row, api_key: decrypt(row.key), key: undefined })) }) + '\n');
    return ready;
  }
  return {
    redact,
    async settings() { await saving; return publicSettings(current()); },
    update(input) {
      object(input, ['base_url', 'api_key', 'wire_api', 'models']);
      if (!Object.keys(input).length) throw badRequest('TokenHub patch is empty');
      const copy = structuredClone(input);
      if (copy.api_key !== undefined && (typeof copy.api_key !== 'string' || !copy.api_key.trim() || copy.api_key.length > 8192 || /[\r\n]/.test(copy.api_key))) throw badRequest('Invalid API key');
      if (copy.wire_api !== undefined && !['chat', 'responses'].includes(copy.wire_api)) throw badRequest('Invalid model API protocol');
      if (copy.base_url !== undefined) copy.base_url = endpointUrl(copy.base_url);
      if (copy.models !== undefined) {
        if (!Array.isArray(copy.models) || !copy.models.length) throw badRequest('Invalid model list');
        const ids = copy.models.map(modelId);
        if (new Set(ids).size !== ids.length) throw badRequest('Duplicate model identifiers');
        copy.models = ids.map(id => ({ id, name: id, reasoning_efforts: [] }));
      }
      return mutate(next => {
        const prior = next.revisions.find(row => row.id === next.active);
        const row = { id: 'th_' + randomBytes(12).toString('hex'), base_url: copy.base_url ?? prior.base_url, wire_api: copy.wire_api ?? (copy.base_url ? 'chat' : prior.wire_api), key: copy.api_key === undefined ? prior.key : encrypt(copy.api_key.trim()), models: copy.models ?? [], tests: [] };
        if (row.base_url !== prior.base_url && copy.api_key === undefined) row.key = null;
        next.revisions.push(row); next.active = row.id; return publicSettings(row);
      });
    },
    async refresh() {
      await saving; const row = structuredClone(current()); requireEndpoint(row);
      const data = await request(row, '/models');
      if (!Array.isArray(data.data) || !data.data.length) throw new ApiError(502, 'model_endpoint_schema', 'Model API returned no model list');
      const discovered = [...new Map(data.data.map(item => {
        const id = modelId(item.id), advertised = item.supported_reasoning_levels ?? item.reasoning_efforts ?? [];
        if (!Array.isArray(advertised)) throw new ApiError(502, 'model_endpoint_schema', 'Invalid model reasoning capabilities');
        const efforts = advertised.map(itemEffort => typeof itemEffort === 'string' ? itemEffort : itemEffort?.effort).filter(itemEffort => EFFORTS.includes(itemEffort));
        return [id, { id, name: item.name ?? item.display_name ?? id, reasoning_efforts: [...new Set(efforts)] }];
      })).values()];
      return mutate(next => { if (next.active !== row.id) throw new ApiError(409, 'endpoint_changed', 'TokenHub endpoint changed; refresh again'); next.revisions.find(item => item.id === row.id).models = discovered; return { object: 'list', data: discovered, has_more: false, revision: row.id }; });
    },
    async test(input) {
      object(input, ['model', 'reasoning_effort']); const id = modelId(input.model), effort = input.reasoning_effort ?? null;
      if (effort !== null && !EFFORTS.includes(effort)) throw badRequest('Unsupported reasoning effort');
      await saving; const row = structuredClone(current()); requireEndpoint(row);
      if (!row.models.some(item => item.id === id)) throw badRequest('Refresh models and select a model from this endpoint first');
      const body = row.wire_api === 'chat'
        ? { model: id, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 64, ...(effort === null ? {} : { reasoning_effort: effort }) }
        : { model: id, input: 'Reply OK.', max_output_tokens: 64, ...(effort === null ? {} : { reasoning: { effort } }) };
      if (effort === 'none' && row.wire_api === 'chat') {
        if (/flash/i.test(id)) body.reasoning_effort = 'low';
        else if (/^minimax[-_]?m3/i.test(id)) { delete body.reasoning_effort; body.thinking = { type: 'disabled' }; }
        else throw badRequest('This chat model has no known disable-thinking contract; use the endpoint default');
      }
      const data = await request(row, row.wire_api === 'chat' ? '/chat/completions' : '/responses', body);
      const text = row.wire_api === 'chat' ? data.choices?.[0]?.message?.content : (data.output_text ?? data.output?.flatMap(item => item.content ?? []).map(item => item.text ?? '').join(''));
      if (typeof text !== 'string' || !text.trim()) throw new ApiError(502, 'model_test_incomplete', 'Model API returned no text; connection is not verified');
      const result = { model: id, reasoning_effort: effort, status: 'passed', verified_at: new Date().toISOString(), verification_level: 'connection' };
      return mutate(next => { if (next.active !== row.id) throw new ApiError(409, 'endpoint_changed', 'TokenHub endpoint changed during test'); const target = next.revisions.find(item => item.id === row.id); target.tests = [...target.tests.filter(item => !(item.model === id && item.reasoning_effort === effort)), result]; return { object: 'node.model_test', ...result, revision: row.id }; });
    },
    async catalog() { await saving; const row = current(); return { revision: row.id, external: !isBuiltinRevision(row.id) && !!row.base_url, models: structuredClone(row.models), tests: structuredClone(row.tests) }; },
    async connection(revision, reasoningEffort = null) {
      await saving; const row = state.revisions.find(item => item.id === revision);
      if (!row) throw new ApiError(409, 'endpoint_missing', 'Saved session endpoint is unavailable');
      // 内置 revision 没有本地桥。调用方应把地址写进 Codex 配置，而不是把密钥交给执行进程。
      if (isBuiltinRevision(revision) || !row.base_url) return null;
      const port = await bridge();
      return { baseUrl: `http://127.0.0.1:${port}/${row.id}/${reasoningEffort ?? 'default'}/v1`, token: bridgeToken };
    },
    async activeRevision() { await saving; return current().id; },
    async close() { await saving; if (worker) { worker.child.kill(); worker = undefined; } },
  };
}
