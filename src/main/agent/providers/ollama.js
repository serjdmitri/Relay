// Ollama chat API with tool calling. Tool quality depends heavily on the local model;
// pick one with native tool support (qwen2.5, llama3.1, mistral-nemo, etc.).

class OllamaProvider {
  constructor({ url, model, fetchImpl = fetch }) {
    this.url = url.replace(/\/$/, '');
    this.model = model;
    this.fetch = fetchImpl;
  }

  toWire(system, messages) {
    const out = [{ role: 'system', content: system }];
    let callN = 0;
    const idToName = new Map();
    for (const m of messages) {
      if (m.role === 'assistant') {
        const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        const calls = m.content.filter((b) => b.type === 'tool_use');
        calls.forEach((c) => idToName.set(c.id, c.name));
        out.push({
          role: 'assistant',
          content: text,
          ...(calls.length ? { tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.input } })) } : {})
        });
      } else {
        for (const b of m.content) {
          if (b.type === 'text') out.push({ role: 'user', content: b.text });
          if (b.type === 'tool_result') {
            const text = (b.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
            out.push({ role: 'tool', tool_name: idToName.get(b.tool_use_id) || 'tool', content: text || 'OK' });
            const imgs = (b.content || []).filter((c) => c.type === 'image').map((c) => c.source.data);
            if (imgs.length) out.push({ role: 'user', content: 'Screenshot from the previous tool call.', images: imgs });
          }
        }
      }
      callN++;
    }
    return out;
  }

  async step({ system, messages, tools, signal }) {
    const body = {
      model: this.model,
      stream: false,
      messages: this.toWire(system, messages),
      ...(tools?.length
        ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) }
        : {})
    };
    let res;
    try {
      res = await this.fetch(`${this.url}/api/chat`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error(`Cannot reach Ollama at ${this.url}. Is it running?`);
    }
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const msg = json.message || {};
    const calls = (msg.tool_calls || []).map((c, i) => ({
      id: `call_${Date.now()}_${i}`,
      name: c.function.name,
      input: typeof c.function.arguments === 'string' ? safeJson(c.function.arguments) : c.function.arguments || {}
    }));
    const assistantContent = [];
    if (msg.content) assistantContent.push({ type: 'text', text: msg.content });
    for (const c of calls) assistantContent.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
    return { text: msg.content || '', toolCalls: calls, assistantContent: assistantContent.length ? assistantContent : [{ type: 'text', text: '' }], usage: { in: json.prompt_eval_count || 0, out: json.eval_count || 0, model: json.model || this.model || '' } };
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

module.exports = { OllamaProvider };
