// A single guarded system drag for ordinary Mac window title bars and browser tabs.
// The native helper checks Accessibility and hit-tests the title/tab region before pressing.
const { spawn } = require('child_process');
// The web browsers a "tab N" key press is allowed in (their bundle identifiers).
const BROWSER_IDS = new Set(['org.mozilla.firefox', 'org.mozilla.firefoxdeveloperedition', 'org.mozilla.nightly', 'com.apple.Safari', 'com.apple.SafariTechnologyPreview', 'com.google.Chrome', 'com.google.Chrome.canary', 'company.thebrowser.Browser', 'com.brave.Browser', 'com.microsoft.edgemac', 'org.chromium.Chromium', 'com.vivaldi.Vivaldi', 'com.operasoftware.Opera']);
const validPoint = pt => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y);
class ExternalDrag {
  // front(): the bundle id of the app in front (fast, needs no permission); pressTab(n): another way to press Command+N when the helper is not running; log(kind, message)
  constructor({ bin, allowed, enabled = () => true, wanted = () => false, notify = () => {}, spawnFn = spawn, watchdogMs = 1000, front = null, pressTab = null, log = () => {} }) {
    Object.assign(this, { bin, allowed, enabled, wanted, notify, spawnFn, front, pressTab, log });
    this.frontWaiters = [];
    this.child = null; this.ready = false; this.owner = null; this.point = null; this.buf = ''; this.warned = false; this.watchdogMs = watchdogMs; this.watchdog = null;
  }
  start() {
    if (this.child || !(this.enabled() || this.wanted())) return; // the helper also does pinch clicks and browser tab numbers, so it can be wanted with dragging off
    if (!this.allowed()) { if (!this.warned) this.notify('Allow Accessibility for Relay to move app windows and tabs.'); this.warned = true; return; }
    try {
      const c = this.spawnFn(this.bin, ['hand-drag'], { stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = c; this.ready = false; this.buf = '';
      c.stdout.on('data', data => {
        if (this.child !== c) return;
        this.buf += String(data); let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
          if(line==='down'&&this.owner){this.accepted=true;if(this.point&&(this.point.x!==this.startPoint?.x||this.point.y!==this.startPoint?.y))this.send('move',this.point);}
          if(line==='not-draggable'){clearTimeout(this.watchdog);this.owner=null;this.point=null;this.accepted=false;}
          if (line === 'ready') { this.ready = true; this.warned = false; this.log('hand-helper', 'ready'); }
          if (line.startsWith('tab:') || line.startsWith('click')) this.log('hand-helper', line);
          if (line === 'front:browser' || line === 'front:other') this.frontWaiters.shift()?.(line === 'front:browser');
          // A fist away from a title bar is normal, not an error. The helper
          // declines the drag without pressing the mouse; keep that silent.
        }
      });
      c.stderr.on('data', () => {}); c.stdin.on('error', () => {});
      const failed = () => { if (this.child === c) { clearTimeout(this.watchdog); this.watchdog = null; this.child = null; this.ready = false; this.owner = null; if (!this.warned) this.notify('App dragging is unavailable. Allow Relay and its hand-drag helper in Accessibility settings, then try again.'); this.warned = true; } };
      c.on('error', failed); c.on('exit', failed);
    } catch { if (!this.warned) this.notify('Could not start app dragging.'); this.warned = true; }
  }
  send(op, pt) { if (this.child && this.ready && pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) this.child.stdin.write(JSON.stringify({ op, x: pt.x, y: pt.y }) + '\n'); }
  // One ordinary click at a point (a pinch tap). False when the helper is not running yet (it is started for next time).
  click(pt) { if (!validPoint(pt) || this.owner) return false; if (!this.ready) { this.start(); return false; } this.send('click', pt); return true; }
  // Air scroll: scroll what is under the hand by dy pixels (dy > 0 moves the content down). False if the helper is not running yet.
  scroll(pt, dy) { if (!validPoint(pt) || !Number.isFinite(dy) || this.owner) return false; if (!this.ready) { this.start(); return false; } this.child.stdin.write(JSON.stringify({ op: 'scroll', x: pt.x, y: pt.y, dy: Math.round(dy) }) + '\n'); return true; }
  // "Go to tab N" in the browser in front (Command+N). Needs a browser in front; uses the helper, or (if the helper is not running) a key press through System Events.
  // Every step is written to the diagnostics log, because "it did nothing" is otherwise impossible to explain. -> true when a key press was sent.
  async tab(n) {
    if (!Number.isInteger(n) || n < 1 || n > 9) return false;
    let front = null;
    try { front = this.front ? await this.front() : null; } catch { /* unknown */ }
    if (this.front && !BROWSER_IDS.has(front)) { this.log('hand-tab', `number ${n}: no browser in front (${front || 'unknown'})`); return false; }
    if (this.ready && this.child) { this.child.stdin.write(JSON.stringify({ op: 'tab', n }) + '\n'); this.log('hand-tab', `number ${n}: sent by the helper`); return true; }
    this.start();
    if (this.pressTab) {
      try { await this.pressTab(n); this.log('hand-tab', `number ${n}: sent through System Events (the helper is not running)`); return true; }
      catch (e) { this.log('hand-tab', `number ${n}: could not send (${String(e.message || e).slice(0, 100)})`); if (!this.warnedTab) { this.warnedTab = true; this.notify('To switch tabs with your hand, allow Relay in System Settings > Privacy & Security > Accessibility, and allow it to control System Events if macOS asks.'); } return false; }
    }
    this.log('hand-tab', `number ${n}: the helper is not running yet`);
    return false;
  }
  // Is a web browser in front? False if it cannot tell quickly.
  async frontIsBrowser(timeoutMs = 300) {
    if (this.front) { try { return BROWSER_IDS.has(await this.front()); } catch { return false; } }
    if (!this.ready || !this.child) return false;
    return new Promise((resolve) => {
      const done = (v) => { clearTimeout(timer); const i = this.frontWaiters.indexOf(done); if (i >= 0) this.frontWaiters.splice(i, 1); resolve(v); };
      const timer = setTimeout(() => done(false), timeoutMs);
      this.frontWaiters.push(done);
      try { this.child.stdin.write(JSON.stringify({ op: 'front' }) + '\n'); } catch { done(false); }
    });
  }
  arm() { clearTimeout(this.watchdog); this.watchdog = setTimeout(() => { if (this.owner) this.end(this.owner); }, this.watchdogMs); this.watchdog.unref?.(); }
  begin(owner, pt) {
    if (!owner || !validPoint(pt) || !this.enabled() || this.owner) return false;
    if (!this.ready) { this.start(); return false; }
    this.owner = owner;this.accepted=false;this.startPoint=pt; this.point = pt; this.send('down', pt); this.arm(); return true;
  }
  move(owner, pt) { if (this.owner !== owner || !validPoint(pt)) return false; this.point = pt; if(this.accepted)this.send('move', pt); this.arm(); return true; }
  end(owner) { if (this.owner !== owner) return; this.send('up', this.point); clearTimeout(this.watchdog); this.watchdog = null; this.owner = null; this.point = null; }
  close() {
    if (this.owner) this.end(this.owner);
    const c = this.child; this.child = null; this.ready = false; this.owner = null;
    try { c?.stdin.end(); } catch { /* already exited */ }
  }
}
module.exports = { ExternalDrag, BROWSER_IDS };
