// The on-device voice: Kokoro (an open, Apache-2.0 text-to-speech model) run by sherpa-onnx's offline TTS tool.
// Nothing is bundled with Relay. The user presses Download, and Relay fetches two files from the official k2-fsa/sherpa-onnx
// GitHub releases, checks each against a SHA-256 that is pinned here, and keeps them in Relay's own folder.
// Replies are then made on this Mac: no key, no internet, and the text never leaves the Mac. Apple Silicon only.

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
const FILES = {
  tool: { url: `${RELEASES}/v2.0.0/sherpa-onnx-v2.0.0-osx-arm64-shared.tar.bz2`, sha256: 'ca352a87d313fb1cce311c7b5ddc2e48df3ff899fb2c43ce8076071f029d1d3f', approxMB: 20 },
  voice: { url: `${RELEASES}/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2`, sha256: '4c3052abaa60943a341f193888cf6abd68787dae6ab8ae5c925a706caa247e4e', approxMB: 126 }
};

// sherpa-onnx's speaker numbers for Kokoro v1.0 (from its model page).
const SPEAKERS = ['af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa', 'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'];
const LENGTH = { slower: 1.12, normal: 1, faster: 0.88 }; // length scale: larger is slower

const sha256File = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

class KokoroVoice {
  constructor({ dir, onProgress = () => {}, exec = execFile, fetchFn = (...a) => fetch(...a), files = FILES, platform = process.platform, arch = process.arch } = {}) {
    this.dir = dir;
    this.onProgress = onProgress;
    this.exec = exec;
    this.fetchFn = fetchFn;
    this.files = files;
    this.platform = platform;
    this.arch = arch;
    this.installing = false;
    this.progress = 0;
    this.stage = '';
    this.bin = path.join(dir, 'bin', 'sherpa-onnx-offline-tts');
    this.lib = path.join(dir, 'lib');
    this.model = path.join(dir, 'model');
  }

  supported() {
    return this.platform === 'darwin' && this.arch === 'arm64';
  }

  installed() {
    return this.supported() && fs.existsSync(this.bin) && fs.existsSync(path.join(this.model, 'model.int8.onnx')) && fs.existsSync(path.join(this.dir, 'ready'));
  }

  status() {
    return { supported: this.supported(), installed: this.installed(), installing: this.installing, progress: this.progress, stage: this.stage };
  }

  tick(stage, fraction) {
    this.stage = stage;
    this.progress = fraction;
    this.onProgress(this.status());
  }

  async download(item, file, from, to) {
    const res = await this.fetchFn(item.url);
    if (!res.ok) throw new Error(`The download failed (${res.status}). Check your internet connection and try again.`);
    const total = Number(res.headers.get('content-length')) || item.approxMB * 1048576;
    const out = fs.createWriteStream(file);
    let got = 0;
    let last = 0;
    try {
      for await (const chunk of res.body) {
        got += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        if (Date.now() - last > 400) { last = Date.now(); this.tick(this.stage, from + (to - from) * Math.min(1, got / total)); }
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    if (item.sha256) {
      const sum = await sha256File(file);
      if (sum !== item.sha256) { fs.rmSync(file, { force: true }); throw new Error('The downloaded file did not match what Relay expected, so it was not used.'); }
    }
  }

  untar(file, into) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(into, { recursive: true });
      this.exec('tar', ['-xjf', file, '-C', into], { timeout: 300000 }, (err) => (err ? reject(new Error('Could not unpack the download.')) : resolve()));
    });
  }

  async install() {
    if (!this.supported()) throw new Error('The on-device voice needs an Apple Silicon Mac.');
    if (this.installing || this.installed()) return;
    this.installing = true;
    const tmp = path.join(os.tmpdir(), `relay-kokoro-${process.pid}-${Date.now()}`);
    try {
      fs.mkdirSync(tmp, { recursive: true });
      fs.rmSync(this.dir, { recursive: true, force: true });
      fs.mkdirSync(this.dir, { recursive: true });
      this.tick('tool', 0);
      const toolFile = path.join(tmp, 'tool.tar.bz2');
      await this.download(this.files.tool, toolFile, 0, 0.12);
      await this.untar(toolFile, path.join(tmp, 'tool'));
      const root = path.join(tmp, 'tool', fs.readdirSync(path.join(tmp, 'tool'))[0]);
      fs.mkdirSync(path.join(this.dir, 'bin'), { recursive: true });
      fs.mkdirSync(this.lib, { recursive: true });
      fs.copyFileSync(path.join(root, 'bin', 'sherpa-onnx-offline-tts'), this.bin);
      fs.chmodSync(this.bin, 0o755);
      for (const f of fs.readdirSync(path.join(root, 'lib'))) fs.cpSync(path.join(root, 'lib', f), path.join(this.lib, f), { dereference: false });
      this.tick('voice', 0.12);
      const voiceFile = path.join(tmp, 'voice.tar.bz2');
      await this.download(this.files.voice, voiceFile, 0.12, 0.97);
      await this.untar(voiceFile, path.join(tmp, 'voice'));
      const vroot = path.join(tmp, 'voice', fs.readdirSync(path.join(tmp, 'voice'))[0]);
      fs.renameSync(vroot, this.model);
      fs.writeFileSync(path.join(this.dir, 'ready'), JSON.stringify({ at: Date.now() }));
      this.tick('done', 1);
    } catch (e) {
      fs.rmSync(this.dir, { recursive: true, force: true });
      throw e;
    } finally {
      this.installing = false;
      fs.rmSync(tmp, { recursive: true, force: true });
      this.onProgress(this.status());
    }
  }

  remove() {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  // The British voices (bf_, bm_) are pronounced with the British lexicon when the model has one.
  britishLexicon(voice) {
    return /^b[fm]_/.test(voice) && fs.existsSync(path.join(this.model, 'lexicon-gb-en.txt'));
  }

  // The command that makes one piece of speech.
  args(text, { voice = 'af_heart', rate = 'normal', out }) {
    const sid = Math.max(0, SPEAKERS.indexOf(voice));
    const m = this.model;
    return [
      `--kokoro-model=${path.join(m, 'model.int8.onnx')}`, `--kokoro-voices=${path.join(m, 'voices.bin')}`, `--kokoro-tokens=${path.join(m, 'tokens.txt')}`,
      `--kokoro-lexicon=${path.join(m, this.britishLexicon(voice) ? 'lexicon-gb-en.txt' : 'lexicon-us-en.txt')},${path.join(m, 'lexicon-zh.txt')}`, `--kokoro-lang=en`,
      `--kokoro-length-scale=${LENGTH[rate] || 1}`, `--num-threads=4`, `--sid=${sid}`, `--output-filename=${out}`, text
    ];
  }

  // -> the path of a .wav file (the caller deletes it).
  synthesize(text, { voice, rate } = {}) {
    const out = path.join(os.tmpdir(), `relay-kokoro-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`);
    return new Promise((resolve, reject) => {
      this.exec(this.bin, this.args(text, { voice, rate, out }), { timeout: 60000, env: { ...process.env, DYLD_LIBRARY_PATH: this.lib } }, (err) => {
        if (err || !fs.existsSync(out)) return reject(new Error('The on-device voice could not make that sentence.'));
        resolve(out);
      });
    });
  }
}

module.exports = { KokoroVoice, SPEAKERS, FILES };
