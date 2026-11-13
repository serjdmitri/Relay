const test = require('node:test');
const assert = require('node:assert/strict');
const { LightMode } = require('../src/main/lightMode');

const swap = (usedMB, totalMB = 9216) => ({ swapUsedMB: usedMB, swapTotalMB: totalMB });

test('heavy swapping turns it on, and it only turns off once the swap has really eased (no flicker)', () => {
  assert.deepEqual(LightMode.reasonsFor(swap(7700)), ['memory']);
  assert.deepEqual(LightMode.reasonsFor(swap(5000)), [], 'about half used is normal');
  assert.deepEqual(LightMode.reasonsFor(swap(2500, 3000)), [], 'a small swap file filling up is not a squeeze');
  assert.deepEqual(LightMode.reasonsFor(swap(6000), true), ['memory'], 'already on: stays on until it is under 60 percent');
  assert.deepEqual(LightMode.reasonsFor(swap(6000), false), [], 'not on yet: 65 percent is not enough to start');
  assert.deepEqual(LightMode.reasonsFor(swap(4500), true), []);
  assert.deepEqual(LightMode.reasonsFor(swap(0, 0)), [], 'no swap file at all');
});

test('a low battery that is not charging turns it on; plugging in, or recovering, turns it off', () => {
  assert.deepEqual(LightMode.reasonsFor({ onBattery: true, charging: false, percent: 15 }), ['battery']);
  assert.deepEqual(LightMode.reasonsFor({ onBattery: true, charging: false, percent: 25 }), [], 'not low enough yet');
  assert.deepEqual(LightMode.reasonsFor({ onBattery: true, charging: false, percent: 25 }, true), ['battery'], 'on: it takes 30 percent to leave');
  assert.deepEqual(LightMode.reasonsFor({ onBattery: false, charging: true, percent: 7 }), [], 'charging is not a reason, however low');
  assert.deepEqual(LightMode.reasonsFor({ onBattery: true, charging: true, percent: 7 }), []);
  assert.deepEqual(LightMode.reasonsFor({ ...swap(8000), onBattery: true, charging: false, percent: 9 }), ['memory', 'battery']);
  assert.deepEqual(LightMode.reasonsFor(null), []);
});

test('it tells the caller only when it changes, keeps its state when a reading fails, and does nothing when switched off', async () => {
  let s = swap(8000); const calls = []; let on = true; let fail = false;
  const lm = new LightMode({ sample: async () => { if (fail) throw new Error('no reading'); return s; }, onChange: (a, r) => calls.push([a, r]), enabled: () => on });
  assert.equal(await lm.check(), true); assert.equal(await lm.check(), true); assert.deepEqual(calls, [[true, ['memory']]], 'once');
  fail = true; assert.equal(await lm.check(), true, 'a failed reading changes nothing'); fail = false;
  s = swap(2000); assert.equal(await lm.check(), false); assert.deepEqual(calls.at(-1), [false, []]);
  s = swap(8000); on = false; assert.equal(await lm.check(), false, 'switched off in settings: never on');
  const throwing = new LightMode({ sample: async () => swap(8000), onChange: () => { throw new Error('x'); } });
  assert.equal(await throwing.check(), true, 'a failing callback does not break the check');
});

test('main.js wires light mode to the voice, holograms, swipe camera and hand control, with a setting that is on by default', () => {
  const read = (f) => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', f), 'utf8');
  const main = read('src/main/main.js');
  assert.match(main, /new LightMode\(/); assert.match(main, /setInterval\(\(\) => lightMode\.check\(\)/); assert.match(main, /speaker\.light = on; holos\.light = on; holos\.refreshUi/);
  assert.match(main, /fist, light: lightOn/); assert.match(main, /lightOn \? Math\.min\(10,/);
  assert.match(read('src/main/voice.js'), /if \(this\.light\) return;/); assert.match(read('src/main/holo/manager.js'), /light: !!this\.light/);
  assert.match(read('src/renderer/holo.js'), /lightOn \? 1 :/); assert.match(read('src/renderer/swipe-runner.js'), /light \? next \* 2 : next/);
  assert.match(read('src/main/store.js'), /lightMode: true/); assert.match(read('src/renderer/app.js'), /'settings\.lightMode'/);
});
