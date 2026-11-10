const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBriefing } = require('../src/main/briefing');
const { AskController } = require('../src/main/askController');

const weather = { city: 'Miami', tempNow: 80, high: 85, low: 75, rain: 50, word: 'sunny', units: 'f' };
const base = (over = {}) => ({ now: new Date(2026, 10, 10, 7), weather, events: [{ title: 'Dentist', start: new Date(2026, 10, 10, 15), allDay: false }], due: [{ title: 'Pay rent', overdue: false }], mail: [{ from: 'Ana', subject: 'Lunch' }], mailChecked: true, missing: [], disabled: [], ...over });

test('only the chosen parts are said; the weather is left for the card by default setting', () => {
  const text = buildBriefing(base({ say: { weather: false } }));
  assert.doesNotMatch(text, /Miami|degrees|umbrella/);
  assert.match(text, /Dentist/); assert.match(text, /Pay rent/); assert.match(text, /Ana about Lunch/);
  const some = buildBriefing(base({ say: { weather: false, mail: false, reminders: false } }));
  assert.match(some, /Dentist/); assert.doesNotMatch(some, /Pay rent|Ana|Briefing sources turned off/);
  assert.match(buildBriefing(base({ say: { weather: true } })), /It is 80 degrees/);
  assert.match(buildBriefing(base()), /It is 80 degrees/, 'without a setting it behaves as before');
});

test('a part that is not spoken is not nagged about either', () => {
  const text = buildBriefing(base({ weather: null, missing: ['weather', 'mail'], say: { weather: false, mail: false } }));
  assert.doesNotMatch(text, /city|could not check/);
});

test('a later briefing says only what is new, skips "all clear" lines, and says so when nothing is', () => {
  const later = buildBriefing(base({ say: { weather: false }, later: true, includeGreeting: false, events: [], due: [], mail: [] }));
  assert.equal(later, 'Nothing new since earlier.');
  const some = buildBriefing(base({ say: { weather: false }, later: true, includeGreeting: false, events: [], due: [{ title: 'Call Sam', overdue: false }], mail: [] }));
  assert.match(some, /Call Sam/); assert.doesNotMatch(some, /Dentist|calendar is clear|No important/);
});

test('the first briefing of the day says everything chosen, the next only the new items, and a new day starts over', async () => {
  const data = { settings: { briefing: { say: { weather: false }, onlyNew: true } } };
  const store = { get: (k) => (k === 'settings.briefing' ? data.settings.briefing : data[k]), set: (k, v) => { data[k] = v; } };
  let facts = base();
  const self = { store, briefingFacts: async () => facts };
  const say = () => AskController.prototype.briefingText.call(self, {});
  const first = await say();
  assert.match(first, /Good morning/); assert.match(first, /Dentist/); assert.match(first, /Pay rent/); assert.doesNotMatch(first, /Miami/);
  assert.equal(await say(), 'Nothing new since earlier.', 'opened again: nothing repeated');
  facts = base({ now: new Date(2026, 10, 10, 13), mail: [{ from: 'Ana', subject: 'Lunch' }, { from: 'Bo', subject: 'Invoice' }] });
  const third = await say();
  assert.match(third, /Bo about Invoice/); assert.doesNotMatch(third, /Dentist|Pay rent|Ana|Good/);
  facts = base({ now: new Date(2026, 10, 11, 7), events: [{ title: 'Dentist', start: new Date(2026, 10, 11, 15), allDay: false }] });
  assert.match(await say(), /Good morning[\s\S]*Dentist/, 'the next day says everything again');
  data.settings.briefing.onlyNew = false; facts = base({ now: new Date(2026, 10, 11, 9), events: [{ title: 'Dentist', start: new Date(2026, 10, 11, 15), allDay: false }] });
  assert.match(await say(), /Dentist/, 'with the option off it always says everything');
});
