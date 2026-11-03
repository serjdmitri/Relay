const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/main/research');

test('"deep research" requests are understood, and plain research or other talk is left to everything else', () => {
  for (const [t, topic] of [
    ['deep research on solid state batteries', 'solid state batteries'], ['Jarvis, do some deep research about the best budget headphones', 'the best budget headphones'],
    ['deep research: how do heat pumps work', 'how do heat pumps work'], ['research the history of the bicycle in depth', 'the history of the bicycle'],
    ['investigate sleep and memory with sources', 'sleep and memory'], ['research thoroughly: lithium recycling', 'lithium recycling']
  ]) assert.deepEqual(r.parseResearchCommand(t), { type: 'research', topic }, t);
  for (const t of ['research headphones', 'in the background, research headphones', 'what is deep research', 'deep research', 'do the research later', '']) assert.equal(r.parseResearchCommand(t), null, t);
});

test('the job states the method: queries, opening pages, cross-checking, a Note with numbered sources, and no invented sources', () => {
  const t = r.buildTask('lithium recycling');
  for (const need of ['Deep research: lithium recycling', 'fetch_page', 'agree and where they disagree', 'Note titled "Research: lithium recycling"', 'numbered source like [1]', 'never invent a source']) assert.ok(t.includes(need), need);
});

const acts = [
  { tool: 'web_search', input: { query: 'x' }, ok: true, result: '1. Page A https://a.example/one\n2. Page B https://www.b.example/two/' },
  { tool: 'fetch_page', input: { url: 'https://a.example/one' }, ok: true, result: 'Text of A. See also https://c.example/linked' },
  { tool: 'fetch_page', input: { url: 'https://d.example/never-worked' }, ok: false, result: 'failed' },
  { tool: 'notes_create', input: { title: 'Research: x', text: 'Finding [1]. Sources: [1] https://a.example/one [2] https://b.example/two [3] https://made-up.example/paper.pdf' }, ok: true, result: 'Created' }
];

test('citations are checked against what the agent really opened or saw: real ones pass, an invented one is called out', () => {
  const v = r.verifyCitations('The answer is X, per https://a.example/one.', acts);
  assert.deepEqual(v.cited.sort(), ['https://a.example/one', 'https://b.example/two', 'https://made-up.example/paper.pdf']);
  assert.deepEqual(v.unverified, ['https://made-up.example/paper.pdf']);
  assert.equal(v.read, 1, 'only one page was opened in full; the failed fetch does not count');
  assert.match(r.checkNote(v), /^\n\nCheck: 1 of 3 cited links were NOT among the pages I opened or found.*made-up\.example/);
});

test('the check ignores trailing punctuation, www, trailing slashes and fragments, and a failed fetch proves nothing', () => {
  const v = r.verifyCitations('See https://www.a.example/one/#section. And (https://b.example/two).', acts.slice(0, 2));
  assert.deepEqual(v.unverified, []);
  const failedOnly = r.verifyCitations('Source: https://d.example/never-worked', [acts[2]]);
  assert.deepEqual(failedOnly.unverified, ['https://d.example/never-worked']);
});

test('the note on the result: all good, nothing cited, or some unverified', () => {
  assert.match(r.checkNote(r.verifyCitations('See https://a.example/one', acts.slice(0, 2))), /all 1 cited link were pages I opened or found in search results \(1 page read in full\)/);
  assert.match(r.checkNote(r.verifyCitations('No links here.', [])), /cites no links, so I could not verify any sources/);
  assert.deepEqual(r.verifyCitations('x', null).cited, []);
});

test('the controller starts the research as a background agent and appends the citation check when it finishes', async () => {
  const Module = require('module'), orig = Module._load;
  Module._load = function (req, ...a) { return req === 'electron' ? { app: {}, BrowserWindow: class {}, screen: {}, clipboard: {}, desktopCapturer: {}, safeStorage: {}, systemPreferences: {}, nativeImage: {}, ipcMain: { handle() {} }, shell: {}, Notification: class {} } : orig.call(this, req, ...a); };
  let AskController;
  try { delete require.cache[require.resolve('../src/main/askController')]; ({ AskController } = require('../src/main/askController')); } finally { Module._load = orig; }
  const c = Object.create(AskController.prototype);
  const started = [], history = [], stored = { actions: acts.map((a) => ({ ...a, requestId: 'ag1' })) };
  c.agents = { submit: (task) => { started.push(task); return { started: true, id: 'ag1' }; }, history: [{ id: 'ag1', task: 'Deep research: x', status: 'done', result: 'Answer, see https://a.example/one and https://made-up.example/paper.pdf' }] };
  c.store = { get: (k) => stored[k], addHistory: (h) => history.push(h), set() {} };
  c.sound = () => {}; c.onChange = () => {}; c.onProactive = () => {}; c.phone = null; c.researchIds = new Set();
  const out = c.researchCommand({ type: 'research', topic: 'lithium recycling' });
  assert.equal(out.status, 'done'); assert.match(out.reply, /Started deep research on lithium recycling/); assert.match(started[0], /^Deep research: lithium recycling/); assert.ok(c.researchIds.has('ag1'));
  const a = { id: 'ag1', task: 'Deep research: x', status: 'done', result: 'Answer, see https://a.example/one and https://made-up.example/paper.pdf', steps: 4 };
  c.agentFinished(a);
  assert.match(a.result, /Check: 2 of 4 cited links|Check: 1 of \d cited links were NOT/); assert.match(c.agents.history[0].result, /made-up\.example/); assert.match(history[0].reply, /Check:/);
  const plain = { id: 'other', task: 'Summarize my notes', status: 'done', result: 'ok', steps: 1 }; c.agentFinished(plain); assert.equal(plain.result, 'ok', 'only research jobs are checked');
});
