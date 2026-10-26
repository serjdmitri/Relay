class AnthropicProvider {
  constructor({ apiKey, model, fetchImpl = fetch, maxTokens = 2048 }) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetch = fetchImpl;
    this.maxTokens = maxTokens;
  }

  async step({ system, messages, tools, signal }) {
    if (!this.apiKey) throw new Error('No Anthropic API key set. Add one in Relay > Model.');
    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      system,
      messages,
      ...(tools?.length
        ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })) }
        : {})
    };
    const res = await this.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json()).error?.message || '';
      } catch {}
      if (res.status === 401) throw new Error('Anthropic rejected the API key (401).');
      throw new Error(`Anthropic error ${res.status}${detail ? ': ' + detail : ''}`);
    }
    const json = await res.json();
    const content = (json.content || []).filter((b) => b.type === 'text' || b.type === 'tool_use');
    return {
      text: content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
      toolCalls: content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input || {} })),
      assistantContent: content.length ? content : [{ type: 'text', text: '' }],
      usage: { in: (json.usage?.input_tokens || 0) + (json.usage?.cache_creation_input_tokens || 0) + (json.usage?.cache_read_input_tokens || 0), out: json.usage?.output_tokens || 0, model: json.model || this.model }
    };
  }
}

module.exports = { AnthropicProvider };
