// Mac 侧协议适配进程。Codex 仍负责模型回合和工具循环。
// 本进程只用 Node 运行：Responses 原样转发，Chat Completions 在 openai-bridge.mjs 里翻译。
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { timingSafeEqual } from 'node:crypto';
import { chatJsonToResponse, responsesToChat, translateChatStream } from './openai-bridge.mjs';

const lines = createInterface({ input: process.stdin });
let initialize;
const initial = new Promise(resolve => { initialize = resolve; });
let config;
lines.on('line', line => {
  try {
    const value = JSON.parse(line);
    if (!config) { config = value; initialize(); }
    else if (Array.isArray(value.revisions)) config.revisions = value.revisions;
  } catch { process.exit(1); }
});
lines.on('close', () => process.exit(0));
await initial;

const server = createServer(async (req, res) => {
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  try {
    const supplied = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from('Bearer ' + config.token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401); res.end(); return; }
    const match = /^\/(th_[a-f0-9]{24})\/(default|none|minimal|low|medium|high|xhigh|max|ultra)\/v1\/responses$/.exec(req.url ?? ''), row = config.revisions.find(item => item.id === match?.[1]);
    if (req.method !== 'POST' || !row) { res.writeHead(404); res.end(); return; }
    let bytes = 0; const chunks = [];
    for await (const data of req) { bytes += data.length; if (bytes > 16 * 1024 * 1024) throw new Error('Request too large'); chunks.push(data); }
    const body = JSON.parse(Buffer.concat(chunks));
    if (match[2] === 'default') delete body.reasoning;
    else body.reasoning = { effort: match[2] };
    const headers = { 'content-type': 'application/json', ...(row.api_key ? { authorization: 'Bearer ' + row.api_key } : {}) };
    const timer = setTimeout(() => abort.abort(), 10 * 60 * 1000);
    try {
      if (row.wire_api === 'responses') {
        const upstream = await fetch(row.base_url + '/responses', { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: abort.signal });
        if (!upstream.ok) { res.writeHead(upstream.status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'TokenHub HTTP ' + upstream.status, type: 'upstream_rejected' } })); return; }
        res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
        for await (const chunk of upstream.body) { if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve)); }
      } else {
        const chat = responsesToChat(body);
        const upstream = await fetch(row.base_url + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(chat), redirect: 'error', signal: abort.signal });
        if (!upstream.ok) { res.writeHead(upstream.status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'TokenHub HTTP ' + upstream.status, type: 'upstream_rejected' } })); return; }
        if (chat.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
          for await (const chunk of translateChatStream(upstream.body, { model: body.model })) { if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve)); }
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.write(JSON.stringify(chatJsonToResponse(await upstream.json(), body.model)));
        }
      }
      res.end();
    } finally { clearTimeout(timer); }
  } catch {
    if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'tokenhub_transport_error', message: 'TokenHub transport or protocol failed; no fallback' } })); }
    else res.destroy();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(JSON.stringify({ port: server.address().port }));
process.once('SIGTERM', () => { server.close(); process.exit(0); });
