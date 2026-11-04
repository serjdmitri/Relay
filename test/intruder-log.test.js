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
  assert.deepEqual(Object.keys(m.log.list()[0]).sort(), ['at', 'auto', 'id', 'label', 'outcome', 'photos', 'question', 'reviewed', 'sameAs', 'seconds'], 'the list never exposes file names or face numbers');
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
  const r = m.log.list().find((x) => x.id === again); assert.equal(r.sameAs, first); assert.equal(r.label, '', 'linked as seen before, but not named by itself: one naming is not enough to assume');
  assert.match(m.log.describe(m.log.pending().find((x) => x.id === again)), /^Someone I have seen before was at your Mac /);
  m.log.setLabel(again, 'Alex'); assert.match(m.log.describe(m.log.list().find((x) => x.id === again)), /^Alex \(a face you named\) was at your Mac /);
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

// ---- learning the people you name ----
const visit = (m, emb, outcome = 'owner-returned') => { m.advance(3600000); const id = m.log.begin(20); m.log.addShot(id, { jpeg: jpeg(), embeddings: [emb] }); m.log.finish(id, outcome); return id; };
const row = (m, id) => m.log.list().find((r) => r.id === id);

test('naming a visit twice teaches a face; after that a matching visit is suggested by name (not assumed), and a face you never named is not', () => {
  const m = make(); const alex = face(1);
  const v1 = visit(m, alex); m.log.setLabel(v1, 'Alex'); assert.deepEqual(m.log.people().map((p) => [p.name, p.confirmed, p.learned]), [['Alex', 1, false]]);
  const v2 = visit(m, near(alex)); assert.equal(row(m, v2).question, null, 'one naming is not enough to suggest anything');
  m.log.setLabel(v2, 'Alex'); assert.equal(m.log.people()[0].confirmed, 2);
  const v3 = visit(m, near(near(alex))); const r3 = row(m, v3);
  assert.equal(r3.question.name, 'Alex'); assert.equal(r3.label, '', 'asked, not assumed'); assert.equal(r3.auto, false);
  assert.match(m.log.describe(m.log.pending().find((x) => x.id === v3)), /^Someone who looks like Alex was at your Mac /);
  assert.equal(m.log.pendingQuestion().id, v3);
  const stranger = visit(m, face(40)); assert.equal(row(m, stranger).question, null, 'a different face is not offered as Alex');
  assert.equal(m.log.people()[0].faces, 1, 'a near copy of a face already kept adds no new face');
});

test('each yes teaches the face and extends a streak, three in a row make the person learned, and then visits are named without asking', () => {
  const m = make(); const alex = face(1);
  m.log.setLabel(visit(m, alex), 'Alex'); m.log.setLabel(visit(m, near(alex)), 'Alex');
  let last;
  for (let i = 1; i <= 3; i++) {
    const v = visit(m, near(alex).map((x, k) => x + 0.01 * Math.sin(k + i))); assert.equal(row(m, v).question.name, 'Alex', `visit ${i} is asked`);
    const a = m.log.answer(v, true); assert.deepEqual([a.yes, a.name, a.learned, a.streak], [true, 'Alex', i === 3, i]); assert.equal(row(m, v).label, 'Alex'); assert.equal(row(m, v).question, null); last = v;
  }
  assert.equal(m.log.people()[0].learned, true);
  const auto = visit(m, near(alex).map((x, k) => x + 0.012 * Math.cos(k)));
  assert.equal(row(m, auto).label, 'Alex'); assert.equal(row(m, auto).auto, true); assert.equal(row(m, auto).question, null);
  assert.match(m.log.describe(m.log.pending().find((x) => x.id === auto)), /^Alex \(I recognised the face from earlier visits\) was at your Mac /);
  assert.equal(m.log.answer(last, true), null, 'a question can only be answered once');
});

test('a no teaches it that face is not them, resets what it learned, and it is never offered as them again; other faces still are', () => {
  const m = make(); const alex = face(1);
  m.log.setLabel(visit(m, alex), 'Alex'); m.log.setLabel(visit(m, near(alex)), 'Alex');
  const ok = visit(m, near(alex)); m.log.answer(ok, true);
  const lookalike = alex.map((x, k) => x + 0.3 * Math.sin(k * 1.3)); // alike enough to be suggested the first time, but not the same face
  const bad = visit(m, lookalike); assert.equal(row(m, bad).question.name, 'Alex');
  assert.deepEqual(m.log.answer(bad, false), { ok: true, yes: false, name: 'Alex' }); assert.equal(row(m, bad).label, ''); assert.equal(row(m, bad).question, null);
  assert.deepEqual(m.log.people().map((p) => [p.learned, p.confirmed]), [[false, 3]]);
  const again = visit(m, lookalike); assert.equal(row(m, again).question, null, 'the same face is not offered as Alex again');
  const real = visit(m, near(alex)); assert.equal(row(m, real).question?.name, 'Alex', 'but Alex himself still is');
});

test('two different people are told apart, an unclear match is not offered, and a person can be forgotten (their labels go with them)', () => {
  const m = make(); const a = face(1), b = face(2.6); // two clearly different faces
  for (const e of [a, near(a)]) m.log.setLabel(visit(m, e), 'Alex'); for (const e of [b, near(b)]) m.log.setLabel(visit(m, e), 'Sam');
  assert.equal(row(m, visit(m, near(a))).question.name, 'Alex'); assert.equal(row(m, visit(m, near(b))).question.name, 'Sam');
  const blend = visit(m, a.map((x, i) => (x + b[i]) / 2)); const q = row(m, blend).question; assert.ok(!q || q.score >= 0.45, 'a face between two people is not offered unless one clearly leads');
  assert.equal(m.log.forgetPerson('alex'), true); assert.deepEqual(m.log.people().map((p) => p.name), ['Sam']);
  assert.ok(m.log.list().every((r) => r.label !== 'Alex'), 'visits named Alex lose the name'); assert.equal(m.log.forgetPerson('nobody'), false);
  const raw = JSON.stringify(m.data.intruderPeople); assert.ok(!/\[\s*-?0\.\d+/.test(raw), 'the saved people hold no readable face numbers, only the encrypted blob');
});

test('a plain yes, no, or name is understood, and ordinary words are not taken for one', () => {
  const { parseNamingAnswer: p } = require('../src/main/intruderLog');
  for (const t of ['yes', 'Yeah.', 'yep that is him', 'yes please', "yes, that's him", 'correct', "that's him", 'right']) assert.deepEqual(p(t), { yes: true }, t);
  for (const t of ['no', 'Nope', 'nah', "that's not him", 'not them', 'wrong']) assert.deepEqual(p(t), { yes: false }, t);
  assert.deepEqual(p("no, it's Sam"), { yes: false, name: 'Sam' }); assert.deepEqual(p("that's Alex"), { name: 'Alex' }); assert.deepEqual(p('Jarvis, it was my cousin Dan.'), { name: 'my cousin Dan' });
  for (const t of ["it's fine", "that's okay", "it's me", 'what time is it', 'open the calendar', 'yes and no', '', null]) assert.equal(p(t), null, String(t));
});

test('the viewer answers a suggestion and forgets a person only for its own window, and forgetting asks the Mac owner first', async () => {
  const Module = require('module'), orig = Module._load, handlers = new Map();
  Module._load = function (req, ...a) { return req === 'electron' ? { BrowserWindow: class {}, screen: {}, ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) } } : orig.call(this, req, ...a); };
  delete require.cache[require.resolve('../src/main/intrudersWindow')]; // a fresh copy, wired to this test's own handlers
  let IntrudersWindow; try { ({ IntrudersWindow } = require('../src/main/intrudersWindow')); } finally { Module._load = orig; }
  const m = make(); const alex = face(1);
  m.log.setLabel(visit(m, alex), 'Alex'); m.log.setLabel(visit(m, near(alex)), 'Alex'); const v = visit(m, near(alex));
  let allow = false; const asked = []; const w = new IntrudersWindow({ log: m.log, authorize: async () => { asked.push(1); if (!allow) throw Error('cancelled'); } });
  const mine = { sender: { id: 1 } }, other = { sender: { id: 2 } }; w.win = { isDestroyed: () => false, webContents: mine.sender };
  const call = (ch, e, ...a) => handlers.get(ch)(e, ...a);
  assert.deepEqual((await call('intruders:list', mine)).people.map((p) => p.name), ['Alex']); assert.equal((await call('intruders:list', mine)).visits.find((x) => x.id === v).question.name, 'Alex');
  assert.match((await call('intruders:answer', other, v, true)).error, /Open/); assert.match((await call('intruders:forget', other, 'x')).error, /Open/); assert.deepEqual(asked, []);
  const yes = await call('intruders:answer', mine, v, true); assert.equal(yes.ok, true); assert.equal(yes.result.name, 'Alex'); assert.equal(row(m, v).label, 'Alex');
  const id = (await call('intruders:list', mine)).people[0].id;
  assert.match((await call('intruders:forget', mine, id)).error, /cancelled/); assert.equal(m.log.people().length, 1, 'not confirmed: still known');
  allow = true; assert.deepEqual(await call('intruders:forget', mine, id), { ok: true }); assert.equal(m.log.people().length, 0);
});

test('main asks about a visitor who looks like someone named, takes the answer, and the commands exist', () => {
  const fs = require('node:fs'), path = require('node:path'), main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8'), ask = fs.readFileSync(path.join(__dirname, '../src/main/askController.js'), 'utf8');
  const { parseOwnerCommand } = require('../src/main/ownerGuard');
  assert.match(main, /Is that \$\{q\.name\}\? Say yes or no\./); assert.match(main, /ask\.pendingNaming = \{ visitId: newest\.id, at: Date\.now\(\), question: !!q \}/);
  assert.match(main, /ask\.onNamingAnswer = async \(\{ yes, name \}\) =>/); assert.match(main, /LEARN_STREAK - r\.streak/);
  assert.match(ask, /this\.pendingNaming && this\.onNamingAnswer && Date\.now\(\) - this\.pendingNaming\.at < 5 \* 60000/, 'a bare yes is only heard for five minutes after it asked');
  assert.match(main, /'looser','forget-person'\]\.includes\(c\.type\)/, 'forgetting a face asks the Mac owner first');
  assert.deepEqual(parseOwnerCommand('who do you know'), { type: 'people' }); assert.deepEqual(parseOwnerCommand("forget Alex's face"), { type: 'forget-person', name: 'Alex' });
  assert.deepEqual(parseOwnerCommand('forget the person called sam'), { type: 'forget-person', name: 'Sam' }); assert.deepEqual(parseOwnerCommand('forget my face'), { type: 'forget' });
});
