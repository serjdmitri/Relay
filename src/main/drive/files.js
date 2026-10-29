// Looking at files: what is in a folder (for planning) and finding files by name or content (Spotlight). Read-only. No Electron in here.

const path = require('path');
const { hasSymlink } = require('./plan');

const EXT = {
  image: 'jpg jpeg png gif heic heif webp tiff tif bmp raw cr2 nef svg psd ai',
  video: 'mp4 mov m4v avi mkv webm wmv',
  audio: 'mp3 m4a wav aac flac aiff ogg',
  pdf: 'pdf',
  document: 'doc docx pages txt rtf md odt epub',
  spreadsheet: 'xls xlsx numbers csv tsv ods',
  slides: 'ppt pptx key odp',
  archive: 'zip rar 7z tar gz tgz dmg pkg iso',
  code: 'js ts py swift java c cpp h rs go rb php html css json sh'
};
const KIND = Object.fromEntries(Object.entries(EXT).flatMap(([k, v]) => v.split(' ').map((e) => [e, k])));
const kindOf = (name) => KIND[path.extname(name).slice(1).toLowerCase()] || 'other';

const size = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const tilde = (p, home) => (p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p);
const hiddenOrLibrary = (rel) => rel.split(path.sep).some((s, i) => s.startsWith('.') || (i === 0 && s === 'Library') || /\.(app|photoslibrary|musiclibrary|tvlibrary|imovielibrary|fcpbundle|logicx|band|framework|bundle)$/i.test(s));

// What is in a folder, a few levels down: files (kind, size, date) and folders. Projects (code folders) and app packages are listed but not entered.
function scanFolder(root, { fs, home, depth = 3, maxFiles = 1500 }) {
  const files = [];
  const dirs = [];
  let truncated = false;
  const walk = (dir, d) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full);
      if (hiddenOrLibrary(path.relative(home, full))) continue;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        const names = (() => { try { return new Set(fs.readdirSync(full)); } catch { return new Set(); } })();
        const project = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'Package.swift'].some((n) => names.has(n)) || [...names].some((n) => /\.(xcodeproj|xcworkspace)$/.test(n));
        dirs.push({ path: full, rel, project, items: names.size });
        if (!project && d < depth) walk(full, d + 1);
      } else if (e.isFile()) {
        if (files.length >= maxFiles) { truncated = true; return; }
        let st; try { st = fs.statSync(full); } catch { continue; }
        files.push({ path: full, rel, name: e.name, kind: kindOf(e.name), size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  walk(root, 0);
  return { root, files, dirs, truncated };
}

// A compact description of a scan for the model to plan from.
function describeScan(s, home) {
  const byKind = {};
  for (const f of s.files) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  const lines = [`${tilde(s.root, home)}: ${s.files.length} files${s.truncated ? ' (more not listed)' : ''} (${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}), ${s.dirs.length} folders.`];
  if (s.dirs.length) lines.push('Folders: ' + s.dirs.slice(0, 60).map((d) => `${d.rel}/${d.project ? ' [project: do not move its files]' : ` (${d.items})`}`).join('; '));
  lines.push('Files (path | kind | size | modified):');
  for (const f of s.files.slice(0, 400)) lines.push(`${f.rel} | ${f.kind} | ${size(f.size)} | ${day(f.mtime)}`);
  if (s.files.length > 400) lines.push(`… and ${s.files.length - 400} more.`);
  return lines.join('\n');
}

// Spotlight, by file name and by content, inside a folder. exec(file, args) -> stdout. Results are files in your home folder (not Library or hidden).
async function findFiles(query, { exec, fs, home, folder, kind, limit = 12 }) {
  const q = String(query || '').trim().slice(0, 120);
  if (!q) return [];
  const where = folder || home;
  const run = async (args) => { try { return String(await exec('/usr/bin/mdfind', ['-onlyin', where, ...args])).split('\n').filter(Boolean); } catch { return []; } };
  const [byName, byText] = await Promise.all([run(['-name', q]), run([q])]);
  const seen = new Set();
  const out = [];
  for (const p of [...byName, ...byText]) {
    if (seen.has(p)) continue;
    seen.add(p);
    if (!p.startsWith(home + path.sep) || hiddenOrLibrary(path.relative(home, p))) continue;
    try { if (hasSymlink(p, fs, home)) continue; } catch { continue; }
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (!st.isFile() && !st.isDirectory()) continue;
    const name = path.basename(p);
    const k = st.isDirectory() ? 'folder' : kindOf(name);
    if (kind && k !== kind) continue;
    out.push({ path: p, name, kind: k, size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs, nameMatch: byName.includes(p) });
  }
  out.sort((a, b) => (b.nameMatch - a.nameMatch) || (b.mtime - a.mtime));
  return out.slice(0, limit);
}

// Only kinds that are safe to open by themselves; anything else is shown in Finder instead (an app or script must not run from a click).
const OPEN_SAFE = new Set(['image', 'video', 'audio', 'pdf', 'document', 'spreadsheet', 'slides']);

module.exports = { kindOf, size, day, tilde, scanFolder, describeScan, findFiles, hiddenOrLibrary, OPEN_SAFE };
