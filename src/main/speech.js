// Talks to native/relay-speech, the on-device dictation helper (Apple SpeechAnalyzer).
// Protocol: JSON lines. See native/relay-speech.swift.

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');

class Speech extends EventEmitter {
  constructor({ binPath, spawnFn = spawn, log = console }) {
    super();
    this.binPath = binPath;
    this.spawnFn = spawnFn;
    this.log = log;
    this.child = null;
    this.buf = '';
    this.waiters = [];
    this.listening = false;
    this.lastError = null;
  }

  get available() {
    return !!this.binPath && fs.existsSync(this.binPath);
  }

  ensure() {
    if (this.child) return this.child;
    if (!this.available) throw new Error('The dictation helper is missing. Rebuild Relay with npm run pack.');
    const child = this.spawnFn(this.binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.buf = '';
    child.stdout.on('data', (d) => this._onData(d.toString()));
    child.stderr.on('data', (d) => this.log.error?.('relay-speech:', d.toString().trim()));
    child.stdin.on('error', () => {});
    child.on('error', (e) => this._onExit(child, e.message));
    child.on('exit', (code) => this._onExit(child, `The dictation helper stopped (code ${code}).`));
    return child;
  }

  _onExit(child, message) {
    if (this.child !== child) return;
    this.child = null;
    this.listening = false;
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.reject(new Error(message));
    }
    this.emit('exit', message);
  }

  _onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      this._onEvent(msg);
    }
  }

  _onEvent(msg) {
    switch (msg.event) {
      case 'partial': this.emit('partial', msg.text || ''); return;
      case 'level': this.emit('level', msg.value || 0); return;
      case 'preparing': this.emit('preparing', msg.fraction ?? 0); return;
      case 'listening': this.listening = true; break;
      case 'final': this.listening = false; break;
      case 'error': this.lastError = msg; this.listening = false; break;
      default: break;
    }
    const idx = this.waiters.findIndex((w) => w.events.includes(msg.event) || msg.event === 'error');
    if (idx >= 0) {
      const [w] = this.waiters.splice(idx, 1);
      clearTimeout(w.timer);
      if (msg.event === 'error') {
        const err = new Error(msg.message || 'Dictation failed.');
        err.code = msg.code;
        w.reject(err);
      } else {
        w.resolve(msg);
      }
    } else if (msg.event === 'error') {
      this.emit('error-event', msg);
    } else {
      this.emit(msg.event, msg);
    }
  }

  send(cmd) {
    const child = this.ensure();
    child.stdin.write(JSON.stringify(cmd) + '\n');
  }

  wait(events, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const w = { events, resolve, reject, timer: null };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error('Dictation timed out.'));
      }, timeout);
      this.waiters.push(w);
    });
  }

  async request(cmd, events, timeout) {
    // Send first: if the helper is missing this throws before a waiter and its timer exist.
    // Replies arrive on a later tick, so registering the waiter right after is safe.
    this.send(cmd);
    return this.wait(events, timeout);
  }

  prepare(locale, vocabulary = []) {
    return this.request({ cmd: 'prepare', locale, vocabulary }, ['prepared'], 10 * 60 * 1000);
  }

  // device: "auto" (built-in mic when a Bluetooth headset is the default), "default", or a device UID.
  async listen(device = 'auto') {
    await this.request({ cmd: 'start', device }, ['listening'], 30000);
  }

  async finish() {
    if (!this.child) return '';
    const msg = await this.request({ cmd: 'stop' }, ['final'], 15000);
    return (msg.text || '').trim();
  }

  cancel() {
    if (!this.child) return;
    this.listening = false;
    try {
      this.send({ cmd: 'cancel' });
    } catch {}
  }

  async permissions() {
    const m = await this.request({ cmd: 'permissions' }, ['permissions'], 5000);
    return { mic: m.mic, speech: m.speech };
  }

  async requestPermissions() {
    const m = await this.request({ cmd: 'request-permissions' }, ['permissions'], 5 * 60 * 1000);
    return { mic: m.mic, speech: m.speech };
  }

  async inputDevices(pref = 'auto') {
    const m = await this.request({ cmd: 'devices', pref }, ['devices'], 5000);
    return { default: m.default || null, using: m.using || m.default || null, list: m.list || [] };
  }

  async inputDevice(pref = 'auto') {
    return (await this.inputDevices(pref)).using;
  }

  // Built-in display brightness, 0 to 1. Pass a value to change it. Rejects when the display cannot be controlled.
  async brightness(value) {
    const m = await this.request(value === undefined ? { cmd: 'brightness' } : { cmd: 'brightness', set: value }, ['brightness'], 5000);
    if (!m.ok) throw new Error(m.error || 'Brightness control is not available.');
    return m.value;
  }

  async locales() {
    const m = await this.request({ cmd: 'locales' }, ['locales'], 15000);
    return m.list || [];
  }

  stop() {
    if (!this.child) return;
    try {
      this.send({ cmd: 'quit' });
    } catch {}
    const c = this.child;
    setTimeout(() => {
      try { c.kill(); } catch {}
    }, 300);
  }
}

module.exports = { Speech };
