const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { Glass } = require('../src/main/glass');

const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-glass-')), 'relay-glass');
fs.writeFileSync(bin, '');

function fake() {
  const sent = [];
  const spawnFn = () => {
    const c = new EventEmitter();
    c.stdin = new PassThrough();
    c.stdin.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach((l) => sent.push(JSON.parse(l))));
    c.kill = () => c.emit('exit', 0);
    return c;
  };
  return { spawnFn, sent };
}

test('glass needs macOS 26 and the helper', () => {
  assert.equal(new Glass({ binPath: bin, macOS: '25.4.0' }).supported, false);
  assert.equal(new Glass({ binPath: bin, macOS: '27.2' }).supported, true);
  assert.equal(new Glass({ binPath: '/nope', macOS: '27.2' }).supported, false);
});

test('show, frame and hide are sent to the helper, which starts on first use', async () => {
  const f = fake();
  const g = new Glass({ binPath: bin, macOS: '27.0', spawnFn: f.spawnFn });
  assert.equal(g.active, false);
  g.show({ x: 1, y: 2, w: 3, h: 4 }, { x: 0, y: 0, w: 1, h: 1 }, 27);
  g.frame({ x: 1, y: 2, w: 3, h: 9 }, 27);
  g.hide({ x: 0, y: 0, w: 1, h: 1 });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(f.sent.map((m) => m.cmd), ['show', 'frame', 'hide']);
  assert.equal(g.active, true);
  g.stop();
});

test('a helper that keeps dying is given up on, so the plain pill is used', () => {
  const spawnFn = () => { const c = new EventEmitter(); c.stdin = new PassThrough(); setImmediate(() => c.emit('exit', 1)); return c; };
  const g = new Glass({ binPath: bin, macOS: '27.0', spawnFn });
  for (let i = 0; i < 3; i++) { g.start(); g.child.emit('exit', 1); }
  assert.equal(g.supported, false);
});
