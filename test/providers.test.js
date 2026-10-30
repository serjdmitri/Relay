const test = require('node:test');
const assert = require('node:assert/strict');
const { AnthropicProvider } = require('../src/main/agent/providers/anthropic');
const { OllamaProvider } = require('../src/main/agent/providers/ollama');

const tools = [{ name: 'open_app', description: 'd', input_schema: { type: 'object', properties: { name: { type: 'string' } } } }];
const ok = (json) => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) });

test('anthropic: request shape and tool_use parsing', async () => {
  let seen;
  const p = new AnthropicProvider({
    apiKey: 'k', model: 'claude-sonnet-5-5',
    fetchImpl: async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return ok({ content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'tu1', name: 'open_app', input: { name: 'Notes' } }] }); }
  });
  const r = await p.step({ system: 'sys', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], tools });
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], 'k');
  assert.equal(seen.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(seen.body.model, 'claude-sonnet-5-5');
  assert.equal(seen.body.tools[0].input_schema.type, 'object');
  assert.deepEqual(r.toolCalls, [{ id: 'tu1', name: 'open_app', input: { name: 'Notes' } }]);
  assert.equal(r.text, 'ok');
});

test('anthropic: missing key and 401 give readable errors', async () => {
  await assert.rejects(() => new AnthropicProvider({ apiKey: '', model: 'm' }).step({ system: '', messages: [], tools }), /No Anthropic API key/);
  const p = new AnthropicProvider({ apiKey: 'bad', model: 'm', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
  await assert.rejects(() => p.step({ system: '', messages: [], tools }), /rejected the API key/);
});

test('ollama: converts tool history to wire format and parses tool calls', async () => {
  let body;
  const p = new OllamaProvider({
    url: 'http://127.0.0.1:11434/', model: 'qwen2.5:14b',
    fetchImpl: async (url, init) => { body = JSON.parse(init.body); assert.equal(init.redirect, 'error'); assert.equal(url, 'http://127.0.0.1:11434/api/chat'); return ok({ message: { content: '', tool_calls: [{ function: { name: 'open_app', arguments: { name: 'Finder' } } }] } }); }
  });
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'open notes' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'open_app', input: { name: 'Notes' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: 'Opened Notes.' }, { type: 'image', source: { data: 'IMG' } }] }] }
  ];
  const r = await p.step({ system: 'sys', messages, tools });
  assert.equal(body.messages[0].role, 'system');
  assert.deepEqual(body.messages[2].tool_calls[0].function, { name: 'open_app', arguments: { name: 'Notes' } });
  assert.deepEqual(body.messages[3], { role: 'tool', tool_name: 'open_app', content: 'Opened Notes.' });
  assert.deepEqual(body.messages[4].images, ['IMG']);
  assert.equal(body.tools[0].function.parameters.type, 'object');
  assert.equal(r.toolCalls[0].name, 'open_app');
  assert.deepEqual(r.toolCalls[0].input, { name: 'Finder' });
});

test('ollama refuses remote addresses and embedded credentials', () => {
  for (const url of ['https://example.com', 'http://192.168.1.5:11434', 'http://localhost.example.com', 'http://user:pass@localhost:11434', 'http://localhost:11434/?key=secret']) {
    assert.throws(() => new OllamaProvider({ url, model: 'm' }), /loopback/);
  }
  for (const url of ['http://127.0.0.1:11434', 'http://localhost:11434', 'http://[::1]:11434']) assert.doesNotThrow(() => new OllamaProvider({ url, model: 'm' }));
});

test('ollama: unreachable server gives a readable error', async () => {
  const p = new OllamaProvider({ url: 'http://127.0.0.1:11434', model: 'm', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(() => p.step({ system: '', messages: [], tools }), /Cannot reach Ollama/);
});
