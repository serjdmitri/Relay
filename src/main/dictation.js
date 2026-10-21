// Shaping what you dictate before it is typed: your word fixes, spoken commands ("new line", "scratch that")
// and a style per app. Pure functions.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Replaces words the recognizer gets wrong. Case-insensitive, whole words, and the capitalization of what was
// heard is carried over ("supabase" at the start of a sentence stays capitalized).
function applyReplacements(text, rules = []) {
  let out = String(text);
  for (const r of rules) {
    const from = String(r.from || '').trim();
    const to = String(r.to ?? '');
    if (!from) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${esc(from).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}_])`, 'giu');
    out = out.replace(re, (m) => {
      if (m.length > 1 && m === m.toUpperCase() && /\p{L}/u.test(m) && to === to.toLowerCase()) return to.toUpperCase();
      if (m[0] !== m[0].toLowerCase() && to && to[0] === to[0].toLowerCase()) return to[0].toUpperCase() + to.slice(1);
      return to;
    });
  }
  return out;
}

const SCRATCH = /(?:^|[\s,.;!?])(?:scratch that|delete that)[.,!?]*/gi;

// Spoken commands inside dictation. Returns { text, scratchOnly }:
//   "new line" / "new paragraph" become line breaks;
//   "scratch that" drops everything said before it in this utterance, and on its own it asks to undo the last paste.
function applyDictationCommands(text) {
  let t = String(text).trim();
  if (!t) return { text: '', scratchOnly: false };
  let last = -1;
  let end = 0;
  for (const m of t.matchAll(SCRATCH)) {
    last = m.index;
    end = m.index + m[0].length;
  }
  if (last >= 0) {
    t = t.slice(end).trim();
    if (!t) return { text: '', scratchOnly: true };
  }
  t = t
    .replace(/\s*\bnew paragraph\b[.,;]?\s*/gi, '\n\n')
    .replace(/\s*\bnew line\b[.,;]?\s*/gi, '\n');
  // A sentence that follows a line break starts with a capital, like the recognizer would have written it.
  t = t.replace(/\n+(\p{Ll})/gu, (m, c) => m.slice(0, -1) + c.toUpperCase()).trim();
  return { text: t, scratchOnly: false };
}

const STYLES = {
  default: { label: 'As spoken' },
  casual: { label: 'Casual: lowercase, no final period' },
  chat: { label: 'Chat: casual, then press Return' }
};

// Style for the app you are typing into. Returns { text, pressReturn }.
function applyStyle(text, style = 'default') {
  if (style !== 'casual' && style !== 'chat') return { text, pressReturn: false };
  let t = String(text);
  // lowercase the first letter unless the word is "I", an acronym, or already mixed case (iPhone, Sam is kept: only the very first letter of the text)
  t = t.replace(/^(\p{Lu})(\p{Ll}+)\b/u, (m, a, b) => (/^(I|I'm|I'll|I've|I'd)$/.test(m) ? m : a.toLowerCase() + b));
  t = t.replace(/\.\s*$/, '');
  return { text: t, pressReturn: style === 'chat' };
}

function styleFor(appStyles = [], app) {
  if (!app) return 'default';
  const hit = appStyles.find((s) => s.app && s.app.toLowerCase() === app.toLowerCase());
  return hit ? hit.style : 'default';
}

module.exports = { applyReplacements, applyDictationCommands, applyStyle, styleFor, STYLES };
