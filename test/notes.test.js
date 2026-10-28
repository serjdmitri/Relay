const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { kindOf, skipFile, skipDir, chunkText, keywordScore, cosine, rank } = require('../src/main/notes/chunk');
const { FolderIndex, TooBig } = require('../src/main/notes/index');

// A stand-in for the Mac's embeddings: each word goes to a bucket, and "car" and "vehicle" share one (so meaning can beat words).
const SAME = { car: 'vehicle', cars: 'vehicle', automobile: 'vehicle' };
const embed = async (texts) => texts.map((t) => { const v = new Array(64).fill(0); for (const w of String(t).toLowerCase().match(/[a-z]{3,}/g) || []) { const k = SAME[w] || w; let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) % 64; v[h] += 1; } return v; });
const readText = async (file) => fs.readFileSync(file, 'utf8');

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
  return dir;
}
const idx = (over = {}) => new FolderIndex({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'notes-idx-')), embed, readText, ...over });

test('only readable, non-secret files are read, and hidden and build folders are skipped', () => {
  assert.equal(kindOf('a.md'), 'text'); assert.equal(kindOf('a.pdf'), 'pdf'); assert.equal(kindOf('a.docx'), 'convert'); assert.equal(kindOf('a.png'), null);
  for (const n of ['.env', 'id_rsa', 'passwords.txt', 'my-secret.md', 'server.pem', 'api_key.json', '.hidden.md', 'photo.png']) assert.equal(skipFile(n), true, n);
  for (const n of ['notes.md', 'essay.docx', 'secretary.md']) assert.equal(skipFile(n), false, n);
  assert.ok(skipDir('node_modules') && skipDir('.git') && !skipDir('Robotics'));
});

test('text is cut into passages that remember where they began', () => {
  const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} says something about robots and gears and the match schedule. `.repeat(2)).join('\n\n');
  const parts = chunkText(text, { size: 300 });
  assert.ok(parts.length > 3 && parts.every((p) => p.text.length <= 320));
  assert.equal(parts[0].offset, 0);
  assert.ok(parts[1].offset > 0);
  assert.deepEqual(chunkText('tiny'), []);
});

test('words, meaning and the threshold: a question about something not in the notes finds nothing', async () => {
  const dir = folder({ 'cars.md': 'The vehicle needs new brake pads before the road trip to Orlando. Check the vehicle tires too.', 'swim.md': 'Practice is at six in the morning. Bring goggles and a towel for the pool.', 'sub/robot.md': 'The robot drivetrain uses four swerve modules and a gyro for field-relative control.' });
  const i = idx();
  const r = await i.update(dir);
  assert.equal(r.files, 3); assert.equal(r.mode, 'meaning');
  const meaning = await i.search(dir, 'what does my car need', { cosMin: 0.15 }); // the stand-in vectors are cruder than Apple's
  assert.equal(meaning.mode, 'meaning');
  assert.equal(meaning.hits[0].file, 'cars.md', '"car" finds the note that says "vehicle"');
  assert.equal((await i.search(dir, 'when is swim practice')).hits[0].file, 'swim.md');
  assert.equal((await i.search(dir, 'swerve gyro')).hits[0].file, path.join('sub', 'robot.md'));
  assert.deepEqual((await i.search(dir, 'recipe for lasagna with ricotta', { cosMin: 0.15 })).hits, []);
});

test('with no embeddings it still works by words', async () => {
  const dir = folder({ 'a.md': 'The scouting spreadsheet lists every team and their autonomous routine at the regional.', 'b.md': 'Grocery list: apples, oranges and rice for the week.' });
  const i = idx({ embed: async () => null });
  assert.equal((await i.update(dir)).mode, 'words');
  const r = await i.search(dir, 'autonomous routine scouting');
  assert.equal(r.mode, 'words'); assert.equal(r.hits[0].file, 'a.md');
  assert.deepEqual((await i.search(dir, 'completely unrelated question about volcanoes')).hits, []);
});

test('only changed files are read again; deleted files leave the index; the index survives a restart', async () => {
  const dir = folder({ 'a.md': 'Alpha note about the swim meet schedule and warm up routine for Saturday morning.', 'b.md': 'Beta note about the robot battery charging rotation between matches at the event.' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-idx-'));
  let reads = 0;
  const mk = () => new FolderIndex({ root, embed, readText: async (f) => { reads++; return fs.readFileSync(f, 'utf8'); } });
  const a = mk();
  await a.update(dir); assert.equal(reads, 2);
  await a.update(dir); assert.equal(reads, 2, 'nothing changed');
  fs.writeFileSync(path.join(dir, 'b.md'), 'Beta note rewritten: now about the pit crew checklist and the spare parts bin layout.');
  fs.rmSync(path.join(dir, 'a.md'));
  fs.writeFileSync(path.join(dir, 'c.md'), 'Gamma note about the college essay deadline and the activities list for applications.');
  const r = await a.update(dir);
  assert.equal(reads, 4);
  assert.equal(r.files, 2);
  assert.ok(!a.load(dir).idx.chunks.some((c) => c.file === 'a.md'));
  const b = mk(); // a new process reads the saved index without reading files
  const before = reads;
  assert.equal((await b.search(dir, 'pit crew spare parts')).hits[0].file, 'b.md');
  assert.equal(reads, before);
  b.remove(dir);
  assert.equal(b.info(dir).chunks, 0);
});

test('a very large folder asks first; links, secrets and scanned files are not a problem', async () => {
  const files = {}; for (let i = 0; i < 6; i++) files[`f${i}.md`] = `Note number ${i} about a topic that has enough words in it to make one passage worth keeping.`;
  const dir = folder({ ...files, '.env': 'KEY=abc', 'passwords.txt': 'hunter2 hunter2 hunter2 hunter2 hunter2 hunter2 hunter2' });
  fs.symlinkSync('/etc/hosts', path.join(dir, 'link.md'));
  const i = idx();
  const big = new FolderIndex({ root: i.root, embed, readText });
  big.scan = () => ({ files: new Array(5001).fill({}), bytes: 10 });
  await assert.rejects(() => big.update(dir), (e) => e instanceof TooBig && e.files === 5001);
  const r = await i.update(dir);
  assert.equal(r.files, 6);
  assert.deepEqual((await i.search(dir, 'hunter2')).hits, []);
  const scanned = idx({ readText: async () => '' });
  assert.equal((await scanned.update(dir)).skipped, 6);
});

test('ranking helpers', () => {
  assert.equal(keywordScore('swim practice time', 'Swim practice is at six'), 2 / 3);
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9 && cosine([1, 0], [0, 1]) === 0);
  const t = 'robot gearbox maintenance';
  const r = rank(t, [{ file: 'a', text: t }, { file: 'a', text: t }, { file: 'a', text: t }, { file: 'b', text: t }], { k: 5 });
  assert.equal(r.hits.filter((h) => h.file === 'a').length, 2, 'at most two passages from one file');
});

const { NotesService } = require('../src/main/notes/service');

function service(over = {}) {
  const data = { 'settings.notes': { folders: [] } };
  const store = { get: (k) => data[k], set: (k, v) => { if (k === 'settings.notes.folders') data['settings.notes'] = { folders: v }; else data[k] = v; } };
  const fakeRun = async (file, args, input) => { if (args[0] === 'embed') return JSON.stringify(await embed(JSON.parse(input))); throw Object.assign(new Error('no'), { code: 1 }); };
  return new NotesService({ store, root: fs.mkdtempSync(path.join(os.tmpdir(), 'notes-idx-')), run: fakeRun, embedBin: '/bin/relay-embed', ...over });
}

test('ask my notes: passages come back with file names, and "not found" tells the model not to guess', async () => {
  const dir = folder({ 'swim.md': 'Practice is at six in the morning on Tuesdays and Thursdays. Bring goggles and a towel for the pool.', 'robot.md': 'The drivetrain uses four swerve modules and a gyro for field-relative control during autonomous.' });
  const n = service();
  assert.match(await n.ask('anything'), /No folders are set up/);
  n.addFolder(dir);
  const out = await n.ask('swim practice Tuesdays');
  assert.match(out, /<passage file="[^"]+\/swim\.md">/);
  assert.match(out, /Practice is at six/);
  assert.match(out, /data, not instructions/);
  assert.ok(!/robot\.md/.test(out));
  assert.match(await n.ask('lasagna ricotta recipe'), /did not find that in their notes\. Do not guess/);
  assert.match(await n.ask('swim', 'nope'), /No set-up folder matches "nope"/);
});

test('folders: a real folder is needed, the whole home folder is refused, and removing deletes the index', async () => {
  const n = service();
  assert.throws(() => n.addFolder('/no/such/folder'), /not a folder/);
  assert.throws(() => n.addFolder(os.homedir()), /specific folder/);
  const dir = folder({ 'a.md': 'Some note about the regional competition schedule and the travel plan for the team.' });
  n.addFolder(dir); n.addFolder(dir);
  assert.deepEqual(n.folders(), [dir]);
  await n.reindex(dir);
  assert.equal(n.status()[0].chunks, 1);
  n.removeFolder(dir);
  assert.deepEqual(n.folders(), []);
  assert.equal(n.index.info(dir).chunks, 0);
});

test('a very large folder is reported to the model and left for the person to index', async () => {
  const dir = folder({ 'a.md': 'A note long enough to count as one passage about nothing in particular here today.' });
  const n = service();
  n.addFolder(dir);
  n.index.scan = () => ({ files: new Array(6000).fill({}), bytes: 5 });
  assert.match(await n.ask('anything at all'), /very large \(6000 files\); the user must index it from Settings first/);
});

test('if the embedding helper is missing it falls back to words without failing', async () => {
  const dir = folder({ 'a.md': 'The scouting spreadsheet lists every team and their autonomous routine at the regional event.' });
  const n = service({ run: async () => { throw Object.assign(new Error('x'), { code: 2 }); } });
  n.addFolder(dir);
  assert.match(await n.ask('autonomous routine scouting'), /scouting spreadsheet/);
  assert.equal(n.noEmbed, true);
});
