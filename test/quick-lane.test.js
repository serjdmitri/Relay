const test = require('node:test'), assert = require('node:assert/strict');
const Module = require('node:module');
const { QuickLane, eligible, spoken, MODELS, DEFAULT_MODEL } = require('../src/main/quickLane');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, nativeImage: {}, safeStorage: { isEncryptionAvailable: () => false } } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

const KEY = 'gsk_test_key_123';
const ok = (content, finish = 'stop') => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content }, finish_reason: finish }] }) });
const bad = (status, retry) => ({ ok: false, status, headers: { get: (h) => (h === 'retry-after' && retry != null ? String(retry) : null) }, json: async () => ({}) });
function lane(handler, over = {}) {
  const calls = [], clock = { t: 1_000_000 };
  const l = new QuickLane({ getKey: () => KEY, settings: () => ({ enabled: true, model: DEFAULT_MODEL, ...over }), now: () => clock.t, fetchFn: async (url, options) => { calls.push({ url, options, body: JSON.parse(options.body) }); return handler(calls.length, url, options); } });
  return { l, calls, clock };
}

test('plain, timeless questions qualify; anything personal, timely, on the Mac or needing a tool does not', () => {
  for (const t of ['what is 15% of 80', 'what is 3/4 of 100', 'who painted the Mona Lisa', 'how do you spell necessary', "what's the capital of Australia", 'convert 5 miles to kilometers', 'tell me a joke', 'how many ounces are in a pound', 'what does serendipity mean', 'translate good morning to Spanish', 'why is the sky blue', 'is a tomato a fruit', 'define photosynthesis', '12 * (3 + 4)']) assert.equal(eligible(t).ok, true, t);
  for (const t of ["what's on my calendar", 'open Safari', "what's the weather", 'what time is it', "what's the news", 'write a python function that sorts a list', 'play some music', 'who are you', 'remember that I like tea', 'what is this', 'summarize this article', 'email my teacher', "what's the price of bitcoin", 'who won the game last night', 'turn up the volume', 'set a timer for 5 minutes', 'what is in my downloads', 'who is the president', 'what can you do', 'how do I open /Users/me/file', 'what is https://example.com', 'what is today', 'what is your name', 'how do I fix this error', 'what is on my screen']) assert.equal(eligible(t).ok, false, t);
  assert.equal(eligible('what is ' + 'very '.repeat(25) + 'long').why, 'long');
  assert.equal(eligible('[Homework] what is 2 plus 2').why, 'mode');
  assert.equal(eligible('').why, 'empty'); assert.equal(eligible('pizza party').why, 'shape');
});

test('the request is one Groq chat call with only the question: no memory, context or tools', async () => {
  const { l, calls } = lane(async () => ok('Canberra.'));
  const r = await l.answer("What's the capital of Australia?");
  assert.deepEqual([r.reply, r.model], ['Canberra.', DEFAULT_MODEL]);
  const { url, options, body } = calls[0];
  assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.equal(options.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
  assert.equal(body.messages[1].content, "What's the capital of Australia?");
  assert.match(body.messages[0].content, /ESCALATE/);
  assert.equal(body.stream, false); assert.ok(body.max_tokens <= 256); assert.equal(body.tools, undefined);
  assert.ok(!options.body.includes(KEY), 'the key travels only in the header');
});

test('up to three earlier quick exchanges from the last ten minutes carry follow-ups, and nothing else is remembered', async () => {
  const { l, calls, clock } = lane(async (n) => ok(`Answer ${n}.`));
  for (const q of ['who wrote Hamlet', 'where was he born', 'what else did he write', 'why is he famous']) { await l.answer(q); clock.t += 1000; }
  const last = calls[3].body.messages.slice(1).map((m) => m.role + ':' + m.content);
  assert.deepEqual(last, ['user:who wrote Hamlet', 'assistant:Answer 1.', 'user:where was he born', 'assistant:Answer 2.', 'user:what else did he write', 'assistant:Answer 3.', 'user:why is he famous']);
  clock.t += 11 * 60 * 1000; await l.answer('what is 2 plus 2');
  assert.deepEqual(calls[4].body.messages.map((m) => m.role), ['system', 'user'], 'older than ten minutes is forgotten');
  l.reset(); assert.deepEqual(l.turns, []);
  const e = lane(async () => ok('ESCALATE')); await e.l.answer('what is 2 plus 2'); assert.deepEqual(e.l.turns, [], 'a passed-on question is not kept');
});

test('the model can hand a question back with ESCALATE, and its answer is cleaned for speaking', async () => {
  for (const reply of ['ESCALATE', 'escalate.', '  Escalate\n', '"ESCALATE"']) { const { l } = lane(async () => ok(reply)); assert.equal(await l.answer('what is 2 plus 2'), null, reply); assert.equal(l.last.outcome, 'escalated'); }
  const { l } = lane(async () => ok('You should not ESCALATE a conflict at work.')); assert.ok(await l.answer('how do you calm a conflict'), 'the word inside a sentence is just an answer');
  assert.equal(spoken('**Bold** and `code` and # head\n- item one\n- item two'), 'Bold and code and head item one item two');
  assert.equal(spoken('The first sentence is long enough to keep. The second one gets cut off mid thought because of the token', 'length'), 'The first sentence is long enough to keep.');
  assert.equal(spoken('Short. Cut off here because', 'length'), 'Short. Cut off here because', 'a very short start is not cut down to almost nothing');
  assert.equal(spoken('First sentence here is quite long. Second sentence ends properly.', 'length'), 'First sentence here is quite long. Second sentence ends properly.');
  assert.equal(await lane(async () => ok('   ')).l.answer('what is 2 plus 2'), null);
});

test('rate limits, a rejected key and repeated failures pause the lane, and the normal path answers meanwhile', async () => {
  const rate = lane(async () => bad(429, 30));
  assert.equal(await rate.l.answer('what is 2 plus 2'), null); assert.equal(rate.l.last.outcome, 'rate-limited');
  assert.equal(await rate.l.answer('what is 3 plus 3'), null); assert.equal(rate.calls.length, 1, 'no new call while paused'); assert.equal(rate.l.last.outcome, 'paused');
  rate.clock.t += 31_000; await rate.l.answer('what is 4 plus 4'); assert.equal(rate.calls.length, 2, 'tries again after the wait');
  const key = lane(async () => bad(401)); await key.l.answer('what is 2 plus 2');
  assert.equal(key.l.keyProblem, true); assert.equal(key.l.last.outcome, 'key-rejected'); key.clock.t += 5 * 60 * 1000; await key.l.answer('what is 3 plus 3'); assert.equal(key.calls.length, 1, 'a rejected key is not hammered for ten minutes');
  let n = 0; const flaky = lane(async () => { n++; if (n <= 2) throw Error('socket reset'); return ok('Four.'); });
  assert.equal(await flaky.l.answer('what is 2 plus 2'), null); assert.equal(flaky.l.paused(), false, 'one failure does not pause');
  assert.equal(await flaky.l.answer('what is 2 plus 2'), null); assert.equal(flaky.l.paused(), true, 'two in a row pause for a minute');
  flaky.clock.t += 61_000; assert.equal((await flaky.l.answer('what is 2 plus 2')).reply, 'Four.'); assert.equal(flaky.l.failures, 0);
  const slow = lane(async () => bad(503)); assert.equal(await slow.l.answer('what is 2 plus 2'), null); assert.equal(slow.l.last.outcome, 'failed');
});

test('off without a key or when switched off; ineligible questions never leave the Mac', async () => {
  const none = new QuickLane({ getKey: () => '', settings: () => ({ enabled: true }), fetchFn: async () => { throw Error('should not be called'); } });
  assert.equal(await none.answer('what is 2 plus 2'), null); assert.equal(none.last.outcome, 'off');
  const off = lane(async () => ok('x'), { enabled: false }); assert.equal(await off.l.answer('what is 2 plus 2'), null); assert.equal(off.calls.length, 0);
  const priv = lane(async () => ok('x')); for (const t of ["what's on my calendar", 'email my teacher', 'what time is it']) assert.equal(await priv.l.answer(t), null); assert.equal(priv.calls.length, 0, 'nothing personal was sent');
  assert.equal(priv.l.last.outcome, 'ineligible');
  assert.equal(lane(async () => ok('x'), { model: 'not-a-model' }).l.model(), DEFAULT_MODEL); assert.ok(MODELS.includes(lane(async () => ok('x'), { model: MODELS[1] }).l.model()));
});

test('the Settings test reports speed and a safe error that never contains the key', async () => {
  const good = lane(async () => ok('OK')); const t = await good.l.test(); assert.deepEqual([t.ok, t.model, t.sample], [true, DEFAULT_MODEL, 'OK']);
  assert.ok(good.calls[0].body.max_tokens <= 16);
  const e1 = await lane(async () => bad(401)).l.test().catch((e) => e); assert.match(e1.message, /rejected the key/); assert.ok(!e1.message.includes(KEY));
  const e2 = await lane(async () => { throw Error(`connect failed for ${KEY}`); }).l.test().catch((e) => e); assert.ok(!e2.message.includes(KEY)); assert.match(e2.message, /did not answer in time/);
});

// ---- the hook in the request flow ----
function controller({ lane: l, provider = 'claude', offline = false, stats = null } = {}) {
  const c = Object.create(AskController.prototype), data = { quickStats: stats };
  Object.assign(c, { quickLane: l, offline, lastOk: null, changed: 0, store: { get: (k) => (k === 'settings.model.provider' ? provider : data[k]), set: (k, v) => { data[k] = v; } }, finish: (entry, res) => ({ ...res, entryId: entry.id }), onChange() { this.changed++; } });
  return { c, data };
}

test('a quick answer is finished like any answer, labelled with the model, and counted for today', async () => {
  const { l } = lane(async () => ok('Canberra.'));
  const { c, data } = controller({ lane: l });
  const r = await c.tryQuickLane("what's the capital of Australia", { id: 'e1' }, {});
  assert.deepEqual([r.status, r.reply, r.actions, r.model, r.entryId], ['done', 'Canberra.', 0, `Groq ${DEFAULT_MODEL}`, 'e1']);
  assert.equal(c.lastOk, "what's the capital of Australia");
  assert.deepEqual([data.quickStats.answered, data.quickStats.escalated, data.quickStats.failed], [1, 0, 0]); assert.equal(data.quickStats.day, new Date().toDateString());
  assert.equal(c.changed, 1);
});

test('the hook steps aside for scheduled and shown requests, offline and private mode, and counts what it passed on', async () => {
  const run = async (opts, ctl, handler = async () => ok('x')) => { const { l, calls } = lane(handler); const { c, data } = controller({ lane: l, ...ctl }); const r = await c.tryQuickLane('what is 2 plus 2', { id: 'e' }, opts); return { r, calls, data }; };
  for (const [opts, ctl] of [[{ scheduled: true }, {}], [{ shown: 'x' }, {}], [{}, { offline: true }], [{}, { provider: 'ollama' }]]) { const out = await run(opts, ctl); assert.equal(out.r, null); assert.equal(out.calls.length, 0, JSON.stringify([opts, ctl])); }
  const esc = await run({}, {}, async () => ok('ESCALATE')); assert.equal(esc.r, null); assert.equal(esc.data.quickStats.escalated, 1);
  const fail = await run({}, {}, async () => bad(500)); assert.equal(fail.r, null); assert.equal(fail.data.quickStats.failed, 1);
  const rate = await run({}, {}, async () => bad(429, 10)); assert.equal(rate.r, null); assert.equal(rate.data.quickStats.failed, 1);
  const { l } = lane(async () => ok('x')); const { c, data } = controller({ lane: l }); assert.equal(await c.tryQuickLane("what's on my calendar", { id: 'e' }, {}), null); assert.equal(data.quickStats, null, 'a question that was never eligible is not counted');
  const old = controller({ lane: lane(async () => ok('x')).l, stats: { day: 'Mon Jan 01 2001', answered: 99, escalated: 0, failed: 0, ms: 5 } }); await old.c.tryQuickLane('what is 2 plus 2', { id: 'e' }, {}); assert.equal(old.data.quickStats.answered, 1, 'yesterday\'s counts start over');
});
