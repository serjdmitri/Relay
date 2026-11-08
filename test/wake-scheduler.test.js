const test = require('node:test'), assert = require('node:assert/strict');
const { WakeScheduler, nextWake, fmt, sudoersLine, setupCommand, removeCommand, parsePower, parseWakeCommand, WATCHDOG } = require('../src/main/wakeScheduler');

const memStore = (init = {}) => { const d = { ...init }; return { get: (k) => d[k], set: (k, v) => { d[k] = v; }, d }; };
// A fake Mac: records every command, answers pmset/sudo the way the real ones do.
function fakeMac({ allowed = true, ac = true, percent = 80, hot = false, sleepDisabled = 0 } = {}) {
  const calls = []; let sd = sleepDisabled;
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === '/usr/bin/sudo' && args[0] === '-n' && args[1] === '-l') return { code: allowed ? 0 : 1, stdout: '' };
    if (cmd === '/usr/bin/sudo' && args.includes('disablesleep')) { if (!allowed) return { code: 1, stdout: '' }; sd = Number(args[args.length - 1]); return { code: 0, stdout: '' }; }
    if (cmd === '/usr/bin/sudo') return { code: allowed ? 0 : 1, stdout: '' };
    if (args[0] === '-g' && args[1] === 'batt') return { code: 0, stdout: `Now drawing from '${ac ? 'AC Power' : 'Battery Power'}'\n -InternalBattery-0\t${percent}%; discharging` };
    if (args[0] === '-g' && args[1] === 'therm') return { code: 0, stdout: hot ? 'CPU_Speed_Limit = 40' : 'CPU_Speed_Limit = 100' };
    if (args[0] === '-g' && args.length === 1) return { code: 0, stdout: ` SleepDisabled\t\t${sd}\n` };
    return { code: 0, stdout: '' };
  };
  return { exec, calls, get sleepDisabled() { return sd; } };
}
const fsMem = () => { const f = new Map(); return { f, mkdirSync() {}, writeFileSync: (p, v) => f.set(p, v), rmSync: (p) => f.delete(p) }; };
const make = (mac, over = {}) => { const store = memStore(), fsImpl = fsMem(), spawned = []; const w = new WakeScheduler({ exec: mac.exec, spawnDetached: (...a) => spawned.push(a), store, settings: () => ({ enabled: true, battery: false, ...over.settings }), window: () => ({ from: 1, to: 6 }), dir: '/tmp/r', now: () => over.now || new Date(2026, 10, 7, 22, 0, 0), fsImpl, setTimer: () => ({ unref() {} }), clearTimer() {} }); return { w, store, fsImpl, spawned }; };

test('the next wake is the start of the window, never less than a minute away', () => {
  assert.equal(fmt(nextWake(new Date(2026, 10, 7, 22, 0, 0), 1)), '11/08/26 01:00:05');
  assert.equal(fmt(nextWake(new Date(2026, 10, 8, 0, 30, 0), 1)), '11/08/26 01:00:05', 'tonight, if it is still ahead');
  assert.equal(fmt(nextWake(new Date(2026, 10, 8, 1, 0, 0), 1)), '11/09/26 01:00:05', 'too close or past: tomorrow');
  assert.equal(fmt(nextWake(new Date(2026, 10, 7, 22, 0, 0), 3)), '11/08/26 03:00:05');
});

test('the one-time setup line allows exactly four pmset forms, is checked by visudo, and refuses odd user names', () => {
  const line = sudoersLine('sergeydmitriev');
  assert.match(line, /^sergeydmitriev ALL=\(root\) NOPASSWD: \/usr\/bin\/pmset schedule wake \*, \/usr\/bin\/pmset schedule cancel wake \*, \/usr\/bin\/pmset -a disablesleep 0, \/usr\/bin\/pmset -a disablesleep 1$/);
  const cmd = setupCommand('sergeydmitriev');
  assert.ok(cmd.includes('sudo visudo -cf') && cmd.indexOf('visudo') < cmd.indexOf('sudo install'), 'checked before it is installed');
  assert.ok(cmd.includes('/etc/sudoers.d/relay-wake'));
  assert.equal(setupCommand('bad; rm -rf /'), null); assert.equal(setupCommand(''), null);
  assert.match(removeCommand(), /sudo rm -f \/etc\/sudoers\.d\/relay-wake/);
});

test('power and heat are read from pmset', () => {
  assert.deepEqual(parsePower("Now drawing from 'AC Power'\n 57%; charging", 'CPU_Speed_Limit = 100'), { ac: true, percent: 57, hot: false });
  assert.deepEqual(parsePower("Now drawing from 'Battery Power'\n 41%; discharging", 'CPU_Speed_Limit = 30'), { ac: false, percent: 41, hot: true });
});

test('arming schedules one wake, is idempotent, and replaces the old one without touching others', async () => {
  const mac = fakeMac(), { w, store } = make(mac);
  assert.deepEqual(await w.arm(), { armed: true, at: '11/08/26 01:00:05' });
  assert.equal(store.get('overnightWake').armed, '11/08/26 01:00:05');
  await w.arm();
  assert.equal(mac.calls.filter((c) => /schedule wake 11\/08\/26/.test(c) && !/ -l /.test(c)).length, 1, 'armed once');
  store.set('overnightWake', { armed: '11/07/26 01:00:05' }); await w.arm();
  assert.ok(mac.calls.some((c) => c === '/usr/bin/sudo -n /usr/bin/pmset schedule cancel wake 11/07/26 01:00:05'), 'only its own old wake is cancelled');
  assert.ok(!mac.calls.some((c) => /repeat|cancelall/i.test(c)), 'never clears repeating or other wakes');
});

test('without the one-time permission nothing is armed and work still runs, unheld', async () => {
  const mac = fakeMac({ allowed: false }), { w } = make(mac);
  assert.deepEqual(await w.arm(), { armed: false, reason: 'setup' });
  let seen; await w.withAwake(async (s) => { seen = s.held; });
  assert.equal(seen, false); assert.equal(mac.sleepDisabled, 0);
});

test('turning it off cancels the armed wake', async () => {
  const mac = fakeMac(), made = make(mac, { settings: { enabled: false } });
  made.store.set('overnightWake', { armed: '11/08/26 01:00:05' });
  await made.w.arm();
  assert.ok(mac.calls.some((c) => /schedule cancel wake 11\/08\/26 01:00:05/.test(c)));
  assert.equal(made.store.get('overnightWake').armed, '');
});

test('the Mac is held awake while the work runs, then put back exactly as it was', async () => {
  const mac = fakeMac({ sleepDisabled: 0 }), { w, spawned, fsImpl, store } = make(mac);
  let during; await w.withAwake(async (s) => { during = [s.held, mac.sleepDisabled, fsImpl.f.size, store.get('overnightWake').holding]; });
  assert.deepEqual(during, [true, 1, 1, true], 'held, sleep off, heartbeat file present, state saved');
  assert.equal(mac.sleepDisabled, 0, 'restored'); assert.equal(fsImpl.f.size, 0, 'heartbeat removed'); assert.equal(store.get('overnightWake').holding, false);
  assert.equal(spawned.length, 1); assert.equal(spawned[0][1][1], WATCHDOG);
});

test('if another app (Vorssaint) already had sleep off, it stays off afterwards', async () => {
  const mac = fakeMac({ sleepDisabled: 1 }), { w } = make(mac);
  await w.withAwake(async () => {}); assert.equal(mac.sleepDisabled, 1);
});

test('sleep is restored even when the work throws', async () => {
  const mac = fakeMac(), { w } = make(mac);
  await assert.rejects(w.withAwake(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(mac.sleepDisabled, 0);
});

test('on battery it is not held unless allowed and above 50%; a hot Mac is never held', async () => {
  let held;
  let m = fakeMac({ ac: false, percent: 80 }), a = make(m); await a.w.withAwake(async (s) => { held = s.held; }); assert.equal(held, false, 'battery not allowed');
  m = fakeMac({ ac: false, percent: 80 }); a = make(m, { settings: { battery: true } }); await a.w.withAwake(async (s) => { held = s.held; }); assert.equal(held, true, 'battery allowed and high');
  m = fakeMac({ ac: false, percent: 40 }); a = make(m, { settings: { battery: true } }); await a.w.withAwake(async (s) => { held = s.held; }); assert.equal(held, false, 'battery too low to start');
  m = fakeMac({ ac: true, hot: true }); a = make(m); await a.w.withAwake(async (s) => { held = s.held; }); assert.equal(held, false, 'too hot');
});

test('a Relay that died while holding puts sleep back on the next start', async () => {
  const mac = fakeMac({ sleepDisabled: 1 }), { w, store } = make(mac);
  store.set('overnightWake', { holding: true, prev: 0 });
  await w.recover();
  assert.equal(mac.sleepDisabled, 0); assert.equal(store.get('overnightWake').holding, false);
});

test('the watchdog restores sleep on a stale heartbeat or at the ceiling, only ever with the one allowed form', () => {
  assert.match(WATCHDOG, /\[ -f "\$hb" \] \|\| exit 0/, 'a normally finished hold ends the watchdog');
  assert.match(WATCHDOG, /-gt 150/); assert.match(WATCHDOG, /-gt "\$ceil"/);
  assert.match(WATCHDOG, /sudo -n \/usr\/bin\/pmset -a disablesleep "\$prev"/);
  assert.equal((WATCHDOG.match(/sudo/g) || []).length, 1);
});

test('voice commands', () => {
  const p = parseWakeCommand;
  assert.deepEqual(p('set up the overnight wake'), { type: 'wake-setup' });
  assert.deepEqual(p('Jarvis, set up overnight wake.'), { type: 'wake-setup' });
  assert.deepEqual(p('turn on the overnight wake'), { type: 'wake-on' });
  assert.deepEqual(p('wake my mac overnight'), { type: 'wake-on' });
  assert.deepEqual(p('turn off overnight wake'), { type: 'wake-off' });
  assert.deepEqual(p('remove the wake permission'), { type: 'wake-remove' });
  assert.deepEqual(p('when will you wake the mac tonight'), { type: 'wake-status' });
  assert.equal(p('wake me up at seven'), null); assert.equal(p('turn on the lights'), null);
});

test('main.js holds the Mac awake around overnight work, restores sleep on quit, and askController routes the voice commands', () => {
  const fs = require('fs'), read = (f) => fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
  const main = read('src/main/main.js'), ask = read('src/main/askController.js'), store = read('src/main/store.js');
  assert.match(main, /wake\.withAwake\(\(\) => runOvernightTask\(st\.run\)/, 'the night list runs held awake');
  assert.match(main, /wake\.withAwake\(\(\) => nightlyMaintenance\.run\(key\)/, 'overnight improvement runs held awake');
  assert.match(main, /app\.on\('before-quit'[\s\S]*disablesleep/, 'quitting mid-hold restores sleep');
  assert.match(main, /wake\.recover\(\)\.then\(\(\) => wake\.arm\(\)\)/, 'a Relay that died mid-hold recovers, then arms');
  assert.match(main, /ask\.wakeCommand = async/); assert.match(main, /clipboard\.writeText\(cmd\)/, 'setup is a command you paste: Relay never types your password');
  assert.match(ask, /parseWakeCommand\(effective\)/);
  assert.match(store, /overnightWake: \{ enabled: false, battery: false \}/, 'off until you turn it on');
});
