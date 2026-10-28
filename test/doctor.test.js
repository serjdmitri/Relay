const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../src/main/doctor');
const { FLAGS, isOn, canEnable } = require('../src/main/flags');

const good = {
  claude: () => ({ checked: true, installed: true, loggedIn: true, email: 'a@b.com' }),
  codex: () => ({ checked: true, installed: true, signedIn: true, usable: true }),
  failoverOn: () => true,
  perms: () => ({ accessibility: true, screen: true, mic: true }),
  signing: () => 'local',
  remote: () => ({ enabled: true, running: true, urls: ['http://x'], devices: [{}] }),
  hotkeys: () => ({ running: true }),
  speech: () => ({ available: true }),
  storeInfo: () => ({ freeMb: 5000 }),
  recentErrors: () => []
};
const by = (rs, id) => rs.find((r) => r.id === id);

test('everything fine is all ok', async () => {
  const rs = await d.runChecks(good);
  assert.equal(d.worst(rs), 'ok');
});

test('a missing permission fails with a button to the right settings pane', async () => {
  const rs = await d.runChecks({ ...good, perms: () => ({ accessibility: false, screen: true, mic: true }) });
  const r = by(rs, 'perm-accessibility');
  assert.equal(r.status, 'fail');
  assert.deepEqual(r.fix.action, { type: 'pane', name: 'accessibility' });
  assert.equal(r.fix.size, 'big');
});

test('ad-hoc signing explains the repeating Keychain prompt and offers the signing command', async () => {
  const r = by(await d.runChecks({ ...good, signing: () => 'adhoc' }), 'signing');
  assert.equal(r.status, 'warn');
  assert.match(r.cause, /asks again/);
  assert.equal(r.fix.action.text, 'npm run signing');
});

test('a phone server that is down has a small fix', async () => {
  const r = by(await d.runChecks({ ...good, remote: () => ({ enabled: true, running: false, urls: [] }) }), 'remote');
  assert.equal(r.status, 'fail');
  assert.equal(r.fix.size, 'small');
});

test('a check that hangs times out and one that throws is a failure, neither stops the others', async () => {
  const extra = [
    { id: 'slow', title: 'Slow', run: () => new Promise(() => {}) },
    { id: 'boom', title: 'Boom', run: () => { throw new TypeError('secret path /Users/me/x'); } }
  ];
  const rs = await d.runChecks(good, { extra, timeoutMs: 50 });
  assert.equal(by(rs, 'slow').cause, 'Timed out.');
  assert.equal(by(rs, 'boom').status, 'fail');
  assert.equal(by(rs, 'boom').cause, 'Check failed (TypeError).');
  assert.equal(by(rs, 'claude').status, 'ok');
});

test('two overlapping runs share one result', async () => {
  const a = d.runChecks(good);
  const b = d.runChecks(good);
  assert.equal(a, b);
  await a;
});

test('fix policy: small fixes run on their own only in "small" mode, big ones always ask, never means nothing', () => {
  const small = { size: 'small' }; const big = { size: 'big' };
  assert.equal(d.fixPolicy('ask', small), 'ask');
  assert.equal(d.fixPolicy('small', small), 'auto');
  assert.equal(d.fixPolicy('small', big), 'ask');
  assert.equal(d.fixPolicy('never', small), 'none');
  assert.equal(d.fixPolicy('small', null), 'none');
});

test('the report is scrubbed of home folders, emails, keys, query strings and network addresses', () => {
  const t = '/Users/sergey/Docs a@b.com sk-abcdefghijklmnop1234 Bearer abcdefghij12345 https://x.com/a?token=zz http://192.168.1.5:3000 mac.tail1234.ts.net ' + 'a'.repeat(45);
  const s = d.scrub(t, { home: '/Users/sergey' });
  assert.ok(!/sergey|a@b|sk-abc|abcdefghij12345|token=zz|192\.168|ts\.net|aaaaaaaaaa/.test(s), s);
  assert.match(s, /~\/Docs/);
});

test('buildReport lists every check and nothing private', async () => {
  const rs = await d.runChecks({ ...good, claude: () => ({ checked: true, installed: true, loggedIn: true, email: 'me@x.com' }) });
  const r = d.buildReport(rs, { version: '0.34.0', os: '26.0', arch: 'arm64', signing: 'adhoc', flags: ['plugins'], errors: [{ tool: 'click', error: 'failed at /Users/me/f' }] });
  assert.match(r, /Relay 0.34.0/);
  assert.match(r, /Experimental on: plugins/);
  assert.ok(!/me@x\.com|\/Users\/me/.test(r));
});

test('issue link: bug or feature, short body, no token', () => {
  const u = new URL(d.issueUrl('bug', { title: 'Mic is silent', version: '0.34.0' }));
  assert.equal(u.origin + u.pathname, 'https://github.com/serjdmitri/Relay/issues/new');
  assert.equal(u.searchParams.get('title'), 'Bug: Mic is silent');
  assert.equal(u.searchParams.get('labels'), 'bug');
  assert.equal(new URL(d.issueUrl('feature')).searchParams.get('labels'), 'enhancement');
});

test('signing is read from codesign output', () => {
  assert.equal(d.parseSigning('Signature=adhoc'), 'adhoc');
  assert.equal(d.parseSigning('Authority=Relay Local Signing'), 'local');
  assert.equal(d.parseSigning('Authority=Developer ID Application: X'), 'developer');
  assert.equal(d.parseSigning(''), 'unknown');
});

test('flags are off unless set, and one that needs a permission says so', () => {
  assert.equal(isOn({}, 'plugins'), false);
  assert.equal(isOn({ flags: { plugins: true } }, 'plugins'), true);
  assert.equal(isOn({ flags: { nope: true } }, 'nope'), false);
  assert.equal(canEnable('plugins').ok, true);
  assert.equal(canEnable('imessage', { fulldisk: false }).ok, false);
  assert.match(canEnable('imessage', {}).why, /Full Disk Access/);
  assert.equal(canEnable('imessage', { fulldisk: true }).ok, true);
  assert.ok(Object.keys(FLAGS).length >= 9);
});

test('voice command: run the doctor and its variants, nothing else', () => {
  const d2 = require('../src/main/doctor');
  for (const t of ['run the doctor', 'Hey Jarvis, run diagnostics.', 'check yourself', "what's wrong with Relay", 'run a health check', 'diagnose yourself']) assert.equal(d2.parseDoctorCommand(t), true, t);
  for (const t of ['call the doctor tomorrow', 'check my email', 'what is wrong with my essay', 'doctor strange showtimes']) assert.equal(d2.parseDoctorCommand(t), false, t);
});

test('the spoken summary names the worst problems first and counts the rest', () => {
  const d2 = require('../src/main/doctor');
  assert.equal(d2.summarize([{ status: 'ok', title: 'A', cause: '' }]), 'Everything checks out.');
  const s = d2.summarize([{ status: 'warn', title: 'W', cause: 'meh.' }, { status: 'fail', title: 'F', cause: 'broken.' }, { status: 'warn', title: 'W2', cause: 'x.' }]);
  assert.match(s, /^3 things need a look\. F: broken\. W: meh\./);
  assert.match(s, /1 more/);
});
