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

function stuckRig(opts = {}) {
  let spawned = 0, killed = 0; const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-sp-')), 'relay-speech'); fs.writeFileSync(bin, '');
  const state = { stuckAfter: opts.stuckAfter ?? 0, starts: 0 }; // how many starts a helper answers before it hangs
  const spawnFn = () => {
    spawned++; const child = new EventEmitter(); const out = new PassThrough(); const mine = spawned;
    Object.assign(child, { stdout: out, stderr: new PassThrough(), stdin: new PassThrough(), kill: () => { killed++; child.emit('exit', 0); } });
    let answered = 0;
    child.stdin.on('data', (d) => { for (const line of d.toString().split('\n').filter(Boolean)) { if (JSON.parse(line).cmd === 'start' && !(mine === 1 && answered >= state.stuckAfter)) { answered++; setImmediate(() => out.write(JSON.stringify({ event: 'listening' }) + '\n')); } else if (JSON.parse(line).cmd === 'start') answered++; } });
    return child;
  };
  return { speech: new Speech({ binPath: bin, spawnFn, log: { error() {} }, startTimeoutMs: 40, quickStartMs: 30 }), get spawned() { return spawned; }, get killed() { return killed; } };
}

test('a brand new helper that never answers "start" is thrown away and a fresh one is tried, in the same call', async () => {
  const r = stuckRig({ stuckAfter: 0 });
  await r.speech.listen();
  assert.equal(r.killed, 1, 'the stuck helper was killed'); assert.equal(r.spawned, 2, 'a fresh helper was started'); assert.equal(r.speech.listening, true);
});

test('a helper that listened fine before and then hangs (after the Mac sleeps) is replaced quickly, so the Option key and Hey Jarvis still work', async () => {
  const r = stuckRig({ stuckAfter: 1 });
  await r.speech.listen(); assert.equal(r.spawned, 1);
  r.speech.cancel(); r.speech.listening = false;
  const t0 = Date.now(); await r.speech.listen();
  assert.equal(r.spawned, 2); assert.equal(r.killed, 1); assert.ok(Date.now() - t0 < 1000, 'found out within the short allowance');
  assert.equal(r.speech.listening, true);
});

test('if even the fresh helper cannot start, the error is reported and that helper is thrown away too', async () => {
  const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-sp-')), 'relay-speech'); fs.writeFileSync(bin, ''); let killed = 0;
  const spawnFn = () => { const c = new EventEmitter(); Object.assign(c, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => { killed++; c.emit('exit', 0); } }); return c; };
  const speech = new Speech({ binPath: bin, spawnFn, log: { error() {} }, startTimeoutMs: 20, quickStartMs: 20 });
  await assert.rejects(speech.listen(), /timed out/); assert.equal(killed, 2); assert.equal(speech.child, null);
  assert.equal(speech.restartHelper('x'), false, 'nothing left to restart');
});
