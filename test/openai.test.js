const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenAICompatProvider } = require('../src/main/agent/providers/openai');
const { PRESETS, isPreset } = require('../src/main/agent/providers/presets');

const tools = [{ name: 'open_app', description: 'd', input_schema: { type: 'object', properties: { name: { type: 'string' } } } }];
const ok = (json) => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) });
const fail = (status) => ({ ok: false, status, json: async () => ({}), text: async () => 'nope' });

test('openai-compatible: request shape and tool call parsing', async () => {
  let seen;
  const p = new OpenAICompatProvider({
    baseUrl: 'https://api.openai.com/v1/', apiKey: 'sk-test', model: 'gpt-4.1-mini', label: 'OpenAI',
    fetchImpl: async (url, init) => {
      seen = { url, init, body: JSON.parse(init.body) };
      return ok({ choices: [{ message: { content: 'ok', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'open_app', arguments: '{"name":"Notes"}' } }] } }] });
    }
  });
  const r = await p.step({ system: 'sys', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], tools });
  assert.equal(seen.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(seen.init.headers.authorization, 'Bearer sk-test');
  assert.equal(seen.body.model, 'gpt-4.1-mini');
  assert.deepEqual(seen.body.messages[0], { role: 'system', content: 'sys' });
  assert.equal(seen.body.tools[0].type, 'function');
  assert.equal(seen.body.tools[0].function.parameters.type, 'object');
  assert.deepEqual(r.toolCalls, [{ id: 'call_1', name: 'open_app', input: { name: 'Notes' } }]);
  assert.equal(r.text, 'ok');
  assert.deepEqual(r.assistantContent[1], { type: 'tool_use', id: 'call_1', name: 'open_app', input: { name: 'Notes' } });
});

test('openai-compatible: tool history keeps tool replies together and sends screenshots after them', () => {
  const p = new OpenAICompatProvider({ baseUrl: 'http://x', apiKey: 'k', model: 'm' });
  const png = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'IMG' } };
  const wire = p.toWire('sys', [
    { role: 'user', content: [{ type: 'text', text: 'open notes and look' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'open_app', input: { name: 'Notes' } }, { type: 'tool_use', id: 'b', name: 'screenshot', input: {} }] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: 'Opened Notes.' }] },
      { type: 'tool_result', tool_use_id: 'b', content: [{ type: 'text', text: 'Screenshot taken.' }, png] }
    ] }
  ]);
  assert.deepEqual(wire[2], { role: 'assistant', content: null, tool_calls: [
    { id: 'a', type: 'function', function: { name: 'open_app', arguments: '{"name":"Notes"}' } },
    { id: 'b', type: 'function', function: { name: 'screenshot', arguments: '{}' } }
  ] });
  assert.deepEqual(wire[3], { role: 'tool', tool_call_id: 'a', content: 'Opened Notes.' });
  assert.deepEqual(wire[4], { role: 'tool', tool_call_id: 'b', content: 'Screenshot taken.' });
  assert.equal(wire[5].role, 'user');
  assert.equal(wire[5].content[1].image_url.url, 'data:image/png;base64,IMG');
  assert.equal(wire.length, 6);
});

test('openai-compatible: bad arguments become an empty input instead of throwing', async () => {
  const p = new OpenAICompatProvider({
    baseUrl: 'http://x', apiKey: 'k', model: 'm',
    fetchImpl: async () => ok({ choices: [{ message: { content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'open_app', arguments: '{oops' } }] } }] })
  });
  const r = await p.step({ system: '', messages: [], tools });
  assert.deepEqual(r.toolCalls[0].input, {});
  assert.equal(r.text, '');
});

test('openai-compatible: readable errors', async () => {
  const mk = (extra) => new OpenAICompatProvider({ baseUrl: 'http://x', model: 'm', label: 'Groq', ...extra });
  await assert.rejects(() => mk({ apiKey: '' }).step({ system: '', messages: [], tools }), /No Groq API key/);
  await assert.rejects(() => mk({ apiKey: 'bad', fetchImpl: async () => fail(401) }).step({ system: '', messages: [], tools }), /Groq rejected the API key/);
  await assert.rejects(() => mk({ apiKey: 'k', fetchImpl: async () => fail(429) }).step({ system: '', messages: [], tools }), /out of quota/);
  await assert.rejects(() => mk({ apiKey: 'k', fetchImpl: async () => fail(500) }).step({ system: '', messages: [], tools }), /Groq error 500/);
  await assert.rejects(() => mk({ apiKey: 'k', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }).step({ system: '', messages: [], tools }), /Cannot reach Groq/);
});

test('openai-compatible: a custom address can run without a key, but needs the address', async () => {
  let headers;
  const p = new OpenAICompatProvider({
    baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '', keyOptional: true, model: 'local',
    fetchImpl: async (url, init) => { headers = init.headers; return ok({ choices: [{ message: { content: 'hi' } }] }); }
  });
  assert.equal((await p.step({ system: '', messages: [], tools })).text, 'hi');
  assert.equal(headers.authorization, undefined);
  await assert.rejects(() => new OpenAICompatProvider({ baseUrl: '', apiKey: '', keyOptional: true, model: 'm', label: 'Custom address' }).step({ system: '', messages: [], tools }), /Add the address for Custom address/);
});

test('presets: every service has an address and a model, and only real ids count', () => {
  for (const [id, p] of Object.entries(PRESETS)) {
    assert.ok(p.label, id);
    if (id !== 'custom') {
      assert.match(p.baseUrl, /^https:\/\//, id);
      assert.ok(p.model, id);
    }
  }
  assert.ok(isPreset('openai') && isPreset('custom'));
  assert.ok(!isPreset('claude') && !isPreset('anthropic') && !isPreset('ollama') && !isPreset('__proto__') && !isPreset('toString'));
});
