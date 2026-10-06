import { capabilities, createClient, desktopURL, eventView, projectDownload, readSSE, sessionPath } from './client.js';

const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
const pretty = value => JSON.stringify(value, null, 2);
const stateName = value => ({ idle: '待开始', pending: '提交中', accepted: '已接收', running: '正在执行', completed: '已完成', failed: '未完成', cancelled: '已取消', interrupted: '已中断', unknown: '状态待确认', closed: '已归档' }[value] ?? '状态待确认');
let client, flags = capabilities(), botId = '', session, turnId = '', epoch = 0;
let controller = new AbortController(), streamController, sending = false;
let modelSelection = false, modelManager = false, modelsReady = false;
let modelSettings;
let defaultModel = null;
let authPending = false;
let desktopChanging = false;
let modelRows = [], tokenhubSettings;
const cursors = new Map(), liveItems = new Map(), busy = new Map();
const status = value => text('status', value);

function controls() {
  const attached = Boolean(client && session), writable = attached && session.status !== 'closed';
  const enabled = {
    bots: Boolean(client), refresh: Boolean(client), disconnect: Boolean(client),
    history: Boolean(client && botId), attach: Boolean(client && botId && (!modelSelection || (modelsReady && (defaultModel || $('model').value)))),
    model: Boolean(client && botId && modelsReady), 'service-model': modelManager && modelsReady, 'bot-model': modelManager && Boolean(botId) && modelsReady,
    'reasoning-effort': Boolean(client && botId && modelsReady && $('model').value), 'tokenhub-open': Boolean(client && modelManager),
    'save-service-model': modelManager && modelsReady, 'save-bot-model': modelManager && Boolean(botId) && modelsReady,
    'save-allowed-models': modelManager && modelsReady, 'verify-model': modelManager && modelsReady, 'model-evidence': modelManager && modelsReady, 'save-model-evidence': modelManager && modelsReady,
    'tokenhub-key-save': modelManager, 'tokenhub-url-save': modelManager, 'tokenhub-protocol-save': modelManager, 'tokenhub-model-refresh': modelManager,
    'tokenhub-test': modelManager && Boolean($('tokenhub-model').value), 'tokenhub-authorize': modelManager && modelRows.some(row => row.id === $('tokenhub-model').value && row.verified),
    resume: attached, prompt: writable && flags.send, send: writable && flags.send && !sending,
    cancel: writable && flags.cancel && Boolean(turnId),
    'actions-refresh': attached && flags.actions, 'diff-refresh': attached && flags.diff,
    import: writable && flags.import, 'import-file': writable && flags.import, export: attached && flags.export,
    view: writable && flags.view && !desktopChanging, control: writable && flags.control && !desktopChanging, handback: attached && flags.control && !desktopChanging,
    clipboard: attached && (flags.clipboardRead || flags.clipboardWrite),
    'clipboard-read': attached && flags.clipboardRead, 'clipboard-write': writable && flags.clipboardWrite,
    applications: attached && flags.applications, 'applications-refresh': attached && flags.applications,
    'application-view': writable && flags.applications && Boolean($('applications').value) && !desktopChanging, 'application-control': writable && flags.applications && flags.control && Boolean($('applications').value) && !desktopChanging,
    'launch-terminal': writable && flags.applications && flags.control, 'launch-browser': writable && flags.applications && flags.control,
    backup: writable && flags.export, 'backup-id': writable && flags.import, 'restore-backup': writable && flags.import && Boolean($('backup-id').value),
  };
  for (const [id, allowed] of Object.entries(enabled)) $(id).disabled = !allowed || busy.has(id);
  $('connect').disabled = authPending;
  $('connect').textContent = authPending ? '连接中…' : '连接';
}

async function run(id, action) {
  if (busy.has(id)) return;
  const generation = epoch, operation = Symbol(id);
  busy.set(id, operation); controls();
  try { await action(); }
  catch (error) { if (generation === epoch && error.name !== 'AbortError') status(error.message); }
  finally { if (busy.get(id) === operation) busy.delete(id); controls(); }
}
function bind(id, action) { $(id).addEventListener('click', () => run(id, action)); }
function resetSession() {
  ++epoch; controller.abort(); controller = new AbortController(); streamController?.abort();
  busy.clear();
  session = undefined; turnId = ''; sending = false; liveItems.clear();
  desktopChanging = false;
  $('transcript').replaceChildren(); $('approvals').replaceChildren(); $('desktop').replaceChildren();
  $('clipboard').value = ''; $('prompt').value = ''; $('import-file').value = '';
  $('applications').replaceChildren(new Option('点击刷新应用', '')); $('backup-id').value = '';
  text('identity', '未选择会话'); text('thread', '未选择会话'); text('turn-status', '回合结果未知');
  text('diff', '尚未读取'); text('logs', '尚未收到事件'); text('stream-status', '事件流未连接');
  text('desktop-status', flags.view ? '可点击观看；接管需明确操作。' : '服务未声明桌面观看能力。');
  controls();
}
function disconnect() {
  authPending = false;
  resetSession(); client = undefined; flags = capabilities(); botId = ''; cursors.clear();
  $('key').value = ''; $('bots').replaceChildren(new Option('请先连接', ''));
  $('sessions').replaceChildren(); text('capabilities', '尚未查询'); text('context', '会话语义尚未查询。');
  modelSelection = false; modelManager = false; modelsReady = false; modelSettings = undefined; defaultModel = null; $('model-admin').hidden = true;
  $('model').replaceChildren(new Option('使用默认模型', '')); text('model-status', '连接后查询获准模型；已有会话保留原模型。');
  text('title', '选择机器人与会话'); text('desktop-status', '未连接');
  text('workspace-status', '能力未声明的操作保持禁用。'); status('已断开，访问密钥已从本页清除。'); controls();
  text('auth-status', '已断开。请重新输入访问密钥。');
  $('tokenhub-key').value = ''; $('tokenhub-dialog').close(); tokenhubSettings = undefined; modelRows = [];
}
const options = extra => ({ signal: controller.signal, ...extra });
async function scopedJSON(path, extra) {
  const generation = epoch;
  const value = await client.json(path, options(extra));
  if (generation !== epoch) throw new DOMException('Aborted', 'AbortError');
  return value;
}
const post = (path, body) => scopedJSON(path, { method: 'POST', body });

async function loadModels() {
  modelsReady = false; controls();
  if (!modelSelection) { text('model-status', '服务未声明模型选择能力。'); return; }
  const selectedBot = botId, generation = epoch;
  try {
    const value = await scopedJSON('/v1/models' + (selectedBot ? '?agent_id=' + encodeURIComponent(selectedBot) : ''));
    if (generation !== epoch || selectedBot !== botId) return;
    const approved = value.data.filter(row => row.approved === true && row.verified === true);
    modelRows = value.data;
    defaultModel = value.default_model;
    $('model').replaceChildren(new Option(defaultModel ? '使用默认：' + defaultModel : '请选择模型（默认未设置）', ''));
    for (const row of approved) $('model').add(new Option(row.name || row.id, row.id));
    text('model-status', defaultModel ? `默认：${defaultModel}。已有会话保留原模型。` : '未设置默认模型，请为新会话选择模型。');
    if (modelManager) {
      const settings = await scopedJSON('/v1/settings/models');
      modelSettings = settings;
      const bot = selectedBot ? await scopedJSON(`/v1/agents/${encodeURIComponent(selectedBot)}/model`) : null;
      if (generation !== epoch || selectedBot !== botId) return;
      $('service-model').replaceChildren(new Option('未设置默认模型', '')); $('bot-model').replaceChildren(new Option('继承服务默认', ''));
      for (const row of approved) { $('service-model').add(new Option(row.name || row.id, row.id)); $('bot-model').add(new Option(row.name || row.id, row.id)); }
      $('service-model').value = settings.default_model ?? ''; $('bot-model').value = bot?.default_model ?? '';
      $('allowed-models').replaceChildren(); $('verify-model').replaceChildren();
      for (const row of value.data) {
        const label = document.createElement('label'), check = document.createElement('input');
        check.type = 'checkbox'; check.value = row.id; check.checked = row.approved; check.disabled = !row.verified;
        label.append(check, document.createTextNode(' ' + row.id + (row.verification_level === 'connection' ? ' · 连接已验证' : row.verified ? ' · 工具链已验收' : ' · 待测试'))); $('allowed-models').append(label);
        $('verify-model').add(new Option(row.name || row.id, row.id));
      }
    }
    modelsReady = true;
    updateEfforts('model', 'reasoning-effort');
  } catch (error) { if (generation === epoch && selectedBot === botId && error.name !== 'AbortError') text('model-status', '无法读取模型目录：' + error.message); }
  controls();
}
bind('save-service-model', async () => { await scopedJSON('/v1/settings/models', { method: 'PATCH', body: { default_model: $('service-model').value || null } }); await loadModels(); status('服务默认模型已保存；已有会话保持原模型。'); });
$('model').addEventListener('change', () => { updateEfforts('model', 'reasoning-effort'); controls(); });
bind('save-bot-model', async () => { await scopedJSON(`/v1/agents/${encodeURIComponent(botId)}/model`, { method: 'PATCH', body: { default_model: $('bot-model').value || null } }); await loadModels(); status('bot 默认模型已保存；已有会话保持原模型。'); });
bind('save-allowed-models', async () => { const allowed_models = [...$('allowed-models').querySelectorAll('input:checked')].map(input => input.value); await scopedJSON('/v1/settings/models', { method: 'PATCH', body: { allowed_models } }); await loadModels(); status('获准清单已保存。'); });
bind('save-model-evidence', async () => { const id = $('verify-model').value, evidence = $('model-evidence').value.trim(); if (!evidence) throw new Error('请填写实际工具链验收记录。'); const verified_models = [...modelSettings.verified_models.filter(row => row.id !== id), { id, evidence }]; await scopedJSON('/v1/settings/models', { method: 'PATCH', body: { verified_models } }); $('model-evidence').value = ''; await loadModels(); status('验证记录已登记；可在清单中授权该模型。'); });

const effortLabels = { none: '无（不思考）', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: 'Ultra' };
function updateEfforts(modelControl, effortControl) {
  const row = modelRows.find(row => row.id === $(modelControl).value);
  $(effortControl).replaceChildren(new Option('端点默认', ''));
  for (const effort of row?.reasoning_efforts ?? []) $(effortControl).add(new Option(effortLabels[effort] ?? effort, effort));
}
async function loadTokenHub() {
  tokenhubSettings = await scopedJSON('/v1/settings/tokenhub');
  $('tokenhub-url').value = tokenhubSettings.base_url; $('tokenhub-protocol').value = tokenhubSettings.wire_api;
  text('tokenhub-key-status', tokenhubSettings.key_saved ? '已加密保存在 Mac；不会回显。' : '未保存密钥。本机 opencodex 可按原配置使用。');
  $('tokenhub-model').replaceChildren(new Option('先重新拉取模型', ''));
  for (const row of tokenhubSettings.models) $('tokenhub-model').add(new Option(row.name || row.id, row.id));
  updateEfforts('tokenhub-model', 'tokenhub-effort'); controls();
}
async function tokenhubAction(message, action) {
  text('tokenhub-status', message);
  try { await action(); }
  catch (error) { text('tokenhub-status', '操作失败：' + error.message); throw error; }
}
bind('tokenhub-open', async () => { $('tokenhub-dialog').showModal(); await tokenhubAction('正在读取端点…', async () => { await loadTokenHub(); text('tokenhub-status', '保存 API 地址与密钥，拉取模型后测试连接。'); }); });
bind('tokenhub-close', () => { $('tokenhub-key').value = ''; $('tokenhub-dialog').close(); });
$('tokenhub-dialog').addEventListener('close', () => { $('tokenhub-key').value = ''; });
$('tokenhub-model').addEventListener('change', () => { updateEfforts('tokenhub-model', 'tokenhub-effort'); $('tokenhub-effort-probe').value = ''; controls(); });
bind('tokenhub-key-save', () => tokenhubAction('正在保存密钥…', async () => { const api_key = $('tokenhub-key').value.trim(); if (!api_key) throw new Error('请输入模型 API 密钥。'); await scopedJSON('/v1/settings/tokenhub', { method: 'PATCH', body: { api_key } }); $('tokenhub-key').value = ''; await loadTokenHub(); await loadModels(); text('tokenhub-status', '密钥已保存，旧测试失效；请重新拉取模型并测试。'); }));
bind('tokenhub-url-save', () => tokenhubAction('正在保存端点…', async () => { await scopedJSON('/v1/settings/tokenhub', { method: 'PATCH', body: { base_url: $('tokenhub-url').value.trim(), wire_api: $('tokenhub-protocol').value } }); await loadTokenHub(); await loadModels(); text('tokenhub-status', '端点已保存。若地址变更，请重新保存密钥、拉取模型。'); }));
bind('tokenhub-protocol-save', () => tokenhubAction('正在保存协议…', async () => { await scopedJSON('/v1/settings/tokenhub', { method: 'PATCH', body: { wire_api: $('tokenhub-protocol').value } }); await loadTokenHub(); await loadModels(); text('tokenhub-status', '协议已保存，请重新拉取模型。'); }));
bind('tokenhub-model-refresh', () => tokenhubAction('正在从 API 拉取模型…', async () => { await post('/v1/settings/tokenhub/models', {}); await loadModels(); await loadTokenHub(); text('tokenhub-status', '模型已拉取；选择任意模型进行连接测试。'); }));
bind('tokenhub-test', () => tokenhubAction('正在请求模型（少量 token）…', async () => { const reasoning_effort = $('tokenhub-effort-probe').value.trim() || $('tokenhub-effort').value || null; const result = await post('/v1/settings/tokenhub/test', { model: $('tokenhub-model').value, reasoning_effort }); await loadModels(); controls(); text('tokenhub-status', `${result.model} · 连接已验证。可点击授权；尚不代表改代码、测试、审批、取消全链路验收。`); }));
bind('tokenhub-authorize', () => tokenhubAction('正在授权模型…', async () => { const selected = $('tokenhub-model').value; if (!modelRows.some(row => row.id === selected && row.verified)) throw new Error('先测试模型连接。'); const allowed_models = [...new Set([...modelRows.filter(row => row.approved).map(row => row.id), selected])]; await scopedJSON('/v1/settings/models', { method: 'PATCH', body: { allowed_models } }); await loadModels(); text('tokenhub-status', '模型已授权，新会话可以选择。服务默认仍按原设置。'); }));

async function loadBots() {
  const rows = await client.list('/v1/agents', controller.signal);
  resetSession(); botId = '';
  $('bots').replaceChildren(new Option(rows.length ? '选择机器人' : '没有可访问的机器人', ''));
  for (const bot of rows) $('bots').add(new Option(bot.name || bot.id, bot.id));
  $('sessions').replaceChildren(); text('title', '选择机器人与会话');
  status(rows.length ? '已连接。请选择机器人。' : '服务返回空机器人列表。'); controls();
}

async function loadSessions() {
  const generation = epoch, selectedBot = botId;
  const rows = await client.list(`/v1/agents/sessions?agent_id=${encodeURIComponent(selectedBot)}`, controller.signal);
  if (generation !== epoch) return;
  $('sessions').replaceChildren();
  for (const row of rows) {
    const button = document.createElement('button');
    button.textContent = `${row.metadata?.title || '会话 ' + (rows.indexOf(row) + 1)} · ${stateName(row.task_status ?? row.status)}`;
    button.title = row.id;
    button.setAttribute('aria-current', String(row.id === session?.id));
    button.addEventListener('click', () => run('select-session', () => selectSession(row.id)));
    $('sessions').append(button);
  }
  if (!rows.length) text('sessions', '此机器人没有已关联会话。');
}

function message(parent, label, value) {
  const article = document.createElement('article'); article.className = 'message';
  const heading = document.createElement('strong'); heading.textContent = label;
  const body = document.createElement('pre'); body.textContent = value;
  article.append(heading, body); parent.append(article); return body;
}
async function loadItems() {
  const generation = epoch;
  const rows = await client.list(`${sessionPath(session.id)}/items`, controller.signal);
  if (generation !== epoch) return;
  const fragment = document.createDocumentFragment();
  const roles = { user: '用户', assistant: '助手', tool: '工具', system: '系统' };
  for (const item of rows) {
    const label = roles[item.role] ?? ({ userMessage: '你', agentMessage: '助手', commandExecution: '终端', fileChange: '文件修改', reasoning: '进度', dynamicToolCall: '审批操作' }[item.type]) ?? '记录';
    const value = item.text ?? (item.type === 'userMessage' ? (item.content ?? []).map(part => part.text ?? '').join('\n') : item.type === 'commandExecution' ? [item.command, item.aggregatedOutput, item.exitCode === null || item.exitCode === undefined ? '' : '退出码：' + item.exitCode].filter(Boolean).join('\n') : pretty(item));
    message(fragment, label, value);
  }
  $('transcript').replaceChildren(fragment);
  if (!rows.length) text('transcript', '当前会话没有返回对话记录。');
}
async function loadActions() {
  if (!flags.actions) { text('approvals', '服务未声明审批能力。'); return; }
  const generation = epoch, path = `${sessionPath(session.id)}/actions`;
  const rows = await client.list(path, controller.signal);
  if (generation !== epoch) return;
  $('approvals').replaceChildren();
  for (const action of rows) {
    const box = document.createElement('div'); box.className = 'approval';
    message(box, `待审批 · ${action.id}`, pretty(action));
    for (const [decision, label] of [['accept', '允许'], ['decline', '拒绝']]) {
      const button = document.createElement('button'); button.textContent = label;
      button.addEventListener('click', () => run(`action-${action.id}`, async () => {
        for (const child of box.querySelectorAll('button')) child.disabled = true;
        try {
          const result = await post(`${path}/${encodeURIComponent(action.id)}`, { decision });
          if (generation !== epoch) return;
          status(`审批响应：${pretty(result)}`); await loadActions();
        } finally { for (const child of box.querySelectorAll('button')) child.disabled = false; }
      }));
      box.append(button);
    }
    $('approvals').append(box);
  }
  if (!rows.length) text('approvals', '没有待审批操作。');
}

async function selectSession(id) {
  resetSession();
  const generation = epoch;
  try {
    const value = await client.json(sessionPath(id), options());
    if (generation !== epoch) return;
    if (value.agent_id !== botId) throw new Error('会话所属机器人不匹配');
    session = value;
    turnId = value.active_turn_id ?? '';
    text('identity', flags.shared ? '机器人共用 Linux 项目与数据，桌面按机器人区分' : '当前机器人使用 Linux 项目环境'); text('thread', '当前会话' + (value.model ? ' · 模型：' + value.model : ''));
    status(`会话已恢复 · ${stateName(value.task_status ?? value.status)}`);
    text('turn-status', turnId ? `活动回合：${turnId} · 结果未知` : '尚未观察到权威回合结果');
    controls();
    await Promise.all([loadItems(), loadActions(), loadSessions()]);
    if (generation === epoch) startStream();
  } catch (error) { if (generation === epoch && error.name !== 'AbortError') status(error.message); }
}

function receive(event) {
  if (!event.data || typeof event.data !== 'object') throw new Error('事件载荷不是对象');
  const envelope = event.data;
  if (envelope.session_id && envelope.session_id !== session.id) return;
  if (event.id) cursors.set(session.id, event.id);
  const view = eventView(event);
  text('logs', ($('logs').textContent === '尚未收到事件' ? '' : $('logs').textContent + '\n') + pretty(envelope));
  if ($('logs').textContent.length > 100000) text('logs', '较早事件已从显示区截断。\n' + $('logs').textContent.slice(-90000));
  if (view.turnStatus) {
    const labels = { running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断', unknown: '结果未知' };
    text('turn-status', `${view.turnId ?? '未提供回合 ID'} · ${labels[view.turnStatus] ?? view.turnStatus}`);
    if (view.turnStatus === 'running') turnId = view.turnId ?? '';
    else if (!view.turnId || view.turnId === turnId) turnId = '';
  }
  if (view.delta !== undefined && view.itemId) {
    let node = liveItems.get(view.itemId);
    if (!node) {
      node = message($('transcript'), `流式输出 · ${view.method || view.type} · ${view.itemId}`, '');
      liveItems.set(view.itemId, node);
    }
    node.textContent += view.delta;
  }
  if (/input\.(accepted|rejected|unknown)$/.test(view.type)) status(`输入状态：${view.type.split('.').at(-1)}；请以回合事件判断结果。`);
  if (view.type === 'node.upstream.unavailable') status('上游不可用，任务结果未知；不会自动重发输入。');
  if (view.type === 'node.session.closed') { session.status = 'closed'; $('desktop').replaceChildren(); }
  if (view.type.endsWith('items.changed')) void run('items-update', async () => { await loadItems(); liveItems.clear(); });
  if (view.method === 'turn/diff/updated' && typeof view.params.diff === 'string') text('diff', view.params.diff || '服务返回空差异。');
  if (/action|approval/i.test(view.type + view.method) && flags.actions) void run('actions-update', loadActions);
  controls();
}

function startStream() {
  streamController?.abort();
  if (!flags.sse) { text('stream-status', '服务未声明 SSE 能力，请手动刷新记录。'); return; }
  const generation = epoch, selectedSession = session.id, selectedClient = client;
  const stream = new AbortController(); streamController = stream;
  text('stream-status', '正在连接事件流…');
  void (async () => {
    try {
      const cursor = cursors.get(selectedSession);
      const response = await selectedClient.request(`${sessionPath(selectedSession)}/events`, {
        signal: stream.signal, headers: { Accept: 'text/event-stream', ...(cursor ? { 'Last-Event-ID': cursor } : {}) },
      });
      if (generation !== epoch || stream.signal.aborted) return;
      text('stream-status', '事件流已连接');
      await readSSE(response, event => { if (generation === epoch && !stream.signal.aborted) receive(event); });
      if (generation === epoch && !stream.signal.aborted) text('stream-status', '事件流已断开；点击恢复。回合结果可能未知。');
    } catch (error) {
      if (generation === epoch && !stream.signal.aborted) text('stream-status', `事件流不可用：${error.message}。可点击恢复；不会重发消息。`);
    }
  })();
}

$('auth').addEventListener('submit', event => {
  event.preventDefault();
  const key = $('key').value.trim();
  if (!key) return;
  if (authPending) return;
  disconnect();
  authPending = true;
  text('auth-status', '正在验证访问密钥…'); status('正在连接本机 API…');
  void run('auth', async () => {
    client = createClient(key, location.origin);
    try {
      const value = await client.json('/v1/capabilities', options());
      text('auth-status', '密钥验证通过，正在加载机器人…');
      flags = capabilities(value); text('capabilities', pretty(value));
      modelSelection = value.models?.selection === true; modelManager = value.models?.management === true; $('model-admin').hidden = !modelManager;
      text('context', value.sessions?.independent_conversations === false ? '同一机器人共享既有对话；关联会话不会创建独立上下文。' : '恢复已有会话不会自动重跑任务。');
      text('workspace-status', `差异：${flags.diff ? '支持' : '未声明支持'} · 导入：${flags.import ? '支持' : '未声明支持'} · 导出：${flags.export ? '支持' : '未声明支持'}`);
      await loadBots(); await loadModels();
      text('auth-status', '已连接。请选择机器人。');
    } catch (error) { if (error.name !== 'AbortError') {
      disconnect();
      const message = error.message.includes('HTTP 401') ? '连接失败：访问密钥无效或已过期。请粘贴 owner.key 的文件内容，不是文件路径或复制命令。' : '连接失败：' + error.message;
      status(message); text('auth-status', message);
    } } finally { authPending = false; controls(); }
  });
});
bind('disconnect', disconnect);
bind('refresh', loadBots);
$('bots').addEventListener('change', () => {
  resetSession(); botId = $('bots').value; $('sessions').replaceChildren();
  text('title', botId ? $('bots').selectedOptions[0].textContent : '选择机器人与会话');
  status(botId ? '请选择已有会话，或关联当前机器人。' : '请选择机器人。'); controls();
  modelsReady = false; controls();
  void run('models', loadModels);
  if (botId) void run('history', loadSessions);
});
bind('history', loadSessions);
bind('attach', async () => {
  const value = await post('/v1/agents/sessions', { agent_id: botId, ...(modelSelection && $('model').value ? { model: $('model').value, reasoning_effort: $('reasoning-effort').value || null } : {}) });
  await selectSession(value.id);
});
bind('resume', async () => { await Promise.all([loadItems(), loadActions()]); liveItems.clear(); startStream(); });
bind('actions-refresh', loadActions);
$('composer').addEventListener('submit', event => {
  event.preventDefault();
  if (!session || !flags.send || sending || session.status === 'closed') return;
  const prompt = $('prompt').value;
  if (!prompt.trim()) return;
  const generation = epoch;
  void run('send', async () => {
    sending = true;
    try {
      const value = await post(`${sessionPath(session.id)}/events`, {
        events: [{ type: 'message', text: prompt }], idempotency_key: `nui_${crypto.randomUUID()}`,
      });
      if (generation !== epoch) return;
      status(`提交响应：${value.status ?? 'unknown'} · ${value.request_id ?? '未提供请求 ID'}。接收不代表任务完成。`);
      if (value.status === 'accepted') $('prompt').value = '';
    } catch (error) {
      if (generation === epoch && error.name !== 'AbortError') status(`提交未确认，结果可能未知；请先检查记录，勿盲目重发。${error.message}`);
    } finally { if (generation === epoch) sending = false; }
  });
});
bind('cancel', async () => {
  const value = await post(`${sessionPath(session.id)}/events`, { events: [{ type: 'agent.session.input.cancel', turn_id: turnId }] });
  status(`取消请求响应：${pretty(value)}；等待权威回合结果。`);
});
async function desktop(mode, handback = false) {
  if (desktopChanging) return;
  desktopChanging = true; controls();
  let released = false;
  const generation = epoch, selectedSession = session.id;
  text('desktop-status', handback ? '正在交还控制并切回观看…' : mode === 'control' ? '正在打开接管窗口…' : '正在切换到观看…');
  try {
  if (handback) {
    await post(`${sessionPath(selectedSession)}/handback`, {});
    released = true;
  }
  let value;
  try { value = await post(`${sessionPath(selectedSession)}/desktop`, { mode, replace_own_control: true }); }
  catch (error) {
    if (error.code === 'desktop_busy') { const message = '桌面已有控制窗口，或控制权刚刚发生变化。同一密钥可重新点击接管；其他使用者需要先交还控制。'; text('desktop-status', message); throw new Error(message); }
    throw error;
  }
  const iframe = document.createElement('iframe');
  iframe.title = mode === 'control' ? '机器人桌面 · 接管' : '机器人桌面 · 观看';
  iframe.referrerPolicy = 'no-referrer'; iframe.src = desktopURL(value.url, location.origin);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('桌面查看器加载超时，请重新点击观看或接管。')), 30000);
    iframe.addEventListener('load', () => {
      clearTimeout(timer);
      try {
        const body = iframe.contentDocument?.body?.textContent ?? '';
        if (body.trim().startsWith('{')) {
          const response = JSON.parse(body);
          if (response.error) { reject(new Error('桌面授权已变化，请重新点击接管；其他使用者持有控制时需要先交还。')); return; }
        }
        resolve();
      } catch (error) { reject(error); }
    }, { once: true });
    $('desktop').replaceChildren(iframe);
  });
  if (generation === epoch) {
    text('desktop-status', handback ? '控制已交还，当前为只读观看；画面连接由查看器显示。' : `${mode === 'control' ? '已签发接管授权' : '已签发观看授权'}；画面连接由查看器显示。${value.pauses_agent === false ? '接管不会暂停机器人。' : '机器人暂停状态未确认。'}`);
    if (handback) status('控制已交还，已切回观看。');
  }
  } catch (error) {
    if (generation !== epoch || error.name === 'AbortError') throw error;
    const message = released ? '控制已交还，但观看重连失败。请点击“观看”重试。' + error.message : error.message;
    text('desktop-status', message); throw new Error(message);
  }
  finally { if (generation === epoch) { desktopChanging = false; controls(); } }
}
bind('view', () => desktop('view')); bind('control', () => desktop('control'));
bind('applications-refresh', async () => {
  const rows = await client.list(`${sessionPath(session.id)}/applications`, controller.signal);
  $('applications').replaceChildren(new Option(rows.length ? '选择应用窗口' : '此桌面没有运行的应用', ''));
  for (const row of rows) $('applications').append(new Option(row.name || '应用窗口', row.id));
  controls();
});
$('applications').addEventListener('change', controls);
for (const [id, kind] of [['launch-terminal', 'terminal'], ['launch-browser', 'browser']]) bind(id, async () => {
  await post(`${sessionPath(session.id)}/applications`, { kind }); status('应用启动请求已接收。请刷新应用列表；需要先接管此机器人的桌面。');
});
for (const [id, mode] of [['application-view', 'view'], ['application-control', 'control']]) {
  $(id).addEventListener('click', () => {
    if (!session || !$('applications').value || desktopChanging) return;
    const selected = $('applications').value, popup = window.open('', '_blank');
    if (!popup) { status('浏览器阻止了新窗口，请允许此页面打开窗口后再点击。'); return; }
    popup.opener = null;
    desktopChanging = true; controls();
    void run(id, async () => {
      try { const value = await post(`${sessionPath(session.id)}/desktop`, { mode, ...(mode === 'control' ? { replace_own_control: true } : {}), target: { type: 'application', application_id: selected } }); popup.location.href = desktopURL(value.url, location.origin); if (mode === 'control') $('desktop').replaceChildren(); status(mode === 'control' ? '应用接管窗口已打开，已替换当前密钥的旧控制窗口。' : '应用观看窗口已打开。'); }
      catch (error) { popup.close(); throw error; }
      finally { desktopChanging = false; controls(); }
    });
  });
}
bind('handback', () => desktop('view', true));
bind('clipboard-read', async () => {
  const value = await scopedJSON(`${sessionPath(session.id)}/clipboard`);
  if (typeof value.text !== 'string') throw new Error('剪贴板响应缺少 text');
  $('clipboard').value = value.text; status('机器人剪贴板已读取到文本框，可手动选择复制。');
});
bind('clipboard-write', async () => {
  const value = await post(`${sessionPath(session.id)}/clipboard`, { text: $('clipboard').value });
  status(`剪贴板写入响应：${pretty(value)}`);
});
bind('diff-refresh', async () => {
  const value = await scopedJSON(`${sessionPath(session.id)}/project/diff`);
  if (typeof value.diff !== 'string') throw new Error('差异响应缺少 diff，不能判断是否有修改');
  text('diff', value.diff || '服务返回空差异。');
});
$('backup-id').addEventListener('input', controls);
bind('backup', async () => {
  const value = await post(`${sessionPath(session.id)}/environment/backup`, {});
  $('backup-id').value = value.backup_id; status('备份已保存。请保留备份编号：' + value.backup_id); controls();
});
bind('restore-backup', async () => {
  await post(`${sessionPath(session.id)}/environment/restore`, { backup_id: $('backup-id').value.trim() });
  await Promise.all([loadItems(), loadActions()]); status('项目备份已恢复，当前文件也已先备份；需要的运行进程请手动重跑。');
});
bind('import', async () => {
  const file = $('import-file').files[0];
  if (!file) throw new Error('请先选择项目 JSON 文件');
  const generation = epoch;
  if (file.size > 4 * 1024 * 1024) throw new Error('文件超过 4 MiB，请拆分后导入');
  const value = JSON.parse(await file.text());
  if (generation !== epoch) return;
  if (!Array.isArray(value.files) || !value.files.length || value.files.some(row => typeof row.path !== 'string' || !row.path || typeof row.content !== 'string')) throw new Error('导入格式须为 {files:[{path,content}]}');
  const result = await post(`${sessionPath(session.id)}/project/import`, { files: value.files.map(({ path, content }) => ({ path, content })) });
  text('workspace-status', `导入响应：${pretty(result)}`);
});
bind('export', async () => {
  const selected = session.id, generation = epoch;
  const value = await post(`${sessionPath(selected)}/project/export`, {});
  const download = await projectDownload(client, value, selected, controller.signal);
  if (generation !== epoch) return;
  const url = URL.createObjectURL(download.blob);
  const link = document.createElement('a'); link.href = url; link.download = download.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  text('workspace-status', download.message);
});
window.addEventListener('pagehide', disconnect);
controls();
