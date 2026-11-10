const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuick, runQuick } = require('../src/main/quick');

const fakeMac = (apps = [], states = {}) => ({ listApps: async () => apps, osa: async (script) => { for (const a of Object.keys(states)) if (script.includes(`"${a}"`)) return script.includes('player state') ? states[a].state : states[a].track; return ''; } });
const ask = async (mac, ctx) => runQuick(parseQuick('what song is this'), mac, ctx);

test('"what song is this" says what a playing browser tab is when no music app is playing', async () => {
  const tab = (title) => ({ audibleTabs: async () => [{ title, audible: true }] });
  assert.equal((await ask(fakeMac(), tab('Juice WRLD - Lucid Dreams (Official Video) - YouTube'))).reply, 'A browser tab is playing: Juice WRLD - Lucid Dreams (Official Video).');
  assert.equal((await ask(fakeMac(), tab('Lofi beats to study to - YouTube Music'))).reply, 'A browser tab is playing: Lofi beats to study to.');
  assert.match((await ask(fakeMac(), { audibleTabs: async () => [{ title: '', audible: true }] })).reply, /no title I can read/);
});

test('a music app that is playing wins; with no tab and no app it still says nothing is playing, and a failing tab lookup is ignored', async () => {
  const spotify = fakeMac(['Spotify'], { Spotify: { state: 'playing', track: 'Lucid Dreams by Juice WRLD' } });
  assert.match((await ask(spotify, { audibleTabs: async () => [{ title: 'A video' }] })).reply, /Playing Lucid Dreams by Juice WRLD \(Spotify\)/);
  assert.equal((await ask(fakeMac(), { audibleTabs: async () => [] })).reply, 'Nothing is playing.');
  assert.equal((await ask(fakeMac(), { audibleTabs: async () => { throw new Error('no browser'); } })).reply, 'Nothing is playing.');
  assert.equal((await ask(fakeMac(), {})).reply, 'Nothing is playing.', 'without the tab lookup it behaves as before');
});
