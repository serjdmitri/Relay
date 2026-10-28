const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { buildTools } = require('../src/main/agent/tools');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

function rig({ text = 'Write a function that reverses a linked list.', cfg = {} } = {}) {
  const data = { 'settings.homework': { full: true, explain: true, format: 'docx', voiceSample: '', voiceStyle: '', ...cfg } };
  const c = Object.create(AskController.prototype);
  const ran = [], set = [], finished = [];
  Object.assign(c, {
    store: { get: (k) => data[k], set: (k, v) => { set.push([k, v]); } },
    gatherText: async () => ({ text, from: 'selection' }),
    runRequest: async (prompt, entry) => { ran.push({ prompt, tier: c.forceTier }); return { status: 'done', reply: 'Saved it.', actions: 1 }; },
    finish: (entry, res) => { finished.push(res); return res; }, forceTier: null
  });
  return { c, ran, set, finished };
}

test('a homework request reads the assignment, asks the model for the long work on a stronger model, and uses the settings', async () => {
  const r = rig({ cfg: { format: 'pdf', voiceSample: 'I write like this.' } });
  await r.c.homeworkCommand({ type: 'homework', mode: 'full', topic: '', voice: false }, { id: 'e1' });
  assert.equal(r.ran.length, 1);
  assert.equal(r.ran[0].tier, 'sonnet');
  assert.match(r.ran[0].prompt, /<material>\nWrite a function that reverses a linked list\.\n<\/material>/);
  assert.match(r.ran[0].prompt, /complete working project/);
  assert.match(r.ran[0].prompt, /make_document with format "pdf"/);
  assert.match(r.ran[0].prompt, /I write like this\./);
  const off = rig({ cfg: { full: false } });
  await off.c.homeworkCommand({ type: 'homework', mode: 'full', topic: '', voice: false }, { id: 'e2' });
  assert.match(off.ran[0].prompt, /template to fill in/, 'whole solutions switched off');
  const chk = rig();
  await chk.c.homeworkCommand({ type: 'homework', mode: 'check', topic: '42', voice: false }, { id: 'e3' });
  assert.equal(chk.ran[0].tier, null, 'a quick check does not need the strong model');
});

test('with a topic no reading is needed; with nothing to read it says what to do; the writing sample is saved from a selection', async () => {
  const t = rig({ text: '' });
  await t.c.homeworkCommand({ type: 'homework', mode: 'draft', topic: 'android rights', voice: true }, { id: 'e' });
  assert.equal(t.ran.length, 1);
  assert.match(t.ran[0].prompt, /Topic given by the student: android rights/);
  const none = rig({ text: '' });
  await none.c.homeworkCommand({ type: 'homework', mode: 'walkthrough', topic: '', voice: false }, { id: 'e' });
  assert.equal(none.ran.length, 0);
  assert.match(none.finished[0].reply, /could not read the assignment/);
  const v = rig({ text: 'One important moment in the game shows that androids can make independent choices, yet they are still treated as machines.' });
  await v.c.homeworkCommand({ type: 'homework-voice' }, { id: 'e' });
  assert.equal(v.set[0][0], 'settings.homework.voiceSample');
  assert.match(v.finished[0].reply, /Saved your writing sample \(\d+ words\)/);
  const noText = rig({ text: '' });
  await noText.c.homeworkCommand({ type: 'homework-voice' }, { id: 'e' });
  assert.match(noText.finished[0].reply, /Select a piece of your own writing/);
});

test('the model gets make_document and save_files only in homework mode, and they save through the helper', async () => {
  const saved = [];
  const homework = { saveDocument: async (a) => { saved.push(['doc', a]); return { path: '/h/Relay Homework/Essay 2026-10-28.docx', format: 'docx', note: '' }; }, saveFiles: async (a) => { saved.push(['files', a]); return { path: '/h/Relay Homework/Lab', files: ['main.py', 'README.md'] }; } };
  const without = buildTools({ mac: {}, firefox: null, overlay: {}, getScale: () => 1 });
  assert.ok(!without.some((t) => t.name === 'make_document'));
  const tools = buildTools({ mac: {}, firefox: null, overlay: {}, getScale: () => 1, homework });
  const doc = tools.find((t) => t.name === 'make_document');
  const files = tools.find((t) => t.name === 'save_files');
  assert.match(await doc.run({ title: 'Essay', markdown: '# x', format: 'weird' }), /Saved Essay 2026-10-28\.docx \(docx\)/);
  assert.equal(saved[0][1].format, 'docx', 'an unknown format falls back to Word');
  assert.match(await files.run({ folder: 'Lab', files: [{ name: 'main.py', content: 'x' }] }), /Saved 2 files \(main\.py, README\.md\) in Documents\/Relay Homework\/Lab/);
  assert.equal(doc.confirm, undefined, 'it only writes new files inside its own folder, so there is no question');
});
