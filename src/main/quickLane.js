// The quick lane: plain, timeless questions ("what is 15% of 80", "how do you spell necessary", "capital of Australia") go straight to Groq's free
// tier instead of starting the Claude CLI, so the answer starts sooner and costs no subscription usage. Strictly a side lane, never a replacement:
//   - only short, plain questions that mention nothing personal, nothing on this Mac, nothing time-sensitive and no tools;
//   - only the question itself leaves the Mac, plus up to three earlier quick-lane exchanges from the last ten minutes (kept in memory only);
//     never memory, context, files, screen or tool results;
//   - anything doubtful falls through to the normal path: a failure, a rate limit, a slow answer, or the model itself saying ESCALATE.
// Pure apart from the fetch it is given, so all of it can be tested.

const MODELS = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'];
const DEFAULT_MODEL = MODELS[0];
const URL_CHAT = 'https://api.groq.com/openai/v1/chat/completions';
const TURN_MS = 10 * 60 * 1000;

const SYSTEM = 'You are Jarvis, a quick voice assistant. Answer in at most three short sentences of plain speech: no lists, no markdown, no emoji, because your answer is read aloud. '
  + 'You know nothing about the user, their Mac, their files, calendar, messages or screen, and you cannot look anything up or know today\'s date or the news. '
  + 'If a question needs any of that, or you are not sure the answer is right, reply with exactly the single word ESCALATE and nothing else.';

// ---- is this request one the quick lane may answer? ----
const SHAPE = /^(?:what|what's|whats|who|who's|whos|why|how|where|which|is|are|was|were|can|could|does|do|did|will|would|should|define|spell|translate|convert|calculate|tell me|give me (?:a|an)|name|list|explain|describe|compare|difference|meaning)\b|^[\d(.\-+][\d\s.+\-*/x×÷%()^a-z]{0,40}[\d)]$/i;
const BLOCK = new RegExp('\\b(?:' + [
  'my', 'mine', 'our', 'we', 'your', 'yourself', 'jarvis', 'relay',
  'this', 'these', 'here', 'screen', 'selected', 'clipboard', 'above', 'previous', 'earlier',
  'open', 'close', 'launch', 'quit', 'play', 'pause', 'skip', 'resume', 'stop', 'set', 'turn', 'mute', 'unmute', 'volume', 'brightness', 'screenshot', 'click', 'type', 'press', 'send', 'text', 'email', 'mail', 'call', 'dial', 'message', 'remind', 'reminder', 'reminders', 'schedule', 'calendar', 'meeting', 'appointment', 'note', 'notes', 'file', 'files', 'folder', 'folders', 'document', 'documents', 'download', 'downloads', 'desktop', 'search', 'google', 'browse', 'website', 'app', 'apps', 'battery', 'wifi', 'bluetooth', 'camera', 'timer', 'alarm', 'music',
  'remember', 'forget', 'recall',
  'today', 'tonight', 'tomorrow', 'yesterday', 'now', 'currently', 'current', 'latest', 'recent', 'recently', 'news', 'weather', 'forecast', 'temperature', 'score', 'scores', 'price', 'prices', 'stock', 'stocks', 'crypto', 'bitcoin', 'date', 'time', 'day', 'week', 'month', 'year', 'president', 'minister', 'ceo', 'won', 'winner',
  'code', 'function', 'bug', 'error', 'python', 'javascript', 'script', 'terminal', 'command'
].join('|') + ')\\b|https?:|www\\.|@|(?:^|\\s)[/~]\\w|what can you|who are you|are you (?:able|connected|online)', 'i');
const MAX_WORDS = 20, MAX_CHARS = 160;

function eligible(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return { ok: false, why: 'empty' };
  if (t.length > MAX_CHARS || t.split(' ').length > MAX_WORDS) return { ok: false, why: 'long' };
  if (/\[(?:homework|workshop)\]/i.test(t)) return { ok: false, why: 'mode' };
  if (BLOCK.test(t)) return { ok: false, why: 'personal-or-tool' };
  if (!SHAPE.test(t)) return { ok: false, why: 'shape' };
  return { ok: true, why: '' };
}

// Spoken text: no markdown or lists, and an answer cut off at the token limit ends on a full sentence.
function spoken(content, finish) {
  let s = String(content || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
  if (finish === 'length') { const cut = Math.max(s.lastIndexOf('. '), s.lastIndexOf('! '), s.lastIndexOf('? '), /[.!?]$/.test(s) ? s.length - 1 : -1); if (cut > 20) s = s.slice(0, cut + 1); }
  return s.slice(0, 700);
}

class QuickLane {
  constructor({ getKey, settings = () => ({}), fetchFn = fetch, now = Date.now, timeoutMs = 4000 }) {
    Object.assign(this, { getKey, settings, fetchFn, now, timeoutMs });
    this.turns = []; this.pausedUntil = 0; this.failures = 0; this.keyProblem = false; this.last = { outcome: 'idle', ms: 0 };
  }
  model() { const m = (this.settings() || {}).model; return MODELS.includes(m) ? m : DEFAULT_MODEL; }
  enabled() { return (this.settings() || {}).enabled !== false && !!this.getKey(); }
  paused() { return this.now() < this.pausedUntil; }
  pause(sec) { this.pausedUntil = this.now() + Math.min(Math.max(sec, 5), 600) * 1000; }
  reset() { this.turns = []; }

  // One chat call. Returns { content, finish } or throws an error carrying how to back off.
  async call(messages, { maxTokens = 220 } = {}) {
    const key = this.getKey();
    let res;
    try { res = await this.fetchFn(URL_CHAT, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: this.model(), messages, max_tokens: maxTokens, temperature: 0.3, stream: false }), redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) }); }
    catch { const e = Error('Groq did not answer in time.'); e.kind = 'network'; throw e; }
    if (!res.ok) {
      const e = Error(res.status === 401 || res.status === 403 ? 'Groq rejected the key.' : res.status === 429 ? 'Groq is rate-limiting this key.' : `Groq failed (HTTP ${res.status}).`);
      e.kind = res.status === 401 || res.status === 403 ? 'key' : res.status === 429 ? 'rate' : 'server';
      e.retry = Number(res.headers?.get?.('retry-after')) || 0; throw e;
    }
    let data; try { data = await res.json(); } catch { const e = Error('Groq sent an unreadable answer.'); e.kind = 'server'; throw e; }
    const choice = data?.choices?.[0];
    return { content: choice?.message?.content || '', finish: choice?.finish_reason || '' };
  }

  // The reply, or null when the normal path should answer (not eligible, off, paused, failed, or the model said ESCALATE).
  async answer(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim(), start = this.now();
    const done = (outcome) => { this.last = { outcome, ms: this.now() - start }; return null; };
    if (!this.enabled()) return done('off');
    if (this.paused()) return done('paused');
    if (!eligible(t).ok) return done('ineligible');
    this.turns = this.turns.filter((x) => start - x.at < TURN_MS).slice(-3);
    const messages = [{ role: 'system', content: SYSTEM }, ...this.turns.flatMap((x) => [{ role: 'user', content: x.q }, { role: 'assistant', content: x.a }]), { role: 'user', content: t }];
    let out;
    try { out = await this.call(messages); }
    catch (e) {
      if (e.kind === 'key') { this.keyProblem = true; this.pause(600); }
      else if (e.kind === 'rate') this.pause(e.retry || 60);
      else if (++this.failures >= 2) this.pause(60); // two failures in a row: stop trying for a minute
      return done(e.kind === 'rate' ? 'rate-limited' : e.kind === 'key' ? 'key-rejected' : 'failed');
    }
    this.failures = 0; this.keyProblem = false;
    if (/^\W*ESCALATE\b/i.test(out.content.trim())) return done('escalated');
    const reply = spoken(out.content, out.finish);
    if (!reply) return done('failed');
    this.turns.push({ q: t, a: reply, at: this.now() });
    this.last = { outcome: 'answered', ms: this.now() - start };
    return { reply, model: this.model(), ms: this.last.ms };
  }

  // For the Settings button: does the key work, and how long does an answer take.
  async test() {
    const start = this.now();
    const out = await this.call([{ role: 'system', content: 'Reply with the single word OK.' }, { role: 'user', content: 'Test.' }], { maxTokens: 8 });
    return { ok: true, ms: this.now() - start, model: this.model(), sample: spoken(out.content, out.finish).slice(0, 40) };
  }
}

module.exports = { QuickLane, eligible, spoken, MODELS, DEFAULT_MODEL, SYSTEM };
