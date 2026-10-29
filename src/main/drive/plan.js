// Organizing files: a plan of moves is checked, shown to the person (where everything goes), and only then carried out. Nothing is ever
// deleted or overwritten: a name that is taken gets "(2)", a file you asked to get rid of goes to the Trash (never emptied), and every
// move is written down so it can be undone. fs and the Trash are passed in, so this is tested on a real temporary folder.

const path = require('path');
const crypto = require('crypto');
const { pathProblem } = require('./guard');

const MAX_MOVES = 500;

const expand = (p, home) => path.resolve(String(p || '').startsWith('~') ? path.join(home, String(p).slice(1)) : String(p || ''));

// Refuse symlinks anywhere along a path, including destination folders that may
// otherwise redirect a move outside the user's home or into protected data.
function hasSymlink(p, fs, home) {
  let current = home;
  for (const part of path.relative(home, p).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) return true; }
    catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  }
  return false;
}

// A folder that holds a project (code or an app being built): its files are not moved one by one, they would stop working.
function isProject(dir, fs) {
  try {
    const names = new Set(fs.readdirSync(dir));
    return ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'Package.swift', 'Gemfile', 'pom.xml', 'build.gradle'].some((n) => names.has(n)) || [...names].some((n) => /\.(xcodeproj|xcworkspace)$/.test(n));
  } catch { return false; }
}

function projectAbove(file, home, fs) {
  let d = path.dirname(file);
  while (d.startsWith(home + path.sep) && d !== home) {
    if (isProject(d, fs)) return d;
    d = path.dirname(d);
  }
  return '';
}

// A free name next to what is already there (and what this plan has already taken).
function freeName(dest, taken, fs) {
  if (!fs.existsSync(dest) && !taken.has(dest)) return dest;
  const dir = path.dirname(dest);
  const ext = path.extname(dest);
  const base = path.basename(dest, ext);
  for (let i = 2; i < 1000; i++) {
    const p = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(p) && !taken.has(p)) return p;
  }
  return path.join(dir, `${base} ${Date.now()}${ext}`);
}

// raw: { moves: [{ from, to_folder | to }], trash: [paths], note }. Every item is checked; what cannot be done is listed as skipped with the reason.
function buildPlan(raw, { fs, home }) {
  const moves = [];
  const trash = [];
  const skipped = [];
  const taken = new Set();
  const seen = new Set();
  for (const m of (Array.isArray(raw?.moves) ? raw.moves : []).slice(0, MAX_MOVES + 50)) {
    if (moves.length >= MAX_MOVES) { skipped.push({ path: m?.from, reason: `A plan holds at most ${MAX_MOVES} moves; ask again for the rest.` }); continue; }
    const from = expand(m?.from, home);
    const bad = pathProblem(from, home);
    if (bad) { skipped.push({ path: m?.from, reason: bad }); continue; }
    try { if (hasSymlink(from, fs, home)) { skipped.push({ path: m?.from, reason: 'A path contains a symbolic link (alias), left alone.' }); continue; } } catch { skipped.push({ path: m?.from, reason: 'The path could not be checked.' }); continue; }
    if (seen.has(from)) continue;
    seen.add(from);
    let st;
    try { st = fs.lstatSync(from); } catch { skipped.push({ path: m?.from, reason: 'It is not there.' }); continue; }
    if (st.isSymbolicLink()) { skipped.push({ path: m?.from, reason: 'A shortcut (alias), left alone.' }); continue; }
    const proj = projectAbove(from, home, fs);
    if (proj && !isProject(from, fs)) { skipped.push({ path: m?.from, reason: `It is part of a project (${path.basename(proj)}), and moving its files would break it.` }); continue; }
    const folder = expand(m?.to_folder ?? (m?.to ? path.dirname(String(m.to)) : ''), home);
    const badTo = pathProblem(path.join(folder, 'x'), home);
    if (!m?.to_folder && !m?.to) { skipped.push({ path: m?.from, reason: 'No destination folder.' }); continue; }
    if (badTo) { skipped.push({ path: m?.from, reason: `Destination: ${badTo}` }); continue; }
    try { if (hasSymlink(folder, fs, home)) { skipped.push({ path: m?.from, reason: 'Destination contains a symbolic link.' }); continue; } } catch { skipped.push({ path: m?.from, reason: 'Destination could not be checked.' }); continue; }
    if (folder === from || folder.startsWith(from + path.sep)) { skipped.push({ path: m?.from, reason: 'It cannot go inside itself.' }); continue; }
    const name = m?.to && !m?.to_folder ? path.basename(String(m.to)) : path.basename(from);
    const dest = path.join(folder, name);
    if (dest === from) { skipped.push({ path: m?.from, reason: 'It is already there.' }); continue; }
    const finalDest = freeName(dest, taken, fs);
    taken.add(finalDest);
    moves.push({ from, to: finalDest, folder, dir: st.isDirectory(), renamed: finalDest !== dest });
  }
  for (const t of (Array.isArray(raw?.trash) ? raw.trash : []).slice(0, 100)) {
    const full = expand(t, home);
    const bad = pathProblem(full, home);
    if (bad) { skipped.push({ path: t, reason: bad }); continue; }
    try { if (hasSymlink(full, fs, home)) { skipped.push({ path: t, reason: 'A path contains a symbolic link, left alone.' }); continue; } } catch { skipped.push({ path: t, reason: 'The path could not be checked.' }); continue; }
    try { if (fs.lstatSync(full).isSymbolicLink()) { skipped.push({ path: t, reason: 'A shortcut (alias), left alone.' }); continue; } } catch { skipped.push({ path: t, reason: 'It is not there.' }); continue; }
    const proj = projectAbove(full, home, fs);
    if (proj && !isProject(full, fs)) { skipped.push({ path: t, reason: `It is part of a project (${path.basename(proj)}), and removing its files would break it.` }); continue; }
    if (!seen.has(full)) { seen.add(full); trash.push(full); }
  }
  const groups = new Map();
  for (const m of moves) { if (!groups.has(m.folder)) groups.set(m.folder, []); groups.get(m.folder).push(m); }
  return { id: crypto.randomUUID(), moves, trash, skipped, note: String(raw?.note || '').slice(0, 200), groups: [...groups].map(([folder, list]) => ({ folder, moves: list })), createdAt: Date.now() };
}

// Carries out a plan: folders are made, files moved (never over anything), the Trash gets what was asked. Returns what was done.
async function applyPlan(plan, { fs, trashItem, home }) {
  const done = [];
  const failed = [];
  for (const m of plan.moves) {
    try {
      if (home && (hasSymlink(m.from, fs, home) || hasSymlink(m.folder, fs, home))) throw new Error('A path now contains a symbolic link.');
      if (fs.existsSync(m.to)) throw new Error('Something appeared at the destination.');
      fs.mkdirSync(path.dirname(m.to), { recursive: true });
      fs.renameSync(m.from, m.to); // a move: if it is on another drive this throws, and nothing is copied or removed
      done.push({ from: m.from, to: m.to });
    } catch (e) { failed.push({ path: m.from, reason: e.code === 'EXDEV' ? 'That is on another drive; Relay does not move across drives.' : e.message }); }
  }
  const trashed = [];
  for (const t of plan.trash) {
    try { if (home && hasSymlink(t, fs, home)) throw new Error('A path now contains a symbolic link.'); await trashItem(t); trashed.push(t); } catch (e) { failed.push({ path: t, reason: e.message }); }
  }
  return { id: plan.id, ts: Date.now(), done, trashed, failed };
}

// Puts a finished plan's moves back where they were (never over anything that is there now).
function undoMoves(entry, { fs, home }) {
  const back = [];
  const left = [];
  for (const d of [...entry.done].reverse()) {
    try {
      if (home && (pathProblem(d.from, home) || pathProblem(d.to, home) || hasSymlink(d.from, fs, home) || hasSymlink(d.to, fs, home))) { left.push({ path: d.to, reason: 'A path is protected or contains a symbolic link.' }); continue; }
      if (!fs.existsSync(d.to)) { left.push({ path: d.to, reason: 'It is no longer there.' }); continue; }
      if (fs.existsSync(d.from)) { left.push({ path: d.to, reason: 'Something is in its old place now.' }); continue; }
      fs.mkdirSync(path.dirname(d.from), { recursive: true });
      fs.renameSync(d.to, d.from);
      back.push(d);
    } catch (e) { left.push({ path: d.to, reason: e.message }); }
  }
  return { back, left };
}

module.exports = { buildPlan, applyPlan, undoMoves, isProject, freeName, hasSymlink, MAX_MOVES };
