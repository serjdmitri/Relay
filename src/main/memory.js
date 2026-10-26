// What Relay remembers about you: short facts you told it ("my name is Sergey", "I'm vegetarian"). Pure functions; the app
// keeps the list in the store and the model sees it with every request. Nothing leaves your Mac except as part of a request.

const MAX_FACTS = 150;
const MAX_LEN = 240;
const SECRET = /pass(?:word|code)|\bpin\b|api[ -]?key|secret|token|\bssn\b|social security|credit card|debit card|card number|cvv|routing number|account number|\b(?:\d[ -]?){13,19}\b|\b\d{3}-\d{2}-\d{4}\b/i;

const clean = (t) => String(t).replace(/\s+/g, ' ').trim().replace(/[.!\s]+$/, '');
const PREFIX = String.raw`^(?:(?:hey |ok |okay )?(?:relay|jarvis)[, ]+)?(?:please )?`;

// What was said, as a memory command. Returns null for anything else (including "remember to call mom", which is a reminder,
// and "remember this as morning setup", which saves a routine).
function parseMemory(text) {
  const t = String(text || '').trim();
  const n = t.replace(/[“”"]/g, '');
  let m;
  if ((m = n.match(new RegExp(`${PREFIX}(?:forget|clear) (?:everything|all)(?: that)?(?: you (?:know|remember))?(?: about me)?(?: and everything)?[.!]*$`, 'i'))) || /^(?:please )?(?:wipe|clear|reset) (?:your |my )?memory[.!]*$/i.test(n)) return { type: 'forget-all' };
  if (new RegExp(`${PREFIX}(?:what do you (?:remember|know) about me|what have you remembered|what(?:'s| is) in your memory|what do you remember)[?.!]*$`, 'i').test(n)) return { type: 'recall' };
  if ((m = n.match(new RegExp(`${PREFIX}forget(?: about| that| what i (?:said|told you) about)? (.+?)[.!]*$`, 'i')))) {
    const q = clean(m[1]);
    if (q && !/^(?:it|this|everything|all)$/i.test(q)) return { type: 'forget', query: q };
  }
  if ((m = n.match(new RegExp(`${PREFIX}remember(?: that| this)?[, ]+(.+?)[.!]*$`, 'i')))) {
    const fact = clean(m[1]);
    if (!fact || /^to\b/i.test(fact) || /^as\b/i.test(fact) || /^(?:it|that|this) as\b/i.test(fact)) return null; // a reminder, or a routine
    return { type: 'remember', fact: fact.slice(0, MAX_LEN) };
  }
  return null;
}

const isSecret = (fact) => SECRET.test(fact);

// Adds a fact unless it is already there (or a longer version of it is). Returns { list, added }.
function addFact(list, fact, { id = Math.random().toString(36).slice(2), now = Date.now() } = {}) {
  const text = clean(fact).slice(0, MAX_LEN);
  const low = text.toLowerCase();
  if (!text) return { list, added: false };
  if (list.some((f) => f.text.toLowerCase() === low || f.text.toLowerCase().includes(low))) return { list, added: false };
  const kept = list.filter((f) => !low.includes(f.text.toLowerCase())); // the new one says the same and more
  return { list: [{ id, text, ts: now }, ...kept].slice(0, MAX_FACTS), added: true };
}

// Removes every fact that has all of the words in the query. Returns { list, removed }.
function removeFacts(list, query) {
  const words = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 1 || /\d/.test(w));
  if (!words.length) return { list, removed: [] };
  const hit = (f) => words.every((w) => f.text.toLowerCase().includes(w));
  return { list: list.filter((f) => !hit(f)), removed: list.filter(hit) };
}

// The lines the model sees with each request, newest first, within a budget.
function memoryContext(list, budget = 2400) {
  const lines = [];
  let used = 0;
  for (const f of list) {
    if (used + f.text.length + 3 > budget) break;
    lines.push(`- ${f.text}`);
    used += f.text.length + 3;
  }
  return lines.length ? `What the user has told Relay to remember (use it when it helps; do not recite it):\n${lines.join('\n')}` : '';
}

module.exports = { parseMemory, isSecret, addFact, removeFacts, memoryContext, MAX_FACTS };
