const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { shellBlocked, scriptBlocked, pathProblem } = require('../src/main/drive/guard');
const { buildPlan, applyPlan, undoMoves, MAX_MOVES } = require('../src/main/drive/plan');

test('nothing that deletes is allowed through, in a command or a script', () => {
  for (const bad of ['rm -rf ~/Downloads/old', 'sudo rm file', 'ls && rm a.txt', 'find . -name "*.tmp" -delete', 'find ~ -exec rm {} \;', 'xargs rm < list', 'rmdir x', 'unlink a', 'shred -u a', 'truncate -s 0 a', 'diskutil eraseDisk APFS x disk2', 'dd if=/dev/zero of=/tmp/a', 'git clean -fdx', 'git reset --hard', 'python3 -c "import os; os.remove(1)"', 'node -e "fs.rmSync(p)"', 'osascript -e \'tell app "Finder" to empty trash\'', 'echo hi; /bin/rm a'])
    assert.ok(shellBlocked(bad), bad);
  for (const ok of ['ls -la ~/Downloads', 'mv a.txt b.txt', 'cp -n a b', 'echo "form firm perform"', 'grep -rn "remove" src', 'mkdir -p x', 'git status', 'open .', 'cat norm.txt', 'brew list']) assert.equal(shellBlocked(ok), '', ok);
  assert.ok(scriptBlocked('tell application "Finder" to empty the trash'));
  assert.ok(scriptBlocked('do shell script "rm -rf /tmp/x"'));
  assert.equal(scriptBlocked('tell application "Finder" to delete POSIX file "/Users/a/x"'), '', 'Finder delete only moves to the Trash');
  assert.equal(scriptBlocked('tell application "Music" to play'), '');
});

test('paths: only inside the home folder, not its main folders, not Library, hidden things or app packages', () => {
  const home = '/Users/sam';
  assert.equal(pathProblem('/Users/sam/Downloads/a.pdf', home), '');
  assert.equal(pathProblem('~/Documents/Taxes/2025.pdf', home), '');
  for (const bad of ['/Users/sam', '~/Documents', '/Users/sam/Library/Mail/x', '/etc/hosts', '/Applications/X.app', '/Users/sam/.ssh/id_rsa', '/Users/sam/Pictures/Photos Library.photoslibrary/x', '/Users/sam/../other/x', '', null, '/Users/sam/Desktop/App.app/Contents/x']) assert.ok(pathProblem(bad, home), String(bad));
});

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-drive-'));
  const w = (rel, text = 'x') => { const p = path.join(home, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
  return { home, w };
}

test('a plan moves files into folders, never over anything, and nothing is lost', async () => {
  const { home, w } = sandbox();
  const a = w('Downloads/invoice.pdf', 'A'), b = w('Downloads/photo.jpg', 'B'), c = w('Downloads/notes.txt', 'C');
  w('Documents/PDFs/invoice.pdf', 'EXISTING');
  const plan = buildPlan({ moves: [{ from: a, to_folder: path.join(home, 'Documents/PDFs') }, { from: b, to_folder: '~/Pictures/2026' }, { from: path.join(home, 'Downloads/ghost.txt'), to_folder: '~/Documents' }, { from: c, to_folder: '~/Documents/Notes' }] }, { fs, home });
  assert.equal(plan.moves.length, 3);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].reason, /not there/);
  const m0 = plan.moves[0];
  assert.equal(path.basename(m0.to), 'invoice (2).pdf', 'a taken name gets (2), the existing file is untouched');
  assert.deepEqual(plan.groups.map((g) => path.relative(home, g.folder)).sort(), ['Documents/Notes', 'Documents/PDFs', 'Pictures/2026']);
  const res = await applyPlan(plan, { fs, trashItem: async () => { throw new Error('no'); } });
  assert.equal(res.done.length, 3);
  assert.equal(fs.readFileSync(path.join(home, 'Documents/PDFs/invoice.pdf'), 'utf8'), 'EXISTING');
  assert.equal(fs.readFileSync(path.join(home, 'Documents/PDFs/invoice (2).pdf'), 'utf8'), 'A');
  assert.ok(!fs.existsSync(a));
  // undo puts everything back
  const undone = undoMoves(res, { fs });
  assert.equal(undone.back.length, 3);
  assert.equal(fs.readFileSync(a, 'utf8'), 'A');
  assert.ok(!fs.existsSync(path.join(home, 'Documents/PDFs/invoice (2).pdf')));
  assert.equal(fs.readFileSync(path.join(home, 'Documents/PDFs/invoice.pdf'), 'utf8'), 'EXISTING', 'what was already there stays');
});

test('what must not be touched is skipped with the reason: protected places, project files, aliases, the inside of itself', () => {
  const { home, w } = sandbox();
  const proj = w('Documents/app/package.json', '{}'); const code = w('Documents/app/src/a.js'); const loose = w('Documents/loose.txt');
  fs.symlinkSync(loose, path.join(home, 'Documents/alias'));
  fs.mkdirSync(path.join(home, 'Documents/Folder'));
  const plan = buildPlan({ moves: [
    { from: code, to_folder: '~/Documents/Sorted' }, { from: path.join(home, 'Documents/alias'), to_folder: '~/Documents/Sorted' },
    { from: '/etc/hosts', to_folder: '~/Documents' }, { from: loose, to_folder: '/Applications' }, { from: loose, to_folder: '~/Library/x' },
    { from: path.join(home, 'Documents/Folder'), to_folder: '~/Documents/Folder/sub' }, { from: path.join(home, 'Documents/app'), to_folder: '~/Documents/Projects' }
  ] }, { fs, home });
  assert.equal(plan.moves.length, 1, 'only the whole project folder, moved as one');
  assert.equal(path.basename(plan.moves[0].from), 'app');
  assert.equal(plan.skipped.length, 5, 'the same file listed twice is only considered once');
  assert.ok(plan.skipped.some((s) => /project/.test(s.reason)));
  assert.ok(plan.skipped.some((s) => /alias/.test(s.reason)));
  assert.ok(plan.skipped.some((s) => /inside itself/.test(s.reason)));
  assert.ok(!proj.includes('undefined'));
});

test('files to get rid of go to the Trash (a move that can be undone), only when listed, and never anything protected', async () => {
  const { home, w } = sandbox();
  const old = w('Downloads/old.zip');
  const plan = buildPlan({ moves: [], trash: [old, '~/Documents', '/etc/passwd'] }, { fs, home });
  assert.deepEqual(plan.trash, [old]);
  assert.equal(plan.skipped.length, 2);
  const trashed = [];
  const res = await applyPlan(plan, { fs, trashItem: async (p) => { trashed.push(p); } });
  assert.deepEqual(res.trashed, [old]);
  assert.deepEqual(trashed, [old]);
  assert.ok(fs.existsSync(old), 'this test only checks the call: the real one moves it to the Trash');
});

test('a plan is limited in size, and a move that cannot happen is reported, not forced', async () => {
  const { home, w } = sandbox();
  const many = Array.from({ length: MAX_MOVES + 20 }, (_, i) => ({ from: w(`Downloads/f${i}.txt`), to_folder: '~/Documents/All' }));
  const plan = buildPlan({ moves: many }, { fs, home });
  assert.equal(plan.moves.length, MAX_MOVES);
  assert.ok(plan.skipped.length >= 20);
  const x = w('Downloads/x.txt');
  const p2 = buildPlan({ moves: [{ from: x, to_folder: '~/Documents/Z' }] }, { fs, home });
  fs.writeFileSync(path.join(home, 'Documents'), 'a file where the folder should be'); // makes the destination impossible
  const r = await applyPlan(p2, { fs, trashItem: async () => {} });
  assert.equal(r.done.length, 0);
  assert.equal(r.failed.length, 1);
  assert.ok(fs.existsSync(x), 'the file is where it was');
});

const { Drive } = require('../src/main/drive');
const { scanFolder, describeScan, findFiles, kindOf } = require('../src/main/drive/files');

function driveOn(home, over = {}) {
  const cards = []; const trashed = []; let logged = [];
  const d = new Drive({ fs, home, exec: async () => '', cards: { show: async (c) => { cards.push(c); }, hide: () => cards.push('hidden') }, trashItem: async (p) => { trashed.push(p); }, log: { read: () => logged, write: (l) => { logged = l; } }, ...over });
  return { d, cards, trashed, log: () => logged };
}

test('a scan lists what is in a folder, and does not go into projects, Library or hidden things', () => {
  const { home, w } = sandbox();
  w('Downloads/a.pdf'); w('Downloads/b.JPG', 'xx'); w('Downloads/.hidden/x'); w('Downloads/proj/package.json', '{}'); w('Downloads/proj/src/code.js'); w('Downloads/sub/c.mp3');
  const s = scanFolder(path.join(home, 'Downloads'), { fs, home });
  assert.deepEqual(s.files.map((f) => f.rel).sort(), ['a.pdf', 'b.JPG', path.join('sub', 'c.mp3')]);
  assert.ok(s.dirs.find((d) => d.rel === 'proj').project);
  const text = describeScan(s, home);
  assert.match(text, /3 files/);
  assert.match(text, /proj\/ \[project/);
  assert.equal(kindOf('x.HEIC'), 'image');
});

test('scanning a folder refuses a path redirected through a symbolic link', () => {
  const { home, w } = sandbox();
  w('Downloads/visible.txt');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-scan-outside-'));
  fs.writeFileSync(path.join(outside, 'private.txt'), 'private');
  fs.symlinkSync(outside, path.join(home, 'Downloads/link'));
  const { d } = driveOn(home);
  assert.match(d.scan({ folder: '~/Downloads/link' }), /symbolic link/);
  assert.match(d.scan({ folder: '~/Downloads' }), /visible.txt/);
});

test('file search and open do not follow paths into protected or linked folders', async () => {
  const { home, w } = sandbox();
  w('Library/private.txt');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-search-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.pdf'), 'private');
  fs.mkdirSync(path.join(home, 'Downloads'), { recursive: true });
  fs.symlinkSync(outside, path.join(home, 'Downloads/link'));
  const linked = path.join(home, 'Downloads/link/secret.pdf');
  const opened = [];
  const { d } = driveOn(home, { exec: async () => linked, open: (p) => opened.push(p) });
  assert.match(await d.find({ query: 'secret', folder: '~/Library' }), /Library/);
  assert.match(await d.find({ query: 'secret', folder: '~/Downloads/link' }), /symbolic link/);
  assert.match(await d.find({ query: 'secret' }), /Nothing found/);
  d.openFile(linked);
  assert.deepEqual(opened, []);
});

test('finding files uses Spotlight and shows the matches with previews on a card; clicking only opens safe kinds', async () => {
  const { home, w } = sandbox();
  const pdf = w('Documents/Taxes 2025.pdf'), exe = w('Downloads/tool.command'), lib = w('Library/x.txt');
  const opened = [], revealed = [];
  const { d, cards } = driveOn(home, { exec: async (_f, args) => (args.includes('-name') ? `${pdf}\n${lib}\n/etc/hosts\n` : `${pdf}\n${exe}\n`), thumb: async (p) => `data:image/jpeg;base64,${path.basename(p)}`, open: (p) => opened.push(p), reveal: (p) => revealed.push(p) });
  const text = await d.find({ query: 'taxes' });
  assert.match(text, /Taxes 2025\.pdf/);
  assert.ok(!text.includes('Library') && !text.includes('/etc/hosts'));
  assert.equal(cards[0].items.length, 2);
  assert.equal(cards[0].items[0].title, 'Taxes 2025.pdf', 'a name match first');
  assert.match(cards[0].items[0].image, /^data:image\/jpeg/);
  d.openFile(pdf); d.openFile(exe); d.openFile('/etc/hosts');
  assert.deepEqual(opened, [pdf], 'a PDF opens');
  assert.deepEqual(revealed, [exe], 'a script is only shown in Finder, and nothing outside the home folder is touched');
  assert.match(await d.find({ query: 'x', folder: '/etc' }), /only looks inside your home/);
  assert.equal(await findFiles('', { exec: async () => '', fs, home }).then((r) => r.length), 0);
});

test('tidying: the plan is shown first and nothing moves until it is applied; applying moves, logs, and can be undone', async () => {
  const { home, w } = sandbox();
  const a = w('Downloads/invoice.pdf', 'A'), b = w('Downloads/pic.png', 'B');
  const { d, cards, log } = driveOn(home);
  const text = await d.propose({ moves: [{ from: a, to_folder: '~/Documents/Invoices' }, { from: b, to_folder: '~/Pictures/Screens' }], note: 'by kind' });
  assert.match(text, /Where everything goes/);
  assert.match(text, /~\/Documents\/Invoices: 1 \(invoice\.pdf\)/);
  assert.ok(fs.existsSync(a) && fs.existsSync(b), 'nothing has moved yet');
  assert.equal(cards[0].hold, true, 'the plan stays on screen until answered');
  assert.deepEqual(cards[0].items.map((i) => i.title).sort(), ['→ ~/Documents/Invoices', '→ ~/Pictures/Screens']);
  const id = text.match(/Plan ([0-9a-f-]{36})/)[1];
  assert.match(d.confirmText(id), /Move 2 items as shown.*Nothing is deleted/);
  assert.equal(d.confirmText('nope'), null);
  const done = await d.apply({ plan_id: id });
  assert.match(done, /Moved 2/);
  assert.ok(!fs.existsSync(a) && fs.existsSync(path.join(home, 'Documents/Invoices/invoice.pdf')));
  assert.equal(log().length, 1);
  assert.match(await d.apply({ plan_id: id }), /no such plan/, 'a plan is used once');
  assert.match(await d.undo(), /Put 2 back/);
  assert.ok(fs.existsSync(a) && fs.existsSync(b));
  assert.match(await d.undo(), /nothing to undo/);
});

test('undo keeps failed moves available for retry and never substitutes a different plan id', async () => {
  const { home, w } = sandbox();
  const original = w('Downloads/invoice.pdf', 'original');
  const { d, log } = driveOn(home);
  const proposed = await d.propose({ moves: [{ from: original, to_folder: '~/Documents/Invoices' }] });
  const id = proposed.match(/Plan ([0-9a-f-]{36})/)[1];
  await d.apply({ plan_id: id });
  w('Downloads/invoice.pdf', 'replacement');
  assert.match(await d.undo('wrong-id'), /nothing to undo/i);
  assert.match(await d.undo(id), /could not be put back/);
  assert.equal(log()[0].done.length, 1);
  fs.unlinkSync(original);
  assert.match(await d.undo(id), /Put 1 back/);
  assert.equal(fs.readFileSync(original, 'utf8'), 'original');
  assert.equal(log().length, 0);
});

test('undo refuses a destination folder replaced by a symbolic link', async () => {
  const { home, w } = sandbox();
  const original = w('Downloads/a.txt', 'original');
  const { d, log } = driveOn(home);
  const proposed = await d.propose({ moves: [{ from: original, to_folder: '~/Documents/Sorted' }] });
  const id = proposed.match(/Plan ([0-9a-f-]{36})/)[1];
  await d.apply({ plan_id: id });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-undo-outside-'));
  fs.renameSync(path.join(home, 'Downloads'), path.join(home, 'Downloads-old'));
  fs.symlinkSync(outside, path.join(home, 'Downloads'));
  assert.match(await d.undo(id), /symbolic link/);
  assert.equal(log()[0].done.length, 1);
  assert.equal(fs.existsSync(path.join(outside, 'a.txt')), false);
});

test('folder plans reject symlinked paths and recheck them before moving', async () => {
  const { home, w } = sandbox();
  const source = w('Downloads/a.txt');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-outside-'));
  fs.symlinkSync(outside, path.join(home, 'Downloads/link'));
  const bad = buildPlan({ moves: [{ from: source, to_folder: '~/Downloads/link' }], trash: ['~/Downloads/link/a.txt'] }, { fs, home });
  assert.equal(bad.moves.length, 0);
  assert.equal(bad.trash.length, 0);
  const good = buildPlan({ moves: [{ from: source, to_folder: '~/Downloads/target' }] }, { fs, home });
  fs.symlinkSync(outside, path.join(home, 'Downloads/target'));
  const result = await applyPlan(good, { fs, home, trashItem: async () => {} });
  assert.equal(result.done.length, 0);
  assert.equal(result.failed.length, 1);
  assert.ok(fs.existsSync(source));
});

test('tidy plans do not put individual project files in the Trash', () => {
  const { home, w } = sandbox();
  w('Documents/project/package.json', '{}');
  const file = w('Documents/project/src/app.js');
  const plan = buildPlan({ moves: [], trash: [file] }, { fs, home });
  assert.deepEqual(plan.trash, []);
  assert.match(plan.skipped[0].reason, /part of a project/);
  assert.ok(fs.existsSync(file));
});

test('a plan of things that cannot be done says so, and trash is only for what is listed', async () => {
  const { home, w } = sandbox();
  const keep = w('Downloads/keep.txt'); const junk = w('Downloads/junk.zip');
  const { d, trashed } = driveOn(home);
  assert.match(await d.propose({ moves: [{ from: '/etc/hosts', to_folder: '~/Documents' }] }), /Nothing can be done/);
  const t = await d.propose({ moves: [], trash: [junk, '~/Documents'] });
  const id = t.match(/Plan ([0-9a-f-]{36})/)[1];
  assert.match(d.confirmText(id), /put 1 in the Trash/);
  const r = await d.apply({ plan_id: id });
  assert.deepEqual(trashed, [junk], 'only what was listed, through the Trash (never deleted)');
  assert.match(r, /put 1 in the Trash/);
  assert.ok(fs.existsSync(keep));
});

// A stand-in for zip and sips: makes the output file the way the real tools would, and records the call.
function makerExec(calls) {
  return async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const out = cmd.endsWith('zip') ? args[args.indexOf('--') - 1] : args[args.indexOf('--out') + 1];
    fs.writeFileSync(out, 'made');
    return '';
  };
}

test('zipping makes one archive next to the first item, never over a file, leaves the originals, and undo puts it in the Trash', async () => {
  const { home, w } = sandbox();
  const a = w('Downloads/report.pdf', 'A'), b = w('Downloads/notes/one.txt', 'B');
  w('Downloads/Archive.zip', 'EXISTING');
  const calls = []; const { d, trashed, log } = driveOn(home, { exec: makerExec(calls) });
  assert.match(d.makeConfirmText({ action: 'zip', paths: [a, path.join(home, 'Downloads/notes')] }), /Zip 2 items into ~\/Downloads\/Archive \(2\)\.zip.*originals stay.*undone/);
  const r = await d.make({ action: 'zip', paths: [a, path.join(home, 'Downloads/notes')] });
  assert.match(r, /Made ~\/Downloads\/Archive \(2\)\.zip/);
  assert.deepEqual(calls[0].args.slice(-3), ['--', 'Downloads/report.pdf', 'Downloads/notes'], 'paths are given relative to home');
  assert.equal(calls[0].opts.cwd, home);
  assert.equal(fs.readFileSync(path.join(home, 'Downloads/Archive.zip'), 'utf8'), 'EXISTING', 'nothing replaced');
  assert.ok(fs.existsSync(a) && fs.existsSync(b), 'originals untouched');
  assert.equal(log().length, 1);
  assert.match(await d.undo(), /Put 1 file Relay made in the Trash/);
  assert.deepEqual(trashed, [path.join(home, 'Downloads/Archive (2).zip')], 'through the Trash, not deleted');
  assert.match(await d.undo(), /nothing to undo/);
});

test('converting makes a copy in the new format beside each picture, skips what cannot be converted, and names the file the user can undo', async () => {
  const { home, w } = sandbox();
  const heic = w('Pictures/a.HEIC'), png = w('Pictures/b.png'), doc = w('Pictures/c.pdf');
  w('Pictures/a.jpg', 'EXISTING');
  const calls = []; const { d, trashed } = driveOn(home, { exec: makerExec(calls) });
  assert.match(d.makeConfirmText({ action: 'convert', paths: [heic, png], format: 'jpg' }), /Make 2 copies as JPEG/);
  const r = await d.make({ action: 'convert', paths: [heic, png, doc], format: 'JPG' });
  assert.match(r, /Made ~\/Pictures\/a \(2\)\.jpg, ~\/Pictures\/b\.jpg/);
  assert.match(r, /c\.pdf \(Not a picture/);
  assert.deepEqual(calls.map((c) => c.args.slice(0, 3)), [['-s', 'format', 'jpeg'], ['-s', 'format', 'jpeg']]);
  assert.equal(fs.readFileSync(path.join(home, 'Pictures/a.jpg'), 'utf8'), 'EXISTING');
  assert.match(await d.undo(), /Put 2 files Relay made in the Trash/);
  assert.equal(trashed.length, 2);
  // already in that format, and a format that is not supported
  assert.match(await d.make({ action: 'convert', paths: [png], format: 'png' }), /Nothing was made.*Already a PNG/);
  assert.match(await d.make({ action: 'convert', paths: [png], format: 'webm' }), /Nothing was made.*converted to/);
  assert.equal(d.makeConfirmText({ action: 'convert', paths: [png], format: 'webm' }), null);
});

test('making files keeps to the same rules: only inside home, no protected places, a failed job leaves nothing half-made', async () => {
  const { home, w } = sandbox();
  const a = w('Downloads/a.txt');
  const { d, trashed } = driveOn(home);
  assert.match(await d.make({ action: 'zip', paths: ['/etc/hosts', '~/Documents', path.join(home, 'Downloads/ghost')] }), /Nothing was made.*outside your home.*Documents folder itself.*not there/);
  const bad = driveOn(home, { exec: async (cmd, args) => { fs.writeFileSync(args[args.indexOf('--') - 1], 'half'); throw new Error('zip: out of space'); } });
  const r = await bad.d.make({ action: 'zip', paths: [a] });
  assert.match(r, /Nothing was made.*out of space/);
  assert.deepEqual(bad.trashed, [path.join(home, 'Downloads/a.zip')], 'the half-made file goes to the Trash, not deleted');
  assert.match(await d.make({ action: 'shred', paths: [a] }), /Say zip or convert/);
  assert.deepEqual(trashed, []);
});
