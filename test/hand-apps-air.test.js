const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { appKind, swipeAction, scriptFor, parseSignCommand } = require('../src/main/hands/apps');
const { HandControl } = require('../src/main/hands/control');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('what a swipe does depends on the app in front, and only apps that are known get a key press or a command', () => {
  assert.equal(appKind('org.mozilla.firefox'), 'browser'); assert.equal(appKind('com.spotify.client'), 'music'); assert.equal(appKind('com.apple.finder'), null);
  assert.deepEqual(swipeAction('org.mozilla.firefox', 'right'), { kind: 'tab', next: true });
  assert.deepEqual(swipeAction('com.apple.Music', 'left'), { kind: 'track', app: 'Music', next: false });
  assert.deepEqual(swipeAction('com.apple.iWork.Keynote', 'right'), { kind: 'slide', next: true });
  assert.equal(swipeAction('com.apple.finder', 'right'), null); assert.equal(scriptFor(null), null);
  assert.match(scriptFor({ kind: 'tab', next: true })[0], /key code 48 using control down/);
  assert.match(scriptFor({ kind: 'tab', next: false })[0], /\{control down, shift down\}/);
  assert.match(scriptFor({ kind: 'track', app: 'Spotify', next: true })[0], /if application "Spotify" is running then .* next track/);
  assert.equal(scriptFor({ kind: 'track', app: 'Evil"; do shell script "x', next: true }), null, 'only the two music apps');
});

test('giving a sign a job of your own', () => {
  const p = parseSignCommand;
  assert.deepEqual(p('when I show the rock sign, play my focus playlist'), { type: 'sign-set', sign: 'rock', command: 'play my focus playlist' });
  assert.deepEqual(p('Jarvis, whenever I make the wave sign open my email'), { type: 'sign-set', sign: 'wave', command: 'open my email' });
  assert.deepEqual(p('make the palm sign start the focus routine'), { type: 'sign-set', sign: 'stop', command: 'start the focus routine' });
  assert.deepEqual(p('what do my hand signs do'), { type: 'sign-list' }); assert.deepEqual(p('reset my hand signs'), { type: 'sign-reset' });
  assert.equal(p('when I show up tell me'), null);
});

function rig(over = {}) {
  const calls = [], vols = []; let clock = 1000;
  const external = { start() {}, close() {}, begin: () => false, move: () => false, end() {}, click: () => true, tab: async () => true, frontIsBrowser: async () => false, scroll: (pt, dy) => { calls.push(['scroll', Math.round(pt.y), dy]); return true; } };
  const holos = { holoNear: () => null, latest: () => null, holos: new Map() };
  const swipes = [];
  const hc = new HandControl({ holos, display: () => ({ x: 0, y: 0, width: 1801, height: 1101 }), askAccess: async () => true, createCamera: async () => ({ close() {}, setPreview() {}, action() {} }), createCursor: () => ({ moveTo() {}, setState() {}, hide() {}, close() {} }), externalDrag: external, now: () => (clock += 100), onVolume: async (op, n) => { if (op === 'get') return 50; vols.push(n); return true; }, appSwipe: async (dir) => { swipes.push(dir); return true; }, ...over });
  return { hc, calls, vols, swipes };
}
const at = (x, y) => ({ x: x / 1800, y: y / 1100 });
const flush = () => new Promise((r) => setImmediate(r));

test('a pinch held on empty screen and dragged up or down scrolls like a touch screen; the first clear direction decides', async () => {
  const { hc, calls, vols } = rig(); await hc.enable();
  await hc.handle({ type: 'pinchdown', ...at(900, 500) });
  await hc.handle({ type: 'move', held: true, ...at(900, 510) }); assert.deepEqual(calls, [], 'a small wobble is not a scroll');
  await hc.handle({ type: 'move', held: true, ...at(905, 560) });
  await hc.handle({ type: 'move', held: true, ...at(905, 600) });
  assert.deepEqual(calls.map((c) => c[0]), ['scroll', 'scroll']); assert.ok(calls.every((c) => c[2] > 0), 'dragging down moves the content down');
  await hc.handle({ type: 'move', held: true, ...at(1200, 600) }); assert.deepEqual(vols, [], 'the axis stays scroll');
  await hc.handle({ type: 'pinchup', ...at(905, 600) });
  const n = calls.length; await hc.handle({ type: 'move', held: false, ...at(905, 800) }); assert.equal(calls.length, n, 'after the pinch ends nothing scrolls');
});

test('with the wrist twist on, a pinch that drifts sideways never changes the volume (it only scrolls)', async () => {
  const { hc, vols, calls } = rig(); await hc.enable();
  await hc.handle({ type: 'pinchdown', ...at(600, 500) }); await flush();
  await hc.handle({ type: 'move', held: true, ...at(800, 510) });
  await hc.handle({ type: 'move', held: true, ...at(1200, 560) });
  assert.deepEqual(vols, []);
  assert.ok(calls.length >= 1, 'it scrolls instead');
});

test('dragged sideways it sets the volume from where it was, within 0 to 100 (when the wrist twist is off)', async () => {
  const { hc, vols } = rig(); hc.volumeTwist = () => false; await hc.enable();
  await hc.handle({ type: 'pinchdown', ...at(600, 500) }); await flush();
  await hc.handle({ type: 'move', held: true, ...at(700, 505) });
  await hc.handle({ type: 'move', held: true, ...at(1200, 505) });
  assert.ok(vols.length >= 1 && vols.at(-1) > 50 && vols.at(-1) <= 100, `louder: ${vols}`);
  const quiet = rig(); quiet.hc.volumeTwist = () => false; await quiet.hc.enable();
  await quiet.hc.handle({ type: 'pinchdown', ...at(1500, 500) }); await flush();
  await quiet.hc.handle({ type: 'move', held: true, ...at(1400, 500) }); await quiet.hc.handle({ type: 'move', held: true, ...at(200, 500) });
  assert.equal(quiet.vols.at(-1), 0, 'never below 0');
});

test('it can be switched off, and a hologram under the hand keeps the pinch', async () => {
  const off = rig({ airScroll: () => false }); await off.hc.enable();
  await off.hc.handle({ type: 'pinchdown', ...at(900, 500) }); await off.hc.handle({ type: 'move', held: true, ...at(900, 700) });
  assert.deepEqual(off.calls, []);
  const sent = []; const holo = { id: 1, win: { isDestroyed: () => false, webContents: { sendInputEvent: (e) => sent.push(e), send() {} } }, x: 900, y: 500 };
  const on = rig(); on.hc.holos.holoNear = () => holo; await on.hc.enable();
  await on.hc.handle({ type: 'pinchdown', ...at(900, 500) }); await on.hc.handle({ type: 'move', held: true, ...at(900, 700) });
  assert.deepEqual(on.calls, [], 'no scrolling behind a hologram'); assert.ok(sent.length > 0);
});

test('a swipe with nothing of Relay\'s under the hand goes to the app in front', async () => {
  const { hc, swipes } = rig(); await hc.enable();
  await hc.handle({ type: 'swipe', dir: 'right', ...at(900, 500) }); await flush();
  assert.deepEqual(swipes, ['right']);
  const off = rig({}); off.hc.extraGestures = () => false; await off.hc.enable();
  await off.hc.handle({ type: 'swipe', dir: 'left', ...at(900, 500) }); await flush(); assert.deepEqual(off.swipes, []);
});

test('main.js wires the scroll, volume, app swipes and custom signs, and the helper can scroll', () => {
  const main = read('src/main/main.js');
  assert.match(main, /appSwipe: async \(dir\)/); assert.match(main, /set volume output volume/); assert.match(main, /settings\.hands\.signCommands/);
  assert.match(read('native/relay-ax.swift'), /case "scroll":/); assert.match(read('src/main/store.js'), /airScroll: true/);
  assert.match(read('src/main/askController.js'), /parseSignCommand\(effective\)/);
});

test('a fast pinch-drag that is let go keeps scrolling and slows to a stop; a slow one, or a new pinch, does not / stops it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 5000;
  const flick = async (stepY, gapMs) => {
    const r = rig(); await r.hc.enable(); r.hc.now = () => clock;
    await r.hc.handle({ type: 'pinchdown', ...at(900, 300) });
    let y = 300;
    for (let i = 0; i < 6; i++) { y += stepY; clock += gapMs; await r.hc.handle({ type: 'move', held: true, ...at(900, y) }); }
    return { r, y };
  };
  const { r, y } = await flick(40, 33);
  const during = r.calls.length;
  await r.hc.handle({ type: 'pinchup', ...at(900, y) });
  for (let i = 0; i < 30; i++) { clock += 16; t.mock.timers.tick(16); }
  assert.ok(r.calls.length > during, 'it carried on after the pinch was let go');
  const sent = r.calls.slice(during).map((c) => c[2]);
  assert.ok(sent.every((d) => d > 0), 'in the same direction');
  assert.ok(sent[sent.length - 1] <= sent[0], 'slowing down');
  for (let i = 0; i < 200; i++) { clock += 16; t.mock.timers.tick(16); }
  const settled = r.calls.length; for (let i = 0; i < 20; i++) { clock += 16; t.mock.timers.tick(16); }
  assert.equal(r.calls.length, settled, 'it comes to a stop by itself');

  const slow = await flick(8, 60); const n = slow.r.calls.length;
  await slow.r.hc.handle({ type: 'pinchup', ...at(900, slow.y) });
  for (let i = 0; i < 40; i++) { clock += 16; t.mock.timers.tick(16); }
  assert.equal(slow.r.calls.length, n, 'a slow drag does not glide');

  const again = await flick(40, 33); const m = again.r.calls.length;
  await again.r.hc.handle({ type: 'pinchup', ...at(900, again.y) });
  await again.r.hc.handle({ type: 'pinchdown', ...at(900, 500) });
  for (let i = 0; i < 20; i++) { clock += 16; t.mock.timers.tick(16); }
  assert.equal(again.r.calls.length, m, 'touching it again stops the glide');
});

test('hand control starts its camera again after the Mac wakes or unlocks (the lid kills the camera stream)', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src/main/main.js'), 'utf8');
  assert.match(main, /const reviveHands = async/);
  assert.match(main, /powerMonitor\.on\('resume', \(\) => setTimeout\(\(\) => reviveHands\('after wake'\)/);
  assert.match(main, /reviveHands\('after unlock'\)/);
  assert.match(main, /hands\.disable\(\);\s*await new Promise\(\(r\) => setTimeout\(r, 1500\)\);\s*const r = await hands\.enable\(\)/);
});

test('the welcome-back screen can never stay up: the greeting screen has a hard 90 second limit and the speech a limit of its own', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src/main/main.js'), 'utf8');
  assert.match(main, /const limit=\(p,ms\)=>/);
  assert.match(main, /overlay\.hud\(\{hide:true\}\);\},90000\)/);
  assert.match(main, /limit\(ask\.speakText\(greeting,\{quick:true\}\),45000\)/);
  assert.match(main, /await limit\(ask\.speakText\(details\),60000\)/);
});

test('a reactor left on screen is cleaned up: a four minute guard, a periodic hide for pages that missed it, and a hide when the Mac wakes', () => {
  const read = (f) => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', f), 'utf8');
  const overlay = read('src/main/overlay.js'), main = read('src/main/main.js');
  assert.match(overlay, /hudGuardFire\(\) \{/); assert.match(overlay, /setTimeout\(\(\) => this\.hudGuardFire\(\), 240000\)/); assert.match(overlay, /resyncHud\(\) \{/); assert.match(overlay, /setInterval\(\(\) => this\.resyncHud\(\), 20000\)/);
  assert.match(main, /overlay\.onStuck = /); assert.match(main, /overlay\?\.hud\(\{ hide: true \}\)/); assert.match(main, /diag\.log\('welcome','greeting screen shown'\)/);
});
