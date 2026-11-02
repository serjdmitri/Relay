const test = require('node:test'), assert = require('node:assert/strict');
const { assess, scanTop, evaluate, shouldNotify, describe, parseClutterCommand, COOLDOWN } = require('../src/main/clutter');

const NOW = Date.UTC(2026, 10, 4, 12), DAY = 86400e3;
const f = (name, days = 1, size = 1000) => ({ name, isFile: true, size, mtimeMs: NOW - days * DAY });
const many = (prefix, ext, n, days) => Array.from({ length: n }, (_, i) => f(`${prefix}${i}.${ext}`, days));

test('a tidy folder is left alone and a messy one says exactly why', () => {
  assert.equal(assess(many('a', 'txt', 12, 2), { now: NOW }).level, 'tidy');
  assert.equal(assess([], { now: NOW }).level, 'tidy');
  const loose = assess(many('doc', 'pdf', 26, 2), { now: NOW });
  assert.deepEqual([loose.level, loose.reasons], ['messy', ['26 loose files']]);
  const big = assess(many('doc', 'pdf', 45, 2), { now: NOW });
  assert.deepEqual([big.level, big.loose], ['cluttered', 45]);
  const mixed = assess([...many('Screenshot 2026-10-', 'png', 16, 3), ...many('setup', 'dmg', 4, 40)], { now: NOW });
  assert.deepEqual(mixed.reasons, ['20 loose files'].slice(0, 0).concat(['4 installers older than two weeks', '16 screenshots']));
  assert.equal(mixed.level, 'cluttered');
  assert.equal(assess([...many('inst', 'dmg', 5, 3)], { now: NOW }).oldInstallers, 0, 'a recent installer is not old yet');
  assert.deepEqual(assess(many('old', 'txt', 16, 90), { now: NOW }).reasons, ['16 loose files, mostly untouched for over a month']);
  assert.equal(assess(many('old', 'txt', 14, 90), { now: NOW }).level, 'tidy', 'below fifteen files age alone is not clutter');
  assert.deepEqual(assess([...many('a', 'txt', 3, 1), ...Array.from({ length: 5 }, (_, i) => f(`report (${i + 1}).pdf`))], { now: NOW }).reasons, ['5 files named like copies, such as "(1)"']);
  assert.deepEqual(assess(many('x', 'zip', 5, 60), { now: NOW }).reasons, ['5 old archives']);
});

test('only plain loose files count: hidden files, folders, links and downloads in progress are ignored', () => {
  const entries = [...many('a', 'txt', 24, 2), { name: '.DS_Store', isFile: true, size: 1, mtimeMs: NOW }, { name: 'Projects', isFile: false }, f('movie.mp4.crdownload'), f('x.part'), f('.hidden.txt'), null];
  const a = assess(entries, { now: NOW });
  assert.equal(a.loose, 24); assert.equal(a.level, 'tidy');
  assert.deepEqual(assess([f('a.jpg'), f('b.png'), f('c.pdf'), f('d.zip')], { now: NOW }).kinds, { image: 2, pdf: 1, archive: 1 });
});

function fakeFs(dir, files, { link = null, throws = false } = {}) {
  return {
    readdirSync: (d) => { if (throws) throw Error('EACCES'); assert.equal(d, dir); return [...files.map((x) => ({ name: x.name, isFile: () => true, isSymbolicLink: () => false })), ...(link ? [{ name: link, isFile: () => false, isSymbolicLink: () => true }] : [])]; },
    lstatSync: (p) => { const x = files.find((y) => p.endsWith('/' + y.name)); if (!x) throw Error('gone'); return { isFile: () => true, size: x.size, mtimeMs: x.mtimeMs }; }
  };
}

test('scanning reads names, sizes and dates at the top level only, never follows links and caps the number looked at', () => {
  const files = many('a', 'txt', 5, 2);
  const r = scanTop(fakeFs('/h/Docs', files, { link: 'alias' }), '/h/Docs');
  assert.equal(r.entries.length, 6); assert.deepEqual(r.entries.find((e) => e.name === 'alias'), { name: 'alias', isFile: false });
  assert.equal(r.entries[0].size, 1000); assert.equal(r.truncated, false);
  const capped = scanTop(fakeFs('/h/Docs', many('b', 'txt', 30, 1)), '/h/Docs', { limit: 10 }); assert.equal(capped.entries.length, 10); assert.equal(capped.truncated, true);
  assert.equal(scanTop(fakeFs('/h/Docs', [], { throws: true }), '/h/Docs'), null);
  assert.equal(scanTop(fakeFs('/h/Docs', [{ name: 'a.txt', size: 1, mtimeMs: 1 }]), '/h/Docs').entries.length, 1);
});

test('telling you again: once, then after a week if still cluttered, sooner only if it clearly grew, and never when tidy', () => {
  const cur = (loose, level = 'messy') => ({ loose, level });
  assert.equal(shouldNotify(null, cur(30), NOW), true);
  assert.equal(shouldNotify({ at: NOW - DAY, loose: 30 }, cur(32), NOW), false);
  assert.equal(shouldNotify({ at: NOW - DAY, loose: 30 }, cur(45), NOW), true, 'grew by at least 30 percent and 10 files');
  assert.equal(shouldNotify({ at: NOW - DAY, loose: 100 }, cur(120), NOW), false, 'ten more files is not "clearly grown" on a big folder');
  assert.equal(shouldNotify({ at: NOW - COOLDOWN - 1, loose: 30 }, cur(30), NOW), true);
  assert.equal(shouldNotify(null, cur(5, 'tidy'), NOW), false);
});

const roots = [
  { id: 'r1', path: '/h/Screenshots', mode: 'organize' },
  { id: 'r2', path: '/h/Docs', mode: 'read' },
  { id: 'r3', path: '/h/App', mode: 'organize' },
  { id: 'r4', path: '/Volumes/USB/Stuff', mode: 'organize' },
  { id: 'r5', path: '/h/Tidy', mode: 'organize' }
];
const FILES = { '/h/Screenshots': many('Screenshot ', 'png', 30, 3), '/h/Docs': many('d', 'pdf', 50, 5), '/h/App': many('a', 'js', 40, 1), '/Volumes/USB/Stuff': many('u', 'txt', 30, 2), '/h/Tidy': many('t', 'txt', 3, 1) };
const deps = (over = {}) => ({ probe: (r) => (r.id === 'r4' ? { readable: false, error: 'Disconnected or no longer present.' } : { readable: true, writable: true }), fs: { readdirSync: (d) => FILES[d].map((x) => ({ name: x.name, isFile: () => true })), lstatSync: (p) => { const x = FILES[p.slice(0, p.lastIndexOf('/'))].find((y) => p.endsWith('/' + y.name)); return { ...x, isFile: () => true }; } }, planMovable: (d) => (d === '/h/Screenshots' ? 30 : 12), isProject: (d) => d === '/h/App', now: NOW, ...over });

test('each chosen folder is judged on its own: previews are offered only where organization is on, and the rest is explained', () => {
  const { results, state } = evaluate(roots, {}, deps());
  const by = (id) => results.find((r) => r.root.id === id);
  assert.deepEqual([by('r1').assessment.level, by('r1').offer, by('r1').notify], ['cluttered', true, true]);
  assert.deepEqual([by('r2').assessment.level, by('r2').offer, by('r2').notify], ['cluttered', false, false], 'read-only: reported, but no preview is offered');
  assert.match(by('r3').skipped, /code project/); assert.match(by('r4').skipped, /Disconnected/);
  assert.deepEqual([by('r5').assessment.level, by('r5').notify], ['tidy', false]);
  assert.deepEqual(Object.keys(state), ['r1']); assert.deepEqual(state.r1, { at: NOW, loose: 30 });
  const again = evaluate(roots, state, deps({ now: NOW + DAY }));
  assert.equal(again.results.find((r) => r.root.id === 'r1').notify, false, 'not told twice in a day');
  assert.deepEqual(Object.keys(again.state), ['r1']);
  const nothing = evaluate([roots[0]], {}, deps({ planMovable: () => 0 })); assert.deepEqual([nothing.results[0].offer, nothing.results[0].notify], [false, false], 'nothing the organizer can move: no preview to offer');
});

test('state is tidied: a folder that became tidy or was removed is forgotten, so the next mess is news again', () => {
  const state = { r1: { at: NOW - DAY, loose: 30 }, gone: { at: 1, loose: 1 }, r5: { at: 1, loose: 40 } };
  const out = evaluate(roots, state, deps());
  assert.deepEqual(Object.keys(out.state).sort(), ['r1'], 'r5 is tidy now and gone was removed; r1 keeps its earlier notice');
  assert.deepEqual(state.gone, { at: 1, loose: 1 }, 'the caller\'s state object is not changed');
});

test('the summary line names the reasons and how many files could be sorted', () => {
  const a = assess(many('Screenshot ', 'png', 20, 2), { now: NOW, movable: 20 });
  assert.equal(describe('Screenshots', a), 'Screenshots: 20 screenshots; 20 files could be sorted');
  assert.equal(describe('X', { reasons: ['30 loose files'], movable: 1 }), 'X: 30 loose files; 1 file could be sorted');
  assert.equal(describe('X', { reasons: ['30 loose files'], movable: null }), 'X: 30 loose files');
});

test('"check my folders for clutter" and "tidy up <a folder you chose>" are understood; Downloads and other requests are left alone', () => {
  const names = ['Screenshots', 'Docs', 'Downloads'];
  for (const t of ['check my folders for clutter', 'is anything cluttered', 'which folders are messy', 'folder clutter report', 'check for clutter', 'Jarvis, scan my folders']) assert.deepEqual(parseClutterCommand(t, names), { type: 'check' }, t);
  assert.deepEqual(parseClutterCommand('tidy up Screenshots', names), { type: 'tidy', name: 'Screenshots' });
  assert.deepEqual(parseClutterCommand('Please organize my docs folder', names), { type: 'tidy', name: 'Docs' });
  assert.deepEqual(parseClutterCommand('clean up the screenshots', names), { type: 'tidy', name: 'Screenshots' });
  for (const t of ['tidy up Downloads', 'tidy my downloads', 'tidy up Desktop', 'tidy up', 'organize my life', 'what is clutter', 'delete my screenshots', 'security audit', '']) assert.equal(parseClutterCommand(t, names), null, t);
});
