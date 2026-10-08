import { ApiError, badRequest } from './errors.mjs';

export const sessionBackend = session => session.backend ?? (session.context === 'codex_harness' ? 'codex' : 'grok');

export function createBackends(adapter, nativeAdapter) {
  const defaultBackend = adapter.independentSessions ? 'codex' : 'grok';
  const adapters = new Map([[defaultBackend, adapter]]);
  if (nativeAdapter) adapters.set('grok', nativeAdapter);
  function select(backend = defaultBackend) {
    if (!['codex', 'grok'].includes(backend)) throw badRequest('backend must be codex or grok');
    const selected = adapters.get(backend);
    if (!selected) throw new ApiError(409, 'unsupported', 'Requested session backend is unavailable');
    return selected;
  }
  function capabilities(selected) {
    return {
      writes_enabled: selected.writesEnabled === true,
      sessions: { independent_conversations: !!selected.independentSessions },
      events: { sse: true, turn_outcomes: !!selected.cancel, cancellation: !!selected.cancel, required_actions: !!selected.answer, tool_results: false },
      desktop: { view: true, control: true, applications: !!selected.applications },
      project: { diff: !!selected.project, import: !!selected.project, export: !!selected.exportProject },
      clipboard: { read: !!selected.clipboard, write: !!selected.clipboard },
    };
  }
  const backendOf = session => !session.backend && adapters.size === 1 ? defaultBackend : sessionBackend(session);
  const forSession = session => select(backendOf(session));
  return { defaultBackend, select, backendOf, forSession,
    choices: () => Object.fromEntries([...adapters].map(([name, selected]) => [name, capabilities(selected)])),
    capabilities: session => capabilities(forSession(session)),
  };
}
