// Which voice, speed and loudness a spoken reply gets, by what kind of reply it is. Pure, so it can be tested.
//
//   reply    an ordinary answer
//   quiet    a confirmation of something Relay just did (a reminder, a timer, a note): softer and brisk, so it does not shout
//   reading  a long answer that is being read out: clear and a little slower
//
// settings.voices can change any of them: { quiet: { volume: 0.5, rate: 'normal', voice, kokoroVoice }, ... } (every field optional).

const DEFAULTS = {
  reply: {},
  quiet: { volume: 0.55, rate: 'normal' },
  reading: { rate: 'slower', volume: 1 }
};
const LONG_REPLY = 320; // characters: past this an answer counts as something being read out

// "jarvis" is a voice name Relay understands: a calm British male voice. On this Mac that is Daniel (the best of his versions you have installed);
// with the on-device voice it is Kokoro's George.
const JARVIS = 'jarvis';
const JARVIS_KOKORO = 'bm_george';

function jobFor(text, hint = '') {
  if (hint === 'quiet' || hint === 'reading' || hint === 'reply') return hint;
  return String(text || '').length > LONG_REPLY ? 'reading' : 'reply';
}

// settings: the whole settings object. Returns { voice, rate, volume, kokoroVoice, job } with nothing undefined except kokoroVoice.
function profileFor(job, settings = {}) {
  const base = { voice: settings.voice || 'auto', rate: settings.voiceRate || 'normal', volume: 1, kokoroVoice: undefined };
  const own = { ...(DEFAULTS[job] || {}), ...(settings.voices?.[job] || {}) };
  const out = { job };
  for (const k of ['voice', 'rate', 'volume', 'kokoroVoice']) out[k] = own[k] !== undefined && own[k] !== '' ? own[k] : base[k];
  // a slower "reading" voice must not undo a faster speed the person chose for everything
  if (job === 'reading' && settings.voiceRate === 'slower') out.rate = 'slower';
  if (settings.workshop && settings.workshop.enabled) { out.rate = 'slower'; out.volume = Math.min(out.volume, 0.95); } // workshop mode: calm and unhurried
  if (out.voice === JARVIS && !out.kokoroVoice) out.kokoroVoice = JARVIS_KOKORO;
  const vol = Number(out.volume);
  out.volume = Number.isFinite(vol) ? Math.max(0.1, Math.min(1, vol)) : 1;
  return out;
}

// Daniel is the British male voice every Mac has; his Premium and Enhanced versions sound much better when downloaded.
function pickJarvis(voices) {
  const gb = voices.filter((v) => /^en_GB/.test(v.lang) && v.kind !== 'Novelty');
  const daniel = gb.filter((v) => /^Daniel/.test(v.name)).sort((a, b) => (b.kind === 'Premium') - (a.kind === 'Premium') || (b.kind === 'Enhanced') - (a.kind === 'Enhanced'));
  if (daniel.length) return daniel[0].name;
  const others = gb.filter((v) => /^(Oliver|Arthur|Gordon|Rishi)/.test(v.name));
  return (others[0] || gb[0])?.name || null;
}

module.exports = { jobFor, profileFor, pickJarvis, DEFAULTS, JARVIS, JARVIS_KOKORO, LONG_REPLY };
