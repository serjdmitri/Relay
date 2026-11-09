// Overnight wake: a sleeping Mac freezes every program, so Relay's overnight work (your night list, Claude's one small improvement) needs the Mac awake. This is the same idea as Sentient OS's
// "wake helper", in a smaller form that needs no installed root app:
//   * ONE-TIME SETUP, done by you in Terminal (Relay never types your password): a sudoers file that lets your user run exactly four pmset forms without a password:
//       pmset schedule wake <time>, pmset schedule cancel wake <time>, pmset -a disablesleep 0, pmset -a disablesleep 1.
//   * Relay arms a wake for the start of the overnight window (default 1 AM), and re-arms it daily (idempotent; the old one is cancelled first, and no other app's wake is touched: your own 8 AM
//     wake is a separate repeating event and is not changed).
//   * While overnight work runs, Relay holds the Mac awake (disablesleep 1: this also holds a closed lid), and puts it back exactly as it was afterwards (if another app such as Vorssaint had
//     already set it, it is left set).
//   * Safety, because a Mac that never sleeps is the failure to avoid: a watchdog process outside Relay restores sleep if Relay stops heartbeating (crash, force quit) or after a hard ceiling;
//     Relay itself restores on every exit path, and on the next start if it died while holding.
//   * Power rules: plugged in by default; on battery only if you allow it and only above 50%; stops at 20%; a hot Mac (thermal limit) does not start.
// Pure apart from the injected exec / fs / clock, so it is tested without sudo.

const fs = require('fs');
const path = require('path');

const SUDOERS_FILE = '/etc/sudoers.d/relay-wake';
const PMSET = '/usr/bin/pmset';
const SUDO = '/usr/bin/sudo';
const CEILING_SECONDS = 3 * 3600; // an absolute limit on one awake hold
const STALE_SECONDS = 150; // no heartbeat for this long: the watchdog restores sleep
const HEARTBEAT_MS = 30000;
const MIN_BATTERY_START = 50, MIN_BATTERY_KEEP = 20;

const pad = (n) => String(n).padStart(2, '0');
// pmset wants local time as MM/dd/yy HH:mm:ss
const fmt = (d) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${pad(d.getFullYear() % 100)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// The next time the overnight window opens (from:00 local, plus 5 seconds), at least a minute from now.
function nextWake(now, from = 1) {
  const h = Math.min(23, Math.max(0, Number.isInteger(from) ? from : 1));
  const d = new Date(now); d.setHours(h, 0, 5, 0);
  if (d.getTime() < now.getTime() + 60000) d.setDate(d.getDate() + 1);
  return d;
}

// The line a person pastes into Terminal once. Checks the file with visudo before installing it, so a typo cannot break sudo.
function sudoersLine(user) {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(String(user || ''))) return null;
  return `${user} ALL=(root) NOPASSWD: ${PMSET} schedule wake *, ${PMSET} schedule cancel wake *, ${PMSET} -a disablesleep 0, ${PMSET} -a disablesleep 1`;
}
function setupCommand(user) {
  const line = sudoersLine(user); if (!line) return null;
  return `f=$(mktemp) && printf '%s\\n' '${line}' > "$f" && sudo visudo -cf "$f" && sudo install -m 440 -o root -g wheel "$f" ${SUDOERS_FILE} && rm -f "$f" && echo "Relay overnight wake is set up"`;
}
const removeCommand = () => `sudo rm -f ${SUDOERS_FILE} && echo "Relay overnight wake permission removed"`;

// pmset -g batt -> { ac, percent }; pmset -g therm -> hot
function parsePower(batt = '', therm = '') {
  const ac = /Now drawing from 'AC Power'/i.test(batt);
  const m = /(\d{1,3})%/.exec(batt);
  const limit = /CPU_Speed_Limit\s*=\s*(\d+)/i.exec(therm);
  return { ac, percent: m ? Number(m[1]) : null, hot: !!limit && Number(limit[1]) < 50 };
}

// The watchdog: a tiny shell loop run detached (it outlives Relay). It only ever runs the one allowed pmset form, with a value that is 0 or 1.
const WATCHDOG = 'hb="$1"; ceil="$2"; prev="$3"; start=$(date +%s); while :; do sleep 20; [ -f "$hb" ] || exit 0; n=$(date +%s); m=$(stat -f %m "$hb" 2>/dev/null || echo 0); if [ $((n-m)) -gt ' + STALE_SECONDS + ' ] || [ $((n-start)) -gt "$ceil" ]; then if sudo -n ' + PMSET + ' -a disablesleep "$prev"; then rm -f "$hb"; exit 0; fi; fi; done';

class WakeScheduler {
  // exec(cmd, args) -> Promise<{ code, stdout }>. spawnDetached(cmd, args). settings() -> { enabled, battery }. window() -> { from, to }.
  constructor({ exec, spawnDetached = () => {}, store, diag = null, settings = () => ({}), window = () => ({ from: 1, to: 6 }), dir = '', now = () => new Date(), fsImpl = fs, setTimer = setInterval, clearTimer = clearInterval }) {
    Object.assign(this, { exec, spawnDetached, store, diag, settings, window, dir, now, fs: fsImpl, setTimer, clearTimer });
    this.hb = dir ? path.join(dir, 'wake-heartbeat') : '';
    this.holding = false; this.timer = null; this.stop = false;
  }

  log(kind, msg = '') { try { this.diag?.log(kind, msg); } catch { /* the log is a convenience */ } }
  cfg() { const c = this.settings() || {}; return { enabled: !!c.enabled, battery: !!c.battery }; }
  state() { return this.store.get('overnightWake') || {}; }
  save(patch) { this.store.set('overnightWake', { ...this.state(), ...patch }); }

  // Is the one-time permission in place? `sudo -n -l <command>` says whether that exact command is allowed without a password, and changes nothing.
  async ready() {
    try { const r = await this.exec(SUDO, ['-n', '-l', PMSET, 'schedule', 'wake', '01/01/30 00:00:00']); return r.code === 0; } catch { return false; }
  }

  async power() {
    try {
      const b = await this.exec(PMSET, ['-g', 'batt']), t = await this.exec(PMSET, ['-g', 'therm']);
      return parsePower(b.stdout, t.stdout);
    } catch { return { ac: false, percent: null, hot: false }; }
  }

  // Arm (or re-arm) the next wake. Safe to call as often as you like.
  async arm() {
    const c = this.cfg();
    if (!c.enabled) return this.disarm();
    if (!(await this.ready())) { this.log('wake-not-ready', 'overnight wake is on but the one-time permission is missing'); return { armed: false, reason: 'setup' }; }
    const want = fmt(nextWake(this.now(), this.window().from)), cur = this.state().armed;
    if (cur === want) return { armed: true, at: want };
    if (cur) await this.exec(SUDO, ['-n', PMSET, 'schedule', 'cancel', 'wake', cur]).catch(() => null);
    const r = await this.exec(SUDO, ['-n', PMSET, 'schedule', 'wake', want]).catch(() => ({ code: 1 }));
    if (r.code !== 0) { this.save({ armed: '' }); this.log('wake-arm-failed', want); return { armed: false, reason: 'pmset' }; }
    this.save({ armed: want }); this.log('wake-armed', want);
    return { armed: true, at: want };
  }

  async disarm() {
    const cur = this.state().armed;
    if (cur) { await this.exec(SUDO, ['-n', PMSET, 'schedule', 'cancel', 'wake', cur]).catch(() => null); this.save({ armed: '' }); this.log('wake-disarmed', cur); }
    return { armed: false };
  }

  async sleepDisabled() { try { const r = await this.exec(PMSET, ['-g']); return /SleepDisabled\s+1/.test(r.stdout || '') ? 1 : 0; } catch { return 0; } }
  async setSleepDisabled(v) { const r = await this.exec(SUDO, ['-n', PMSET, '-a', 'disablesleep', v ? '1' : '0']).catch(() => ({ code: 1 })); return r.code === 0; }

  // On start: if Relay died while holding the Mac awake, put sleep back as it was before that hold.
  async recover() {
    const s = this.state();
    if (s.holding && !(await this.setSleepDisabled(s.prev ? 1 : 0))) { this.retryRestore(); this.log('wake-recovery-failed', 'Sleep restoration will be retried.'); return false; }
    this.save({ holding: false }); this.clearTimer(this.restoreTimer); this.restoreTimer = null;
    if (s.holding) this.log('wake-recovered', 'Sleep restored after an interrupted hold.');
    try { if (this.hb) this.fs.rmSync(this.hb, { force: true }); } catch { /* none */ }
  }

  // Run fn while the Mac is held awake (when set up and allowed). fn gets { held, shouldStop() } and should stop early when shouldStop() turns true (battery fell too low).
  async withAwake(fn, reason = 'overnight work') {
    const none = { held: false, shouldStop: () => false };
    if (!this.cfg().enabled || !(await this.ready())) return fn(none);
    const p = await this.power();
    const allowed = !p.hot && (p.ac || (this.cfg().battery && p.percent !== null && p.percent >= MIN_BATTERY_START));
    if (!allowed) { this.log('wake-skipped', p.hot ? 'the Mac is running hot' : 'on battery'); return fn(none); }
    const prev = await this.sleepDisabled();
    if (!(await this.setSleepDisabled(true))) return fn(none);
    this.holding = true; this.stop = false;
    this.save({ holding: true, prev, holdingSince: this.now().getTime() });
    try { this.fs.mkdirSync(this.dir, { recursive: true }); this.fs.writeFileSync(this.hb, String(Date.now())); } catch { /* the watchdog then restores at once, which is the safe direction */ }
    this.spawnDetached('/bin/sh', ['-c', WATCHDOG, 'sh', this.hb, String(CEILING_SECONDS), prev ? '1' : '0']);
    this.log('wake-hold', reason);
    this.timer = this.setTimer(async () => {
      try { this.fs.writeFileSync(this.hb, String(Date.now())); } catch { /* retried */ }
      const q = await this.power();
      if ((!q.ac && (q.percent === null || q.percent <= MIN_BATTERY_KEEP)) || q.hot) { if (!this.stop) this.log('wake-stop', q.hot ? 'too hot' : 'battery low'); this.stop = true; }
    }, HEARTBEAT_MS);
    this.timer?.unref?.();
    try { return await fn({ held: true, shouldStop: () => this.stop }); }
    finally { await this.release(); }
  }

  retryRestore() {
    if (this.restoreTimer) return;
    this.restoreTimer = this.setTimer(() => { if (!this.holding) this.recover().catch(() => {}); }, HEARTBEAT_MS);
    this.restoreTimer?.unref?.();
  }

  async release() {
    if (!this.holding) return;
    this.holding = false; this.clearTimer(this.timer); this.timer = null;
    const ok = await this.setSleepDisabled(this.state().prev ? 1 : 0);
    this.save({ holding: !ok });
    if (ok) { try { this.fs.rmSync(this.hb, { force: true }); } catch {} }
    else this.retryRestore(); // keep the heartbeat so the watchdog can also retry
    this.log('wake-release', ok ? 'sleep restored' : 'could not restore sleep: the watchdog will');
  }

  async status() {
    const c = this.cfg(), ready = await this.ready(), s = this.state();
    return { enabled: c.enabled, ready, armed: s.armed || '', battery: c.battery, holding: this.holding };
  }
}

function parseWakeCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
  if (/^(?:set ?up|install) (?:the )?(?:overnight |night |scheduled )?wake(?: up)?(?: permission| helper)?$/.test(n)) return { type: 'wake-setup' };
  if (/^(?:turn on|enable|start|switch on) (?:the )?(?:overnight |night |scheduled )wake(?: up)?$|^wake (?:the|my) mac (?:up )?(?:overnight|at night|for (?:the )?night)$/.test(n)) return { type: 'wake-on' };
  if (/^(?:turn off|disable|stop|switch off) (?:the )?(?:overnight |night |scheduled )wake(?: up)?$|^stop waking (?:the|my) mac(?: up)?(?: overnight| at night)?$/.test(n)) return { type: 'wake-off' };
  if (/^(?:remove|uninstall|undo) (?:the )?(?:overnight |night |scheduled )?wake(?: up)?(?: permission| helper| setup)?$/.test(n)) return { type: 'wake-remove' };
  if (/^(?:overnight |night |scheduled )wake (?:status|check)$|^(?:when|what time) (?:will|do) you wake(?: the mac| up)?(?: tonight)?$|^(?:is|are) (?:the )?(?:overnight )?wake (?:set up|on|working|ready)$/.test(n)) return { type: 'wake-status' };
  return null;
}

module.exports = { WakeScheduler, nextWake, fmt, sudoersLine, setupCommand, removeCommand, parsePower, parseWakeCommand, WATCHDOG, SUDOERS_FILE, CEILING_SECONDS };
