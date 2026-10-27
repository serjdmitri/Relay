const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { UndoRegistry } = require('../src/main/activity');
const { Drive } = require('../src/main/drive');

test('an undo is offered for what has one, runs once, and says what it did or why it could not', async () => {
  const u = new UndoRegistry({ max: 3 });
  let calls = 0;
  u.register('a', async () => { calls++; return 'Put it back.'; });
  u.register('b', async () => { throw new Error('the file is gone'); });
  u.register('', () => 'x');
  u.register('c', 'not a function');
  assert.deepEqual([...u.ids()], ['a', 'b']);
  assert.deepEqual(await u.run('a'), { ok: true, message: 'Put it back.' });
  assert.equal(calls, 1);
  assert.equal(u.has('a'), false);
  assert.deepEqual(await u.run('a'), { ok: false, message: 'That cannot be undone any more.' });
  assert.deepEqual(await u.run('b'), { ok: false, message: 'Could not undo it: the file is gone' });
  for (const id of ['d', 'e', 'f', 'g']) u.register(id, () => id);
  assert.deepEqual([...u.ids()], ['e', 'f', 'g'], 'the oldest are forgotten past the limit');
});

test('drive undo can reverse one chosen entry, not only the last', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-act-'));
  const w = (rel) => { const p = path.join(home, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); return p; };
  const a = w('Downloads/a.pdf'), b = w('Downloads/b.png');
  let log = [];
  const d = new Drive({ fs, home, exec: async () => '', cards: { show: async () => {}, hide: () => {} }, trashItem: async () => {}, log: { read: () => log, write: (l) => { log = l; } } });
  const p1 = (await d.propose({ moves: [{ from: a, to_folder: '~/Documents/Docs' }] })).match(/Plan ([0-9a-f-]{36})/)[1];
  await d.apply({ plan_id: p1 });
  const firstId = d.lastLogId;
  const p2 = (await d.propose({ moves: [{ from: b, to_folder: '~/Pictures/Pics' }] })).match(/Plan ([0-9a-f-]{36})/)[1];
  await d.apply({ plan_id: p2 });
  assert.notEqual(d.lastLogId, firstId);
  assert.match(await d.undo(firstId), /Put 1 back/);
  assert.ok(fs.existsSync(a), 'the first tidy-up is back');
  assert.ok(!fs.existsSync(b), 'the second one was left alone');
  assert.equal(log.length, 1);
  assert.match(await d.undo(), /Put 1 back/, 'with no id it is still the last one');
  assert.ok(fs.existsSync(b));
});
