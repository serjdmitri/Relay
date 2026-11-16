// What a lid flick can send, gathered only at the moment of the flick: the file selected in Finder, what is on the clipboard, or a picture of Relay's own window.
// Each gatherer resolves to { kind: 'file'|'image'|'text', name, mime, bytes } or null when there is nothing to send. The Mac's pieces are passed in so this can be tested.

const path = require('path');
const { MAX_BYTES } = require('./remote/lidStore');

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf', txt: 'text/plain', md: 'text/plain', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4', mov: 'video/quicktime' };
const mimeFor = (file) => MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';

// The selected files in Finder, as POSIX paths one per line (nothing when nothing is selected).
const FINDER_SCRIPT = [
  'tell application "Finder"',
  'set sel to selection',
  'if (count of sel) is 0 then return ""',
  'set out to ""',
  'repeat with f in sel',
  'set out to out & POSIX path of (f as alias) & linefeed',
  'end repeat',
  'return out',
  'end tell'
];

const parsePaths = (out) => String(out || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/'));
const stamp = (d) => d.toISOString().slice(0, 19).replace(/[T:]/g, '-');

// exec(file, args) -> stdout text; fs: node's fs (or a stand-in); clipboard: Electron's; getWindow() -> Relay's own window or null
function makeLidItems({ exec, fs = require('fs'), clipboard, getWindow, now = () => new Date() }) {
  return {
    // The first regular file that is selected in Finder (folders are skipped; a file over 30 MB too).
    async finder() {
      const args = []; for (const l of FINDER_SCRIPT) args.push('-e', l);
      for (const p of parsePaths(await exec('osascript', args))) {
        try {
          const real = fs.realpathSync(p), st = fs.statSync(real);
          if (!st.isFile() || st.size === 0 || st.size > MAX_BYTES) continue;
          const mime = mimeFor(real);
          return { kind: mime.startsWith('image/') ? 'image' : 'file', name: path.basename(real), mime, bytes: fs.readFileSync(real) };
        } catch { /* unreadable: try the next one */ }
      }
      return null;
    },

    // A picture on the clipboard, else its text.
    async clipboard() {
      const img = clipboard.readImage?.();
      if (img && !img.isEmpty()) { const bytes = img.toPNG(); if (bytes?.length) return { kind: 'image', name: `Clipboard ${stamp(now())}.png`, mime: 'image/png', bytes }; }
      const text = String(clipboard.readText?.() || '');
      return text.trim() ? { kind: 'text', name: 'Clipboard.txt', mime: 'text/plain', bytes: Buffer.from(text.slice(0, 1e6), 'utf8') } : null;
    },

    // Relay's own window as it is now (only Relay's window, never the screen).
    async screenshot() {
      const win = getWindow?.();
      if (!win || win.isDestroyed?.() || !win.isVisible?.() || win.isMinimized?.()) return null;
      const img = await win.webContents.capturePage();
      if (!img || img.isEmpty()) return null;
      return { kind: 'image', name: `Relay window ${stamp(now())}.png`, mime: 'image/png', bytes: img.toPNG() };
    }
  };
}

module.exports = { makeLidItems, parsePaths, mimeFor, FINDER_SCRIPT };
