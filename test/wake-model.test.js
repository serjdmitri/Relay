const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { WakeModelControl } = require('../src/main/wakeModel');

const rig = (over = {}) => {
  const cfg = { enabled: true, mode: 'voice', phrase: 'hey jarvis', engine: 'model', ambient: false, ...over };
  const log = { error() {}, warn() {}, info() {} };
  const r = { cfg, pages: [], woke: [], states: 0, canWake: true, t: 1000, timers: [] };
  r.ctl = new WakeModelControl({
    createPage: (o) => { const p = { closed: false, sent: [], close() { this.closed = true; }, send(c, x) { this.sent.push([c, x]); }, o }; r.pages.push(p); return p; },
    getConfig: () => r.cfg, canWake: () => r.canWake, onWake: () => r.woke.push(1), onState: () => { r.states++; }, log, now: () => r.t,
    setTimer: (fn) => { r.timers.push(fn); return { unref() {} }; }, clearTimer: () => {}
  });
  return r;
};

test('it opens the page when wanted, covers the speech wake word once listening, and closes when switched off', async () => {
  const r = rig();
  await r.ctl.refresh();
  assert.equal(r.pages.length, 1); assert.equal(r.ctl.state, 'loading'); assert.equal(r.ctl.covers, false, 'not covering until the page says it is listening');
  r.ctl.status({ state: 'listening' });
  assert.equal(r.ctl.covers, true);
  r.cfg.enabled = false; await r.ctl.refresh();
  assert.equal(r.pages[0].closed, true); assert.equal(r.ctl.covers, false); assert.equal(r.ctl.state, 'off');
});

test('it stays out of the way for a custom phrase, claps, ambient answers or the speech setting', async () => {
  for (const over of [{ phrase: 'hey relay' }, { mode: 'claps' }, { mode: 'claps-voice' }, { ambient: true }, { engine: 'speech' }, { enabled: false }]) {
    const r = rig(over); await r.ctl.refresh();
    assert.equal(r.pages.length, 0, JSON.stringify(over));
  }
});

test('a detection wakes Relay only when it is allowed, and not twice in a row', async () => {
  const r = rig(); await r.ctl.refresh(); r.ctl.status({ state: 'listening' });
  r.canWake = false; assert.equal(r.ctl.heard(0.9), false); assert.equal(r.woke.length, 0, 'ignored while busy or speaking');
  r.canWake = true; assert.equal(r.ctl.heard(0.9), true); assert.equal(r.woke.length, 1);
  r.t += 500; assert.equal(r.ctl.heard(0.9), false, 'too soon');
  r.t += 2000; assert.equal(r.ctl.heard(0.9), true);
});

test('a page that cannot start is retried, then given up on so the speech wake word takes over', async () => {
  const r = rig();
  await r.ctl.refresh(); r.ctl.status({ state: 'error', message: 'Permission denied' });
  assert.equal(r.ctl.state, 'off'); assert.equal(r.timers.length, 1, 'a retry is scheduled');
  r.timers.shift()(); await new Promise((x) => setImmediate(x)); assert.equal(r.pages.length, 2);
  r.ctl.status({ state: 'error', message: 'Permission denied' }); r.timers.shift()(); await new Promise((x) => setImmediate(x));
  r.ctl.status({ state: 'error', message: 'Permission denied' });
  assert.equal(r.ctl.state, 'failed'); assert.equal(r.ctl.covers, false); assert.equal(r.ctl.wantedByConfig, false);
  r.cfg.engine = 'speech'; await r.ctl.refresh(); assert.equal(r.ctl.state, 'off', 'choosing speech clears the failure');
});

test('voice reports are used only while fresh, and watching is asked for at most every 700 ms', async () => {
  const r = rig(); await r.ctl.refresh(); r.ctl.status({ state: 'listening' });
  assert.equal(r.ctl.voiceChance(), null);
  r.ctl.voice(0.9); assert.equal(r.ctl.voiceChance(), 0.9);
  r.t += 800; assert.equal(r.ctl.voiceChance(), null, 'a stale reading falls back to the loudness check');
  r.ctl.watch(); r.ctl.watch(); assert.equal(r.pages[0].sent.length, 1);
  r.t += 800; r.ctl.watch(); assert.equal(r.pages[0].sent.length, 2);
});

// The real models, on real speech made by macOS: "Hey Jarvis" must score high, other speech and silence must not.
const hasSay = process.platform === 'darwin' && spawnSync('which', ['say']).status === 0 && spawnSync('which', ['afconvert']).status === 0;
test('the wake model hears "Hey Jarvis" and ignores other speech and silence', { skip: !hasSay, timeout: 120000 }, async () => {
  const root = path.join(__dirname, '../src/renderer');
  const ort = await import(pathToFileURL(path.join(root, 'vendor/faceid/ort.wasm.min.mjs')).href);
  ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = pathToFileURL(path.join(root, 'vendor/faceid') + '/').href;
  const { WakeEngine, Vad, EndOfSpeech, BLOCK } = await import(pathToFileURL(path.join(root, 'wakeengine.js')).href);
  const load = (f) => ort.InferenceSession.create(new Uint8Array(fs.readFileSync(path.join(root, 'vendor/wake', f))), { executionProviders: ['wasm'] });
  const [mel, emb, clf, vadSession] = await Promise.all([load('melspectrogram.onnx'), load('embedding_model.onnx'), load('hey_jarvis_v0.1.onnx'), load('silero_vad.onnx')]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-wake-'));
  const clip = (name, words) => {
    const aiff = path.join(dir, name + '.aiff'), wav = path.join(dir, name + '.wav');
    assert.equal(spawnSync('say', ['-v', 'Samantha', '-o', aiff, words]).status, 0);
    assert.equal(spawnSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, wav]).status, 0);
    const b = fs.readFileSync(wav); let p = 12, data = null;
    while (p < b.length - 8) { const id = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4); if (id === 'data') { data = b.subarray(p + 8, p + 8 + n); break; } p += 8 + n; }
    const s = new Float32Array(16000 + data.length / 2 + 32000);
    for (let i = 0; i < data.length / 2; i++) s[16000 + i] = data.readInt16LE(i * 2);
    return s;
  };
  const peak = async (audio) => { const e = new WakeEngine({ ort, mel, emb, clf }); let m = 0; for (let i = 0; i + BLOCK <= audio.length; i += BLOCK) m = Math.max(m, await e.push(audio.subarray(i, i + BLOCK))); return m; };
  try {
    assert.ok(await peak(clip('hj', 'Hey Jarvis')) > 0.6, 'the phrase is heard');
    assert.ok(await peak(clip('other', 'What is the weather like today in Miami')) < 0.2, 'other speech is not');
    assert.ok(await peak(new Float32Array(16000 * 4)) < 0.05, 'silence is not');
    // the voice detector: speech is voiced, silence is not, and the end of the sentence is noticed
    const speech = clip('talk', 'Please remind me to call the dentist tomorrow morning');
    const vad = new Vad({ ort, session: vadSession }), eos = new EndOfSpeech({ quietMs: 600 });
    let done = false, started = false;
    for (let i = 0; i + 512 <= speech.length; i += 512) { const v = eos.push(await vad.push(speech.slice(i, i + 512).map((x) => x / 32768))); if (v === 'speaking') started = true; if (v === 'done') { done = true; break; } }
    assert.ok(started && done, 'it noticed the speech and then the end of it');
    const quiet = new Vad({ ort, session: vadSession }); let top = 0;
    for (let i = 0; i < 40; i++) top = Math.max(top, await quiet.push(new Float32Array(512)));
    assert.ok(top < 0.2, 'silence is not voice');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('EndOfSpeech waits for real speech first, and WakeGate holds off after a detection', async () => {
  {
    const { EndOfSpeech, WakeGate } = await import(pathToFileURL(path.join(__dirname, '../src/renderer/wakeengine.js')).href);
    const e = new EndOfSpeech({ quietMs: 100, blockMs: 32 });
    for (let i = 0; i < 20; i++) assert.equal(e.push(0.01), 'quiet', 'never done before anything was said');
    for (let i = 0; i < 8; i++) e.push(0.9);
    let last; for (let i = 0; i < 5; i++) last = e.push(0.01);
    assert.equal(last, 'done');
    let t = 0; const g = new WakeGate({ threshold: 0.5, cooldownMs: 1000, now: () => t });
    assert.equal(g.check(0.4), false); assert.equal(g.check(0.8), true); t = 500; assert.equal(g.check(0.9), false); t = 1600; assert.equal(g.check(0.9), true);
  }
});
