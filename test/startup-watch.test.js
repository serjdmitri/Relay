const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, spawnSync } = require('child_process');
const sw = require('../src/main/startupWatch');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs the real watchdog script against a stand-in "Relay" (a sleeping process), with a fake `open` and `pgrep` first on the PATH.
async function rig({ ready = false, state = '', prompt = false, victimSeconds = 300, seconds = 2 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-sw-')), bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'open'), `#!/bin/sh\necho "$1" >> "${dir}/opened"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'pgrep'), `#!/bin/sh\n${prompt ? 'exit 0' : 'exit 1'}\n`, { mode: 0o755 });
  const f = sw.files(dir); fs.writeFileSync(f.script, sw.SCRIPT, { mode: 0o700 });
  if (ready) fs.writeFileSync(f.ready, '1');
  if (state) fs.writeFileSync(f.state, state);
  const victim = spawn('sleep', [String(victimSeconds)], { stdio: 'ignore' });
  const script = spawn('/bin/sh', [f.script, String(victim.pid), f.ready, f.state, '/Applications/Relay.app', String(seconds)], { stdio: 'ignore', env: { PATH: `${bin}:/usr/bin:/bin`, RELAY_WATCH_TICK: '1' } });
  const done = new Promise((r) => script.on('exit', r));
  return { dir, f, victim, done, opened: () => (fs.existsSync(path.join(dir, 'opened')) ? fs.readFileSync(path.join(dir, 'opened'), 'utf8').trim().split('\n') : []), cleanup: () => { try { victim.kill('SIGKILL'); } catch { /* gone */ } try { script.kill('SIGKILL'); } catch { /* gone */ } } };
}

test('a start that never finishes is force-quit and Relay is opened again, once, and the restart is remembered', async () => {
  const r = await rig({ seconds: 2 }); const code = await r.done;
  assert.equal(code, 0); await sleep(150);
  assert.equal(alive(r.victim.pid), false, 'the stuck copy was killed'); assert.deepEqual(r.opened(), ['/Applications/Relay.app'], 'and Relay was opened again');
  assert.match(fs.readFileSync(r.f.state, 'utf8').trim(), /^\d{10}$/, 'one restart recorded, as unix seconds');
  r.cleanup();
});

test('a start that finishes, or an app that is quit, is never touched', async () => {
  const fin = await rig({ ready: true }); await fin.done;
  assert.equal(alive(fin.victim.pid), true, 'finished starting: left alone'); assert.deepEqual(fin.opened(), []); fin.cleanup();
  const quit = await rig({ victimSeconds: 1, seconds: 30 }); await quit.done;
  assert.deepEqual(quit.opened(), [], 'the app quit by itself: nothing to restart'); quit.cleanup();
});

test('never more than two forced restarts in fifteen minutes (no restart loop), but old ones do not count', async () => {
  const now = Math.floor(Date.now() / 1000);
  const loop = await rig({ state: `${now - 100}\n${now - 50}\n`, seconds: 2 }); await loop.done; await sleep(150);
  assert.equal(alive(loop.victim.pid), true, 'it gave up instead of looping'); assert.deepEqual(loop.opened(), []); loop.cleanup();
  const old = await rig({ state: `${now - 5000}\n${now - 4000}\n`, seconds: 2 }); await old.done; await sleep(150);
  assert.equal(alive(old.victim.pid), false, 'restarts from long ago are forgotten'); assert.equal(old.opened().length, 1); old.cleanup();
});

test('while a macOS security prompt is open it waits for you instead of killing the app under it', async () => {
  const r = await rig({ prompt: true, seconds: 2 });
  await sleep(5500);
  assert.equal(alive(r.victim.pid), true, 'still waiting, well past the limit'); assert.deepEqual(r.opened(), []);
  r.cleanup(); await r.done;
});

test('starting it writes the script and spawns it detached for this process; it does nothing outside a packaged app and can never throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-sw2-')), calls = []; let unref = false;
  const out = sw.begin({ dir, exe: '/Applications/Relay.app/Contents/MacOS/Relay', pid: 4242, spawnFn: (cmd, args, opts) => { calls.push([cmd, args, opts]); return { unref() { unref = true; } }; } });
  assert.equal(out.ok, true); assert.equal(calls[0][0], '/bin/sh');
  assert.deepEqual(calls[0][1].slice(1), ['4242', path.join(dir, 'startup-ready'), path.join(dir, 'startup-watch-state'), '/Applications/Relay.app', '40']);
  assert.equal(calls[0][2].detached, true); assert.equal(unref, true); assert.equal(fs.existsSync(path.join(dir, 'startup-watch.sh')), true);
  fs.writeFileSync(path.join(dir, 'startup-ready'), 'stale'); sw.begin({ dir, exe: '/Applications/Relay.app/Contents/MacOS/Relay', spawnFn: () => ({ unref() {} }) });
  assert.equal(fs.existsSync(path.join(dir, 'startup-ready')), false, 'a leftover "ready" from the last start is cleared');
  assert.equal(sw.begin({ dir, exe: '/x/electron', packaged: false }).ok, false); assert.equal(sw.begin({ dir, exe: '/usr/bin/node' }).ok, false);
  assert.doesNotThrow(() => sw.begin({ dir: '/nonexistent/readonly/dir', exe: '/Applications/Relay.app/Contents/MacOS/Relay', spawnFn: () => { throw new Error('boom'); } }));
  assert.equal(sw.bundleOf('/Applications/Relay.app/Contents/MacOS/Relay'), '/Applications/Relay.app');
});

test('finishing a start leaves the ready file and forgets earlier restarts; main.js starts the watch first and marks ready last', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-sw3-')); fs.writeFileSync(path.join(dir, 'startup-watch-state'), '1\n');
  assert.equal(sw.ready({ dir }), true); assert.match(fs.readFileSync(path.join(dir, 'startup-ready'), 'utf8'), /^\d+$/);
  assert.equal(fs.existsSync(path.join(dir, 'startup-watch-state')), false); assert.equal(sw.ready({ dir: '/nonexistent/readonly/dir' }), false);
  const main = read('src/main/main.js'), a = main.indexOf("require('./startupWatch').begin("), b = main.indexOf("require('./startupWatch').ready(");
  assert.ok(a > 0 && b > a, 'begin comes before ready');
  assert.ok(main.indexOf('app.whenReady().then(() => {') < a && a < main.indexOf("const stopShortcut = 'Control+Alt+Escape'"), 'begin is the first thing in the ready handler');
  assert.ok(b > main.indexOf('startHotkeysWhenTrusted()'), 'ready is marked only after the key listener has been started');
  assert.equal(spawnSync('/bin/sh', ['-n'], { input: sw.SCRIPT }).status, 0, 'the script is valid sh');
});
