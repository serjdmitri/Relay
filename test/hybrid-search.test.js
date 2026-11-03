const test = require('node:test');
const assert = require('node:assert/strict');
const hs = require('../src/main/hybridSearch');

const DOCS = [
  { id: 'memory:1', source: 'memory', title: '', text: 'I am vegetarian and allergic to peanuts', ts: 3 },
  { id: 'memory:2', source: 'memory', title: '', text: 'My sister Anna lives in Boston', ts: 2 },
  { id: 'session:1', source: 'session notes', title: 'Car trouble', text: 'Asked about my vehicle that broke down on the highway and how to get it towed', ts: 5 },
  { id: 'obsidian:trip.md', source: 'Obsidian', title: 'trip plan', text: 'Flights to Boston in March. Hotel near the harbor. Visit Anna on the second weekend. '.repeat(3), ts: 4 },
  { id: 'obsidian:recipes.md', source: 'Obsidian', title: 'recipes', text: 'Lentil soup, mushroom risotto, peanut-free pesto for guests', ts: 1 }
];
const idx = () => { const i = new hs.HybridIndex(); i.set(DOCS); return i; };

test('keyword search ranks by how rare and how relevant the words are, counts titles, and finds plurals', async () => {
  const r = await idx().search('Anna Boston');
  assert.deepEqual(r.slice(0, 2).map((x) => x.doc.id).sort(), ['memory:2', 'obsidian:trip.md']);
  assert.equal((await idx().search('car trouble'))[0].doc.id, 'session:1', 'a title match wins');
  assert.equal((await idx().search('peanut'))[0].doc.id, 'memory:1', 'peanut finds peanuts, and the short note beats the long one');
  assert.deepEqual(await idx().search('zebra xylophone'), []); assert.deepEqual(await idx().search('the and for'), [], 'only filler words');
  assert.equal(new hs.HybridIndex().bm25('anything').length, 0);
});

test('every hit carries a snippet around the matching words, and long notes are shortened with dots', async () => {
  const r = await idx().search('harbor');
  assert.match(r[0].snippet, /harbor/); assert.ok(r[0].snippet.length <= 160);
  assert.equal(hs.snippet('short text', ['short']), 'short text');
});

// a tiny fake embedder with "meaning": words in the same family point the same way
const FAMILY = [['car', 'vehicle', 'auto', 'broke', 'towed', 'highway'], ['sister', 'sibling', 'anna', 'family'], ['vegetarian', 'allergic', 'peanuts', 'food', 'recipes', 'soup']];
const embed = async (text) => { const w = hs.tokens(text); return FAMILY.map((f) => f.reduce((n, k) => n + (w.includes(hs.tokens(k)[0]) ? 1 : 0), 0)).concat([0.01]); };

test('meaning search finds notes that share no words with the question, and the two rankings are fused', async () => {
  const i = idx();
  assert.deepEqual(await i.search('automobile breakdown'), [], 'keyword search alone cannot');
  const done = await i.embedMissing(embed); assert.deepEqual(done, { embedded: 5, remaining: 0 });
  const r = await i.search('my auto broke', { embed });
  assert.equal(r[0].doc.id, 'session:1'); assert.ok(r[0].via.includes('meaning'));
  const both = await i.search('vehicle towed highway', { embed }); assert.deepEqual(both[0].via.sort(), ['keyword', 'meaning']);
  assert.equal((await i.search('zebra', { embed })).length, 0, 'unrelated: below the similarity floor');
  const broken = await i.search('car trouble', { embed: async () => { throw new Error('ollama stopped'); } });
  assert.equal(broken[0].doc.id, 'session:1', 'if the embedder fails, keyword results still come back');
});

test('embedding fills in gradually, skips what is done, drops stale vectors when a note changes, and saves and restores', async () => {
  const i = idx(); let calls = 0; const counted = async (t) => { calls++; return embed(t); };
  assert.deepEqual(await i.embedMissing(counted, { limit: 2 }), { embedded: 2, remaining: 3 });
  assert.deepEqual(await i.embedMissing(counted, { limit: 10 }), { embedded: 3, remaining: 0 }); assert.equal(calls, 5);
  const saved = JSON.parse(JSON.stringify(i.export())); assert.equal(i.changed, false);
  const j = new hs.HybridIndex(); j.import(saved); j.set(DOCS); assert.equal((await j.embedMissing(counted)).embedded, 0, 'restored vectors are reused');
  j.set(DOCS.map((d) => (d.id === 'memory:2' ? { ...d, text: 'My sister Anna moved to Denver' } : d)));
  assert.deepEqual(await j.embedMissing(counted), { embedded: 1, remaining: 0 }); assert.equal(calls, 6, 'only the changed note was embedded again');
  j.set(DOCS.slice(0, 2)); assert.deepEqual([...j.vectors.keys()], ['memory:1'], 'notes that are gone, or that differ from what was embedded, lose their vectors');
  const bad = new hs.HybridIndex(); bad.import({ version: 9 }); bad.import(null); bad.import({ version: 1, vectors: { x: { h: 1, v: 'no' } } }); assert.equal(bad.vectors.size, 0);
});

test('Ollama is only ever asked on this Mac, and a missing server or model is explained in plain words', async () => {
  const urls = [];
  assert.deepEqual(await hs.ollamaStatus({ get: async (u) => { urls.push(u); return { models: [{ name: 'nomic-embed-text:latest' }] }; } }), { ok: true });
  assert.match((await hs.ollamaStatus({ get: async () => ({ models: [{ name: 'llama3' }] }) })).why, /ollama pull nomic-embed-text/);
  assert.match((await hs.ollamaStatus({ get: async () => { throw new Error('ECONNREFUSED'); } })).why, /keyword search only/);
  const posted = []; const v = await hs.ollamaEmbedder({ post: async (u, b) => { posted.push([u, b]); return { embedding: [1, 2, 3] }; } })('hello');
  assert.deepEqual(v, [1, 2, 3]); assert.ok([...urls, posted[0][0]].every((u) => u.startsWith('http://127.0.0.1:11434/'))); assert.equal(posted[0][1].model, 'nomic-embed-text');
});

test('voice: searching your notes is understood, and recall questions and other talk are left alone', () => {
  for (const [t, q] of [['search my notes for the trip to Boston', 'the trip to Boston'], ['Jarvis, search my memory for peanut allergy', 'peanut allergy'], ['what do my notes say about taxes', 'taxes'], ['find notes about heat pumps', 'heat pumps'], ['look through my obsidian notes for recipes', 'recipes']]) assert.deepEqual(hs.parseSearchCommand(t), { type: 'search', query: q }, t);
  for (const t of ['what do you remember about me', 'search the web for headphones', 'find my keys', 'notes', 'search my notes']) assert.equal(hs.parseSearchCommand(t), null, t);
});

test('the controller searches memory, session notes and the Obsidian vault together, skips secrets, and says what it used', async () => {
  const Module = require('module'), orig = Module._load;
  Module._load = function (req, ...a) { return req === 'electron' ? { app: { getPath: () => '/tmp' }, BrowserWindow: class {}, screen: {}, clipboard: {}, desktopCapturer: {}, safeStorage: {}, systemPreferences: {}, nativeImage: {}, ipcMain: { handle() {} }, shell: {}, Notification: class {} } : orig.call(this, req, ...a); };
  let AskController;
  try { delete require.cache[require.resolve('../src/main/askController')]; ({ AskController } = require('../src/main/askController')); } finally { Module._load = orig; }
  const c = Object.create(AskController.prototype);
  const data = {
    memories: [{ id: 'a', text: 'My sister Anna lives in Boston', ts: 1 }, { id: 'b', text: 'my password is hunter2xyz', ts: 2 }],
    sessionNotes: [{ title: 'Trip chat', entries: [{ id: 'e1', request: 'plan a trip to Boston', reply: 'Book flights for March', ts: 3 }] }],
    'settings.memory': true, 'settings.obsidian.vault': ''
  };
  c.store = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
  c.semanticFile = null; c.httpGet = async () => { throw new Error('no ollama'); }; c.httpPost = async () => { throw new Error('no ollama'); };
  const r = await c.searchMemory({ type: 'search', query: 'Boston' });
  assert.equal(r.status, 'done'); assert.match(r.reply, /Found 2/); assert.match(r.reply, /\[memory\].*Anna/); assert.match(r.reply, /\[session notes\] Trip chat/);
  assert.match(r.reply, /keyword search only/); assert.equal(r.reply.includes('hunter2'), false, 'a remembered secret is never indexed or read out');
  assert.match((await c.searchMemory({ type: 'search', query: 'zebra' })).reply, /found nothing about zebra/);
  data['settings.memory'] = false;
  assert.match((await c.searchMemory({ type: 'search', query: 'Boston' })).reply, /found nothing/, 'with memory turned off, memory and session notes are not searched');
});
