// Memory v2: lessons learned from your corrections, and things Relay noticed about you that wait for your approval.
// Pure functions over plain lists, like memory.js. Nothing here talks to a model or the disk; the app does that and passes the results in.
//
//   lesson   { id, trigger, fix, conf, ts, lastUsed, uses }  "when asked X, do Y" learned when you said "that's wrong"
//   inferred { id, text, status: 'pending' | 'approved', conf, ts, lastUsed }  a guess about you; unused until you approve it

const { isSecret } = require('./memory');

const DAY = 86400e3;
const HALF_LIFE_DAYS = 45;
const MIN_CONF = 0.2; // below this a lesson or inferred fact fades out of requests (it is not deleted)
const MAX_LESSONS = 60;
const MAX_INFERRED = 40;
const INFERRED_EXPIRES_MS = 30 * DAY;
const DEDUPE_MS = 30000; // two corrections this close together make one lesson

const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const WORD = /[\p{L}\p{N}]{3,}/gu;
const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'you', 'your', 'not', 'was', 'were', 'are', 'but', 'have', 'has', 'had', 'what', 'when', 'from', 'into', 'out', 'can', 'will', 'just', 'than', 'then', 'them', 'they', 'their', 'there', 'how', 'why', 'please', 'relay', 'jarvis']);
const stem = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
const words = (s) => new Set((String(s).toLowerCase().match(WORD) || []).filter((w) => !STOP.has(w)).map(stem));
const overlap = (a, b) => { const x = words(a); const y = words(b); if (!x.size || !y.size) return 0; let hit = 0; for (const w of x) if (y.has(w)) hit++; return hit / Math.min(x.size, y.size); };

// A zero-cost gate: does this message say the last answer was wrong? Only then is the model asked what to learn.
const CORRECTION = [
  /^(?:no|nope|nah)[, .!]+(?:that(?:'s| is| was| isn't| wasn't)|not|i (?:said|meant|asked|wanted))/i,
  /\bthat(?:'s| is| was)(?: totally| completely| just)? (?:wrong|not (?:right|what i)|incorrect)\b/i,
  /\bnot what i (?:asked|wanted|meant|said)\b/i,
  /\bi (?:meant|said|asked for|wanted) (?!to\b)/i,
  /\byou (?:got|did) (?:that|it) wrong\b/i,
  /\bwrong (?:file|folder|app|one|person|contact|window|tab|answer)\b/i,
  /\bnot that one\b/i,
  /\b(?:don'?t|do not|stop) (?:ever )?(?:do|doing|use|using|open|opening|send|sending) (?:that|it|those)\b/i,
  /\bi (?:told|asked) you (?:to|not to)\b/i
];
const looksLikeCorrection = (text) => { const t = clean(text); return t.length >= 6 && t.length <= 400 && CORRECTION.some((r) => r.test(t)); };

// What the model is asked after a correction. The earlier request and answer are quoted as data.
function lessonPrompt({ request = '', reply = '', correction = '' }) {
  return `The user corrected an assistant. Decide what the assistant should do differently next time.

<earlier_request>${clean(request).slice(0, 400)}</earlier_request>
<assistant_answer>${clean(reply).slice(0, 400)}</assistant_answer>
<correction>${clean(correction).slice(0, 400)}</correction>

Answer with only a JSON object: {"trigger": "when the user asks for ... (a short description of the situation)", "fix": "what to do instead (one sentence)", "scope": "once" or "always", "confidence": 0 to 1}.
Use scope "once" when the correction only concerns this one request ("not that file, the other one") and "always" when it is a habit or preference. Do not include secrets.`;
}

function parseLesson(reply) {
  const m = String(reply || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const trigger = clean(j.trigger).slice(0, 160);
  const fix = clean(j.fix).slice(0, 240);
  if (!trigger || !fix || j.scope === 'once' || isSecret(`${trigger} ${fix}`)) return null;
  const conf = Math.min(1, Math.max(0.2, Number(j.confidence) || 0.6));
  return { trigger, fix, conf };
}

const sameLesson = (a, b) => overlap(`${a.trigger} ${a.fix}`, `${b.trigger} ${b.fix}`) >= 0.7;

// Adds a lesson. A near-copy of one already there reinforces it instead; one made within 30 seconds of the last is dropped.
function addLesson(list, lesson, { id = Math.random().toString(36).slice(2), now = Date.now() } = {}) {
  const l = { trigger: clean(lesson.trigger), fix: clean(lesson.fix), conf: lesson.conf ?? 0.6 };
  if (!l.trigger || !l.fix) return { list, added: false };
  const near = list.find((x) => sameLesson(x, l));
  if (near) {
    if (now - (near.ts || 0) < DEDUPE_MS) return { list, added: false };
    return { list: list.map((x) => (x === near ? { ...x, conf: Math.min(1, x.conf + 0.15), ts: now, fix: l.fix } : x)), added: false, reinforced: true };
  }
  if (list.length && now - Math.max(...list.map((x) => x.ts || 0)) < DEDUPE_MS) return { list, added: false };
  return { list: [{ id, ...l, ts: now, lastUsed: 0, uses: 0 }, ...list].slice(0, MAX_LESSONS), added: true };
}

// Confidence today: halves every 45 days since the last use or reinforcement.
const currentConf = (item, now = Date.now()) => {
  const base = Math.max(item.lastUsed || 0, item.ts || 0);
  return (item.conf ?? 0.6) * Math.pow(0.5, Math.max(0, now - base) / (HALF_LIFE_DAYS * DAY));
};

// The lessons that apply to this request: matched by words, strongest first, capped by count and size (about 300 tokens).
function pickLessons(list, request, { max = 8, budget = 1200, now = Date.now() } = {}) {
  const req = words(request);
  if (!req.size) return [];
  const scored = list.map((l) => {
    const t = words(`${l.trigger} ${l.fix}`);
    let hit = 0; for (const w of t) if (req.has(w)) hit++;
    return { l, score: hit ? (hit / Math.max(2, t.size)) * currentConf(l, now) : 0, conf: currentConf(l, now) };
  }).filter((x) => x.score > 0 && x.conf >= MIN_CONF).sort((a, b) => b.score - a.score);
  const out = []; let used = 0;
  for (const { l } of scored) {
    const line = `- ${l.trigger}: ${l.fix}`;
    if (out.length >= max || used + line.length > budget) break;
    out.push(l); used += line.length;
  }
  return out;
}

const lessonContext = (picked) => (picked.length ? `Lessons from the user's earlier corrections (follow them when they apply):\n${picked.map((l) => `- ${l.trigger}: ${l.fix}`).join('\n')}` : '');
const markUsed = (list, picked, now = Date.now()) => { const ids = new Set(picked.map((p) => p.id)); return list.map((l) => (ids.has(l.id) ? { ...l, lastUsed: now, uses: (l.uses || 0) + 1 } : l)); };

// ----- things noticed about the user (inferred), used only after approval -----
function inferPrompt(userTexts) {
  return `Below are things a user asked their assistant recently. List up to 3 stable facts about the user (habits, preferences, interests, tools they use) that are clearly supported by several of them. Skip anything one-off, anything about other people, and anything private (passwords, card numbers, health, finances).

<requests>
${userTexts.map((t) => `- ${clean(t).slice(0, 160)}`).join('\n')}
</requests>

Answer with only a JSON array of short sentences, like ["Usually codes in Python"]. Use [] if nothing is clear.`;
}

function parseInferred(reply) {
  const m = String(reply || '').match(/\[[\s\S]*\]/);
  if (!m) return [];
  let a;
  try { a = JSON.parse(m[0]); } catch { return []; }
  return (Array.isArray(a) ? a : []).map((t) => clean(t).slice(0, 160)).filter((t) => t && !isSecret(t)).slice(0, 3);
}

// New guesses go in as pending (never used until approved); one that matches something already known is skipped.
function proposeInferred(list, texts, known = [], { now = Date.now(), ids = () => Math.random().toString(36).slice(2) } = {}) {
  let out = list;
  for (const text of texts) {
    const low = text.toLowerCase();
    if (out.some((x) => x.text.toLowerCase() === low || overlap(x.text, text) >= 0.8) || known.some((k) => k.text.toLowerCase().includes(low) || low.includes(k.text.toLowerCase()) || overlap(k.text, text) >= 0.8)) continue;
    out = [{ id: ids(), text, status: 'pending', conf: 0.6, ts: now, lastUsed: 0 }, ...out];
  }
  return out.slice(0, MAX_INFERRED);
}

const approveInferred = (list, id, now = Date.now()) => list.map((x) => (x.id === id ? { ...x, status: 'approved', ts: now, lastUsed: 0 } : x));
const editInferred = (list, id, text) => list.map((x) => (x.id === id && clean(text) && !isSecret(text) ? { ...x, text: clean(text).slice(0, 160) } : x));
const removeById = (list, id) => list.filter((x) => x.id !== id);
// Pending guesses nobody approved are dropped after 30 days.
const expireInferred = (list, now = Date.now()) => list.filter((x) => x.status === 'approved' || now - x.ts < INFERRED_EXPIRES_MS);

// Approved guesses that have not faded, as lines for the request.
function inferredContext(list, { now = Date.now(), budget = 800 } = {}) {
  const lines = []; let used = 0;
  for (const x of list.filter((y) => y.status === 'approved' && currentConf(y, now) >= MIN_CONF)) {
    if (used + x.text.length + 3 > budget) break;
    lines.push(`- ${x.text}`); used += x.text.length + 3;
  }
  return lines.length ? `Things Relay noticed about the user, which they approved (use when it helps; do not recite):\n${lines.join('\n')}` : '';
}

module.exports = { looksLikeCorrection, lessonPrompt, parseLesson, addLesson, pickLessons, lessonContext, markUsed, currentConf, inferPrompt, parseInferred, proposeInferred, approveInferred, editInferred, removeById, expireInferred, inferredContext, MAX_LESSONS, HALF_LIFE_DAYS };
