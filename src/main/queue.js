// Requests that arrived while the Mac was asleep wait here and run in order when it wakes. A later message can cancel an earlier one
// ("cancel the email one"). Pure functions over a plain list, so the rules can be tested without a Mac.
//   item: { id, text, ts, state: 'queued' | 'running' | 'done' | 'cancelled' | 'review' }

const STALE_MS = 24 * 3600e3; // older than a day: shown for review, never run on its own
const DEDUPE_MS = 60000;
const STOP = new Set(['the', 'one', 'that', 'this', 'my', 'about', 'for', 'to', 'of', 'a', 'an', 'it', 'request', 'message', 'task', 'please', 'relay', 'jarvis', 'what', 'said', 'i', 'you', 'told', 'asked']);
const words = (s) => (String(s).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter((w) => !STOP.has(w)).map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));

// "what's queued" or "cancel the email one". null for anything else.
function parseQueueCommand(text) {
  const t = String(text || '').trim().replace(/[“”"]/g, '').replace(/[.!?]+$/, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '');
  if (/^(?:what(?:'s| is| are) (?:in )?(?:the )?(?:queued|queue|waiting|pending)(?: (?:for me|up))?|show (?:me )?(?:the )?queue|list (?:the )?queue|what(?:'s| is) waiting)$/i.test(t)) return { type: 'list' };
  let m;
  if ((m = t.match(/^(?:cancel|scratch|drop|skip|remove|delete|forget|never ?mind|ignore) (?:everything|all(?: of (?:them|it))?|all (?:of )?(?:those|them))$/i))) return { type: 'cancel', all: true };
  if ((m = t.match(/^(?:cancel|scratch|drop|skip|remove|delete|forget|never ?mind|ignore) (?:that|the last one|my last (?:one|request|message)|the previous (?:one|request|message)|the one before)$/i))) return { type: 'cancel', last: true };
  if ((m = t.match(/^(?:cancel|scratch|drop|skip|remove|delete|never ?mind|ignore|forget(?: (?:what|about))?) (?:i (?:said|asked|told you) )?(?:about |the )?(.{2,80}?)(?: one| request| task| message)?$/i)) && words(m[1]).length) return { type: 'cancel', query: m[1].trim() };
  return null;
}

// Which waiting items does a cancel mean? Items that share all of the words in the query, or the newest for "that".
function matchItems(list, cmd) {
  const live = list.filter((i) => i.state === 'queued' || i.state === 'review');
  if (cmd.all) return live;
  if (cmd.last) return live.slice(-1);
  const q = words(cmd.query || '');
  if (!q.length) return [];
  const hit = live.filter((i) => { const w = new Set(words(i.text)); return q.every((x) => w.has(x)); });
  return hit.length ? hit : live.filter((i) => { const w = new Set(words(i.text)); return q.some((x) => w.has(x)); });
}

// New messages (oldest first) join the queue. A queue command is carried out against what is waiting, including items from this same batch.
// Returns { list, notes: [text for the person], toRun: [items to start now] }.
function applyBatch(list, incoming, { now = Date.now(), id = () => Math.random().toString(36).slice(2) } = {}) {
  let out = list.map((i) => ({ ...i }));
  const notes = [];
  for (const msg of incoming) {
    const cmd = parseQueueCommand(msg.text);
    if (cmd?.type === 'list') {
      const live = out.filter((i) => i.state === 'queued' || i.state === 'review');
      notes.push(live.length ? `Waiting: ${live.map((i, n) => `${n + 1}. ${i.text.slice(0, 60)}${i.state === 'review' ? ' (old, needs your OK)' : ''}`).join(' ')}` : 'Nothing is waiting.');
      continue;
    }
    if (cmd?.type === 'cancel') {
      const hit = matchItems(out, cmd);
      if (!hit.length) { notes.push('I could not find anything waiting to cancel.'); continue; }
      if (!cmd.all && !cmd.last && hit.length > 1) { notes.push(`More than one matches: ${hit.map((i) => `"${i.text.slice(0, 40)}"`).join(', ')}. Say which one.`); continue; }
      const ids = new Set(hit.map((i) => i.id));
      out = out.map((i) => (ids.has(i.id) ? { ...i, state: 'cancelled' } : i));
      notes.push(hit.length === 1 ? `Cancelled "${hit[0].text.slice(0, 50)}".` : `Cancelled ${hit.length} waiting requests.`);
      continue;
    }
    if (out.some((i) => i.text === msg.text && Math.abs((i.ts || 0) - msg.ts) < DEDUPE_MS && i.state !== 'cancelled')) continue; // the same thing sent twice
    out.push({ id: id(), text: msg.text, ts: msg.ts, state: now - msg.ts > STALE_MS ? 'review' : 'queued', ...(msg.rowid ? { rowid: msg.rowid } : {}) });
  }
  return { list: out.slice(-100), notes, toRun: out.filter((i) => i.state === 'queued') };
}

const mark = (list, id, state) => list.map((i) => (i.id === id ? { ...i, state } : i));
// Finished and cancelled items are dropped a day later.
const prune = (list, now = Date.now()) => list.filter((i) => ['queued', 'running', 'review'].includes(i.state) || now - (i.ts || 0) < STALE_MS);

module.exports = { parseQueueCommand, matchItems, applyBatch, mark, prune, STALE_MS };
