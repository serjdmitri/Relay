const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecap, parseRecapCommand, line } = require('../src/main/recap');

const now = new Date(2026, 9, 28, 20, 30).getTime();
const at = (h, m = 0) => new Date(2026, 9, 28, h, m).getTime();
const A = (id, tool, input = {}, extra = {}) => ({ id, requestId: 'r', tool, input, result: 'ok', ok: true, ts: at(10), ...extra });

test('the phrases for the recap', () => {
  for (const t of ['daily recap', 'recap my day', "what did you do today", 'what did Relay do today', 'give me a recap', "what have you done today", 'summary of my day']) assert.deepEqual(parseRecapCommand(t), { type: 'recap' }, t);
  for (const t of ['what did I do yesterday', 'recap the meeting', 'what is the weather today', 'what did the teacher say']) assert.equal(parseRecapCommand(t), null, t);
});

test('the recap counts what changed, points out what is worth a look, says what can be undone, and ignores yesterday and plain lookups', () => {
  const actions = [
    A('a1', 'notes_create', { title: 'Plan' }), A('a2', 'notes_create', { title: 'Ideas' }), A('a3', 'open_app', { name: 'Safari' }),
    A('a4', 'trash_path', { path: '/Users/s/Downloads/old.zip' }, { ts: at(12) }), A('a5', 'messages_send', { to: 'Sam', text: 'my secret plan' }, { ts: at(13) }),
    A('a6', 'run_shell', { command: 'ls -la ~/Documents && echo hi' }, { ts: at(14) }), A('a7', 'web_search', { query: 'x' }), A('a8', 'ui_list', {}), A('a9', 'run_shell', { command: 'bad' }, { ok: false }),
    A('a10', 'notes_create', {}, { ts: new Date(2026, 9, 27, 22).getTime() }), A('a11', 'undo', {}), A('a12', 'drive_apply', {}, { result: 'Moved 18 files into 4 folders.', ts: at(15) })
  ];
  const history = [{ ts: at(9), text: 'make a note' }, { ts: at(11), text: 'open safari' }, { ts: at(12), text: 'Agent: research' }, { ts: new Date(2026, 9, 27, 9).getTime(), text: 'old' }];
  const r = buildRecap({ actions, history, now, undoable: new Set(['a3', 'a12']) });
  assert.equal(r.requests, 2);
  assert.equal(r.changed, 7, 'lookups, failures, yesterday and undo entries are not changes');
  assert.equal(r.failed, 1);
  assert.equal(r.undoable, 2);
  assert.match(r.spoken, /^Today you made 2 requests and I took 7 actions that changed something: .*created notes 2 times/);
  assert.match(r.spoken, /3 are worth a look: ran a command: ls -la ~\/Documents && echo hi; sent a message to Sam; moved old\.zip to the Trash\./);
  assert.match(r.spoken, /2 can be undone with one tap\. 1 did not work\. The list is in History/);
  assert.deepEqual(r.items.slice(0, 3).map((x) => x.risk), [2, 2, 2], 'the riskiest come first');
  assert.equal(r.items.find((x) => x.id === 'a12').undoable, true);
  assert.ok(r.items.every((x) => !/secret/.test(x.text)), 'message text is never repeated');
  assert.equal(r.items.find((x) => /Ran a command/.test(x.text)).text, 'Ran a command: ls -la ~/Documents && echo hi');
});

test('a quiet day, an empty day and typed text', () => {
  assert.match(buildRecap({ actions: [], history: [], now }).spoken, /have not done anything today/);
  assert.match(buildRecap({ actions: [], history: [{ ts: at(9), text: 'what time is it' }], now }).spoken, /^Today you made 1 request and I changed nothing\./);
  assert.equal(line(A('x', 'type_text', { text: 'hunter2 is my password' })), 'Typed 22 characters for you', 'never the text itself');
  assert.equal(line(A('x', 'mystery_tool')), 'Mystery tool');
});

const Module = require('node:module');
test('asking for the recap says it, opens the list only when there is something in it, and uses what can be undone right now', () => {
  const real = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
  let AskController;
  try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }
  const c = Object.create(AskController.prototype);
  const t = Date.now();
  const data = { actions: [{ id: 'z1', tool: 'messages_send', input: { to: 'Sam' }, result: 'sent', ok: true, ts: t }], history: [{ ts: t, text: 'text sam' }] };
  let opened = 0;
  Object.assign(c, { store: { data }, undos: { ids: () => new Set() }, onOpenRecap: () => { opened++; } });
  const r = c.recapCommand();
  assert.match(r.reply, /sent a message to Sam/);
  assert.equal(opened, 1);
  data.actions = []; data.history = [];
  assert.match(c.recapCommand().reply, /have not done anything today/);
  assert.equal(opened, 1, 'nothing to look at, so the window stays shut');
});
