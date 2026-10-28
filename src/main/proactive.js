// Relay speaking up on its own. Things that happen (a meeting about to start, a job that finished, a low battery) become events with an
// importance score; a policy decides how loudly each one may be told: spoken, a quiet banner, and/or a message to your phone. The rules are pure
// functions, so they can be tested without waiting for a meeting.
//
// Your options (Settings > Doctor > Experimental > Speak up on its own):
//   mode: 'silent-urgent' (default: a quiet banner, spoken only when urgent, at most 3 spoken an hour) | 'silent' (never spoken) | 'speak' (anything important)
//   quiet hours (default 22:00 to 07:00): nothing is spoken; only the most urgent things reach your phone

const HOUR = 3600e3;
const URGENT = 0.75;

// How much an event matters, 0 to 1.
function scoreEvent(e) {
  switch (e.type) {
    case 'calendar': return e.minutes <= 2 ? 0.95 : e.minutes <= 5 ? 0.85 : e.minutes <= 10 ? 0.7 : 0.3;
    case 'battery': return e.percent <= 5 ? 0.95 : e.percent <= 10 ? 0.9 : e.percent <= 20 ? 0.6 : 0;
    case 'job': return e.status === 'failed' ? 0.7 : 0.5;
    case 'plugin': return Math.max(0, Math.min(1, Number(e.importance) || 0.5));
    default: return 0.3;
  }
}

const textFor = (e) => {
  switch (e.type) {
    case 'calendar': return e.minutes <= 1 ? `${e.title} is starting now.` : `${e.title} starts in ${e.minutes} minutes.`;
    case 'battery': return `The battery is at ${e.percent} percent. Plug in soon.`;
    case 'job': return e.status === 'failed' ? `That did not work: ${e.title}.` : `Finished: ${e.title}.`;
    default: return String(e.title || '');
  }
};

// The event's own identity, so the same thing is not told twice.
const keyOf = (e) => (e.type === 'calendar' ? `cal:${e.title}:${e.start}` : e.type === 'battery' ? `bat:${e.percent <= 10 ? 10 : 20}` : e.type === 'job' ? `job:${e.id || e.title}` : `${e.type}:${e.title}`);

const inQuiet = (q, date) => { if (!q?.on) return false; const h = date.getHours(); return q.from > q.to ? h >= q.from || h < q.to : h >= q.from && h < q.to; };

class Alerts {
  constructor({ now = Date.now } = {}) { this.now = now; this.spoken = []; this.seen = new Map(); }

  // ctx: { mode, quiet: {on, from, to}, cap, busy (meeting or sharing or you are talking), away (locked or idle) }
  // Returns { how: 'speak' | 'pill' | 'drop', phone: bool, quiet: bool, text, score, key }.
  decide(event, ctx = {}) {
    const t = this.now();
    const score = scoreEvent(event);
    const key = keyOf(event);
    const text = textFor(event);
    for (const [k, at] of this.seen) if (t - at > 30 * 60000) this.seen.delete(k);
    if (score < 0.4 || this.seen.has(key)) return { how: 'drop', phone: false, text, score, key };
    this.seen.set(key, t);
    this.spoken = this.spoken.filter((s) => t - s < HOUR);
    const quiet = inQuiet(ctx.quiet, new Date(t));
    const mode = ctx.mode || 'silent-urgent';
    const cap = ctx.cap ?? (mode === 'speak' ? 6 : 3);
    const wantSpeak = mode === 'speak' ? score >= 0.5 : mode === 'silent-urgent' ? score >= URGENT : false;
    const speak = wantSpeak && !quiet && !ctx.busy && this.spoken.length < cap;
    if (speak) this.spoken.push(t);
    const phone = quiet ? score >= 0.9 : ctx.away ? score >= 0.6 : score >= 0.9;
    return { how: speak ? 'speak' : 'pill', phone, quiet: quiet || !!ctx.busy, text, score, key };
  }
}

// "title | Monday, November 3, 2025 at 3:00:00 PM" lines from the calendar tool.
function parseCalendar(out) {
  return String(out || '').split('\n').map((l) => l.split(' | ')).filter((p) => p.length >= 2).map(([title, when]) => ({ title: title.trim(), start: Date.parse(String(when).replace(' at ', ' ')) })).filter((e) => Number.isFinite(e.start));
}

// Meetings starting within the next 10 minutes (and not already more than a minute under way).
function calendarEvents(events, now = Date.now()) {
  return events.map((e) => ({ type: 'calendar', title: e.title.slice(0, 80), start: e.start, minutes: Math.ceil((e.start - now) / 60000) })).filter((e) => e.minutes <= 10 && e.minutes >= 0);
}

const batteryEvent = (b) => (b?.present && b.onBattery && !b.charging && b.percent <= 20 ? { type: 'battery', percent: b.percent } : null);

module.exports = { scoreEvent, textFor, keyOf, Alerts, parseCalendar, calendarEvents, batteryEvent, inQuiet, URGENT };
