// Online voices you connect with your own key. Each engine turns a piece of text into an audio file's bytes.
// Relay never sees a price or takes a fee: the provider bills your own account.

const OPENAI_URL = 'https://api.openai.com/v1/audio/speech';
const ELEVEN_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

// Short pieces so the first one can start playing while the rest are still being made.
function sentences(text, max = 260) {
  const parts = String(text).replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [];
  const out = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur + p).length > max) { out.push(cur.trim()); cur = ''; }
    cur += p;
    while (cur.length > max * 1.6) { // a very long sentence is cut at a comma or a space
      const cut = Math.max(cur.lastIndexOf(', ', max), cur.lastIndexOf(' ', max));
      const at = cut > 40 ? cut + 1 : max;
      out.push(cur.slice(0, at).trim());
      cur = cur.slice(at);
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

const SPEEDS = { slower: 0.9, normal: 1, faster: 1.15 };

function openaiRequest(cfg, text, rate = 'normal') {
  const body = { model: cfg.model || 'gpt-4o-mini-tts', input: text, voice: cfg.voice || 'coral', response_format: 'mp3', speed: SPEEDS[rate] || 1 };
  if (cfg.instructions && /^gpt-4o/.test(body.model)) body.instructions = cfg.instructions; // tts-1 does not take them
  return { url: OPENAI_URL, ext: 'mp3', init: { method: 'POST', headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } };
}

function elevenRequest(cfg, text) {
  if (!cfg.voiceId) throw new Error('Add an ElevenLabs voice ID first (copy it from the voice in your ElevenLabs library).');
  const url = `${ELEVEN_URL}/${encodeURIComponent(cfg.voiceId)}?output_format=mp3_44100_128`;
  return { url, ext: 'mp3', init: { method: 'POST', headers: { 'xi-api-key': cfg.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify({ text, model_id: cfg.model || 'eleven_multilingual_v2' }) } };
}

const BUILDERS = { openai: openaiRequest, elevenlabs: elevenRequest };
const NAMES = { openai: 'OpenAI', elevenlabs: 'ElevenLabs' };

// What went wrong, in words a person can act on.
async function explain(engine, res) {
  let detail = '';
  try {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      detail = (j.error && (j.error.message || j.error)) || (j.detail && (j.detail.message || j.detail)) || j.message || '';
      if (typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch { detail = t; }
  } catch {}
  detail = String(detail).slice(0, 160);
  const who = NAMES[engine] || engine;
  if (res.status === 401 || res.status === 403) return `${who} rejected the key. Check it in Speech settings.${detail ? ` (${detail})` : ''}`;
  if (res.status === 429) return `${who} says you are out of quota or going too fast.${detail ? ` (${detail})` : ''}`;
  if (res.status === 404 || res.status === 422 || res.status === 400) return `${who} did not accept the voice or model name.${detail ? ` (${detail})` : ''}`;
  return `${who} answered ${res.status}.${detail ? ` ${detail}` : ''}`;
}

// -> Buffer of audio. cfg: { key, ...engine settings }.
async function synthesize(engine, cfg, text, { rate = 'normal', fetchFn = fetch, signal } = {}) {
  const build = BUILDERS[engine];
  if (!build) throw new Error(`Unknown voice engine "${engine}".`);
  if (!cfg.key) throw new Error(`Add your ${NAMES[engine]} key in Speech settings first.`);
  const req = build(cfg, text, rate);
  let res;
  try {
    res = await fetchFn(req.url, { ...req.init, signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new Error(`Could not reach ${NAMES[engine]}. Check your internet connection.`);
  }
  if (!res.ok) throw new Error(await explain(engine, res));
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { sentences, openaiRequest, elevenRequest, synthesize, explain, SPEEDS, NAMES };
