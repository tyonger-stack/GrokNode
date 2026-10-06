import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { ApiError, badRequest, object } from './errors.mjs';
import { atomicJson, readPrivateJson } from './persistence.mjs';

export const DEFAULT_MODEL = null;
const VERIFIED_BASELINE_MODEL = 'gpt-6.1-sol';
export const modelId = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) throw badRequest('Invalid model identifier');
  return value;
};

export async function createModelPolicy(directory, { catalogFile = join(homedir(), '.codex/opencodex-catalog.json'), defaultModel = DEFAULT_MODEL, tokenhub } = {}) {
  const file = join(directory, 'models.json');
  const saved = await readPrivateJson(file, null);
  let state = saved ?? {
    default_model: defaultModel, bot_defaults: {}, allowed_models: [VERIFIED_BASELINE_MODEL],
    verified_models: [{ id: VERIFIED_BASELINE_MODEL, evidence: 'Node Agent API 0.3.0 shared project, native tools, approval and cancellation acceptance, 2026-10-06' }],
  };
  function validate(value) {
    object(value, ['default_model', 'bot_defaults', 'allowed_models', 'verified_models']);
    if (value.default_model !== null) modelId(value.default_model);
    object(value.bot_defaults, Object.keys(value.bot_defaults ?? {}));
    Object.values(value.bot_defaults).forEach(modelId);
    if (!Array.isArray(value.verified_models) || !Array.isArray(value.allowed_models) || !value.allowed_models.length) throw badRequest('Allowed and verified models are required');
    for (const row of value.verified_models) {
      object(row, ['id', 'evidence', 'endpoint_revision']); modelId(row.id);
      if (typeof row.evidence !== 'string' || !row.evidence.trim() || row.evidence.length > 1000) throw badRequest('Tool workflow verification evidence is required');
    }
    const verified = new Set(value.verified_models.map(row => row.id));
    if (verified.size !== value.verified_models.length || new Set(value.allowed_models).size !== value.allowed_models.length) throw badRequest('Duplicate model identifiers');
    for (const id of value.allowed_models) modelId(id);
    if (![value.default_model, ...Object.values(value.bot_defaults)].filter(id => id !== null).every(id => value.allowed_models.includes(id))) throw badRequest('Defaults must select approved verified models');
  }
  validate(state);
  if (saved === null) await atomicJson(file, state);
  let saving = Promise.resolve(), fault;
  async function catalog() {
    const endpoint = await tokenhub?.catalog();
    if (endpoint?.external) {
      if (!endpoint.models.length) throw new ApiError(503, 'model_catalog_unavailable', 'Refresh models from the configured TokenHub API first');
      return endpoint.models;
    }
    try {
      const value = JSON.parse(await readFile(catalogFile, 'utf8'));
      if (!Array.isArray(value.models) || !value.models.length) throw new Error('Invalid catalog');
      return value.models.map(row => ({ id: modelId(row.slug), name: typeof row.display_name === 'string' ? row.display_name : row.slug, reasoning_efforts: (row.supported_reasoning_levels ?? []).map(x => x.effort).filter(x => ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(x)) }));
    } catch { throw new ApiError(503, 'model_catalog_unavailable', 'Model catalog is unavailable; existing session models are preserved'); }
  }
  function current() { if (fault) throw fault; return state; }
  function effectiveDefault(botId) {
    const value = current();
    return Object.hasOwn(value.bot_defaults, botId) ? value.bot_defaults[botId] : value.default_model;
  }
  function selection(botId, requested) {
    const value = current();
    const model = requested === undefined ? effectiveDefault(botId) : modelId(requested);
    if (model === null) throw new ApiError(400, 'model_required', 'No default model is set; select a model for the new session');
    if (!value.allowed_models.includes(model)) throw badRequest('Model is not approved for new sessions');
    return { model, model_source: requested !== undefined ? 'session' : Object.hasOwn(value.bot_defaults, botId) ? 'bot_default' : 'service_default' };
  }
  async function mutate(operation) {
    const task = saving.then(async () => {
      const next = structuredClone(current()); operation(next); validate(next);
      const rows = await catalog(), ids = new Set(rows.map(row => row.id));
      const endpoint = await tokenhub?.catalog();
      for (const id of next.allowed_models) {
        if (!ids.has(id)) throw badRequest('Approved model is absent from the current catalog');
        const workflow = next.verified_models.some(v => v.id === id && (v.endpoint_revision ?? 'opencodex') === (endpoint?.revision ?? 'opencodex'));
        if (!workflow && !endpoint?.tests.some(t => t.model === id && t.status === 'passed')) throw badRequest('Test this model API connection before approval');
      }
      try { await atomicJson(file, next); } catch { fault = new ApiError(503, 'model_settings_persistence_failed', 'Model settings could not be saved'); throw fault; }
      state = next; return structuredClone(state);
    });
    saving = task.catch(() => {}); return task;
  }
  return {
    async resolve(botId, requested, reasoningEffort) {
      await saving;
      const selected = selection(botId, requested);
      const entry = (await catalog()).find(row => row.id === selected.model);
      if (!entry) throw badRequest('Model is absent from the current catalog');
      const endpoint = await tokenhub?.catalog(), revision = endpoint?.revision ?? 'opencodex';
      const workflow = state.verified_models.some(v => v.id === selected.model && (v.endpoint_revision ?? 'opencodex') === revision);
      const tests = endpoint?.tests.filter(t => t.model === selected.model && t.status === 'passed') ?? [];
      if (!workflow && !tests.length) throw badRequest('Model connection has not been tested for this endpoint');
      const levels = [...new Set([...(entry.reasoning_efforts ?? []), ...tests.map(t => t.reasoning_effort).filter(Boolean)])];
      if (reasoningEffort != null && !levels.includes(reasoningEffort)) throw badRequest('Reasoning effort is not supported or tested for this model');
      return { ...selected, ...(tokenhub ? { endpoint_revision: revision, reasoning_effort: reasoningEffort ?? null } : {}) };
    },
    async list(botId) {
      await saving; const value = current();
      const endpoint = await tokenhub?.catalog(), revision = endpoint?.revision ?? 'opencodex';
      return { object: 'list', data: (await catalog()).map(row => {
        const workflow = value.verified_models.find(v => v.id === row.id && (v.endpoint_revision ?? 'opencodex') === revision);
        const tests = endpoint?.tests.filter(t => t.model === row.id && t.status === 'passed') ?? [], verified = !!workflow || tests.length > 0;
        return { ...row, reasoning_efforts: [...new Set([...(row.reasoning_efforts ?? []), ...tests.map(t => t.reasoning_effort).filter(Boolean)])], approved: verified && value.allowed_models.includes(row.id), verified, verification_level: workflow ? 'tool_workflow' : tests.length ? 'connection' : 'unverified', verification_evidence: workflow?.evidence ?? (tests.length ? 'Actual model API test passed' : null) };
      }), has_more: false, default_model: botId ? effectiveDefault(botId) : value.default_model, endpoint_revision: revision };
    },
    async settings() { await saving; return { object: 'node.model_settings', ...structuredClone(current()) }; },
    async botSettings(botId) { await saving; const value = current(); return { object: 'node.bot_model_settings', agent_id: botId, default_model: Object.hasOwn(value.bot_defaults, botId) ? value.bot_defaults[botId] : null, effective_model: effectiveDefault(botId) }; },
    async update(input) {
      object(input, ['default_model', 'allowed_models', 'verified_models']);
      if (!Object.keys(input).length) throw badRequest('Model settings patch is empty');
      const copy = structuredClone(input);
      if (copy.verified_models && tokenhub) { const revision = await tokenhub.activeRevision(); copy.verified_models = copy.verified_models.map(v => ({ ...v, endpoint_revision: v.endpoint_revision ?? revision })); }
      if (copy.default_model === '') copy.default_model = null;
      return mutate(next => Object.assign(next, copy));
    },
    async updateBot(botId, input) {
      object(input, ['default_model']);
      if (!Object.hasOwn(input, 'default_model')) throw badRequest('default_model is required');
      const selected = input.default_model === null ? null : modelId(input.default_model);
      await mutate(next => { if (selected === null) delete next.bot_defaults[botId]; else Object.defineProperty(next.bot_defaults, botId, { value: selected, enumerable: true, configurable: true, writable: true }); });
      return this.botSettings(botId);
    },
  };
}
