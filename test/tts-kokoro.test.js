const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { KokoroVoice, SPEAKERS } = require('../src/main/tts/kokoro');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'relay-k-'));

// Two small fake archives shaped like the real ones: a tool (bin + lib) and a voice model.
function fixtures() {
  const d = tmp();
  const tool = path.join(d, 'sherpa-onnx-v2.0.0-osx-arm64-shared');
  fs.mkdirSync(path.join(tool, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(tool, 'lib'));
  fs.writeFileSync(path.join(tool, 'bin', 'sherpa-onnx-offline-tts'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(tool, 'lib', 'libonnxruntime.dylib'), 'x');
  const model = path.join(d, 'kokoro-int8-multi-lang-v1_0');
  fs.mkdirSync(model);
  for (const f of ['model.int8.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt']) fs.writeFileSync(path.join(model, f), f);
  execFileSync('tar', ['-cjf', path.join(d, 'tool.tar.bz2'), '-C', d, 'sherpa-onnx-v2.0.0-osx-arm64-shared']);
  execFileSync('tar', ['-cjf', path.join(d, 'voice.tar.bz2'), '-C', d, 'kokoro-int8-multi-lang-v1_0']);
  const read = (f) => fs.readFileSync(path.join(d, f));
  const sum = (b) => crypto.createHash('sha256').update(b).digest('hex');
  return { tool: read('tool.tar.bz2'), voice: read('voice.tar.bz2'), sum };
}
const serve = (map) => async (url) => {
  const body = map[url];
  if (!body) return { ok: false, status: 404 };
  return { ok: true, status: 200, headers: { get: () => String(body.length) }, body: (async function* () { yield body; })() };
};

test('install downloads, checks the pinned hashes, unpacks, and reports progress', async () => {
  const f = fixtures();
  const files = { tool: { url: 'u://tool', sha256: f.sum(f.tool), approxMB: 1 }, voice: { url: 'u://voice', sha256: f.sum(f.voice), approxMB: 1 } };
  const seen = [];
  const k = new KokoroVoice({ dir: path.join(tmp(), 'kokoro'), files, fetchFn: serve({ 'u://tool': f.tool, 'u://voice': f.voice }), platform: 'darwin', arch: 'arm64', onProgress: (s) => seen.push(s.stage) });
  assert.ok(!k.installed());
  await k.install();
  assert.ok(k.installed());
  assert.ok(fs.existsSync(k.bin) && (fs.statSync(k.bin).mode & 0o100), 'the tool is executable');
  assert.ok(fs.existsSync(path.join(k.lib, 'libonnxruntime.dylib')));
  assert.ok(seen.includes('tool') && seen.includes('voice') && seen.includes('done'));
  assert.equal(k.status().installing, false);
  k.remove();
  assert.ok(!k.installed());
});

test('a download that does not match its pinned hash is refused and nothing is kept', async () => {
  const f = fixtures();
  const files = { tool: { url: 'u://tool', sha256: 'deadbeef', approxMB: 1 }, voice: { url: 'u://voice', sha256: f.sum(f.voice), approxMB: 1 } };
  const dir = path.join(tmp(), 'kokoro');
  const k = new KokoroVoice({ dir, files, fetchFn: serve({ 'u://tool': f.tool, 'u://voice': f.voice }), platform: 'darwin', arch: 'arm64' });
  await assert.rejects(() => k.install(), /did not match/);
  assert.ok(!k.installed());
  assert.ok(!fs.existsSync(dir), 'the half-installed folder is removed');
  const gone = new KokoroVoice({ dir: path.join(tmp(), 'k2'), files, fetchFn: serve({}), platform: 'darwin', arch: 'arm64' });
  await assert.rejects(() => gone.install(), /download failed \(404\)/);
});

test('only Apple Silicon Macs can install it', async () => {
  const k = new KokoroVoice({ dir: tmp(), platform: 'darwin', arch: 'x64' });
  assert.ok(!k.supported());
  await assert.rejects(() => k.install(), /Apple Silicon/);
  assert.equal(k.status().supported, false);
});

test('synthesize builds the command for the chosen voice and speed and returns the wav', async () => {
  const dir = tmp();
  const calls = [];
  const exec = (cmd, args, opts, cb) => {
    calls.push({ cmd, args, opts });
    fs.writeFileSync(args.find((a) => a.startsWith('--output-filename=')).split('=')[1], 'RIFF');
    cb(null);
  };
  const k = new KokoroVoice({ dir, exec, platform: 'darwin', arch: 'arm64' });
  const wav = await k.synthesize('Hello there.', { voice: 'bf_emma', rate: 'faster' });
  assert.ok(fs.existsSync(wav) && wav.endsWith('.wav'));
  const a = calls[0].args;
  assert.ok(a.includes(`--sid=${SPEAKERS.indexOf('bf_emma')}`) && a.includes('--kokoro-length-scale=0.88') && a.at(-1) === 'Hello there.');
  assert.equal(calls[0].opts.env.DYLD_LIBRARY_PATH, k.lib);
  assert.ok(a.some((x) => x.startsWith('--kokoro-model=') && x.endsWith('model.int8.onnx')));
  const unknown = k.args('x', { voice: 'nobody', out: '/tmp/o.wav' });
  assert.ok(unknown.includes('--sid=0'), 'an unknown voice falls back to the first one');
  const broken = new KokoroVoice({ dir, exec: (c, a, o, cb) => cb(new Error('boom')), platform: 'darwin', arch: 'arm64' });
  await assert.rejects(() => broken.synthesize('Hi'), /could not make that sentence/);
  assert.equal(SPEAKERS[3], 'af_heart');
});
