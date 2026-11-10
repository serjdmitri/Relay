// Spend limits you set yourself: a daily and a monthly amount (in dollars, at API prices), and what to do when one is reached. Off until you turn it on.
// Every request's cost is added as it arrives (Claude reports it after each answer; a plan with no per-use bill still shows its notional API price, so a
// limit also works as a "how much am I using" guard). The totals are by calendar day and month on this Mac. Pure: the store and the clock are passed in.
//   settings.budget: { enabled, dailyUsd, monthlyUsd, action: 'ask' | 'block', warnAt: 0.8 }

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const money = (n) => '$' + (n >= 100 ? n.toFixed(0) : n.toFixed(2));
const KEEP_DAYS = 62;

class Budget {
  // load(): { [day]: dollars }; save(obj); cfg(): settings.budget; now()
  constructor({ load = () => ({}), save = () => {}, cfg = () => ({}), now = Date.now } = {}) { Object.assign(this, { load, save, cfg, now }); this.paused = null; this.warned = {}; }

  add(usd) {
    const c = Number(usd);
    if (!Number.isFinite(c) || c <= 0 || c > 1000) return;
    const d = new Date(this.now()), k = dayKey(d), all = this.load() || {};
    all[k] = +((all[k] || 0) + c).toFixed(6);
    const cut = dayKey(new Date(this.now() - KEEP_DAYS * 86400000));
    for (const key of Object.keys(all)) if (key < cut) delete all[key];
    this.save(all);
  }

  totals() {
    const d = new Date(this.now()), all = this.load() || {}, today = dayKey(d), month = today.slice(0, 7);
    let m = 0;
    for (const [k, v] of Object.entries(all)) if (k.startsWith(month)) m += v;
    return { today: all[today] || 0, month: m };
  }

  // -> { state: 'ok' | 'warn' | 'over', which: 'daily' | 'monthly' | null, spent, limit, text }. A limit of 0 or less is not set.
  check() {
    const c = this.cfg() || {};
    if (!c.enabled || this.paused === dayKey(new Date(this.now()))) return { state: 'ok', which: null };
    const t = this.totals(), warnAt = Math.min(0.99, Math.max(0.3, Number(c.warnAt) || 0.8));
    const rows = [['daily', t.today, Number(c.dailyUsd)], ['monthly', t.month, Number(c.monthlyUsd)]].filter((r) => r[2] > 0);
    for (const [which, spent, limit] of rows) if (spent >= limit) return { state: 'over', which, spent, limit, text: `You have spent ${money(spent)} of your ${money(limit)} ${which} limit.` };
    for (const [which, spent, limit] of rows) if (spent >= limit * warnAt) return { state: 'warn', which, spent, limit, text: `You are at ${money(spent)} of your ${money(limit)} ${which} limit.` };
    return { state: 'ok', which: null };
  }

  // Said once per day and level, so a warning is not repeated on every request.
  shouldWarn(r) {
    if (r.state !== 'warn') return false;
    const k = `${dayKey(new Date(this.now()))}:${r.which}`;
    if (this.warned[k]) return false;
    this.warned[k] = true;
    return true;
  }

  ignoreToday() { this.paused = dayKey(new Date(this.now())); }

  status() {
    const t = this.totals(), c = this.cfg() || {};
    const lim = (v) => (Number(v) > 0 ? ` of ${money(Number(v))}` : '');
    return `Today ${money(t.today)}${lim(c.dailyUsd)}, this month ${money(t.month)}${lim(c.monthlyUsd)}. Limits are ${c.enabled ? 'on' : 'off'}.`;
  }
}

// "set my daily limit to 5 dollars", "set a monthly spending limit of fifty dollars", "how much have I spent", "turn off spend limits", "ignore the limit for today"
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
function amount(s) {
  const n = String(s).toLowerCase().replace(/[$,]/g, '').trim();
  if (/^\d+(\.\d+)?$/.test(n)) return +n;
  const words = n.split(/[\s-]+/).filter((x) => x !== 'and');
  let total = 0;
  for (const x of words) { if (x === 'hundred') total = (total || 1) * 100; else if (WORDS[x]) total += WORDS[x]; else return null; }
  return total || null;
}

function parseBudgetCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ');
  const l = n.toLowerCase();
  if (/^(?:how much (?:have i|did i|am i) (?:spent|spend|using|used)|what(?:'s| is) my (?:spend|spending|usage cost)(?: so far)?|spend status|spending status)(?: (?:today|this month|so far))?$/.test(l)) return { type: 'budget-status' };
  if (/^(?:turn off|disable|stop) (?:my )?(?:the )?(?:spend(?:ing)?|cost|budget) limits?$/.test(l)) return { type: 'budget-off' };
  if (/^(?:turn on|enable) (?:my )?(?:the )?(?:spend(?:ing)?|cost|budget) limits?$/.test(l)) return { type: 'budget-on' };
  if (/^(?:ignore|skip|pause|override) (?:the |my )?(?:spend(?:ing)?|cost|budget)? ?limit(?: for today)?$/.test(l)) return { type: 'budget-ignore' };
  const m = /^(?:set|change|make|put) (?:my |a |the )?(daily|monthly|day|month)(?:ly)? (?:spend(?:ing)?|cost|budget|usage)? ?limit (?:to|of|at) (?:about )?\$?([\w.,\s-]+?)(?: dollars?| bucks)?$/i.exec(n);
  if (m) {
    const v = amount(m[2]);
    if (v && v <= 100000) return { type: 'budget-set', which: /^d/i.test(m[1]) ? 'dailyUsd' : 'monthlyUsd', value: v };
  }
  return null;
}

module.exports = { Budget, parseBudgetCommand, dayKey, money };
