// The morning briefing: one short spoken summary of today (the weather, the calendar, what is due, the email that matters). Each part is optional, so
// whatever is not set up or does not answer is simply left out. Gathering is done by the caller; this file says what to ask for and how to say it. Pure
// apart from the weather lookup, which takes the fetch it uses.

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// "Good morning", "morning briefing", "brief me", "what's my day look like", "what's on today". Returns { type: 'briefing' } or null.
function parseBriefingCommand(text) {
  const n = clean(text).replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '').replace(/ please$/, '');
  if (/^(?:good morning|morning)(?: jarvis| relay)?$/.test(n)) return { type: 'briefing' };
  if (/^(?:give me |read me |tell me |play )?(?:my |the |a )?(?:morning |daily |day )?(?:briefing|brief|rundown|run down|summary of my day)(?: for (?:today|this morning))?$/.test(n)) return { type: 'briefing' };
  if (/^brief me$|^(?:what s|what is|whats) (?:my day look like|my day like|on today|on my plate today|happening today|going on today|my schedule today)$|^how s my day looking$|^how is my day looking$|^what do i have (?:on )?today$/.test(n)) return { type: 'briefing' };
  return null;
}

// Open-Meteo weather codes in plain words.
const CODES = [[0, 'clear'], [1, 'mostly clear'], [2, 'partly cloudy'], [3, 'overcast'], [45, 'foggy'], [48, 'foggy'], [51, 'drizzling'], [53, 'drizzling'], [55, 'drizzling'], [56, 'freezing drizzle'], [57, 'freezing drizzle'], [61, 'rainy'], [63, 'rainy'], [65, 'heavy rain'], [66, 'freezing rain'], [67, 'freezing rain'], [71, 'snowy'], [73, 'snowy'], [75, 'heavy snow'], [77, 'snowy'], [80, 'showery'], [81, 'showery'], [82, 'stormy showers'], [85, 'snow showers'], [86, 'snow showers'], [95, 'thunderstorms'], [96, 'thunderstorms with hail'], [99, 'thunderstorms with hail']];
const weatherWord = (code) => (CODES.find(([c]) => c === code) || [0, ''])[1];

// city: "Hollywood, Florida" (the name before a comma is looked up, the rest narrows it). Returns { city, tempNow, high, low, rain, word } or null. units: 'f' | 'c'.
async function fetchWeather(city, { fetchFn = fetch, units = 'f', signal } = {}) {
  const q = String(city || '').trim();
  if (!q) return null;
  const [name, ...rest] = q.split(',').map((s) => s.trim());
  const g = await (await fetchFn(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name, count: '5', language: 'en', format: 'json' })}`, { signal })).json();
  const hint = rest.join(' ').toLowerCase();
  const place = (g.results || []).find((r) => !hint || `${r.admin1 || ''} ${r.country || ''} ${r.country_code || ''}`.toLowerCase().includes(hint)) || (g.results || [])[0];
  if (!place) return null;
  const f = await (await fetchFn(`https://api.open-meteo.com/v1/forecast?${new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), current: 'temperature_2m,weather_code', daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code', temperature_unit: units === 'c' ? 'celsius' : 'fahrenheit', timezone: 'auto', forecast_days: '1' })}`, { signal })).json();
  const d = f.daily || {};
  if (!d.temperature_2m_max) return null;
  const code = d.weather_code?.[0] ?? f.current?.weather_code;
  return { city: place.name, tempNow: Math.round(f.current?.temperature_2m), high: Math.round(d.temperature_2m_max[0]), low: Math.round(d.temperature_2m_min[0]), rain: d.precipitation_probability_max?.[0] ?? 0, word: weatherWord(code), units };
}

const hour = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined }).replace(' ', ' ');
const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);

// facts: { now: Date, name, weather, events: [{ title, start: Date|null, allDay }], due: [{ title, overdue }], mail: [{ from, subject }], unreadCount, missing: ['weather', …] }
function buildBriefing(f) {
  const now = f.now || new Date();
  const part = now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening';
  const out = f.includeGreeting === false ? [] : [`Good ${part}${f.name ? `, ${f.name}` : ''}.`];
  const w = f.weather;
  if (w) {
    const deg = w.units === 'c' ? '°C' : ' degrees';
    out.push(`It is ${w.tempNow}${deg} and ${w.word || 'fine'} in ${w.city}, a high of ${w.high} and a low of ${w.low}${w.rain >= 40 ? `, with a ${w.rain} percent chance of rain, so take an umbrella` : ''}.`);
  }
  const ev = (f.events || []).filter((e) => e && e.title);
  if (ev.length) {
    const timed = ev.filter((e) => e.start && !e.allDay).sort((a, b) => a.start - b.start);
    const upcoming = timed.filter((e) => e.start >= new Date(now.getTime() - 15 * 60000));
    const allDay = ev.filter((e) => e.allDay || !e.start);
    const bits = [];
    if (upcoming.length) bits.push(`${upcoming.length === 1 ? 'one event' : `${upcoming.length} events`} still ahead: ${list(upcoming.slice(0, 4).map((e) => `${e.title} at ${hour(e.start)}`))}${upcoming.length > 4 ? ', and more' : ''}`);
    else if (timed.length) bits.push(`${timed.length === 1 ? 'one event' : `${timed.length} events`} today, all already done`);
    if (allDay.length) bits.push(`all day: ${list(allDay.slice(0, 3).map((e) => e.title))}`);
    out.push(bits.length ? `On your calendar, ${bits.join('; ')}.` : 'Your calendar is clear.');
  } else if (!(f.missing || []).includes('calendar')) out.push('Your calendar is clear today.');
  const due = f.due || [];
  if (due.length) {
    const overdue = due.filter((d) => d.overdue);
    out.push(`${due.length === 1 ? 'One reminder is' : `${due.length} reminders are`} due: ${list(due.slice(0, 4).map((d) => d.title))}${overdue.length ? `, ${overdue.length === due.length ? 'overdue' : `${overdue.length} of them overdue`}` : ''}.`);
  } else if (!(f.missing || []).includes('reminders')) out.push('Nothing is due.');
  if (f.mail && f.mail.length) out.push(`${f.mail.length === 1 ? 'One important unread email' : `${f.mail.length} important unread emails`}: ${list(f.mail.slice(0, 3).map((m) => `${String(m.from).replace(/<.*$/, '').replace(/"/g, '').trim() || 'someone'} about ${String(m.subject || 'no subject').slice(0, 60)}`))}.`);
  else if (f.mail && f.mail.length === 0 && !(f.missing || []).includes('mail') && f.mailChecked) out.push('No important unread email.');
  const miss = (f.missing || []).filter((m) => m === 'weather');
  if (miss.length) out.push('Set your city in Settings and I will add the weather.');
  const unavailable = (f.missing || []).filter((m) => ['calendar', 'google-calendar', 'reminders', 'mail', 'weather-unavailable'].includes(m));
  if (unavailable.length) {
    const names = { calendar: 'Mac calendar', 'google-calendar': 'Google calendar', reminders: 'reminders', mail: 'email', 'weather-unavailable': 'weather' };
    out.push(`I could not check ${list(unavailable.map((m) => names[m]))}.`);
  }
  return out.join(' ');
}

// "Title | Tuesday, October 27, 2026 at 3:00:00 PM" lines from the Calendar app, as events. A date that cannot be read leaves the event without a time.
function parseMacEvents(text) {
  if (!text || /^No events/i.test(text)) return [];
  return String(text).split('\n').map((line) => {
    const i = line.lastIndexOf(' | ');
    if (i < 0) return null;
    const title = line.slice(0, i).trim();
    const raw = line.slice(i + 3).trim();
    const d = new Date(raw.replace(' at ', ' '));
    const ok = !Number.isNaN(d.getTime());
    return { title, start: ok ? d : null, allDay: ok && d.getHours() === 0 && d.getMinutes() === 0 };
  }).filter(Boolean);
}

// "Name | date" lines of reminders due by the end of today.
function parseMacDue(text, now = new Date()) {
  if (!text || /^No /i.test(text)) return [];
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  return String(text).split('\n').map((line) => {
    const i = line.lastIndexOf(' | ');
    const title = (i < 0 ? line : line.slice(0, i)).trim();
    if (!title) return null;
    const d = i < 0 ? null : new Date(line.slice(i + 3).trim().replace(' at ', ' '));
    return { title, overdue: !!d && !Number.isNaN(d.getTime()) && d < startOfDay };
  }).filter(Boolean);
}

// The same event from the Mac's Calendar and from Google (a calendar added to both) is said once.
function mergeEvents(...lists) {
  const seen = new Set();
  const out = [];
  for (const e of lists.flat()) {
    const k = `${clean(e.title)}|${e.start ? e.start.getTime() : 'allday'}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

module.exports = { parseBriefingCommand, buildBriefing, fetchWeather, weatherWord, parseMacEvents, parseMacDue, mergeEvents };
