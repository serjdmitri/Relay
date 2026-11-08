const test = require('node:test'), assert = require('node:assert/strict');
const { parseCameraCommand: p, nextBounds } = require('../src/main/cameraCommands');

test('the camera view is controlled by voice, and only when the camera or view is named', () => {
  assert.deepEqual(p('make the camera bigger'), { type: 'camera-adjust', action: 'bigger' });
  assert.deepEqual(p('Jarvis, make the camera view a little smaller.'), { type: 'camera-adjust', action: 'smaller' });
  assert.deepEqual(p('move the camera left'), { type: 'camera-adjust', action: 'move', direction: 'left' });
  assert.deepEqual(p('move the view higher'), { type: 'camera-adjust', action: 'move', direction: 'up' });
  assert.deepEqual(p('make the camera full screen'), { type: 'camera-adjust', action: 'fullscreen' });
  assert.deepEqual(p('camera normal size'), { type: 'camera-adjust', action: 'reset' });
  assert.deepEqual(p('fade the edges more'), { type: 'camera-adjust', action: 'fade', amount: 1 });
  assert.deepEqual(p('fade the edges less'), { type: 'camera-adjust', action: 'fade', amount: -1 });
  assert.deepEqual(p('hide the boxes'), { type: 'camera-adjust', action: 'boxes', on: false });
  assert.deepEqual(p('show the boxes'), { type: 'camera-adjust', action: 'boxes', on: true });
  assert.deepEqual(p('show everything'), { type: 'camera-adjust', action: 'filter', names: [] });
  assert.deepEqual(p('only show people on camera'), { type: 'camera-adjust', action: 'filter', names: ['people'.replace(/s$/, '')] });
  assert.deepEqual(p('highlight the cups and phones in the camera'), { type: 'camera-adjust', action: 'filter', names: ['cup', 'phone'] });
  for (const t of ['make it bigger', 'move left', 'what is the weather', 'show my camera', 'hide the camera', 'open notes', 'make the window bigger']) assert.equal(p(t), null, t);
});

test('the window grows, shrinks and moves while staying on screen, in a 4:3 shape', () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 }, b = { x: 700, y: 100, width: 640, height: 480 };
  const big = nextBounds(b, area, { action: 'bigger' }); assert.equal(big.width, 832); assert.equal(big.height, 624);
  assert.ok(big.x >= 0 && big.x + big.width <= 1440 && big.y >= 25 && big.y + big.height <= 900);
  const small = nextBounds(b, area, { action: 'smaller' }); assert.ok(small.width < 640 && small.width >= 240); assert.equal(small.height, Math.round(small.width * 0.75));
  const tiny = nextBounds({ x: 0, y: 25, width: 260, height: 195 }, area, { action: 'smaller' }); assert.equal(tiny.width, 240, 'never smaller than 240 wide');
  const right = nextBounds(b, area, { action: 'move', direction: 'right' }); assert.equal(right.x + right.width, 1440, 'stops at the screen edge');
  const left = nextBounds(b, area, { action: 'move', direction: 'left' }); assert.ok(left.x < b.x);
  const screenB = { x: 0, y: 0, width: 1440, height: 900 };
  assert.deepEqual(nextBounds(b, screenB, { action: 'fullscreen' }), screenB, 'full screen is the whole screen, not a 4:3 box');
  const reset = nextBounds(b, area, { action: 'reset' }); assert.equal(reset.width, 640); assert.equal(reset.x, 400);
});

test('the camera view opens full screen and keeps Jarvis in the corner', () => {
  const fs = require('fs'), read = (f) => fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
  const win = read('src/main/cameraWindow.js'), over = read('src/main/overlay.js'), hud = read('src/renderer/hud.js'), main = read('src/main/main.js'), html = read('src/renderer/overlay.html');
  assert.match(win, /open\(\{ full = true \} = \{\}\)/, 'opens full screen by default');
  assert.match(win, /setAlwaysOnTop\(true, 'floating'\)/, 'below the reactor, so Jarvis shows on top of the picture');
  assert.match(win, /passThrough\(on\) \{[\s\S]*setIgnoreMouseEvents\(!!on\)/, 'full screen lets every click through: it must never leave the mouse dead');
  assert.match(win, /this\.passThrough\(true\)/); assert.match(win, /this\.passThrough\(this\.full\)/); assert.match(win, /globalShortcut\.register\('Escape'/);
  assert.match(win, /onView\(true\)/); assert.match(win, /onView\(false\)/);
  assert.match(over, /setCameraView\(on\)/); assert.match(over, /cameraView:!!this\.cameraView/);
  assert.match(hud, /if \(cam && !hard\) m = 'corner'/, 'every state stays in the corner while the camera is up');
  assert.doesNotMatch(hud, /setMode\('center', true\)/, 'typing and confirm stay in the corner too');
  assert.match(html, /#hud\.camera-view\.corner #hudin \{ display: block !important/, 'the typing box shows in the corner');
  assert.match(read('src/renderer/camera.js'), /const view = \{ boxes: false,/, 'boxes are off until asked');
  assert.match(read('src/renderer/camera.css'), /#000 100%\)/, 'the full-screen backdrop goes to black at the edges');
  assert.deepEqual(p('box the things you see'), { type: 'camera-adjust', action: 'boxes', on: true });
  assert.match(html, /#hud\.camera-view\.corner #hudline \{ display: -webkit-box; \}/, 'the answer shows beside the corner reactor');
  assert.match(main, /onView: \(on\) =>/);
});
