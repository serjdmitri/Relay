// New email, told to you. Relay checks your connected Gmail accounts every few minutes, and a message that arrived since the last check becomes an
// event for the speak-up system (proactive.js), which decides how loudly to tell you. Pure: the polling and the Gmail calls happen elsewhere.
//
// The first check for an account only remembers what is already in the inbox, so turning this on never reads out your backlog.
//   settings.mail: { enabled, everyMin, vip: ['anna', 'coach@school.org'] }

const MAX_SEEN = 400;
const URGENT_WORDS = /\b(?:urgent|asap|immediately|deadline|due (?:today|tomorrow|tonight)|action required|interview|security alert|verify your|password|suspicious|invoice|payment (?:failed|due)|your (?:order|flight|ride)|final notice|expires? (?:today|tomorrow))\b/i;
const BULK = /(?:no-?reply|do-?not-?reply|newsletter|notifications?@|mailer|marketing|deals?@|promo)/i;

// "Anna Lee <anna@x.org>" -> { name: 'Anna Lee', address: 'anna@x.org' }
function sender(from) {
  const m = String(from || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const address = (m ? m[2] : String(from || '')).trim().toLowerCase();
  const name = (m && m[1].trim()) || address.split('@')[0] || 'someone';
  return { name, address };
}

const isVip = (from, vip = []) => {
  const { name, address } = sender(from);
  return vip.some((v) => { const x = String(v).toLowerCase().trim(); return x && (address.includes(x) || name.toLowerCase().includes(x)); });
};

// How much a message matters, 0 to 1. Advertising and bulk mail stay quiet; people you named, and words like "deadline", rise.
function importance(msg, { vip = [] } = {}) {
  const labels = msg.labels || [];
  if (labels.some((l) => /CATEGORY_(?:PROMOTIONS|SOCIAL|FORUMS)/.test(l))) return 0.1;
  if (isVip(msg.from, vip)) return 0.9;
  if (URGENT_WORDS.test(`${msg.subject || ''}`)) return 0.78;
  if (BULK.test(sender(msg.from).address)) return 0.25;
  return 0.5;
}

class MailWatch {
  // load(): saved { [account]: [ids] }; save(obj): keep it
  constructor({ load = () => ({}), save = () => {} } = {}) {
    this.seen = load() || {};
    this.save = save;
  }

  // One check of one account. ids: every unread inbox id now; fresh: details of the ones not in `known(account)` (the caller only fetches those).
  // Returns the new messages (empty on the first check).
  update(account, ids, fresh) {
    const had = this.seen[account];
    const next = [...new Set([...(ids || []), ...(had || [])])].slice(0, MAX_SEEN);
    this.seen[account] = next;
    this.save(this.seen);
    if (!had) return [];
    const old = new Set(had);
    return (fresh || []).filter((m) => !old.has(m.id)).map((m) => ({ ...m, account }));
  }

  known(account) { return new Set(this.seen[account] || []); }
}

// Events for proactive.js. Up to 3 new messages are told one by one; more become one digest so a busy morning is a sentence, not a flood.
function toEvents(msgs, { vip = [] } = {}) {
  const scored = msgs.map((m) => ({ ...m, importance: importance(m, { vip }) }));
  if (scored.length <= 3) return scored.map((m) => ({ type: 'mail', id: m.id, name: sender(m.from).name, subject: String(m.subject || '(no subject)').slice(0, 100), importance: m.importance }));
  const top = scored.slice().sort((a, b) => b.importance - a.importance);
  const names = [...new Set(top.slice(0, 3).map((m) => sender(m.from).name))];
  return [{ type: 'mail', digest: true, id: `digest:${scored[0].id}`, count: scored.length, names, importance: Math.max(...scored.map((m) => m.importance)) }];
}

const gmailQuery = 'in:inbox is:unread newer_than:2d';

module.exports = { MailWatch, toEvents, importance, sender, isVip, gmailQuery };
