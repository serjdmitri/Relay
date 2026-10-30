// "Welcome back, Sir": when you unlock the Mac after being away a while, Jarvis greets you and says what happened. Everything is worked out from facts
// the app already has (no model call, so it is instant); the caller gathers them and decides whether to speak. Pure functions.

const DAY_MS = 86400e3;

// Should it greet? Away at least `minAwayMs` (your setting; 0 means every unlock), not greeted within `minGapMs` (your setting, 10 minutes by default), and nothing else is using the screen (a meeting recording).
function shouldGreet({ enabled = true, awayMs = 0, minAwayMs = 5 * 60000, minGapMs = 10 * 60000, sinceLastMs = Infinity, busy = false } = {}) {
  return enabled && !busy && awayMs >= minAwayMs && sinceLastMs >= minGapMs;
}

const clip = (s, n = 60) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
const clock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: new Date(ms).getMinutes() ? '2-digit' : undefined });

// Use the Mac's local time, not UTC: night runs from 10 PM until 5 AM.
function greetingFor(now, name = 'Sir') {
  const hour = new Date(now).getHours();
  const part = hour < 5 || hour >= 22 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  return `Good ${part}, ${name}.`;
}

// How long: "about 25 minutes", "about 3 hours".
function awayWords(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `about ${m} minutes`;
  const h = Math.round(m / 6) / 10;
  return h < 24 ? `about ${h === Math.round(h) ? Math.round(h) : h} hour${h === 1 ? '' : 's'}` : `about ${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? '' : 's'}`;
}

// facts: { name, lockedAt, now, history: [{ text, status, ts, reply }], events: [{ title, start }], battery: { present, onBattery, charging, percent } | null }
// Returns { spoken, lines }: a short spoken version (the greeting and the top items) and every line for the banner.
function buildWelcome({ name = 'Sir', lockedAt, now = Date.now(), history = [], events = [], battery = null } = {}) {
  const away = Math.max(0, now - lockedAt);
  const lines = [];
  const done = history.filter((h) => (h.finishedAt ?? h.ts) >= lockedAt && (h.finishedAt ?? h.ts) <= now && h.text && ['done', 'failed', 'missed'].includes(h.status));
  const ok = done.filter((h) => h.status === 'done');
  const bad = done.filter((h) => h.status === 'failed');
  const missed = done.filter((h) => h.status === 'missed');
  if (ok.length) lines.push(ok.length === 1 ? `Finished while you were away: ${clip(ok[0].text.replace(/^Agent: /, ''))}.` : `${plural(ok.length, 'thing', 'things')} finished while you were away, including ${clip(ok[0].text.replace(/^Agent: /, ''), 40)}.`);
  if (bad.length) lines.push(bad.length === 1 ? `One did not work: ${clip(bad[0].text.replace(/^Agent: /, ''))}.` : `${bad.length} did not work.`);
  if (missed.length) lines.push(missed.length === 1 ? `One scheduled task was missed: ${clip(missed[0].text.replace(/^Scheduled: /, ''))}.` : `${missed.length} scheduled tasks were missed.`);
  const next = events.filter((e) => e.start >= now - 5 * 60000 && e.start - now <= 3 * 3600e3).sort((a, b) => a.start - b.start)[0];
  if (next) { const min = Math.round((next.start - now) / 60000); lines.push(min <= 0 ? `${clip(next.title, 50)} is starting now.` : min < 60 ? `${clip(next.title, 50)} starts in ${plural(min, 'minute', 'minutes')}.` : `Next up: ${clip(next.title, 50)} at ${clock(next.start)}.`); }
  if (battery?.present && battery.onBattery && !battery.charging && battery.percent <= 20) lines.push(`The battery is at ${battery.percent} percent.`);
  const greet = greetingFor(now, name);
  const away2 = away >= 30 * 60000 ? ` You were away ${awayWords(away)}.` : '';
  const spoken = lines.length ? `${greet}${away2} ${lines.slice(0, 3).join(' ')}` : `${greet}${away2} Nothing needs your attention.`;
  return { spoken: spoken.trim(), lines: lines.length ? lines : ['Nothing needs your attention.'], away };
}

module.exports = { shouldGreet, buildWelcome, awayWords, greetingFor };
