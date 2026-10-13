// 推理端点只从启动参数或环境变量来，库函数本身不读环境变量，避免测试被外层环境污染。
// 没有内置代理地址。调用方没给地址时，结果是 null，而不是某个本机端口。

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

// 这些 revision 不走本地协议桥：Codex 直接使用 config.toml 里的地址，旧状态文件里的 id 也算在内。
const BUILTIN_REVISIONS = new Set(['opencodex', 'direct', 'unconfigured']);

export function isBuiltinRevision(id) {
  return id == null || BUILTIN_REVISIONS.has(id);
}

function blank(value) {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

export function parseModelList(value) {
  const parts = Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean)
    : String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
  for (const id of parts) if (!MODEL_ID.test(id)) throw new Error('Invalid model identifier');
  if (new Set(parts).size !== parts.length) throw new Error('Duplicate model identifiers');
  return parts;
}

// 显式参数优先于环境变量。空字符串视为未设置。
// 未指定协议时：有密钥按 Chat Completions（常见兼容端点），只有地址按 Responses（可直连，密钥不进 Codex 配置）。
export function resolveInferenceSettings(explicit = {}, env = process.env) {
  const pick = (key, name) => {
    const fromExplicit = blank(explicit[key]);
    if (fromExplicit !== undefined) return fromExplicit;
    return blank(env[name]);
  };
  const baseUrl = pick('baseUrl', 'NODE_AGENT_BASE_URL') ?? null;
  const apiKey = pick('apiKey', 'NODE_AGENT_API_KEY') ?? null;
  const model = pick('model', 'NODE_AGENT_MODEL') ?? null;
  const wireRaw = pick('wireApi', 'NODE_AGENT_WIRE_API');
  if (wireRaw !== undefined && wireRaw !== 'chat' && wireRaw !== 'responses') throw new Error('NODE_AGENT_WIRE_API must be chat or responses');
  if (apiKey && !baseUrl) throw new Error('NODE_AGENT_API_KEY requires NODE_AGENT_BASE_URL or --base-url');
  const wireApi = wireRaw ?? (baseUrl ? (apiKey ? 'chat' : 'responses') : null);
  const modelsSource = blank(explicit.models) ?? (Array.isArray(explicit.models) ? explicit.models : undefined) ?? blank(env.NODE_AGENT_MODELS);
  const models = parseModelList(modelsSource ?? '');
  const catalogFile = pick('catalogFile', 'NODE_AGENT_MODEL_CATALOG') ?? null;
  return { baseUrl, apiKey, model, wireApi, models, catalogFile };
}
