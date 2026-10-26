const test = require('node:test');
const assert = require('node:assert/strict');
const { Ducker } = require('../src/main/duck');

function rig({ volume = 60, enabled = true, saved = null } = {}) {
  const s = { volume, saved, calls: [] };
  const osa = async (script) => {
    s.calls.push(script);
    if (script.startsWith('output volume')) return String(s.volume);
    const m = script.match(/set volume output volume (\d+)/);
    if (m) s.volume = +m[1];
    return '';
  };
  const d = new Ducker({ osa, getEnabled: () => enabled, load: () => s.saved, save: (v) => { s.saved = v; }, log: { error() {} } });
  return { d, s };
}

test('it lowers the volume to 30%, saves the original first, and puts it back exactly', async () => {
  const { d, s } = rig({ volume: 60 });
  await d.duck();
  assert.equal(s.volume, 18);
  assert.equal(s.saved, 60, 'the way back is on disk while it is low');
  assert.ok(d.active);
  await d.restore();
  assert.equal(s.volume, 60);
  assert.equal(s.saved, null);
  assert.ok(!d.active);
});

test('ducking twice does nothing extra, and restoring when nothing was ducked changes nothing', async () => {
  const { d, s } = rig({ volume: 50 });
  await d.duck(); await d.duck();
  assert.equal(s.volume, 15);
  await d.restore(); await d.restore();
  assert.equal(s.volume, 50);
  const idle = rig({ volume: 33 });
  await idle.d.restore();
  assert.equal(idle.s.volume, 33);
});

test('it does nothing when switched off, or when the volume is already low', async () => {
  const off = rig({ volume: 60, enabled: false });
  await off.d.duck();
  assert.equal(off.s.volume, 60);
  assert.ok(!off.d.active);
  const quiet = rig({ volume: 15 });
  await quiet.d.duck();
  assert.equal(quiet.s.volume, 15);
  assert.ok(!quiet.d.active);
});

test('a volume you changed yourself while it was low is not overwritten', async () => {
  const { d, s } = rig({ volume: 60 });
  await d.duck();
  s.volume = 40; // you turned it up
  await d.restore();
  assert.equal(s.volume, 40);
  assert.equal(s.saved, null);
});

test('after a crash, the next launch puts the volume back, but only if it was left low', async () => {
  const stuck = rig({ volume: 18, saved: 60 });
  assert.equal(await stuck.d.recover(), true);
  assert.equal(stuck.s.volume, 60);
  assert.equal(stuck.s.saved, null);
  const changed = rig({ volume: 45, saved: 60 }); // you set it yourself afterwards
  await changed.d.recover();
  assert.equal(changed.s.volume, 45);
  assert.equal((await rig({}).d.recover()), false, 'nothing saved: nothing to do');
});

test('at quit it restores synchronously', () => {
  const s = { volume: 18, saved: 60 };
  const d = new Ducker({ osa: async () => '', getEnabled: () => true, save: (v) => { s.saved = v; } });
  d.original = 60; d.level = 18;
  const calls = [];
  d.restoreNow((script) => { calls.push(script); return script.startsWith('output volume') ? '18' : ''; });
  assert.deepEqual(calls, ['output volume of (get volume settings)', 'set volume output volume 60']);
  assert.ok(!d.active);
  assert.equal(s.saved, null);
});

test('a failing volume read leaves nothing half-ducked', async () => {
  const d = new Ducker({ osa: async () => { throw new Error('boom'); }, getEnabled: () => true, log: { error() {} } });
  await d.duck();
  assert.ok(!d.active);
});
