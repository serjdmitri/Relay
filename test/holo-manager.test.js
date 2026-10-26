const test = require('node:test');
const assert = require('node:assert/strict');
const { HoloManager } = require('../src/main/holo/manager');

let wcId = 1;
function fakeWin() {
  const w = { sent: [], bounds: { x: 0, y: 0, width: 460, height: 540 }, destroyed: false, visible: false, webContents: { id: wcId++, send(...a) { w.sent.push(a); } }, ready: Promise.resolve() };
  w.setBounds = (b) => { w.bounds = { ...w.bounds, ...b }; };
  w.setPosition = (x, y) => { w.bounds.x = x; w.bounds.y = y; };
  w.getBounds = () => ({ ...w.bounds });
  w.showInactive = () => { w.visible = true; };
  w.close = () => { w.destroyed = true; };
  w.isDestroyed = () => w.destroyed;
  return w;
}

function make(saved = []) {
  const wins = [];
  const cur = { x: 0, y: 0 };
  let stored = saved;
  const timers = [];
  const m = new HoloManager({
    createWindow: () => { const w = fakeWin(); wins.push(w); return w; },
    cursor: () => cur, area: () => ({ x: 0, y: 0, width: 1800, height: 1100 }),
    download: async (url) => Buffer.from(`bytes of ${url}`), saved: () => stored, save: (l) => { stored = l; },
    setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {}
  });
  return { m, wins, cur, saved: () => stored, tick: () => timers.at(-1)() };
}
const stl = (t) => ({ kind: 'stl', title: t, credit: 'c', url: `https://upload.wikimedia.org/${t}.stl`, bytes: Buffer.from(t) });
const lastSent = (w, kind) => w.sent.filter((s) => s[1] === kind).at(-1);

test('a hologram appears without a frame and is told what to show', async () => {
  const { m, wins } = make();
  const id = await m.show({ title: 'Skull', items: [stl('Skull')], options: { list: [{}, {}, {}], index: 0 } });
  assert.ok(wins[0].visible);
  const init = lastSent(wins[0], 'init')[2];
  assert.equal(init.title, 'Skull');
  assert.deepEqual(init.options, { index: 0, count: 3 });
  assert.equal(m.forSender(wins[0].webContents.id).id, id);
});

test('another model can be added next to it, up to four', async () => {
  const { m, wins } = make();
  const id = await m.show({ title: 'Skull', items: [stl('Skull')] });
  assert.equal(await m.add(id, stl('Heart')), true);
  assert.equal(m.get(id).title, 'Skull + Heart');
  assert.equal(lastSent(wins[0], 'items')[2].items.length, 2);
  await m.add(id, stl('Brain'));
  await m.add(id, stl('Eiffel'));
  assert.equal(await m.add(id, stl('Fifth')), false);
  assert.equal(await m.add('nope', stl('x')), false);
});

test('stepping through options loads the next model and wraps round', async () => {
  const { m, wins } = make();
  const list = [{ kind: 'stl', title: 'A', url: 'https://upload.wikimedia.org/A.stl', credit: 'x' }, { kind: 'stl', title: 'B', url: 'https://upload.wikimedia.org/B.stl', credit: 'y' }, { kind: 'shapes', title: 'Built', parts: [{ shape: 'sphere', size: [1] }], credit: 'z' }];
  const id = await m.show({ title: 'Thing', items: [{ ...stl('A') }], options: { list, index: 0 } });
  await m.step(id, 1);
  assert.equal(m.get(id).items[0].title, 'B');
  assert.equal(m.get(id).items[0].bytes.toString(), 'bytes of https://upload.wikimedia.org/B.stl');
  await m.step(id, 1);
  assert.equal(m.get(id).items[0].kind, 'shapes');
  await m.step(id, 1);
  assert.equal(m.get(id).items[0].title, 'A', 'wrapped round');
  assert.equal(lastSent(wins[0], 'items')[2].options.index, 0);
});

test('dragging by the base moves the window, and dropping on another combines them', async () => {
  const { m, wins, cur, tick, saved } = make();
  const a = await m.show({ title: 'Skull', items: [stl('Skull')], x: 100, y: 100 });
  const b = await m.show({ title: 'Heart', items: [stl('Heart')], x: 900, y: 100 });
  cur.x = 150; cur.y = 150;
  m.startDrag(m.get(a));
  cur.x = 600; cur.y = 200; tick();
  assert.deepEqual([wins[0].bounds.x, wins[0].bounds.y], [550, 150], 'it follows the pointer');
  cur.x = 1000; cur.y = 200; tick(); // over the heart
  assert.deepEqual(lastSent(wins[1], 'merge-hint')[2], true, 'the one underneath is told to show it will combine');
  m.stopDrag();
  await new Promise((r) => setImmediate(r)); // the fit may take a moment
  assert.equal(m.get(a), null, 'the dragged one is gone');
  assert.equal(m.get(b).title, 'Heart + Skull');
  assert.equal(m.get(b).items.length, 2);
  assert.equal(wins[0].destroyed, true);
  assert.deepEqual(lastSent(wins[1], 'merge-hint')[2], false);
  assert.deepEqual(saved(), [], 'nothing pinned, nothing saved');
  assert.ok(m.get(b).items[1].from, 'the new one flies in from where it was dropped');
});

test('letting go away from the others just leaves it there; a drag that never ends is let go', async () => {
  const { m, wins, cur, tick } = make();
  const a = await m.show({ title: 'Skull', items: [stl('Skull')], x: 100, y: 100 });
  cur.x = 150; cur.y = 150;
  m.startDrag(m.get(a));
  cur.x = 700; cur.y = 400; tick();
  m.stopDrag();
  assert.equal(m.get(a).x, 650);
  assert.ok(m.get(a));
  m.startDrag(m.get(a));
  m.dragging.started -= 31000;
  tick();
  assert.equal(m.dragging, null);
});

test('pinned ones stay when the rest are taken away, are saved as links, and come back after a restart', async () => {
  const { m, saved } = make();
  const keep = await m.show({ title: 'Skull', items: [stl('Skull')], x: 300, y: 120, scale: 1.4 });
  const gone = await m.show({ title: 'Heart', items: [stl('Heart')] });
  m.pin(keep, true);
  m.hideUnpinned();
  assert.equal(m.get(gone), null);
  assert.ok(m.get(keep));
  const list = saved();
  assert.equal(list.length, 1);
  assert.equal(list[0].items[0].url, 'https://upload.wikimedia.org/Skull.stl');
  assert.ok(!JSON.stringify(list).includes('"bytes"'));
  // a restart
  const second = make(list);
  await second.m.restore();
  const back = second.m.latest();
  assert.equal(back.title, 'Skull');
  assert.equal(back.pinned, true);
  assert.equal(back.scale, 1.4);
  assert.deepEqual([second.wins[0].bounds.x, second.wins[0].bounds.y], [300, 120]);
  assert.equal(back.items[0].bytes.toString(), 'bytes of https://upload.wikimedia.org/Skull.stl');
  m.close(keep);
  assert.deepEqual(saved(), [], 'closing a pinned one forgets it');
});

test('only six holograms at once: the oldest unpinned one makes room', async () => {
  const { m } = make();
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(await m.show({ title: `M${i}`, items: [stl(`M${i}`)] }));
  m.pin(ids[0], true);
  await m.show({ title: 'Seventh', items: [stl('S')] });
  assert.equal(m.holos.size, 6);
  assert.ok(m.get(ids[0]), 'the pinned one stayed');
  assert.equal(m.get(ids[1]), null, 'the oldest unpinned went');
});

test('a photo option is made once on first use, and a pinned made-from-photo hologram comes back from its file', async () => {
  const made = [];
  const wins = [];
  const mk = (saved = [], readFile = () => Buffer.from('cached glb')) => {
    let stored = saved;
    const m = new HoloManager({
      createWindow: () => { const w = fakeWin(); wins.push(w); return w; }, cursor: () => ({ x: 0, y: 0 }), area: () => ({ x: 0, y: 0, width: 1800, height: 1100 }),
      download: async (u) => Buffer.from(u), generate: async (c) => { made.push(c.title); return { kind: 'glb', title: c.title, credit: 'photo', file: '/cache/abc.glb', bytes: Buffer.from('glb') }; }, readFile,
      saved: () => stored, save: (l) => { stored = l; }, setTimer: () => 1, clearTimer: () => {}
    });
    return { m, saved: () => stored };
  };
  const { m, saved } = mk();
  const list = [{ kind: 'stl', title: 'A', url: 'https://upload.wikimedia.org/A.stl', credit: 'x' }, { kind: 'photo', title: 'Robot photo', photoUrl: 'https://upload.wikimedia.org/p.jpg', credit: 'y' }];
  const id = await m.show({ title: 'VEX robot', items: [{ kind: 'stl', title: 'A', credit: 'x', url: list[0].url, bytes: Buffer.from('a') }], options: { list, index: 0 } });
  await m.step(id, 1);
  assert.equal(m.get(id).items[0].kind, 'glb');
  await m.step(id, 1);
  await m.step(id, 1);
  assert.deepEqual(made, ['Robot photo'], 'generated once, not every time round');
  m.pin(id, true);
  assert.deepEqual(saved()[0].items[0], { kind: 'glb', title: 'Robot photo', file: '/cache/abc.glb', credit: 'photo' });
  const again = mk(saved());
  await again.m.restore();
  assert.equal(again.m.latest().items[0].bytes.toString(), 'cached glb');
  const gone = mk(saved(), () => null);
  await gone.m.restore();
  assert.equal(gone.m.latest(), null, 'a pinned model whose file is gone is skipped, not a crash');
});

function fitted(over = {}) {
  const wins = [];
  const cur = { x: 0, y: 0 };
  const asked = [];
  const files = [];
  const m = new HoloManager({
    createWindow: () => { const w = fakeWin(); wins.push(w); return w; }, cursor: () => cur, area: () => ({ x: 0, y: 0, width: 1800, height: 1100 }),
    download: async (u) => Buffer.from(u), saved: () => [], save: () => {}, setTimer: () => 1, clearTimer: () => {},
    fit: async (base, item, hint) => { asked.push([base.title, base.size, item.title, item.size, hint]); return { anchor: 'top', scale: 0.5, rotate: [0, 0, 0] }; },
    putFile: (b) => { files.push(b.toString()); return `/cache/${files.length}.glb`; }, ...over
  });
  return { m, wins, cur, asked, files };
}

test('when one is dropped on another the model decides how they fit, from the names and sizes', async () => {
  const { m, wins, cur, asked, files } = fitted();
  const a = await m.show({ title: 'Claw', items: [stl('Claw')], x: 100, y: 100 });
  const b = await m.show({ title: 'Robot', items: [stl('Robot')], x: 900, y: 100 });
  m.setSizes(a, [{ w: 0.8, h: 0.5, d: 0.6 }]);
  m.setSizes(b, [{ w: 2, h: 1.2, d: 1.6 }]);
  cur.x = 150; cur.y = 150;
  m.startDrag(m.get(a));
  cur.x = 1000; cur.y = 200; m.tickDrag?.call(m);
  m.stopDrag();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(asked[0].slice(0, 4), ['Robot', { w: 2, h: 1.2, d: 1.6 }, 'Claw', { w: 0.8, h: 0.5, d: 0.6 }]);
  const item = m.get(b).items[1];
  assert.deepEqual(item.placement, { anchor: 'top', scale: 0.5, rotate: [0, 0, 0] });
  assert.ok(Math.abs(Math.hypot(...item.from) - 1) < 1e-6, 'a unit direction on the screen, where it was dropped from');
  assert.ok(!('size' in item));
  assert.equal(lastSent(wins[1], 'merge-hint', true)?.[2] ?? false, false);
});

test('if the model cannot answer, the pieces still combine', async () => {
  const { m } = fitted({ fit: async () => { throw new Error('no model'); } });
  const a = await m.show({ title: 'A', items: [stl('A')] });
  const b = await m.show({ title: 'B', items: [stl('B')] });
  assert.equal(await m.merge(a, b), true);
  assert.equal(m.get(b).items.length, 2);
  assert.equal(m.get(b).items[1].placement, null);
});

test('a piece pulled out becomes its own hologram under the pointer, and the rest of the first stays', async () => {
  const { m, wins, cur, files } = fitted();
  const a = await m.show({ title: 'Robot', items: [{ kind: 'glb', title: 'Robot', credit: 'c', bytes: Buffer.from('whole'), file: '/cache/0.glb' }], x: 300, y: 100 });
  cur.x = 700; cur.y = 400;
  const id = await m.extract(m.get(a), { item: 0, name: 'Piece 2', part: new Uint8Array(Buffer.from('arm')), rest: new Uint8Array(Buffer.from('body')) });
  const piece = m.get(id);
  assert.equal(piece.title, 'Piece 2 of Robot');
  assert.equal(piece.items[0].bytes.toString(), 'arm');
  assert.deepEqual([wins[1].bounds.x, wins[1].bounds.y], [470, -32], 'the new one is centred on the pointer, its base under it');
  assert.equal(m.get(a).items[0].bytes.toString(), 'body', 'the first keeps the rest');
  assert.deepEqual(files, ['arm', 'body']);
  assert.ok(m.dragging && m.dragging.id === id, 'it follows the pointer until it is let go');
  m.stopDrag();
  // taking out the last piece closes the first
  const only = await m.show({ title: 'Single', items: [{ kind: 'glb', title: 'Single', credit: 'c', bytes: Buffer.from('x') }] });
  await m.extract(m.get(only), { item: 0, name: 'Piece 1', part: new Uint8Array(Buffer.from('p')), rest: null });
  assert.equal(m.get(only), null);
  m.stopDrag();
});
