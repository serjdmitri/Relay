const test = require('node:test');
const assert = require('node:assert/strict');
const { menuTopics, menuRequests, weatherQuery } = require('../src/main/menuIntent');
const { parseForecast } = require('../src/main/forecast');
test('menu keywords can occur inside natural sentences without an exact command', () => {
  const cases = {
    storage: ['I need to see my storage please', 'my computer is out of space', 'could you check the space on my Mac for me', 'storage', 'my computers space is getting low'],
    weather: ['could you bring up the weather for Paris please', 'will it rain today', 'how hot will it be in Miami tomorrow'],
    calculator: ['I could use a calculator right about now', 'can you bring that calc up for me', 'calculater please'],
    cpu: ['hows my CPU doing right now', 'I need a processor monitor please'],
    memory: ['how is my RAM looking', 'can I see memory pressure please'],
    battery: ['how much battery have I got', 'tell me the charge level please'],
    network: ['my wi-fi is slow right now', 'could I see the internet speed please', 'what is my bandwidth doing'],
    system: ['how is my computer health looking', 'can you bring up system diagnostics'],
    dashboard: ['can you bring up the activity centre please', 'what are you working on right now']
  };
  for (const [kind, phrases] of Object.entries(cases)) for (const phrase of phrases) assert.ok(menuTopics(phrase).includes(kind), phrase);
});
test('keywords do not replace actions, negations, cloud storage, teaching or file work', () => {
  for (const text of ["don't show storage", 'close the battery menu', 'hide weather', 'move my storage files', 'delete old files to free storage', 'organize my hard drive', 'send Mom the weather', 'remember my battery replacement', 'write a calculator in Python', 'explain what RAM is', 'what is a network', 'show Google Drive storage', 'open Notes and show storage', 'turn off wifi', 'save my system stats']) assert.deepEqual(menuTopics(text), [], text);
});
test('weather keywords preserve cities and units inside longer requests', () => {
  assert.deepEqual(weatherQuery('could you bring up the weather for Paris please'), { place: 'Paris' });
  assert.deepEqual(parseForecast('how hot will it be in Miami tomorrow'), { place: 'Miami' });
  assert.deepEqual(weatherQuery('bring up the weather in Hollywood Florida in Celsius and the battery menu'), { place: 'Hollywood Florida', units: 'c' });
  assert.deepEqual(weatherQuery('will it rain today'), { place: '' });
  assert.equal(weatherQuery('send Mom the weather for Paris'), null);
});
test('multiple keyword topics each produce their own menu request and repeated words deduplicate', () => {
  const menus = menuRequests('can I see storage and weather in Paris and the calculator plus battery and wifi and battery please');
  assert.deepEqual(menus.map(m => m.kind), ['storage', 'weather', 'calculator', 'battery', 'network']);
  assert.equal(menus[1].query.place, 'Paris');
});

test('network speech misspellings and direct radar requests retain local routing',()=>{
 for(const text of ['check my neckwork','check my netwrok','check my netowrk','check my net work','open radar','show me the radar','radar'])assert.deepEqual(menuTopics(text),['network'],text);
 for(const text of ['disconnect my neckwork','do not check my netwrok','explain radar','weather radar for Miami'])assert.equal(menuTopics(text).includes('network'),false,text);
});
