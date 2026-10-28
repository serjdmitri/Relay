// When Claude runs out of usage, Relay carries on with Codex without saying anything, and goes back to Claude once Claude's limit has reset. This is the rule:
// how a usage limit is recognised, when it ends, and which of the two takes the next request. Pure: the clock and the saved state are passed in.

const DEFAULT_WAIT = 30 * 60e3; // when the message does not say when it resets
const MIN_WAIT = 2 * 60e3;
const MAX_WAIT = 7 * 24 * 3600e3;

// The wording of a usage limit (not a bad key or a network hiccup, which are not limits).
const LIMIT_RE = /usage limit|hit your (?:usage |weekly |5.?hour |session |monthly )?limit|limit (?:reached|exceeded)|reached your (?:usage |weekly |5.?hour )?limit|out of (?:usage|messages|credits)|rate.?limit(?:ed)?|too many requests|\b429\b|quota (?:exceeded|exhausted)|exceeded (?:your|the) (?:current )?(?:quota|usage|rate)/i;

const isLimitText = (t) => LIMIT_RE.test(String(t || ''));

// When the limit ends, from what it said: "limit reached|1761651600", "resets 3pm", "try again at 4:10 PM", "in 2 hours 10 minutes". Returns ms or null.
function parseResetAt(text, now = Date.now()) {
  const t = String(text || '');
  let m = t.match(/\|\s*(\d{10})\b/);
  if (m) return Number(m[1]) * 1000;
  m = t.match(/(?:resets?|try again|available again|back)(?: at| around| by)?\s+(?:(\w+ \d{1,2}),?\s*)?(\d{1,2})(?::(\d\d))?\s*(am|pm)\b/i);
  if (m) {
    let h = Number(m[2]) % 12 + (/pm/i.test(m[4]) ? 12 : 0);
    const d = new Date(now);
    d.setHours(h, Number(m[3] || 0), 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  m = t.match(/in\s+((?:\d+\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m)\s*(?:and\s*)?)+)/i);
  if (m) {
    let ms = 0;
    for (const p of m[1].matchAll(/(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)\b/gi)) ms += Number(p[1]) * ({ d: 864e5, h: 36e5, m: 6e4 }[p[2][0].toLowerCase()]);
    if (ms) return now + ms;
  }
  return null;
}

class Failover {
  // load(): the saved end time (ms, 0 for none); save(ms): keep it, so a restart does not forget
  constructor({ now = Date.now, load = () => 0, save = () => {} } = {}) {
    Object.assign(this, { now, save });
    this.until = Number(load()) || 0;
  }

  // Which one takes the next request.
  route() { return this.now() < this.until ? 'codex' : 'claude'; }

  get active() { return this.route() === 'codex'; }

  // A request that came back from Claude: was it stopped by the usage limit? rate: the plan limit report ({ status, resetsAt }).
  isLimit(result, rate) {
    if (!result || result.status === 'done' || result.status === 'stopped') return false;
    if (rate && String(rate.status).toLowerCase() === 'rejected') return true;
    return isLimitText(result.reply);
  }

  // Claude is out: use Codex until it resets. resetsAt may be seconds or milliseconds.
  trip({ resetsAt, text } = {}) {
    const t = this.now();
    let at = resetsAt ? (resetsAt < 1e12 ? resetsAt * 1000 : resetsAt) : parseResetAt(text, t);
    if (!at || at <= t) at = t + DEFAULT_WAIT;
    this.until = Math.min(t + MAX_WAIT, Math.max(t + MIN_WAIT, at));
    this.save(this.until);
    return this.until;
  }

  clear() { this.until = 0; this.save(0); }
}

module.exports = { Failover, isLimitText, parseResetAt, DEFAULT_WAIT, MIN_WAIT, MAX_WAIT };
