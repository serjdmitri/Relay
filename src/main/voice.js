// Spoken replies. Uses the system `say` command, because only Apple's own tools can reach the natural
// (Siri, Premium and Enhanced) voices; an app cannot see them through the speech API.

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cloud = require('./tts/cloud');
const { pickJarvis, JARVIS } = require('./voiceProfile');
const { LANGS } = require('./lang');

// Novelty and robotic voices: never picked automatically.
const NOVELTY = new Set(['Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Good News', 'Jester', 'Organ', 'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox', 'Fred', 'Junior', 'Kathy', 'Ralph', 'Grandma', 'Grandpa', 'Eddy', 'Flo', 'Reed', 'Rocko', 'Sandy', 'Shelley']);
const RATES = { slower: 160, normal: 185, faster: 215 };

// `say -v '?'` lines look like:  Name With Spaces   en_US    # Hello! My name is Name.
function parseVoices(out) {
  const voices = [];
  for (const line of String(out).split('\n')) {
    const m = line.match(/^(.+?)\s+([a-z]{2,3}_[A-Za-z0-9]{2,4})\s+#\s*(.*)$/);
    if (!m) continue;
    const name = m[1].trim();
    const base = name.replace(/\s*\(.*$/, '');
    const sample = m[3];
    let kind = 'Standard';
    if (/premium/i.test(name)) kind = 'Premium';
    else if (/enhanced/i.test(name)) kind = 'Enhanced';
    else if (/siri/i.test(sample)) kind = 'Siri';
    else if (NOVELTY.has(base)) kind = 'Novelty';
    voices.push({ name, lang: m[2], kind, sample });
  }
  return voices;
}

const RANK = { Premium: 4, Siri: 4, Enhanced: 3, Standard: 2, Novelty: 0 };

// Best everyday voice for your language and region: a natural one if you have downloaded one, else Samantha.
function pickVoice(voices, pref = 'auto', locale = 'en_US') {
  if (pref === JARVIS) { const j = pickJarvis(voices); if (j) return j; }
  if (pref && pref !== 'auto' && pref !== JARVIS) {
    const chosen = voices.find((v) => v.name === pref);
    if (chosen) return chosen.name;
  }
  const lang = locale.split('_')[0];
  const inLang = voices.filter((v) => v.lang.startsWith(lang + '_') && v.kind !== 'Novelty');
  const score = (v) => RANK[v.kind] * 10 + (v.lang === locale ? 5 : 0) + (v.name.startsWith('Samantha') ? 1 : 0);
  // A natural voice from another region (Tara, en_IN) is not used automatically: it changes the accent.
  const sameRegion = inLang.filter((v) => v.lang === locale);
  const pool = sameRegion.length ? sameRegion : inLang;
  return pool.sort((a, b) => score(b) - score(a))[0]?.name || null;
}

function listVoices(exec = execFile) {
  return new Promise((resolve) => {
    exec('say', ['-v', '?'], { timeout: 5000 }, (err, out) => resolve(err ? [] : parseVoices(out)));
  });
}

// What a spoken reply should say: no markdown, no emoji, no URLs read out letter by letter.
function speakable(text) {
  return String(text)
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/[`*_#>]+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class Speaker {
  // getTts(): { engine, openai: {...key}, elevenlabs: {...key}, kokoro: {...} }, read fresh for every reply.
  // kokoro: the on-device voice (see tts/kokoro.js), or null. fetchFn: for tests.
  constructor({ spawnFn = spawn, exec = execFile, log = console, getTts = () => ({ engine: 'system' }), kokoro = null, fetchFn = (...a) => fetch(...a), onProblem = null } = {}) {
    this.spawnFn = spawnFn;
    this.exec = exec;
    this.log = log;
    this.getTts = getTts;
    this.kokoro = kokoro;
    this.fetchFn = fetchFn;
    this.onProblem = onProblem; // called with a sentence when a better voice failed and the system voice took over
    this.child = null;
    this.voices = null;
    this.token = 0; // bumped by stop() so a reply that is still being made is dropped
    this.abort = null;
    this.busy = false;
    this.onState = null; // set by the app: called with true while a voice is speaking and false when it stops, for the ring
    this.talking = false;
    this.currentText = ''; // what is being said right now (the microphone also hears it; see barge.js)
  }

  async voiceList() {
    if (!this.voices) this.voices = await listVoices(this.exec);
    return this.voices;
  }

  // lang: the language of what is about to be said. A voice for another language than English is picked by that language (the voice chosen in Settings is an English one).
  async resolve(pref, lang = 'en') {
    if (lang && lang !== 'en' && LANGS[lang]) return pickVoice(await this.voiceList(), 'auto', LANGS[lang].say) || pickVoice(await this.voiceList(), pref, process.env.RELAY_LOCALE || 'en_US');
    return pickVoice(await this.voiceList(), pref, process.env.RELAY_LOCALE || 'en_US');
  }

  // Which engine will speak, and why not the one chosen (a missing key, a voice not downloaded).
  engineFor(tts, lang = 'en') {
    const e = tts.engine;
    if (e === 'kokoro' && lang && lang !== 'en') return 'system'; // the on-device voice here is English only
    if (e === 'openai' || e === 'elevenlabs') return tts[e] && tts[e].key ? e : 'system';
    if (e === 'kokoro') return this.kokoro && this.kokoro.installed() ? 'kokoro' : 'system';
    return 'system';
  }

  async speak(text, { voice = 'auto', rate = 'normal', volume = 1, kokoroVoice, lang = 'en' } = {}) {
    this.stop();
    const say = speakable(text);
    if (!say) return;
    this.currentText = say;
    const tts = this.getTts() || { engine: 'system' };
    const engine = this.engineFor(tts, lang);
    if (engine === 'system') return this.speakSystem(say, { voice, rate, volume, lang });
    const token = ++this.token;
    this.abort = new AbortController();
    this.busy = true;
    this.setTalking(true);
    try {
      await this.speakWith(engine, tts, say, rate, token, this.abort.signal, { volume, kokoroVoice });
    } catch (e) {
      if ((e && e.name === 'AbortError') || token !== this.token) return;
      this.log.error?.('voice:', e.message);
      if (this.onProblem) this.onProblem(e.message);
      await this.speakSystem(say, { voice, rate, volume, lang }); // never leave the user without an answer
    } finally {
      if (token === this.token) { this.busy = false; if (!this.child) this.setTalking(false); }
    }
  }

  // The "Test voice" button: the chosen engine only, and the reason in words when it does not work.
  async test(text, { voice = 'auto', rate = 'normal' } = {}) {
    this.stop();
    const tts = this.getTts() || { engine: 'system' };
    const wanted = tts.engine;
    const engine = this.engineFor(tts);
    if (wanted !== 'system' && engine === 'system') {
      return { ok: false, message: wanted === 'kokoro' ? 'The on-device voice is not downloaded yet.' : `Add your ${cloud.NAMES[wanted] || wanted} key first.` };
    }
    if (engine === 'system') { await this.speakSystem(speakable(text), { voice, rate }); return { ok: true }; }
    const token = ++this.token;
    this.abort = new AbortController();
    this.busy = true;
    try {
      await this.speakWith(engine, tts, speakable(text), rate, token, this.abort.signal);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message };
    } finally {
      if (token === this.token) this.busy = false;
    }
  }

  // Makes and plays a reply with one engine. Throws when the engine fails.
  async speakWith(engine, tts, say, rate, token, signal, { volume = 1, kokoroVoice } = {}) {
    const make = (piece) => (engine === 'kokoro'
      ? this.kokoro.synthesize(piece, { ...(tts.kokoro || {}), ...(kokoroVoice ? { voice: kokoroVoice } : {}), rate })
      : cloud.synthesize(engine, tts[engine], piece, { rate, fetchFn: this.fetchFn, signal }).then((buf) => this.writeTemp(buf, 'mp3')));
    const pieces = cloud.sentences(say);
    let pending = make(pieces[0]);
    for (let i = 0; i < pieces.length; i++) {
      const file = await pending;
      if (token !== this.token) { this.discard(file); return; }
      pending = i + 1 < pieces.length ? make(pieces[i + 1]) : null; // the next sentence is made while this one plays
      if (pending) pending.catch(() => {});
      await this.play(file, token, volume);
      this.discard(file);
      if (token !== this.token) return;
    }
  }

  writeTemp(buf, ext) {
    const file = path.join(os.tmpdir(), `relay-voice-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`);
    fs.writeFileSync(file, buf);
    return file;
  }

  discard(file) {
    try { fs.rmSync(file, { force: true }); } catch {}
  }

  play(file, token, volume = 1) {
    return new Promise((resolve) => {
      if (token !== this.token) return resolve();
      const child = this.spawnFn('afplay', volume < 1 ? ['-v', String(volume), file] : [file], { stdio: 'ignore' });
      this.child = child;
      const done = () => { if (this.child === child) this.child = null; resolve(); };
      child.on('exit', done);
      child.on('error', (e) => { this.log.error?.('afplay:', e.message); done(); });
    });
  }

  async speakSystem(say, { voice, rate, volume = 1, lang = 'en' }) {
    const token = this.token;
    const name = await this.resolve(voice, lang);
    if (token !== this.token) return;
    const args = [...(name ? ['-v', name] : []), '-r', String(RATES[rate] || RATES.normal)];
    const child = this.spawnFn('say', args, { stdio: ['pipe', 'ignore', 'ignore'] });
    this.child = child;
    this.setTalking(true);
    child.on('exit', () => { if (this.child === child) { this.child = null; this.setTalking(false); } });
    child.on('error', (e) => { this.log.error?.('say:', e.message); if (this.child === child) { this.child = null; this.setTalking(false); } });
    child.stdin.on('error', () => {});
    child.stdin.end(volume < 1 ? `[[volm ${volume}]] ${say}` : say); // [[volm]] is the system voice's own loudness command
  }

  setTalking(on) {
    if (this.talking === on) return;
    this.talking = on;
    if (this.onState) this.onState(on);
  }

  get speaking() {
    return !!this.child || this.busy;
  }

  stop() {
    this.token++;
    this.busy = false;
    this.setTalking(false);
    try { this.abort && this.abort.abort(); } catch {}
    this.abort = null;
    if (!this.child) return;
    try { this.child.kill('SIGTERM'); } catch {}
    this.child = null;
  }
}

module.exports = { Speaker, parseVoices, pickVoice, listVoices, speakable, RATES };
