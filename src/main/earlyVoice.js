// Start speaking while the answer is still being written. The wait before the first word was: the whole reply is written, then speech is made, then it plays. This speaks the FIRST sentence as
// soon as it is complete (the model streams its words), and the rest is spoken after it when the reply is done, so the first sound comes a few seconds sooner on a long answer.
//
// Only for a plain answer: the moment a tool starts (opening an app, reading the calendar) nothing is spoken early, a first sentence that sounds like "let me check..." is never spoken early
// (that is narration, not the answer), and if the finished answer does not begin with what was spoken, the whole answer is spoken normally. Pure: the speaking is passed in.

const NARRATION = /^(?:let me|let's|i'll|i will|i'm going to|i am going to|sure|okay|ok|one moment|one sec|just a (?:moment|sec|second)|checking|looking|searching|opening|working|give me|hold on|on it|alright|right)\b/i;
const FIRST_SENTENCE = /^\s*([\s\S]{20,400}?[.!?])\s/;

class EarlyVoice {
  // enabled: only when the answer will be spoken at all. speak(text): starts speaking it (stopping nothing else).
  constructor({ enabled = false, speak = () => {} } = {}) { Object.assign(this, { enabled, speak }); this.tools = false; this.said = ''; this.blocked = false; }

  toolStarted() { this.tools = true; }

  // text: everything written so far of the current message.
  delta(text) {
    if (!this.enabled || this.tools || this.blocked || this.said) return;
    const m = FIRST_SENTENCE.exec(String(text || ''));
    if (!m) return; // no complete sentence yet
    const sentence = m[1].trim();
    if (NARRATION.test(sentence)) { this.blocked = true; return; }
    this.said = sentence;
    try { Promise.resolve(this.speak(sentence)).catch(() => {}); } catch { /* the full answer is spoken at the end anyway */ }
  }

  // spoken: the finished text to be spoken. -> { text, append }: what still has to be said, and whether it goes after what is already playing (append) or replaces it.
  finalize(spoken) {
    const full = String(spoken || '').trim();
    if (!this.said) return { text: full, append: false };
    if (full.startsWith(this.said)) return { text: full.slice(this.said.length).trim(), append: true };
    return { text: full, append: false };
  }
}

module.exports = { EarlyVoice };
