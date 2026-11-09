// How long Jarvis takes to react, measured on this Mac and kept on this Mac. For each spoken request it records four times, in seconds:
//   listen: you let go of the key -> the words arrive as text      (speech-to-text: what Deepgram or Parakeet would speed up)
//   think:  the text arrives -> the model's first words            (the model)
//   speak:  the first words (or the finished answer) -> first sound (making the voice)
//   total:  you let go -> you hear the first sound
// No words, no audio: only numbers and a time. "How fast are you" reads them back, so the next speed-up can aim at the slowest step instead of a guess.

const KEEP = 100;

class Latency {
  constructor({ store = null, now = Date.now } = {}) { Object.assign(this, { store, now }); this.reset(); }
  reset() { this.m = {}; this.open = false; }

  // name: released | text | thinking | firstWords | firstSound
  mark(name, t = this.now()) {
    if (name === 'released') { this.reset(); this.m.released = t; return; }
    if (name === 'text') { if (this.m.released === undefined || t - this.m.released > 20000) this.reset(); this.m.text = t; this.open = this.m.released !== undefined; return; }
    if (!this.open) return;
    if (name === 'thinking' && this.m.thinking === undefined) this.m.thinking = t;
    else if (name === 'firstWords' && this.m.firstWords === undefined) this.m.firstWords = t;
    else if (name === 'firstSound' && this.m.firstSound === undefined) { this.m.firstSound = t; this.finish(); }
  }

  finish() {
    const m = this.m, s = (a, b) => (a !== undefined && b !== undefined && b >= a ? Math.round((b - a)) / 1000 : null);
    const heard = m.firstWords ?? m.firstSound; // an answer with no streamed words is spoken when it is done
    const rec = { at: m.firstSound, listen: s(m.released, m.text), think: s(m.text, heard), speak: s(heard, m.firstSound), total: s(m.released, m.firstSound) };
    this.reset();
    if (rec.total === null || rec.total > 120) return null; // a long task, not a reaction
    if (this.store) { const all = [rec, ...(this.store.get('latencyLog') || [])].slice(0, KEEP); this.store.set('latencyLog', all); }
    return rec;
  }
}

const median = (xs) => { const a = xs.filter((x) => Number.isFinite(x) && x>=0).sort((p, q) => p - q); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };

function parseLatencyCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
  if (/^(?:how fast|how quick|how responsive) (?:are you|is jarvis|am i)(?: right now)?$|^(?:speed|latency|timing|reaction|response) (?:report|stats|numbers|check)$|^(?:show|give|tell) me (?:your |the )?(?:speed|latency|timing|reaction time|response time)(?: report| stats| numbers)?$|^what(?:'s| is) (?:your|the) (?:reaction|response) time$/.test(n)) return { type: 'latency-report' };
  if (/^(?:clear|reset|forget|delete) (?:the |my |your )?(?:speed|latency|timing)(?: report| stats| numbers| log)?$/.test(n)) return { type: 'latency-clear' };
  return null;
}

// The words for the report, from the saved records (newest first).
const percentile95=xs=>{const a=xs.filter(x=>Number.isFinite(x)&&x>=0).sort((x,y)=>x-y);return a.length?a[Math.ceil(a.length*.95)-1]:null;};
function describe(log = []) {
  const recent = (Array.isArray(log) ? log : []).slice(0, 20);
  if (recent.length < 3) return 'I have timed only ' + recent.length + ' spoken request' + (recent.length === 1 ? '' : 's') + ' so far. Ask me a few things out loud and then ask how fast I am.';
  const m = { listen: median(recent.map((r) => r.listen)), think: median(recent.map((r) => r.think)), speak: median(recent.map((r) => r.speak)), total: median(recent.map((r) => r.total)) };
  const f = (x) => (x === null ? 'unknown' : x.toFixed(1) + ' seconds');
  const steps = [['hearing you (speech to text)', m.listen], ['thinking up the first words', m.think], ['making the voice', m.speak]].filter(([, v]) => v !== null).sort((a, b) => b[1] - a[1]);
  const slowest = steps[0];
  const p95=percentile95(recent.map(r=>r.total));
  return `Over your last ${recent.length} spoken requests the typical wait from letting go of the key to hearing me was ${f(m.total)}. The 95th-percentile wait was ${f(p95)}. Hearing you took ${f(m.listen)}, thinking up the first words ${f(m.think)}, and making the voice ${f(m.speak)}.${slowest ? ` The slowest part is ${slowest[0]}.` : ''}`;
}

module.exports = { Latency, parseLatencyCommand, describe, median, percentile95 };
