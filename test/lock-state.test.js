const test = require('node:test');
const assert = require('node:assert/strict');
const { LockWatch, parseLocked } = require('../src/main/lockState');

test('the session text says locked only when the lock flag is set', () => {
  assert.equal(parseLocked('  | |   "CGSSessionScreenIsLocked" = Yes\n  "kCGSSessionOnConsoleKey" = Yes'), true);
  assert.equal(parseLocked('"kCGSSessionOnConsoleKey" = Yes'), false);
  assert.equal(parseLocked('"CGSSessionScreenIsLocked" = No'), false);
  assert.equal(parseLocked(''), false);
});

test('a change is announced once, events and checks agree, and a failed check changes nothing', async () => {
  const seen = [];
  let out = '"x" = 1';
  const w = new LockWatch({ exec: async () => { if (out === 'boom') throw new Error('no ioreg'); return out; }, onChange: (v) => seen.push(v) });
  assert.equal(w.locked, false);
  assert.equal(w.set(true), true);
  assert.equal(w.set(true), false);
  assert.deepEqual(seen, [true]);
  assert.equal(await w.refresh(), false, 'the check says it is open again');
  assert.deepEqual(seen, [true, false]);
  out = 'boom';
  w.set(true);
  assert.equal(await w.refresh(), true, 'a failed check keeps what the events said');
  out = '"CGSSessionScreenIsLocked" = Yes';
  assert.equal(await w.refresh(), true);
  assert.deepEqual(seen, [true, false, true]);
});
