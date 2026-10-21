// OpenAI-compatible chat completions with tool calling: OpenAI, Gemini, Groq, Mistral, xAI, DeepSeek and any
// server that offers /chat/completions. Tool quality and screenshot support depend on the model you pick.

class OpenAICompatProvider {
  constructor({ baseUrl, apiKey, model, label = 'The model service', keyOptional = false, fetchImpl = fetch }) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.label = label;
    this.keyOptional = keyOptional;
    this.fetch = fetchImpl;
  }

  toWire(system, messages) {
    const out = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'assistant') {
        const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        const calls = m.content.filter((b) => b.type === 'tool_use');
        out.push({
          role: 'assistant',
          content: text || (calls.length ? null : ''),
          ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input || {}) } })) } : {})
        });
      } else {
        // Tool replies must directly follow the assistant message that made the calls, and carry text only,
        // so screenshots are sent afterwards as one user message.
        const images = [];
        for (const b of m.content) {
          if (b.type === 'text') out.push({ role: 'user', content: b.text });
          if (b.type === 'tool_result') {
            const text = (b.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
            out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: text || 'OK' });
            for (const c of b.content || []) if (c.type === 'image') images.push(c.source);
          }
        }
        if (images.length) {
          out.push({
            role: 'user',
            content: [
              { type: 'text', text: 'Screenshot from the previous tool call.' },
              ...images.map((s) => ({ type: 'image_url', image_url: { url: `data:${s.media_type || 'image/png'};base64,${s.data}` } }))
            ]
          });
        }
      }
    }
    return out;
  }

  async step({ system, messages, tools, signal }) {
    if (!this.apiKey && !this.keyOptional) throw new Error(`No ${this.label} API key. Add one in Relay > Account.`);
    if (!this.baseUrl) throw new Error(`Add the address for ${this.label} in Relay > Account.`);
    const body = {
      model: this.model,
      messages: this.toWire(system, messages),
      ...(tools?.length
        ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) }
        : {})
    };
    let res;
    try {
      res = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify(body)
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error(`Cannot reach ${this.label} at ${this.baseUrl}.`);
    }
    if (res.status === 401 || res.status === 403) throw new Error(`${this.label} rejected the API key. Check it in Relay > Account.`);
    if (res.status === 429) throw new Error(`${this.label} says you are out of quota or going too fast. Try again in a moment.`);
    if (!res.ok) throw new Error(`${this.label} error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const msg = json.choices?.[0]?.message || {};
    const calls = (msg.tool_calls || []).map((c, i) => ({
      id: c.id || `call_${Date.now()}_${i}`,
      name: c.function?.name,
      input: typeof c.function?.arguments === 'string' ? safeJson(c.function.arguments) : c.function?.arguments || {}
    }));
    const text = typeof msg.content === 'string' ? msg.content : '';
    const assistantContent = [];
    if (text) assistantContent.push({ type: 'text', text });
    for (const c of calls) assistantContent.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
    return { text, toolCalls: calls, assistantContent: assistantContent.length ? assistantContent : [{ type: 'text', text: '' }] };
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

module.exports = { OpenAICompatProvider };
