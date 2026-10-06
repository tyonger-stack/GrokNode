import { createServer as httpServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { createAuth } from './auth.mjs';
import { createStore } from './store.mjs';
import { createDesktop } from './desktop.mjs';
import { ApiError, badRequest, forbidden, identifier, object } from './errors.mjs';
import { privateDirectory } from './runtime/common.mjs';
import { acquireStateLock } from './persistence.mjs';
import { page } from './pagination.mjs';
import { createInputHandler, metadata } from './input.mjs';
import { createGovernance } from './governance.mjs';
import { createWebhookOutbox } from './webhooks.mjs';
import { readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { createModelPolicy } from './models.mjs';
import { createTokenHub } from './tokenhub.mjs';

const publicSession = value => ({ object: value.object, id: value.id, agent_id: value.agent_id, status: value.status, created_at: value.created_at, context: value.context, metadata: value.metadata, ...(value.model ? { model: value.model, model_source: value.model_source } : {}), ...(value.endpoint_revision ? { endpoint_revision: value.endpoint_revision, reasoning_effort: value.reasoning_effort ?? null } : {}), ...(value.thread_id ? { thread_id: value.thread_id, task_status: value.task_status, active_turn_id: value.active_turn_id ?? null } : {}) });
export async function startNodeAgentApi(options) {
  await privateDirectory(options.stateDirectory);
  const release = await acquireStateLock(options.stateDirectory);
  try {
    const service = await startUnlocked(options);
    let closing;
    return { ...service, close() { closing ??= service.close().finally(release); return closing; } };
  } catch (error) { await release(); throw error; }
}

async function startUnlocked({ adapter, stateDirectory, port = 0, pollIntervalMs = 2000, governanceOptions = {}, modelOptions, tokenhubOptions = {} }) {
  const auth = await createAuth(stateDirectory), store = await createStore(stateDirectory);
  const tokenhub = modelOptions && adapter.independentSessions ? await createTokenHub(stateDirectory, tokenhubOptions) : null;
  adapter.setTokenHub?.(tokenhub);
  const models = modelOptions && adapter.independentSessions ? await createModelPolicy(stateDirectory, { ...modelOptions, tokenhub }) : null;
  const governance = await createGovernance(stateDirectory, governanceOptions);
  let webhooks; try { webhooks = await createWebhookOutbox(stateDirectory); } catch (error) { await governance.close(); throw error; }
  const desktop = createDesktop({ adapter, auth, store, governance, stateDirectory });
  store.setWriteGuard(async values => {
    const groups = new Map();
    for (const value of values) { const subject = value.quota_user_id ?? 'owner'; groups.set(subject, (groups.get(subject) ?? 0) + Buffer.byteLength(JSON.stringify(value))); }
    for (const [id, bytes] of groups) await governance.reserveStorage({ id }, 'session-state-' + id, bytes);
  });
  try { await adapter.attachStore?.(store); } catch (error) { await webhooks.close(); await governance.close(); throw error; }
  let webhooksEnabled = false;
  const unsubscribeAll = store.subscribeAll(event => {
    const method = event.data?.method;
    if (!webhooksEnabled || (event.type === 'node.harness.event' && !['turn/started', 'turn/completed', 'item/tool/call', 'item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method))) return;
    const session = store.get(event.session_id);
    void webhooks.enqueue({ id: session.quota_user_id ?? 'owner' }, { idempotencyKey: event.id, event: { id: event.id, type: event.type, session_id: event.session_id, created_at: event.created_at } }).catch(() => { webhooksEnabled = false; });
  });
  const webhookTimer = setInterval(() => { if (webhooksEnabled) void webhooks.dispatchDue().catch(() => { webhooksEnabled = false; }); }, 1000); webhookTimer.unref();
  const submit = createInputHandler({ adapter, store });
  const streams = new Set();
  let origin;
  const respond = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  async function body(req, maxBytes = 65536) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415, 'unsupported_media_type', 'JSON body required');
    let size = 0; const chunks = [];
    for await (const data of req) { size += data.length; if (size > maxBytes) throw new ApiError(413, 'body_limit', 'Request exceeds size limit'); chunks.push(data); }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw badRequest('Invalid JSON'); }
  }
  function authorizeSession(principal, id, scope) { const session = store.get(identifier(id)); auth.requireScope(principal, scope, session.agent_id); return session; }
  const server = httpServer(async (req, res) => {
    res.setHeader('X-Request-ID', 'nhttp_' + randomUUID());
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws://127.0.0.1:*; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, 'origin_rejected', 'Host or Origin rejected');
      const url = new URL(req.url, origin);
      let parts; try { parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { throw badRequest('Invalid URL encoding'); }
      if (req.method === 'GET' && url.pathname === '/health') return respond(res, 200, { service: 'node-agent-api', version: '0.3.0', backend: adapter.backend ?? 'grok_node', compatible_with_openai_sdk: false });
      if (req.method === 'GET' && ['/', '/ui/', '/ui/index.html', '/ui/app.js', '/ui/client.js', '/ui/style.css'].includes(url.pathname)) {
        if (url.pathname === '/') { res.writeHead(303, { Location: '/ui/' }); res.end(); return; }
        const file = ['/', '/ui/', '/ui/index.html'].includes(url.pathname) ? 'index.html' : path.basename(url.pathname);
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'");
        res.writeHead(200, { 'Content-Type': file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(await readFile(path.join(import.meta.dirname, 'web', file))); return;
      }
      if (url.pathname.startsWith('/desktop/')) return await desktop.handle(req, res, url);
      const principal = auth.authenticate(req.headers.authorization);
      const quotaPrincipal = { id: principal.user_id ?? principal.id };
      await governance.consumeRequest(quotaPrincipal);
      res.on('finish', () => { void governance.recordAudit({ principal: quotaPrincipal, action: 'request', outcome: res.statusCode < 400 ? 'succeeded' : 'failed', requestId: res.getHeader('X-Request-ID'), status: res.statusCode }).catch(() => {}); });
      if (parts[0] !== 'v1') throw new ApiError(404, 'not_found', 'Route not found');
      if (url.pathname === '/v1/capabilities' && req.method === 'GET') return respond(res, 200, {
        object: 'node.api.capabilities', version: '0.3.0', backend: adapter.backend ?? 'grok_node', writes_enabled: adapter.writesEnabled,
        sessions: { context: adapter.independentSessions ? 'codex_harness' : 'grok_node_bot_transcript', independent_conversations: !!adapter.independentSessions, metadata: true, close: true },
        events: { sse: true, resume: 'persisted_event_id', turn_outcomes: !!adapter.cancel, cancellation: !!adapter.cancel, required_actions: !!adapter.answer, tool_results: false },
        environment: { provisioning: !!adapter.bindSession && !adapter.externalAdapter, isolation: adapter.isolation ?? (adapter.independentSessions ? 'per_bot_container' : 'shared_container_separate_display') },
        security: { loopback_only: true, desktop_server_enforced: true, legacy_vnc_protected: adapter.rawDesktopProtected ?? !!adapter.independentSessions },
        desktop: { view: true, control: true, applications: !!adapter.applications }, project: { diff: !!adapter.project, import: !!adapter.project, export: !!adapter.exportProject }, clipboard: { read: !!adapter.clipboard, write: !!adapter.clipboard },
        service: { quotas: true, audit: true, webhooks: true },
        models: { selection: !!models, management: !!models && principal.id === 'owner', immutable_session: !!models },
        tokenhub: { configuration: !!tokenhub && principal.id === 'owner', actual_tests: !!tokenhub },
      });
      if (url.pathname === '/v1/usage' && req.method === 'GET') return respond(res, 200, await governance.usage(quotaPrincipal));
      if (url.pathname === '/v1/settings/tokenhub' || url.pathname.startsWith('/v1/settings/tokenhub/')) {
        auth.requireOwner(principal);
        if (!tokenhub) throw new ApiError(409, 'unsupported', 'TokenHub is unavailable on this backend');
        if (url.pathname === '/v1/settings/tokenhub' && req.method === 'GET') return respond(res, 200, await tokenhub.settings());
        if (url.pathname === '/v1/settings/tokenhub' && req.method === 'PATCH') return respond(res, 200, await tokenhub.update(await body(req)));
        if (url.pathname === '/v1/settings/tokenhub/models' && req.method === 'POST') return respond(res, 200, await tokenhub.refresh());
        if (url.pathname === '/v1/settings/tokenhub/test' && req.method === 'POST') return respond(res, 200, await tokenhub.test(await body(req)));
      }
      if (url.pathname === '/v1/models' && req.method === 'GET') {
        if (!models) throw new ApiError(409, 'unsupported', 'Model selection is unavailable on this backend');
        const bot = url.searchParams.get('agent_id'); auth.requireScope(principal, 'agents.read', bot ? identifier(bot) : undefined);
        if (bot) await adapter.requireAgent(bot);
        return respond(res, 200, await models.list(bot));
      }
      if (url.pathname === '/v1/settings/models') {
        auth.requireOwner(principal);
        if (!models) throw new ApiError(409, 'unsupported', 'Model selection is unavailable on this backend');
        if (req.method === 'GET') return respond(res, 200, await models.settings());
        if (req.method === 'PATCH') return respond(res, 200, { object: 'node.model_settings', ...await models.update(await body(req)) });
      }
      if (parts[1] === 'agents' && parts.length === 4 && parts[3] === 'model') {
        auth.requireOwner(principal); identifier(parts[2]); await adapter.requireAgent(parts[2]);
        if (!models) throw new ApiError(409, 'unsupported', 'Model selection is unavailable on this backend');
        if (req.method === 'GET') return respond(res, 200, await models.botSettings(parts[2]));
        if (req.method === 'PATCH') return respond(res, 200, await models.updateBot(parts[2], await body(req)));
      }
      if (parts[1] === 'webhooks') {
        if (principal.id !== 'owner') throw forbidden();
        if (parts.length === 2 && req.method === 'POST') { const configuration = await webhooks.configure(object(await body(req), ['destination'])); webhooksEnabled = true; return respond(res, 201, configuration); }
        if (parts.length === 3 && parts[2] === 'rotate' && req.method === 'POST') return respond(res, 200, await webhooks.rotateKey());
        if (parts.length === 3 && parts[2] === 'dispatch' && req.method === 'POST') return respond(res, 200, { data: await webhooks.dispatchDue() });
        if (parts.length === 3 && req.method === 'GET') return respond(res, 200, await webhooks.status(quotaPrincipal, parts[2]));
      }
      if (parts[1] === 'keys') {
        if (req.method === 'POST' && parts.length === 2) return respond(res, 201, await auth.issue(principal, object(await body(req), ['scopes','bot_ids','ttl_seconds','user_id'])));
        if (req.method === 'POST' && parts.length === 4 && parts[3] === 'rotate') { const result = await auth.rotateKey(principal, identifier(parts[2])); desktop.revokeKey(parts[2]); return respond(res, 201, result); }
        if (req.method === 'DELETE' && parts.length === 3) { const result = await auth.revoke(principal, identifier(parts[2])); desktop.revokeKey(parts[2]); return respond(res, 200, result); }
      }
      if (parts[1] === 'users') {
        if (parts.length === 2 && req.method === 'POST') return respond(res, 201, await auth.createUser(principal, object(await body(req), ['name'])));
        if (parts.length === 2 && req.method === 'GET') return respond(res, 200, page(auth.listUsers(principal), url.searchParams));
        if (parts.length === 4 && parts[3] === 'disable' && req.method === 'POST') { const result = await auth.disableUser(principal, identifier(parts[2])); desktop.revokeKey('disabled-user'); return respond(res, 200, result); }
      }
      if (parts[1] === 'agents' && parts.length === 2) {
        auth.requireScope(principal, req.method === 'GET' ? 'agents.read' : 'agents.write');
        if (req.method === 'GET') return respond(res, 200, page((await adapter.agents()).filter(a => principal.botIds.includes('*') || principal.botIds.includes(a.id)), url.searchParams));
        if (req.method === 'POST') { if (!principal.botIds.includes('*')) throw forbidden(); const input = object(await body(req), ['name','description']); if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120 || (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 4000))) throw badRequest('Invalid bot profile'); return respond(res, 201, await adapter.createAgent(input)); }
      }
      if (parts[1] === 'agents' && parts[2] !== 'sessions' && parts.length === 3 && req.method === 'GET') { auth.requireScope(principal, 'agents.read', identifier(parts[2])); return respond(res, 200, await adapter.requireAgent(parts[2])); }
      if (parts[1] === 'agents' && parts[2] === 'sessions') {
        if (parts.length === 3 && req.method === 'GET') { auth.requireScope(principal, 'sessions.read'); return respond(res, 200, page(store.list().filter(s => (principal.botIds.includes('*') || principal.botIds.includes(s.agent_id)) && (!url.searchParams.has('agent_id') || s.agent_id === url.searchParams.get('agent_id'))).map(publicSession), url.searchParams)); }
        if (parts.length === 3 && req.method === 'POST') {
          // Mirrors the Agents API request shape: a reusable agent_id, or an
          // inline agent override that selects an existing GrokNode bot.
          const input = object(await body(req), ['agent_id', 'agent', 'metadata', 'model', 'reasoning_effort']);
          const inline = input.agent === undefined ? undefined : object(input.agent, ['id']);
          const agentId = typeof input.agent_id === 'string' ? input.agent_id : inline?.id;
          if (typeof agentId !== 'string') throw badRequest('agent_id or agent.id is required');
          identifier(agentId); auth.requireScope(principal, 'sessions.write', agentId); await adapter.requireAgent(agentId);
          if (input.model !== undefined && !models) throw new ApiError(409, 'unsupported', 'Model selection is unavailable on this backend');
          const selected = models ? await models.resolve(agentId, input.model, input.reasoning_effort) : {};
          const result = await store.create(agentId, input.metadata === undefined ? {} : metadata(input.metadata), { reuse: !adapter.independentSessions, quota_user_id: quotaPrincipal.id, ...selected });
          if (result.created) await adapter.bindSession?.(result.session);
          return respond(res, result.created ? 201 : 200, publicSession(result.session));
        }
        if (parts.length >= 4) {
          const scope = req.method === 'GET' || ['desktop','handback','applications'].includes(parts[4]) ? 'sessions.read' : 'sessions.write';
          const session = authorizeSession(principal, parts[3], scope);
          if (parts[4] === 'artifacts' && parts.length === 7 && parts[6] === 'content' && req.method === 'GET' && adapter.artifact) { const result = await adapter.artifact(session, identifier(parts[5])); res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="project.tgz"' }); res.end(result.bytes); return; }
          if (parts[4] === 'actions' && parts.length === 6 && req.method === 'POST' && adapter.answer) { const input = object(await body(req), ['decision']); return respond(res, 200, await adapter.answer(session, identifier(parts[5]), input.decision)); }
          if (parts[4] === 'project' && parts.length === 6) {
            if (!adapter.project) throw new ApiError(409, 'unsupported', 'Project operations unavailable');
            if (req.method === 'GET' && parts[5] === 'diff') return respond(res, 200, await adapter.project(session, 'diff'));
            if (session.status === 'closed' || session.task_status === 'running') throw new ApiError(409, 'session_busy', 'Project writes require an open idle session');
            if (req.method === 'POST' && parts[5] === 'import') { const importInput = object(await body(req, 16 * 1024 * 1024), ['files']); if (!Array.isArray(importInput.files)) throw badRequest('files array is required'); return respond(res, 200, await adapter.project(session, 'import', importInput)); }
            if (req.method === 'POST' && parts[5] === 'export') return respond(res, 200, await adapter.exportProject(session, (id, bytes) => governance.reserveStorage(quotaPrincipal, id, bytes)));
          }
          if (parts[4] === 'environment' && parts.length === 6 && req.method === 'POST') {
            if (parts[5] === 'backup' && adapter.backup) return respond(res, 201, await adapter.backup(session));
            if (parts[5] === 'recreate' && adapter.recreate) return respond(res, 200, await adapter.recreate(session));
            if (parts[5] === 'restore' && adapter.restore) return respond(res, 200, await adapter.restore(session, object(await body(req), ['backup_id'])));
          }
          if (parts.length === 4 && req.method === 'GET') return respond(res, 200, publicSession(session));
          if (parts.length === 4 && req.method === 'PATCH') { const input = object(await body(req), ['metadata']); if (!Object.hasOwn(input, 'metadata')) throw badRequest('metadata is required'); await store.update(session.id, { metadata: metadata(input.metadata) }); return respond(res, 200, publicSession(session)); }
          if (parts.length !== 5) throw new ApiError(404, 'not_found', 'Route not found');
          if (parts[4] === 'close' && req.method === 'POST') {
            if (session.status === 'pending' || session.task_status === 'running') throw new ApiError(409, 'input_pending', 'Wait for or interrupt active work before closing');
            if (session.status !== 'closed') { await store.update(session.id, { status: 'closed' }); await store.append(session.id, 'node.session.closed', { cancels_agent: false }); desktop.closeSession(session.id); }
            return respond(res, 200, publicSession(session));
          }
          if (parts[4] === 'environment' && req.method === 'GET') { const { websocketUrl, websocketHeaders, ...environment } = await adapter.desktop(session.agent_id); return respond(res, 200, environment); }
          if (parts[4] === 'applications' && req.method === 'GET') {
            if (!adapter.applications) throw new ApiError(409, 'unsupported', 'Application windows are unavailable on this backend');
            auth.requireScope(principal, 'desktop.view', session.agent_id);
            const rows = await adapter.applications(session);
            const data = rows.filter(app => app.running !== false).map(app => ({
              object: 'node.application',
              id: app.application_id,
              name: app.name,
              running: true,
            }));
            return respond(res, 200, {
              object: 'list', data, has_more: false,
              first_id: data[0]?.id ?? null,
              last_id: data.at(-1)?.id ?? null,
            });
          }
          if (parts[4] === 'applications' && req.method === 'POST' && adapter.launchApplication) {
            auth.requireScope(principal, 'desktop.control', session.agent_id);
            if (session.status === 'closed' || !desktop.hasControl(principal, session)) throw forbidden();
            const input = object(await body(req), ['kind']);
            const result = await adapter.launchApplication(session, input.kind);
            await store.append(session.id, 'node.application.launched', { kind: input.kind, display: result.display });
            return respond(res, 202, result);
          }
          if (parts[4] === 'items' && req.method === 'GET') {
            const items = await store.refreshItems(session.id, () => adapter.itemsSession ? adapter.itemsSession(session) : adapter.items(session.agent_id));
            const rows = items.map((item, index) => ({ ...item, id: typeof item.id === 'string' ? item.id : 'nitem_' + createHash('sha256').update(index + ':' + JSON.stringify(item)).digest('hex') }));
            return respond(res, 200, { ...page(rows, url.searchParams), context: session.context });
          }
          if (parts[4] === 'actions' && req.method === 'GET') return respond(res, 200, page(adapter.actions ? await adapter.actions(session) : [], url.searchParams));
          if (parts[4] === 'resume' && req.method === 'POST' && adapter.resume) { await adapter.resume(session); return respond(res, 200, publicSession(session)); }
          if (parts[4] === 'handoff' && req.method === 'POST' && adapter.handoff) return respond(res, 200, await adapter.handoff(session));
          if (parts[4] === 'turns' && req.method === 'GET') { await adapter.flush?.(); return respond(res, 200, page(session.turns ?? [], url.searchParams)); }
          if (parts[4] === 'traces' && req.method === 'GET') { await adapter.flush?.(); return respond(res, 200, { object: 'list', data: (session.turns ?? []).map(turn => ({ turn_id: turn.id, ...(turn.model ? { model: turn.model } : {}), started_at: turn.started_at, ended_at: turn.ended_at ?? null, status: turn.status, usage: turn.usage ?? null, spans: turn.items })), has_more: false }); }
          if (parts[4] === 'clipboard' && adapter.clipboard) {
            auth.requireScope(principal, req.method === 'GET' ? 'desktop.view' : 'desktop.control', session.agent_id);
            if (req.method === 'GET') return respond(res, 200, await adapter.clipboard(session));
            if (req.method === 'POST') { if (session.status === 'closed') throw new ApiError(409, 'session_closed', 'Session is closed'); if (!desktop.hasControl(principal, session)) throw forbidden(); const input = object(await body(req), ['text']); return respond(res, 200, await adapter.clipboard(session, input.text)); }
          }
          if (parts[4] === 'desktop' && req.method === 'POST') { if (session.status === 'closed') throw new ApiError(409, 'session_closed', 'Session attachment is closed'); return respond(res, 201, await desktop.issue(principal, session, object(await body(req), ['mode','ttl_seconds','target','replace_own_control']), origin)); }
          if (parts[4] === 'handback' && req.method === 'POST') return respond(res, 200, desktop.handback(principal, session));
          if (parts[4] === 'events' && req.method === 'GET') {
            if (req.headers.accept?.includes('text/event-stream')) {
              const after = req.headers['last-event-id'] ?? url.searchParams.get('after');
              const start = after ? session.events.findIndex(e => e.id === after) + 1 : 0;
              if (after && start === 0) throw new ApiError(400, 'invalid_cursor', 'Persisted event cursor not found');
              const releaseStream = await governance.acquireStream(quotaPrincipal);
              res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
              res.flushHeaders();
              const send = event => { if (res.writableLength > 1024 * 1024) res.destroy(); else res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); };
              for (const event of session.events.slice(start)) send(event);
              const unsubscribe = store.subscribe(session.id, event => { if (!auth.active(principal)) res.end(); else send(event); });
              let polling = false, closed = false;
              const updates = setInterval(async () => {
                if (polling || closed || !auth.active(principal)) return;
                polling = true;
                try { if (!adapter.independentSessions) await store.refreshItems(session.id, () => adapter.items(session.agent_id)); }
                catch { if (!closed) res.write('event: node.upstream.unavailable\ndata: {"replayed":false}\n\n'); }
                finally { polling = false; }
              }, pollIntervalMs); updates.unref();
              const heartbeat = setInterval(() => { if (!auth.active(principal)) res.end(); else res.write(':heartbeat\n\n'); }, 15000); heartbeat.unref(); streams.add(res);
              res.on('close', () => { closed = true; releaseStream(); unsubscribe(); clearInterval(heartbeat); clearInterval(updates); streams.delete(res); }); return;
            }
            return respond(res, 200, page(session.events, url.searchParams));
          }
          if (parts[4] === 'events' && req.method === 'POST') {
            const input = await body(req);
            if (input.events?.[0]?.type === 'agent.session.input.cancel' && input.events.length === 1 && adapter.cancel) { object(input, ['events']); const cancel = object(input.events[0], ['type', 'turn_id']); return respond(res, 202, await adapter.cancel(session, cancel.turn_id)); }
            return respond(res, 202, await submit(session, input, req.headers['idempotency-key']));
          }
        }
      }
      throw new ApiError(404, 'not_found', 'Route not found');
    } catch (error) { if (!(error instanceof ApiError) && adapter.diagnostic) await appendFile(path.join(stateDirectory, 'diagnostics.log'), JSON.stringify({ at: Date.now(), message: adapter.diagnostic(error) }) + '\n', { mode: 0o600 }); if (res.headersSent) res.destroy(); else respond(res, error.status ?? 500, { error: { type: error instanceof ApiError ? error.code : 'internal_error', message: error instanceof ApiError ? error.message : 'Operation failed' } }); }
  });
  server.on('upgrade', (req, socket, head) => { void desktop.upgrade(req, socket, head, origin); });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (error) { clearInterval(webhookTimer); unsubscribeAll(); desktop.close(); await adapter.close?.(); await webhooks.close(); await governance.close(); throw error; }
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, keyFile: auth.keyFile, async close() { clearInterval(webhookTimer); unsubscribeAll(); desktop.close(); for (const res of streams) res.end(); await new Promise(resolve => server.close(resolve)); let failure; for (const cleanup of [() => adapter.close?.(), () => tokenhub?.close(), () => store.flush(), () => auth.flush(), () => webhooks.close(), () => governance.close()]) { try { await cleanup(); } catch (error) { failure ??= error; } } if (failure) throw failure; } };
}
