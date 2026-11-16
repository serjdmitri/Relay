const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { RemoteServer } = require('../src/main/remote/server');
const { Pairing, Devices } = require('../src/main/remote/auth');
const { DocumentStore } = require('../src/main/documents/store');
const { DocumentsService } = require('../src/main/documents/service');

const ROOT = path.join(__dirname, '../src/remote');

// The real server with a real document store (the Mac's tools and the page pictures are faked), and a paired phone.
async function make({ withDocs = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'remdocs-'));
  let n = 0;
  const holoShown = [];
  const store = new DocumentStore({
    home, id: () => `doc-2222222${++n}`,
    exec: async (cmd, args) => { if (cmd.endsWith('textutil')) fs.writeFileSync(args[args.indexOf('-output') + 1], 'DOCX'); return cmd.endsWith('unzip') ? '<w:body></w:body>' : ''; },
    render: async (md) => ({ png: Buffer.from(`PNG:${md}`), overflow: false }),
    reveal: async () => {}
  });
  const svc = new DocumentsService({ store, getHolos: () => ({ show: async (o) => { holoShown.push(o); return 'holo-0000-0001'; } }) });
  let list = [];
  const devices = new Devices({ list: () => list, save: (l) => { list = l; } });
  const token = devices.add('iPhone').token;
  const control = { snapshot: () => ({ state: 'idle', tasks: [], agents: [] }), recent: () => [], ask: async () => 'r1', stop() {}, ...(withDocs ? { docs: svc.remote() } : {}) };
  const s = new RemoteServer({ control, pairing: new Pairing(), devices, root: ROOT, host: '127.0.0.1', port: 0 });
  await s.start();
  const base = `http://127.0.0.1:${s.port}`;
  const auth = { authorization: `Bearer ${token}` };
  const get = (p, t = token) => fetch(base + p, { headers: t ? { authorization: `Bearer ${t}` } : {} });
  const post = (p, body, { header = true, t = token } = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(header ? { 'x-relay-remote': '1' } : {}), ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(body) });
  return { s, svc, store, base, get, post, auth, token, holoShown, tools: svc.tools() };
}
const PAGES = ['# Cover letter\n\nDear Sir,\n\nI would like the job.', 'Page two text.', 'Page three text.'];

test('the phone page, its script and the home button are served, and the documents API needs the phone token', async () => {
  const { s, base, get } = await make();
  for (const p of ['/documents.html', '/documents.js']) assert.equal((await fetch(base + p)).status, 200, p);
  assert.match(await (await fetch(base + '/documents.html')).text(), /<title>Relay documents/);
  assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /<a id="docfab" href="\/documents\.html"/);
  assert.match(fs.readFileSync(path.join(ROOT, 'looks.css'), 'utf8'), /#holofab, #docfab/, 'the button follows the look system');
  for (const p of ['/api/documents', '/api/documents/doc-22222221', '/api/documents/doc-22222221/page/0.png']) assert.equal((await get(p, '')).status, 401, p);
  assert.equal((await get('/api/documents', 'wrong-token')).status, 401);
  assert.equal((await fetch(base + '/api/documents/doc-22222221/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400, 'a post without the header is refused before anything else');
  s.stop();
});

test('without the documents wiring the API says it is not found rather than breaking', async () => {
  const { s, get } = await make({ withDocs: false });
  assert.deepEqual(await (await get('/api/documents')).json(), { documents: [] });
  assert.equal((await get('/api/documents/doc-22222221')).status, 404);
  s.stop();
});

test('phase 1: a document made by voice is listed on the phone, opens as page pictures, and becomes a hologram', async () => {
  const { s, get, post, tools, holoShown } = await make();
  assert.deepEqual(await (await get('/api/documents')).json(), { documents: [] });
  await tools.create({ title: 'Cover letter', pages: PAGES });
  const { documents } = await (await get('/api/documents')).json();
  assert.equal(documents.length, 1);
  assert.deepEqual({ id: documents[0].id, title: documents[0].title, pages: documents[0].pages, pending: documents[0].pending }, { id: 'doc-22222221', title: 'Cover letter', pages: 3, pending: false });
  const d = await (await get('/api/documents/doc-22222221')).json();
  assert.equal(d.pageList.length, 3);
  assert.equal(d.folderName, 'Cover letter');
  assert.deepEqual(d.changes, []);
  const img = await get('/api/documents/doc-22222221/page/1.png');
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await img.arrayBuffer()).toString(), 'PNG:Page two text.');
  assert.equal((await get('/api/documents/doc-22222221/page/9.png')).status, 400);
  const h = await post('/api/documents/doc-22222221/hologram', { page: 3 });
  assert.deepEqual(await h.json(), { holoId: 'holo-0000-0001', title: 'Cover letter · page 3', page: 3, pages: 3, unit: 'page' });
  assert.equal(holoShown[0].items[0].kind, 'image');
  assert.equal((await post('/api/documents/doc-22222221/hologram', { page: 8 })).status, 400);
  s.stop();
});

test('unknown documents are 404, and an id that is not a plain id never reaches the store', async () => {
  const { s, get, post, tools } = await make();
  await tools.create({ title: 'Cover letter', pages: PAGES });
  assert.equal((await get('/api/documents/doc-99999999')).status, 404);
  assert.equal((await post('/api/documents/doc-99999999/review', { action: 'approve' })).status, 404);
  for (const bad of ['..%2F..%2Fetc', 'a b c d e f g h', 'short', encodeURIComponent('../../x/../y')]) assert.notEqual((await get(`/api/documents/${bad}`)).status, 200, bad);
  s.stop();
});

test('phase 2: an edit by voice is pending on the phone with what changed; Reject restores the old one, Approve keeps the new one', async () => {
  const { s, get, post, tools } = await make();
  await tools.create({ title: 'Cover letter', pages: PAGES });
  await tools.edit({ doc: 'cover letter', changes: [{ op: 'replace_paragraph', page: 1, paragraph: 3, text: 'I would love the job.' }] });
  let d = await (await get('/api/documents/doc-22222221')).json();
  assert.equal(d.pending, true);
  assert.deepEqual(d.changes, [{ type: 'changed', page: 1, before: 'I would like the job.', after: 'I would love the job.' }]);
  assert.match(d.pendingNote, /Changed paragraph 3 on page 1/);
  assert.equal((await (await get('/api/documents')).json()).documents[0].pending, true);

  const rej = await (await post('/api/documents/doc-22222221/review', { action: 'reject' })).json();
  assert.equal(rej.pending, false);
  assert.deepEqual(rej.changes, []);
  assert.match(await tools.read({ doc: 'cover letter' }), /I would like the job\./);
  assert.deepEqual(rej.versions.map((v) => v.status), ['approved', 'rejected', 'approved'], 'the rejected version stays in the history');

  await tools.edit({ doc: 'cover letter', changes: [{ op: 'delete_page', page: 3 }] });
  const ok = await (await post('/api/documents/doc-22222221/review', { action: 'approve' })).json();
  assert.equal(ok.pending, false);
  assert.equal(ok.pages, 2);
  assert.equal((await post('/api/documents/doc-22222221/review', { action: 'approve' })).status, 400, 'nothing left to answer');
  assert.equal((await post('/api/documents/doc-22222221/review', { action: 'maybe' })).status, 400);
  s.stop();
});

test('phase 3: dragging pages on the phone saves the new order into the document and the Word file', async () => {
  const { s, get, post, tools, store } = await make();
  await tools.create({ title: 'Cover letter', pages: PAGES });
  const moved = await (await post('/api/documents/doc-22222221/reorder', { order: [2, 0, 1] })).json();
  assert.deepEqual(moved.pageList.map((p) => p.excerpt), ['Page three text.', 'Cover letter Dear Sir, I would like the job.', 'Page two text.']);
  assert.equal(moved.version, 2);
  assert.match(await tools.read({ doc: 'cover letter' }), /Page 1:\n {2}\[1\] \(paragraph\) Page three text\./);
  const doc = store.find('cover letter');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(doc.folder, '.relay', 'versions', 'v2.json'), 'utf8')).pages, [PAGES[2], PAGES[0], PAGES[1]], 'the order is saved with the version');
  assert.ok(fs.existsSync(path.join(doc.folder, 'Cover letter.docx')), 'and the Word file was made again from it');
  const img = await get('/api/documents/doc-22222221/page/0.png');
  assert.equal(Buffer.from(await img.arrayBuffer()).toString(), 'PNG:Page three text.', 'the first picture is the page that moved to the front');
  for (const bad of [[0, 1], [0, 0, 1], [0, 1, 7], 'x', null]) assert.equal((await post('/api/documents/doc-22222221/reorder', { order: bad })).status, 400, JSON.stringify(bad));
  assert.equal((await post('/api/documents/doc-22222221/reorder', { order: [0, 1, 2] })).status, 200, 'the same order changes nothing');
  assert.equal((await (await get('/api/documents/doc-22222221')).json()).version, 2);
  s.stop();
});

test('moving pages is refused while a change waits, and the phone is told why', async () => {
  const { s, post, tools } = await make();
  await tools.create({ title: 'Cover letter', pages: PAGES });
  await tools.edit({ doc: 'cover letter', changes: [{ op: 'replace_page', page: 2, text: 'New.' }] });
  const r = await post('/api/documents/doc-22222221/reorder', { order: [1, 0, 2] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Approve or reject/);
  s.stop();
});

// The app's own wiring: the controller hands the phone's server the documents, and the tools get them too.
test('the controller builds the documents service in the Documents/Relay Documents folder and hands the phone its API', () => {
  const real = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: { getPrimaryDisplay: () => ({}) }, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, safeStorage: {}, clipboard: {}, nativeImage: {}, shell: {}, dialog: {}, powerMonitor: {}, Menu: {}, Tray: class {}, globalShortcut: {}, session: {}, net: {} } : real.call(this, req, ...rest); };
  let AskController;
  try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }
  const c = Object.create(AskController.prototype);
  c.holos = { holos: new Map() };
  c.mac = { revealPath: async () => {} };
  const svc = c.documentsService();
  assert.ok(svc instanceof DocumentsService);
  assert.equal(c.documentsService(), svc, 'one service');
  assert.ok(svc.store.dir.endsWith(path.join('Documents', 'Relay Documents')));
  assert.deepEqual(Object.keys(c.remoteDocs()).sort(), ['detail', 'hologram', 'list', 'page', 'reorder', 'review']);
  assert.deepEqual(Object.keys(svc.tools()).sort(), ['create', 'edit', 'hologram', 'list', 'read', 'review']);
});
