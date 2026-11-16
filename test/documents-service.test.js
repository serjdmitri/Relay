const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DocumentStore } = require('../src/main/documents/store');
const { DocumentsService } = require('../src/main/documents/service');
const { createPageRenderer, pageHtml } = require('../src/main/documents/render');
const { buildTools } = require('../src/main/agent/tools');
const categories = require('../src/main/agent/toolCategories');
const { dropIndex, moved } = require('../src/remote/documents');

function rig({ holos = null } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'docsvc-'));
  let n = 0;
  const store = new DocumentStore({
    home, id: () => `doc-1111111${++n}`,
    exec: async (cmd, args) => { if (cmd.endsWith('textutil')) fs.writeFileSync(args[args.indexOf('-output') + 1], 'DOCX'); return cmd.endsWith('unzip') ? '<w:body></w:body>' : ''; },
    render: async (md) => ({ png: Buffer.from(`PNG:${md}`), overflow: false }),
    reveal: async () => {}
  });
  const svc = new DocumentsService({ store, getHolos: () => holos });
  return { svc, store, home, tools: svc.tools(), remote: svc.remote() };
}
const LETTER = ['# Jane Doe\n\nDear hiring manager,\n\nI am writing to apply.\n\nYours sincerely, Jane'];

test('"write me a cover letter": the tool saves a real document and says where it went', async () => {
  const r = rig();
  const said = await r.tools.create({ title: 'Cover letter', pages: LETTER });
  assert.match(said, /Saved "Cover letter" \(1 page\) as a Word file: .*Documents\/Relay Documents\/Cover letter\/Cover letter\.docx/);
  assert.ok(fs.existsSync(path.join(r.home, 'Documents', 'Relay Documents', 'Cover letter', 'Cover letter.docx')));
});

test('bad input comes back as an error the model can read, and nothing is saved', async () => {
  const r = rig();
  await assert.rejects(() => r.tools.create({ title: 'Empty', pages: [] }), /at least one page/);
  await assert.rejects(() => r.tools.create({ title: 'Long', pages: ['x'.repeat(9000)] }), /too long/);
  assert.equal(await r.tools.list(), 'There are no documents yet.');
});

test('reading gives numbered paragraphs, and an edit says it is live but waiting for the phone', async () => {
  const r = rig();
  await r.tools.create({ title: 'Cover letter', pages: LETTER });
  assert.match(await r.tools.read({ doc: 'cover letter' }), /\[2\] \(paragraph\) Dear hiring manager,/);
  const said = await r.tools.edit({ doc: 'cover', changes: [{ op: 'replace_paragraph', page: 1, paragraph: 3, text: 'I would love to apply.' }] });
  assert.match(said, /Changed "Cover letter": changed paragraph 3 on page 1\. It is version 2/);
  assert.match(said, /waits for Approve or Reject on the phone/);
  assert.match(await r.tools.list(), /Cover letter \(1 page, version 2, a change is waiting to be approved\)/);
  await assert.rejects(() => r.tools.edit({ doc: 'cover', changes: [{ op: 'replace_paragraph', page: 5, paragraph: 1, text: 'x' }] }), /no page 5/);
});

test('approve by voice keeps it, reject by voice puts the old pages back', async () => {
  const r = rig();
  await r.tools.create({ title: 'Cover letter', pages: LETTER });
  await r.tools.edit({ doc: 'cover', changes: [{ op: 'replace_page', page: 1, text: 'New.' }] });
  assert.match(await r.tools.review({ doc: 'cover', action: 'reject' }), /Put the earlier pages of "Cover letter" back \(now version 3\)/);
  assert.match(await r.tools.read({ doc: 'cover' }), /Dear hiring manager/);
  await r.tools.edit({ doc: 'cover', changes: [{ op: 'replace_page', page: 1, text: 'New.' }] });
  assert.equal(await r.tools.review({ doc: 'cover', action: 'approve' }), 'Kept the change to "Cover letter".');
  await assert.rejects(() => r.tools.review({ doc: 'cover', action: 'approve' }), /no change waiting/);
});

test('a page becomes a hologram: the page picture goes to the hologram manager as an image item', async () => {
  const shown = [];
  const r = rig({ holos: { show: async (o) => { shown.push(o); return 'holo-id-0001'; } } });
  await r.tools.create({ title: 'Report', pages: ['# One', 'Two page.'] });
  assert.equal(await r.tools.hologram({ doc: 'report', page: 2 }), 'Showing page 2 of 2 of "Report" as a hologram.');
  assert.equal(shown[0].title, 'Report · page 2');
  assert.deepEqual({ kind: shown[0].items[0].kind, mime: shown[0].items[0].mime, bytes: shown[0].items[0].bytes.toString() }, { kind: 'image', mime: 'image/png', bytes: 'PNG:Two page.' });
  assert.equal((await r.remote.hologram(r.store.all()[0].id)).page, 1, 'the first page when none is named');
  await assert.rejects(() => r.tools.hologram({ doc: 'report', page: 3 }), /no page 3; Report has 2 pages/);
  const off = rig();
  await off.tools.create({ title: 'Report', pages: ['x'] });
  await assert.rejects(() => off.tools.hologram({ doc: 'report' }), /Holograms are turned off/);
});

test('the pages are drawn in the background after a document is made, so the phone opens quickly', async () => {
  const r = rig();
  await r.tools.create({ title: 'Report', pages: ['A', 'B'] });
  await r.svc.warm(r.store.all()[0].id);
  const dir = path.join(r.store.all()[0].folder, '.relay', 'pages');
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.png')).length, 2);
});

// ---- the page picture ----
test('a page is drawn on a letter sheet with the same style as the Word file, from escaped text, with no network', () => {
  const html = pageHtml('# Hi <script>alert(1)</script>\n\nBody & more');
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  assert.ok(!html.includes('<script>alert'), 'the text is escaped');
  assert.match(html, /<div id="sheet">/);
  assert.match(html, /width:816px;min-height:1056px/);
  assert.match(html, /Body &amp; more/);
});

test('the page renderer reuses one hidden window, takes a picture of its own contents, and flags a page that runs long', async () => {
  const made = [], log = [];
  let height = 1056;
  class Win {
    constructor(o) { made.push(o); this.destroyed = false; this.webContents = { setWindowOpenHandler() {}, executeJavaScript: async () => height, capturePage: async (rect) => { log.push(['capture', rect]); return { isEmpty: () => false, getSize: () => ({ width: rect.width * 2 }), resize: ({ width }) => ({ isEmpty: () => false, getSize: () => ({ width }), toPNG: () => Buffer.from(`PNG${width}`) }), toPNG: () => Buffer.from('PNGfull') }; } }; }
    async loadURL(u) { log.push(['load', u.length > 20]); }
    setContentSize(w, h) { log.push(['size', w, h]); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const render = createPageRenderer({ BrowserWindow: Win, wait: async () => {}, idleMs: 5 });
  const a = await render('short');
  assert.deepEqual({ overflow: a.overflow, png: a.png.toString() }, { overflow: false, png: 'PNG1224' }, 'a retina picture is shrunk to a sensible width');
  height = 1700;
  const b = await render('long');
  assert.equal(b.overflow, true);
  assert.deepEqual(log.filter((l) => l[0] === 'size').map((l) => l.slice(1)), [[816, 1056], [816, 1700]]);
  assert.equal(made.length, 1, 'the same window drew both');
  assert.equal(made[0].show, false);
  assert.equal(made[0].webPreferences.sandbox, true);
  assert.equal(made[0].webPreferences.nodeIntegration, false);
  await new Promise((r) => setTimeout(r, 30));
  await render('again');
  assert.equal(made.length, 2, 'a window that was idle was closed, so a new one is made');
});

test('a page that cannot be drawn is an error, and the window is not trusted again', async () => {
  const made = [];
  class Win { constructor() { made.push(this); this.webContents = { setWindowOpenHandler() {}, executeJavaScript: async () => 1056, capturePage: async () => ({ isEmpty: () => true }) }; } async loadURL() {} setContentSize() {} isDestroyed() { return !!this.d; } destroy() { this.d = true; } }
  const render = createPageRenderer({ BrowserWindow: Win, wait: async () => {}, idleMs: 1000 });
  await assert.rejects(() => render('x'), /could not be drawn/);
  await assert.rejects(() => render('y'), /could not be drawn/);
  assert.equal(made.length, 2);
  assert.ok(made[0].d, 'the first window was closed');
});

// ---- the voice tools ----
const fakeMac = { openApp: async () => '', uiLocate: async () => null };
test('the document tools exist only when the app supplies documents, and all are in one hidden group', () => {
  const without = buildTools({ mac: fakeMac, getScale: () => 1 }).map((t) => t.name);
  assert.ok(!without.some((n) => n.startsWith('doc_')));
  const tools = buildTools({ mac: fakeMac, getScale: () => 1, documents: rig().tools });
  const docTools = tools.filter((t) => t.name.startsWith('doc_'));
  const names = docTools.map((t) => t.name);
  assert.deepEqual(names, ['doc_create', 'doc_list', 'doc_read', 'doc_edit', 'doc_review', 'doc_hologram']);
  assert.ok(docTools.every((t) => !t.confirm), 'nothing is asked first');
  assert.ok(names.every((n) => categories.groupOf(n) === 'documents'));
  const shown = categories.exposure(tools, { request: 'write me a one-page cover letter' });
  assert.ok(names.every((n) => shown.has(n)), 'a request for a document shows them');
  assert.ok(!categories.exposure(tools, { request: 'what time is it' }).has('doc_create'), 'other requests do not carry their weight');
  assert.ok(categories.exposure(tools, { request: 'change the second paragraph' }).has('doc_edit'));
});

test('the tools pass the words straight to the store and return its answer', async () => {
  const r = rig();
  const tools = Object.fromEntries(buildTools({ mac: fakeMac, getScale: () => 1, documents: r.tools }).map((t) => [t.name, t]));
  assert.match(await tools.doc_create.run({ title: 'Memo', pages: ['One page.'] }), /Saved "Memo"/);
  assert.match(await tools.doc_edit.run({ doc: 'memo', changes: [{ op: 'add_page', text: 'Page two.' }] }), /Changed "Memo": added a page after page 1/);
  assert.equal(tools.doc_create.describe({ title: 'Memo' }), 'Writing Memo');
});

// ---- the phone page's reorder maths ----
test('dragging: where a card lands is how many of the others are above the finger', () => {
  assert.equal(dropIndex([100, 300, 500], 50), 0);
  assert.equal(dropIndex([100, 300, 500], 350), 2);
  assert.equal(dropIndex([100, 300, 500], 900), 3);
  assert.deepEqual(moved([0, 1, 2], 2, 0), [2, 0, 1]);
  assert.deepEqual(moved([0, 1, 2], 0, 2), [1, 2, 0]);
  assert.deepEqual(moved([0, 1, 2], 1, 1), [0, 1, 2]);
  assert.deepEqual(moved([0, 1, 2], 0, 99), [1, 2, 0], 'past the end is the end');
});
