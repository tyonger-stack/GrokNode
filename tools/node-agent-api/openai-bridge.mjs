// Codex 0.160 只说 Responses。Chat Completions 端点由这个模块在 Mac 上翻译，
// 不依赖外部运行时或第三方协议包。Responses 端点不经过这里，原样转发。
import { randomBytes } from 'node:crypto';

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : (part?.text ?? '')).join('');
  return content == null ? '' : String(content);
}

function chatTool(tool) {
  const source = tool?.function ?? tool ?? {};
  return { type: 'function', function: { name: source.name, ...(source.description ? { description: source.description } : {}), parameters: source.parameters ?? { type: 'object', properties: {} } } };
}

// 无思考只使用已经核对过的契约：flash 发 low，MiniMax M3 发 thinking.type=disabled。其他模型拒绝猜测。
function applyDisableThinking(chat, model) {
  const id = String(model ?? '');
  if (/flash/i.test(id)) chat.reasoning_effort = 'low';
  else if (/^minimax[-_]?m3/i.test(id)) { delete chat.reasoning_effort; chat.thinking = { type: 'disabled' }; }
  else throw new Error('Unsupported disable-thinking contract');
}

export function responsesToChat(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid responses body');
  const messages = [];
  if (typeof body.instructions === 'string' && body.instructions) messages.push({ role: 'system', content: body.instructions });
  const input = body.input;
  const pending = [];
  const flush = () => {
    if (!pending.length) return;
    messages.push({ role: 'assistant', tool_calls: pending.splice(0, pending.length) });
  };
  const items = typeof input === 'string' ? [{ role: 'user', content: input }] : Array.isArray(input) ? input : [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'function_call') {
      pending.push({ id: item.call_id ?? item.id, type: 'function', function: { name: item.name, arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}) } });
      continue;
    }
    flush();
    if (item.type === 'function_call_output') {
      messages.push({ role: 'tool', tool_call_id: item.call_id ?? item.id, content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '') });
      continue;
    }
    if (item.type === 'message' || item.role) messages.push({ role: item.role ?? 'user', content: textOf(item.content) });
  }
  flush();
  const chat = { model: body.model, messages };
  if (Array.isArray(body.tools) && body.tools.length) chat.tools = body.tools.map(chatTool);
  if (body.reasoning?.effort && body.reasoning.effort !== 'none') chat.reasoning_effort = body.reasoning.effort;
  if (body.reasoning?.effort === 'none') applyDisableThinking(chat, body.model);
  if (body.max_output_tokens != null) chat.max_tokens = body.max_output_tokens;
  if (body.temperature != null) chat.temperature = body.temperature;
  if (body.stream) chat.stream = true;
  return chat;
}

function frame(type, extra) {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`;
}

// 把上游 Chat SSE 译成 Responses SSE。事件名和字段保持 Codex 能消费的形状。
export async function* translateChatStream(body, { model }) {
  const responseId = 'resp_' + randomBytes(8).toString('hex');
  const created = Math.floor(Date.now() / 1000);
  const output = [];
  let text = '', textOpen = false, finished = false;
  const textId = 'msg_' + randomBytes(4).toString('hex');
  const calls = new Map();
  const snapshot = status => ({ id: responseId, object: 'response', created_at: created, model, status, output: output.slice() });
  yield frame('response.created', { response: snapshot('in_progress') });
  yield frame('response.in_progress', { response: snapshot('in_progress') });

  function* closeOut() {
    if (finished) return;
    finished = true;
    if (textOpen) {
      const item = output.find(row => row.id === textId);
      item.status = 'completed';
      item.content = [{ type: 'output_text', text }];
      const index = output.indexOf(item);
      yield frame('response.output_text.done', { item_id: textId, output_index: index, content_index: 0, text });
      yield frame('response.content_part.done', { item_id: textId, output_index: index, content_index: 0, part: item.content[0] });
      yield frame('response.output_item.done', { output_index: index, item });
    }
    for (const current of calls.values()) {
      current.status = 'completed';
      const index = output.indexOf(current);
      yield frame('response.function_call_arguments.done', { item_id: current.id, output_index: index, name: current.name, arguments: current.arguments });
      yield frame('response.output_item.done', { output_index: index, item: { id: current.id, type: 'function_call', status: 'completed', call_id: current.call_id, name: current.name, arguments: current.arguments } });
    }
    const response = snapshot('completed');
    response.output_text = text;
    yield frame('response.completed', { response });
  }

  function* consume(block) {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('');
    if (!data || data === '[DONE]') return;
    let json;
    try { json = JSON.parse(data); } catch { return; }
    const choice = json.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string' && delta.content) {
      if (!textOpen) {
        textOpen = true;
        const item = { id: textId, type: 'message', role: 'assistant', status: 'in_progress', content: [] };
        output.push(item);
        const index = output.length - 1;
        yield frame('response.output_item.added', { output_index: index, item });
        yield frame('response.content_part.added', { item_id: textId, output_index: index, content_index: 0, part: { type: 'output_text', text: '' } });
      }
      text += delta.content;
      yield frame('response.output_text.delta', { item_id: textId, output_index: output.findIndex(row => row.id === textId), content_index: 0, delta: delta.content });
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls) {
        const index = call.index ?? 0;
        let current = calls.get(index);
        if (!current) {
          current = { id: 'fc_' + randomBytes(4).toString('hex'), type: 'function_call', status: 'in_progress', call_id: call.id || '', name: call.function?.name || '', arguments: '' };
          calls.set(index, current);
          output.push(current);
          yield frame('response.output_item.added', { output_index: output.length - 1, item: { ...current } });
        }
        if (call.id) current.call_id = call.id;
        if (call.function?.name) current.name = call.function.name;
        if (call.function?.arguments) {
          current.arguments += call.function.arguments;
          yield frame('response.function_call_arguments.delta', { item_id: current.id, output_index: output.indexOf(current), delta: call.function.arguments });
        }
      }
    }
    if (choice.finish_reason) yield* closeOut();
  }

  let buffer = '';
  for await (const chunk of body) {
    buffer += Buffer.from(chunk).toString('utf8');
    let split;
    while ((split = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      yield* consume(block);
    }
  }
  if (buffer.trim()) yield* consume(buffer);
  yield* closeOut();
}

export function chatJsonToResponse(data, model) {
  const message = data?.choices?.[0]?.message ?? {};
  const output = [];
  const text = typeof message.content === 'string' ? message.content : '';
  if (text) output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
  for (const call of message.tool_calls ?? []) output.push({ type: 'function_call', call_id: call.id, name: call.function?.name, arguments: call.function?.arguments ?? '' });
  return { id: data?.id ?? 'resp_local', object: 'response', model, status: 'completed', output, output_text: text };
}
