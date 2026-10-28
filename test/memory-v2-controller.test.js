const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');


const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

function rig(data = {}) {
  const store = { ...data };
  const c = Object.create(AskController.prototype);
  Object.assign(c, {
    store: { get: (k) => (k === 'settings' ? { flags: { memoryV2: true }, memory: true } : k === 'settings.memory' ? true : store[k]), set: (k, v) => { store[k] = v; } },
    onChange: () => {}, prevExchange: null, currentRequest: '', noticeCount: 0,
    askOnce: async (prompt) => (/earlier_request/.test(prompt) ? '{"trigger":"open my notes","fix":"use the Obsidian vault","scope":"always","confidence":0.8}' : '["Usually codes in Python"]')
  });
  return { c, store };
}

test('a correction becomes a lesson, and the lesson comes back for a matching request only', async () => {
  const { c, store } = rig();
  c.prevExchange = { request: 'open my notes', reply: 'Opened Notes.' };
  await c.learnLesson(c.prevExchange, "no, that's wrong, I meant the Obsidian vault");
  assert.equal(store.lessons.length, 1);
  c.currentRequest = 'please open my notes';
  assert.match(c.memoryText(), /Obsidian vault/);
  assert.equal(store.lessons[0].uses, 1);
  c.currentRequest = 'what is the weather';
  assert.ok(!/Obsidian/.test(c.memoryText()));
});

test('guesses about the user stay out of requests until approved, and approval and deletion work', async () => {
  const { c, store } = rig({ history: Array.from({ length: 12 }, (_, i) => ({ status: 'done', text: `write python script ${i}` })) });
  await c.noticeAboutUser();
  assert.equal(store.inferred.length, 1);
  assert.equal(store.inferred[0].status, 'pending');
  assert.ok(!/Python/.test(c.memoryText()));
  c.memoryV2Act('inferred-approve', store.inferred[0].id);
  assert.match(c.memoryText(), /Usually codes in Python/);
  c.memoryV2Act('inferred-delete', store.inferred[0].id);
  assert.equal(store.inferred.length, 0);
  assert.equal(c.memoryV2Act('nope', 'x').ok, false);
});

test('with the switch off nothing is learned or used', () => {
  const { c } = rig();
  c.store.get = (k) => (k === 'settings' ? { memory: true } : k === 'settings.memory' ? true : k === 'lessons' ? [{ id: 'a', trigger: 'open notes', fix: 'obsidian', conf: 1, ts: Date.now() }] : undefined);
  c.currentRequest = 'open notes';
  assert.ok(!/obsidian/.test(c.memoryText()));
});
