const test = require('node:test');
const assert = require('node:assert/strict');
const { HandsAutoOff } = require('../src/main/handsIdle');

function rig(seconds = 90) {
  const r = { t: 1000000, on: true, offs: 0, notes: 0 };
  r.a = new HandsAutoOff({ isOn: () => r.on, off: async () => { r.on = false; r.offs++; }, getSeconds: () => seconds, note: () => { r.notes++; }, now: () => r.t });
  return r;
}

test('hand control that a fist turned on turns itself off after no hand for the set time, and says so', async () => {
  const r = rig(90);
  r.a.started();
  r.t += 89000; assert.equal(await r.a.tick(), false);
  r.t += 2000; assert.equal(await r.a.tick(), true);
  assert.equal(r.on, false); assert.equal(r.offs, 1); assert.equal(r.notes, 1);
  r.t += 100000; assert.equal(await r.a.tick(), false, 'only once');
});

test('every hand seen starts the count again', async () => {
  const r = rig(60);
  r.a.started();
  for (let i = 0; i < 5; i++) { r.t += 50000; r.a.seen(); assert.equal(await r.a.tick(), false); }
  r.t += 61000; assert.equal(await r.a.tick(), true);
});

test('hand control turned on any other way is never turned off by this', async () => {
  const r = rig(30);
  r.a.manual(); r.t += 10 * 60000;
  assert.equal(await r.a.tick(), false); assert.equal(r.on, true);
  r.a.started(); r.a.manual(); r.t += 10 * 60000;
  assert.equal(await r.a.tick(), false, 'turning it on or off by hand takes the fist out of it');
});

test('it stops watching when hand control was turned off by someone else, and keeps the time within sensible limits', async () => {
  const r = rig(90);
  r.a.started(); r.on = false; r.t += 200000;
  assert.equal(await r.a.tick(), false); assert.equal(r.a.byFist, false);
  const tiny = rig(1); tiny.a.started(); tiny.t += 10000; assert.equal(await tiny.a.tick(), false, 'never less than 15 seconds');
  tiny.t += 6000; assert.equal(await tiny.a.tick(), true);
});
