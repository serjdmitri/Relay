const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { Speech } = require('../src/main/speech');

// A stand-in for native/relay-speech that answers the same JSON lines.
function harness(onCmd) {
  const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-sp-')), 'relay-speech');
  fs.writeFileSync(bin, '');
  const sent = [];
  let out;
  const spawnFn = () => {
    const child = new EventEmitter();
    out = new PassThrough();
    child.stdout = out;
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => child.emit('exit', 0);
    child.stdin.on('data', (d) => {
      for (const line of d.toString().split('\n').filter(Boolean)) {
        const cmd = JSON.parse(line);
        sent.push(cmd.cmd);
        setImmediate(() => onCmd(cmd, (ev) => out.write(JSON.stringify(ev) + '\n'), child));
      }
    });
    return child;
  };
  return { speech: new Speech({ binPath: bin, spawnFn, log: { error() {} } }), sent };
}

test('listen, partial text, level, then final text', async () => {
  const { speech, sent } = harness((cmd, emit) => {
    if (cmd.cmd === 'start') { emit({ event: 'listening' }); emit({ event: 'partial', text: 'open no' }); emit({ event: 'level', value: 0.4 }); }
    if (cmd.cmd === 'stop') emit({ event: 'final', text: ' Open Notes. ' });
  });
  const partials = [];
  const levels = [];
  speech.on('partial', (t) => partials.push(t));
  speech.on('level', (v) => levels.push(v));
  await speech.listen();
  assert.equal(speech.listening, true);
  assert.equal(await speech.finish(), 'Open Notes.');
  assert.deepEqual(partials, ['open no']);
  assert.deepEqual(levels, [0.4]);
  assert.deepEqual(sent, ['start', 'stop']);
});

test('a helper error rejects the pending request with its code', async () => {
  const { speech } = harness((cmd, emit) => emit({ event: 'error', code: 'start', message: 'No microphone input is available.' }));
  await assert.rejects(() => speech.listen(), (e) => e.code === 'start' && /microphone/.test(e.message));
});

test('helper dying mid-request rejects instead of hanging, and restarts on next use', async () => {
  let n = 0;
  const { speech } = harness((cmd, emit, child) => {
    n++;
    if (n === 1) child.emit('exit', 1);
    else emit({ event: 'listening' });
  });
  await assert.rejects(() => speech.listen(), /stopped/);
  await speech.listen();
  assert.equal(speech.listening, true);
});

test('permissions, devices and locales are simple request/response', async () => {
  const { speech } = harness((cmd, emit) => {
    if (cmd.cmd === 'permissions') emit({ event: 'permissions', mic: 'granted', speech: 'granted' });
    if (cmd.cmd === 'devices') emit({ event: 'devices', default: 'MacBook Pro Microphone' });
    if (cmd.cmd === 'locales') emit({ event: 'locales', list: [{ id: 'en-US', name: 'English (US)' }] });
  });
  assert.deepEqual(await speech.permissions(), { mic: 'granted', speech: 'granted' });
  assert.equal(await speech.inputDevice(), 'MacBook Pro Microphone');
  assert.equal((await speech.locales())[0].id, 'en-US');
});

test('missing helper is reported clearly', async () => {
  const speech = new Speech({ binPath: '/nope/relay-speech' });
  assert.equal(speech.available, false);
  await assert.rejects(() => speech.listen(), /helper is missing/);
});
