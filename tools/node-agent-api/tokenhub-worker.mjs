// Mac-only transport adapter. Native Codex continues to own the model/tool loop.
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { timingSafeEqual } from 'node:crypto';

const lines = createInterface({ input: process.stdin });
let initialize;
const initial = new Promise(resolve => { initialize = resolve; });
let config;
lines.on('line', line => { try { const value = JSON.parse(line); if (!config) { config = value; initialize(); } else config.revisions = value.revisions; } catch { process.exit(1); } });
lines.on('close', () => process.exit(0));
await initial;
const root = config.root + '/src';
const [{ parseRequest }, { createOpenAIChatAdapter }, { bridgeToResponsesSSE }, { buildResponseJSON }, { createTranslatorBudget }] = await Promise.all([
  import(root + '/responses/parser.ts'), import(root + '/adapters/openai-chat.ts'), import(root + '/bridge/sse.ts'), import(root + '/bridge/response-json.ts'), import(root + '/lib/translator-budget.ts'),
]);
const server = createServer(async (req, res) => {
  let budget;
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  try {
    const supplied = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from('Bearer ' + config.token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401); res.end(); return; }
    const match = /^\/(th_[a-f0-9]{24})\/(default|none|minimal|low|medium|high|xhigh|max|ultra)\/v1\/responses$/.exec(req.url ?? ''), row = config.revisions.find(r => r.id === match?.[1]);
    if (req.method !== 'POST' || !row) { res.writeHead(404); res.end(); return; }
    let bytes = 0; const chunks = [];
    for await (const data of req) { bytes += data.length; if (bytes > 16 * 1024 * 1024) throw new Error('Request too large'); chunks.push(data); }
    const body = JSON.parse(Buffer.concat(chunks));
    if (match[2] === 'default') delete body.reasoning;
    else body.reasoning = { effort: match[2] };
    const timer = setTimeout(() => abort.abort(), 10 * 60 * 1000);
    let upstream;
    try {
      if (row.wire_api === 'responses') {
        upstream = await fetch(row.base_url + '/responses', { method: 'POST', headers: { 'content-type': 'application/json', ...(row.api_key ? { authorization: 'Bearer ' + row.api_key } : {}) }, body: JSON.stringify(body), redirect: 'error', signal: abort.signal });
        if (!upstream.ok) { res.writeHead(upstream.status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'TokenHub HTTP ' + upstream.status, type: 'upstream_rejected' } })); return; }
        res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
        for await (const chunk of upstream.body) { if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve)); }
      } else {
        budget = createTranslatorBudget();
        const parsed = parseRequest(body), adapter = createOpenAIChatAdapter({ adapter: 'openai-chat', baseUrl: row.base_url, apiKey: row.api_key, authMode: row.api_key ? 'key' : 'none', keyOptional: !row.api_key, codexToolMode: 'shell' });
        const request = await adapter.buildRequest(parsed, { headers: new Headers(), translatorBudget: budget, abortSignal: abort.signal });
        if (match[2] === 'none') {
          const chatBody = JSON.parse(request.body);
          if (/flash/i.test(body.model)) chatBody.reasoning_effort = 'low';
          else if (/^minimax[-_]?m3/i.test(body.model)) { delete chatBody.reasoning_effort; chatBody.thinking = { type: 'disabled' }; }
          else throw new Error('Unsupported disable-thinking contract');
          request.body = JSON.stringify(chatBody);
        }
        upstream = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, redirect: 'error', signal: abort.signal });
        if (!upstream.ok) { res.writeHead(upstream.status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'TokenHub HTTP ' + upstream.status, type: 'upstream_rejected' } })); return; }
        const tools = new Map(parsed.context.tools.filter(t => t.namespace || t.freeform).map(t => [t.name, { namespace: t.namespace, name: t.name, ...(t.freeform ? { freeform: true } : {}) }]));
        const freeform = new Set(parsed.context.tools.filter(t => t.freeform).map(t => t.name));
        if (parsed.stream) {
          const response = bridgeToResponsesSSE(adapter.parseStream(upstream, budget, request.tierLog), parsed.modelId, tools, freeform, undefined, () => abort.abort(), 2000, { translatorBudget: budget, declaredToolNames: new Set(parsed.context.tools.map(t => t.name)) });
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
          for await (const chunk of response) { if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve)); }
        } else {
          const events = await adapter.parseResponse(upstream, budget, request.tierLog);
          res.writeHead(200, { 'content-type': 'application/json' }); res.write(JSON.stringify(buildResponseJSON(events, parsed.modelId, { translatorBudget: budget, toolNsMap: tools })));
        }
      }
      res.end();
    } finally { clearTimeout(timer); }
  } catch {
    if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'tokenhub_transport_error', message: 'TokenHub transport or protocol failed; no fallback' } })); }
    else res.destroy();
  } finally { budget?.dispose(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(JSON.stringify({ port: server.address().port }));
process.once('SIGTERM', () => { server.close(); process.exit(0); });
