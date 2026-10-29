// A single guarded system drag for ordinary Mac window title bars and browser tabs.
// The native helper checks Accessibility and hit-tests the title/tab region before pressing.
const { spawn } = require('child_process');
class ExternalDrag {
  constructor({ bin, allowed, enabled = () => true, notify = () => {}, spawnFn = spawn, watchdogMs = 1000 }) {
    Object.assign(this, { bin, allowed, enabled, notify, spawnFn });
    this.child = null; this.ready = false; this.owner = null; this.point = null; this.buf = ''; this.warned = false; this.watchdogMs = watchdogMs; this.watchdog = null;
  }
  start() {
    if (this.child || !this.enabled()) return;
    if (!this.allowed()) { if (!this.warned) this.notify('Allow Accessibility for Relay to move app windows and tabs.'); this.warned = true; return; }
    try {
      const c = this.spawnFn(this.bin, ['hand-drag'], { stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = c; this.ready = false; this.buf = '';
      c.stdout.on('data', data => {
        this.buf += String(data); let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
          if (line === 'ready') { this.ready = true; this.warned = false; }
          if (line === 'not-draggable') this.notify('Grab the top bar of an app window or a browser tab to move it.');
        }
      });
      c.stderr.on('data', () => {}); c.stdin.on('error', () => {});
      const failed = () => { if (this.child === c) { clearTimeout(this.watchdog); this.watchdog = null; this.child = null; this.ready = false; this.owner = null; if (!this.warned) this.notify('App dragging is unavailable. Allow Relay and its hand-drag helper in Accessibility settings, then try again.'); this.warned = true; } };
      c.on('error', failed); c.on('exit', failed);
    } catch { if (!this.warned) this.notify('Could not start app dragging.'); this.warned = true; }
  }
  send(op, pt) { if (this.child && this.ready && pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) this.child.stdin.write(JSON.stringify({ op, x: pt.x, y: pt.y }) + '\n'); }
  arm() { clearTimeout(this.watchdog); this.watchdog = setTimeout(() => { if (this.owner) this.end(this.owner); }, this.watchdogMs); this.watchdog.unref?.(); }
  begin(owner, pt) {
    if (!this.enabled() || this.owner) return false;
    if (!this.ready) { this.start(); return false; }
    this.owner = owner; this.point = pt; this.send('down', pt); this.arm(); return true;
  }
  move(owner, pt) { if (this.owner !== owner) return; this.point = pt; this.send('move', pt); this.arm(); }
  end(owner) { if (this.owner !== owner) return; this.send('up', this.point); clearTimeout(this.watchdog); this.watchdog = null; this.owner = null; this.point = null; }
  close() {
    if (this.owner) this.end(this.owner);
    const c = this.child; this.child = null; this.ready = false; this.owner = null;
    try { c?.stdin.end(); } catch { /* already exited */ }
  }
}
module.exports = { ExternalDrag };
