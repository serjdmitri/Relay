// "What is on my SD card?": for a drive that is plugged in, what kind it is (SD card, SSD, hard drive, flash drive), how full it is, and what is on it (counts and sizes
// by kind, the biggest folders and files). Read only: it lists names and sizes and never opens a file. The Mac gives the raw facts (diskutil, the folder walk);
// this reads them. Pure, with the file system passed in so it can be tested.

const path = require('path');

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const DRIVE_WORD = '(sd card|sd|micro ?sd|memory card|camera card|ssd|hdd|hard drive|hard disk|flash drive|thumb drive|usb drive|usb stick|pen drive|external (?:hard )?(?:drive|disk|ssd)|portable (?:drive|ssd)|disk|drive|card)';
const DRIVE_WORD_SPECIFIC = DRIVE_WORD.replace('|disk|drive|card)', ')'); // "open drive" or "check my card" can mean other things; these verbs need a clear drive word
const KIND_OF = (w) => (/ssd/.test(w) ? 'SSD' : /^(?:sd card|sd|micro ?sd|memory card|camera card|card)$/.test(w) ? 'SD card' : /hdd|hard/.test(w) ? 'hard drive' : /flash|thumb|stick|pen|usb/.test(w) ? 'USB flash drive' : null);

// Returns { type: 'drive-inspect', want: 'SD card'|'SSD'|'hard drive'|'USB flash drive'|null, name } or { type: 'drives' } or null.
function parseDriveCommand(text) {
  const n = clean(text).replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '').replace(/ please$/, '');
  if (/^(?:what|which) (?:drives|disks|volumes|storage)(?: are| do i have| have i got)?(?: connected| plugged in| mounted| attached)?$|^(?:list|show)(?: me)?(?: all)?(?: the| my)?(?: connected| plugged in| external| mounted)? (?:drives|disks|volumes)(?: connected| plugged in)?$/.test(n)) return { type: 'drives' };
  const tail = `(?:my |the |this |that |an? )?${DRIVE_WORD}(?: (?:called|named) (.+))?`;
  const tailSpecific = `(?:my |the |this |that |an? )?${DRIVE_WORD_SPECIFIC}(?: (?:called|named) (.+))?`;
  let m;
  const hit = (re) => { m = n.match(re); return m; };
  if (hit(new RegExp(`^(?:what's|what s|whats|what is|what are the files|what files are|show me what's|show me what s|tell me what's|tell me what s|list what s|see what s)(?: on| in| inside| taking up space on| using up space on) ${tail}$`)) ||
      hit(new RegExp(`^(?:look|see|check|peek) (?:inside|in|at|on) ${tail}$`)) ||
      hit(new RegExp(`^(?:inspect|scan|analy[sz]e|check|open|explore|browse|summari[sz]e|audit|examine) ${tailSpecific}$`)) ||
      hit(new RegExp(`^how (?:full|much space is (?:left|free|used)|much is (?:left|free|used)|much storage is (?:left|free|used))(?: is| on| in)? ${tail}$`)) ||
      hit(new RegExp(`^how full is ${tail}$`))) return { type: 'drive-inspect', want: KIND_OF(m[1]), name: (m[2] || '').trim() };
  return null;
}

// ---- diskutil info text ----
function parseDiskutilInfo(text) {
  const f = {};
  for (const line of String(text || '').split('\n')) { const m = line.match(/^\s*([A-Za-z][A-Za-z /]+?):\s+(.*\S)\s*$/); if (m) f[m[1].trim().toLowerCase()] = m[2].trim(); }
  const bytes = (k) => { const m = String(f[k] || '').match(/\((\d[\d,]*) Bytes\)/i); return m ? Number(m[1].replace(/,/g, '')) : null; };
  const total = bytes('volume total space') ?? bytes('disk size') ?? bytes('total size') ?? bytes('container total space');
  const free = bytes('volume free space') ?? bytes('container free space') ?? bytes('free space');
  return {
    name: f['volume name'] || '', fs: (f['file system personality'] || f['type (bundle)'] || '').replace(/^MS-DOS FAT32$/, 'FAT32').replace(/^MS-DOS$/, 'FAT'),
    protocol: f.protocol || '', media: f['device / media name'] || '', solid: /^yes/i.test(f['solid state'] || '') ? true : /^no/i.test(f['solid state'] || '') ? false : null,
    removable: /^removable/i.test(f['removable media'] || '') || /^yes/i.test(f['removable media'] || ''), external: /external/i.test(f['device location'] || '') || /^no/i.test(f.internal || ''),
    internal: /internal/i.test(f['device location'] || '') || /^yes/i.test(f.internal || ''), total, free, used: total != null && free != null ? total - free : null, mounted: !/^no/i.test(f.mounted || 'Yes')
  };
}

// What kind of drive it is, as far as the Mac says; "drive" when it does not say (many USB cases hide whether it is solid state).
function driveKind(i) {
  if (/secure digital/i.test(i.protocol) || /\bsd\b|sdxc|sdhc|card reader|microsd|memory card/i.test(`${i.media} ${i.name}`)) return 'SD card';
  if (/disk image/i.test(i.protocol)) return 'disk image';
  if (i.solid === true) return i.removable && i.total != null && i.total <= 256e9 && /usb/i.test(i.protocol) && /fat|exfat/i.test(i.fs) ? 'USB flash drive' : 'SSD';
  if (i.solid === false) return 'hard drive';
  return i.removable && /usb/i.test(i.protocol) ? 'USB drive' : 'drive';
}

function bytesText(b) {
  if (b == null) return 'unknown size';
  const u = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = b;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return `${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} ${u[i]}`;
}

// ---- looking inside ----
const GROUPS = [
  ['robot logs', /^(?:wpilog|dslog|dsevents|hoot|rev|revlog)$/], ['photos', /^(?:jpe?g|png|heic|heif|gif|tiff?|bmp|webp|raw|dng|arw|cr2|cr3|nef|orf|raf|rw2)$/],
  ['videos', /^(?:mp4|mov|m4v|avi|mkv|mts|m2ts|mpg|mpeg|wmv|3gp|insv)$/], ['audio', /^(?:mp3|wav|aac|m4a|flac|aiff|ogg|wma)$/],
  ['documents', /^(?:pdf|docx?|txt|md|rtf|pages|xlsx?|csv|numbers|pptx?|key|odt)$/], ['code', /^(?:java|py|cpp|c|h|hpp|ino|js|ts|json|xml|gradle|kt|rs|go|html|css|sh|ipynb|cs|vi|lvproj)$/],
  ['3D and CAD', /^(?:stl|obj|glb|gltf|step|stp|f3d|3mf|sldprt|sldasm|dxf|ply)$/], ['archives', /^(?:zip|rar|7z|tar|gz|dmg|iso)$/], ['apps and installers', /^(?:app|exe|pkg|msi|apk)$/]
];
const groupOf = (name) => { const e = path.extname(name).slice(1).toLowerCase(); return (GROUPS.find(([, re]) => re.test(e)) || ['other files'])[0]; };
const SKIP = new Set(['.spotlight-v100', '.fseventsd', '.trashes', '.trash', '.temporaryitems', 'system volume information', '$recycle.bin', '.documentrevisions-v100', '.ds_store']);

// A walk with limits (files and seconds), so a huge drive gives a partial answer fast instead of hanging.
async function scanVolume(root, { fsImpl = require('fs'), maxFiles = 30000, maxMs = 7000, now = Date.now } = {}) {
  const t0 = now();
  const out = { files: 0, dirs: 0, bytes: 0, groups: {}, tops: {}, biggest: [], stopped: '', unreadable: 0, names: new Set() };
  const stack = [{ dir: root, top: '' }];
  let turns = 0;
  while (stack.length) {
    if (++turns % 20 === 0) await new Promise((r) => setImmediate(r)); // let the rest of the app run during a long walk
    if (out.files >= maxFiles) { out.stopped = 'file limit'; break; }
    if (now() - t0 > maxMs) { out.stopped = 'time limit'; break; }
    const { dir, top } = stack.pop();
    let list;
    try { list = fsImpl.readdirSync(dir, { withFileTypes: true }); } catch { out.unreadable++; continue; }
    for (const e of list) {
      if (SKIP.has(e.name.toLowerCase())) continue;
      const full = path.join(dir, e.name);
      const t = top || e.name;
      if (!top) out.names.add(e.name);
      if (e.isSymbolicLink?.()) continue;
      if (e.isDirectory()) { out.dirs++; stack.push({ dir: full, top: t }); continue; }
      let size = 0;
      try { size = fsImpl.lstatSync(full).size; } catch { out.unreadable++; continue; }
      out.files++;
      out.bytes += size;
      const g = out.groups[groupOf(e.name)] ||= { count: 0, bytes: 0 };
      g.count++; g.bytes += size;
      const tp = out.tops[t] ||= { files: 0, bytes: 0, dir: !!top };
      tp.files++; tp.bytes += size;
      if (out.biggest.length < 5 || size > out.biggest[out.biggest.length - 1].bytes) { out.biggest.push({ path: full, bytes: size }); out.biggest.sort((a, b) => b.bytes - a.bytes); out.biggest.length = Math.min(out.biggest.length, 5); }
    }
  }
  return out;
}

const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;

// { reply, facts, items } for the spoken answer and the card.
function describeDrive({ name, path: mount, info, scan }) {
  const kind = driveKind(info);
  const label = info.name || name;
  const parts = [kind, info.fs, bytesText(info.total)].filter((x) => x && x !== 'unknown size');
  const space = info.total != null && info.free != null ? `${bytesText(info.used)} used, ${bytesText(info.free)} free (${Math.round((info.used / info.total) * 100)}% full)` : '';
  const head = `${label}: ${parts.join(', ')}${space ? `. ${space}` : ''}.`;
  if (!scan) return { reply: head, kind, items: [] };
  const groups = Object.entries(scan.groups).sort((a, b) => b[1].bytes - a[1].bytes).filter(([, g]) => g.count);
  const tops = Object.entries(scan.tops).filter(([, t]) => t.dir).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 5);
  const look = scan.files ? `${plural(scan.files, 'file')} (${bytesText(scan.bytes)}) in ${plural(scan.dirs, 'folder')}: ${groups.slice(0, 4).map(([k, g]) => `${g.count.toLocaleString('en-US')} ${k} (${bytesText(g.bytes)})`).join(', ')}${groups.length > 4 ? ' and more' : ''}.` : 'There are no files on it.';
  const notes = [];
  if (scan.names.has('DCIM')) notes.push('It has a DCIM folder, so it looks like a camera card.');
  if (groups.some(([k]) => k === 'robot logs')) notes.push('There are robot log files on it.');
  if (tops.length) notes.push(`Biggest folder${tops.length > 1 ? 's' : ''}: ${tops.slice(0, 3).map(([k, t]) => `${k} (${bytesText(t.bytes)})`).join(', ')}.`);
  if (scan.stopped) notes.push(`I stopped looking early (${scan.stopped}), so these counts are partial.`);
  if (scan.unreadable) notes.push(`${plural(scan.unreadable, 'item')} could not be read.`);
  const items = [
    ...groups.slice(0, 8).map(([k, g]) => ({ title: k, subtitle: `${g.count.toLocaleString('en-US')} files`, note: bytesText(g.bytes) })),
    ...scan.biggest.slice(0, 3).map((b) => ({ title: path.basename(b.path), subtitle: 'one of the biggest files', note: bytesText(b.bytes) }))
  ];
  return { reply: [head, look, ...notes].join(' '), kind, items, partial: !!scan.stopped, mount };
}

module.exports = { parseDriveCommand, parseDiskutilInfo, driveKind, bytesText, scanVolume, describeDrive, groupOf };
