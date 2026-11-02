// Notices when a folder you chose for Relay's file tools is getting cluttered, and offers a preview of where everything would go. Read-only: it looks at
// the names, sizes and dates of the loose files at the top of the folder (never their contents), and it moves nothing. The preview itself is the
// existing "Preview organization" in Files settings, which only works for folders where you turned organization on, so only those are offered one.
// Pure apart from the file system it is handed, so all of it can be tested.

const path = require('path');
const { kindOf } = require('./drive/files');

const DAY = 86400e3;
const PARTIAL = /\.(?:crdownload|download|part|partial|tmp|opdownload)$/i;
const INSTALLER = /\.(?:dmg|pkg|exe|msi|iso)$/i;
const ARCHIVE = /\.(?:zip|rar|7z|tar|gz|tgz)$/i;
const SHOT = /^(?:Screenshot|Screen Shot|Screen Recording)\b/i;
const COPY = /(?: \(\d+\)| copy(?: \d+)?)(?:\.[^.]+)?$/i;
const COOLDOWN = 7 * DAY;

// entries: top-level items [{ name, isFile, size, mtimeMs }]. movable: how many files the organizer could actually move (so we never offer a preview of nothing).
function assess(entries, { now = Date.now(), movable = null } = {}) {
  const files = (entries || []).filter((e) => e && e.isFile && !String(e.name).startsWith('.') && !PARTIAL.test(e.name));
  const age = (e) => (now - (Number(e.mtimeMs) || now)) / DAY;
  const loose = files.length, bytes = files.reduce((n, e) => n + (Number(e.size) || 0), 0);
  const stale = files.filter((e) => age(e) > 30).length;
  const oldInstallers = files.filter((e) => INSTALLER.test(e.name) && age(e) > 14).length;
  const oldArchives = files.filter((e) => ARCHIVE.test(e.name) && age(e) > 30).length;
  const shots = files.filter((e) => SHOT.test(e.name)).length;
  const copies = files.filter((e) => COPY.test(e.name)).length;
  const kinds = {};
  for (const e of files) { const k = kindOf(e.name); kinds[k] = (kinds[k] || 0) + 1; }
  const reasons = [];
  if (loose >= 25) reasons.push(`${loose} loose files`);
  if (oldInstallers >= 3) reasons.push(`${oldInstallers} installers older than two weeks`);
  if (shots >= 15) reasons.push(`${shots} screenshots`);
  if (oldArchives >= 5) reasons.push(`${oldArchives} old archives`);
  if (copies >= 5) reasons.push(`${copies} files named like copies, such as "(1)"`);
  if (loose >= 15 && stale / loose >= 0.5 && !reasons.some((r) => /loose files/.test(r))) reasons.push(`${loose} loose files, mostly untouched for over a month`);
  const level = !reasons.length ? 'tidy' : loose >= 40 || reasons.length >= 2 ? 'cluttered' : 'messy';
  return { loose, bytes, stale, oldInstallers, oldArchives, shots, copies, kinds, reasons, level, movable, truncated: false };
}

// The loose files at the top of a folder, from the file system. Never follows links, never reads contents, caps the number looked at.
function scanTop(fs, dir, { limit = 1500 } = {}) {
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const truncated = list.length > limit, entries = [];
  for (const e of list.slice(0, limit)) {
    if (!e.isFile() || e.isSymbolicLink?.()) { entries.push({ name: e.name, isFile: false }); continue; }
    try { const st = fs.lstatSync(path.join(dir, e.name)); entries.push({ name: e.name, isFile: st.isFile(), size: st.size, mtimeMs: st.mtimeMs }); } catch { /* it vanished: ignore */ }
  }
  return { entries, truncated };
}

const describe = (name, a) => `${name}: ${a.reasons.join(', ')}${a.movable ? `; ${a.movable} file${a.movable === 1 ? '' : 's'} could be sorted` : ''}`;

// Tell the person again? Once per folder, then again after a week if it is still cluttered, or sooner if it has clearly grown.
function shouldNotify(prev, cur, now = Date.now()) {
  if (cur.level === 'tidy') return false;
  if (!prev) return true;
  if (now - prev.at >= COOLDOWN) return true;
  return cur.loose >= prev.loose * 1.3 && cur.loose - prev.loose >= 10;
}

// roots: the folders you chose. deps: { probe(root), fs, planMovable(dir), isProject(dir), now }. state: { [rootId]: { at, loose } }.
// Returns { results: [{ root, name, assessment, offer (a preview is possible), notify }], state }.
function evaluate(roots, state, { probe, fs, planMovable = () => null, isProject = () => false, now = Date.now(), limit = 1500 } = {}) {
  const next = { ...(state || {}) }, results = [];
  for (const root of roots || []) {
    const name = path.basename(root.path), p = probe(root);
    if (!p || !p.readable) { results.push({ root, name, skipped: p && p.error ? p.error : 'Not readable right now.' }); continue; }
    if (isProject(root.path)) { results.push({ root, name, skipped: 'It is a code project, which Relay does not reorganize.' }); continue; }
    const scan = scanTop(fs, root.path, { limit });
    if (!scan) { results.push({ root, name, skipped: 'It could not be read.' }); continue; }
    const assessment = assess(scan.entries, { now, movable: planMovable(root.path) });
    assessment.truncated = scan.truncated;
    const offer = root.mode === 'organize' && !!p.writable && (assessment.movable == null || assessment.movable > 0);
    const notify = offer && shouldNotify(next[root.id], assessment, now);
    if (notify) next[root.id] = { at: now, loose: assessment.loose };
    else if (assessment.level === 'tidy') delete next[root.id]; // tidied up: the next time it gets messy it is news again
    results.push({ root, name, assessment, offer, notify });
  }
  for (const id of Object.keys(next)) if (!(roots || []).some((r) => r.id === id)) delete next[id]; // a removed folder is forgotten
  return { results, state: next };
}

// "check my folders for clutter" and "tidy up Screenshots" (only for a folder you chose; Downloads has its own tidy-up).
function parseClutterCommand(text, names = []) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/[.!?]+$/, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/\s+/g, ' ').toLowerCase();
  if (/^(?:check|scan|look at|review)(?: my| the)?(?: chosen| selected| watched)? folders(?: for (?:clutter|mess))?$/.test(n) || /^(?:is|are) (?:any(?:thing| of my folders)?|my folders?) (?:cluttered|messy)$/.test(n) || /^(?:which|what) folders (?:are|is) (?:cluttered|messy)$/.test(n) || /^(?:folder )?clutter (?:report|check|suggestions?)$/.test(n) || /^(?:check|scan) (?:for )?clutter$/.test(n)) return { type: 'check' };
  const m = /^(?:tidy|tidy up|clean up|clean out|organi[sz]e|sort(?: out)?)(?: up)?(?: my| the)? (.+?)(?: folder)?$/.exec(n);
  if (m) { const want = m[1].trim(), hit = names.find((x) => x.toLowerCase() === want); if (hit && hit.toLowerCase() !== 'downloads') return { type: 'tidy', name: hit }; }
  return null;
}

module.exports = { assess, scanTop, evaluate, shouldNotify, describe, parseClutterCommand, COOLDOWN };
