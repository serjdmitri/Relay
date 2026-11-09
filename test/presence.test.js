const test = require('node:test');
const assert = require('node:assert/strict');
const { PresenceTracker, PresenceControl } = require('../src/main/presence');

test('away only after no face for the whole wait, back after faces in a row, and a glance away is nothing', () => {
  const ev = [];
  const p = new PresenceTracker({ awayAfterMs: 60000, backFrames: 2, onAway: () => ev.push('away'), onBack: () => ev.push('back') });
  assert.equal(p.update({ faces: 0, t: 0 }), null, 'nobody seen yet: nothing to leave');
  p.update({ faces: 1, t: 1000 });
  assert.equal(p.state, 'present');
  for (let t = 2000; t < 40000; t += 1000) p.update({ faces: 0, t });
  assert.deepEqual(ev, [], 'under a minute of nobody');
  p.update({ faces: 1, t: 41000 });
  for (let t = 42000; t < 100000; t += 1000) p.update({ faces: 0, t });
  assert.deepEqual(ev, [], 'a face at 41 s restarted the wait');
  assert.equal(p.update({ faces: 0, t: 101000 }), 'away');
  assert.deepEqual(ev, ['away']);
  p.update({ faces: 0, t: 102000 });
  assert.deepEqual(ev, ['away'], 'away is announced once');
  assert.equal(p.update({ faces: 1, t: 103000 }), null, 'one face could be a mistake');
  assert.equal(p.update({ faces: 0, t: 104000 }), null);
  assert.equal(p.update({ faces: 1, t: 105000 }), null);
  assert.equal(p.update({ faces: 1, t: 106000 }), 'back');
  assert.deepEqual(ev, ['away', 'back']);
});

test('the camera is opened only on request, refused politely, told how long to wait, and closed when turned off', async () => {
  const log = [];
  let allowed = false;
  let secs = 30;
  const cam = { close: () => log.push('closed') };
  const c = new PresenceControl({ askAccess: async () => allowed, createCamera: async () => { log.push('camera'); return cam; }, getConfig: () => ({ awayAfter: secs }), onAway: () => log.push('away'), onBack: () => log.push('back'), notify: (m) => log.push(`notify ${m}`), now: (() => { let t = 0; return () => (t += 1000); })() });
  const denied = await c.enable();
  assert.equal(denied.ok, false);
  assert.match(denied.error, /Camera access is off/);
  assert.equal(c.enabled, false);
  allowed = true;
  assert.equal((await c.enable()).ok, true);
  assert.equal(c.enabled, true);
  c.frame({ faces: 1 });
  for (let i = 0; i < 29; i++) c.frame({ faces: 0 });
  assert.ok(!log.includes('away'), 'thirty seconds are not quite thirty');
  c.frame({ faces: 0 });
  assert.ok(log.includes('away'));
  c.frame({ faces: 1 }); c.frame({ faces: 1 });
  assert.ok(log.includes('back'));
  c.setStatus({ state: 'error', message: 'No camera was found.' });
  assert.equal(c.status, 'error');
  assert.ok(log.includes('notify No camera was found.'));
  c.disable();
  assert.ok(log.includes('closed'));
  c.frame({ faces: 0 });
  assert.equal(c.faces, 0, 'frames after it was turned off are ignored');
});

test('turning presence off while permission or camera startup is pending never leaves a camera running', async () => {
  let allow, finishCamera, opened = 0, closed = 0;
  const c = new PresenceControl({
    askAccess: () => new Promise((resolve) => { allow = resolve; }),
    createCamera: () => { opened++; return new Promise((resolve) => { finishCamera = resolve; }); },
    getConfig: () => ({})
  });
  const first = c.enable();
  c.disable();
  allow(true);
  assert.equal((await first).cancelled, true);
  assert.equal(opened, 0);
  const second = c.enable();
  allow(true);
  await new Promise((resolve) => setImmediate(resolve));
  c.disable();
  finishCamera({ close: () => closed++ });
  assert.equal((await second).cancelled, true);
  assert.equal(closed, 1);
  assert.equal(c.enabled, false);
  assert.equal(c.status, 'off');
});

test('a camera startup error is reported instead of leaving presence stuck starting', async () => {
  const c = new PresenceControl({ askAccess: async () => true, createCamera: async () => { throw new Error('failed'); }, getConfig: () => ({}) });
  const result = await c.enable();
  assert.equal(result.ok, false);
  assert.match(result.error, /could not start the camera/);
  assert.equal(c.status, 'error');
  assert.equal(c.enabled, false);
});

test('a camera that fails to start for a passing reason is tried again, and only a refusal or running out of tries leaves it off', () => {
  const { cameraStartPlan: plan } = require('../src/main/presence');
  assert.deepEqual(plan({ ok: true }), { action: 'on' });
  assert.deepEqual(plan({ ok: false, permission: 'granted', tries: 0 }), { action: 'retry', afterMs: 15000 });
  assert.deepEqual(plan({ ok: false, permission: 'granted', tries: 2 }), { action: 'retry', afterMs: 45000 });
  assert.deepEqual(plan({ ok: false, permission: 'granted', tries: 3 }), { action: 'give-up', why: 'tries' });
  assert.deepEqual(plan({ ok: false, permission: 'denied', tries: 0 }), { action: 'give-up', why: 'permission' });
  assert.deepEqual(plan({ ok: false, permission: 'restricted', tries: 1 }), { action: 'give-up', why: 'permission' });
});

test('with owner recognition on and your face enrolled, launching starts the camera even if Presence was left off, and a failed start no longer switches Presence off at once', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/main/main.js'), 'utf8');
  assert.match(src, /if \(store\.get\('settings\.presence\.enabled'\) \|\| \(ownerConfig\(store\.get\('settings\.owner'\)\)\.enabled && ownerState\.templates\.length > 0\)\) startCamera\(\);/);
  assert.doesNotMatch(src, /presence\.enable\(\)\.then\(\(r\) => \{ if \(!r\.ok\) store\.set\('settings\.presence\.enabled', false\); broadcast\(\); \}\)/, 'the old line that turned Presence off on any failed start is gone');
});

test('a camera that dies when the Mac sleeps is started again: the page restarts itself when the stream ends or freezes (with a limit), and the app restarts it on wake', () => {
  const fs = require('node:fs'), path = require('node:path');
  const page = fs.readFileSync(path.join(__dirname, '../src/renderer/presence.js'), 'utf8'), main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  assert.match(page, /track\?\.addEventListener\('ended', restart\)/, 'a stream that ends is restarted');
  assert.match(page, /Date\.now\(\) - lastMove > 12000\) restart\(\)/, 'a picture that has not moved for 12 seconds is restarted');
  assert.match(page, /log\.length >= 4/, 'four restarts in two minutes and it gives up and says so, so a dead camera cannot loop');
  assert.match(page, /status\('error', \{ message: 'The camera keeps stopping/);
  assert.match(page, /status\('running'\);\n    watchStream\(\);/, 'the watch starts once the camera is running');
  assert.match(main, /powerMonitor\.on\('resume', \(\) => reviveSoon\('after wake'\)\)/, 'on wake the camera is restarted, with retries until it delivers pictures');
});
