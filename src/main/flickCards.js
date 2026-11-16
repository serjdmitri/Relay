// A photo flicked from the phone, shown as a plain card on the Mac with a few buttons: save a copy, share, crop, change the file type, rename, copy, show in Finder, move to the Trash.
// The card lands on the side of the screen the phone was flicked towards. The photo itself is already in Downloads; every button works on that file.
// Electron's pieces are passed in so all of it is tested without a screen.

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|tiff?)$/i;
const SHOWABLE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']); // what the card's page can draw as it is (the rest gets a JPEG preview)
const FORMATS = { jpg: 'jpeg', png: 'png', heic: 'heic', tiff: 'tiff' }; // "change file type": what each choice is called for sips
const SIDES = ['left', 'right', 'up', 'down'];

const extOf = (file) => path.extname(String(file)).slice(1).toLowerCase().replace('jpeg', 'jpg').replace(/^tif$/, 'tiff');

// A name someone typed, made safe: no slashes or control characters, no second extension, the real extension kept. '' when nothing usable is left.
function cleanName(input, ext) {
  const base = String(input || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[/\\:]/g, ' ').replace(IMAGE_EXT, '').replace(/^[\s.]+/, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return base ? `${base}.${ext}` : '';
}

// A path in dir that does not exist yet: "name.jpg", then "name 2.jpg", "name 3.jpg"...
function uniquePath(dir, base, ext, exists = fs.existsSync) {
  let p = path.join(dir, `${base}.${ext}`), n = 2;
  while (exists(p)) p = path.join(dir, `${base} ${n++}.${ext}`);
  return p;
}

// Where a card of this size goes on a screen's work area for a flick towards `dir`. Later cards on the same side are moved a little (step) so they do not hide each other.
function landing(dir, area, { width, height }, margin = 18, step = 0) {
  const off = (step % 5) * 26;
  let x = area.x + (area.width - width) / 2, y = area.y + (area.height - height) / 2;
  if (dir === 'left') x = area.x + margin; else if (dir === 'right') x = area.x + area.width - width - margin;
  else if (dir === 'up') y = area.y + margin; else if (dir === 'down') y = area.y + area.height - height - margin;
  x += dir === 'right' ? -off : off; y += dir === 'down' ? -off : off;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  return { x: Math.round(clamp(x, area.x, area.x + area.width - width)), y: Math.round(clamp(y, area.y, area.y + area.height - height)), width, height };
}

// The size the picture is drawn at inside the card (never larger than the box), and the card around it.
function fit(w, h, { maxW = 344, maxH = 360, chrome = 224, width = 372 } = {}) {
  if (!(w > 0) || !(h > 0)) { w = 4; h = 3; }
  const s = Math.min(maxW / w, maxH / h);
  const imgW = Math.max(40, Math.round(w * s)), imgH = Math.max(40, Math.round(h * s));
  return { imgW, imgH, width, height: imgH + chrome };
}

const isImageBytes = (b) => b.length > 8 && ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47));

class FlickCards {
  constructor({ BrowserWindow, screen, ipcMain, shell, clipboard, ClipboardItem, nativeImage, dialog, ShareMenu, preload, page, motion = null, previewDir = path.join(os.tmpdir(), 'relay-flick-preview'), run = execFile, fsApi = fs, log = () => {}, margin = 18 }) {
    Object.assign(this, { BrowserWindow, screen, shell, clipboard, ClipboardItem, nativeImage, dialog, ShareMenu, preload, page, motion, previewDir, run, fsApi, log, margin });
    this.cards = new Map(); // window contents id -> card
    this.opened = 0;
    ipcMain.handle('flickcard:act', (event, req) => this.act(event.sender.id, req));
  }

  // A picture the card's page can draw: the file itself, or a JPEG made from it (HEIC, TIFF).
  async preview(file) {
    if (SHOWABLE.has(extOf(file))) return file;
    try {
      this.fsApi.mkdirSync(this.previewDir, { recursive: true });
      const out = path.join(this.previewDir, `${crypto.createHash('sha1').update(file + ':' + (this.fsApi.statSync(file).mtimeMs || 0)).digest('hex').slice(0, 16)}.jpg`);
      if (!this.fsApi.existsSync(out)) await new Promise((resolve, reject) => this.run('/usr/bin/sips', ['-s', 'format', 'jpeg', file, '--out', out], { timeout: 30000 }, (err) => (err ? reject(err) : resolve())));
      return out;
    } catch { return ''; }
  }

  // Shows the photo (a file in Downloads) as a card on the side the phone was flicked towards. Resolves with the card id.
  async show({ file, dir = 'center' }) {
    const preview = await this.preview(file);
    const win = new this.BrowserWindow({
      width: 372, height: 520, show: false, frame: false, transparent: true, hasShadow: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, fullscreenable: false,
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    const card = { id: crypto.randomUUID(), win, file, preview, dir: SIDES.includes(dir) ? dir : 'center', shown: false, step: this.opened++ };
    const wid = win.webContents.id;
    this.cards.set(wid, card);
    win.on('closed', () => this.cards.delete(wid));
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.motion?.watchWindow(win, this.target(card)); // dragging with the mouse, flicking it into the corner trash, and hand grabs all go through the shared floating-card motion
    win.webContents.once('did-finish-load', () => this.push(card));
    await win.loadFile(this.page);
    return card.id;
  }

  // What the shared floating-card motion moves (the key makes it one card's drag).
  target(card) { return { key: `flick:${card.id}`, close: () => { if (!card.win.isDestroyed()) card.win.close(); } }; }

  // The card under a point on the screen, for a hand grab (a fist or pinch held on it moves it).
  handTarget(point) {
    for (const card of [...this.cards.values()].reverse()) {
      const w = card.win;
      if (w.isDestroyed() || !w.isVisible()) continue;
      const b = w.getBounds();
      if (point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height) {
        return { ...this.target(card), alive: () => !w.isDestroyed(), position: () => w.getBounds(), move: (x, y) => { if (!w.isDestroyed()) w.setPosition(Math.round(x), Math.round(y)); } };
      }
    }
    return null;
  }

  state(card) {
    let size = 0; try { size = this.fsApi.statSync(card.file).size; } catch { /* gone */ }
    const name = path.basename(card.file), ext = extOf(card.file);
    const s = { name, base: name.slice(0, name.length - ext.length - 1) || name, ext, size, url: pathToFileURL(card.preview || card.file).href + '?v=' + Date.now() };
    if (!card.introSent) { // the first time only: the picture's bytes, for the hologram reveal (the page cannot read the pixels of a file it shows)
      card.introSent = true;
      try {
        const p = card.preview || card.file, bytes = this.fsApi.readFileSync(p), e = extOf(p);
        if (bytes.length <= 40 * 1024 * 1024) Object.assign(s, { intro: true, bytes, mime: e === 'png' ? 'image/png' : e === 'gif' ? 'image/gif' : e === 'webp' ? 'image/webp' : 'image/jpeg' });
      } catch { /* it simply appears without the reveal */ }
    }
    return s;
  }

  push(card) { try { if (!card.win.isDestroyed()) card.win.webContents.send('flickcard:state', this.state(card)); } catch { /* closing */ } }

  // The page reports how big the picture really is (it knows about the photo's rotation), so the card is sized to fit it and shown.
  fitWindow(card, w, h) {
    const f = fit(w, h);
    const area = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint()).workArea;
    if (!card.shown) {
      card.shown = true;
      const target = landing(card.dir, area, f, this.margin, card.step);
      const middle = landing('center', area, f, this.margin, 0);
      card.win.setBounds(middle); card.win.showInactive(); card.win.setBounds(target, true);
    } else {
      const b = card.win.getBounds();
      card.win.setBounds({ x: b.x, y: b.y, width: f.width, height: f.height });
    }
    return { ok: true, imgW: f.imgW, imgH: f.imgH };
  }

  async act(senderId, req = {}) {
    const card = this.cards.get(senderId);
    if (!card || card.win.isDestroyed()) return { ok: false, error: 'This photo is closed.' };
    const fail = (error) => ({ ok: false, error });
    try {
      switch (String(req.action)) {
        case 'loaded': return this.fitWindow(card, Number(req.w) || 0, Number(req.h) || 0);
        case 'close': card.win.close(); return { ok: true };
        case 'reveal': this.shell.showItemInFolder(card.file); return { ok: true };
        case 'open': await this.shell.openPath(card.file); return { ok: true };
        case 'copy': { // the page draws the picture the right way up (it knows the photo's rotation) and sends it as a PNG; without that, the file is read here
          let png = Buffer.from(req.bytes || []);
          if (!isImageBytes(png) || png.length > 80 * 1024 * 1024) {
            const img = this.nativeImage.createFromPath(card.preview || card.file);
            png = img.isEmpty() ? null : img.toPNG();
          }
          if (!png) return fail('Could not copy that photo.');
          await this.clipboard.write([new this.ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
          return { ok: true, message: 'Copied.' };
        }
        case 'share': {
          const m = new this.ShareMenu({ filePaths: [card.file] });
          m.popup({ window: card.win, x: Math.round(Number(req.x) || 0), y: Math.round(Number(req.y) || 0) });
          return { ok: true };
        }
        case 'save': { // a copy wherever you choose
          const r = await this.dialog.showSaveDialog(card.win, { defaultPath: path.join(os.homedir(), 'Pictures', path.basename(card.file)), buttonLabel: 'Save' });
          if (r.canceled || !r.filePath) return { ok: true, message: '' };
          this.fsApi.copyFileSync(card.file, r.filePath);
          return { ok: true, message: `Saved to ${path.basename(path.dirname(r.filePath))}.` };
        }
        case 'rename': {
          const ext = extOf(card.file), clean = cleanName(req.name, ext);
          if (!clean) return fail('Type a name for it.');
          const to = path.join(path.dirname(card.file), clean);
          if (to === card.file) return { ok: true, message: '' };
          if (this.fsApi.existsSync(to)) return fail('A file with that name is already there.');
          this.fsApi.renameSync(card.file, to);
          if (card.preview === card.file) card.preview = to; // a picture drawn from the file itself follows it to its new name
          card.file = to; this.push(card);
          return { ok: true, message: 'Renamed.' };
        }
        case 'convert': {
          const format = String(req.format || '').toLowerCase();
          if (!FORMATS[format]) return fail('That file type is not available.');
          if (extOf(card.file) === format) return { ok: true, message: `It is already a ${format.toUpperCase()}.` };
          const base = path.basename(card.file, path.extname(card.file));
          const out = uniquePath(path.dirname(card.file), base, format, (p) => this.fsApi.existsSync(p));
          await new Promise((resolve, reject) => this.run('/usr/bin/sips', ['-s', 'format', FORMATS[format], card.file, '--out', out], { timeout: 30000 }, (err) => (err ? reject(err) : resolve())));
          if (!this.fsApi.existsSync(out)) return fail('Could not change the file type.');
          card.file = out; card.preview = await this.preview(out); this.push(card);
          return { ok: true, message: `Now a ${format.toUpperCase()} (the original is still there).` };
        }
        case 'crop': case 'erase': { // the page cut the picture out (crop) or painted objects out of it (erase); this keeps the result beside the original, which is never touched
          const erase = req.action === 'erase';
          const bytes = Buffer.from(req.bytes || []);
          if (!isImageBytes(bytes) || bytes.length > 60 * 1024 * 1024) return fail(erase ? 'Could not clean that up.' : 'Could not crop that.');
          const ext = req.type === 'png' ? 'png' : 'jpg';
          const base = path.basename(card.file, path.extname(card.file)).replace(/ (cropped|cleaned)( \d+)?$/, '');
          const out = uniquePath(path.dirname(card.file), `${base} ${erase ? 'cleaned' : 'cropped'}`, ext, (p) => this.fsApi.existsSync(p));
          this.fsApi.writeFileSync(out, bytes, { mode: 0o600, flag: 'wx' });
          card.file = out; card.preview = out; this.push(card);
          return { ok: true, message: erase ? 'Cleaned up (the original is still there).' : 'Cropped (the original is still there).' };
        }
        case 'trash': await this.shell.trashItem(card.file); card.win.close(); return { ok: true };
        default: return fail('Unknown button.');
      }
    } catch (e) { this.log('flick-card', `${req.action} failed: ${String(e.message || e).slice(0, 120)}`); return fail('That did not work.'); }
  }
}

module.exports = { FlickCards, cleanName, uniquePath, landing, fit, extOf };
