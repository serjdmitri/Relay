const test = require('node:test');
const assert = require('node:assert/strict');
const { HoloManager } = require('../src/main/holo/manager');
const { HoloLibrary } = require('../src/main/holo/library');
const { parseHoloCommand } = require('../src/main/holo/commands');
const { cleanAnnotations, toSaved } = require('../src/main/holo/logic');

let wcId = 500;
function fakeWin() {
  const w = { sent: [], bounds: { x: 0, y: 0, width: 460, height: 540 }, destroyed: false, webContents: { id: wcId++, send(...a) { w.sent.push(a); } }, ready: Promise.resolve() };
  w.setBounds = (b) => { w.bounds = { ...w.bounds, ...b }; }; w.showInactive = () => {}; w.close = () => { w.destroyed = true; }; w.isDestroyed = () => w.destroyed;
  return w;
}
function rig() {
  const data = {};
  const storage = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
  const library = new HoloLibrary({ storage, now: (() => { let t = 1000; return () => t++; })() });
  let stored = [];
  const wins = [];
  const m = new HoloManager({ createWindow: () => { const w = fakeWin(); wins.push(w); return w; }, cursor: () => ({ x: 0, y: 0 }), area: () => ({ x: 0, y: 0, width: 1800, height: 1100 }),
    download: async (u) => Buffer.from(u), library, saved: () => stored, save: (l) => { stored = l; }, readFile: (f) => Buffer.from(`file ${f}`) });
  return { m, library, data, wins };
}
const shapes = (t, n = 1) => ({ kind: 'shapes', title: t, credit: 'c', parts: Array.from({ length: n }, () => ({ shape: 'sphere', size: [1] })) });
const stl = (t) => ({ kind: 'stl', title: t, credit: 'c', url: `https://upload.wikimedia.org/${t}.stl`, bytes: Buffer.from(t) });

test('every hologram that is shown goes into the library, pinned or not, and changes update it', async () => {
  const { m, library } = rig();
  const a = await m.show({ title: 'Skull', items: [stl('Skull')] });
  const b = await m.show({ title: 'Cube', items: [shapes('Cube')], pinned: true });
  assert.deepEqual(library.entries.map((e) => e.title).sort(), ['Cube', 'Skull']);
  assert.equal(library.get(b).saved.pinned, true);
  assert.equal(library.get(a).saved.pinned, false);
  await m.add(a, stl('Heart'));
  assert.equal(library.get(a).title, 'Skull + Heart');
  assert.equal(library.get(a).saved.items.length, 2);
  m.close(a);
  assert.ok(library.get(a), 'closing does not remove it from the library');
});

test('holograms that cannot be shown again are not kept in the library', async () => {
  const { m, library } = rig();
  await m.show({ title: 'Elsewhere', items: [{ kind: 'stl', title: 'x', url: 'https://example.com/x.stl', bytes: Buffer.from('x') }] });
  assert.equal(library.entries.length, 0);
});

test('searching the library finds by title or by a model inside, best match first, and an empty search gives the newest', async () => {
  const { m, library } = rig();
  await m.show({ title: 'Toyota Corolla', items: [shapes('Toyota Corolla')] });
  await m.show({ title: 'Engine + Piston', items: [shapes('Engine'), shapes('Piston')] });
  await m.show({ title: 'Skull', items: [shapes('Skull')] });
  assert.deepEqual(library.search('my hologram of the corolla').map((e) => e.title), ['Toyota Corolla']);
  assert.deepEqual(library.search('piston').map((e) => e.title), ['Engine + Piston']);
  assert.deepEqual(library.search('toyota engine').map((e) => e.title), [], 'every word must match');
  assert.deepEqual(library.search('corol').map((e) => e.title), ['Toyota Corolla'], 'the start of a word');
  assert.equal(library.search('').length, 3);
  assert.equal(library.search('the hologram')[0].title, 'Skull', 'filler words only: newest first');
});

test('a hologram from the library comes back as it was; one already on screen is not shown twice', async () => {
  const { m, library } = rig();
  const id = await m.show({ title: 'Skull', items: [stl('Skull')], x: 700, y: 400, scale: 1.4 });
  m.close(id);
  assert.equal(m.holos.size, 0);
  const back = await m.openFromLibrary(id);
  assert.equal(back, id);
  const h = m.get(id);
  assert.deepEqual([h.x, h.y, h.scale, h.pinned], [700, 400, 1.4, false]);
  assert.equal(h.items[0].bytes.toString(), 'https://upload.wikimedia.org/Skull.stl');
  assert.equal(await m.openFromLibrary(id), id);
  assert.equal(m.holos.size, 1);
  assert.equal(await m.openFromLibrary('nope'), null);
  assert.ok(library.remove(id));
});

test('a scene saves what is on screen, and bringing it back replaces what is there', async () => {
  const { m, library } = rig();
  await m.show({ title: 'Skull', items: [stl('Skull')], x: 300, y: 300, pinned: true });
  await m.show({ title: 'Cube', items: [shapes('Cube')], x: 900, y: 500, scale: 0.8 });
  assert.deepEqual(m.saveScene('engine bay'), { ok: true, replaced: false, count: 2, skipped: 0 });
  assert.equal(m.saveScene('engine bay').replaced, true);
  m.closeAll();
  await m.show({ title: 'Something else', items: [shapes('Else')] });
  const r = await m.openScene('Engine Bay');
  assert.deepEqual([r.ok, r.shown, r.name], [true, 2, 'engine bay']);
  assert.deepEqual([...m.holos.values()].map((h) => [h.title, h.x, h.y, h.scale, h.pinned]).sort(), [['Cube', 900, 500, 0.8, false], ['Skull', 300, 300, 1, true]]);
  const none = await m.openScene('gaming');
  assert.equal(none.ok, false);
  assert.match(none.reason, /do not have a scene called gaming\. You have: engine bay/);
  assert.equal(library.deleteScene('engine').name, 'engine bay');
  assert.match((await m.openScene('engine bay')).reason, /not have a scene called engine bay yet/);
  m.closeAll();
  assert.equal(m.saveScene('empty').ok, false);
});

test('annotations are kept with the hologram, cleaned, and come back with it', async () => {
  const { m, library } = rig();
  const id = await m.show({ title: 'Cube', items: [shapes('Cube')], pinned: true });
  const h = m.get(id);
  const kept = m.setAnnotations(h, [{ id: 'a1', text: '  Check the   weld ', item: 0, p: [0.5, 1, -0.25], n: [0, 1, 0] }, { id: 'bad', text: '', p: [1, 2, 3] }, { id: 'b', text: 'no spot' }, { id: 'c', text: 'x', p: [Infinity, 0, 0] }]);
  assert.deepEqual(kept, [{ id: 'a1', text: 'Check the weld', item: 0, p: [0.5, 1, -0.25], n: [0, 1, 0] }]);
  assert.deepEqual(library.get(id).saved.annotations, kept);
  assert.deepEqual(toSaved(h).annotations, kept);
  m.close(id);
  await m.openFromLibrary(id);
  assert.deepEqual(m.get(id).annotations, kept);
  const init = m.get(id).win.sent.filter((s) => s[1] === 'init').at(-1)[2];
  assert.deepEqual(init.annotations, kept, 'the page is told about them');
  assert.equal(cleanAnnotations(Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, text: 't', p: [0, 0, 0] }))).length, 20);
});

test('spoken: library, find, open, scenes', () => {
  const P = parseHoloCommand;
  assert.deepEqual(P('show my holograms'), { type: 'holo-library' });
  assert.deepEqual(P('find my hologram of the car'), { type: 'holo-find', query: 'the car' });
  assert.deepEqual(P('open the skull hologram'), { type: 'holo-open', query: 'skull' });
  assert.deepEqual(P('save this scene as engine bay'), { type: 'scene-save', name: 'engine bay' });
  assert.deepEqual(P('save these holograms as the engine bay scene'), { type: 'scene-save', name: 'engine bay' });
  assert.deepEqual(P('show the engine bay scene'), { type: 'scene-open', name: 'engine bay' });
  assert.deepEqual(P('list my scenes'), { type: 'scene-list' });
  assert.deepEqual(P('delete the engine bay scene'), { type: 'scene-delete', name: 'engine bay' });
  for (const t of ['show me a hologram of a skull', 'save this as stl', 'open the study layout', 'show the skull', 'save it']) assert.equal(P(t), null, t);
});

const { parseQuick, runQuick } = require('../src/main/quick');

test('quick commands route the library and scenes, and leave an unknown hologram to the model', async () => {
  assert.equal(parseQuick('show my holograms').type, 'holo-library');
  assert.equal(parseQuick('save this scene as engine bay').type, 'scene-save');
  assert.equal(parseQuick('show the engine bay scene').type, 'scene-open');
  const seen = [];
  const ctx = { holoLib: async (c) => { seen.push(c.type); return c.type === 'holo-open' ? null : `did ${c.type}`; } };
  assert.equal((await runQuick(parseQuick('list my scenes'), {}, ctx)).reply, 'did scene-list');
  assert.equal(await runQuick(parseQuick('open the unicorn hologram'), {}, ctx), null, 'not in the library: the model may make it');
  assert.equal(await runQuick(parseQuick('show my holograms'), {}, {}), null, 'no library: left to the model');
  assert.deepEqual(seen, ['scene-list', 'holo-open']);
});
