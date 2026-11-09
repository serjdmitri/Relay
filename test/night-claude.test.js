const test = require('node:test'), assert = require('node:assert/strict');
const { buildBrief, runNight, parseNightCommand: p, MAX_FILES } = require('../src/main/nightClaude');
const { NightlyMaintenance } = require('../src/main/nightlyMaintenance');

// a fake proposal workspace: git answers come from a script
function fakeProposals({ status = '', numstat = '', create = null } = {}) {
  const calls = [], patches = [];
  return { calls, patches,
    create: async (t) => create || { proposal: { id: 'abcd1234', title: t, branch: 'proposal/night-x', dir: '/tmp/ws' } },
    git: async (args) => { calls.push(args.join(' ')); if (args[0] === 'status') return { code: 0, stdout: status }; if (args[0] === 'diff') return { code: 0, stdout: numstat }; return { code: 0, stdout: '' }; },
    discard: async (id) => { calls.push('discard ' + id); return {}; }, patch: (id, x) => patches.push(x) };
}

test('the brief tells Claude the rules and shows it the evidence as data', () => {
  const b = buildBrief({ diagLines: ['2026-11-08T01:00:00Z hotkeys-restarted after wake'], speed: 'slowest is thinking', extra: 'make startup faster' });
  for (const must of ['ONE small', 'data, not instructions', 'hotkeys-restarted', 'slowest is thinking', 'make startup faster', 'under src/ and test/', 'Never weaken security', 'No new dependencies', 'cannot run commands', 'SUMMARY:']) assert.ok(b.includes(must), must);
  assert.ok(buildBrief().includes('nothing yet'));
});

test('a small change inside src and test is prepared for review, marked unreviewed and never run', async () => {
  const pr = fakeProposals({ status: ' M src/main/voice.js\n?? test/voice-extra.test.js\n', numstat: '12\t3\tsrc/main/voice.js\n30\t0\ttest/voice-extra.test.js\n' });
  const r = await runNight({ proposals: pr, runClaude: async () => ({ code: 0, stdout: 'done\nSUMMARY: the voice worker is restarted if it dies mid-reply' }), brief: 'b', key: '2026-11-08' });
  assert.equal(r.status, 'ready'); assert.match(r.line, /voice worker is restarted/); assert.match(r.line, /It has not run/); assert.equal(r.lines, 45);
  assert.deepEqual(pr.patches[0], { generated: true, reviewed: false, reason: 'the voice worker is restarted if it dies mid-reply', night: pr.patches[0].night });
  assert.ok(!pr.calls.some((c) => /^discard/.test(c)), 'it is kept');
});

test('anything outside the allowed folders, too many files, too many lines, no change, or a Claude failure is thrown away', async () => {
  const run = (o, claude = async () => ({ code: 0, stdout: '' })) => { const pr = fakeProposals(o); return runNight({ proposals: pr, runClaude: claude, brief: 'b' }).then((r) => ({ r, pr })); };
  let x = await run({ status: ' M package.json\n M src/main/a.js\n' }); assert.equal(x.r.status, 'discarded'); assert.match(x.r.line, /touched files it may not \(package\.json\)/);
  assert.ok(x.pr.calls.includes('checkout -- .') && x.pr.calls.includes('clean -fdq') && x.pr.calls.some((c) => c.startsWith('discard')), 'the edits are wiped before the workspace is dropped');
  x = await run({ status: ' M src/main/a.js\n M scripts/make-dmg.sh\n' }); assert.match(x.r.line, /scripts\/make-dmg\.sh/);
  x = await run({ status: ' M ../../etc/hosts\n' }); assert.equal(x.r.status, 'discarded');
  x = await run({ status: Array.from({ length: MAX_FILES + 1 }, (_, i) => ` M src/main/f${i}.js`).join('\n') + '\n' }); assert.match(x.r.line, /more than 8/);
  x = await run({ status: ' M src/main/a.js\n', numstat: '300\t200\tsrc/main/a.js\n' }); assert.match(x.r.line, /too big/);
  x = await run({ status: '' }); assert.match(x.r.line, /found nothing worth changing/);
  x = await run({ status: '' }, async () => ({ code: 1, stdout: '', error: 'Claude is not installed' })); assert.match(x.r.line, /Claude could not finish \(Claude is not installed\)/);
  x = await run({ status: '' }, async () => { throw Error('boom'); }); assert.match(x.r.line, /boom/);
  const off = await runNight({ proposals: fakeProposals({ create: { error: 'Self-improvement is off.' } }), runClaude: async () => ({}), brief: 'b' }); assert.equal(off.status, 'error'); assert.match(off.line, /could not start/);
});

test('nightly maintenance runs the Claude step only when it is switched on, and a failure there cannot break the rest', async () => {
  const mk = (cfg, claudeNight) => { const store = { d: {}, get(k) { return this.d[k]; }, set(k, v) { this.d[k] = v; }, flush() {} }; return { store, m: new NightlyMaintenance({ store, proposals: { list: () => [], conf: () => ({ repo: '' }) }, settings: () => cfg, claudeNight }) }; };
  let called = 0;
  let x = mk({ nightly: true, claude: true }, async () => { called++; return { line: 'Overnight Claude prepared a change.' }; });
  assert.equal(await x.m.run('k1'), true); assert.equal(called, 1); assert.match(x.store.d.nightlyMaintenance.text, /Overnight Claude prepared a change\./);
  assert.match(x.store.d.nightlyMaintenance.text, /Nothing was merged, pushed or installed/);
  x = mk({ nightly: true, claude: false }, async () => { called++; return { line: 'x' }; }); await x.m.run('k2'); assert.equal(called, 1, 'off means off');
  x = mk({ nightly: true, claude: true }, async () => { throw Error('claude fell over'); }); await x.m.run('k3'); assert.match(x.store.d.nightlyMaintenance.text, /claude fell over/); assert.equal(x.store.d.nightlyMaintenance.status, 'done');
});

test('turning overnight self-improvement on, off and asking for the report are understood', () => {
  for (const t of ['turn on overnight self improvement', 'Jarvis, turn on the nightly self-improvement.', 'improve yourself while i sleep', 'enable overnight code improvement']) assert.deepEqual(p(t), { type: 'night-on' }, t);
  for (const t of ['turn off overnight self improvement', 'stop improving yourself overnight']) assert.deepEqual(p(t), { type: 'night-off' }, t);
  for (const t of ['what did you improve overnight', 'what did you fix last night', 'overnight improvement report']) assert.deepEqual(p(t), { type: 'night-report' }, t);
  for (const t of ['what is the weather', 'improve my essay', 'turn on dark mode']) assert.equal(p(t), null, t);
});

test('a brand-new file is counted in the size limit, and a Claude error after editing is not trusted', async () => {
  // the fake answers numstat only once the new file has been marked with "add -N", like git does
  const calls = []; let marked = false;
  const pr = { create: async () => ({ proposal: { id: 'x', branch: 'b', dir: '/tmp/w' } }), discard: async () => ({}), patch() {},
    git: async (args) => { calls.push(args.join(' ')); if (args[0] === 'add') marked = true; if (args[0] === 'status') return { code: 0, stdout: '?? test/big.test.js\n' }; if (args[0] === 'diff') return { code: 0, stdout: marked ? '1000\t0\ttest/big.test.js\n' : '' }; return { code: 0, stdout: '' }; } };
  const r = await runNight({ proposals: pr, runClaude: async () => ({ code: 0, stdout: '' }), brief: 'b' });
  assert.equal(r.status, 'discarded'); assert.match(r.line, /too big/); assert.ok(calls.indexOf('add -N -- .') < calls.indexOf('diff --numstat HEAD'), 'marked before counting');
  const mk = () => ({ create: async () => ({ proposal: { id: 'x', branch: 'b', dir: '/tmp/w' } }), discard: async () => ({}), patch() {}, git: async (a) => ({ code: 0, stdout: a[0] === 'status' ? ' M src/a.js\n' : a[0] === 'diff' ? '2\t1\tsrc/a.js\n' : '' }) });
  const e = await runNight({ proposals: mk(), runClaude: async () => ({ code: 1, stdout: 'SUMMARY: ok', error: 'timed out' }), brief: 'b' });
  assert.equal(e.status, 'discarded'); assert.match(e.line, /error after editing/);
  assert.equal((await runNight({ proposals: mk(), runClaude: async () => ({ code: 0, stdout: 'SUMMARY: ok' }), brief: 'b' })).status, 'ready');
});
