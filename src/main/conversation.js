// The rules for talking with Relay hands-free, as plain functions so they can be tested:
//   - interrupting it by talking while it speaks,
//   - going on listening for a few seconds after an answer (follow-up),
//   - whether the wake phrase listens in the app that is in front.

const STOP_WORDS = new Set(['stop', 'quiet', 'enough', 'shush', 'silence', 'cancel', 'okay', 'ok', 'wait', 'hold', 'pause', 'sorry', 'hang']);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

function lev1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// Is the person telling it to stop? A stop word near the start of what was just heard ("stop", "okay stop it", "jarvis quiet").
function heardStop(text) {
  const all = norm(text).split(' ').filter(Boolean);
  // in the first two words, or the whole utterance is short: a stop word deep in a long sentence is just a sentence
  return all.slice(0, 2).some((x) => STOP_WORDS.has(x)) || (all.length <= 3 && all.some((x) => STOP_WORDS.has(x)));
}

// The microphone also hears Relay's own voice, so the words Relay is saying must not count. heard: the speech recognised so far; spoken: what Relay
// is saying. Returns 'stop' (a stop word), 'talk' (several words that are not Relay's own), or null.
function interruption(heard, spoken, { mode = 'talk', minWords = 3 } = {}) {
  if (heardStop(heard)) {
    // a stop word that Relay itself is saying right now ("stop" inside a sentence about buses) is not an interruption
    const own = new Set(norm(spoken).split(' '));
    const hw = norm(heard).split(' ').filter(Boolean);
    const stops = hw.filter((x) => STOP_WORDS.has(x));
    if (!stops.every((x) => own.has(x)) || hw.length <= 2) return 'stop';
  }
  if (mode !== 'talk') return null;
  const own = norm(spoken).split(' ').filter(Boolean);
  const tail = norm(heard).split(' ').filter(Boolean).slice(-12);
  const foreign = tail.filter((w) => w.length > 1 && !own.some((o) => lev1(w, o)));
  // words of its own voice that the recogniser got wrong show up as odd single words; several in a row are a person
  return foreign.length >= minWords ? 'talk' : null;
}

// Should Relay open the microphone again after this answer? ctx: { enabled, byVoice, state, speaking, suspended, chain, now }.
function shouldFollowUp(ctx) {
  const max = 5; // a conversation, not a loop: after five in a row it waits for you to start it again
  return !!(ctx.enabled && ctx.byVoice && ctx.state === 'done' && !ctx.speaking && !ctx.suspended && (ctx.chain || 0) < max);
}

// Does "Hey Jarvis" listen with this app in front? apps: a list of app names, empty meaning everywhere.
function wakeAllowedIn(apps, front) {
  const list = (Array.isArray(apps) ? apps : String(apps || '').split(',')).map((a) => norm(a)).filter(Boolean);
  if (!list.length) return true;
  const f = norm(front);
  return !!f && list.some((a) => f === a || f.startsWith(a) || a.startsWith(f));
}

module.exports = { heardStop, interruption, shouldFollowUp, wakeAllowedIn, STOP_WORDS };
