const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { Glass } = require('../src/main/glass');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('stopping the see-through pill helper (after sleep or unlock) is not counted as a crash, and it starts again by itself', () => {
  const bin = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'relay-gl-')), 'relay-glass'); fs.writeFileSync(bin, '');
  let spawned = 0; const kids = [];
  const spawnFn = () => { spawned++; const c = new EventEmitter(); Object.assign(c, { stdin: new PassThrough(), stdout: new PassThrough(), kill() { c.emit('exit', 0); } }); kids.push(c); return c; };
  const g = new Glass({ binPath: bin, spawnFn, macOS: '26.0' });
  assert.equal(g.show({ x: 0, y: 0, w: 10, h: 10 }, null), true); assert.equal(spawned, 1);
  for (let i = 0; i < 5; i++) { g.stop(); g.show({ x: 0, y: 0, w: 10, h: 10 }, null); }
  assert.equal(g.failed, undefined === g.failed ? g.failed : false, 'restarting is never a failure'); assert.equal(g.supported, true); assert.equal(spawned, 6);
});

test('waking and unlocking restart the pill helper, and the wake and the pill leave a trace in the diagnostics log', () => {
  const main = read('src/main/main.js'), ask = read('src/main/askController.js');
  assert.match(main, /glass\.stop\(\); diag\.log\('glass-restarted', why\)/);
  assert.match(ask, /diag\?\.log\('wake-heard'/); assert.match(ask, /diag\?\.log\('pill-shown'/);
});

test('"On it, Sir." is not spoken before the real answer unless it is switched on', () => {
  const ask = fs.readFileSync(path.join(__dirname, '../src/main/askController.js'), 'utf8');
  assert.match(ask, /if \(this\.store\.get\('settings\.spokenOnIt'\) === true && this\.voiceAsk/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/main/store.js'), 'utf8'), /spokenOnIt: false/);
});
