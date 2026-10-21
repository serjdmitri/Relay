// Spoken replies. Uses the system `say` command, because only Apple's own tools can reach the natural
// (Siri, Premium and Enhanced) voices; an app cannot see them through the speech API.

const { execFile, spawn } = require('child_process');

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
  if (pref && pref !== 'auto') {
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
  constructor({ spawnFn = spawn, exec = execFile, log = console } = {}) {
    this.spawnFn = spawnFn;
    this.exec = exec;
    this.log = log;
    this.child = null;
    this.voices = null;
  }

  async voiceList() {
    if (!this.voices) this.voices = await listVoices(this.exec);
    return this.voices;
  }

  async resolve(pref) {
    return pickVoice(await this.voiceList(), pref, process.env.RELAY_LOCALE || 'en_US');
  }

  async speak(text, { voice = 'auto', rate = 'normal' } = {}) {
    this.stop();
    const say = speakable(text);
    if (!say) return;
    const name = await this.resolve(voice);
    const args = [...(name ? ['-v', name] : []), '-r', String(RATES[rate] || RATES.normal)];
    const child = this.spawnFn('say', args, { stdio: ['pipe', 'ignore', 'ignore'] });
    this.child = child;
    child.on('exit', () => { if (this.child === child) this.child = null; });
    child.on('error', (e) => this.log.error?.('say:', e.message));
    child.stdin.on('error', () => {});
    child.stdin.end(say);
  }

  get speaking() {
    return !!this.child;
  }

  stop() {
    if (!this.child) return;
    try { this.child.kill('SIGTERM'); } catch {}
    this.child = null;
  }
}

module.exports = { Speaker, parseVoices, pickVoice, listVoices, speakable, RATES };
