// Drives native/relay-glass, which draws the real see-through "liquid glass" behind the pill (macOS 26).
// Without the helper, or on an older macOS, the app keeps its own dark CSS pill.

const { spawn } = require('child_process');
const fs = require('fs');

class Glass {
  constructor({ binPath, spawnFn = spawn, macOS = process.getSystemVersion?.() || '0', log = console }) {
    this.binPath = binPath;
    this.spawnFn = spawnFn;
    this.log = log;
    this.child = null;
    this.failed = false;
    this.major = parseInt(String(macOS).split('.')[0], 10) || 0;
  }

  get supported() {
    return this.major >= 26 && !!this.binPath && fs.existsSync(this.binPath) && !this.failed;
  }

  // True once the helper is running and can be asked to draw.
  get active() {
    return !!this.child && this.supported;
  }

  start() {
    if (this.child || !this.supported) return this.active;
    const child = this.spawnFn(this.binPath, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    child.stdin.on('error', () => {});
    child.stdout?.on('data', (d) => {
      if (String(d).includes('"ready"')) this.onReady?.();
    });
    child.on('error', () => this._died(child));
    child.on('exit', () => this._died(child));
    return true;
  }

  _died(child) {
    if (this.child !== child) return;
    this.child = null;
    // A helper that dies when asked to start is not worth retrying forever.
    this.deaths = (this.deaths || 0) + 1;
    if (this.deaths >= 3) this.failed = true;
  }

  send(msg) {
    if (!this.start()) return false;
    try {
      this.child.stdin.write(JSON.stringify(msg) + '\n');
      return true;
    } catch {
      return false;
    }
  }

  show(rect, notch, radius = 27) {
    return this.send({ cmd: 'show', rect, notch, radius });
  }

  frame(rect, radius = 27) {
    return this.send({ cmd: 'frame', rect, radius });
  }

  hide(notch) {
    return this.send({ cmd: 'hide', notch });
  }

  stop() {
    if (!this.child) return;
    try {
      this.child.stdin.write('{"cmd":"quit"}\n');
    } catch {}
    const c = this.child;
    this.child = null;
    setTimeout(() => {
      try { c.kill(); } catch {}
    }, 300);
  }
}

module.exports = { Glass };
