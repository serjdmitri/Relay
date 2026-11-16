const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { DocumentStore } = require('../src/main/documents/store');
const { DocumentsService } = require('../src/main/documents/service');
const { createPageRenderer, pageHtml } = require('../src/main/documents/render');
const { RemoteServer } = require('../src/main/remote/server');
const { Pairing, Devices } = require('../src/main/remote/auth');
const { buildTools } = require('../src/main/agent/tools');
const categories = require('../src/main/agent/toolCategories');

// A store whose Mac pieces are fakes that record what they were asked: the zip is a file that lists the parts that were packed.
function rig() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kinds-'));
  const calls = [], drawn = [];
  let n = 0;
  const walk = (d, base = d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name))]));
  const store = new DocumentStore({
    home, id: () => `doc-3333333${++n}`,
    exec: async (cmd, args, o = {}) => {
      calls.push(path.basename(cmd));
      if (cmd.endsWith('zip')) { fs.writeFileSync(args[args.indexOf('.') - 1], `ZIP:${walk(o.cwd).sort().join(',')}`); return ''; }
      if (cmd.endsWith('textutil')) { fs.writeFileSync(args[args.indexOf('-output') + 1], 'DOCX'); return ''; }
      return cmd.endsWith('unzip') ? '<w:body></w:body>' : '';
    },
    render: async (md, kind) => { drawn.push([kind, md]); return { png: Buffer.from(`PNG:${kind}:${md}`), overflow: false }; },
    reveal: async () => {}
  });
  const svc = new DocumentsService({ store, getHolos: () => ({ show: async () => 'holo-0000-0001' }) });
  return { store, svc, tools: svc.tools(), home, calls, drawn };
}
const SHEETS = ['## Budget\nItem,Cost\nRent,1200\nFood,350', '## Notes\nName,Note\nAnna,hi'];
const SLIDES = ['# Quarterly update\n\n- Revenue up\n- Costs down', '# Next steps\n\n- Hire\n- Ship', '# Thank you'];

test('a spreadsheet is an .xlsx made from Office parts (no textutil), and its folder, versions and file names follow its kind', async () => {
  const r = rig();
  const d = await r.store.create({ title: 'Budget', pages: SHEETS, kind: 'sheet' });
  assert.deepEqual({ kind: d.kind, unit: d.unit, pages: d.pages }, { kind: 'sheet', unit: 'sheet', pages: 2 });
  assert.equal(d.docx, path.join(r.home, 'Documents', 'Relay Documents', 'Budget', 'Budget.xlsx'));
  assert.deepEqual(r.calls, ['zip'], 'only zip: textutil makes Word files');
  assert.match(fs.readFileSync(d.docx, 'utf8'), /^ZIP:.*xl\/workbook\.xml.*xl\/worksheets\/sheet1\.xml.*xl\/worksheets\/sheet2\.xml/);
  assert.ok(fs.existsSync(path.join(d.folder, '.relay', 'versions', 'v1.xlsx')));
  assert.ok(!fs.existsSync(path.join(d.folder, '.relay', 'versions', 'v1.docx')));
});

test('slides are a .pptx with one slide part for each slide, and a slide count in words', async () => {
  const r = rig();
  const d = await r.store.create({ title: 'Update', pages: SLIDES, kind: 'slides' });
  assert.equal(path.basename(d.docx), 'Update.pptx');
  assert.match(fs.readFileSync(d.docx, 'utf8'), /ppt\/slides\/slide1\.xml.*ppt\/slides\/slide2\.xml.*ppt\/slides\/slide3\.xml/);
  assert.equal(r.store.detail('update').versions[0].note, 'Written with 3 slides');
  assert.equal((await r.store.create({ title: 'One', pages: ['# Only'], kind: 'slides' })).pages, 1);
});

test('without a kind, or with an older document that has none, it is a Word document', async () => {
  const r = rig();
  const d = await r.store.create({ title: 'Letter', pages: ['Dear Sir'] });
  assert.equal(d.kind, 'doc');
  assert.equal(path.basename(d.docx), 'Letter.docx');
  const meta = JSON.parse(fs.readFileSync(path.join(d.folder, '.relay', 'document.json'), 'utf8'));
  delete meta.kind;
  fs.writeFileSync(path.join(d.folder, '.relay', 'document.json'), JSON.stringify(meta));
  assert.equal(r.store.detail('letter').kind, 'doc');
  assert.equal((await r.store.create({ title: 'Odd', pages: ['x'], kind: 'banana' })).kind, 'doc', 'an unknown kind is a Word document');
});

test('a bad spreadsheet is refused before anything is written', async () => {
  const r = rig();
  await assert.rejects(() => r.store.create({ title: 'Empty', pages: ['## Name only'], kind: 'sheet' }), /no rows/);
  assert.deepEqual(r.store.all(), []);
});

test('a change to a sheet is pending with the rows that changed; Reject brings the old sheet back, Approve keeps it', async () => {
  const r = rig();
  await r.store.create({ title: 'Budget', pages: SHEETS, kind: 'sheet' });
  const e = await r.store.edit('budget', [{ op: 'set_cell', page: 1, cell: 'B2', text: '900' }, { op: 'insert_row', page: 1, values: ['Fuel', '80'] }]);
  assert.equal(e.pending, true);
  assert.deepEqual(e.changes, [{ type: 'changed', page: 1, before: 'Rent,1200', after: 'Rent,900' }, { type: 'added', page: 1, before: '', after: 'Fuel,80' }]);
  assert.match(r.store.read('budget').text, /row 2: Rent \| 900/);
  const d = r.store.detail('budget');
  assert.equal(d.pageList[0].excerpt, 'Budget: 4 rows, Item, Cost');
  const rej = await r.store.review('budget', 'reject');
  assert.equal(rej.pending, false);
  assert.match(r.store.read('budget').text, /row 2: Rent \| 1200/);
  await r.store.edit('budget', [{ op: 'delete_page', page: 2 }]);
  assert.equal((await r.store.review('budget', 'approve')).pages, 1);
});

test('sheets and slides are moved like pages: the order is saved with the file', async () => {
  const r = rig();
  const s = await r.store.create({ title: 'Update', pages: SLIDES, kind: 'slides' });
  const m = await r.store.reorder('update', [2, 0, 1]);
  assert.equal(m.version, 2);
  assert.deepEqual(r.store.pagesOf(r.store.find('update')), [SLIDES[2], SLIDES[0], SLIDES[1]]);
  assert.match(fs.readFileSync(s.docx, 'utf8'), /^ZIP:/, 'the .pptx was made again');
  assert.equal(r.store.detail('update').versions[1].note, 'Slides moved');
  const b = await r.store.create({ title: 'Budget', pages: SHEETS, kind: 'sheet' });
  assert.equal((await r.store.reorder('budget', [1, 0])).version, 2);
  assert.equal(r.store.read('budget').text.startsWith('Sheet 1 "Notes"'), true);
  assert.ok(b.docx.endsWith('.xlsx'));
});

test('the page picture is drawn for the kind of the document', async () => {
  const r = rig();
  await r.store.create({ title: 'Update', pages: SLIDES, kind: 'slides' });
  const img = await r.store.pageImage('update', 1);
  assert.equal(img.bytes.toString(), 'PNG:slides:# Next steps\n\n- Hire\n- Ship');
  assert.deepEqual(r.drawn[0], ['slides', '# Next steps\n\n- Hire\n- Ship']);
});

// ---- what Relay says back ----
test('what the tools say names the kind of file, the unit, and where it went', async () => {
  const r = rig();
  assert.match(await r.tools.create({ title: 'Budget', pages: SHEETS, kind: 'sheet' }), /Saved "Budget" \(2 sheets\) as an Excel file: .*Budget\/Budget\.xlsx/);
  assert.match(await r.tools.create({ title: 'Update', pages: SLIDES, kind: 'slides' }), /Saved "Update" \(3 slides\) as a PowerPoint file: .*Update\/Update\.pptx/);
  assert.match(await r.tools.create({ title: 'Letter', pages: ['Hi'] }), /\(1 page\) as a Word file/);
  assert.match(await r.tools.list(), /Update \(3 slides, version 1\)/);
  assert.match(await r.tools.edit({ doc: 'budget', changes: [{ op: 'set_cell', page: 1, cell: 'B2', text: '900' }] }), /Changed "Budget": set B2 on sheet 1\. It is version 2 and it is live in the Excel file, but it waits for Approve or Reject/);
  assert.match(await r.tools.read({ doc: 'budget' }), /Sheet 1 "Budget" \(3 rows\):\n {2}row 1: Item \| Cost/);
  assert.match(await r.tools.review({ doc: 'budget', action: 'reject' }), /Put the earlier sheets of "Budget" back/);
  assert.equal(await r.tools.hologram({ doc: 'update', page: 2 }), 'Showing slide 2 of 3 of "Update" as a hologram.');
  await assert.rejects(() => r.tools.hologram({ doc: 'update', page: 9 }), /no slide 9; Update has 3 slides/);
});

test('the tools offer the kind, and a request for slides or a spreadsheet shows them', () => {
  const r = rig();
  const tools = buildTools({ mac: { openApp: async () => '' }, getScale: () => 1, documents: r.tools });
  const create = tools.find((t) => t.name === 'doc_create');
  assert.ok(create.input_schema.properties.kind);
  assert.match(create.description, /SPREADSHEET[\s\S]*SLIDE DECK[\s\S]*## Sheet name/);
  const op = tools.find((t) => t.name === 'doc_edit').input_schema.properties.changes.items.properties;
  for (const k of ['cell', 'row', 'values', 'name']) assert.ok(op[k], k);
  for (const ask of ['make me a budget spreadsheet', 'build a slide deck about our launch', 'put together a presentation for Monday', 'make an Excel file of my expenses']) assert.ok(categories.exposure(tools, { request: ask }).has('doc_create'), ask);
  assert.ok(!categories.exposure(tools, { request: 'what time is it' }).has('doc_create'));
});

// ---- the pictures ----
test('a slide is drawn 16:9 from escaped text, and a worksheet as a grid with column letters and row numbers', () => {
  const slide = pageHtml('# A <b>title</b>\n\n- one **bold**\n- two\n\nplain', 'slides');
  assert.match(slide, /Content-Security-Policy" content="default-src 'none'/);
  assert.match(slide, /width:960px;min-height:540px/);
  assert.match(slide, /<h1>A &lt;b&gt;title&lt;\/b&gt;<\/h1>.*<ul><li>one <b>bold<\/b><\/li><li>two<\/li><\/ul><p>plain<\/p>/s);
  const grid = pageHtml('## Budget & more\nItem,Cost\nRent,1200\nTotal,=SUM(B2:B2)', 'sheet');
  assert.match(grid, /<h2>Budget &amp; more<\/h2>/);
  assert.match(grid, /<th>A<\/th><th>B<\/th>/);
  assert.match(grid, /<th>2<\/th><td class="">Rent<\/td><td class="n">1200<\/td>/);
  assert.match(grid, /<td class="f">=SUM\(B2:B2\)<\/td>/, 'a formula is shown as typed');
  assert.match(grid, /<td class=" h">Item<\/td>/, 'the header row is marked');
});

test('the renderer draws each kind at its own size, and only a document or a slide can "run past"', async () => {
  const sizes = [];
  let height = 0;
  class Win {
    constructor() { this.webContents = { setWindowOpenHandler() {}, executeJavaScript: async () => height, capturePage: async (rect) => ({ isEmpty: () => false, getSize: () => ({ width: rect.width }), toPNG: () => Buffer.from('PNG') }) }; }
    async loadURL() {}
    setContentSize(w, h) { sizes.push([w, h]); }
    isDestroyed() { return false; }
    destroy() {}
  }
  const render = createPageRenderer({ BrowserWindow: Win, wait: async () => {}, idleMs: 1000 });
  height = 540; assert.equal((await render('# x', 'slides')).overflow, false);
  assert.deepEqual(sizes.at(-1), [960, 540]);
  height = 700; assert.equal((await render('# x', 'slides')).overflow, true, 'a slide with too much on it');
  height = 900; assert.equal((await render('a,b', 'sheet')).overflow, false, 'a sheet is as tall as its rows');
  assert.deepEqual(sizes.at(-1), [816, 900]);
  height = 1056; assert.equal((await render('x')).overflow, false);
  assert.deepEqual(sizes.at(-1), [816, 1056]);
});

// ---- the phone ----
test('the phone lists a spreadsheet and slides with their kind, shows what changed by row, and moves slides', async () => {
  const r = rig();
  const root = path.join(__dirname, '../src/remote');
  let list = [];
  const devices = new Devices({ list: () => list, save: (l) => { list = l; } });
  const token = devices.add('iPhone').token;
  const s = new RemoteServer({ control: { snapshot: () => ({ state: 'idle', tasks: [], agents: [] }), recent: () => [], ask: async () => 'r', stop() {}, docs: r.svc.remote() }, pairing: new Pairing(), devices, root, host: '127.0.0.1', port: 0 });
  await s.start();
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const get = (p) => fetch(base + p, { headers: { authorization: `Bearer ${token}` } });
    const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-remote': '1', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    await r.tools.create({ title: 'Budget', pages: SHEETS, kind: 'sheet' });
    await r.tools.create({ title: 'Update', pages: SLIDES, kind: 'slides' });
    const { documents } = await (await get('/api/documents')).json();
    assert.deepEqual(documents.map((d) => [d.title, d.kind, d.unit, d.pages]).sort(), [['Budget', 'sheet', 'sheet', 2], ['Update', 'slides', 'slide', 3]]);
    await r.tools.edit({ doc: 'budget', changes: [{ op: 'set_cell', page: 1, cell: 'B2', text: '900' }] });
    const b = await (await get('/api/documents/doc-33333331')).json();
    assert.deepEqual(b.changes, [{ type: 'changed', page: 1, before: 'Rent,1200', after: 'Rent,900' }]);
    assert.equal(b.unit, 'sheet');
    const img = await get('/api/documents/doc-33333332/page/0.png');
    assert.equal(Buffer.from(await img.arrayBuffer()).toString(), `PNG:slides:${SLIDES[0]}`);
    const moved = await (await post('/api/documents/doc-33333332/reorder', { order: [1, 2, 0] })).json();
    assert.deepEqual(moved.pageList.map((p) => p.excerpt), ['Next steps - Hire - Ship', 'Thank you', 'Quarterly update - Revenue up - Costs down']);
    const h = await (await post('/api/documents/doc-33333332/hologram', { page: 1 })).json();
    assert.deepEqual({ title: h.title, unit: h.unit }, { title: 'Update · slide 1', unit: 'slide' });
  } finally { s.stop(); }
});

test('the phone page labels things by kind, and the script and styles for it are served', () => {
  const js = fs.readFileSync(path.join(__dirname, '../src/remote/documents.js'), 'utf8');
  assert.match(js, /Ucap/);
  assert.match(js, /Spreadsheet · /);
  assert.match(js, /`Reorder \$\{U\}s`/);
});

// ---- the real Mac files ----
const have = (f) => fs.existsSync(f);
test('real files: the .xlsx and .pptx are well-formed XML in a real zip, and Quick Look can draw them', { skip: process.platform !== 'darwin' || !have('/usr/bin/xmllint') || !have('/usr/bin/zip') }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kinds-real-'));
  const run = (cmd, args, { cwd } = {}) => new Promise((resolve, reject) => execFile(cmd, args, { cwd, maxBuffer: 50 * 1024 * 1024 }, (e, out, err) => (e ? reject(new Error(String(err || e.message))) : resolve(out))));
  const store = new DocumentStore({ home, exec: run, render: async () => ({ png: Buffer.from('x'), overflow: false }) });
  const x = await store.create({ title: 'Real budget', kind: 'sheet', pages: ['## Budget\nItem,Cost\nRent,1200\nFood,"350.50"\nTotal,=SUM(B2:B3)', '## Notes\nName,Note\nAnna,"says ""hi"", twice"'] });
  const p = await store.create({ title: 'Real update', kind: 'slides', pages: ['# Quarterly update\n\nGood news and **bold** news\n\n- Revenue up\n- Costs *down*', '# Next steps\n\n- Hire\n- Ship'] });
  for (const f of [x.docx, p.docx]) {
    const names = (await run('/usr/bin/unzip', ['-Z1', f])).split('\n').filter(Boolean);
    assert.ok(names.includes('[Content_Types].xml') && names.includes('_rels/.rels'), f);
    for (const n of names.filter((n) => /\.(xml|rels)$/.test(n))) {
      const xml = await run('/usr/bin/unzip', ['-p', f, n.replace(/[[\]]/g, '\\$&')]); // unzip reads [ ] as a pattern
      const tmp = path.join(home, `check-${path.basename(n)}`);
      fs.writeFileSync(tmp, xml);
      await run('/usr/bin/xmllint', ['--noout', tmp]); // throws when it is not well-formed
    }
  }
  assert.match(await run('/usr/bin/unzip', ['-p', x.docx, 'xl/worksheets/sheet2.xml']), /says &quot;hi&quot;, twice/);
  if (have('/usr/bin/qlmanage')) { // macOS's own previewer reads the file and writes one picture (nothing is opened and the screen is not captured)
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kinds-ql-'));
    await run('/usr/bin/qlmanage', ['-t', '-s', '400', '-o', out, x.docx, p.docx]);
    assert.deepEqual(fs.readdirSync(out).sort(), ['Real budget.xlsx.png', 'Real update.pptx.png']);
    for (const f of fs.readdirSync(out)) assert.ok(fs.statSync(path.join(out, f)).size > 2000, f);
  }
  await store.reorder('real update', [1, 0]);
  assert.match(await run('/usr/bin/unzip', ['-p', p.docx, 'ppt/slides/slide1.xml']), /Next steps/, 'the moved slide is first in the real file');
});
