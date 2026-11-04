const test = require('node:test');
const assert = require('node:assert/strict');
const { IntruderLog } = require('../src/main/intruderLog');

// Behaviour under test: src/main/intruderLog.js, the record of strangers the alarm took pictures of. No earlier test file covers it.
function make(over = {}) {
  const files = new Map(), data = {};
  const store = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
  let t = Date.UTC(2026, 10, 3, 18, 0, 0);
  const fs = { mkdirSync() {}, writeFileSync: (p, b) => files.set(p, b), readFileSync: (p) => { if (!files.has(p)) throw Error('ENOENT'); return files.get(p); }, rmSync: (p) => files.delete(p) };
  const log = new IntruderLog({ store, dir: '/data/intruders', fs, path: require('node:path'), now: () => t, encrypt: (s) => Buffer.from('ENC:' + s), decrypt: (b) => b.toString().replace(/^ENC:/, ''), ...over });
  return { log, files, data, advance: (ms) => { t += ms; }, now: () => t };
}
const jpeg = (x = 'AAAA') => `data:image/jpeg;base64,${x}`;
const face = (seed) => Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.37 + seed));
const near = (e) => e.map((v, i) => v + 0.02 * Math.cos(i));

test('a visit is recorded from the first picture to the outcome, the pictures are stored encrypted, and you can read them back', () => {
  const m = make();
  const id = m.log.begin(20);
  assert.deepEqual(m.log.pending(), [], 'nothing to tell you while it is still going');
  assert.equal(m.log.addShot(id, { jpeg: jpeg('SGVsbG8='), embeddings: [face(1)] }), true);
  assert.ok([...m.files.values()].every((b) => b.toString().startsWith('ENC:')), 'only the encrypted bytes are on disk');
  assert.ok(![...m.files.values()].some((b) => b.toString().includes('data:image')), 'and not as a plain picture');
  m.advance(60000); m.log.finish(id, 'locked');
  const [p] = m.log.pending(); assert.equal(p.outcome, 'locked'); assert.equal(p.photos, 1);
  assert.deepEqual(m.log.photos(id).map((x) => x.src), [jpeg('SGVsbG8=')]);
  assert.match(m.log.describe(p), /^Someone I do not recognise was at your Mac at .* I took 1 picture\. I locked the screen after 20 seconds\.$/);
  assert.deepEqual(Object.keys(m.log.list()[0]).sort(), ['at', 'id', 'label', 'outcome', 'photos', 'reviewed', 'sameAs', 'seconds'], 'the list never exposes file names or face numbers');
});

test('only real small JPEGs for a known, still-open visit are kept, at most three, and a failing keychain keeps nothing', () => {
  const m = make(); const id = m.log.begin(20);
  assert.equal(m.log.addShot('nope', { jpeg: jpeg() }), false);
  for (const bad of ['', 'data:image/png;base64,AAAA', 'data:text/html;base64,AAAA', 'AAAA', jpeg('A'.repeat(900000))]) assert.equal(m.log.addShot(id, { jpeg: bad }), false, bad.slice(0, 30));
  for (let i = 0; i < 3; i++) assert.equal(m.log.addShot(id, { jpeg: jpeg() }), true);
  assert.equal(m.log.addShot(id, { jpeg: jpeg() }), false, 'a fourth picture is not kept'); assert.equal(m.files.size, 3);
  const broken = make({ encrypt: () => { throw Error('keychain locked'); } }); const b = broken.log.begin(20);
  assert.equal(broken.log.addShot(b, { jpeg: jpeg() }), false); assert.equal(broken.files.size, 0); assert.equal(broken.log.list()[0].photos, 0);
});

test('a visit that took no picture is dropped, and visits already told about are not told again', () => {
  const m = make(); const a = m.log.begin(20); m.log.finish(a, 'locked'); assert.deepEqual(m.log.list(), [], 'no pictures: nothing to tell');
  const b = m.log.begin(20); m.log.addShot(b, { jpeg: jpeg() }); m.log.finish(b, 'owner-returned');
  assert.equal(m.log.pending().length, 1); m.log.markReviewed([b]); assert.deepEqual(m.log.pending(), []); assert.equal(m.log.list().length, 1, 'still in the log');
  m.log.finish(b, 'locked'); assert.equal(m.log.list()[0].outcome, 'owner-returned', 'an outcome is set once');
});

test('the same face coming back is recognised as an earlier visit, and a name you gave carries over (but a different face does not match)', () => {
  const m = make();
  const first = m.log.begin(20); m.log.addShot(first, { jpeg: jpeg(), embeddings: [face(1)] }); m.log.finish(first, 'locked');
  assert.equal(m.log.setLabel(first, '  Alex  '), true); assert.equal(m.log.list().find((r) => r.id === first).label, 'Alex');
  m.advance(86400000);
  const again = m.log.begin(20); m.log.addShot(again, { jpeg: jpeg(), embeddings: [near(face(1))] }); m.log.finish(again, 'owner-returned');
  const r = m.log.list().find((x) => x.id === again); assert.equal(r.sameAs, first); assert.equal(r.label, 'Alex');
  assert.match(m.log.describe(m.log.pending().find((x) => x.id === again)), /^Alex \(a face you named\) was at your Mac /);
  const other = m.log.begin(20); m.log.addShot(other, { jpeg: jpeg(), embeddings: [face(40)] }); assert.equal(m.log.list().find((x) => x.id === other).sameAs, null);
  const unnamed = make(); const u1 = unnamed.log.begin(20); unnamed.log.addShot(u1, { jpeg: jpeg(), embeddings: [face(2)] }); unnamed.log.finish(u1, 'locked');
  const u2 = unnamed.log.begin(20); unnamed.log.addShot(u2, { jpeg: jpeg(), embeddings: [near(face(2))] }); unnamed.log.finish(u2, 'locked');
  assert.match(unnamed.log.describe(unnamed.log.pending().find((x) => x.id === u2)), /^Someone I have seen before was at your Mac /);
  assert.equal(m.log.setLabel('missing', 'x'), false); assert.equal(m.log.setLabel(first, 'a'.repeat(100)), true); assert.equal(m.log.list().find((x) => x.id === first).label.length, 40);
});

test('removing a visit deletes its pictures and the links to it; clearing removes everything; old and surplus visits are pruned', () => {
  const m = make({ max: 3 });
  const ids = []; for (let i = 0; i < 3; i++) { const id = m.log.begin(20); m.log.addShot(id, { jpeg: jpeg(), embeddings: [face(i === 2 ? 1 : i * 9)] }); m.log.finish(id, 'locked'); ids.push(id); m.advance(1000); }
  assert.equal(m.files.size, 3); assert.equal(m.log.list().find((r) => r.id === ids[2]).sameAs, ids[0], 'the third is the same face as the first');
  assert.equal(m.log.remove(ids[0]), true); assert.equal(m.files.size, 2); assert.equal(m.log.list().find((r) => r.id === ids[2]).sameAs, null, 'the link to a deleted visit is dropped'); assert.equal(m.log.remove(ids[0]), false);
  const extra = m.log.begin(20); m.log.addShot(extra, { jpeg: jpeg() }); m.log.finish(extra, 'locked');
  const fourth = m.log.begin(20); m.log.addShot(fourth, { jpeg: jpeg() }); assert.equal(m.log.list().length, 3, 'only the newest three are kept with max 3'); assert.equal(m.files.size, 3);
  const old = make({ keepDays: 60 }); const o = old.log.begin(20); old.log.addShot(o, { jpeg: jpeg() }); old.advance(61 * 86400000); old.log.begin(20);
  assert.ok(!old.log.list().some((r) => r.id === o), 'a visit older than 60 days is gone, with its picture'); assert.equal(old.files.size, 0);
  m.log.clear(); assert.deepEqual(m.log.list(), []); assert.equal(m.files.size, 0);
});

test('a visit is described in plain words for each way it ended', () => {
  const m = make(); const id = m.log.begin(30); m.log.addShot(id, { jpeg: jpeg() }); m.log.addShot(id, { jpeg: jpeg() });
  const e = (outcome) => ({ ...m.log.list()[0], outcome });
  assert.match(m.log.describe(e('owner-returned')), /I took 2 pictures\. The alarm stopped when you came back\.$/);
  assert.match(m.log.describe(e('fingerprint')), /You stopped it with your fingerprint\.$/); assert.match(m.log.describe(e('trusted')), /A trusted person arrived/);
  assert.match(m.log.describe(e('locked')), /locked the screen after 30 seconds/);
  m.advance(2 * 86400000); assert.match(m.log.describe({ ...e('ended'), at: m.now() - 2 * 86400000 }), /was at your Mac on \w+ at /, 'an older visit names its day');
});

test('the pictures window answers only its own window, and deleting a visit asks the Mac owner to confirm first and deletes nothing if they do not', async () => {
  const Module = require('module'), orig = Module._load, handlers = new Map();
  Module._load = function (req, ...a) { return req === 'electron' ? { BrowserWindow: class {}, screen: {}, ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) } } : orig.call(this, req, ...a); };
  let IntrudersWindow; try { ({ IntrudersWindow } = require('../src/main/intrudersWindow')); } finally { Module._load = orig; }
  const m = make(); const id = m.log.begin(20); m.log.addShot(id, { jpeg: jpeg() }); m.log.finish(id, 'locked');
  let allow = false; const asked = []; let changed = 0;
  const w = new IntrudersWindow({ log: m.log, authorize: async () => { asked.push(1); if (!allow) throw Error('Mac owner authentication was cancelled or unavailable.'); }, onChange: () => changed++ });
  const mine = { sender: { id: 'mine' } }, other = { sender: { id: 'other' } };
  w.win = { isDestroyed: () => false, webContents: mine.sender };
  const call = (ch, e, ...a) => handlers.get(ch)(e, ...a);
  assert.equal((await call('intruders:list', mine)).visits.length, 1);
  assert.match((await call('intruders:list', other)).error, /Open the intruder pictures first/); assert.match((await call('intruders:photos', other, id)).error, /Open/); assert.match((await call('intruders:remove', other, id)).error, /Open/);
  assert.deepEqual(asked, [], 'a window that is not ours does not even trigger the confirmation');
  assert.equal((await call('intruders:photos', mine, id)).photos.length, 1);
  const refused = await call('intruders:remove', mine, id); assert.match(refused.error, /cancelled or unavailable/); assert.equal(m.log.list().length, 1, 'not confirmed: nothing deleted'); assert.equal(m.files.size, 1);
  allow = true; assert.deepEqual(await call('intruders:remove', mine, id), { ok: true }); assert.equal(m.log.list().length, 0); assert.equal(m.files.size, 0); assert.equal(changed, 1);
  const id2 = m.log.begin(20); m.log.addShot(id2, { jpeg: jpeg() }); m.log.finish(id2, 'locked');
  assert.deepEqual(await call('intruders:label', mine, id2, 'Sam'), { ok: true }); assert.equal(m.log.list()[0].label, 'Sam');
});
