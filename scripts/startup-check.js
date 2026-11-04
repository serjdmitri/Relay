#!/usr/bin/env node
// Startup check: launches a built Relay.app the way a user would, and proves it actually STARTS: no startup errors, the main window's page has content,
// and the bridge to the app is there. 0.38.0 and 0.38.1 shipped with a window that stayed blank because startup threw "fs is not defined"; no test noticed.
//   node scripts/startup-check.js dist/mac-arm64/Relay.app          (exit 0 = fine, 1 = a problem, with the reason printed)
// It uses a throwaway profile (so your real data is untouched and your running Relay is not disturbed), signs a COPY with your local "Relay Local Signing"
// certificate when you have one (so the Keychain trusts it, as it will after you install it), and if the app never answers it says that a Keychain prompt is
// probably waiting. The judging lives in small pure functions at the top so it can be tested.

// ---- judging (pure) ----
const BENIGN = [/deprecated and will be removed/i, /\bINFO:/, /DevTools listening/, /Terminating current process after \d+ seconds with no connection/i, /fontconfig|ALSA|dbus/i, /Network service crashed or was terminated, restarting/i, /\bWARNING:/, /autofill|Autofill/,
  // the check runs beside your real Relay, which already owns the Firefox bridge's port; that error and the one it causes in the window are expected here
  /Firefox bridge: listen EADDRINUSE/, /firefox:action.*could not be cloned/i];
const BAD = /\b(ReferenceError|TypeError|SyntaxError|RangeError|URIError|EvalError|UnhandledPromiseRejection|Cannot find module|is not defined|is not a function|is not a constructor|Cannot read propert(?:y|ies) of|FATAL|Check failed|Segmentation fault|EACCES|ENOENT.*(?:asar|\.js))\b/;

// The lines of a log that are real startup errors.
function classifyLog(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors = lines.filter((l) => BAD.test(l) && !BENIGN.some((b) => b.test(l)));
  return { errors: [...new Set(errors)].slice(0, 12), lines: lines.length };
}

// What the probe saw -> { ok, problems, warnings }.
function verdict({ answered, blockedBy = null, hasPage = true, pageTextLength = 0, apiKeys = 0, logErrors = [], pageErrors = [], designatedDiffers = false, exitedEarly = null } = {}) {
  const problems = [], warnings = [];
  if (exitedEarly !== null) problems.push(`the app quit on its own during startup (${exitedEarly})`);
  else if (!answered) problems.push(blockedBy ? `the app never answered, and a macOS ${blockedBy} prompt is open: the main thread is waiting for you to click Always Allow` : 'the app never answered, so it did not finish starting');
  else if (!hasPage) problems.push('the app is running but created no window page (no main or welcome window)');
  else {
    if (!(pageTextLength > 0)) problems.push('the main window opened but its page is empty (blank window)');
    if (apiKeys < 50) problems.push(`the window has no connection to the app (only ${apiKeys} bridge functions; expected 150 or more)`);
  }
  for (const e of logErrors) problems.push(`startup error: ${e.slice(0, 220)}`);
  for (const e of pageErrors) problems.push(`error in the window: ${e.slice(0, 220)}`);
  if (designatedDiffers) warnings.push('this build is signed differently from the installed Relay, so macOS will ask for Keychain access once (click Always Allow)');
  return { ok: problems.length === 0, problems, warnings };
}

// Is the Mac's screen locked? Relay's startup reads the Keychain, which cannot be read while the screen is locked, so a check run then would hang and look like a broken build.
// ioregXml: the output of `ioreg -n Root -d1 -a`.
function screenLocked(ioregXml) { return /<key>CGSSessionScreenIsLocked<\/key>\s*<true\s*\/>/.test(String(ioregXml || '')); }

module.exports = { classifyLog, verdict, screenLocked, BENIGN, BAD };

if (require.main === module) main();

// ---- the probe (only when run from the command line) ----
function main() {
  const { spawn, execFileSync } = require('child_process');
  const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), net = require('net');

  const argv = process.argv.slice(2);
  const app = argv.find((a) => !a.startsWith('--'));
  const flag = (n) => argv.includes(`--${n}`);
  if (!app || !fs.existsSync(app)) { console.error('Usage: node scripts/startup-check.js path/to/Relay.app [--no-sign] [--keep-open]'); process.exit(2); }

  const WINDOW = /\/(?:index|onboarding)\.html/; // a new profile opens the welcome window; your real one opens the main window
  const IDENT = 'Relay Local Signing';
  const sh = (cmd, args, o = {}) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], ...o }); } catch (e) { return `${e.stdout || ''}${e.stderr || ''}`; } };
  const hasIdentity = () => sh('security', ['find-identity', '-p', 'codesigning']).includes(`"${IDENT}"`);
  const dr = (p) => (sh('codesign', ['-dr', '-', p]).match(/designated => (.+)/) || [])[1] || '';
  const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const getJson = (port) => new Promise((res) => { const r = http.get({ host: '127.0.0.1', port, path: '/json', timeout: 1500 }, (m) => { let d = ''; m.on('data', (c) => (d += c)); m.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }); r.on('error', () => res(null)); r.on('timeout', () => { r.destroy(); res(null); }); });

  const cdp = (wsUrl) => {
    const WebSocket = require('ws');
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map(); const events = [];
      ws.on('message', (m) => { const j = JSON.parse(m); if (j.id && pending.has(j.id)) { pending.get(j.id)(j.result); pending.delete(j.id); } else if (j.method) events.push(j); });
      ws.on('error', reject);
      ws.on('open', () => resolve({ events, close: () => ws.close(), send: (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res(null); } }, 8000); }) }));
    });
  };
  const measure = async (c) => { const r = await c.send('Runtime.evaluate', { expression: 'JSON.stringify({t: document.body ? document.body.innerText.trim().length : 0, k: window.relay ? Object.keys(window.relay).length : 0})', returnByValue: true }); return r && r.result && r.result.value ? JSON.parse(r.result.value) : { t: 0, k: 0 }; };

  (async () => {
    // never judge a build on a locked Mac: wait for it to be unlocked (--wait-unlock=SECONDS), else say so and stop (exit 3) rather than call the build broken
    const isLocked = () => screenLocked(sh('ioreg', ['-n', 'Root', '-d1', '-a']));
    const waitSec = Number((argv.find((a) => a.startsWith('--wait-unlock=')) || '').split('=')[1]) || 0;
    if (isLocked()) {
      console.log(`The Mac is locked, so Relay cannot read the Keychain and the check would hang. ${waitSec ? `Waiting up to ${Math.round(waitSec / 60)} minutes for it to be unlocked…` : 'Unlock it and run the check again.'}`);
      const began = Date.now(); while (isLocked() && Date.now() - began < waitSec * 1000) await sleep(5000);
      if (isLocked()) { console.log('Still locked: the build was not judged. Unlock the Mac and run the check again.'); process.exit(3); }
      await sleep(4000); // let the desktop settle after the unlock
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-startup-'));
    let target = app, designatedDiffers = false;
    if (!flag('no-sign') && hasIdentity()) {
      const copy = path.join(tmp, 'Relay.app');
      sh('ditto', [app, copy]);
      const r = sh('codesign', ['--force', '--deep', '--sign', IDENT, copy]);
      if (/error/i.test(r)) console.log('note: could not sign the test copy:', r.split('\n')[0]); else target = copy;
      const installed = '/Applications/Relay.app';
      if (fs.existsSync(installed) && dr(installed) && dr(target) && dr(installed) !== dr(target)) designatedDiffers = true;
    } else console.log('note: no "Relay Local Signing" certificate, so the Keychain may ask about this build (run scripts/setup-signing.sh once)');
    const exe = path.join(target, 'Contents/MacOS/Relay');
    const port = await freePort();
    let out = '', exitedEarly = null, done = false;
    const tSpawn = Date.now();
    const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(tmp, 'profile')}`], { env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code, sig) => { if (!done) exitedEarly = `exit ${code ?? sig}`; });

    let pages = null; const t0 = Date.now();
    while (Date.now() - t0 < 30000 && exitedEarly === null) { pages = await getJson(port); if (pages && pages.some((p) => WINDOW.test(p.url))) break; await sleep(700); }
    const answered = !!pages, windowMs = pages && pages.some((p) => WINDOW.test(p.url)) ? Date.now() - tSpawn : null; // from launching the app to its window page existing
    // macOS leaves SecurityAgent running for a while after any prompt, so its presence alone proves nothing: say a prompt is open only if it was started during this run
    const agentAge = Number((sh('ps', ['-o', 'etime=', '-p', (sh('pgrep', ['SecurityAgent']).split('\n')[0] || '0').trim() || '0']).trim().split(':').reverse().reduce((t, v, i) => t + Number(v) * [1, 60, 3600][i], 0)));
    const blockedBy = !answered && Number.isFinite(agentAge) && agentAge > 0 && agentAge < (Date.now() - t0) / 1000 + 5 ? 'Keychain' : null;
    let pageTextLength = 0, apiKeys = 0; const pageErrors = [];
    const main = pages && pages.find((p) => WINDOW.test(p.url));
    if (main) {
      const c = await cdp(main.webSocketDebuggerUrl);
      await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable');
      await sleep(2500); // let the first paint and the first state arrive
      let v = await measure(c);
      if (!(v.t > 0)) { await sleep(4000); v = await measure(c); }
      pageTextLength = v.t; apiKeys = v.k;
      await sleep(1500);
      for (const e of c.events) {
        if (e.method === 'Runtime.exceptionThrown') pageErrors.push(String((e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description) || e.params.exceptionDetails.text).split('\n')[0]);
        if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && !/favicon/i.test(e.params.entry.text)) pageErrors.push(`${e.params.entry.text} ${e.params.entry.url || ''}`.trim());
      }
      c.close();
    }
    await sleep(1500);
    done = true;
    if (!flag('keep-open')) { try { child.kill('SIGTERM'); } catch { /* gone */ } await sleep(1500); try { child.kill('SIGKILL'); } catch { /* gone */ } }
    const v = verdict({ answered, blockedBy, hasPage: !!main, pageTextLength, apiKeys, logErrors: classifyLog(out).errors, pageErrors: [...new Set(pageErrors)].slice(0, 6), designatedDiffers, exitedEarly });
    console.log(`Startup check of ${path.basename(app)} (${((Date.now() - t0) / 1000).toFixed(1)}s): ${v.ok ? 'OK' : 'FAILED'}`);
    if (windowMs !== null) console.log(`  the window page appeared ${(windowMs / 1000).toFixed(1)}s after launch`);
    if (v.ok) console.log(`  the ${/onboarding/.test(main.url) ? 'welcome' : 'main'} window has content (${pageTextLength} characters) and ${apiKeys} bridge functions; no startup errors`);
    for (const p of v.problems) console.log(`  ✗ ${p}`);
    for (const w of v.warnings) console.log(`  ! ${w}`);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp folder */ }
    process.exit(v.ok ? 0 : 1);
  })().catch((e) => { console.error('startup check could not run:', e.message); process.exit(1); });
}
