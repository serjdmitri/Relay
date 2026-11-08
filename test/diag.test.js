const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Diag, parseDiagCommand: p, MAX_BYTES } = require('../src/main/diag');
const { Hotkeys } = require('../src/main/hotkeys');

test('events are written down one per line, described in plain words, and cannot grow forever', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-diag-')); let t = Date.parse('2026-11-08T09:00:00Z');
  const d = new Diag({ file: path.join(dir, 'd.log'), now: () => new Date(t) });
  assert.match(d.describe(), /Nothing has been logged yet/);
  d.log('wake-restarted', 'after unlock\nsecond line'); t += 120000; d.log('alarm-start', '20s');
  assert.deepEqual(d.tail(5).map((l) => l.split(' ')[1]), ['wake-restarted', 'alarm-start']);
  assert.ok(!d.tail(5)[0].includes('\n'), 'one line per event');
  assert.match(d.describe(), /2 minutes ago: wake restarted, after unlock second line\. 0 seconds ago: alarm start, 20s/);
  d.log('Weird Kind!!', 'x'.repeat(500)); assert.ok(d.tail(1)[0].length < 320, 'cut to size');
  fs.writeFileSync(d.file, 'x'.repeat(MAX_BYTES + 10)); d.log('after-rotate'); assert.ok(fs.existsSync(d.file + '.1'), 'the full file is kept as .1'); assert.equal(d.tail(5).length, 1);
  assert.equal(new Diag({}).log('x'), false, 'no file: nothing happens'); fs.rmSync(dir, { recursive: true, force: true });
});

test('"what happened" is understood, and ordinary requests are left alone', () => {
  for (const t of ['what happened', 'Jarvis, what happened with you?', 'show the log', 'are you listening', 'diagnostics']) assert.deepEqual(p(t), { type: 'diag-show' }, t);
  for (const t of ['what is the weather', 'what happened in 1969', 'log my workout']) assert.equal(p(t), null, t);
});

test('the key listener can be restarted without hearing every key twice', () => {
  const calls = []; const hook = { removeAllListeners: () => calls.push('remove'), stop: () => calls.push('stop') };
  const h = new Hotkeys({ getShortcuts: () => ({}), onEvent() {}, log: { error() {} } }); h.uIOhook = hook; h.running = true;
  h.start = () => { calls.push('start'); h.running = true; return true; };
  assert.equal(h.restart(), true); assert.deepEqual(calls, ['remove', 'stop', 'start'], 'old handlers removed first');
});
