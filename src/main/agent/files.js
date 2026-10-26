// Reading the files someone dropped on Relay, for the model. Only files the user handed over (or what is inside a folder they
// dropped) can be read: the model cannot go looking through the rest of the disk with this.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { defaultExec } = require('./mac');

const MAX_TEXT = 60000;
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.tiff', '.bmp']);
const CONVERT = new Set(['.doc', '.docx', '.rtf', '.rtfd', '.html', '.htm', '.odt', '.webarchive']);
const PDF = '.pdf';

const expand = (p) => path.resolve(String(p).replace(/^~(?=$|\/)/, os.homedir()));

// Is `file` one of the dropped paths, or inside a dropped folder?
function allowed(file, dropped) {
  const f = expand(file);
  return dropped.some((d) => { const r = expand(d); return f === r || f.startsWith(r + path.sep); });
}

const PDF_SCRIPT = 'function run(argv){ ObjC.import("PDFKit"); var d = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0])); return d ? ObjC.unwrap(d.string) : ""; }';

// Returns { text } or { text, image: { mediaType, data } }. Throws with a sentence for the user when it cannot be read.
async function readDropped(file, dropped, { exec = defaultExec } = {}) {
  if (!allowed(file, dropped)) throw new Error('That file was not given to Relay. Only files dropped on Relay can be read.');
  const f = expand(file);
  let st;
  try { st = fs.statSync(f); } catch { throw new Error(`${f} does not exist.`); }
  if (st.isDirectory()) {
    const names = fs.readdirSync(f).filter((n) => !n.startsWith('.')).slice(0, 200);
    return { text: names.length ? names.map((n) => (fs.statSync(path.join(f, n)).isDirectory() ? `${n}/` : n)).join('\n') : '(empty folder)' };
  }
  const ext = path.extname(f).toLowerCase();
  if (IMAGE.has(ext)) {
    const tmp = path.join(os.tmpdir(), `relay-drop-${process.pid}-${Date.now()}.jpg`);
    try {
      await exec('/usr/bin/sips', ['-s', 'format', 'jpeg', '-Z', '1400', f, '--out', tmp], { timeout: 20000 });
      return { text: `The picture ${path.basename(f)}.`, image: { mediaType: 'image/jpeg', data: fs.readFileSync(tmp).toString('base64') } };
    } finally { fs.rmSync(tmp, { force: true }); }
  }
  let text;
  if (ext === PDF) text = String(await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', PDF_SCRIPT, f], { timeout: 30000 }));
  else if (CONVERT.has(ext)) text = String(await exec('/usr/bin/textutil', ['-convert', 'txt', '-stdout', f], { timeout: 30000 }));
  else {
    if (st.size > 5 * 1024 * 1024) throw new Error(`${path.basename(f)} is too large to read (${Math.round(st.size / 1048576)} MB).`);
    const buf = fs.readFileSync(f);
    if (buf.includes(0)) throw new Error(`${path.basename(f)} is not a text file Relay can read.`);
    text = buf.toString('utf8');
  }
  text = text.trim();
  if (!text) return { text: `${path.basename(f)} has no readable text.` };
  return { text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n[cut: ${text.length - MAX_TEXT} more characters]` : text };
}

module.exports = { readDropped, allowed };
