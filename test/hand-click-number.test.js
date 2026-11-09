const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { CountWatch } = require('../src/main/hands/count');
const { ExternalDrag } = require('../src/main/hands/externalDrag');
const { HandControl } = require('../src/main/hands/control');

const hand = (gesture, count, over = {}) => ({ x: 0.5, y: 0.5, size: 0.2, pinch: 0.8, gesture, count, score: 1, handed: 'Right', ...over });

// ---- the number watcher ----
function watch() { const got = []; return { got, w: new CountWatch({ onNumber: (n) => got.push(n), holdMs: 1000 }) }; }
const feed = (w, from, to, hands, step = 50) => { for (let t = from; t <= to; t += step) w.update({ t, hands: typeof hands === 'function' ? hands(t) : hands }); };

test('a number held steady for a second fires once, and again only after the hand is put down', () => {
  const { w, got } = watch();
  feed(w, 1000, 1900, [hand('Open_Palm', 3)]);
  assert.deepEqual(got, [], 'not yet');
  feed(w, 1950, 3000, [hand('Open_Palm', 3)]);
  assert.deepEqual(got, [3], 'once, however long it is held');
  feed(w, 3050, 3700, []);
  feed(w, 3750, 5000, [hand('Open_Palm', 3)]);
  assert.deepEqual(got, [3, 3], 'again after being put down');
});

test('changing the number fires the new one; a hand flickering between 4 and 5 fires nothing', () => {
  const { w, got } = watch();
  feed(w, 1000, 2200, [hand('Open_Palm', 4)]); feed(w, 2250, 3500, [hand('Victory', 2)]);
  assert.deepEqual(got, [4, 2]);
  const flick = watch();
  feed(flick.w, 1000, 4000, (t) => [hand('Open_Palm', Math.floor(t / 50) % 2 ? 5 : 4)]);
  assert.deepEqual(flick.got, []);
});

test('two hands add up, nine means the last tab, and fists, thumbs, pinches, a middle finger or a crowd are never numbers', () => {
  const { w, got } = watch();
  feed(w, 1000, 2200, [hand('Open_Palm', 5), hand('Open_Palm', 3)]); // 8
  feed(w, 2250, 3300, []); feed(w, 3350, 4600, [hand('Open_Palm', 5), hand('Open_Palm', 5)]); // 10 -> 9
  assert.deepEqual(got, [8, 9]);
  for (const bad of [[hand('Closed_Fist', 0)], [hand('Thumb_Up', 1)], [hand('Middle_Finger', 1)], [hand('Open_Palm', 5, { pinch: 0.1 })], [hand('Open_Palm', 5), hand('Closed_Fist', 0)], [hand('Open_Palm', 2), hand('Open_Palm', 2), hand('Open_Palm', 2)], [hand('Open_Palm', 5, { score: 0 })]]) {
    const x = watch(); feed(x.w, 1000, 3000, bad); assert.deepEqual(x.got, [], JSON.stringify(bad[0]));
  }
});

// ---- the native helper's questions ----
function dragRig(opts = {}) {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let input = ''; child.stdin.on('data', (b) => { input += b; });
  const drag = new ExternalDrag({ bin: '/fake', allowed: () => true, spawnFn: () => child, ...opts });
  return { child, drag, lines: () => input.trim().split('\n').filter(Boolean).map(JSON.parse) };
}

test('clicks, tab numbers and the "is a browser in front" question go to the helper, which can run with dragging off', async () => {
  const x = dragRig({ enabled: () => false, wanted: () => true });
  assert.equal(x.drag.click({ x: 5, y: 6 }), false, 'not running yet: it starts for next time');
  x.child.stdout.write('ready\n');
  assert.equal(x.drag.click({ x: 5, y: 6 }), true);
  assert.equal(await x.drag.tab(3), true); assert.equal(await x.drag.tab(0), false); assert.equal(await x.drag.tab(10), false);
  assert.equal(x.drag.begin({}, { x: 1, y: 1 }), false, 'dragging itself is still off');
  const q = x.drag.frontIsBrowser(); x.child.stdout.write('front:browser\n');
  assert.equal(await q, true);
  const r = x.drag.frontIsBrowser(); x.child.stdout.write('front:other\n');
  assert.equal(await r, false);
  assert.equal(await x.drag.frontIsBrowser(30), false, 'no answer in time: not a browser');
  assert.deepEqual(x.lines().map((l) => l.op), ['click', 'tab', 'front', 'front', 'front']);
  assert.deepEqual(x.lines()[1], { op: 'tab', n: 3 });
  x.drag.close();
});

test('the helper stays off when neither dragging, clicking nor tab numbers is wanted', () => {
  let spawned = 0; const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const d = new ExternalDrag({ bin: '/fake', allowed: () => true, enabled: () => false, wanted: () => false, spawnFn: () => { spawned++; return child; } });
  d.start(); assert.equal(spawned, 0);
});

// ---- hand control ----
function rig({ hologram = null, front = true, pinchClick = true, tabNumbers = true } = {}) {
  const calls = [], mics = [], acts = []; let clock = 1000;
  const external = { start() {}, close() {}, begin: () => false, move: () => false, end() {}, click: (pt) => { calls.push(['click', Math.round(pt.x), Math.round(pt.y)]); return true; }, tab: (n) => { calls.push(['tab', n]); return true; }, frontIsBrowser: async () => front };
  const holos = { holoNear: () => hologram, latest: () => null, holos: new Map(), place() {}, local: () => ({}) };
  const hc = new HandControl({ holos, display: () => ({ x: 0, y: 0, width: 1801, height: 1101 }), askAccess: async () => true, createCamera: async () => ({ close() {}, setPreview() {}, action: (a) => acts.push(a) }), createCursor: () => ({ moveTo() {}, setState() {}, hide() {}, close() {} }), externalDrag: external, pinchClick: () => pinchClick, tabNumbers: () => tabNumbers, onMic: (id) => mics.push(id), now: () => clock, preview: true });
  return { hc, calls, mics, acts, tick: (ms) => { clock += ms; return clock; } };
}

test('a pinch tap with nothing of Relay\'s under the hand is a real click there; over a hologram it clicks the hologram instead', async () => {
  const a = rig(); await a.hc.enable();
  await a.hc.handle({ type: 'click', x: 0.5, y: 0.5 });
  assert.deepEqual(a.calls, [['click', 900, 550]]);
  assert.deepEqual(a.acts.at(-1), { type: 'click' });
  const sent = []; const holo = { id: 1, win: { isDestroyed: () => false, webContents: { sendInputEvent: (e) => sent.push(e), send() {} } }, x: 900, y: 550 };
  const b = rig({ hologram: holo }); await b.hc.enable();
  await b.hc.handle({ type: 'click', x: 0.5, y: 0.5 });
  assert.deepEqual(b.calls, [], 'the hologram takes it');
  const c = rig({ pinchClick: false }); await c.hc.enable();
  await c.hc.handle({ type: 'click', x: 0.5, y: 0.5 });
  assert.deepEqual(c.calls, [], 'switched off');
});

test('a number held up goes to that tab, and not while hand control is paused or the setting is off', async () => {
  const a = rig(); await a.hc.enable();
  for (let i = 0; i < 30; i++) a.hc.frame({ t: a.tick(50), hands: [hand('Open_Palm', 3)] });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(a.calls.filter((c) => c[0] === 'tab'), [['tab', 3]]);
  assert.deepEqual(a.acts.filter((x) => x.type === 'tab'), [{ type: 'tab', n: 3 }]);
  const off = rig({ tabNumbers: false }); await off.hc.enable();
  for (let i = 0; i < 30; i++) off.hc.frame({ t: off.tick(50), hands: [hand('Open_Palm', 3)] });
  assert.deepEqual(off.calls.filter((c) => c[0] === 'tab'), []);
});

test('in a browser a held peace sign is tab 2, not the mic; anywhere else it still opens the mic', async () => {
  const inBrowser = rig({ front: true }); await inBrowser.hc.enable();
  await inBrowser.hc.handle({ type: 'mic', x: 0.5, y: 0.5 });
  assert.deepEqual(inBrowser.mics, []);
  const elsewhere = rig({ front: false }); await elsewhere.hc.enable();
  await elsewhere.hc.handle({ type: 'mic', x: 0.5, y: 0.5 });
  assert.equal(elsewhere.mics.length, 1);
  const off = rig({ front: true, tabNumbers: false }); await off.hc.enable();
  await off.hc.handle({ type: 'mic', x: 0.5, y: 0.5 });
  assert.equal(off.mics.length, 1, 'with tab numbers off the peace sign always opens the mic');
});

test('the native helper only clicks outside Relay, only presses Command+number in a browser, and the settings are on by default', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const swift = read('native/relay-ax.swift');
  assert.match(swift, /if held \|\| relayOwnsTop\(point\)/);
  assert.match(swift, /let key = digitKeys\[n\], frontIsBrowser\(\)/);
  assert.match(swift, /org\.mozilla\.firefox/);
  assert.match(read('src/main/store.js'), /pinchClick: true, tabNumbers: true/);
  assert.match(read('src/renderer/hands.js'), /count: countOf\(l\)/);
});

test('a tab number is logged at every step, works without the helper through System Events, and says so when it cannot', async () => {
  const logs = [], notes = []; const pressed = [];
  const mk = (over) => { const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); return { child, drag: new ExternalDrag({ bin: '/fake', allowed: () => true, spawnFn: () => child, wanted: () => true, log: (k, m) => logs.push(`${k}: ${m}`), notify: (m) => notes.push(m), ...over }) }; };
  const a = mk({ front: async () => 'org.mozilla.firefox', pressTab: async (n) => { pressed.push(n); } });
  assert.equal(await a.drag.tab(3), true); assert.deepEqual(pressed, [3]);
  assert.ok(logs.some((l) => /number 3: sent through System Events/.test(l)));
  const b = mk({ front: async () => 'com.apple.finder', pressTab: async (n) => { pressed.push(n); } });
  assert.equal(await b.drag.tab(2), false); assert.deepEqual(pressed, [3], 'Finder in front: no key press');
  assert.ok(logs.some((l) => /no browser in front \(com\.apple\.finder\)/.test(l)));
  assert.equal(await b.drag.frontIsBrowser(), false); assert.equal(await a.drag.frontIsBrowser(), true, 'the front app is read without the helper');
  const c = mk({ front: async () => 'org.mozilla.firefox', pressTab: async () => { throw new Error('not allowed'); } });
  assert.equal(await c.drag.tab(4), false); assert.equal(await c.drag.tab(5), false);
  assert.equal(notes.length, 1, 'told once how to fix it'); assert.match(notes[0], /Accessibility/);
});
