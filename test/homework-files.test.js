const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HomeworkDocs, safeName, safeRel } = require('../src/main/homeworkFiles');

function rig(over = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-'));
  const opened = [], revealed = [], execs = [];
  const docs = new HomeworkDocs({
    home, now: () => new Date(2026, 9, 28),
    exec: async (cmd, args) => { execs.push([cmd, args]); if (over.noWord) throw new Error('textutil failed'); fs.writeFileSync(args[args.indexOf('-output') + 1], 'DOCX'); },
    renderPdf: async (html, out) => { if (over.noPdf) throw new Error('no window'); fs.writeFileSync(out, `%PDF ${html.length}`); },
    openPath: async (p) => { opened.push(p); }, revealPath: async (p) => { revealed.push(p); }
  });
  return { docs, home, opened, revealed, execs };
}

test('names from the model are made safe', () => {
  assert.equal(safeName('Essay: "Androids" / Rights?'), 'Essay Androids Rights');
  assert.equal(safeName('../../etc/passwd'), 'etc passwd');
  assert.equal(safeName(''), 'Homework');
  assert.equal(safeRel('src/main.py'), 'src/main.py');
  assert.equal(safeRel('./README.md'), 'README.md');
  for (const bad of ['../x.py', '/etc/passwd', 'a/../../b', 'a/b/c/d/e.py', 'bad\u0000name', '', '.', '..', 'a/./..']) assert.equal(safeRel(bad), null, bad);
});

test('a document becomes a Word file in Documents/Relay Homework, opens, and is never overwritten', async () => {
  const r = rig();
  const a = await r.docs.saveDocument({ title: 'Gatsby Essay', markdown: '# Hi\n\nText', format: 'docx' });
  assert.equal(a.path, path.join(r.home, 'Documents', 'Relay Homework', 'Gatsby Essay 2026-10-28.docx'));
  assert.equal(a.format, 'docx');
  assert.equal(fs.readFileSync(a.path, 'utf8'), 'DOCX');
  assert.deepEqual(r.execs[0][0], '/usr/bin/textutil');
  assert.deepEqual(r.opened, [a.path]);
  const b = await r.docs.saveDocument({ title: 'Gatsby Essay', markdown: 'again', format: 'docx' });
  assert.ok(b.path.endsWith('Gatsby Essay 2026-10-28 (2).docx'), 'a taken name gets (2)');
  assert.equal(fs.readFileSync(a.path, 'utf8'), 'DOCX', 'the first is untouched');
});

test('PDF and plain text work, and when a format cannot be made the next best one is', async () => {
  const r = rig();
  assert.equal((await r.docs.saveDocument({ title: 'T', markdown: 'x', format: 'pdf' })).format, 'pdf');
  assert.equal((await r.docs.saveDocument({ title: 'T', markdown: '# x', format: 'md' })).format, 'md');
  const noWord = rig({ noWord: true });
  const w = await noWord.docs.saveDocument({ title: 'T', markdown: 'x', format: 'docx' });
  assert.equal(w.format, 'pdf');
  assert.match(w.note, /docx version could not be made/);
  const none = rig({ noWord: true, noPdf: true });
  assert.equal((await none.docs.saveDocument({ title: 'T', markdown: 'x', format: 'docx' })).format, 'md');
  await assert.rejects(() => r.docs.saveDocument({ title: 'T', markdown: '  ' }), /nothing to save/);
  await assert.rejects(() => r.docs.saveDocument({ title: 'T', markdown: 'x'.repeat(700000) }), /too long/);
});

test('code goes into a new folder of checked files and nothing outside it is touched', async () => {
  const r = rig();
  const out = await r.docs.saveFiles({ folder: 'Linked List Lab', files: [{ name: 'main.py', content: 'print(1)\n' }, { name: 'tests/test_main.py', content: 'assert True\n' }, { name: 'README.md', content: '# Lab' }] });
  assert.equal(out.path, path.join(r.home, 'Documents', 'Relay Homework', 'Linked List Lab'));
  assert.deepEqual(out.files, ['main.py', 'tests/test_main.py', 'README.md']);
  assert.equal(fs.readFileSync(path.join(out.path, 'tests', 'test_main.py'), 'utf8'), 'assert True\n');
  assert.deepEqual(r.revealed, [out.path]);
  const again = await r.docs.saveFiles({ folder: 'Linked List Lab', files: [{ name: 'main.py', content: 'new' }] });
  assert.ok(again.path.endsWith('Linked List Lab (2)'), 'an existing project is never touched');
  assert.equal(fs.readFileSync(path.join(out.path, 'main.py'), 'utf8'), 'print(1)\n');
  await assert.rejects(() => r.docs.saveFiles({ folder: 'x', files: [{ name: '../escape.py', content: 'x' }] }), /not a file name/);
  await assert.rejects(() => r.docs.saveFiles({ folder: 'x', files: [{ name: '/abs.py', content: 'x' }] }), /not a file name/);
  await assert.rejects(() => r.docs.saveFiles({ folder: 'x', files: [{ name: 'a.py', content: 'x' }, { name: 'A.py', content: 'y' }] }), /same name/);
  await assert.rejects(() => r.docs.saveFiles({ folder: 'x', files: [] }), /no files/);
  await assert.rejects(() => r.docs.saveFiles({ folder: 'x', files: Array.from({ length: 41 }, (_, i) => ({ name: `f${i}.py`, content: '' })) }), /too many/);
  await assert.rejects(() => r.docs.saveFiles({ folder: 'x', files: [{ name: 'big.py', content: 'x'.repeat(400000) }] }), /too long/);
  assert.ok(!fs.existsSync(path.join(r.home, 'Documents', 'escape.py')) && !fs.existsSync(path.join(r.home, 'Documents', 'Relay Homework', 'escape.py')));
});
