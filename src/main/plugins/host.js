// Runs one plugin as its own process and talks to it in MCP over stdio (newline-separated JSON). The plugin gets a small environment (no keys),
// its own folder to work in, and, where macOS allows, a sandbox that fits what it declared. Calls have a time limit; a plugin that dies is
// restarted once by the manager.

const { spawn } = require('child_process');
const path = require('path');
const { buildProfile, wrap } = require('./sandbox');

const PROTOCOL = '2025-03-26';

class PluginProcess {
  constructor({ dir, manifest, spawnFn = spawn, sandbox = false, env = process.env, home = process.env.HOME || '', timeoutMs = 30000 }) {
    Object.assign(this, { dir, manifest, spawnFn, sandbox, timeoutMs });
    this.env = { PATH: env.PATH || '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin', HOME: home, LANG: env.LANG || 'en_US.UTF-8', RELAY_PLUGIN: manifest.name };
    this.child = null;
    this.next = 1;
    this.waiting = new Map();
    this.buf = '';
    this.stderr = '';
    this.stopping = false;
    this.exited = false;
  }

  async start() {
    const cmd = wrap(buildProfile(this.manifest, this.dir, { home: this.env.HOME }), this.manifest.command, this.sandbox);
    this.child = this.spawnFn(cmd.file, cmd.args, { cwd: this.dir, env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (d) => this.onData(d));
    this.child.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-1500); });
    this.child.on('error', (e) => this.onExit(`could not start: ${e.message}`));
    this.child.on('exit', (code) => this.onExit(`exited with code ${code}`));
    await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'relay', version: '1' } });
    this.notify('notifications/initialized');
  }

  onExit(why) {
    this.exited = true;
    for (const { reject, timer } of this.waiting.values()) { clearTimeout(timer); reject(new Error(`The plugin ${why}.${this.stderr ? ` ${this.stderr.trim().slice(-200)}` : ''}`)); }
    this.waiting.clear();
  }

  onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const w = this.waiting.get(msg.id);
      if (!w) continue;
      this.waiting.delete(msg.id);
      clearTimeout(w.timer);
      if (msg.error) w.reject(new Error(String(msg.error.message || 'The plugin reported an error.').slice(0, 300)));
      else w.resolve(msg.result);
    }
    if (this.buf.length > 5e6) this.buf = ''; // a plugin that never ends a line
  }

  write(obj) { this.child.stdin.write(`${JSON.stringify(obj)}\n`); }

  notify(method, params) { this.write({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }); }

  request(method, params) {
    if (this.exited) return Promise.reject(new Error('The plugin is not running.'));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`The plugin did not answer within ${Math.round(this.timeoutMs / 1000)} seconds.`)); }, this.timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  // Runs one of the plugin's tools. Returns the plugin's text (what it sent, as plain text, cut to a safe size).
  async call(tool, args) {
    const r = await this.request('tools/call', { name: tool, arguments: args || {} });
    const text = (r?.content || []).filter((c) => c.type === 'text').map((c) => String(c.text)).join('\n').slice(0, 8000);
    if (r?.isError) throw new Error(text || 'The plugin reported an error.');
    return text;
  }

  stop() { this.stopping = true; try { this.child?.kill(); } catch { /* already gone */ } }
}

module.exports = { PluginProcess, PROTOCOL };
