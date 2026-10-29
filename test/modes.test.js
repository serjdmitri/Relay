const test = require('node:test');
const assert = require('node:assert/strict');
const { Modes, parseModeCommand } = require('../src/main/modes');

const fakeStore = () => { const data = {}; return { data, get: (k) => data[k], save() {} }; };
function fakeMac(running = []) {
  const log = [];
  return { log, listApps: async () => running, openApp: async (a) => { log.push(['open', a]); }, quitApp: async (a) => { log.push(['quit', a]); }, openUrl: async (u) => { log.push(['url', u]); } };
}

test('commands: create, start, end, list, forget; built-in modes are left alone', () => {
  assert.deepEqual(parseModeCommand('Create a mode called gaming that opens Steam and Discord and closes Slack and Mail'), { type: 'mode-create', name: 'gaming', open: ['Steam', 'Discord'], quit: ['Slack', 'Mail'] });
  assert.deepEqual(parseModeCommand('make a new mode named chill that opens Spotify'), { type: 'mode-create', name: 'chill', open: ['Spotify'], quit: [] });
  assert.deepEqual(parseModeCommand('start gaming mode'), { type: 'mode-start', name: 'gaming' });
  assert.deepEqual(parseModeCommand('Relay, work mode'), { type: 'mode-start', name: 'work' });
  assert.deepEqual(parseModeCommand('switch to my meeting mode'), { type: 'mode-start', name: 'meeting' });
  assert.deepEqual(parseModeCommand('end gaming mode'), { type: 'mode-end', name: 'gaming' });
  assert.deepEqual(parseModeCommand('what modes do i have'), { type: 'mode-list' });
  assert.deepEqual(parseModeCommand('forget the gaming mode'), { type: 'mode-forget', name: 'gaming' });
  assert.equal(parseModeCommand('start focus mode'), null);
  assert.equal(parseModeCommand('study mode'), null);
  assert.equal(parseModeCommand('open notes'), null);
});

test('starting a mode quits what it lists (only if running), opens the rest, and ending brings back what it closed', async () => {
  const mac = fakeMac(['Slack', 'Safari']);
  const m = new Modes({ store: fakeStore(), mac, sleep: async () => {} });
  m.create({ name: 'Gaming', open: ['Steam', 'Safari'], quit: ['Slack', 'Mail'], urls: ['https://example.com'] });
  const r = await m.start('gaming');
  assert.deepEqual(mac.log, [['quit', 'Slack'], ['open', 'Steam'], ['url', 'https://example.com']]);
  assert.match(r.reply, /^Gaming mode is on\. Opened Steam\. Closed Slack\./);
  mac.log.length = 0;
  const end = await m.end({});
  assert.deepEqual(mac.log, [['open', 'Slack']]);
  assert.match(end.reply, /Gaming mode is off\. Reopened Slack\./);
  assert.equal((await m.end({})).reply, 'No mode is on.');
});

test('a mode that is not yours is not handled; layout and focus are used when the mode asks', async () => {
  const mac = fakeMac([]);
  const calls = [];
  const m = new Modes({ store: fakeStore(), mac, sleep: async () => {}, layouts: { restore: async (n) => { calls.push(['layout', n]); return { ok: true }; } }, focus: { start: async ({ minutes }) => calls.push(['focus', minutes]), end: async () => calls.push(['focus-end']) } });
  assert.equal(await m.start('nope'), null);
  m.create({ name: 'work', open: ['Notes'], layout: 'study', focus: 25 });
  const r = await m.start('work');
  assert.deepEqual(calls, [['layout', 'study'], ['focus', 25]]);
  assert.match(r.reply, /Windows are in place\. Focus is on for 25 minutes\./);
  await m.end({});
  assert.deepEqual(calls.at(-1), ['focus-end']);
  assert.match(m.list(), /1 mode: work/);
  assert.equal(m.forget('work'), 'Forgot your work mode.');
  assert.match(m.list(), /no modes yet/);
});

test('switching modes ends the old one first', async () => {
  const mac = fakeMac(['Slack']);
  const m = new Modes({ store: fakeStore(), mac, sleep: async () => {} });
  m.create({ name: 'a', quit: ['Slack'] });
  m.create({ name: 'b', open: ['Notes'] });
  await m.start('a');
  mac.log.length = 0;
  await m.start('b');
  assert.deepEqual(mac.log, [['open', 'Slack'], ['open', 'Notes']]);
});
