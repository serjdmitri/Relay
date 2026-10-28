const test = require('node:test');
const assert = require('node:assert/strict');
const { ClipboardHistory, looksSecret, parseClipboardCommand } = require('../src/main/clipboardHistory');
const { parseQuick, runQuick } = require('../src/main/quick');

test('what must never be remembered: keys, tokens, cards, social security numbers, labelled passwords and generated passwords', () => {
  for (const s of ['sk-abc123def456ghi789jkl012mno', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'AKIAIOSFODNN7EXAMPLE', 'xoxb-1234567890-abcdefghij', '-----BEGIN RSA PRIVATE KEY-----\nMIIE', 'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4', '4111 1111 1111 1111', '4111-1111-1111-1111', '123-45-6789', 'password: hunter2', 'my token is abc123', 'Tr0ub4dor&3xyz', 'kX9#mP2$vL8@']) assert.equal(looksSecret(s), true, s);
  for (const s of ['https://example.com/a/b?c=d', 'hello world', 'sergey@school.org', 'robotics_team_2026.pdf', '~/Documents/Notes/essay.txt', 'Call mom at 5 pm tomorrow', '1234 5678 9012 3456', 'The password policy requires 12 characters', '/Users/sam/Downloads/file.zip', 'AP Lit essay due Friday', '3.14159265358979']) assert.equal(looksSecret(s), false, s);
});

function rig(cfg = { enabled: true, minutes: 1440 }) {
  let now = 1_000_000;
  const cb = { text: '', formats: ['text/plain'] };
  const h = new ClipboardHistory({ read: () => ({ ...cb, formats: [...cb.formats] }), getConfig: () => cfg, now: () => now });
  return { h, cb, cfg, at: (m) => { now += m * 60000; }, copy: (text, formats) => { cb.text = text; cb.formats = formats || ['text/plain']; return h.tick(); } };
}

test('each copy is recorded once, newest first, repeats move to the top, and secrets and concealed copies are skipped', () => {
  const r = rig();
  assert.equal(r.copy('first thing'), true);
  assert.equal(r.h.tick(), false, 'the same clipboard seen again is not a new copy');
  r.at(1); r.copy('second thing');
  r.at(1); r.copy('first thing');
  assert.deepEqual(r.h.list().map((i) => i.text), ['first thing', 'second thing']);
  assert.equal(r.copy('password: hunter2'), false);
  assert.equal(r.copy('looks fine but from a password manager', ['text/plain', 'org.nspasteboard.ConcealedType']), false);
  assert.equal(r.copy('sk-abc123def456ghi789jkl012mno'), false);
  assert.equal(r.h.items.length, 2);
  assert.equal(r.h.skipped, 3);
  assert.equal(r.copy('   '), false);
});

test('entries expire, can be found by what they say or when they were copied, and can be cleared; turned off, nothing is recorded', () => {
  const r = rig({ enabled: true, minutes: 60 });
  r.copy('the robotics link https://example.com/robot');
  r.at(30); r.copy('essay outline about Othello');
  r.at(20); r.copy('grocery list');
  assert.equal(r.h.find('the link about robotics').text.startsWith('the robotics link'), true);
  assert.equal(r.h.find('othello outline').text, 'essay outline about Othello');
  assert.equal(r.h.find('zebra'), null);
  assert.equal(r.h.ago(50).text.startsWith('the robotics link'), true, 'about 50 minutes ago');
  assert.equal(r.h.ago(20).text, 'essay outline about Othello');
  r.at(20); r.h.tick();
  assert.deepEqual(r.h.list().map((i) => i.text), ['grocery list', 'essay outline about Othello'], 'the oldest passed the hour');
  assert.equal(r.h.clear(), 2);
  assert.equal(r.h.items.length, 0);
  r.cfg.enabled = false;
  assert.equal(r.copy('while it is off'), false);
  assert.equal(r.h.items.length, 0);
});

test('the phrases', () => {
  const P = parseClipboardCommand;
  assert.deepEqual(P('what did I copy earlier'), { type: 'clip-list' });
  assert.deepEqual(P('show my clipboard history'), { type: 'clip-list' });
  assert.deepEqual(P('what did I copy ten minutes ago'), { type: 'clip-ago', minutes: 10 });
  assert.deepEqual(P('what did I copy an hour ago'), { type: 'clip-ago', minutes: 60 });
  assert.deepEqual(P('copy the second one'), { type: 'clip-copy', index: 2 });
  assert.deepEqual(P('paste the third thing I copied'), { type: 'clip-paste', index: 3 });
  assert.deepEqual(P('copy the link about robotics'), { type: 'clip-find', query: 'robotics', paste: false });
  assert.deepEqual(P('paste the one about the essay'), { type: 'clip-find', query: 'the essay', paste: true });
  assert.deepEqual(P('clear my clipboard history'), { type: 'clip-clear' });
  assert.deepEqual(P('turn off clipboard history'), { type: 'clip-off' });
  assert.deepEqual(P('turn on clipboard history'), { type: 'clip-on' });
  for (const t of ['open notes', 'what did I do earlier', 'paste', 'copy this']) assert.equal(P(t), null, t);
  assert.equal(parseQuick('what did I copy earlier').type, 'clip-list');
  assert.equal(parseQuick('copy the second one').type, 'clip-copy');
});

test('quick commands hand it to the app, and leave it to the model when there is no history', async () => {
  const seen = [];
  assert.equal((await runQuick(parseQuick('what did I copy earlier'), {}, { clipboardHistory: async (c) => { seen.push(c.type); return 'You copied: x'; } })).reply, 'You copied: x');
  assert.equal(await runQuick(parseQuick('what did I copy earlier'), {}, {}), null);
  assert.deepEqual(seen, ['clip-list']);
});

const Module = require('node:module');
const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

test('by voice: list, found again, copied back, pasted, cleared, switched off; and what Relay itself writes is not a copy by you', async () => {
  const r = rig();
  r.copy('The Eiffel Tower is 330 metres tall');
  r.at(5); r.copy('https://example.com/robotics-club');
  r.at(5); r.copy('essay outline about Othello');
  const written = [], typed = [], shown = [];
  const data = { 'settings.clipboardHistory': { enabled: true, minutes: 1440 } };
  const c = Object.create(AskController.prototype);
  Object.assign(c, { clipHistory: r.h, store: { get: (k) => data[k], set: (k, v) => { data[k] = v; } }, mac: { clipboardWrite: async (t) => { written.push(t); }, typeText: async (t) => { typed.push(t); } }, cardPanel: { show: async (card) => { shown.push(card); } } });
  const list = await c.clipboardCommand({ type: 'clip-list' });
  assert.match(list, /You copied 3 things\. The latest: “essay outline about Othello”, just now\. Before that: “https:\/\/example.com\/robotics-club”/);
  assert.deepEqual(shown[0].items.map((i) => i.title), ['essay outline about Othello', 'https://example.com/robotics-club', 'The Eiffel Tower is 330 metres tall']);
  assert.match(await c.clipboardCommand({ type: 'clip-copy', index: 2 }), /Copied it back: “https:\/\/example.com\/robotics-club”/);
  assert.deepEqual(written, ['https://example.com/robotics-club']);
  assert.equal(r.h.ignored.has('https://example.com/robotics-club'), true, 'putting it back is not a new copy');
  assert.match(await c.clipboardCommand({ type: 'clip-find', query: 'eiffel' }), /Found it, copied 10 minutes ago/);
  assert.match(await c.clipboardCommand({ type: 'clip-find', query: 'othello', paste: true }), /Pasted: “essay outline/);
  assert.deepEqual(typed, ['essay outline about Othello']);
  assert.match(await c.clipboardCommand({ type: 'clip-ago', minutes: 10 }), /About 10 minutes ago you copied: “The Eiffel Tower is 330 metres tall”/);
  assert.match(await c.clipboardCommand({ type: 'clip-ago', minutes: 5 }), /“https:\/\/example.com\/robotics-club”/);
  assert.match(await c.clipboardCommand({ type: 'clip-copy', index: 9 }), /I only have 3 items/);
  assert.match(await c.clipboardCommand({ type: 'clip-clear' }), /Forgot 3 items/);
  assert.match(await c.clipboardCommand({ type: 'clip-list' }), /not seen anything copied yet/);
  assert.match(await c.clipboardCommand({ type: 'clip-off' }), /Clipboard history is off/);
  assert.equal(data['settings.clipboardHistory.enabled'], false);
  data['settings.clipboardHistory'] = { enabled: false };
  assert.match(await c.clipboardCommand({ type: 'clip-list' }), /is off\. Say “turn on clipboard history”/);
  // a write Relay made itself (the app marks it) is skipped by the next look at the clipboard
  r.cfg.enabled = true;
  r.h.ignore('typed by relay');
  assert.equal(r.copy('typed by relay'), false);
  assert.equal(r.copy('typed by you'), true);
});
