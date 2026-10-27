const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planDownloads, nightlyDue, dayKey } = require('../src/main/drive/nightly');
const { Drive } = require('../src/main/drive');
const { parseQuick, runQuick } = require('../src/main/quick');

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-night-'));
  const old = Date.now() - 24 * 3600 * 1000;
  const w = (rel, { age = old } = {}) => { const p = path.join(home, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); fs.utimesSync(p, age / 1000, age / 1000); return p; };
  return { home, w };
}

test('the nightly plan sorts loose files by kind, and leaves alone folders, hidden files, partial downloads, brand new files and kinds it is unsure about', () => {
  const { home, w } = sandbox();
  w('Downloads/photo.jpg'); w('Downloads/invoice.pdf'); w('Downloads/song.mp3'); w('Downloads/clip.mov'); w('Downloads/data.xlsx'); w('Downloads/setup.dmg'); w('Downloads/essay.docx');
  w('Downloads/.hidden.jpg'); w('Downloads/big.crdownload'); w('Downloads/mystery.xyz'); w('Downloads/sub/inside.jpg');
  w('Downloads/new.png', { age: Date.now() - 600000 });
  const { raw, counts, left } = planDownloads({ fs, home });
  const dest = Object.fromEntries(raw.moves.map((m) => [path.basename(m.from), m.to_folder]));
  assert.deepEqual(dest, {
    'photo.jpg': '~/Pictures/Downloaded', 'invoice.pdf': '~/Documents/Downloaded/PDFs', 'song.mp3': '~/Music/Downloaded', 'clip.mov': '~/Movies/Downloaded',
    'data.xlsx': '~/Documents/Downloaded/Spreadsheets', 'setup.dmg': '~/Downloads/Archives and installers', 'essay.docx': '~/Documents/Downloaded/Documents'
  });
  assert.equal(left, 3, 'a partial download, a mystery file and the brand new one');
  assert.match(raw.note, /1 PDF/);
  assert.equal(counts.image, 1);
  const none = planDownloads({ fs, home: fs.mkdtempSync(path.join(os.tmpdir(), 'relay-empty-')) });
  assert.deepEqual(none.raw.moves, []);
});

test('it is due once a day after the set time, not before, not twice, and not far too late', () => {
  const cfg = { enabled: true, hour: 21, minute: 0, lastRun: '' };
  const at = (h, m = 0, d = 10) => new Date(2026, 9, d, h, m);
  assert.equal(nightlyDue(cfg, at(20, 59)), false);
  assert.equal(nightlyDue(cfg, at(21, 0)), true);
  assert.equal(nightlyDue(cfg, at(23, 30)), true, 'a Mac that woke later still gets it');
  assert.equal(nightlyDue({ ...cfg, lastRun: dayKey(at(21))}, at(22)), false, 'already done today');
  assert.equal(nightlyDue({ ...cfg, enabled: false }, at(21, 5)), false);
  assert.equal(nightlyDue(cfg, at(12, 0, 11)), false, 'noon the next day is too late for last night, and too early for tonight');
});

function driveOn(home) {
  const cards = []; const trashed = []; let logged = [];
  const d = new Drive({ fs, home, exec: async () => '', cards: { show: async (c) => { cards.push(c); }, hide: () => cards.push('hidden') }, trashItem: async (p) => { trashed.push(p); }, log: { read: () => logged, write: (l) => { logged = l; } } });
  return { d, cards, trashed };
}

test('tonight\'s plan is shown with nothing moved, waits for a yes, applies on request, and can be skipped for good', async () => {
  const { home, w } = sandbox();
  const photo = w('Downloads/photo.jpg'), pdf = w('Downloads/invoice.pdf');
  const { d, cards } = driveOn(home);
  const r = await d.proposeDownloads();
  assert.equal(r.moves, 2);
  assert.ok(fs.existsSync(photo) && fs.existsSync(pdf), 'nothing moved yet');
  assert.equal(cards[0].hold, true);
  assert.match(cards[0].summary, /apply the plan/);
  // skipping remembers: tomorrow night's plan does not offer them again
  assert.match(d.skipDownloads(), /Skipped/);
  assert.equal((await d.proposeDownloads()).moves, 0);
  assert.match(d.skipDownloads(), /no downloads plan/);
  // a fresh one: apply
  const again = driveOn(home);
  const r2 = await again.d.proposeDownloads();
  assert.equal(r2.moves, 2);
  assert.match(await again.d.applyDownloads(), /Moved 2/);
  assert.ok(!fs.existsSync(photo) && fs.existsSync(path.join(home, 'Pictures/Downloaded/photo.jpg')));
  assert.match(await again.d.applyDownloads(), /no downloads plan waiting/, 'a plan is used once');
  assert.match(await again.d.undo(), /Put 2 back/);
  assert.ok(fs.existsSync(photo));
});

test('spoken: "apply the plan", "skip the plan", "tidy my downloads"', async () => {
  for (const [t, type] of [['apply the plan', 'downloads-apply'], ['yes apply the downloads plan', 'downloads-apply'], ['go ahead with the plan', 'downloads-apply'], ['do tonight\'s tidy', 'downloads-apply'], ['skip the plan', 'downloads-skip'], ['dismiss the downloads plan', 'downloads-skip'], ['tidy my downloads', 'downloads-plan'], ['organize the downloads folder', 'downloads-plan']]) assert.equal(parseQuick(t)?.type, type, t);
  assert.notEqual(parseQuick('cancel the timer')?.type, 'downloads-skip');
  const calls = [];
  const ctx = { downloads: { apply: async () => 'Moved 2.', skip: () => 'Skipped.', plan: async () => 'Plan.' } };
  assert.equal((await runQuick(parseQuick('apply the plan'), {}, ctx)).reply, 'Moved 2.');
  assert.equal((await runQuick(parseQuick('skip the plan'), {}, ctx)).reply, 'Skipped.');
  assert.equal(await runQuick(parseQuick('apply the plan'), {}, {}), null, 'without the Drive it is left to the model');
  assert.deepEqual(calls, []);
});
