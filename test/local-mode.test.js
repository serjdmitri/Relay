const test = require('node:test'), assert = require('node:assert/strict');
const { parseLocalCommand: p, ollamaState, run, readiness } = require('../src/main/localMode');

const mkStore = (model) => { const data = { 'settings.model': model }; return { data, get: (k) => (k === 'settings.model' ? data['settings.model'] : data[k]), set: (k, v) => { if (k === 'settings.model.provider') data['settings.model'] = { ...data['settings.model'], provider: v }; else if (k === 'settings.model.cloudProvider') data['settings.model'] = { ...data['settings.model'], cloudProvider: v }; else data[k] = v; } }; };
const up = (models) => async () => ({ models: models.map((name) => ({ name })) });
const down = async () => { throw Error('connection refused'); };

test('offline and online are understood by voice or text, and ordinary requests are left alone', () => {
  for (const t of ['go offline', 'Jarvis, go offline.', 'switch to local mode', 'use the local model', 'turn on offline mode', 'go private']) assert.deepEqual(p(t), { type: 'local-on' }, t);
  for (const t of ['go online', 'go back online', 'use the cloud model', 'turn off offline mode']) assert.deepEqual(p(t), { type: 'local-off' }, t);
  for (const t of ['are you offline', 'which model are you using', 'local model status']) assert.deepEqual(p(t), { type: 'local-status' }, t);
  for (const t of ['what is the weather', 'open my notes', 'go to sleep', 'take me home', 'play some music']) assert.equal(p(t), null, t);
});

test('Ollama is checked: running or not, and whether it has the model', async () => {
  assert.deepEqual(await ollamaState({ get: down, model: 'qwen2.5:7b' }), { running: false, hasModel: false, models: [] });
  assert.deepEqual(await ollamaState({ get: up(['qwen2.5:7b', 'llama3.2:3b']), model: 'qwen2.5:7b' }), { running: true, hasModel: true, models: ['qwen2.5:7b', 'llama3.2:3b'] });
  assert.equal((await ollamaState({ get: up(['llama3.2:3b']), model: 'qwen2.5:7b' })).hasModel, false);
  assert.equal((await ollamaState({ get: up(['qwen2.5:14b']), model: 'qwen2.5' })).hasModel, true, 'a name without a size matches any size');
  assert.match(readiness({ running: false, hasModel: false, models: [] }, 'qwen2.5:7b'), /ollama\.com.*ollama pull qwen2\.5:7b.*without your say-so/s);
});

test('going offline switches to Ollama, remembers the cloud choice, says what is missing and what is lost, and going online restores it', async () => {
  const store = mkStore({ provider: 'anthropic', ollamaModel: 'qwen2.5:14b', ollamaUrl: 'http://127.0.0.1:11434' }); const applied = [];
  const apply = (v) => { applied.push(v); store.set('settings.model.provider', v); };
  let r = await run({ type: 'local-on' }, { store, get: down, apply });
  assert.equal(store.get('settings.model').provider, 'ollama'); assert.equal(store.get('settings.model').cloudProvider, 'anthropic');
  assert.match(r.reply, /cannot think yet.*Ollama is not running/s);
  r = await run({ type: 'local-on' }, { store, get: up(['qwen2.5:14b']), apply });
  assert.match(r.reply, /thinking on this Mac with qwen2\.5:14b.*nothing leaves it/s); assert.match(r.reply, /weaker/); assert.match(r.reply, /vision model/); assert.match(r.reply, /phone's Jarvis still needs this Mac/);
  assert.equal(store.get('settings.model').cloudProvider, 'anthropic', 'asking twice does not overwrite the cloud choice with ollama');
  r = await run({ type: 'local-status' }, { store, get: up(['qwen2.5:14b']), apply }); assert.match(r.reply, /thinking locally/);
  r = await run({ type: 'local-off' }, { store, get: down, apply });
  assert.equal(store.get('settings.model').provider, 'anthropic'); assert.match(r.reply, /Back online/);
  r = await run({ type: 'local-off' }, { store, get: down, apply }); assert.match(r.reply, /already thinking in the cloud/);
  assert.deepEqual(applied, ['ollama', 'anthropic'], 'the provider changed exactly twice, each with the app\'s side effects');
});

test('a vision model is reported as able to look through the camera, and with no stored cloud choice going online falls back to Claude', async () => {
  const store = mkStore({ provider: 'ollama', ollamaModel: 'qwen2.5vl:7b' });
  assert.match((await run({ type: 'local-on' }, { store, get: up(['qwen2.5vl:7b']) })).reply, /it can look through the camera/);
  await run({ type: 'local-off' }, { store, get: down }); assert.equal(store.get('settings.model').provider, 'claude');
});
