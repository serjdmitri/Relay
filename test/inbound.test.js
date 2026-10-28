const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfirmHub, parseAnswer } = require('../src/main/confirmHub');
const q = require('../src/main/queue');
const { Pairing, Inbox, textOf, isSelfChat, toMs, MARK } = require('../src/main/imessage');

const timers = () => { const t = []; return { setTimer: (fn, ms) => { const h = { fn, ms }; t.push(h); return h; }, clearTimer: (h) => { if (h) h.dead = true; }, fire: (n = 0) => { const h = t.filter((x) => !x.dead)[n]; h.dead = true; h.fn(); }, live: () => t.filter((x) => !x.dead) }; };

test('confirm hub: the first answer wins and the other place is told', async () => {
  const tm = timers(); const hub = new ConfirmHub({ ...tm });
  const settled = []; hub.on('settle', (i, r) => settled.push([i.id, r]));
  const { answer } = hub.open({ id: 'c1', question: 'Send it?' });
  assert.equal(hub.answer('c1', true, 'phone'), true);
  assert.equal(hub.answer('c1', false, 'mac'), false, 'too late');
  assert.deepEqual(await answer, { yes: true, by: 'phone' });
  assert.deepEqual(settled, [['c1', { yes: true, by: 'phone' }]]);
  assert.equal(hub.latest(), null);
});

test('confirm hub: unanswered questions expire, re-ask three times then expire, or wait forever', async () => {
  let tm = timers(); let hub = new ConfirmHub({ ...tm, unanswered: () => 'expire' });
  let r = hub.open({ id: 'a', question: '?' }); tm.fire(); assert.deepEqual(await r.answer, { yes: false, by: 'expired' });
  tm = timers(); hub = new ConfirmHub({ ...tm, unanswered: () => 'reask' });
  const asked = []; hub.on('reask', (i, n) => asked.push(n));
  r = hub.open({ id: 'b', question: '?' });
  tm.fire(); tm.fire(); tm.fire(); assert.deepEqual(asked, [1, 2, 3]);
  tm.fire(); assert.deepEqual(await r.answer, { yes: false, by: 'expired' });
  tm = timers(); hub = new ConfirmHub({ ...tm, unanswered: () => 'forever' });
  hub.open({ id: 'c', question: '?' }); assert.equal(tm.live().length, 0);
  assert.equal(hub.pending().length, 1);
});

test('yes and no are recognised, anything else is not an answer', () => {
  for (const t of ['yes', 'Yep', 'do it', 'go ahead!', 'ok']) assert.equal(parseAnswer(t), true, t);
  for (const t of ['no', "don't", 'nope.', 'cancel']) assert.equal(parseAnswer(t), false, t);
  for (const t of ['open safari', 'yes please send the email to dana about the budget', 'maybe']) assert.equal(parseAnswer(t), null, t);
});

test('queue commands parse', () => {
  assert.deepEqual(q.parseQueueCommand("what's queued"), { type: 'list' });
  assert.deepEqual(q.parseQueueCommand('cancel the email one'), { type: 'cancel', query: 'email' });
  assert.deepEqual(q.parseQueueCommand('never mind that'), { type: 'cancel', last: true });
  assert.deepEqual(q.parseQueueCommand('cancel everything'), { type: 'cancel', all: true });
  assert.equal(q.parseQueueCommand('open safari'), null);
  assert.equal(q.parseQueueCommand('cancel my subscription to the gym').type, 'cancel'); // handled against what is waiting, never run as a request
});

test('a later message cancels an earlier waiting one, and the rest run in order', () => {
  const now = 1e12;
  const r = q.applyBatch([], [
    { text: 'email Dana the report', ts: now - 3000 }, { text: 'turn the volume down', ts: now - 2000 }, { text: 'cancel the email one', ts: now - 1000 }, { text: 'open Notes', ts: now - 500 }
  ], { now, id: (() => { let n = 0; return () => `i${n++}`; })() });
  assert.deepEqual(r.toRun.map((i) => i.text), ['turn the volume down', 'open Notes']);
  assert.deepEqual(r.notes, ['Cancelled "email Dana the report".']);
  assert.equal(r.list.find((i) => i.text.startsWith('email')).state, 'cancelled');
});

test('cancelling needs one clear match, says so when there is none, and old items wait for review', () => {
  const now = 1e12;
  const base = q.applyBatch([], [{ text: 'email Dana', ts: now - 100 }, { text: 'email Sam', ts: now - 90 }], { now });
  const amb = q.applyBatch(base.list, [{ text: 'cancel the email one', ts: now }], { now });
  assert.match(amb.notes[0], /More than one matches/);
  assert.equal(amb.toRun.length, 2);
  assert.match(q.applyBatch([], [{ text: 'cancel the zebra one', ts: now }], { now }).notes[0], /could not find/);
  const old = q.applyBatch([], [{ text: 'lock my mac', ts: now - 25 * 3600e3 }], { now });
  assert.equal(old.list[0].state, 'review');
  assert.equal(old.toRun.length, 0);
  assert.match(q.applyBatch(old.list, [{ text: "what's queued", ts: now }], { now }).notes[0], /old, needs your OK/);
});

test('the same text twice within a minute is one request; list and prune work', () => {
  const now = 1e12;
  const r = q.applyBatch([], [{ text: 'open notes', ts: now - 1000 }, { text: 'open notes', ts: now - 500 }], { now });
  assert.equal(r.list.length, 1);
  const done = q.mark(r.list, r.list[0].id, 'done');
  assert.equal(q.prune(done, now + 25 * 3600e3).length, 0);
  assert.equal(q.prune(done, now + 1000).length, 1);
});

test('pairing code: works once, expires after 10 minutes, ignores other numbers', () => {
  let t = 0; const p = new Pairing({ now: () => t, code: () => '123456' });
  assert.equal(p.check('123456'), false, 'not started');
  p.start();
  assert.equal(p.check('my code is 654321'), false);
  assert.equal(p.check('pair 123456 please'), true);
  assert.equal(p.check('123456'), false, 'used up');
  p.start(); t = 11 * 60000; assert.equal(p.check('123456'), false, 'expired');
});

test('text can come from the text column or the binary one; own thread detection', () => {
  const body = Buffer.concat([Buffer.from('streamtyped...NSString'), Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b, 0x0b]), Buffer.from('hello world'), Buffer.from([0x86])]).toString('hex');
  assert.equal(textOf({ body_hex: body }), 'hello world');
  assert.equal(textOf({ text: ' hi ' }), 'hi');
  assert.equal(textOf({}), '');
  assert.equal(isSelfChat({ chat_identifier: '+15551234567', account: 'P:+15551234567' }), true);
  assert.equal(isSelfChat({ chat_identifier: 'Me@iCloud.com', account: 'E:me@icloud.com' }), true);
  assert.equal(isSelfChat({ chat_identifier: '+15550000000', account: 'P:+15551234567' }), false);
  assert.ok(toMs(0) === Date.UTC(2001, 0, 1) && toMs(5e17) > toMs(0));
});

function rig(rows, { paired = false } = {}) {
  const sent = [], batches = [], answers = [];
  const store = { paired, last: 0 };
  const pairing = new Pairing({ code: () => '111111' });
  const inbox = new Inbox({ readRows: async (since) => rows.filter((r) => r.rowid > since), send: async (t) => { sent.push(t); }, load: () => ({ ...store }), save: (s) => Object.assign(store, s), onMessages: async (c, o) => { batches.push([c, o]); }, pairing, onAnswer: (t) => { answers.push(t); return /^(yes|no)$/i.test(t); } });
  return { inbox, sent, batches, store, pairing, answers };
}
const row = (rowid, text, over = {}) => ({ rowid, text, date: 5e17, is_from_me: 1, chat_identifier: 'me@icloud.com', account: 'E:me@icloud.com', ...over });

test('nothing is a command before pairing, and the code pairs once', async () => {
  const r = rig([row(1, 'open safari'), row(2, 'pair 111111')]);
  r.pairing.start();
  await r.inbox.poll();
  assert.equal(r.store.paired, true);
  assert.equal(r.store.self, 'me@icloud.com', 'remembers which address to text back');
  assert.deepEqual(r.batches, []);
  assert.deepEqual(r.sent, [`${MARK}Paired. You can text me commands here.`]);
});

test('after pairing only your own thread counts: other chats, other senders and Relay\'s own replies are ignored', async () => {
  const r = rig([
    row(1, 'open notes'), row(2, 'hi mom', { chat_identifier: '+15550000000', account: 'P:+15551234567' }),
    row(3, 'sent by someone else', { is_from_me: 0 }), row(4, `${MARK}Paired.`), row(5, 'yes'), row(6, 'play music'), row(7, '', {})
  ], { paired: true });
  await r.inbox.poll({ sleptThrough: true });
  assert.deepEqual(r.batches[0][0].map((c) => c.text), ['open notes', 'play music']);
  assert.equal(r.batches[0][1].sleptThrough, true);
  assert.deepEqual(r.answers, ['open notes', 'yes', 'play music'], 'every readable text is first offered as an answer to a waiting question');
  assert.equal(r.inbox.ignored, 1);
  assert.equal(r.inbox.unreadable, 1);
  assert.equal(r.store.last, 7);
});

test('rows already read are not read again; unpairing keeps the place', async () => {
  const r = rig([row(1, 'a')], { paired: true });
  await r.inbox.poll(); await r.inbox.poll();
  assert.equal(r.batches.length, 1);
  r.inbox.unpair();
  assert.equal(r.store.paired, false); assert.equal(r.store.last, 1);
});
