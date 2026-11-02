const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
class OmniVoice {
  constructor({ python, worker = path.join(__dirname, 'omni-worker.py'), spawnFn = spawn } = {}) {
    this.python = python; this.worker = worker; this.spawnFn = spawnFn; this.pending = new Map(); this.child = null;
  }
  installed() { return !!this.python && fs.existsSync(this.python) && fs.existsSync(this.worker); }
  start() {
    if (this.child) return;
    const child = this.spawnFn(this.python, [this.worker], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' } });
    this.child = child; child.stdin.on('error', () => {});
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      const p = this.pending.get(m.id); if (!p) return;
      this.pending.delete(m.id); p.cleanup();
      if (m.error) p.reject(new Error(m.error)); else p.resolve(p.file);
    });
    const died = () => { if (this.child !== child) return; this.child = null; for (const p of this.pending.values()) { p.cleanup(); try { fs.unlinkSync(p.file); } catch {} p.reject(new Error('OmniVoice stopped')); } this.pending.clear(); };
    child.on('error', died); child.on('exit', died);
  }
  synthesize(text, { signal, rate = 'normal' } = {}) {
    if (!this.installed()) return Promise.reject(new Error('OmniVoice is not installed'));
    if (signal?.aborted) return Promise.reject(Object.assign(new Error('Stopped'), { name: 'AbortError' }));
    this.start();
    const id = crypto.randomUUID(), file = path.join(os.tmpdir(), `relay-omni-${id}.wav`);
    return new Promise((resolve, reject) => {
      const cancel = () => { this.stop(); };
      const timer = setTimeout(() => this.stop(new Error('OmniVoice timed out')), 60000);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
      this.pending.set(id, { resolve, reject, file, cleanup });
      signal?.addEventListener('abort', cancel, { once: true });
      this.child.stdin.write(JSON.stringify({ id, text, path: file, speed: ({slower:.9,normal:1,faster:1.15})[rate] || 1 }) + '\n');
    });
  }
  stop(reason = Object.assign(new Error('Stopped'), { name: 'AbortError' })) {
    const child = this.child; this.child = null;
    for (const p of this.pending.values()) { p.cleanup(); try { fs.unlinkSync(p.file); } catch {} p.reject(reason); }
    this.pending.clear();
    if (child) child.kill();
  }
}
module.exports = { OmniVoice };
