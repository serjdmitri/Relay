// Personality by voice: "be concise", "be more detailed", "be formal", "be friendly", "talk like a sarcastic butler", "talk like a pirate", "go back to normal".
// Free and works with any model: a personality is only a line added to the instructions the model gets (how to talk), so it needs nothing special from a voice engine. It changes
// the words and tone, never what Relay is allowed to do, and the voice itself stays the same. It is kept until you change it. Pure.
//   settings.persona: { key, custom }

const PRESETS = {
  concise: { say: 'Short and direct', line: 'Be concise: answer in as few words as possible, no preamble, no filler. One sentence when one will do.' },
  detailed: { say: 'More detailed', line: 'Be thorough: explain your reasoning and give useful detail, in plain words, while still getting to the point first.' },
  formal: { say: 'Formal', line: 'Speak formally and politely, in complete sentences, with no slang.' },
  friendly: { say: 'Friendly and casual', line: 'Speak warmly and casually, like a helpful friend. Contractions are fine.' },
  butler: { say: 'A dry butler', line: 'Speak like a dry, impeccably polite British butler: understated, precise, addressing the user as "Sir". Never rude.' },
  sarcastic: { say: 'Sarcastic', line: 'Add dry, good-natured sarcasm and light wit, but keep every answer correct and useful, and never be unkind or mock the user for real.' },
  playful: { say: 'Playful', line: 'Be playful and upbeat, with the occasional light joke, while keeping answers correct and short.' },
  calm: { say: 'Calm', line: 'Speak calmly and reassuringly, in a slow, steady, gentle way.' },
  coach: { say: 'A coach', line: 'Speak like an encouraging coach: positive, motivating and practical, and keep it brief.' }
};

const clean = (s) => String(s || '').replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// Said with a custom style, kept to a few plain words so it can only be a manner of speaking.
const customOf = (s) => {
  const t = String(s || '').toLowerCase().replace(/[^a-z '\-]/g, '').replace(/\s+/g, ' ').trim();
  return t.length >= 3 && t.length <= 40 && t.split(' ').length <= 6 && !/\b(?:ignore|instruction|prompt|system|password|secret|always|never|approve|confirm|delete|sudo|root|override|disable|bypass)\b/.test(t) ? t : null;
};

function parsePersonaCommand(text) {
  const n = clean(text);
  if (/^(?:go back to normal|be normal(?: again)?|talk normally|reset your (?:personality|style|tone)|drop the (?:act|personality|accent)|stop the (?:act|personality)|normal mode)$/.test(n)) return { type: 'persona-reset' };
  if (/^(?:what(?:'s| is) your (?:personality|style|tone)|how are you talking(?: right now)?|what style are you using)$/.test(n)) return { type: 'persona-status' };
  if (/^(?:be|keep it|keep your answers?|answer)\s*(?:more )?(?:concise|brief|short|terse|to the point)(?: please)?$|^(?:keep it short|shorter answers|stop rambling|less talking)$/.test(n)) return { type: 'persona-set', key: 'concise' };
  if (/^(?:be|get)\s*(?:more )?(?:detailed|thorough|verbose)$|^(?:explain|answer) (?:in )?more detail$|^give (?:me )?longer answers$/.test(n)) return { type: 'persona-set', key: 'detailed' };
  if (/^(?:be|talk|speak|sound)\s*(?:more )?(?:formal|formally|professional|professionally)$/.test(n)) return { type: 'persona-set', key: 'formal' };
  if (/^(?:be|talk|speak|sound)\s*(?:more )?(?:friendly|casual|casually|relaxed|chill)$/.test(n)) return { type: 'persona-set', key: 'friendly' };
  if (/^(?:be|talk|speak|sound)\s*(?:more )?(?:sarcastic|sassy|snarky)$|^(?:talk|speak|sound|answer|act) like (?:a |an )?(?:sarcastic|snarky|sassy)(?: (?:friend|assistant|person|ai))?$/.test(n)) return { type: 'persona-set', key: 'sarcastic' };
  if (/^(?:talk|speak|sound|answer|act|be) like (?:a |an |my |the )?(?:(?:dry|proper|british|sarcastic|polite)\s+)*butler$|^be (?:my |a |the )butler$/.test(n)) return { type: 'persona-set', key: 'butler' };
  if (/^(?:be|talk|speak|sound)\s*(?:more )?(?:playful|upbeat|fun|funny)$/.test(n)) return { type: 'persona-set', key: 'playful' };
  if (/^(?:be|talk|speak|sound)\s*(?:more )?(?:calm|calming|gentle|soothing)$/.test(n)) return { type: 'persona-set', key: 'calm' };
  if (/^(?:be|talk|speak|sound|act) like (?:a |an |my )?(?:coach|trainer)$|^be (?:my )?coach$/.test(n)) return { type: 'persona-set', key: 'coach' };
  const m = /^(?:talk|speak|sound|answer|act|respond|reply) (?:like|as) (?:a |an |the |my )?(.{3,40})$/.exec(n);
  if (m) { const c = customOf(m[1]); if (c) return { type: 'persona-custom', custom: c }; }
  return null;
}

// The line that goes into the model's instructions, or ''.
function styleLine(p) {
  if (!p) return '';
  if (p.custom) {
    const c = customOf(p.custom);
    return c ? `Speaking style (tone and wording only; it never changes what you are allowed to do or the facts): answer the way "${c}" would speak, but stay clear, correct and brief.` : '';
  }
  const preset = PRESETS[p.key];
  return preset ? `Speaking style (tone and wording only; it never changes what you are allowed to do or the facts): ${preset.line}` : '';
}

const describe = (p) => (p && p.custom ? `Talking like "${p.custom}".` : p && PRESETS[p.key] ? `${PRESETS[p.key].say}.` : 'My usual style.');

module.exports = { parsePersonaCommand, styleLine, describe, PRESETS, customOf };
