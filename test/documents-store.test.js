const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { DocumentStore, documentHtml, withPageBreaks } = require('../src/main/documents/store');

function rig(over = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-'));
  const calls = [], revealed = [], drawn = [];
  let t = 1000, n = 0;
  const store = new DocumentStore({
    home, now: () => (t += 10), id: () => `doc-0000000${++n}`,
    exec: async (cmd, args) => {
      calls.push([path.basename(cmd), args]);
      if (cmd.endsWith('textutil')) { if (over.noWord) throw new Error('textutil failed'); fs.writeFileSync(args[args.indexOf('-output') + 1], `DOCX:${fs.readFileSync(args.at(-1), 'utf8').length}`); return ''; }
      if (cmd.endsWith('unzip')) return '<w:document><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>';
      return '';
    },
    render: async (md) => { drawn.push(md); return { png: Buffer.from(`PNG:${md}`), overflow: md.length > 50 }; },
    reveal: async (p) => { revealed.push(p); }
  });
  return { store, home, calls, revealed, drawn };
}
const PAGES = ['# Cover letter\n\nDear Sir,\n\nI would like the job.', 'Page two text.', 'Page three text.'];

test('a document is a folder of its own with a Word file, and Finder is shown where it went', async () => {
  const r = rig();
  const d = await r.store.create({ title: 'Cover letter', pages: PAGES });
  assert.equal(d.id, 'doc-00000001');
  assert.equal(d.folder, path.join(r.home, 'Documents', 'Relay Documents', 'Cover letter'));
  assert.equal(d.docx, path.join(d.folder, 'Cover letter.docx'));
  assert.ok(fs.existsSync(d.docx));
  assert.equal(d.pages, 3);
  assert.equal(d.version, 1);
  assert.deepEqual(r.revealed, [d.docx]);
  assert.ok(fs.existsSync(path.join(d.folder, '.relay', 'versions', 'v1.json')));
  assert.ok(fs.existsSync(path.join(d.folder, '.relay', 'versions', 'v1.docx')));
  assert.deepEqual(r.calls.map((c) => c[0]), ['textutil', 'unzip', 'zip'], 'several pages need real page breaks put in afterwards');
});

test('a one page document needs no page-break step, and a second one with the same title gets its own folder', async () => {
  const r = rig();
  const a = await r.store.create({ title: 'Memo', pages: ['One page.'] });
  const b = await r.store.create({ title: 'Memo', pages: ['Another.'] });
  assert.deepEqual(r.calls.map((c) => c[0]), ['textutil', 'textutil']);
  assert.ok(b.folder.endsWith('Memo (2)'));
  assert.notEqual(a.id, b.id);
  assert.equal(r.store.all().length, 2);
});

test('unsafe titles cannot leave the documents folder', async () => {
  const r = rig();
  const d = await r.store.create({ title: '../../etc/passwd', pages: ['x'] });
  assert.equal(path.dirname(d.folder), path.join(r.home, 'Documents', 'Relay Documents'));
});

test('if the Word file cannot be made nothing is left half made as a document', async () => {
  const r = rig({ noWord: true });
  await assert.rejects(() => r.store.create({ title: 'Broken', pages: ['x'] }), /textutil failed/);
  assert.deepEqual(r.store.all(), []);
});

test('a document is found by its id, its title or words of it, and the latest when nothing is said', async () => {
  const r = rig();
  await r.store.create({ title: 'Cover letter', pages: ['a'] });
  const q = await r.store.create({ title: 'Quarterly sales report', pages: ['b'] });
  assert.equal(r.store.find('').id, q.id, 'the newest');
  assert.equal(r.store.find('the cover letter').title, 'Cover letter');
  assert.equal(r.store.find('sales report').title, 'Quarterly sales report');
  assert.equal(r.store.find('doc-00000001').title, 'Cover letter');
  assert.throws(() => r.store.find('wedding speech'), /could not find a document called "wedding speech"\. I have: Quarterly sales report, Cover letter/);
  assert.throws(() => rig().store.find(''), /no documents yet/);
});

test('reading a document gives numbered pages and paragraphs to edit by', async () => {
  const r = rig();
  await r.store.create({ title: 'Cover letter', pages: PAGES });
  const t = r.store.read('cover letter');
  assert.match(t.text, /Page 1:\n {2}\[1\] \(heading\) # Cover letter\n {2}\[2\] \(paragraph\) Dear Sir,\n {2}\[3\] \(paragraph\) I would like the job\./);
});

test('an edit is a new live version that waits for an answer, and shows what changed', async () => {
  const r = rig();
  await r.store.create({ title: 'Cover letter', pages: PAGES });
  const e = await r.store.edit('cover letter', [{ op: 'replace_paragraph', page: 1, paragraph: 3, text: 'I would love the job.' }]);
  assert.equal(e.version, 2);
  assert.equal(e.pending, true);
  assert.deepEqual(e.changes, [{ type: 'changed', page: 1, before: 'I would like the job.', after: 'I would love the job.' }]);
  const d = r.store.detail('cover letter');
  assert.equal(d.pending, true);
  assert.deepEqual(d.changes, e.changes);
  assert.match(d.pendingNote, /Changed paragraph 3 on page 1/);
  assert.deepEqual(d.versions.map((v) => [v.n, v.kind, v.status]), [[1, 'create', 'approved'], [2, 'edit', 'pending']]);
  assert.ok(r.store.read('cover letter').text.includes('I would love the job.'), 'the live pages are the new ones');
  assert.ok(fs.existsSync(path.join(e.folder, '.relay', 'versions', 'v1.json')), 'the old version is kept');
});

test('Reject puts the old pages back as a new version and keeps the rejected one in the history', async () => {
  const r = rig();
  const c = await r.store.create({ title: 'Cover letter', pages: PAGES });
  await r.store.edit('cover letter', [{ op: 'replace_page', page: 2, text: 'Rewritten.' }]);
  await r.store.edit('cover letter', [{ op: 'delete_page', page: 3 }]);
  const x = await r.store.review('cover letter', 'reject');
  assert.equal(x.pending, false);
  assert.equal(x.version, 4);
  assert.equal(x.pages, 3);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(c.folder, '.relay', 'versions', 'v4.json'), 'utf8')).pages, PAGES, 'both edits are undone, back to what was approved');
  assert.deepEqual(r.store.detail('cover letter').versions.map((v) => v.status), ['approved', 'rejected', 'rejected', 'approved']);
  assert.deepEqual(fs.readFileSync(path.join(c.folder, 'Cover letter.docx'), 'utf8'), fs.readFileSync(path.join(c.folder, '.relay', 'versions', 'v4.docx'), 'utf8'));
  await assert.rejects(() => r.store.review('cover letter', 'reject'), /no change waiting/);
});

test('Approve keeps the change and clears the waiting state', async () => {
  const r = rig();
  await r.store.create({ title: 'Cover letter', pages: PAGES });
  await r.store.edit('cover letter', [{ op: 'replace_page', page: 2, text: 'Rewritten.' }]);
  const x = await r.store.review('cover letter', 'approve');
  assert.equal(x.pending, false);
  assert.equal(x.version, 2);
  assert.deepEqual(r.store.detail('cover letter').versions.map((v) => v.status), ['approved', 'approved']);
  await assert.rejects(() => r.store.review('cover letter', 'maybe'), /no change waiting/);
});

test('an edit that changes nothing, or does not fit, makes no version', async () => {
  const r = rig();
  await r.store.create({ title: 'Cover letter', pages: PAGES });
  await assert.rejects(() => r.store.edit('cover letter', [{ op: 'replace_paragraph', page: 2, paragraph: 1, text: 'Page two text.' }]), /would not change anything/);
  await assert.rejects(() => r.store.edit('cover letter', [{ op: 'replace_paragraph', page: 7, paragraph: 1, text: 'x' }]), /no page 7/);
  assert.equal(r.store.detail('cover letter').version, 1);
});

test('pages move to the order dragged, as a new approved version, and are refused while a change waits', async () => {
  const r = rig();
  await r.store.create({ title: 'Cover letter', pages: PAGES });
  const m = await r.store.reorder('cover letter', [2, 0, 1]);
  assert.equal(m.version, 2);
  assert.equal(r.store.pagesOf(r.store.find('cover letter'))[0], 'Page three text.');
  assert.deepEqual(r.store.detail('cover letter').versions.map((v) => v.kind), ['create', 'reorder']);
  assert.equal((await r.store.reorder('cover letter', [0, 1, 2])).version, 2, 'the same order is not a new version');
  await assert.rejects(() => r.store.reorder('cover letter', [0, 1]), /every page once/);
  await r.store.edit('cover letter', [{ op: 'replace_page', page: 1, text: 'x' }]);
  await assert.rejects(() => r.store.reorder('cover letter', [1, 0, 2]), /Approve or reject/);
});

test('a page is drawn once, kept by what is on it, and a page that only moved is not drawn again', async () => {
  const r = rig();
  await r.store.create({ title: 'Cover letter', pages: PAGES });
  const a = await r.store.pageImage('cover letter', 1);
  assert.equal(a.bytes.toString(), 'PNG:Page two text.');
  await r.store.pageImage('cover letter', 1);
  assert.equal(r.drawn.length, 1);
  await r.store.reorder('cover letter', [1, 0, 2]);
  const b = await r.store.pageImage('cover letter', 0);
  assert.equal(b.bytes.toString(), 'PNG:Page two text.');
  assert.equal(r.drawn.length, 1, 'it was drawn before the move');
  await assert.rejects(() => r.store.pageImage('cover letter', 3), /no such page/);
  await assert.rejects(() => r.store.pageImage('cover letter', -1), /no such page/);
  await assert.rejects(() => r.store.pageImage('cover letter', 'x'), /no such page/);
});

test('the phone detail lists pages with a line of text, and marks a page that runs past the sheet', async () => {
  const r = rig();
  await r.store.create({ title: 'Cover letter', pages: ['x'.repeat(80), 'short'] });
  await r.store.pageImage('cover letter', 0);
  await r.store.pageImage('cover letter', 1);
  const d = r.store.detail('cover letter');
  assert.deepEqual(d.pageList.map((p) => [p.index, p.overflow]), [[0, true], [1, false]]);
  assert.match(d.pageList[1].excerpt, /short/);
  assert.equal(d.folderName, 'Cover letter');
});

test('a Word file you changed by hand is saved aside before a new version replaces it', async () => {
  const r = rig();
  const d = await r.store.create({ title: 'Cover letter', pages: PAGES });
  fs.writeFileSync(d.docx, 'MY OWN EDITS IN WORD');
  await r.store.edit('cover letter', [{ op: 'replace_page', page: 2, text: 'Rewritten.' }]);
  const kept = fs.readdirSync(path.join(d.folder, '.relay', 'backup'));
  assert.equal(kept.length, 1);
  assert.equal(fs.readFileSync(path.join(d.folder, '.relay', 'backup', kept[0]), 'utf8'), 'MY OWN EDITS IN WORD');
  await r.store.review('cover letter', 'approve');
  await r.store.reorder('cover letter', [1, 0, 2]);
  assert.equal(fs.readdirSync(path.join(d.folder, '.relay', 'backup')).length, 1, 'files Relay wrote itself are not backed up again');
});

test('changes made at the same moment are applied one after another', async () => {
  const r = rig();
  await r.store.create({ title: 'Cover letter', pages: PAGES });
  const all = await Promise.allSettled([
    r.store.edit('cover letter', [{ op: 'replace_page', page: 2, text: 'A' }]),
    r.store.edit('cover letter', [{ op: 'replace_page', page: 3, text: 'B' }]),
    r.store.edit('cover letter', [{ op: 'add_page', text: 'C' }])
  ]);
  assert.ok(all.every((x) => x.status === 'fulfilled'));
  assert.deepEqual(r.store.pagesOf(r.store.find('cover letter')).slice(1), ['A', 'B', 'C']);
  assert.deepEqual(r.store.detail('cover letter').versions.map((v) => v.n), [1, 2, 3, 4]);
});

test('the Word file text: each page break becomes a real page break', () => {
  const html = documentHtml('T & Co', ['# A', 'B']);
  assert.match(html, /<title>T &amp; Co<\/title>/);
  assert.equal((html.match(/RELAYPAGEBREAKMARKER/g) || []).length, 1);
  const xml = '<w:body><w:p><w:pPr/><w:r><w:t>one</w:t></w:r></w:p><w:p><w:pPr><w:spacing/></w:pPr><w:r><w:rPr/><w:t xml:space="preserve">RELAYPAGEBREAKMARKER</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p></w:body>';
  assert.equal(withPageBreaks(xml), '<w:body><w:p><w:pPr/><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p></w:body>');
});

// The real Mac tools, when this is a Mac: textutil makes the Word file, and the page breaks really are in it.
test('with the real textutil and zip, a three page document has two page breaks and opens back as text', { skip: process.platform !== 'darwin' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-real-'));
  const run = (cmd, args, { cwd } = {}) => new Promise((resolve, reject) => execFile(cmd, args, { cwd, maxBuffer: 50 * 1024 * 1024 }, (e, out, err) => (e ? reject(new Error(String(err || e.message))) : resolve(out))));
  const store = new DocumentStore({ home, exec: run, render: async (md) => ({ png: Buffer.from(md), overflow: false }) });
  const d = await store.create({ title: 'Real test', pages: ['# One\n\nFirst page words.', 'Second page words.', 'Third page words.'] });
  const xml = await run('/usr/bin/unzip', ['-p', d.docx, 'word/document.xml']);
  assert.equal((xml.match(/<w:br w:type="page"\/>/g) || []).length, 2);
  assert.ok(!xml.includes('RELAYPAGEBREAKMARKER'));
  const text = await run('/usr/bin/textutil', ['-convert', 'txt', '-stdout', d.docx]);
  assert.match(text, /First page words\.[\s\S]*Second page words\.[\s\S]*Third page words\./);
  await store.reorder('real test', [2, 1, 0]);
  const text2 = await run('/usr/bin/textutil', ['-convert', 'txt', '-stdout', d.docx]);
  assert.match(text2, /Third page words\.[\s\S]*Second page words\.[\s\S]*First page/);
});
