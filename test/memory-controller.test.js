const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

function make(confirm = true) {
  const data = { memories: [], 'settings.memory': true };
  const c = Object.create(AskController.prototype);
  Object.assign(c, { store: { get: (k) => data[k], set: (k, v) => { data[k] = v; } }, onChange() {}, askConfirm: async () => confirm });
  return { c, data };
}

test('remember, recall and forget work through the controller, without the model', async () => {
  const { c, data } = make();
  assert.equal((await c.runMemory({ type: 'remember', fact: 'my sister is Anna' })).reply, "Okay, I'll remember that.");
  assert.equal((await c.runMemory({ type: 'remember', fact: 'my sister is Anna' })).reply, 'I already knew that.');
  assert.equal(data.memories.length, 1);
  assert.match((await c.runMemory({ type: 'recall' })).reply, /my sister is Anna/);
  assert.match(c.memoryText(), /my sister is Anna/);
  assert.match((await c.runMemory({ type: 'forget', query: 'sister' })).reply, /^Forgot it\. Sentient OS/);
  assert.equal(data.memories.length, 0);
  assert.match((await c.runMemory({ type: 'forget', query: 'sister' })).reply, /^I don't have anything about that\. Sentient OS/);
});

test('secrets are refused, and forgetting everything asks first', async () => {
  const { c, data } = make(false);
  const r = await c.runMemory({ type: 'remember', fact: 'my wifi password is hunter2' });
  assert.equal(r.status, 'failed');
  assert.equal(data.memories.length, 0);
  c.rememberFact('I am vegetarian');
  assert.equal((await c.runMemory({ type: 'forget-all' })).reply, 'Okay, I kept it all.');
  assert.equal(data.memories.length, 1);
  c.askConfirm = async () => true;
  assert.match((await c.runMemory({ type: 'forget-all' })).reply, /^Forgot everything in Relay’s local memory\. Sentient OS/);
  assert.equal(data.memories.length, 0);
});

test('local recall and forgetting do not claim to change the read-only vault or import files', async () => {
  const { c, data } = make();
  data['settings.sentient.enabled'] = true;
  assert.match((await c.runMemory({ type: 'recall' })).reply, /no local memories[\s\S]*does not include Sentient OS/);
  assert.match((await c.runMemory({ type: 'forget-all' })).reply, /Sentient OS and files in Desktop\/memory were not changed/);
  c.rememberFact('I like tea');
  assert.match((await c.runMemory({ type: 'forget', query: 'tea' })).reply, /Sentient OS and files in Desktop\/memory were not changed/);
});

test('with memory switched off nothing is shown to the model', () => {
  const { c, data } = make();
  c.rememberFact('I am vegetarian');
  data['settings.memory'] = false;
  assert.equal(c.memoryText(), '');
});

test('new explicit memories are queued once and export failure is disclosed', () => {
  const { c } = make();
  const saved = [];
  c.memoryExport = (fact) => saved.push(fact);
  assert.match(c.rememberFact('I prefer tea').reply, /Desktop\/memory/);
  assert.equal(c.rememberFact('I prefer tea').reply, 'I already knew that.');
  assert.deepEqual(saved, ['I prefer tea']);
  c.memoryExport = () => { throw new Error('disk error'); };
  assert.match(c.rememberFact('I prefer coffee').reply, /saved that in Relay, but could not create/);
});
