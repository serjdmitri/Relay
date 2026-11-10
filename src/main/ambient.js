// Ambient answers: while "Hey Jarvis" is listening, Relay can notice a factual question said near you ("how far is the moon?", "who wrote Dracula?") and quietly show the
// answer in the private window at the top right, then take it away again. Off until you turn it on. It never speaks, never saves what it hears (the words are read on this
// Mac and thrown away), and only the question itself is sent to the model, which is a local one (Ollama) unless you allow otherwise. It stays out of the way: only factual
// lookups (not questions to you or about people), at most a few an hour, and never during a meeting, a call, or while you are talking to Jarvis. Pure: the speech, the model
// and the window are passed in.
//   settings.ambient: { enabled, localOnly, perHour }

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// A question that is a lookup: what/who/when/where/which/why/how many/how much/how far..., not addressed to a person in the room, not about "you".
const LOOKUP = /^(?:(?:so|and|but|um|uh|hey|wait|okay|ok|actually)[, ]+)*(?:what(?:'s| is| are| was| were| does| do)?|who(?:'s| is| was| wrote| invented| founded| won| directed)?|when(?:'s| is| was| did| does)?|where(?:'s| is| was| are| did)?|which|why(?: is| are| does| do| did)?|how (?:many|much|far|long|old|tall|big|fast|hot|cold|deep|high|heavy|do|does|did|is|are|to)|is it true|define|meaning of)\b/i;
const PERSONAL = /\b(?:you|your|yours|we|us|our|ours|i|me|my|mine|mom|dad|honey|babe|baby|dude|bro|guys)\b/i;
const CHAT = /\b(?:for dinner|for lunch|wrong with|going on|the time|time is it|what do you (?:think|want|mean)|how are|what happened|how was)\b/i;

function isLookupQuestion(q) {
  const t = clean(q).replace(/[?.!]+$/, '');
  const words = t.split(' ').filter(Boolean);
  if (words.length < 3 || words.length > 22) return false;
  if (/\b(?:that|this|these|those|it|they|them|he|she|him|her)\s*$/i.test(t)) return false; // pointing at something in the room: nothing to look up
  if (!LOOKUP.test(t)) return false;
  if (PERSONAL.test(t) || CHAT.test(t)) return false;
  return true;
}

// How often it may pop in: at most perHour an hour, never twice within 40 seconds, and the same question once.
class AmbientLimiter {
  constructor({ perHour = 6, now = Date.now } = {}) { Object.assign(this, { perHour, now }); this.shown = []; this.seen = new Map(); }
  allow(q) {
    const t = this.now(), key = clean(q).toLowerCase().replace(/[^a-z0-9 ]+/g, '');
    this.shown = this.shown.filter((x) => t - x < 3600000);
    for (const [k, at] of this.seen) if (t - at > 600000) this.seen.delete(k);
    if (this.seen.has(key) || this.shown.length >= Math.max(1, this.perHour) || (this.shown.length && t - this.shown[this.shown.length - 1] < 40000)) return false;
    this.seen.set(key, t); this.shown.push(t);
    return true;
  }
}

const SYSTEM = 'You quietly help someone who overheard a factual question near them. Reply with the answer in one or two short plain sentences, no preamble. If the question is not a factual lookup you are sure about (an opinion, about a person you do not know, ambiguous, or you are not confident), reply with exactly: SKIP';

// One quick model call. provider.step({ system, messages, tools, signal }) -> { text }. -> the answer, or '' when it should stay quiet.
async function answerOnce({ provider, question, signal }) {
  const res = await provider.step({ system: SYSTEM, messages: [{ role: 'user', content: [{ type: 'text', text: clean(question) }] }], tools: [], signal });
  const t = clean(res && res.text);
  if (!t || /^skip\b/i.test(t) || t.length > 420) return '';
  return t;
}

// "turn on ambient answers", "answer questions you hear", "turn off ambient answers", "stop answering questions around me"
function parseAmbientCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
  if (/^(?:turn on|enable|start|switch on) (?:the )?(?:ambient|background|quiet) (?:answers|help|mode|listening)$|^(?:answer|help with) (?:the )?questions (?:you hear|around me|i hear|near me)$/.test(n)) return { type: 'ambient-on' };
  if (/^(?:turn off|disable|stop|switch off) (?:the )?(?:ambient|background|quiet) (?:answers|help|mode|listening)$|^stop answering questions (?:you hear|around me|near me)$/.test(n)) return { type: 'ambient-off' };
  return null;
}

module.exports = { isLookupQuestion, AmbientLimiter, answerOnce, parseAmbientCommand, SYSTEM };
