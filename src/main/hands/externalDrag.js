// A single guarded system drag for ordinary Mac window title bars and browser tabs.
// The native helper checks Accessibility and hit-tests the title/tab region before pressing.
const { spawn } = require('child_process');
const validPoint = pt => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y);
class ExternalDrag {
  constructor({ bin, allowed, enabled = () => true, wanted = () => false, notify = () => {}, spawnFn = spawn, watchdogMs = 1000 }) {
    Object.assign(this, { bin, allowed, enabled, wanted, notify, spawnFn });
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
          if (line === 'ready') { this.ready = true; this.warned = false; }
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
  // "Go to tab N" in the browser in front (Command+N); the helper declines when no browser is in front.
  tab(n) { if (!Number.isInteger(n) || n < 1 || n > 9) return false; if (!this.ready) { this.start(); return false; } this.child.stdin.write(JSON.stringify({ op: 'tab', n }) + '\n'); return true; }
  // Is a web browser in front? Answers false if the helper is not running or does not answer quickly.
  frontIsBrowser(timeoutMs = 300) {
    if (!this.ready || !this.child) return Promise.resolve(false);
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
module.exports = { ExternalDrag };
