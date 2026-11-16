const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeLidItems, parsePaths, mimeFor } = require('../src/main/lidItems');
const { LidStore, safeMime, MAX_BYTES } = require('../src/main/remote/lidStore');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lid-items-'));
const image = (bytes, empty = false) => ({ isEmpty: () => empty, toPNG: () => Buffer.from(bytes) });

test('the Finder selection: the first regular file is read; folders and missing paths are skipped', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'folder'));
  fs.writeFileSync(path.join(dir, 'Report.PDF'), '%PDF-1.4');
  const exec = async (cmd, args) => { assert.equal(cmd, 'osascript'); assert.ok(args.includes('-e')); return `${path.join(dir, 'folder')}\n/no/such/file\n${path.join(dir, 'Report.PDF')}\n`; };
  const item = await makeLidItems({ exec, clipboard: {} }).finder();
  assert.equal(item.name, 'Report.PDF');
  assert.equal(item.mime, 'application/pdf');
  assert.equal(item.kind, 'file');
  assert.equal(item.bytes.toString(), '%PDF-1.4');
});

test('a selected picture is an image; an empty selection, an empty file and a failed lookup send nothing', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.jpg'), 'x');
  fs.writeFileSync(path.join(dir, 'empty.txt'), '');
  const items = (out) => makeLidItems({ exec: async () => out, clipboard: {} });
  assert.equal((await items(`${path.join(dir, 'a.jpg')}\n`).finder()).kind, 'image');
  assert.equal(await items('').finder(), null);
  assert.equal(await items(`${path.join(dir, 'empty.txt')}\n`).finder(), null);
  await assert.rejects(makeLidItems({ exec: async () => { throw new Error('not allowed'); }, clipboard: {} }).finder());
});

test('a file over 30 MB is not sent', async () => {
  const dir = tmp(), file = path.join(dir, 'big.bin');
  fs.writeFileSync(file, '');
  fs.truncateSync(file, MAX_BYTES + 1);
  assert.equal(await makeLidItems({ exec: async () => file + '\n', clipboard: {} }).finder(), null);
});

test('the clipboard: a picture first, else text, else nothing', async () => {
  const make = (c) => makeLidItems({ exec: async () => '', clipboard: c, now: () => new Date('2026-11-16T10:20:30Z') });
  const pic = await make({ readImage: () => image([1, 2, 3]), readText: () => 'words' }).clipboard();
  assert.equal(pic.kind, 'image');
  assert.equal(pic.name, 'Clipboard 2026-11-16-10-20-30.png');
  const text = await make({ readImage: () => image([], true), readText: () => 'words' }).clipboard();
  assert.deepEqual([text.kind, text.name, text.bytes.toString()], ['text', 'Clipboard.txt', 'words']);
  assert.equal(await make({ readImage: () => image([], true), readText: () => '  \n' }).clipboard(), null);
});

test("Relay's own window: captured when it is showing, nothing when it is hidden, minimised or gone", async () => {
  const win = (o = {}) => ({ isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, webContents: { capturePage: async () => image([9, 9]) }, ...o });
  const shot = (w) => makeLidItems({ exec: async () => '', clipboard: {}, getWindow: () => w, now: () => new Date('2026-11-16T10:20:30Z') }).screenshot();
  const ok = await shot(win());
  assert.deepEqual([ok.kind, ok.mime, ok.name], ['image', 'image/png', 'Relay window 2026-11-16-10-20-30.png']);
  assert.equal(await shot(null), null);
  assert.equal(await shot(win({ isVisible: () => false })), null);
  assert.equal(await shot(win({ isMinimized: () => true })), null);
  assert.equal(await shot(win({ isDestroyed: () => true })), null);
  assert.equal(await shot(win({ webContents: { capturePage: async () => image([], true) } })), null);
});

test('paths and types', () => {
  assert.deepEqual(parsePaths('/a/b\n\nnot a path\n /c d/e \n'), ['/a/b', '/c d/e']);
  assert.equal(mimeFor('/x/y.HEIC'), 'image/heic');
  assert.equal(mimeFor('/x/y.weird'), 'application/octet-stream');
});

// ---- the store the phone fetches from ----
test('only types a phone shows safely keep their type', () => {
  assert.equal(safeMime('application/pdf'), 'application/pdf');
  assert.equal(safeMime('IMAGE/PNG; charset=x'), 'image/png');
  assert.equal(safeMime('text/html'), 'text/plain');
  assert.equal(safeMime('image/svg+xml'), 'text/plain');
  assert.equal(safeMime('application/x-sh'), 'application/octet-stream');
  assert.equal(safeMime(undefined), 'application/octet-stream');
});

test('the store keeps the last few things for a while, and cleans names', () => {
  let t = 1000, n = 0;
  const s = new LidStore({ max: 2, ttlMs: 60000, now: () => t, newId: () => `id${++n}` });
  const a = s.add({ kind: 'file', name: '../../etc/passwd\n', mime: 'text/html', bytes: Buffer.from('a') });
  assert.equal(a.ok, true);
  assert.equal(a.meta.name, '.. .. etc passwd');
  assert.equal(a.meta.mime, 'text/plain');
  s.add({ kind: 'text', name: 'b', mime: 'text/plain', bytes: Buffer.from('bb') });
  s.add({ kind: 'weird', name: '', mime: 'image/png', bytes: Buffer.from('ccc') });
  assert.deepEqual(s.list().map((m) => [m.id, m.size, m.kind, m.name]), [['id3', 3, 'file', 'From your Mac'], ['id2', 2, 'text', 'b']], 'newest first, only two kept');
  assert.equal(s.get('id1'), null);
  assert.equal(s.get('id2').bytes.toString(), 'bb');
  t += 61000;
  assert.deepEqual(s.list(), []);
  assert.equal(s.get('id3'), null);
});

test('the store refuses nothing and too much', () => {
  const s = new LidStore();
  assert.deepEqual(s.add({ kind: 'file', bytes: Buffer.alloc(0) }), { ok: false, reason: 'nothing' });
  assert.deepEqual(s.add(null), { ok: false, reason: 'nothing' });
  assert.deepEqual(s.add({ kind: 'file', name: 'x', bytes: Buffer.alloc(MAX_BYTES + 1) }), { ok: false, reason: 'too-big' });
});
