// "Interview me": Relay asks a few questions about you, one at a time, and saves each answer as a fact it remembers (the same list as "remember that...").
// You can skip a question, stop any time, and see or delete everything afterwards ("what do you remember", "forget ..."). Secrets are never kept
// (memory.js refuses them). Pure: the caller saves the facts and says the questions.

const QUESTIONS = [
  { label: 'About me', ask: 'What should I call you, and what do you do?' },
  { label: 'Working on', ask: 'What are you working on right now?' },
  { label: 'Goals', ask: 'What are your main goals for the next few months?' },
  { label: 'Daily rhythm', ask: 'What does a usual day look like, and when do you work best?' },
  { label: 'Meetings', ask: 'How do you like your calendar: mornings or afternoons, short or long meetings?' },
  { label: 'How to talk to me', ask: 'How should I talk to you: short and direct, or with more detail?' },
  { label: 'Never do', ask: 'Is there anything I should never do, or never bring up?' }
];
const IDLE_MS = 10 * 60000;

const norm = (t) => String(t || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').toLowerCase();

// What was said when no interview is running: a request to start one, or null.
function parseStart(text) {
  const n = norm(text);
  return /^(?:interview me|get to know me|ask me (?:some )?questions about (?:me|myself)|learn about me|let'?s do (?:the |an )?interview)$/.test(n) ? { type: 'interview-start' } : null;
}

// What was said while an interview is running: skip, stop, leave it for another request (a question, or a command of its own), or an answer.
function parseReply(text) {
  const n = norm(text);
  if (/^(?:skip|skip (?:it|this|that|this one)|next|next question|pass|i'?d rather not(?: say)?|no comment)$/.test(n)) return { type: 'skip' };
  if (/^(?:stop|stop (?:the )?interview|that'?s enough|that is enough|enough|done|i'?m done|cancel|never ?mind|quit|end (?:the )?interview)$/.test(n)) return { type: 'stop' };
  if (/\?\s*$/.test(String(text || '').trim()) || /^(?:what|when|where|who|why|how|can you|could you|will you|play|open|set|call|send|text|show|turn|remind|create|add|search|find|go to|take|read|tell me|check|stop|start)\b/.test(n)) return { type: 'leave' };
  if (!n || n.length < 2) return { type: 'skip' };
  return { type: 'answer', text: String(text).replace(/\s+/g, ' ').trim() };
}

// The fact saved for an answer.
const factFor = (i, answer) => `${QUESTIONS[i].label}: ${String(answer).replace(/[.!\s]+$/, '')}`.slice(0, 240);

class Interview {
  constructor({ now = Date.now } = {}) { this.now = now; this.i = -1; this.at = 0; this.saved = 0; }
  get active() { return this.i >= 0 && this.now() - this.at < IDLE_MS; }
  start() { this.i = 0; this.at = this.now(); this.saved = 0; return this.question(); }
  question() { return `Question ${this.i + 1} of ${QUESTIONS.length}: ${QUESTIONS[this.i].ask}`; }
  end() { this.i = -1; }
  // -> { fact?, say, done }. fact is what to remember for an answer; say is what to tell next.
  step(reply) {
    this.at = this.now();
    let fact = null;
    if (reply.type === 'stop') { const n = this.saved; this.end(); return { say: `Okay, I stopped. I remembered ${n} thing${n === 1 ? '' : 's'}. Say "what do you remember" to see them.`, done: true }; }
    if (reply.type === 'answer') { fact = factFor(this.i, reply.text); this.saved++; }
    this.i++;
    if (this.i >= QUESTIONS.length) { const n = this.saved; this.end(); return { fact, say: `That is all. I remembered ${n} thing${n === 1 ? '' : 's'}. Say "what do you remember" to see them, or "forget" something to remove it.`, done: true }; }
    return { fact, say: this.question(), done: false };
  }
}

module.exports = { Interview, parseStart, parseReply, factFor, QUESTIONS, IDLE_MS };
