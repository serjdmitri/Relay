// Provider-agnostic agent loop. Messages use Anthropic-style content blocks internally;
// providers translate to their own wire format.

const MAX_STEPS = 25;
const KEEP_IMAGES = 2;

function trimImages(messages) {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block.type !== 'tool_result' || !Array.isArray(block.content)) continue;
      block.content = block.content.map((c) => {
        if (c.type !== 'image') return c;
        seen++;
        return seen > KEEP_IMAGES ? { type: 'text', text: '[older screenshot omitted]' } : c;
      });
    }
  }
}

async function runAgent({ text, provider, tools, system, confirm, onEvent = () => {}, signal, maxSteps = MAX_STEPS }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const messages = [{ role: 'user', content: [{ type: 'text', text }] }];
  let actions = 0;

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) return { status: 'stopped', reply: 'Stopped.', actions };

    const res = await provider.step({ system, messages, tools, signal });
    if (signal?.aborted) return { status: 'stopped', reply: 'Stopped.', actions };

    messages.push({ role: 'assistant', content: res.assistantContent });
    if (!res.toolCalls.length) {
      return { status: 'done', reply: (res.text || 'Done.').trim(), actions };
    }
    if (res.text) onEvent({ type: 'thought', text: res.text });

    const results = [];
    for (const call of res.toolCalls) {
      const tool = byName.get(call.name);
      let content;
      let isError = false;
      if (!tool) {
        content = [{ type: 'text', text: `Unknown tool: ${call.name}` }];
        isError = true;
      } else {
        const ask = tool.confirm ? tool.confirm(call.input) : null;
        let allowed = true;
        if (ask) {
          allowed = await confirm({ tool: call.name, input: call.input, question: ask });
        }
        if (signal?.aborted) return { status: 'stopped', reply: 'Stopped.', actions };
        if (!allowed) {
          content = [{ type: 'text', text: 'The user declined this action. Do not retry it. Tell them it was not done.' }];
          onEvent({ type: 'tool', name: call.name, input: call.input, ok: false, result: 'declined' });
        } else {
          onEvent({ type: 'tool-start', name: call.name, input: call.input, label: tool.describe?.(call.input) });
          try {
            const out = await tool.run(call.input, { signal });
            content = normalizeOutput(out);
            actions++;
            onEvent({ type: 'tool', name: call.name, input: call.input, ok: true, result: summarize(content) });
          } catch (e) {
            if (signal?.aborted) return { status: 'stopped', reply: 'Stopped.', actions };
            content = [{ type: 'text', text: `Error: ${e.message}` }];
            isError = true;
            onEvent({ type: 'tool', name: call.name, input: call.input, ok: false, result: e.message });
          }
        }
      }
      results.push({ type: 'tool_result', tool_use_id: call.id, content, ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
    trimImages(messages);
  }
  return { status: 'failed', reply: `I stopped after ${maxSteps} steps without finishing.`, actions };
}

function normalizeOutput(out) {
  if (out == null) return [{ type: 'text', text: 'OK' }];
  if (typeof out === 'string') return [{ type: 'text', text: out.slice(0, 12000) || 'OK' }];
  if (out.image) {
    return [
      { type: 'image', source: { type: 'base64', media_type: out.image.mediaType, data: out.image.data } },
      { type: 'text', text: out.text || '' }
    ];
  }
  return [{ type: 'text', text: JSON.stringify(out).slice(0, 12000) }];
}

function summarize(content) {
  const t = content.find((c) => c.type === 'text')?.text || '[image]';
  return t.length > 300 ? t.slice(0, 300) + '...' : t;
}

module.exports = { runAgent, MAX_STEPS, trimImages };
