const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FlickDetector, directionOf, swipeDirection } = require('../src/remote/flick.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

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

test('a flick says which side of the Mac screen it is aimed at: left, right, up, down, or the middle', () => {
  const flick = (x, y, z) => { const d = new FlickDetector(); d.push(x, y, z, 0); d.push(x / 2, y / 2, z / 2, 60); assert.equal(d.push(1, 1, 0, 120), true); return d.direction; };
  assert.equal(flick(18, 3, 1), 'right');
  assert.equal(flick(-18, 3, 1), 'left');
  assert.equal(flick(2, 18, 1), 'up');
  assert.equal(flick(2, -18, 1), 'down');
  assert.equal(flick(2, 3, -18), 'center', 'straight at or away from the Mac has no side');
  assert.equal(flick(14, 2, -18), 'right', 'a flick towards the Mac with a clear sideways push still has a side');
  assert.equal(flick(1, -12, -18), 'down');
  const d = new FlickDetector(); d.push(18, 0, 0, 0); d.push(-10, 0, 0, 60); d.push(1, 0, 0, 120);
  assert.equal(d.direction, 'right', 'the stop after the push goes the other way and does not count');
  assert.equal(directionOf(0.2, 0.1, 0.1), 'center');
  assert.equal(swipeDirection(120, 20), 'right'); assert.equal(swipeDirection(-120, 20), 'left');
  assert.equal(swipeDirection(10, -140), 'up'); assert.equal(swipeDirection(10, 140), 'down'); assert.equal(swipeDirection(0, 0), 'center');
});

test('the Flick button is at the bottom of the home page, low on the screen, and the phone pages are served', () => {
  const server = read('src/main/remote/server.js');
  assert.match(server, /'\/flick\.html': 'flick\.html', '\/flick\.js': 'flick\.js', '\/flickstore\.js': 'flickstore\.js', '\/flickhome\.js': 'flickhome\.js'/);
  const home = read('src/remote/index.html');
  assert.match(home, /id="flickfab"/); assert.match(home, /id="flickpick"/);
  assert.match(home, /src="\/flickstore\.js"/); assert.match(home, /src="\/flickhome\.js"/);
  assert.doesNotMatch(home, /id="flickbtn"/, 'it is no longer a link in the header');
  const css = read('src/remote/style.css');
  for (const id of ['qtog', 'kbd', 'flickfab']) assert.match(css, new RegExp(`#${id} \\{ position: fixed;[^}]*bottom: calc\\(env\\(safe-area-inset-bottom\\) \\* \\.4 \\+ 6px\\)`), `${id} sits low`);
  assert.match(css, /#home \{ position: relative; padding-bottom: calc\(env\(safe-area-inset-bottom\) \* \.4/, 'so does the lock');
  assert.match(read('src/remote/flick.html'), /src="\/flickstore\.js"/);
});

test('turning flick on is remembered, and then the button asks for photos straight away; photos picked there reach the Flick page', () => {
  const page = read('src/remote/flick.js');
  assert.match(page, /localStorage\.setItem\(MOTION_KEY, '1'\)/);
  assert.match(page, /FlickStore\.take\(\)/);
  const homeJs = read('src/remote/flickhome.js');
  assert.match(homeJs, /relay-flick-motion/); assert.match(homeJs, /pick\.click\(\)/); assert.match(homeJs, /FlickStore\.put/);
  assert.match(page, /relay-flick-motion/);
  assert.match(page, /flick: true, dir/);
  assert.match(read('src/main/remote/server.js'), /flick: b\.flick === true, dir: \['left', 'right', 'up', 'down', 'center'\]\.includes\(b\.dir\)/);
});

test('a flicked photo goes straight into Downloads under its phone name, and a card is shown on the side it was flicked towards', async () => {
  const { AskController } = require('../src/main/askController');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flick-'));
  const shown = [], sounds = [];
  const self = { flickDir: path.join(dir, 'Downloads'), flickCards: { show: async (a) => { shown.push(a); return 'id'; } }, sound: (n) => sounds.push(n) };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
  const r = await AskController.prototype.flickArrived.call(self, png, { kind: 'image', ext: 'png' }, 'IMG_1234.PNG', 'left');
  assert.equal(r.ok, true);
  assert.equal(path.basename(r.saved), 'IMG_1234.png'); assert.equal(path.dirname(r.saved), path.join(dir, 'Downloads'));
  assert.equal(fs.readFileSync(r.saved).equals(png), true, 'the original is saved as it was sent');
  assert.deepEqual(shown, [{ file: r.saved, dir: 'left' }]);
  assert.deepEqual(sounds, ['Glass']);
  const again = await AskController.prototype.flickArrived.call(self, png, { kind: 'image', ext: 'png' }, 'IMG_1234.PNG', 'up');
  assert.equal(path.basename(again.saved), 'IMG_1234 2.png', 'a second photo with the same name does not overwrite the first');
  const plain = await AskController.prototype.flickArrived.call(self, png, { kind: 'image', ext: 'png' }, 'image.png', '');
  assert.match(path.basename(plain.saved), /^From phone \d{4}-\d\d-\d\d-\d\d-\d\d-\d\d\.png$/, 'a generic phone name gets a dated one');
  const nocard = await AskController.prototype.flickArrived.call({ ...self, flickCards: null }, png, { kind: 'image', ext: 'png' }, 'x.png', 'right');
  assert.equal(nocard.ok, false); assert.equal(fs.existsSync(nocard.saved), true, 'it is still kept in Downloads');
  fs.rmSync(dir, { recursive: true, force: true });
});
