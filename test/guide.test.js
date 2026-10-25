const test = require('node:test');
const assert = require('node:assert/strict');
const { Guide } = require('../src/main/guide');

function setup({ frames = {}, cursor = { x: 0, y: 0 } } = {}) {
  const calls = [];
  const overlay = { guide: async (card, target, shape) => { calls.push({ card, target, shape }); return true; }, clear() { calls.push('clear'); } };
  const looked = [];
  const mac = { uiLocate: async (app, name) => { looked.push(name); const f = frames[name]; if (typeof f === 'function') return f(); if (!f) throw new Error(`No UI element named "${name}".`); return f; } };
  const where = { ...cursor };
  const g = new Guide({ overlay, mac, getCursor: () => where, sleep: async () => {} });
  return { g, calls, looked, where };
}
const box = (x, y) => ({ x, y, w: 80, h: 30, cx: x + 40, cy: y + 15 });
const steps = [{ text: 'One', app: 'A', name: 'a' }, { text: 'Two', app: 'A', name: 'b' }, { text: 'Three', pt: { x: 500, y: 500 } }];

test('start shows step one outlined and tells the model not to call again', async () => {
  const { g, calls } = setup({ frames: { a: box(10, 10) } });
  const out = await g.start(steps, 0);
  assert.match(out, /step 1 of 3/);
  assert.match(out, /do not call guide_step again/);
  assert.deepEqual(calls[0].shape, { type: 'box', x: 10, y: 10, w: 80, h: 30, label: '' });
  assert.ok(g.active);
});

test('a missing element still shows the card and tells the model which name failed', async () => {
  const { g, calls } = setup();
  const out = await g.start(steps, 0);
  assert.match(out, /Could not find "a" in A/);
  assert.equal(calls[0].shape, null);
  assert.ok(g.active);
});

test('next and back move through the steps, looking up each element when its step comes up', async () => {
  const { g, calls, looked } = setup({ frames: { a: box(10, 10), b: box(200, 200) } });
  await g.start(steps, 0);
  assert.match(await g.run('next'), /Step 2 of 3: Two/);
  assert.equal(calls[1].card.current, 1);
  assert.deepEqual(looked, ['a', 'b']);
  assert.match(await g.run('next'), /Step 3 of 3: Three/);
  assert.equal(calls[2].shape.type, 'circle', 'a spot gets a ring');
  assert.match(await g.run('back'), /Back to step 2/);
  assert.match(await g.run('next'), /Step 3/);
  assert.match(await g.run('next'), /last step/);
  assert.ok(!g.active, 'finished');
  assert.equal(calls.at(-1), 'clear');
});

test('a later step whose element appears after a moment is found by retrying', async () => {
  let n = 0;
  const { g, calls } = setup({ frames: { a: box(10, 10), b: () => { if (++n < 3) throw new Error('not yet'); return box(5, 5); } } });
  await g.start(steps, 0);
  await g.run('next');
  assert.equal(n, 3);
  assert.equal(calls[1].shape.x, 5);
});

test('a click on the highlighted element moves on; a click elsewhere does not', async () => {
  const { g, calls, where } = setup({ frames: { a: box(100, 100), b: box(300, 300) } });
  await g.start(steps, 0);
  Object.assign(where, { x: 20, y: 20 });
  g.onClick();
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(calls.length, 1, 'a click far away is ignored');
  Object.assign(where, { x: 140, y: 115 });
  g.onClick();
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].card.current, 1);
});

test('command only applies while a guide is up, and stop and deactivate end it', async () => {
  const { g, calls } = setup({ frames: { a: box(1, 1) } });
  assert.equal(g.command('next'), null);
  await g.start(steps, 0);
  assert.equal(g.command('Next.'), 'next');
  assert.equal(g.command('next song'), null);
  assert.equal(await g.run('stop'), 'Closed the guide.');
  assert.ok(!g.active);
  assert.equal(calls.at(-1), 'clear');
  await g.start(steps, 0);
  g.deactivate();
  assert.equal(g.command('next'), null);
  assert.match(await g.run('next'), /no guide/);
});

test('guides turned off: start reports it and stays inactive', async () => {
  const overlay = { guide: async () => false, clear() {} };
  const g = new Guide({ overlay, mac: { uiLocate: async () => box(1, 1) } });
  assert.equal(await g.start(steps, 0), false);
  assert.ok(!g.active);
});
