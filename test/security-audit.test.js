const test = require('node:test'), assert = require('node:assert/strict');
const A = require('../src/main/securityAudit');
const { gatherFacts, parseListenPorts } = require('../src/main/auditFacts');

const NOW = 1793600000000, DAY = 86400e3;
const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';
const good = () => ({
  desktop: { sip: true, filevault: 'on', firewall: 1, stealth: true, gatekeeper: true, autoLogin: false, screenLock: { enabled: true, delaySec: 0 }, remoteLogin: false, screenSharing: false, fileSharing: false, autoUpdates: true },
  listeners: [{ process: 'node', port: 3000, localOnly: true }],
  phone: { enabled: false, running: false, devices: [] },
  texts: { on: false, paired: false },
  credentials: { encryptionAvailable: true, plain: [], tokenShaped: [], encrypted: ['settings.calls.keyEnc'], historyHits: 0, fileMode: 0o600, dirMode: 0o700 },
  permissions: { accessibility: false, screen: false, mic: true, camera: false, fullDisk: false },
  features: { camera: false, messages: false },
  files: { homeOnly: true, driveRoots: ['/Users/me/Downloads'], home: '/Users/me', doctorFix: 'ask', plugins: [], pluginSandbox: true },
  indicators: { currentUser: 'me', admins: ['root', 'me', '_mbsetupuser'], profiles: { count: 0, ids: [] }, proxy: [], hosts: [], launchItems: [] }
});
const ids = (r) => r.findings.map((f) => f.id);

test('macOS command output parses, and anything unrecognized is null rather than a guess', () => {
  assert.equal(A.parseSip('System Integrity Protection status: enabled.'), true);
  assert.equal(A.parseSip('System Integrity Protection status: disabled.'), false);
  assert.equal(A.parseSip('boom'), null);
  assert.equal(A.parseGatekeeper('assessments enabled'), true);
  assert.equal(A.parseGatekeeper('assessments disabled'), false);
  assert.equal(A.parseStealth('Firewall stealth mode is off'), false);
  assert.equal(A.parseAutoUpdate('Automatic checking for updates is turned on'), true);
  assert.deepEqual(A.parseScreenLock('2026 sysadminctl[1:2] screenLock delay is 60 seconds'), { enabled: true, delaySec: 60 });
  assert.deepEqual(A.parseScreenLock('screenLock delay is immediate'), { enabled: true, delaySec: 0 });
  assert.deepEqual(A.parseScreenLock('screenLock is off'), { enabled: false, delaySec: null });
  assert.equal(A.parseScreenLock(''), null);
});

test('secret scanning reports where a secret sits and never what it says', () => {
  const data = { settings: { calls: { keyEnc: 'djEwAAAA' }, old: { tokenEnc: 'plain:hunter2hunter2' }, notes: { text: `my key ${SECRET}` }, model: 'claude-fable-5-1' }, actions: [{ result: SECRET }], remoteDevices: [{ hash: 'a'.repeat(64) }] };
  const r = A.scanForSecrets(data);
  assert.deepEqual(r.plain, ['settings.old.tokenEnc']);
  assert.deepEqual(r.tokenShaped, ['settings.notes.text']);
  assert.deepEqual(r.encrypted, ['settings.calls.keyEnc']);
  const out = JSON.stringify(r);
  assert.ok(!out.includes('hunter2') && !out.includes(SECRET));
  assert.equal(A.countTokenRecords(data.actions), 1);
  assert.equal(A.countTokenRecords(null), 0);
  assert.equal(A.looksLikeToken('claude-fable-5-1'), false);
});

test('a well-set-up Mac has nothing above info and every check that ran is listed as passed', () => {
  const r = A.runAudit(good(), { now: NOW });
  assert.equal(r.counts.critical + r.counts.high + r.counts.medium + r.counts.low, 0);
  assert.ok(r.passed.length >= 10);
  assert.equal(r.notChecked.length, 0);
  assert.match(A.summarize(r), /nothing to fix/);
});

test('risky settings are found, explained, given a fix and sorted worst first', () => {
  const f = good();
  Object.assign(f.desktop, { sip: false, filevault: 'off', firewall: 0, autoLogin: true, remoteLogin: true, screenLock: { enabled: true, delaySec: 900 } });
  Object.assign(f.credentials, { plain: ['settings.old.tokenEnc'], tokenShaped: ['settings.notes.text'], historyHits: 2, dirMode: 0o755 });
  f.files = { ...f.files, homeOnly: false, driveRoots: ['/', '/Users/me'], plugins: [{ name: 'shelly', permissions: { shell: true, files: [{ path: '~/Docs', mode: 'write' }] } }], pluginSandbox: false };
  f.permissions = { accessibility: true, screen: true, fullDisk: true, camera: true };
  const r = A.runAudit(f, { now: NOW });
  const got = ids(r);
  for (const id of ['sip-off', 'filevault-off', 'firewall-off', 'auto-login', 'ssh-on', 'screen-lock-slow', 'plaintext-secrets', 'token-in-settings', 'token-in-history', 'data-dir-open', 'home-only-off', 'roots-broad', 'roots-home', 'plugin-shell-shelly', 'plugin-write-shelly', 'plugin-sandbox', 'perm-combo', 'perm-fulldisk', 'perm-camera-unused']) assert.ok(got.includes(id), `missing ${id}`);
  assert.equal(r.findings[0].id, 'sip-off');
  assert.equal(r.findings[0].severity, 'critical');
  const ranks = r.findings.map((x) => A.SEVERITIES.indexOf(x.severity));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  for (const x of r.findings.filter((y) => y.severity !== 'info')) assert.ok(x.detail && x.fix, `${x.id} needs a detail and a fix`);
  assert.match(A.summarize(r), /critical.*most important: System Integrity Protection is off/);
});

test('phone access: plain HTTP on the network, stale and never-used devices, the shortcut token', () => {
  const f = good();
  f.phone = { enabled: true, running: true, lan: true, port: 47900, devices: [{ id: 'a', name: 'Old iPhone', lastSeen: NOW - 40 * DAY }, { id: 'b', name: 'Siri Shortcut', lastSeen: NOW - DAY }, { id: 'c', name: 'Mystery', lastSeen: 0 }], pairingActive: true };
  f.texts = { on: true, paired: true };
  const got = ids(A.runAudit(f, { now: NOW }));
  for (const id of ['phone-http', 'phone-stale', 'phone-never', 'phone-shortcut', 'phone-pairing', 'texts-on']) assert.ok(got.includes(id), `missing ${id}`);
  f.phone = { enabled: true, running: true, lan: false, port: 47900, devices: [{ id: 'a', name: 'iPhone', lastSeen: NOW - DAY }] };
  const ok = A.runAudit(f, { now: NOW });
  assert.ok(!ids(ok).includes('phone-http'));
  assert.ok(ok.passed.some((p) => p.id === 'phone-local') && ok.passed.some((p) => p.id === 'phone-devices'));
});

test('a source that could not be read is "not checked", never a pass and never a finding', () => {
  const r = A.runAudit({ ...good(), desktop: null, credentials: null, phone: null, permissions: null, files: null, listeners: null, indicators: null }, { now: NOW });
  assert.equal(r.notChecked.length, 7);
  assert.equal(r.findings.length, 0);
  assert.ok(!r.passed.some((p) => p.area === 'desktop'));
  assert.match(A.summarize(r), /7 checks were not readable, so they are not counted as passed/);
  const partial = good(); partial.desktop.sip = null; partial.desktop.filevault = 'unknown';
  assert.deepEqual(A.runAudit(partial, { now: NOW }).notChecked.map((x) => x.id).sort(), ['filevault', 'sip']);
});

test('a check that throws is reported, and the other checks still run', () => {
  const f = good(); f.files = { get homeOnly() { throw new Error('boom'); } };
  const r = A.runAudit(f, { now: NOW });
  assert.ok(r.notChecked.some((x) => x.id === 'check-failed'));
  assert.ok(r.passed.length > 5);
});

test('the shareable report and the spoken summary never contain a secret value', () => {
  const f = good(); f.credentials.tokenShaped = ['settings.notes.text']; f.credentials.plain = ['settings.old.tokenEnc'];
  const r = A.runAudit(f, { now: NOW });
  const text = A.buildReport(r, { version: '0.36.1' }) + A.summarize(r);
  assert.ok(!text.includes(SECRET));
  assert.match(text, /Relay security audit \(Relay 0\.36\.1\)/);
  assert.match(text, /settings\.old\.tokenEnc/);
});

test('any short request about this Mac\'s security runs the audit, and unrelated ones do not', () => {
  for (const t of ['run a security audit', 'Jarvis, run a deep security audit', 'security audit', 'do a full security check on my Mac', 'audit my security', 'check my mac security', 'how secure is my mac', 'Run a security scan.', 'give me a security review', 'check my security', 'is my mac secure', 'is my mac safe', 'am I safe', 'has my mac been hacked', "what's compromised", 'is anything compromised', 'security status', 'any security warnings', 'show me my security', 'is my phone access secure', 'Hey Jarvis, is anything at risk', 'what is exposed', 'security report']) assert.equal(A.parseAuditCommand(t), true, t);
  for (const t of ['run doctor', 'what is the weather', 'open the security camera', 'secure my files', 'how secure is the password', 'run the tests', 'security', 'show network radar', 'security guard jobs', 'write an essay about cybersecurity', 'open security settings', 'is the door secure', 'how secure is my wifi password', 'tell me a joke about security', 'check my email']) assert.equal(A.parseAuditCommand(t), false, t);
});

test('"turn off security warnings" and "warn me about security problems" switch the watch', () => {
  for (const t of ['turn off security warnings', 'stop security warnings', 'stop warning me about security', "don't give me security alerts", 'Jarvis, disable security alerts']) assert.equal(A.parseWatchCommand(t), false, t);
  for (const t of ['turn on security warnings', 'warn me about security problems', 'keep an eye on my security', 'enable security alerts']) assert.equal(A.parseWatchCommand(t), true, t);
  for (const t of ['security audit', 'turn off the lights', 'warn me about the weather', '']) assert.equal(A.parseWatchCommand(t), null, t);
});

test('signs of compromise: extra administrators, profiles, proxies and host redirects are flagged; Apple setup accounts and updaters are not', () => {
  assert.deepEqual(A.parseAdmins('GroupMembership: root me _mbsetupuser'), ['root', 'me', '_mbsetupuser']);
  assert.deepEqual(A.parseProfiles("me[1] attribute: profileIdentifier: com.apple.ManagedSettings.macOS.7BE22211-B222-4C33-9D44-110000000055\nThere are 1 user configuration profiles installed for 'me'"), { count: 1, ids: ['com.apple.ManagedSettings.macOS.7BE22211-B222-4C33-9D44-110000000055'] });
  assert.deepEqual(A.parseProfiles('There are no configuration profiles installed'), { count: 0, ids: [] });
  assert.equal(A.parseProfiles('profiles: this command requires root privileges'), null);
  assert.deepEqual(A.parseProxy('<dictionary> {\n  FTPPassive : 1\n}'), []);
  assert.deepEqual(A.parseProxy('<dictionary> {\n  HTTPEnable : 1\n  SOCKSEnable : 1\n}'), ['HTTP', 'SOCKS']);
  assert.equal(A.parseProxy('nothing'), null);
  assert.deepEqual(A.parseHosts('##\n127.0.0.1\tlocalhost\n255.255.255.255\tbroadcasthost\n::1             localhost\n'), []);
  assert.deepEqual(A.parseHosts('127.0.0.1 localhost\n10.9.9.9 login.bank.com www.bank.com # fake\n'), ['login.bank.com -> 10.9.9.9', 'www.bank.com -> 10.9.9.9']);
  const f = good();
  f.indicators = { currentUser: 'me', admins: ['root', 'me', 'stranger', '_mbsetupuser'], profiles: { count: 1, ids: ['com.apple.ManagedSettings.macOS.7BE22211-B222-4C33-9D44-110000000055'] }, proxy: ['HTTP'], hosts: ['login.bank.com -> 10.9.9.9'], launchItems: ['com.google.keystone.agent', 'us.zoom.updater'] };
  const r = A.runAudit(f, { now: NOW }), got = ids(r);
  for (const id of ['extra-admin', 'profiles', 'proxy', 'hosts', 'launch-items']) assert.ok(got.includes(id), `missing ${id}`);
  assert.match(r.findings.find((x) => x.id === 'extra-admin').title, /stranger/);
  assert.ok(!r.findings.find((x) => x.id === 'extra-admin').title.includes('_mbsetupuser'));
  assert.match(r.findings.find((x) => x.id === 'profiles').detail, /^com\.apple\.ManagedSettings\.macOS\./);
  assert.equal(r.findings.find((x) => x.id === 'launch-items').severity, 'info');
  assert.ok(A.runAudit(good(), { now: NOW }).passed.some((x) => x.id === 'admins'));
  assert.match(A.buildReport(r), /cannot prove a Mac is free of malware/);
});

test('warnings: new medium-and-worse findings are told once, repeat only for critical or high after a week, and come back if they go and return', () => {
  const f = good(); f.desktop.filevault = 'off'; f.desktop.firewall = 0; f.desktop.stealth = true; f.desktop.remoteLogin = true; f.desktop.sip = false;
  const rep = () => A.runAudit(f, { now: NOW });
  const first = A.selectWarnings(rep(), null, { now: NOW });
  assert.deepEqual(first.warn.map((x) => x.id), ['sip-off', 'filevault-off', 'firewall-off']);
  assert.equal(first.more, 1);
  const second = A.selectWarnings(rep(), first.state, { now: NOW + 3600e3 });
  assert.equal(second.warn.length, 0);
  const week = A.selectWarnings(rep(), second.state, { now: NOW + 8 * DAY });
  assert.deepEqual(week.warn.map((x) => x.id).sort(), ['filevault-off', 'sip-off']);
  f.desktop.sip = true; f.desktop.filevault = 'on';
  const fixed = A.selectWarnings(rep(), week.state, { now: NOW + 9 * DAY });
  assert.equal(fixed.warn.length, 0);
  assert.ok(!('sip-off|critical' in fixed.state.alerted));
  f.desktop.sip = false;
  assert.deepEqual(A.selectWarnings(rep(), fixed.state, { now: NOW + 10 * DAY }).warn.map((x) => x.id), ['sip-off']);
  const low = A.selectWarnings(A.runAudit({ ...good(), desktop: { ...good().desktop, stealth: false } }, { now: NOW }), null, { now: NOW });
  assert.equal(low.warn.length, 0);
});

test('listening ports come from netstat, local-only sockets are ignored', () => {
  const net = 'Active Internet connections (including servers)\nProto Recv-Q Send-Q  Local Address          Foreign Address        (state)\ntcp4       0      0  *.22                   *.*                    LISTEN\ntcp6       0      0  *.5900                 *.*                    LISTEN\ntcp4       0      0  127.0.0.1.3000         *.*                    LISTEN\ntcp4       0      0  10.0.0.5.55555         1.2.3.4.443            ESTABLISHED\ntcp46      0      0  *.445                  *.*                    LISTEN';
  assert.deepEqual([...parseListenPorts(net)].sort((a, b) => a - b), [22, 445, 5900]);
  assert.equal(parseListenPorts('').size, 0);
});

test('gathering facts is read-only, tolerates failing commands and never returns a secret value', async () => {
  const calls = [];
  const outputs = { csrutil: 'System Integrity Protection status: enabled.', spctl: 'assessments enabled', fdesetup: 'FileVault is Off.', sysadminctl: 'screenLock delay is 60 seconds', softwareupdate: 'Automatic checking for updates is turned on', netstat: 'tcp4 0 0 *.22 *.* LISTEN', lsof: 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 1 me 3u IPv4 0 0t0 TCP *:8080 (LISTEN)' };
  const exec = async (file, args) => { calls.push(file.split('/').pop() + ' ' + args.join(' ')); const k = file.split('/').pop(); if (k === 'defaults') return { ok: false, text: "Error: Could not find key 'autoLoginUser'" }; if (k === 'socketfilterfw') return { ok: false, text: '' }; return { ok: true, text: outputs[k] || '' }; };
  const store = { file: '/data/Relay/relay.json', data: { settings: { x: { tokenEnc: 'plain:abc' }, note: SECRET }, actions: [{ result: SECRET }], history: [] }, get: (k) => ({ 'settings.homeOnly': true, 'settings.driveRoots': ['/Users/me/Docs'], 'settings.doctor.fix': 'ask' })[k] };
  const stat = (p) => ({ mode: p.endsWith('.json') ? 0o100644 : 0o40700 });
  const facts = await gatherFacts({ exec, stat, store, perms: { status: () => ({ accessibility: true, screen: false, mic: true, camera: false }) }, phoneInfo: async () => ({ enabled: true, running: true, lan: true, port: 47900, devices: [{ id: '1', name: 'iPhone', lastSeen: 5 }], tailscale: { serving: false } }), textsInfo: async () => ({ on: false, paired: false }), plugins: { list: () => [{ name: 'p', manifest: { permissions: { shell: true } } }], sandbox: true }, flagOn: () => false, fullDisk: () => false, safeStorage: { isEncryptionAvailable: () => true }, home: '/Users/me' });
  assert.equal(facts.desktop.sip, true);
  assert.equal(facts.desktop.filevault, 'off');
  assert.equal(facts.desktop.firewall, null);
  assert.equal(facts.desktop.autoLogin, false);
  assert.equal(facts.desktop.remoteLogin, true);
  assert.deepEqual(facts.desktop.screenLock, { enabled: true, delaySec: 60 });
  assert.equal(facts.listeners[0].localOnly, false);
  assert.deepEqual(facts.credentials.plain, ['settings.x.tokenEnc']);
  assert.deepEqual(facts.credentials.tokenShaped, ['settings.note']);
  assert.equal(facts.credentials.historyHits, 1);
  assert.equal(facts.credentials.fileMode, 0o644);
  assert.equal(facts.credentials.dirMode, 0o700);
  assert.equal(facts.phone.running, true);
  assert.deepEqual(facts.files.plugins, [{ name: 'p', permissions: { shell: true } }]);
  assert.ok(!JSON.stringify(facts).includes(SECRET));
  assert.ok(calls.every((c) => !/\b(?:write|enable|disable|--set|-set|delete|kill)\b/i.test(c)), calls.join(' | '));
});

test('when every command fails the desktop is "not checked", and missing services do not crash the gatherer', async () => {
  const facts = await gatherFacts({ exec: async () => ({ ok: false, text: '' }), readFile: () => { throw new Error('no'); }, readdir: () => { throw new Error('no'); } });
  assert.equal(facts.desktop, null);
  assert.equal(facts.listeners, null);
  assert.equal(facts.credentials, null);
  assert.equal(facts.phone, null);
  assert.equal(facts.files, null);
  const r = A.runAudit(facts, { now: NOW });
  assert.equal(r.findings.length, 0);
  assert.ok(r.notChecked.length >= 5);
  assert.equal(facts.indicators, null);
});

test('when macOS hides the listening-socket table, sharing services are "not checked" rather than reported off', async () => {
  const exec = async (file) => { const k = file.split('/').pop(); return k === 'netstat' ? { ok: true, text: 'Active Internet connections' } : { ok: true, text: '' }; };
  const facts = await gatherFacts({ exec });
  assert.equal(facts.desktop.remoteLogin, null);
  assert.equal(facts.desktop.screenSharing, null);
  const r = A.runAudit({ ...good(), desktop: { ...good().desktop, remoteLogin: null, screenSharing: null, fileSharing: null } }, { now: NOW });
  assert.ok(r.notChecked.some((x) => x.id === 'sharing'));
  assert.ok(!r.passed.some((x) => x.id === 'sharing'));
  assert.ok(A.runAudit(good(), { now: NOW }).passed.some((x) => x.id === 'sharing'));
});

test('indicator sources are read independently: one failing does not hide the others', async () => {
  const exec = async (file) => { const k = file.split('/').pop(); if (k === 'dscl') return { ok: true, text: 'GroupMembership: root me stranger' }; if (k === 'profiles') return { ok: false, text: 'profiles: this command requires root privileges' }; if (k === 'scutil') return { ok: true, text: '<dictionary> {\n  HTTPEnable : 1\n}' }; return { ok: false, text: '' }; };
  const dirs = { '/home/me/Library/LaunchAgents': ['com.google.keystone.agent.plist', 'com.apple.thing.plist', 'notes.txt'], '/Library/LaunchAgents': ['us.zoom.updater.plist'], '/Library/LaunchDaemons': new Error('denied') };
  const facts = await gatherFacts({ exec, user: 'me', home: '/home/me', readFile: () => '127.0.0.1 localhost\n10.9.9.9 bank.example', readdir: (d) => { const v = dirs[d]; if (v instanceof Error) throw v; return v; } });
  assert.deepEqual(facts.indicators.admins, ['root', 'me', 'stranger']);
  assert.equal(facts.indicators.profiles, null);
  assert.deepEqual(facts.indicators.proxy, ['HTTP']);
  assert.deepEqual(facts.indicators.hosts, ['bank.example -> 10.9.9.9']);
  assert.deepEqual(facts.indicators.launchItems, ['com.google.keystone.agent', 'us.zoom.updater']);
  const r = A.runAudit({ indicators: facts.indicators }, { now: NOW });
  assert.ok(r.findings.some((x) => x.id === 'extra-admin') && r.findings.some((x) => x.id === 'proxy') && r.notChecked.some((x) => x.id === 'profiles'));
});

test('Relay\'s own phone port is not reported twice as a program listening on the network', () => {
  const f = good(); f.listeners = [{ process: 'Relay', port: 47900, localOnly: false }, { process: 'node', port: 3000, localOnly: false }];
  const r = A.runAudit(f, { now: NOW }), wide = r.findings.find((x) => x.id === 'listeners-wide');
  assert.ok(wide && wide.detail.includes('node:3000') && !wide.detail.includes('Relay:47900'));
  f.listeners = [{ process: 'Relay', port: 47900, localOnly: false }];
  assert.ok(A.runAudit(f, { now: NOW }).passed.some((x) => x.id === 'listeners'));
});
