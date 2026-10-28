const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');


const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }
const { ConfirmHub } = require('../src/main/confirmHub');
const { InboundService } = require('../src/main/inbound');

function service({ queue = true } = {}) {
  const data = { queue: [], inboundState: { paired: true, last: 0, self: 'me@icloud.com' } };
  const store = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
  const sent = [], asked = [];
  const listeners = new Set();
  const ask = {
    addResultListener: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    remoteAsk: async (text, dev, id) => { asked.push(text); setTimeout(() => [...listeners].forEach((f) => f({ id, status: 'done', reply: `did ${text}` })), 0); }
  };
  const hub = new ConfirmHub();
  const svc = new InboundService({ store, ask, hub, exec: async () => '', send: async (to, t) => sent.push([to, t]), flagOn: (n = 'imessage') => (n === 'queue' ? queue : true) });
  svc.inbox = { reply: async (t) => { sent.push(['me@icloud.com', t]); }, unpair() {} };
  return { svc, sent, asked, data, hub };
}

test('texts that waited while the Mac slept: a later text cancels one, the rest run in order, answers are texted back', async () => {
  const { svc, sent, asked } = service();
  const now = Date.now();
  await svc.onMessages([{ text: 'email Dana the report', ts: now - 3000 }, { text: 'open notes', ts: now - 2000 }, { text: 'cancel the email one', ts: now - 1000 }], { sleptThrough: true });
  assert.deepEqual(asked, ['open notes']);
  const texts = sent.map((s) => s[1]);
  assert.ok(texts.includes('Cancelled "email Dana the report".'));
  assert.ok(texts.includes('Your Mac was asleep. Running that now.'));
  assert.ok(texts.includes('did open notes'));
});

test('with the queue switched off every text just runs, in order', async () => {
  const { svc, asked } = service({ queue: false });
  await svc.onMessages([{ text: 'one', ts: Date.now() }, { text: 'cancel the one', ts: Date.now() }], {});
  assert.deepEqual(asked, ['one', 'cancel the one']);
});

test('a risky question from a text is asked on the phone too; a yes text answers it and the Mac prompt resolves', async () => {
  const { svc, sent, hub } = service();
  svc.mine.add('r1');
  const c = Object.create(AskController.prototype);
  let resolved = null;
  Object.assign(c, { hub, inbound: svc, currentRemote: 'r1', win: { setFocusable() {} }, push() {}, reveal() {}, sound() {}, statusChanged() {}, unattended: false });
  const p = c.askConfirm({ question: 'Send the email to Dana?' }).then((y) => { resolved = y; return y; });
  await new Promise((r) => setTimeout(r, 5));
  assert.match(sent.map((s) => s[1]).join('|'), /Send the email to Dana\?.*Reply yes or no/);
  assert.equal(svc.answer('maybe'), false);
  assert.equal(svc.answer('yes'), true);
  assert.equal(await p, true);
  assert.equal(resolved, true);
});

test('answering on the Mac first tells the phone, and a request that did not come by text never asks on the phone', async () => {
  const { svc, sent, hub } = service();
  svc.mine.add('r2');
  const c = Object.create(AskController.prototype);
  Object.assign(c, { hub, inbound: svc, currentRemote: 'r2', win: { setFocusable() {} }, push() {}, reveal() {}, sound() {}, statusChanged() {}, unattended: false });
  const p = c.askConfirm({ question: 'Delete it?' });
  await new Promise((r) => setTimeout(r, 5));
  c.pendingConfirm(false);
  assert.equal(await p, false);
  await new Promise((r) => setTimeout(r, 5));
  assert.match(sent.map((s) => s[1]).join('|'), /Already answered on the Mac \(no\)/);
  const before = sent.length;
  c.currentRemote = null;
  const p2 = c.askConfirm({ question: 'Other?' });
  c.pendingConfirm(true);
  assert.equal(await p2, true);
  assert.equal(sent.length, before);
});
