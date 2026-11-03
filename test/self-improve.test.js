const test = require('node:test');
const assert = require('node:assert/strict');
const { ProposalWorkspace, parseSelfImproveCommand, slug } = require('../src/main/selfImprove');

// A fake git/npm: the working tree is a string the test edits; every call is recorded.
function make({ repo = '/h/relay', testOut = 'ℹ pass 1157\nℹ fail 0', testCode = 0, worktreeFail = false } = {}) {
  const calls = [], data = {}, tree = { status: '', content: '' };
  const store = { get: (k) => data[k], set: (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); } };
  const run = async (args, { cwd }) => {
    calls.push({ args, cwd });
    const [cmd, a1, a2] = args;
    if (cmd === 'npm') return { code: testCode, stdout: testOut, stderr: '' };
    if (a1 === 'worktree' && a2 === 'add') return worktreeFail ? { code: 128, stdout: '', stderr: 'fatal: invalid reference: main' } : { code: 0, stdout: '', stderr: '' };
    if (a1 === 'worktree' && a2 === 'remove') return { code: 0, stdout: '', stderr: '' };
    if (a1 === 'status') return { code: 0, stdout: tree.status, stderr: '' };
    if (a1 === 'diff') return {code:0,stdout:tree.content,stderr:''};
    if (a1 === 'ls-files') return {code:0,stdout:'',stderr:''};
    if (a1 === 'add') return { code: 0, stdout: '', stderr: '' };
    if (a1 === 'commit') { tree.status = ''; return { code: 0, stdout: '', stderr: '' }; }
    if (a1 === 'rev-parse') return { code: 0, stdout: 'abcdef1234567890\n', stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
  let n = 0, t = 1000;
  const w = new ProposalWorkspace({ run, store, getConfig: () => ({ repo }), now: () => (t += 1), uuid: () => `id${++n}abcdef` });
  return { w, calls, tree, data };
}

test('it is off until a source checkout is set, and needs a real name', async () => {
  assert.match((await make({ repo: '' }).w.create('faster startup')).error, /Self-improvement is off/);
  assert.match((await make({ repo: 'relative/path' }).w.create('faster startup')).error, /off/);
  assert.match((await make().w.create('??')).error, /short name/);
  assert.match((await make({ worktreeFail: true }).w.create('faster startup')).error, /Could not create the workspace/);
});

test('a proposal gets its own worktree and branch, away from the running code', async () => {
  const m = make();
  const { proposal: p } = await m.w.create('Faster startup');
  assert.match(p.branch, /^proposal\/faster-startup-/);
  assert.equal(p.dir.startsWith('/h/relay-proposals/faster-startup-'), true, 'a sibling folder, not inside the checkout Relay runs from');
  assert.deepEqual(m.calls[0].args.slice(0, 5), ['git', 'worktree', 'add', '-b', p.branch]);
  assert.equal(m.calls[0].cwd, '/h/relay');
  assert.match(m.w.describe(p), /not tested yet/);
});

test('tests run inside the proposal only, and a commit needs a pass on exactly those files', async () => {
  const m = make();
  const { proposal: p } = await m.w.create('faster startup');
  assert.match((await m.w.commit('')).error, /no changes/);
  m.tree.status = ' M src/main/main.js\n';
  assert.match((await m.w.commit('')).error, /tests have not passed/);
  const t = await m.w.test('');
  assert.deepEqual([t.ok, t.passed, t.failed], [true, 1157, 0]);
  assert.equal(m.calls.find((c) => c.args[0] === 'npm').cwd, p.dir, 'never in the real checkout');
  m.tree.status = ' M src/main/main.js\n M src/main/store.js\n';
  assert.match((await m.w.commit('')).error, /changed after the last passing test/);
  await m.w.test('');
  const c = await m.w.commit('', 'speed up startup');
  assert.equal(c.sha, 'abcdef1234567890'); assert.equal(c.branch, p.branch);
  const commitCall = m.calls.find((x) => x.args[1] === 'commit');
  assert.match(commitCall.args.join(' '), /Proposal: speed up startup/); assert.match(commitCall.args.join(' '), /git revert/);
  assert.match((await m.w.commit('', 'again')).error, /already saved/);
  assert.match(m.w.describe(m.w.list()[0]), /saved as commit abcdef12/);
});

test('failing tests block saving, and a test run with no results is not treated as a pass', async () => {
  const bad = make({ testOut: 'ℹ pass 1100\nℹ fail 3', testCode: 1 });
  await bad.w.create('x change'); bad.tree.status = ' M a.js\n';
  assert.equal((await bad.w.test('')).ok, false);
  assert.match((await bad.w.commit('')).error, /tests have not passed/);
  const empty = make({ testOut: '', testCode: 0 });
  await empty.w.create('x change'); empty.tree.status = ' M a.js\n';
  assert.equal((await empty.w.test('')).ok, false, 'exit code 0 with no test results proves nothing');
});

test('nothing it can do pushes, merges, installs or switches your branch', async () => {
  const m = make();
  await m.w.create('faster startup'); m.tree.status = ' M a.js\n';
  await m.w.test(''); await m.w.commit(''); await m.w.discard('');
  const all = m.calls.map((c) => c.args.join(' ')).join('\n');
  for (const word of ['push', 'merge', 'checkout', 'switch', 'reset', 'rebase', 'install', 'pull', 'fetch']) assert.equal(new RegExp(`\\b${word}\\b`).test(all), false, word);
});

test('discarding refuses to throw away unsaved changes and otherwise keeps the branch', async () => {
  const m = make();
  await m.w.create('faster startup'); m.tree.status = ' M a.js\n';
  assert.match((await m.w.discard('')).error, /not saved/);
  assert.equal(m.calls.some((c) => c.args[2] === 'remove'), false, 'nothing was deleted');
  m.tree.status = '';
  assert.ok((await m.w.discard('faster')).proposal);
  assert.equal(m.calls.some((c) => c.args.includes('branch')), false, 'the branch stays');
  assert.equal(typeof m.w.list()[0].discarded, 'number');
});

test('proposals are found by id, prefix or words, and the open ones are capped', async () => {
  const m = make();
  await m.w.create('faster startup'); await m.w.create('quieter alerts');
  assert.equal(m.w.find('quiet').title, 'quieter alerts');
  assert.equal(m.w.find(m.w.list()[0].id.slice(0, 4)).title, 'faster startup');
  assert.equal(m.w.find(''), null, 'with two open, "the proposal" is ambiguous');
  for (let i = 0; i < 8; i++) await m.w.create(`change number ${i}`);
  assert.match((await m.w.create('one more')).error, /10 open proposals/);
  assert.equal(slug('  Faster, startup!! '), 'faster-startup');
});

test('voice commands are understood and ordinary talk is left alone', () => {
  assert.deepEqual(parseSelfImproveCommand('start a proposal to speed up startup'), { type: 'start', title: 'speed up startup' });
  assert.deepEqual(parseSelfImproveCommand('Jarvis, create a new code proposal called quieter alerts'), { type: 'start', title: 'quieter alerts' });
  assert.deepEqual(parseSelfImproveCommand('test the proposal'), { type: 'test', ref: '' });
  assert.deepEqual(parseSelfImproveCommand('save the proposal as faster boot'), { type: 'commit', message: 'faster boot' });
  assert.deepEqual(parseSelfImproveCommand('discard the proposal quieter'), { type: 'discard', ref: 'quieter' });
  assert.deepEqual(parseSelfImproveCommand('list my proposals'), { type: 'list' });
  for (const t of ['push the proposal', 'merge the proposal', 'install the proposal', 'I have a proposal for you', 'open Notes', '']) assert.equal(parseSelfImproveCommand(t), null, t);
});

test('same dirty filenames with changed contents invalidate the tested proposal',async()=>{const m=make();await m.w.create('faster startup');m.tree.status=' M a.js\n';m.tree.content='first';await m.w.test('');m.tree.content='changed';assert.match((await m.w.commit('')).error,/changed after/);});
