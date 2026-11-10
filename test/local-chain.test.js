const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { OllamaProvider } = require('../src/main/agent/providers/ollama');
const { AskController } = require('../src/main/askController');
const { Failover } = require('../src/main/failover');
const { Budget } = require('../src/main/budget');
const { Speech } = require('../src/main/speech');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ---- the local model is fast to answer: it stays loaded, answers stay short, and it can be loaded ahead ----
test('the local model is asked to stay in memory, to keep replies short, and can be pre-loaded', async () => {
  const bodies = [];
  const fetchImpl = async (url, o) => { bodies.push([url, JSON.parse(o.body)]); return { ok: true, json: async () => ({ message: { content: 'hi' } }), text: async () => '' }; };
  const p = new OllamaProvider({ url: 'http://127.0.0.1:11434', model: 'qwen2.5:7b', fetchImpl });
  await p.step({ system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], tools: [] });
  assert.equal(bodies[0][1].keep_alive, '30m'); assert.equal(bodies[0][1].options.num_predict, 700);
  assert.equal(await p.warm(), true); assert.equal(bodies[1][0], 'http://127.0.0.1:11434/api/generate'); assert.deepEqual(bodies[1][1], { model: 'qwen2.5:7b', keep_alive: '30m' });
  const custom = new OllamaProvider({ url: 'http://127.0.0.1:11434', model: 'm', fetchImpl, keepAlive: '2h', numPredict: 200 });
  await custom.step({ system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }], tools: [] });
  assert.equal(bodies[2][1].keep_alive, '2h'); assert.equal(bodies[2][1].options.num_predict, 200);
  assert.equal(await new OllamaProvider({ url: 'http://127.0.0.1:11434', model: 'm', fetchImpl: async () => { throw new Error('down'); } }).warm(), false, 'warming never throws');
});

// ---- the chain ----
function ctl({ provider = 'claude', ollamaModel = 'qwen2.5:7b', codexOk = true, codexUntil = 0, claudeOut = true, budget = null } = {}) {
  const data = { 'settings.model': { provider, ollamaModel, ollamaUrl: 'http://127.0.0.1:11434' }, 'settings.failover.codexUntil': codexUntil, 'settings.failover.codex': true, 'settings.budget': budget };
  const t = 1_761_000_000_000, until = claudeOut ? t + 3600e3 : 0;
  const c = Object.create(AskController.prototype); let spent = {};
  Object.assign(c, { store: { get: (k) => data[k], set: (k, v) => { data[k] = v; } }, failover: new Failover({ now: () => t, load: () => until, save: () => {} }), codexReady: async () => (codexOk ? '/bin/codex' : null), warmLocal: async () => { c.warmed = (c.warmed || 0) + 1; }, ensureOllama() {}, budget: new Budget({ load: () => spent, save: (v) => { spent = v; }, cfg: () => data['settings.budget'] }) });
  return { c, data };
}

test('Claude first; Codex when Claude is out; the local model when Codex is out or not set up', async () => {
  assert.equal(await ctl({ claudeOut: false }).c.shouldUseLocal(), false, 'Claude is fine: nothing changes');
  assert.equal(await ctl({ codexOk: true }).c.shouldUseLocal(), false, 'Claude out, Codex works: Codex does it');
  const noCodex = ctl({ codexOk: false });
  assert.equal(await noCodex.c.shouldUseLocal(), true, 'Claude out and no Codex: local'); assert.match(noCodex.c.localWhy, /Claude and Codex/); assert.equal(noCodex.c.localFallbackFlag, true);
  const codexOut = ctl({ codexOk: true, codexUntil: Date.now() + 1e9 });
  assert.equal(await codexOut.c.codexUsableNow(), false); assert.equal(await codexOut.c.shouldUseLocal(), true, 'Codex is out of usage too: local');
  assert.equal(await ctl({ codexOk: false, ollamaModel: '' }).c.shouldUseLocal(), false, 'no local model set up: nothing changes');
  assert.equal(await ctl({ provider: 'ollama', codexOk: false }).c.shouldUseLocal(), false, 'already local');
  const first = ctl({ codexOk: false }); await first.c.shouldUseLocal(); await first.c.shouldUseLocal(); await new Promise((r) => setImmediate(r));
  assert.equal(first.c.warmed, 1, 'the local model is loaded ahead, once, not on every request');
});

test('at your spend limit, if you chose it, the rest of the day goes to the local model', async () => {
  const over = ctl({ claudeOut: false, budget: { enabled: true, dailyUsd: 1, monthlyUsd: 0, action: 'local' } }); over.c.budget.add(2);
  assert.equal(await over.c.shouldUseLocal(), true); assert.match(over.c.localWhy, /spend limit/);
  const under = ctl({ claudeOut: false, budget: { enabled: true, dailyUsd: 10, monthlyUsd: 0, action: 'local' } }); under.c.budget.add(2); assert.equal(await under.c.shouldUseLocal(), false);
  const ask = ctl({ claudeOut: false, budget: { enabled: true, dailyUsd: 1, monthlyUsd: 0, action: 'ask' } }); ask.c.budget.add(2); assert.equal(await ask.c.shouldUseLocal(), false, 'only the "local" choice switches');
  const notes = []; const g = ctl({ claudeOut: false, budget: { enabled: true, dailyUsd: 1, monthlyUsd: 0, action: 'local' } }); g.c.budget.add(2); g.c.notice = (m) => notes.push(m);
  assert.equal(await g.c.budgetGate(), null, 'not stopped, not asked'); assert.equal(await g.c.budgetGate(), null);
  assert.equal(notes.length, 1); assert.match(notes[0], /switched to the local model for the rest of the day/);
});

test('the small local model is found for quick things, and a chosen one wins', async () => {
  const mk = (tags, chosen = '') => { const { c } = ctl(); c.store.get('settings.model').ollamaFastModel = chosen; c.httpGet = async () => ({ models: tags.map((name) => ({ name })) }); return c; };
  assert.equal(await mk(['qwen2.5:7b', 'nomic-embed-text:latest', 'qwen2.5:3b']).fastLocalModel(), 'qwen2.5:3b');
  assert.equal(await mk(['qwen2.5:7b']).fastLocalModel(), null); assert.equal(await mk(['llama3.2:1b', 'qwen2.5:7b']).fastLocalModel(), 'llama3.2:1b');
  assert.equal(await mk(['qwen2.5:3b'], 'my-model:2b').fastLocalModel(), 'my-model:2b');
  const src = read('src/main/askController.js');
  assert.match(src, /model: \(await this\.fastLocalModel\(\)\) \|\| m\.ollamaModel/); assert.match(src, /OLLAMA_FLASH_ATTENTION: '1', OLLAMA_KV_CACHE_TYPE: 'q8_0', OLLAMA_KEEP_ALIVE: '30m'/);
  assert.match(src, /if \(m\.provider === 'ollama' \|\| this\.localFallbackFlag\)/); assert.match(src, /const toLocal = await this\.shouldUseLocal\(\)/);
  assert.match(read('src/renderer/app.js'), /<option value="local">Switch to the local model<\/option>/);
});

// ---- after you let go of the key ----
function speechRig(finalAfterMs, finalText = 'open my notes please') {
  const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-sp-')), 'relay-speech'); fs.writeFileSync(bin, '');
  const spawnFn = () => {
    const child = new EventEmitter(); const out = new PassThrough();
    Object.assign(child, { stdout: out, stderr: new PassThrough(), stdin: new PassThrough(), kill: () => child.emit('exit', 0) });
    child.stdin.on('data', (d) => {
      for (const line of d.toString().split('\n').filter(Boolean)) {
        const cmd = JSON.parse(line).cmd;
        if (cmd === 'start') setImmediate(() => { out.write(JSON.stringify({ event: 'listening' }) + '\n'); out.write(JSON.stringify({ event: 'partial', text: 'open my notes' }) + '\n'); });
        if (cmd === 'stop') setTimeout(() => out.write(JSON.stringify({ event: 'final', text: finalText }) + '\n'), finalAfterMs);
      }
    });
    return child;
  };
  return new Speech({ binPath: bin, spawnFn, log: { error() {} } });
}

test('after you let go of the key a slow final transcript is not waited for: the live text is used, a quick one is still used', async () => {
  const slow = speechRig(400); await slow.listen(); await new Promise((r) => setTimeout(r, 20));
  const t0 = Date.now(); assert.equal(await slow.finishFast(80), 'open my notes'); assert.ok(Date.now() - t0 < 300, 'did not wait for the slow final');
  const quick = speechRig(5); await quick.listen(); await new Promise((r) => setTimeout(r, 20)); assert.equal(await quick.finishFast(500), 'open my notes please', 'the exact final when it arrives in time');
  const none = speechRig(60); await none.listen(); none.lastPartial = ''; assert.equal(await none.finishFast(20), 'open my notes please', 'nothing heard yet: waits for the real one');
  assert.match(read('src/main/askController.js'), /this\.mode === 'ask' \? await this\.speech\.finishFast\(/);
  assert.match(read('src/main/askController.js'), /: await this\.speech\.finish\(\); \/\/ a spoken request does not wait seconds/, 'dictation into other apps still waits for the exact text');
});
