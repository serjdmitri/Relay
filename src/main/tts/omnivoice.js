const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const STEPS = 10;
class OmniVoice {
  constructor({ python, worker = path.join(__dirname, 'omni-worker.py'), spawnFn = spawn } = {}) {
    this.python = python; this.worker = worker; this.spawnFn = spawnFn; this.pending = new Map(); this.child = null; this.cancelled = new Map(); this.ready = false;
  }
  installed() { return !!this.python && fs.existsSync(this.python) && fs.existsSync(this.worker); }
  start() {
    if (this.child) return;
    const child = this.spawnFn(this.python, [this.worker], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' } });
    this.child = child; child.stdin.on('error', () => {});
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.ready) { this.ready = true; return; }
      const stale = this.cancelled.get(m.id); if (stale) { this.cancelled.delete(m.id); try { fs.unlinkSync(stale); } catch {} return; } // an answer nobody is waiting for any more
      const p = this.pending.get(m.id); if (!p) return;
      this.pending.delete(m.id); p.cleanup();
      if (m.error) p.reject(new Error(m.error)); else p.resolve(p.file);
    });
    const died = () => { if (this.child !== child) return; this.child = null; this.ready = false; this.cancelled.clear(); for (const p of this.pending.values()) { p.cleanup(); try { fs.unlinkSync(p.file); } catch {} p.reject(new Error('OmniVoice stopped')); } this.pending.clear(); };
    child.on('error', died); child.on('exit', died);
  }
  // Loads the model before anyone needs it. Starting the worker costs about 4.5 seconds (importing the libraries and loading the model), and that wait used to land on the first
  // reply after every start and after every interruption, which is the "voice preparing" delay. Called once at launch; one tiny silent-to-the-user sentence makes the first real one fast too.
  async warm() {
    if (!this.installed() || this.child) return false;
    try { const file = await this.synthesize('Ready.', { steps: 8 }); try { fs.unlinkSync(file); } catch { /* gone */ } return true; } catch { return false; }
  }

  // steps: how many refinement steps the voice takes (more is smoother and slower: 16 was the old fixed value; 10 is about a third faster and sounds the same for short replies).
  synthesize(text, { signal, rate = 'normal', steps = STEPS } = {}) {
    if (!this.installed()) return Promise.reject(new Error('OmniVoice is not installed'));
    if (signal?.aborted) return Promise.reject(Object.assign(new Error('Stopped'), { name: 'AbortError' }));
    this.start();
    const id = crypto.randomUUID(), file = path.join(os.tmpdir(), `relay-omni-${id}.wav`);
    return new Promise((resolve, reject) => {
      // Cancelling one reply (you spoke over it, or asked something else) must not throw the loaded model away: only that reply is dropped, and its file is deleted when it arrives.
      const cancel = () => { if (!this.pending.delete(id)) return; cleanup(); this.cancelled.set(id, file); reject(Object.assign(new Error('Stopped'), { name: 'AbortError' })); };
      const timer = setTimeout(() => this.stop(new Error('OmniVoice timed out')), 60000);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
      this.pending.set(id, { resolve, reject, file, cleanup });
      signal?.addEventListener('abort', cancel, { once: true });
      this.child.stdin.write(JSON.stringify({ id, text, path: file, speed: ({slower:.9,normal:1,faster:1.15})[rate] || 1, steps: Math.max(4, Math.min(32, Math.round(steps) || STEPS)) }) + '\n');
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
