// Review a session's notes and keep only the facts you choose. The notes hold everything said in a session; this proposes a short line for some of
// them and nothing happens until you tick lines and press a button. Only the ticked lines, exactly as you edited them, are saved as Relay memories or
// written to a file. Pure. Relay's replies are not verified facts, so they are labelled and never pre-selected; anything that looks like a credential
// is never proposed, and is refused if it is typed in.

const mem = require('./memory');

const MAX_PICKS = 50, MAX_SUGGESTIONS = 40;
const PERSONAL = /^(?:my|i am|i'm|im|i have|i've|i like|i love|i prefer|i live|i study|i go|i work|i play|i speak|we have|our)\b/i;
const NOT_A_FACT_REPLY = /^(?:sorry|i (?:can't|cannot|could not|couldn't|don't|do not|am unable)|unfortunately|here(?:'s| is| are)|sure|okay|ok\b|of course|certainly|done|opened|let me|i'll|i will|one moment)/i;
const oneLine = (s) => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();

function firstSentence(text) {
  const t = oneLine(text);
  const m = /^(.+?[.!?])(?:\s|$)/.exec(t);
  return (m ? m[1] : t).trim();
}

// [{ entryId, source: 'you' | 'relay', text, context }]: a short line per entry worth considering, never a secret.
function suggest(session) {
  const out = [], seen = new Set();
  for (const e of (session && session.entries) || []) {
    if (!e || e.status !== 'done' || !e.id) continue;
    const req = oneLine(e.request);
    let source = '', text = '';
    if (req && PERSONAL.test(req) && !/[?]$/.test(req) && !/^remember\b/i.test(req)) { source = 'you'; text = req; }
    else {
      const s = firstSentence(e.reply);
      if (s.length >= 20 && !NOT_A_FACT_REPLY.test(s) && !/[?]$/.test(s)) { source = 'relay'; text = s; }
    }
    text = text.replace(/[.!\s]+$/, '').slice(0, mem.MAX_LEN);
    if (!text || /\[Omitted/i.test(text) || mem.isSecret(text) || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push({ entryId: e.id, source, text, context: oneLine(e.request).slice(0, 160) });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

// What the user ticked and edited, checked: { ok: [{ entryId, text }], rejected: [{ entryId, why }] }.
function validatePicks(session, picks) {
  const ids = new Set(((session && session.entries) || []).map((e) => e.id)), ok = [], rejected = [];
  for (const p of (Array.isArray(picks) ? picks : []).slice(0, MAX_PICKS)) {
    const text = String((p && p.text) || '').replace(/\s+/g, ' ').trim().replace(/[.!\s]+$/, '');
    if (!p || !ids.has(p.entryId)) rejected.push({ entryId: p && p.entryId, why: 'That note is not in this session.' });
    else if (!text) rejected.push({ entryId: p.entryId, why: 'The line is empty.' });
    else if (text.length > mem.MAX_LEN) rejected.push({ entryId: p.entryId, why: `A memory can be at most ${mem.MAX_LEN} characters; shorten it.` });
    else if (mem.isSecret(text)) rejected.push({ entryId: p.entryId, why: 'It looks like a password, key or other secret, and Relay does not keep those.' });
    else if (!ok.some((o) => o.text.toLowerCase() === text.toLowerCase())) ok.push({ entryId: p.entryId, text });
  }
  return { ok, rejected };
}

// Adds the checked lines to the memory list. Returns { list, added: [facts], skipped: [{ text, why }] }.
function saveFacts(list, ok, { now = Date.now(), id = () => Math.random().toString(36).slice(2) } = {}) {
  let cur = list, added = []; const skipped = [];
  for (const o of ok) {
    if (cur.length >= mem.MAX_FACTS && !cur.some((f) => f.text.toLowerCase() === o.text.toLowerCase())) { skipped.push({ text: o.text, why: 'Memory is full.' }); continue; }
    const r = mem.addFact(cur, o.text, { id: id(), now });
    if (r.added) { cur = r.list; added.push(cur[0]); added = added.filter((f) => cur.some((c) => c.id === f.id)); } else skipped.push({ text: o.text, why: 'Relay already remembers that.' });
  }
  return { list: cur, added, skipped };
}

function exportText(session, ok) {
  return [`Facts chosen from the session "${session.title}" (picked and edited by you; Relay's replies are not independently verified):`, '', ...ok.map((o) => `- ${o.text}`)].join('\n');
}

module.exports = { suggest, validatePicks, saveFacts, exportText, MAX_PICKS };
