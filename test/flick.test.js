const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FlickDetector, FlickAimer, swipeDirection } = require('../src/remote/flick.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('a quick strong push that is over again fires once; walking, a slow push and a long shake do not', () => {
  const d = new FlickDetector();
  assert.equal(d.push(1, 1, 1, 0), false);
  assert.equal(d.push(18, 4, 2, 50), false, 'the spike starts it');
  assert.equal(d.push(9, 1, 1, 100), false, 'still moving');
  assert.equal(d.push(2, 1, 1, 160), true, 'quiet again within a moment: that was a flick');
  assert.deepEqual(d.window, { from: -70, to: 160 }, 'it says when the flick happened, from just before the push');
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

// a made-up flick: rows of [time, ax, ay, az, rotAlpha, rotBeta, rotGamma]; side is the direction of the push and of the turn (the phone's sign conventions are whatever flip says)
function flickRows(side, { flip = 1, jitter = 0.15, t0 = 0, rotation = true } = {}) {
  const s = (side === 'right' ? 1 : -1) * flip, rows = []; let t = t0;
  const j = (k) => 1 + Math.sin(t0 * 0.013 + k * 1.7) * jitter;
  for (let i = 0; i < 6; i++) rows.push([t += 16, 0, 0, 0, 0, 0, 0]);
  for (let i = 0; i < 5; i++) rows.push([t += 16, s * 18 * j(i), 3 * j(i + 2), 1, rotation ? 30 * s * j(i + 3) : 0, rotation ? 20 * j(i) : 0, rotation ? 220 * s * j(i + 1) : 0]);
  for (let i = 0; i < 3; i++) rows.push([t += 16, -s * 9, 0, 0, 0, 0, rotation ? -60 * s : 0]);
  for (let i = 0; i < 8; i++) rows.push([t += 16, 0, 0, 0, 0, 0, 0]);
  return rows;
}
function feed(aimer, rows) { // as the page does: every sample goes to the aimer and the detector; a flick gives its numbers
  const det = new FlickDetector({ gapMs: 0 }); let f = null;
  for (const [t, ax, ay, az, ra, rb, rg] of rows) { aimer.add(t, [ax, ay, az], [ra, rb, rg]); if (det.push(ax, ay, az, t)) f = aimer.features(det.window.from, det.window.to); }
  return f;
}
const teachSix = (aimer, opts = {}) => { for (const [i, side] of ['left', 'right', 'left', 'right', 'left', 'right'].entries()) aimer.learn(side, feed(aimer, flickRows(side, { ...opts, t0: 1000 * (i + 1) }))); };

test('after teaching three flicks each way, a flick to the left and to the right are told apart, and a vague one is not guessed', () => {
  const aimer = new FlickAimer();
  assert.equal(aimer.ready(), false); assert.equal(aimer.classify([5, 0, 0, 0, 0, 100]).side, 'center', 'untaught: the middle, never a guess');
  teachSix(aimer);
  assert.equal(aimer.ready(), true);
  assert.equal(aimer.classify(feed(aimer, flickRows('left', { t0: 9100, jitter: 0.3 }))).side, 'left');
  assert.equal(aimer.classify(feed(aimer, flickRows('right', { t0: 9300, jitter: 0.3 }))).side, 'right');
  assert.equal(aimer.classify([0, 0, 0, 0, 0, 0]).side, 'center', 'halfway between the two is the middle');
  assert.ok(aimer.classify(feed(aimer, flickRows('right', { t0: 9500 }))).score > 0.3);
});

test('it works whichever way the phone counts its signs (iPhone and Android differ), because it learns from your flicks', () => {
  const a = new FlickAimer(); teachSix(a, { flip: -1 });
  assert.equal(a.classify(feed(a, flickRows('left', { flip: -1, t0: 9100 }))).side, 'left');
  assert.equal(a.classify(feed(a, flickRows('right', { flip: -1, t0: 9300 }))).side, 'right');
  const b = new FlickAimer(); teachSix(b);
  assert.equal(b.classify(feed(b, flickRows('left', { flip: -1, t0: 9100 }))).side, 'right', 'taught one way, the opposite signs read the opposite way, which is why it must be taught on the same phone');
});

test('without a gyroscope the push alone still teaches the sides; teaching is refused when the flicks look alike; the lesson survives a reload', () => {
  const a = new FlickAimer(); teachSix(a, { rotation: false });
  assert.equal(a.classify(feed(a, flickRows('left', { rotation: false, t0: 9100 }))).side, 'left');
  const same = new FlickAimer(); for (const side of ['left', 'right', 'left', 'right']) same.learn(side, [1, 1, 1, 1, 1, 1]);
  assert.equal(same.ready(), false, 'flicks that look the same cannot tell the sides apart');
  const again = new FlickAimer(JSON.parse(JSON.stringify(a.samples)));
  assert.equal(again.ready(), true); assert.equal(again.classify(feed(again, flickRows('right', { rotation: false, t0: 9300 }))).side, 'right');
  assert.equal(new FlickAimer([{ dir: 'up', f: [1] }, null, { dir: 'left', f: [1, 2, 3, 4, 5, NaN] }, 'x']).samples.length, 0, 'bad saved data is dropped');
  a.reset(); assert.equal(a.ready(), false);
});

test('a swipe on the photos aims left or right; up or down just sends them to the middle', () => {
  assert.equal(swipeDirection(120, 20), 'right'); assert.equal(swipeDirection(-120, 20), 'left');
  assert.equal(swipeDirection(10, -140), 'center'); assert.equal(swipeDirection(10, 140), 'center'); assert.equal(swipeDirection(0, 0), 'center');
});

test('the Flick button is at the bottom of the home page, low on the screen, and the phone pages are served', () => {
  const server = read('src/main/remote/server.js');
  assert.match(server, /'\/flick\.html': 'flick\.html', '\/flick\.js': 'flick\.js', '\/flickstore\.js': 'flickstore\.js', '\/flickhome\.js': 'flickhome\.js'/);
  const home = read('src/remote/index.html');
  assert.match(home, /id="flickfab"/); assert.match(home, /id="flickpick"/);
  assert.match(home, /src="\/flickstore\.js"/); assert.match(home, /src="\/flickhome\.js"/);
  assert.doesNotMatch(home, /id="flickbtn"/, 'it is no longer a link in the header');
  assert.match(home, /id="holofab" href="\/holo\.html"/); assert.doesNotMatch(home, /id="holobtn"/, 'the holograms button moved down with the rest');
  const css = read('src/remote/style.css');
  for (const id of ['qtog', 'kbd', 'flickfab', 'holofab']) assert.match(css, new RegExp(`#${id} \\{ position: fixed;[^}]*bottom: calc\\(env\\(safe-area-inset-bottom\\) \\* \\.4 \\+ 6px\\)`), `${id} sits low`);
  assert.match(css, /#home \{ position: relative; padding-bottom: calc\(env\(safe-area-inset-bottom\) \* \.4/, 'so does the lock');
  assert.match(read('src/remote/flick.html'), /src="\/flickstore\.js"/);
  assert.match(read('src/remote/flick.html'), /id="teach"/);
});

test('turning flick on is remembered, and then the button asks for photos straight away; photos picked there reach the Flick page', () => {
  const page = read('src/remote/flick.js');
  assert.match(page, /localStorage\.setItem\(MOTION_KEY, '1'\)/);
  assert.match(page, /FlickStore\.take\(\)/);
  const homeJs = read('src/remote/flickhome.js');
  assert.match(homeJs, /relay-flick-motion/); assert.match(homeJs, /pick\.click\(\)/); assert.match(homeJs, /FlickStore\.put/);
  assert.match(page, /relay-flick-motion/); assert.match(page, /relay-flick-aim/);
  assert.match(page, /flick: true, dir, how/);
  assert.match(read('src/main/remote/server.js'), /flick: b\.flick === true, dir: \['left', 'right', 'up', 'down', 'center'\]\.includes\(b\.dir\) \? b\.dir : '', how: \['flick', 'swipe', 'button'\]/);
});

test('a flicked photo goes straight into Downloads under its phone name, and a card is shown on the side it was flicked towards', async () => {
  const { AskController } = require('../src/main/askController');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flick-'));
  const shown = [], sounds = [], logged = [];
  const self = { flickDir: path.join(dir, 'Downloads'), flickCards: { show: async (a) => { shown.push(a); return 'id'; } }, sound: (n) => sounds.push(n), diag: { log: (k, m) => logged.push([k, m]) } };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
  const r = await AskController.prototype.flickArrived.call(self, png, { kind: 'image', ext: 'png' }, 'IMG_1234.PNG', 'left', 'flick');
  assert.equal(r.ok, true);
  assert.equal(path.basename(r.saved), 'IMG_1234.png'); assert.equal(path.dirname(r.saved), path.join(dir, 'Downloads'));
  assert.equal(fs.readFileSync(r.saved).equals(png), true, 'the original is saved as it was sent');
  assert.deepEqual(shown, [{ file: r.saved, dir: 'left' }]);
  assert.deepEqual(sounds, ['Glass']);
  assert.deepEqual(logged, [['flick-arrived', 'png, 48 bytes, side left, sent by flick']], 'what arrived is logged, so a wrong side can be traced');
  const again = await AskController.prototype.flickArrived.call(self, png, { kind: 'image', ext: 'png' }, 'IMG_1234.PNG', 'right', 'swipe');
  assert.equal(path.basename(again.saved), 'IMG_1234 2.png', 'a second photo with the same name does not overwrite the first');
  const plain = await AskController.prototype.flickArrived.call(self, png, { kind: 'image', ext: 'png' }, 'image.png', '');
  assert.match(path.basename(plain.saved), /^From phone \d{4}-\d\d-\d\d-\d\d-\d\d-\d\d\.png$/, 'a generic phone name gets a dated one');
  const nocard = await AskController.prototype.flickArrived.call({ ...self, flickCards: null }, png, { kind: 'image', ext: 'png' }, 'x.png', 'right');
  assert.equal(nocard.ok, false); assert.equal(fs.existsSync(nocard.saved), true, 'it is still kept in Downloads');
  fs.rmSync(dir, { recursive: true, force: true });
});
