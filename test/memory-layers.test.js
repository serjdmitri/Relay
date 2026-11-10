const test = require('node:test');
const assert = require('node:assert/strict');
const mem = require('../src/main/memory');
const { AskController } = require('../src/main/askController');

const T = (h = 15) => new Date(2026, 10, 9, h).getTime();

test('"remember for today ..." is its own layer; ordinary remembering is unchanged', () => {
  assert.deepEqual(mem.parseMemory('remember for today that I am at the library'), { type: 'remember', fact: 'I am at the library', layer: 'today' });
  assert.deepEqual(mem.parseMemory('Jarvis, for today remember my sister is visiting'), { type: 'remember', fact: 'my sister is visiting', layer: 'today' });
  assert.deepEqual(mem.parseMemory('remember that I like mornings'), { type: 'remember', fact: 'I like mornings' });
  assert.equal(mem.parseMemory('remember for today to call mom'), null, 'that is a reminder');
  assert.equal(mem.parseMemory('for today, play music'), null);
});

test('a today fact lasts until midnight, never replaces a lasting one, and is dropped the next day', () => {
  let r = mem.addFact([], 'I am vegetarian', { id: 'a', now: T() });
  r = mem.addFact(r.list, 'I am vegetarian today and tomorrow', { id: 'b', now: T(), layer: 'today' });
  assert.equal(r.added, true); assert.equal(r.list.length, 2, 'the lasting fact is still there');
  const today = r.list.find((f) => f.id === 'b'); assert.equal(today.layer, 'today'); assert.equal(today.expires, new Date(2026, 10, 10).getTime());
  assert.equal(mem.purgeExpired(r.list, T(23)).length, 2);
  assert.deepEqual(mem.purgeExpired(r.list, new Date(2026, 10, 10, 0, 1).getTime()).map((f) => f.id), ['a'], 'gone after midnight');
  assert.equal(mem.addFact(r.list, 'I am vegetarian today and tomorrow', { id: 'c', now: T(), layer: 'today' }).added, false, 'not added twice');
  assert.equal(mem.layerOf({ text: 'x' }), 'durable'); assert.equal(mem.layerOf(today), 'today');
});

test('the model sees three layers apart: lasting facts, true-for-today, and what was just talked about', () => {
  const list = [{ id: 'b', text: 'my sister is visiting', layer: 'today', expires: T(23), ts: T() }, { id: 'a', text: 'I am vegetarian', ts: T() }, { id: 'o', text: 'old plan', layer: 'today', expires: T(1), ts: T(0) }];
  const out = mem.memoryContext(list, 2400, { recent: ['Asked: weather -> Relay said: sunny'], now: T() });
  assert.match(out, /told Relay to remember[\s\S]*- I am vegetarian/); assert.match(out, /True for today only[\s\S]*- my sister is visiting/); assert.match(out, /just talked about[\s\S]*Asked: weather/);
  assert.ok(!/old plan/.test(out), 'an expired one is not shown');
  assert.ok(out.indexOf('I am vegetarian') < out.indexOf('my sister') && out.indexOf('my sister') < out.indexOf('Asked: weather'), 'durable, then today, then recent');
  assert.equal(mem.memoryContext([], 2400, { now: T() }), ''); assert.equal(mem.memoryContext([{ id: 'x', text: 'only durable', ts: 1 }]).includes('True for today'), false);
});

test('recent talk comes from the history: newest few, recent only, finished, not the agent reports, never secrets', () => {
  const now = T(); const h = (text, reply, over = {}) => ({ text, reply, status: 'done', ts: now - 60000, ...over });
  const lines = mem.recentLines([h('what is the weather', 'Sunny and 70.'), h('open notes', 'Opened.', { ts: now - 5 * 3600e3 }), h('Agent: research x', 'long report'), h('my password is hunter2', 'ok'), h('play music', 'Playing.', { status: 'failed' }), h('set a timer', 'Timer set.'), h('a', 'b'), h('c', 'd'), h('e', 'f')], now);
  assert.equal(lines.length, 4); assert.match(lines[0], /^Asked: what is the weather -> Relay said: Sunny and 70$/);
  assert.ok(lines.every((l) => !/password|Agent:|notes|music/.test(l)));
});

test('the controller: remember-for-today is stored in its own layer and not exported, and old ones are cleared when memory is read', () => {
  const data = { memories: [{ id: 'old', text: 'yesterday thing', layer: 'today', expires: Date.now() - 1000, ts: 1 }], history: [], 'settings.memory': true };
  const exported = [];
  const c = Object.create(AskController.prototype);
  Object.assign(c, { store: { get: (k) => data[k], set: (k, v) => { data[k] = v; } }, onChange() {}, memoryExport: (t) => exported.push(t) });
  const r = c.rememberFact('I am at the library', { layer: 'today' });
  assert.match(r.reply, /for today/); assert.deepEqual(exported, [], 'a fact for today is not exported for Sentient OS');
  const a = c.rememberFact('I like tea'); assert.equal(exported.length, 1, 'a lasting one still is'); assert.ok(!/for today/.test(a.reply));
  assert.ok(!data.memories.some((f) => f.id === 'old'), 'the expired one was dropped when memory was changed');
  data.memories.push({ id: 'old2', text: 'yesterday again', layer: 'today', expires: Date.now() - 1, ts: 1 });
  const text = c.memoryText();
  assert.match(text, /True for today only[\s\S]*I am at the library/); assert.ok(!/yesterday again/.test(text)); assert.ok(!data.memories.some((f) => f.id === 'old2'));
});
