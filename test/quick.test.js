const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuick, runQuick, matchRunning } = require('../src/main/quick');

const NOW = new Date(2026, 9, 17, 15, 0, 0); // Saturday 3:00 PM
const p = (t) => parseQuick(t, NOW);

test('open, launch and start an app', () => {
  assert.deepEqual(p('Open Notes.'), { type: 'open-app', name: 'Notes' });
  assert.deepEqual(p('launch safari'), { type: 'open-app', name: 'Safari' });
  assert.deepEqual(p('Relay, please open the Calendar app'), { type: 'open-app', name: 'Calendar' });
  assert.deepEqual(p('open chrome'), { type: 'open-app', name: 'Google Chrome' });
  assert.deepEqual(p('open system settings'), { type: 'open-app', name: 'System Settings' });
});

test('open a well-known folder', () => {
  assert.deepEqual(p('open my downloads folder'), { type: 'folder', key: 'downloads' });
  assert.deepEqual(p('Open Downloads.'), { type: 'folder', key: 'downloads' });
  assert.deepEqual(p('open the desktop'), { type: 'folder', key: 'desktop' });
  assert.deepEqual(p('open music'), { type: 'open-app', name: 'Music' });
});

test('bigger requests are left for the model', () => {
  for (const t of [
    'Open Notes and make a note called groceries', 'open a new note', 'open the file called budget', 'start a routine',
    'quit everything', 'open notes and tell me what is in it', 'what apps do I have open', 'text mom I am running late',
    'open the third result', 'summarize what I copied', 'what is on my screen', 'play some jazz', 'what is the weather', 'set a timer'
  ]) assert.equal(p(t), null, t);
});

test('websites and searches', () => {
  assert.deepEqual(p('open google.com'), { type: 'open-url', url: 'https://google.com' });
  assert.deepEqual(p('go to github dot com'), { type: 'open-url', url: 'https://github.com' });
  assert.deepEqual(p('Visit https://example.org/a/b'), { type: 'open-url', url: 'https://example.org/a/b' });
  assert.deepEqual(p('open youtube'), { type: 'open-site', name: 'Youtube', url: 'https://www.youtube.com' });
  assert.deepEqual(p('open google chrome'), { type: 'open-app', name: 'Google Chrome' });
  assert.deepEqual(p('google best pizza near me'), { type: 'search', engine: 'google', query: 'best pizza near me', url: 'https://www.google.com/search?q=best%20pizza%20near%20me' });
  assert.equal(p('search youtube for cat videos').url, 'https://www.youtube.com/search_query'.replace('search_query', 'results?search_query=cat%20videos'));
});

test('switch and quit', () => {
  assert.deepEqual(p('switch to Safari'), { type: 'focus-app', name: 'Safari' });
  assert.deepEqual(p('go back to messages'), { type: 'focus-app', name: 'Messages' });
  assert.deepEqual(p('quit Spotify'), { type: 'quit-app', name: 'Spotify' });
  assert.equal(p('quit all apps'), null);
});

test('volume, brightness and dark mode', () => {
  assert.deepEqual(p('volume down'), { type: 'volume', op: 'down' });
  assert.deepEqual(p('turn the volume up'), { type: 'volume', op: 'up' });
  assert.deepEqual(p('set the volume to 30'), { type: 'volume', op: 'set', value: 30 });
  assert.deepEqual(p('mute'), { type: 'volume', op: 'mute' });
  assert.deepEqual(p('brightness down'), { type: 'brightness', op: 'down' });
  assert.deepEqual(p('make the screen brighter'), { type: 'brightness', op: 'up' });
  assert.deepEqual(p('set brightness to 40 percent'), { type: 'brightness', op: 'set', value: 0.4 });
  assert.deepEqual(p('max brightness'), { type: 'brightness', op: 'set', value: 1 });
  assert.deepEqual(p('turn on dark mode'), { type: 'dark', on: true });
  assert.deepEqual(p('switch to light mode'), { type: 'dark', on: false });
});

test('music and video', () => {
  assert.deepEqual(p('Pause.'), { type: 'media', op: 'pause' });
  assert.deepEqual(p('pause the music'), { type: 'media', op: 'pause' });
  assert.deepEqual(p('play'), { type: 'media', op: 'play', app: undefined });
  assert.deepEqual(p('resume playback'), { type: 'media', op: 'play', app: undefined });
  assert.deepEqual(p('play spotify'), { type: 'media', op: 'play', app: 'spotify' });
  assert.deepEqual(p('skip this song'), { type: 'media', op: 'next' });
  assert.deepEqual(p('next track'), { type: 'media', op: 'next' });
  assert.deepEqual(p('previous song'), { type: 'media', op: 'previous' });
});

test('timers, alarms and their questions', () => {
  assert.deepEqual(p('Set a timer for 5 minutes.'), { type: 'timer', seconds: 300, label: '' });
  assert.deepEqual(p('set a ten minute timer'), { type: 'timer', seconds: 600, label: '' });
  assert.deepEqual(p('timer for an hour and a half'), { type: 'timer', seconds: 5400, label: '' });
  assert.deepEqual(p('start a 90 second timer'), { type: 'timer', seconds: 90, label: '' });
  assert.deepEqual(p('cancel my timer'), { type: 'timer-cancel' });
  assert.deepEqual(p('how much time is left on my timer'), { type: 'timer-status' });
  const alarm = p('set an alarm for 7am');
  assert.equal(alarm.type, 'alarm');
  assert.equal(alarm.when.getHours(), 7);
  assert.equal(alarm.when.getDate(), 18);
});

test('reminders keep your words and understand when', () => {
  const a = p('Remind me to call Mom at 5pm.');
  assert.deepEqual([a.type, a.what, a.when.getHours()], ['reminder', 'Call Mom', 17]);
  const b = p('remind me tomorrow at 9 to send the invoice');
  assert.deepEqual([b.what, b.when.getDate(), b.when.getHours()], ['Send the invoice', 18, 9]);
  const c = p('remind me to buy milk');
  assert.deepEqual([c.what, c.when], ['Buy milk', null]);
  const d = p('remind me in 20 minutes to stretch');
  assert.deepEqual([d.what, d.when.getMinutes()], ['Stretch', 20]);
});

test('notes keep your words', () => {
  assert.deepEqual(p('new note buy milk and eggs'), { type: 'note', title: 'Buy milk and eggs', body: '' });
  assert.deepEqual(p('make a note called Groceries'), { type: 'note', title: 'Groceries', body: '' });
  assert.deepEqual(p('make a note called Ideas saying build a rocket'), { type: 'note', title: 'Ideas', body: 'Build a rocket' });
  assert.deepEqual(p('take a note'), { type: 'note', title: 'New note', body: '' });
  assert.equal(p('notes app'), null);
});

test('time, date, battery and the screen', () => {
  assert.deepEqual(p("What's the time?"), { type: 'info', what: 'time' });
  assert.deepEqual(p('what time is it'), { type: 'info', what: 'time' });
  assert.deepEqual(p("what's today's date"), { type: 'info', what: 'date' });
  assert.deepEqual(p('what day is it'), { type: 'info', what: 'date' });
  assert.deepEqual(p('how much battery do I have'), { type: 'info', what: 'battery' });
  assert.deepEqual(p('battery'), { type: 'info', what: 'battery' });
  assert.deepEqual(p('lock my screen'), { type: 'lock' });
  assert.deepEqual(p('turn off the display'), { type: 'display-sleep' });
});

test('running apps are matched ignoring case', () => {
  assert.equal(matchRunning('safari', ['Finder', 'Safari']), 'Safari');
  assert.equal(matchRunning('Google', ['Google Chrome']), 'Google Chrome');
  assert.equal(matchRunning('Notes', ['Finder']), null);
});

function fakeMac(over = {}) {
  const calls = [];
  return {
    calls,
    openApp: async (n) => { calls.push(['open', n]); },
    openPath: async (x) => { calls.push(['path', x]); },
    openUrl: async (u, app) => { calls.push(['url', u, app]); },
    focusApp: async (n) => { calls.push(['focus', n]); },
    quitApp: async (n) => { calls.push(['quit', n]); },
    listApps: async () => ['Finder', 'Safari'],
    osa: async (s) => { calls.push(['osa', s]); return '50'; },
    remindersAddId: async (t, due) => { calls.push(['reminder', t, due]); return 'rid'; },
    remindersDeleteById: async (id) => { calls.push(['reminder-del', id]); },
    notesCreateId: async (t, b) => { calls.push(['note', t, b]); return 'nid'; },
    notesDeleteById: async (id) => { calls.push(['note-del', id]); },
    mediaControl: async (app, op) => { calls.push(['media', app, op]); },
    mediaKey: async (op) => { calls.push(['mediakey', op]); },
    batteryStatus: async () => ({ percent: 82, state: 'on battery power', remaining: '5 hours 12 minutes' }),
    lockScreen: async () => { calls.push(['lock']); },
    ...over
  };
}

test('runQuick opens, focuses and quits through the mac helpers, and can undo', async () => {
  const mac = fakeMac();
  const open = await runQuick({ type: 'open-app', name: 'Notes' }, mac, { runningApps: ['Finder'] });
  assert.equal(open.reply, 'Opened Notes.');
  assert.equal(await open.undo(), 'Closed Notes.');
  assert.equal((await runQuick({ type: 'open-app', name: 'Safari' }, mac, { runningApps: ['Safari'] })).undo, undefined); // it was already open
  assert.equal((await runQuick({ type: 'focus-app', name: 'safari' }, mac, { prevApp: 'Finder' })).reply, 'Switched to Safari.');
  const quit = await runQuick({ type: 'quit-app', name: 'Safari' }, mac);
  assert.equal(quit.reply, 'Quit Safari.');
  assert.equal(await quit.undo(), 'Reopened Safari.');
});

test('runQuick hands back to the model when the app is unknown or not running', async () => {
  assert.equal(await runQuick({ type: 'open-app', name: 'Nope' }, fakeMac({ openApp: async () => { throw new Error('Unable to find application'); } })), null);
  assert.equal(await runQuick({ type: 'focus-app', name: 'Spotify' }, fakeMac()), null);
  assert.equal(await runQuick({ type: 'quit-app', name: 'Spotify' }, fakeMac()), null);
});

test('volume steps from the current level and undo puts it back', async () => {
  const mac = fakeMac();
  const down = await runQuick({ type: 'volume', op: 'down' }, mac);
  assert.equal(down.reply, 'Volume down to 38.');
  await down.undo();
  assert.ok(mac.calls.some((c) => c[1] === 'set volume output volume 50'));
  assert.equal((await runQuick({ type: 'volume', op: 'set', value: 100 }, mac)).reply, 'Volume set to 100.');
});

test('brightness goes through the helper, in steps, and undo restores it', async () => {
  let level = 0.6;
  const brightness = { get: async () => level, set: async (v) => (level = v) };
  const up = await runQuick({ type: 'brightness', op: 'up' }, fakeMac(), { brightness });
  assert.equal(up.reply, 'Brightness up to 75%.');
  assert.equal(await up.undo(), 'Brightness back to 60%.');
  assert.equal(level, 0.6);
  assert.equal(await runQuick({ type: 'brightness', op: 'up' }, fakeMac(), { brightness: { get: async () => { throw new Error('no display'); } } }), null);
  assert.equal(await runQuick({ type: 'brightness', op: 'up' }, fakeMac(), {}), null);
});

test('timers and alarms use the timer service; undo cancels', async () => {
  const added = [];
  const cancelled = [];
  const timers = { add: (s, l) => { added.push([s, l]); return { id: 't1' }; }, cancel: (id) => cancelled.push(id), cancelAll: () => 2, list: () => [{ label: '', endsAt: 0 }], remainingSeconds: () => 125 };
  const t = await runQuick({ type: 'timer', seconds: 300, label: '' }, fakeMac(), { timers });
  assert.equal(t.reply, 'Timer set for 5 minutes.');
  assert.equal(await t.undo(), 'Cancelled the timer.');
  assert.deepEqual([added[0], cancelled], [[300, ''], ['t1']]);
  const a = await runQuick({ type: 'alarm', when: new Date(NOW.getTime() + 3600e3) }, fakeMac(), { timers, now: () => NOW });
  assert.match(a.reply, /^Alarm set at 4:00 PM/);
  assert.equal(added[1][0], 3600);
  assert.equal((await runQuick({ type: 'timer-cancel' }, fakeMac(), { timers })).reply, 'Cancelled 2 timers.');
  assert.equal((await runQuick({ type: 'timer-status' }, fakeMac(), { timers })).reply, '2 minutes 5 seconds left.');
  assert.equal(await runQuick({ type: 'timer', seconds: 5 }, fakeMac(), {}), null);
});

test('reminders and notes are created with ids so they can be undone', async () => {
  const mac = fakeMac();
  const r = await runQuick({ type: 'reminder', what: 'Call Mom', when: new Date(2026, 9, 17, 17, 0) }, mac, { now: () => NOW });
  assert.equal(r.reply, "I'll remind you to call Mom at 5:00 PM.");
  assert.deepEqual(mac.calls.find((c) => c[0] === 'reminder'), ['reminder', 'Call Mom', '2026-10-17T17:00']);
  assert.equal(await r.undo(), 'Deleted that reminder.');
  const plain = await runQuick({ type: 'reminder', what: 'Buy milk', when: null }, mac, { now: () => NOW });
  assert.equal(plain.reply, 'Added a reminder to buy milk.');
  const n = await runQuick({ type: 'note', title: 'Groceries', body: '' }, mac);
  assert.equal(n.reply, 'Made a note called "Groceries".');
  assert.equal(await n.undo(), 'Deleted that note.');
  assert.deepEqual(mac.calls.filter((c) => c[0].endsWith('-del')), [['reminder-del', 'rid'], ['note-del', 'nid']]);
});

test('websites open in the default browser; a site name opens the app if it exists', async () => {
  const mac = fakeMac();
  assert.equal((await runQuick({ type: 'open-url', url: 'https://github.com' }, mac)).reply, 'Opened github.com.');
  assert.deepEqual(mac.calls[0], ['url', 'https://github.com', null]);
  const spotify = await runQuick({ type: 'open-site', name: 'Spotify', url: 'https://open.spotify.com' }, mac);
  assert.deepEqual([spotify.tool, mac.calls[1][0]], ['open_app', 'open']);
  const noApp = fakeMac({ openApp: async () => { throw new Error('nope'); } });
  const web = await runQuick({ type: 'open-site', name: 'Youtube', url: 'https://www.youtube.com' }, noApp);
  assert.equal(web.tool, 'open_url');
  assert.equal((await runQuick({ type: 'search', engine: 'google', query: 'pizza', url: 'u' }, mac)).reply, 'Searching Google for pizza.');
});

test('music: controls the player that is running, says what is playing, and undoes', async () => {
  const states = { Spotify: 'playing' };
  const mac = fakeMac({
    listApps: async () => ['Finder', 'Spotify'],
    osa: async (s) => (s.includes('player state') ? states.Spotify : s.includes('name of current track') ? 'Song B by Artist' : '')
  });
  const pause = await runQuick({ type: 'media', op: 'pause' }, mac);
  assert.equal(pause.reply, 'Paused.');
  assert.deepEqual(mac.calls.find((c) => c[0] === 'media'), ['media', 'Spotify', 'pause']);
  assert.equal(await pause.undo(), 'Playing again.');
  const next = await runQuick({ type: 'media', op: 'next' }, mac);
  assert.equal(next.reply, 'Skipped to Song B by Artist.');
  states.Spotify = 'paused';
  assert.equal((await runQuick({ type: 'media', op: 'pause' }, mac)).reply, 'Nothing is playing.');
  const none = fakeMac({ listApps: async () => ['Finder'] });
  assert.equal((await runQuick({ type: 'media', op: 'pause' }, none)).reply, 'Nothing is playing.');
  assert.equal((await runQuick({ type: 'media', op: 'play' }, none)).reply, 'Playing.');
  assert.deepEqual(none.calls.find((c) => c[0] === 'mediakey'), ['mediakey', 'play']);
});

test('time, date and battery are answered locally', async () => {
  assert.equal((await runQuick({ type: 'info', what: 'time' }, fakeMac(), { now: () => NOW })).reply, "It's 3:00 PM.");
  assert.equal((await runQuick({ type: 'info', what: 'date' }, fakeMac(), { now: () => NOW })).reply, 'Today is Saturday, October 17.');
  assert.equal((await runQuick({ type: 'info', what: 'battery' }, fakeMac())).reply, 'Battery is at 82%, on battery power, about 5 hours 12 minutes left.');
  assert.equal((await runQuick({ type: 'info', what: 'battery' }, fakeMac({ batteryStatus: async () => null }))).reply, 'This Mac has no battery.');
});
