// Making new files from old ones: zip things up, or convert pictures to another format. The originals are never touched, a new file never
// replaces one that is there (it gets a free name), and each job is logged so drive_undo can put the new file in the Trash. No Electron in here.

const path = require('path');
const { pathProblem } = require('./guard');
const { freeName } = require('./plan');

const MAX_ZIP_ITEMS = 200;
const MAX_CONVERT = 40;
// sips understands these as input; the keys are what a person might say
const FORMATS = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', tiff: 'tiff', tif: 'tiff', heic: 'heic', gif: 'gif', bmp: 'bmp' };
const OUT_EXT = { png: '.png', jpeg: '.jpg', tiff: '.tiff', heic: '.heic', gif: '.gif', bmp: '.bmp' };
const IMAGE_IN = new Set(['.png', '.jpg', '.jpeg', '.tiff', '.tif', '.heic', '.heif', '.gif', '.bmp', '.webp']);

const expand = (p, home) => path.resolve(String(p).startsWith('~') ? path.join(home, String(p).slice(1)) : String(p));
const cleanName = (n) => String(n || '').replace(/[\\/:\0]/g, '-').replace(/^\.+/, '').trim().slice(0, 100);

// raw: { action: 'zip' | 'convert', paths: [...], format?, name? }. Returns { jobs, skipped } where a job is
// { kind: 'zip', sources: [full paths], out } or { kind: 'convert', from, out, format }.
function planMake(raw, { fs, home }) {
  const skipped = [];
  const jobs = [];
  const paths = (Array.isArray(raw?.paths) ? raw.paths : raw?.path ? [raw.path] : []).map((p) => expand(p, home));
  const ok = [];
  for (const full of [...new Set(paths)]) {
    const bad = pathProblem(full, home);
    if (bad) { skipped.push({ path: full, reason: bad }); continue; }
    let st;
    try { st = fs.lstatSync(full); } catch { skipped.push({ path: full, reason: 'It is not there.' }); continue; }
    if (st.isSymbolicLink()) { skipped.push({ path: full, reason: 'A shortcut (alias), left alone.' }); continue; }
    ok.push({ full, dir: st.isDirectory() });
  }
  const taken = new Set();
  if (raw?.action === 'zip') {
    const list = ok.slice(0, MAX_ZIP_ITEMS);
    for (const extra of ok.slice(MAX_ZIP_ITEMS)) skipped.push({ path: extra.full, reason: `A zip holds at most ${MAX_ZIP_ITEMS} items.` });
    if (list.length) {
      const base = cleanName(raw.name).replace(/\.zip$/i, '') || (list.length === 1 ? path.basename(list[0].full).replace(/\.[^.]*$/, (m) => (list[0].dir ? m : '')) : 'Archive');
      const out = freeName(path.join(path.dirname(list[0].full), `${base}.zip`), taken, fs);
      jobs.push({ kind: 'zip', sources: list.map((l) => l.full), out });
    }
  } else if (raw?.action === 'convert') {
    const format = FORMATS[String(raw.format || '').toLowerCase().replace(/^\./, '')];
    if (!format) return { jobs, skipped: [...skipped, { path: '', reason: `Pictures can be converted to ${Object.keys(OUT_EXT).join(', ')}.` }] };
    for (const f of ok) {
      if (jobs.length >= MAX_CONVERT) { skipped.push({ path: f.full, reason: `At most ${MAX_CONVERT} pictures at a time.` }); continue; }
      const ext = path.extname(f.full).toLowerCase();
      if (f.dir || !IMAGE_IN.has(ext)) { skipped.push({ path: f.full, reason: 'Not a picture Relay can convert.' }); continue; }
      if (OUT_EXT[format] === (ext === '.jpeg' ? '.jpg' : ext === '.tif' ? '.tiff' : ext)) { skipped.push({ path: f.full, reason: `Already ${format === 'jpeg' ? 'a JPEG' : `a ${format.toUpperCase()}`}.` }); continue; }
      const out = freeName(path.join(path.dirname(f.full), path.basename(f.full, path.extname(f.full)) + OUT_EXT[format]), taken, fs);
      taken.add(out);
      jobs.push({ kind: 'convert', from: f.full, out, format });
    }
  } else return { jobs, skipped: [...skipped, { path: '', reason: 'Say zip or convert.' }] };
  return { jobs, skipped };
}

// Runs the jobs. exec(file, args, opts) -> stdout. trashItem(path) moves a half-made file to the Trash if a job fails. Returns { made, failed }.
async function runMake(jobs, { fs, home, exec, trashItem }) {
  const made = [];
  const failed = [];
  for (const j of jobs) {
    try {
      if (fs.existsSync(j.out)) throw new Error('Something appeared at that name.');
      if (j.kind === 'zip') await exec('/usr/bin/zip', ['-r', '-q', '-y', j.out, '--', ...j.sources.map((s) => path.relative(home, s))], { cwd: home, timeout: 300000 });
      else await exec('/usr/bin/sips', ['-s', 'format', j.format, j.from, '--out', j.out], { timeout: 60000 });
      if (!fs.existsSync(j.out)) throw new Error('Nothing was made.');
      made.push(j.out);
    } catch (e) {
      failed.push({ path: j.kind === 'zip' ? j.out : j.from, reason: e.message });
      try { if (fs.existsSync(j.out)) await trashItem(j.out); } catch { /* it stays where it is; the person can see it */ }
    }
  }
  return { made, failed };
}

module.exports = { planMake, runMake, MAX_ZIP_ITEMS, MAX_CONVERT };
