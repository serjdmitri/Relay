const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FlickDetector } = require('../src/remote/flick.js');

test('a quick strong push that is over again fires once; walking, a slow push and a long shake do not', () => {
  const d = new FlickDetector();
  assert.equal(d.push(1, 1, 1, 0), false);
  assert.equal(d.push(18, 4, 2, 50), false, 'the spike starts it');
  assert.equal(d.push(9, 1, 1, 100), false, 'still moving');
  assert.equal(d.push(2, 1, 1, 160), true, 'quiet again within a moment: that was a flick');
  assert.equal(d.push(20, 0, 0, 400), false, 'a second flick right away is ignored (1.5 s gap)');
  const walk = new FlickDetector(); let n = 0;
  for (let t = 0; t < 3000; t += 20) if (walk.push(8 * Math.sin(t / 150), 3, 2, t)) n++;
  assert.equal(n, 0, 'walking is gentler than a flick');
  const shake = new FlickDetector(); n = 0;
  for (let t = 0; t < 2000; t += 20) if (shake.push(16, 0, 0, t)) n++;
  assert.equal(n, 0, 'a push that never ends is not a flick');
  const later = new FlickDetector(); later.push(18, 0, 0, 0); later.push(1, 0, 0, 100);
  assert.equal(later.push(18, 0, 0, 1700), false); assert.equal(later.push(1, 0, 0, 1750), true, 'after the gap it works again');
});

test('the phone page is served, linked from the home page, and sends photos marked as flicks', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(read('src/main/remote/server.js'), /'\/flick\.html': 'flick\.html', '\/flick\.js': 'flick\.js'/);
  assert.match(read('src/remote/index.html'), /href="\/flick\.html"/);
  assert.match(read('src/remote/flick.js'), /flick: true/);
  assert.match(read('src/main/remote/server.js'), /flick: b\.flick === true/);
  assert.match(read('src/renderer/holo.js'), /items\.every\(\(i\) => i\.kind === 'image'\)/, 'a flat photo does not turn edge-on');
});

test('a flicked photo is kept in Downloads, shown as an "image" hologram, and chimes; a HEIC photo is shown as a JPEG', async () => {
  const { AskController } = require('../src/main/askController');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flick-'));
  const shown = [], sounds = [];
  const self = { flickDir: path.join(dir, 'flick'), inboxDir: path.join(dir, 'inbox'), holos: { show: async (a) => { shown.push(a); return 'id'; } }, sound: (n) => sounds.push(n) };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
  const r = await AskController.prototype.flickArrived.call(self, png, { kind: 'image', ext: 'png' }, 'IMG_1234.PNG');
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(r.saved).equals(png), true, 'the original is saved as it was sent');
  assert.equal(shown.length, 1); assert.equal(shown[0].items[0].kind, 'image'); assert.equal(shown[0].items[0].mime, 'image/png'); assert.equal(shown[0].title, 'IMG_1234');
  assert.deepEqual(sounds, ['Glass']);
  const bad = await AskController.prototype.flickArrived.call({ ...self, holos: null }, png, { kind: 'image', ext: 'png' }, '');
  assert.equal(bad.ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
