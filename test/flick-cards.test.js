const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FlickCards, cleanName, uniquePath, landing, fit, extOf } = require('../src/main/flickCards');

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);

test('names are made safe and keep the real extension; a taken name gets a number', () => {
  assert.equal(extOf('/a/IMG_1.JPEG'), 'jpg'); assert.equal(extOf('/a/b.heic'), 'heic'); assert.equal(extOf('/a/b.tif'), 'tiff');
  assert.equal(cleanName('Holiday', 'jpg'), 'Holiday.jpg');
  assert.equal(cleanName('Holiday.png', 'jpg'), 'Holiday.jpg', 'typing another extension does not change the type');
  assert.equal(cleanName('../../etc/passwd', 'jpg'), 'etc passwd.jpg', 'no way out of the folder');
  assert.equal(cleanName('  ..hidden\u0000 ', 'jpg'), 'hidden.jpg');
  assert.equal(cleanName('   ', 'jpg'), ''); assert.equal(cleanName('.jpg', 'jpg'), '');
  assert.equal(cleanName('x'.repeat(300), 'png').length, 124);
  const taken = new Set(['/d/a.jpg', '/d/a 2.jpg']);
  assert.equal(uniquePath('/d', 'a', 'jpg', (p) => taken.has(p)), '/d/a 3.jpg');
});

test('the card lands on the side it was flicked towards, stays on the screen, and later cards are moved a little', () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 }, size = { width: 372, height: 500 };
  const centreY = Math.round(25 + (875 - 500) / 2);
  assert.deepEqual(landing('right', area, size), { x: 1440 - 372 - 18, y: centreY, width: 372, height: 500 });
  assert.equal(landing('left', area, size).x, 18);
  assert.equal(landing('up', area, size).y, 25 + 18);
  assert.equal(landing('down', area, size).y, 25 + 875 - 500 - 18);
  const mid = landing('center', area, size); assert.equal(mid.x, (1440 - 372) / 2); assert.equal(mid.y, centreY);
  assert.equal(landing('right', area, size, 18, 1).x, landing('right', area, size, 18, 0).x - 26, 'the next card on that side sits a little further in');
  assert.equal(landing('left', { x: 0, y: 0, width: 300, height: 300 }, size).x, 0, 'a card bigger than the screen is kept at its corner');
  const f = fit(4000, 3000); assert.equal(f.imgW, 344); assert.equal(f.imgH, 258); assert.equal(f.height, 258 + 182);
  assert.ok(fit(3000, 4000).imgH <= 360); assert.equal(fit(0, 0).imgW > 0, true);
});

function setup(fileName = 'IMG_1.jpg', bytes = JPG) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flickcards-'));
  const file = path.join(dir, fileName); fs.writeFileSync(file, bytes);
  const handlers = {}, calls = [], sent = [];
  const win = {
    webContents: { id: 7, once() {}, send: (c, s) => sent.push([c, s]) }, destroyed: false, bounds: [], shown: false, isVisible: () => true, setPosition: (x, y) => calls.push(['pos', x, y]),
    isDestroyed() { return this.destroyed; }, close() { this.destroyed = true; calls.push(['close']); }, on() {}, setAlwaysOnTop() {}, setVisibleOnAllWorkspaces() {},
    setBounds(b, animate) { this.bounds.push([b, !!animate]); }, getBounds() { return { x: 100, y: 120, width: 372, height: 440 }; }, showInactive() { this.shown = true; }, loadFile: async (p) => { calls.push(['load', p]); }
  };
  const run = (cmd, args, opts, cb) => { calls.push([cmd, ...args]); const out = args[args.indexOf('--out') + 1]; fs.writeFileSync(out, JPG); cb(null); };
  const cards = new FlickCards({
    BrowserWindow: function () { return win; }, screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 25, width: 1440, height: 875 } }) },
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, preload: '/p/preload.js', page: '/p/flick-card.html', previewDir: path.join(dir, 'preview'), run,
    shell: { showItemInFolder: (f) => calls.push(['reveal', f]), openPath: async (f) => calls.push(['open', f]), trashItem: async (f) => { calls.push(['trash', f]); fs.rmSync(f); } },
    clipboard: { write: async (items) => { calls.push(['copy', items[0].types, items[0].blob.size, items[0].blob.type]); } }, ClipboardItem: function (o) { this.types = Object.keys(o); this.blob = o['image/png']; },
    nativeImage: { createFromPath: (p) => ({ isEmpty: () => !fs.existsSync(p), toPNG: () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(5, 9)]) }) },
    motion: { watchWindow: (w, t) => calls.push(['watch', t.key]) },
    dialog: { showSaveDialog: async () => { fs.mkdirSync(path.join(dir, 'Saved')); return { canceled: false, filePath: path.join(dir, 'Saved', 'copy.jpg') }; } },
    ShareMenu: function (item) { calls.push(['share', item.filePaths]); this.popup = (o) => calls.push(['popup', o.x, o.y]); }
  });
  const act = (req, id = 7) => handlers['flickcard:act']({ sender: { id } }, req);
  return { dir, file, cards, win, calls, sent, act, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a card is created, shown once the page says how big the picture is, and lands on the flicked side', async () => {
  const t = setup();
  const id = await t.cards.show({ file: t.file, dir: 'right' });
  assert.ok(id); assert.deepEqual(t.calls.find((c) => c[0] === 'load'), ['load', '/p/flick-card.html']);
  assert.equal(t.win.shown, false, 'not shown before the picture is measured');
  const card = t.cards.cards.get(7), first = t.cards.state(card);
  assert.equal(first.intro, true, 'the first time, the page gets the picture for the hologram reveal'); assert.equal(first.mime, 'image/jpeg'); assert.ok(Buffer.isBuffer(first.bytes) && first.bytes.equals(JPG));
  const later = t.cards.state(card); assert.equal(later.intro, undefined); assert.equal(later.bytes, undefined, 'not again after a rename, crop or type change');
  const r = await t.act({ action: 'loaded', w: 3000, h: 4000 });
  assert.equal(r.ok, true); assert.equal(t.win.shown, true);
  assert.ok(r.imgH <= 360 && r.imgW < r.imgH, 'a tall photo is drawn tall');
  const last = t.win.bounds.at(-1);
  assert.equal(last[1], true, 'it slides to its place'); assert.equal(last[0].x, 1440 - 372 - 18);
  await t.act({ action: 'loaded', w: 4000, h: 3000 });
  assert.equal(t.win.bounds.at(-1)[0].x, 100, 'a second measuring (after a crop) resizes in place');
  assert.equal((await t.act({ action: 'loaded', w: 1, h: 1 }, 99)).ok, false, 'only the card itself can press its buttons');
  assert.deepEqual(t.calls.find((c) => c[0] === 'watch'), ['watch', `flick:${id}`], 'it moves like the other floating cards (mouse, throw to the trash)');
  assert.equal(t.cards.handTarget({ x: 5000, y: 5000 }), null, 'a hand away from the card grabs nothing');
  const grab = t.cards.handTarget({ x: 150, y: 200 });
  assert.equal(grab.key, `flick:${id}`); assert.deepEqual(grab.position(), { x: 100, y: 120, width: 372, height: 440 });
  grab.move(300.4, 210.6); assert.deepEqual(t.calls.find((c) => c[0] === 'pos'), ['pos', 300, 211], 'a hand grab moves the card');
  t.cleanup();
});

test('rename keeps the type, stays in Downloads and never overwrites', async () => {
  const t = setup();
  await t.cards.show({ file: t.file, dir: 'left' });
  assert.equal((await t.act({ action: 'rename', name: '' })).ok, false);
  const r = await t.act({ action: 'rename', name: '../Beach day.png' });
  assert.equal(r.ok, true); const now = path.join(t.dir, 'Beach day.jpg');
  assert.equal(fs.existsSync(now), true); assert.equal(fs.existsSync(t.file), false);
  assert.equal(t.sent.at(-1)[1].name, 'Beach day.jpg', 'the card is told the new name');
  assert.match(t.sent.at(-1)[1].url, /Beach%20day\.jpg\?v=/, 'and draws the picture from the renamed file, not the old path');
  fs.writeFileSync(path.join(t.dir, 'Other.jpg'), JPG);
  assert.equal((await t.act({ action: 'rename', name: 'Other' })).ok, false, 'an existing file is not replaced');
  assert.equal(fs.existsSync(now), true);
  t.cleanup();
});

test('change file type makes a new file beside the original; crop keeps the cut-out beside it', async () => {
  const t = setup();
  await t.cards.show({ file: t.file, dir: 'up' });
  assert.equal((await t.act({ action: 'convert', format: 'exe' })).ok, false);
  assert.match((await t.act({ action: 'convert', format: 'jpg' })).message, /already/);
  const c = await t.act({ action: 'convert', format: 'png' });
  assert.equal(c.ok, true); assert.equal(fs.existsSync(path.join(t.dir, 'IMG_1.png')), true); assert.equal(fs.existsSync(t.file), true, 'the original stays');
  assert.deepEqual(t.calls.find((x) => x[0] === '/usr/bin/sips').slice(0, 4), ['/usr/bin/sips', '-s', 'format', 'png']);
  assert.equal(t.sent.at(-1)[1].ext, 'png');
  const bad = await t.act({ action: 'crop', bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), type: 'jpg' });
  assert.equal(bad.ok, false, 'only real picture bytes are written');
  const ok = await t.act({ action: 'crop', bytes: new Uint8Array(JPG), type: 'jpg' });
  assert.equal(ok.ok, true); assert.equal(fs.existsSync(path.join(t.dir, 'IMG_1 cropped.jpg')), true);
  assert.equal(fs.readFileSync(path.join(t.dir, 'IMG_1 cropped.jpg')).equals(JPG), true);
  t.cleanup();
});

test('a HEIC photo is drawn from a JPEG preview; save as, share, copy, Finder and Trash do their one thing', async () => {
  const t = setup('IMG_2.heic', Buffer.alloc(30, 3));
  assert.notEqual(await t.cards.preview(t.file), t.file, 'HEIC is not drawn as it is');
  assert.equal(await t.cards.preview(path.join(t.dir, 'x.jpg')), path.join(t.dir, 'x.jpg'), 'a JPEG is');
  await t.cards.show({ file: t.file, dir: 'down' });
  const s = await t.act({ action: 'save' }); assert.equal(s.ok, true);
  assert.equal(fs.readFileSync(path.join(t.dir, 'Saved', 'copy.jpg')).length, 30, 'a copy is saved where chosen');
  await t.act({ action: 'share', x: 40.4, y: 300.6 });
  assert.deepEqual(t.calls.filter((c) => c[0] === 'share' || c[0] === 'popup'), [['share', [t.file]], ['popup', 40, 301]]);
  const PNGB = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  assert.equal((await t.act({ action: 'copy', bytes: PNGB })).ok, true);
  assert.deepEqual(t.calls.filter((c) => c[0] === 'copy').at(-1), ['copy', ['image/png'], 11, 'image/png'], 'the picture the page drew goes on the clipboard as a PNG');
  assert.equal((await t.act({ action: 'copy' })).ok, true, 'without it the file is read instead');
  assert.equal(t.calls.filter((c) => c[0] === 'copy').at(-1)[2], 13);
  await t.act({ action: 'reveal' }); assert.deepEqual(t.calls.find((c) => c[0] === 'reveal'), ['reveal', t.file]);
  assert.equal((await t.act({ action: 'nonsense' })).ok, false);
  await t.act({ action: 'trash' });
  assert.deepEqual(t.calls.find((c) => c[0] === 'trash'), ['trash', t.file]); assert.equal(t.win.destroyed, true, 'the card closes after the photo is in the Trash');
  t.cleanup();
});

test('erase keeps the cleaned picture beside the original as "<name> cleaned", never touches the original, and refuses what is not a picture', async () => {
  const t = setup('IMG_5.jpg');
  await t.cards.show({ file: t.file, dir: 'left' });
  const before = fs.readFileSync(t.file);
  const CLEAN = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 7)]);
  assert.equal((await t.act({ action: 'erase', bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), type: 'jpg' })).ok, false);
  const ok = await t.act({ action: 'erase', bytes: new Uint8Array(CLEAN), type: 'jpg' });
  assert.equal(ok.ok, true); assert.match(ok.message, /original is still there/);
  const out = path.join(t.dir, 'IMG_5 cleaned.jpg');
  assert.equal(fs.readFileSync(out).equals(CLEAN), true); assert.equal(fs.readFileSync(t.file).equals(before), true, 'the original is untouched');
  assert.equal(t.sent.at(-1)[1].name, 'IMG_5 cleaned.jpg', 'the card now shows the cleaned picture');
  const again = await t.act({ action: 'erase', bytes: new Uint8Array(CLEAN), type: 'png' });
  assert.equal(again.ok, true); assert.equal(fs.existsSync(path.join(t.dir, 'IMG_5 cleaned.png')), true, 'cleaning a cleaned picture does not stack names');
  assert.equal(fs.statSync(out).mode & 0o111, 0);
  t.cleanup();
});

test('the card page has an Erase mode: a brush over the picture, mapped to the real pixels, filled by the shared inpaint code', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src/renderer', f), 'utf8');
  const html = read('flick-card.html'), js = read('flick-card.js');
  assert.match(html, /<script src="inpaint\.js">/); assert.match(html, /data-mode="erase"/); assert.match(html, /id="remove"/);
  assert.match(js, /window\.Inpaint\.inpaint/); assert.match(js, /action: 'erase'/); assert.match(js, /drawImage\(pic, 0, 0, W, H\)/, 'drawn from the picture, so its rotation is respected');
  assert.match(html, /#imgwrap\.erasing \{[^}]*no-drag/, 'brush strokes do not drag the card');
});

test('extend keeps the grown picture beside the original as "<name> extended", and the page has an Extend mode that says what it really does', async () => {
  const t = setup('IMG_6.jpg');
  await t.cards.show({ file: t.file, dir: 'up' });
  const BIG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 3)]);
  const ok = await t.act({ action: 'extend', bytes: new Uint8Array(BIG), type: 'jpg' });
  assert.equal(ok.ok, true); assert.match(ok.message, /^Extended/);
  assert.equal(fs.readFileSync(path.join(t.dir, 'IMG_6 extended.jpg')).equals(BIG), true); assert.equal(fs.readFileSync(t.file).equals(JPG), true);
  assert.equal((await t.act({ action: 'extend', bytes: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9]), type: 'jpg' })).ok, false);
  t.cleanup();
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src/renderer', f), 'utf8');
  assert.match(read('flick-card.html'), /data-mode="extend"/); assert.match(read('flick-card.html'), /adds no new objects/); assert.match(read('flick-card.js'), /window\.Inpaint\.extend/);
});
