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
      const out = await callTool({ tool: byName.get(call.name), name: call.name, input: call.input, confirm, onEvent, signal });
      if (out.aborted) return { status: 'stopped', reply: 'Stopped.', actions };
      if (out.ran) actions++;
      results.push({ type: 'tool_result', tool_use_id: call.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
    trimImages(messages);
  }
  return { status: 'failed', reply: `I stopped after ${maxSteps} steps without finishing.`, actions };
}

// Runs one tool call: unknown tool, confirmation gate, execution and event reporting.
// Shared by the built-in loop and by the MCP server that the signed-in Claude CLI calls.
async function callTool({ tool, name, input, confirm, onEvent = () => {}, signal }) {
  if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  const ask = tool.confirm ? tool.confirm(input) : null;
  if (ask) {
    const allowed = await confirm({ tool: name, input, question: ask });
    if (signal?.aborted) return { aborted: true, content: [] };
    if (!allowed) {
      onEvent({ type: 'tool', name, input, ok: false, result: 'declined' });
      return { content: [{ type: 'text', text: 'The user declined this action. Do not retry it. Tell them it was not done.' }] };
    }
  }
  onEvent({ type: 'tool-start', name, input, label: tool.describe?.(input) });
  try {
    const out = await tool.run(input, { signal });
    const content = normalizeOutput(out);
    onEvent({ type: 'tool', name, input, ok: true, result: summarize(content) });
    return { content, ran: true };
  } catch (e) {
    if (signal?.aborted) return { aborted: true, content: [] };
    onEvent({ type: 'tool', name, input, ok: false, result: e.message });
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
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

module.exports = { runAgent, callTool, normalizeOutput, MAX_STEPS, trimImages };
