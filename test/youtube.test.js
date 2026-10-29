const test = require('node:test');
const assert = require('node:assert/strict');
const y = require('../src/main/youtube');

test('commands are only taken when they name YouTube or the video, so plain pause still goes to your music', () => {
  assert.equal(y.parseYoutubeCommand('pause'), null);
  assert.deepEqual(y.parseYoutubeCommand('pause YouTube'), { type: 'youtube', op: 'pause', weak: false });
  assert.deepEqual(y.parseYoutubeCommand('Relay, play the video'), { type: 'youtube', op: 'play', weak: true });
  assert.deepEqual(y.parseYoutubeCommand('skip ahead 30 seconds on YouTube'), { type: 'youtube', op: 'seek', by: 30, weak: false });
  assert.deepEqual(y.parseYoutubeCommand('rewind 2 minutes on youtube'), { type: 'youtube', op: 'seek', by: -120, weak: false });
  assert.deepEqual(y.parseYoutubeCommand('go to 5 minutes on youtube'), { type: 'youtube', op: 'seek-to', to: 300, weak: false });
  assert.deepEqual(y.parseYoutubeCommand('youtube go to 1:30'), { type: 'youtube', op: 'seek-to', to: 90, weak: false });
  assert.deepEqual(y.parseYoutubeCommand('youtube speed 1.5'), { type: 'youtube', op: 'speed', rate: 1.5, weak: false });
  assert.deepEqual(y.parseYoutubeCommand('speed up the video'), { type: 'youtube', op: 'speed-step', step: 0.25, weak: true });
  assert.deepEqual(y.parseYoutubeCommand('next video on youtube'), { type: 'youtube', op: 'next', weak: false });
  assert.deepEqual(y.parseYoutubeCommand('mute youtube'), { type: 'youtube', op: 'mute', on: true, weak: false });
  assert.deepEqual(y.parseYoutubeCommand('youtube volume 40'), { type: 'youtube', op: 'volume', to: 40, weak: false });
  assert.deepEqual(y.parseYoutubeCommand('turn on captions on youtube'), { type: 'youtube', op: 'captions', weak: false });
  assert.equal(y.parseYoutubeCommand('open youtube'), null);
  assert.equal(y.parseYoutubeCommand('search youtube for cats'), null);
});

test('the page script carries the numbers and always reports a status line', () => {
  const s = y.pageScript({ op: 'seek', by: -30 });
  assert.match(s, /currentTime \+ \(-30\)/);
  assert.match(s, /document\.querySelector\('video'\)/);
  assert.match(y.pageScript({ op: 'speed', rate: 5 }), /Math\.min\(2, 5\)/);
  assert.throws(() => y.pageScript({ op: 'nope' }));
});

test('the AppleScript only talks to a running browser and quotes the script safely', () => {
  const lines = y.tabScript('Google Chrome', 'var a="x\\n";');
  assert.match(lines[0], /is not running then return "NOBROWSER"/);
  assert.ok(lines.some((l) => l.includes('execute t javascript "var a=\\"x\\\\n\\";"')));
  assert.ok(y.tabScript('Safari', 'x').some((l) => l.startsWith('return do JavaScript')));
  assert.ok(lines.some((l) => l.includes('youtube.com/watch')));
});

test('the first browser with a YouTube tab answers; none found says so; a blocked script explains the one-time setting', async () => {
  const calls = [];
  const yc = new y.YoutubeControl({ osa: async (lines) => { const b = /application "([^"]+)"/.exec(lines[0])[1]; calls.push(b); return b === 'Brave Browser' ? 'Cool song|playing|65|200|1|sound|80' : 'NOTAB'; } });
  const r = await yc.run({ op: 'seek', by: 30, weak: false });
  assert.equal(r.reply, 'Skipped ahead 30 seconds. Now at 1:05 of 3:20.');
  assert.deepEqual(calls, ['Google Chrome', 'Brave Browser']);
  const none = await new y.YoutubeControl({ osa: async () => 'NOBROWSER' }).run({ op: 'pause' });
  assert.match(none.reply, /could not find an open YouTube video/);
  const blocked = await new y.YoutubeControl({ osa: async () => { throw new Error('execution error: Google Chrome got an error: Executing JavaScript through AppleScript is turned off. Allow JavaScript from Apple Events (12)'); } }).run({ op: 'pause' });
  assert.equal(blocked.reply, y.SETUP);
});

test('replies: speed, volume, info, and the no-video cases', () => {
  assert.equal(y.replyFor({ op: 'speed' }, 'T|playing|1|10|1.5|sound|50'), 'Speed 1.5x.');
  assert.equal(y.replyFor({ op: 'info' }, 'My video|paused|75|300|1|sound|50'), 'My video, paused, at 1:15 of 5:00.');
  assert.equal(y.replyFor({ op: 'pause' }, 'NOVIDEO'), 'That YouTube tab has no video playing on it.');
  assert.equal(y.replyFor({ op: 'next', weak: false }, 'NONEXT'), 'There is no next video here.');
});
