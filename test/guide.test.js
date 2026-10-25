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

// ---- checking what the user does
function withReplan(opts) {
  const s = setup(opts);
  const asked = [];
  let t = 1000000;
  s.g.onReplan = (info) => { asked.push(info); };
  s.g.now = () => t;
  s.tick = (ms) => { t += ms; };
  s.asked = asked;
  return s;
}

test('a click away from the highlight asks for a progress check, but a click on it does not', async () => {
  const { g, where, asked } = withReplan({ frames: { a: box(100, 100), b: box(300, 300) } });
  await g.start(steps, 0, 'Set up Night Shift');
  Object.assign(where, { x: 900, y: 900 });
  g.onClick();
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0], { goal: 'Set up Night Shift', steps: ['One', 'Two', 'Three'], index: 0, reason: 'They clicked somewhere other than the highlighted spot.' });
  Object.assign(where, { x: 140, y: 115 });
  g.onClick();
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(asked.length, 1, 'clicking the right spot just moves on');
  assert.equal(g.index, 1);
});

test('progress checks are rate limited and capped', () => {
  const { g, asked, tick } = withReplan({ frames: { a: box(1, 1) } });
  g.live = true; g.steps = steps;
  assert.ok(g.requestReplan('one'));
  assert.ok(!g.requestReplan('too soon'));
  for (let i = 0; i < 10; i++) { tick(9000); g.requestReplan('later'); }
  assert.equal(asked.length, 6, 'at most six a guide');
  g.deactivate();
  assert.ok(!g.requestReplan('not live'));
});

test('when the next step has nothing to point at, the model is asked to look at the screen', async () => {
  const { g, asked } = withReplan({ frames: { a: box(1, 1) } }); // "b" does not exist
  await g.start(steps, 0);
  const out = await g.run('next');
  assert.match(out, /Checking the screen/);
  assert.equal(asked.length, 1);
  assert.match(asked[0].reason, /Step 2 .*could not be found/);
  assert.equal(asked[0].index, 1);
});

test('the outline follows an element that moves, and a vanished one asks for a check', async () => {
  let at = box(100, 100);
  const { g, calls, asked } = withReplan({ frames: { a: () => at } });
  await g.start(steps, 0);
  await g.check();
  assert.equal(calls.length, 1, 'unmoved: nothing redrawn');
  at = box(400, 300);
  await g.check();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].shape.x, 400);
  assert.equal(g.region.x, 400);
  at = () => { throw new Error('gone'); };
  const frames = { a: at };
  g.mac = { uiLocate: async () => { throw new Error('gone'); } };
  await g.check(); await g.check();
  assert.equal(asked.length, 0, 'two misses are tolerated');
  await g.check();
  assert.equal(asked.length, 1);
  assert.match(asked[0].reason, /no longer on screen/);
  g.deactivate();
});
