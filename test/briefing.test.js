const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { parseBriefingCommand, buildBriefing, fetchWeather, weatherWord, parseMacEvents, parseMacDue, mergeEvents } = require('../src/main/briefing');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

test('the phrases that ask for the briefing', () => {
  for (const t of ['good morning', 'Good morning, Jarvis', 'morning briefing', 'brief me', 'give me my briefing', "what's my day look like", "what's on today", 'what do I have today', 'how is my day looking']) assert.deepEqual(parseBriefingCommand(t), { type: 'briefing' }, t);
  for (const t of ['open notes', 'good night', 'what is the weather', 'brief the team on the plan']) assert.equal(parseBriefingCommand(t), null, t);
});

test('the daily briefing can follow an existing unlock greeting without repeating it', () => {
  const text = buildBriefing({ now: new Date(2026, 9, 27, 9), includeGreeting: false, missing: ['calendar', 'reminders', 'weather'] });
  assert.doesNotMatch(text, /^Good /);
  assert.match(text, /Set your city/);
});

test('unavailable sources are disclosed instead of being reported clear', () => {
  const text = buildBriefing({ now: new Date(2026, 9, 27, 9), includeGreeting: false, missing: ['calendar', 'google-calendar', 'reminders', 'mail', 'weather-unavailable'] });
  assert.match(text, /could not check Mac calendar, Google calendar, reminders, email and weather/);
  assert.doesNotMatch(text, /calendar is clear|Nothing is due|No important unread email/);
});

test('the briefing says each part that there is, in a sensible order, and leaves out what is not set up', () => {
  const now = new Date(2026, 9, 27, 7, 30);
  const text = buildBriefing({
    now, name: 'Sergey', weather: { city: 'Hollywood', tempNow: 78, high: 86, low: 74, rain: 60, word: 'partly cloudy', units: 'f' },
    events: [{ title: 'Robotics meeting', start: new Date(2026, 9, 27, 15, 0) }, { title: 'Calc quiz', start: new Date(2026, 9, 27, 9, 15) }, { title: 'Spirit day', allDay: true }],
    due: [{ title: 'AP Lit essay', overdue: false }, { title: 'Pay dues', overdue: true }], mail: [{ from: 'Ms. Rivera <r@school.org>', subject: 'Scholarship deadline' }], mailChecked: true
  });
  assert.match(text, /^Good morning, Sergey\. It is 78 degrees and partly cloudy in Hollywood, a high of 86 and a low of 74, with a 60 percent chance of rain, so take an umbrella\./);
  assert.match(text, /2 events still ahead: Calc quiz at 9:15 AM and Robotics meeting at 3 PM; all day: Spirit day\./);
  assert.match(text, /2 reminders are due: Pay dues and AP Lit essay, 1 of them overdue\./);
  assert.match(text, /One important unread email: Ms\. Rivera about Scholarship deadline\.$/);
  assert.ok(text.indexOf('weather') < 0 && text.indexOf('degrees') < text.indexOf('calendar'), 'weather first, then the calendar');
  const bare = buildBriefing({ now, missing: ['weather'] });
  assert.equal(bare, 'Good morning. Your calendar is clear today. Nothing is due. Set your city in Settings and I will add the weather.');
  assert.match(buildBriefing({ now: new Date(2026, 9, 27, 19, 0), events: [{ title: 'Practice', start: new Date(2026, 9, 27, 16, 0) }] }), /^Good evening\..*one event today, all already done/);
  assert.doesNotMatch(buildBriefing({ now, missing: ['calendar', 'reminders'] }), /clear today|Nothing is due/, 'a source that failed is not reported as empty');
});

test('the weather comes from the free forecast service, using the city and its region, in the units asked for', async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    if (/geocoding/.test(url)) return { json: async () => ({ results: [{ name: 'Hollywood', admin1: 'California', country: 'United States', latitude: 34, longitude: -118 }, { name: 'Hollywood', admin1: 'Florida', country: 'United States', country_code: 'US', latitude: 26.01, longitude: -80.15 }] }) };
    return { json: async () => ({ current: { temperature_2m: 79.6, weather_code: 2 }, daily: { temperature_2m_max: [86.2], temperature_2m_min: [74.4], precipitation_probability_max: [45], weather_code: [61] } }) };
  };
  const w = await fetchWeather('Hollywood, Florida', { fetchFn });
  assert.deepEqual(w, { city: 'Hollywood', tempNow: 80, high: 86, low: 74, rain: 45, word: 'rainy', units: 'f' });
  assert.match(urls[1], /latitude=26\.01&longitude=-80\.15/, 'Florida, not California');
  assert.match(urls[1], /temperature_unit=fahrenheit/);
  await fetchWeather('Paris', { fetchFn, units: 'c' });
  assert.match(urls.at(-1), /temperature_unit=celsius/);
  assert.equal(await fetchWeather('', { fetchFn }), null);
  assert.equal(await fetchWeather('Nowhere', { fetchFn: async () => ({ json: async () => ({}) }) }), null);
  assert.equal(weatherWord(95), 'thunderstorms');
});

test('weather does not silently use a city in the wrong region or incomplete measurements', async () => {
  let requests = 0;
  const wrongRegion = async () => { requests++; return { json: async () => ({ results: [{ name: 'Hollywood', admin1: 'California', country: 'United States', latitude: 34, longitude: -118 }] }) }; };
  assert.equal(await fetchWeather('Hollywood, Florida', { fetchFn: wrongRegion }), null);
  assert.equal(requests, 1, 'no forecast for the wrong place');
  const incomplete = async (url) => ({ json: async () => /geocoding/.test(url) ? { results: [{ name: 'Paris', latitude: 1, longitude: 2 }] } : { current: {}, daily: { temperature_2m_max: [20] } } });
  assert.equal(await fetchWeather('Paris', { fetchFn: incomplete }), null);
});

test('overdue reminders lead the daily briefing even when returned last', () => {
  const due = [{ title: 'Later one' }, { title: 'Later two' }, { title: 'Later three' }, { title: 'Later four' }, { title: 'Past due', overdue: true }];
  const text = buildBriefing({ includeGreeting: false, due });
  assert.match(text, /due: Past due, Later one, Later two and Later three, and more, 1 of them overdue/);
});

test('events and reminders read from the Calendar and Reminders apps, and the same event from two calendars is said once', () => {
  const ev = parseMacEvents('Calc quiz | Tuesday, October 27, 2026 at 9:15:00 AM\nSpirit day | Tuesday, October 27, 2026 at 12:00:00 AM\nOdd | not a date');
  assert.deepEqual(ev.map((e) => [e.title, e.start?.getHours() ?? null, e.allDay]), [['Calc quiz', 9, false], ['Spirit day', 0, true], ['Odd', null, false]]);
  assert.deepEqual(parseMacEvents('No events.'), []);
  const due = parseMacDue('Pay dues | Monday, October 26, 2026 at 5:00:00 PM\nEssay | Tuesday, October 27, 2026 at 5:00:00 PM', new Date(2026, 9, 27, 8));
  assert.deepEqual(due, [{ title: 'Pay dues', overdue: true }, { title: 'Essay', overdue: false }]);
  assert.deepEqual(parseMacDue('No reminders due.'), []);
  const d = new Date(2026, 9, 27, 9, 15);
  assert.equal(mergeEvents([{ title: 'Calc quiz', start: d }], [{ title: ' calc QUIZ ', start: new Date(d) }, { title: 'Other', start: d }]).length, 2);
});

test('the controller gathers every source at once, and a source that fails is only left out', async () => {
  const c = Object.create(AskController.prototype);
  const now = new Date();
  const at = () => new Date(Math.floor((now.getTime() + 3600000) / 60000) * 60000); // an hour from now, whatever the time is
  const day = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const clock = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).replace(' ', ' ');
  Object.assign(c, {
    store: { get: (k) => (k === 'settings.briefing' ? { name: 'Sergey', city: '' } : null) },
    mac: { calendarEvents: async () => `Dentist | ${day(at())} at ${clock(at())}`, remindersDue: async () => { throw new Error('Reminders is not allowed'); } },
    googleApiIfConnected: () => ({ calEvents: async () => [{ title: 'Dentist', start: at().toISOString() }], gmailSearch: async () => [{ from: 'Coach <c@x.org>', subject: 'Practice moved' }] })
  });
  const text = await c.briefingText();
  assert.match(text, /^Good (morning|afternoon|evening), Sergey\./);
  assert.match(text, /one event still ahead: Dentist at \d/, 'the same event from the Mac and Google is said once');
  assert.match(text, /One important unread email: Coach about Practice moved\./);
  assert.doesNotMatch(text, /Nothing is due/, 'reminders could not be read, which is not the same as nothing due');
  assert.match(text, /Set your city/);
});
