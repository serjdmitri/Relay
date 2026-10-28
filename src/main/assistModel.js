// The models behind the meeting assistant. With a Claude account it keeps two Claude sessions warm for the whole meeting, so an answer starts the moment a question is
// found: one with no tools that streams the first answer, and one with web search that checks it. With another model service, the same two passes use that service.
const { SYSTEM, RESEARCH_SYSTEM } = require('./assist');

const RECYCLE_AFTER = 14; // a session remembers its questions; a fresh one every so often keeps it quick

class ClaudeAnswerer {
  // deps: { findClaude, McpHost, ClaudeSession }; getTools(): the web_search and fetch_page tools; getName(), getMemory(): for the prompt
  constructor({ deps, getTools, getName = () => '', getMemory = () => '' }) {
    Object.assign(this, { deps, getTools, getName, getMemory });
    this.quickS = null;
    this.researchS = null;
    this.hosts = [];
    this.claudePath = null;
  }

  async make(kind) {
    if (!this.claudePath) this.claudePath = await this.deps.findClaude();
    if (!this.claudePath) throw new Error('Claude is not installed');
    const host = new this.deps.McpHost();
    await host.start();
    this.hosts.push(host);
    const research = kind === 'research';
    const s = new this.deps.ClaudeSession({ claudePath: this.claudePath, host, system: research ? RESEARCH_SYSTEM : SYSTEM(this.getName(), this.getMemory()), tools: research ? this.getTools() : [], model: 'haiku', timeoutMs: 40000 });
    s.uses = 0;
    return s;
  }

  async session(kind) {
    const key = kind === 'research' ? 'researchS' : 'quickS';
    let s = this[key];
    if (s && (!s.alive || s.uses >= RECYCLE_AFTER)) { try { s.close(); } catch { /* already gone */ } s = null; }
    if (!s) s = this[key] = await this.make(kind);
    return s;
  }

  // Starts both now, so the first question does not wait for Claude to start.
  async warm() { await Promise.all([this.session('quick'), this.session('research')]); }

  async run(kind, prompt, { signal, onDelta }) {
    const s = await this.session(kind);
    s.uses++;
    const res = await s.ask(prompt, { signal, confirm: async () => false, onEvent: (e) => { if (e.type === 'text-delta' && onDelta) onDelta(e.text); } });
    if (res.status === 'failed') throw new Error(res.reply || 'Claude failed');
    if (res.status === 'stopped') throw new Error('stopped');
    return String(res.reply || '');
  }

  quick(prompt, opts = {}) { return this.run('quick', prompt, opts); }
  research(prompt, opts = {}) { return this.run('research', prompt, { signal: opts.signal }); }

  close() {
    for (const s of [this.quickS, this.researchS]) { try { s?.close(); } catch { /* already gone */ } }
    for (const h of this.hosts) { try { h.stop(); } catch { /* already stopped */ } }
    this.quickS = this.researchS = null;
    this.hosts = [];
  }
}

// Another model service: the first answer comes in one piece (no streaming), the check is a short agent run with web search.
class ProviderAnswerer {
  // deps: { buildProvider(), runAgent }; getTools(): web tools
  constructor({ deps, getTools, getName = () => '', getMemory = () => '' }) { Object.assign(this, { deps, getTools, getName, getMemory }); }

  async warm() {}

  async quick(prompt, { signal, onDelta } = {}) {
    const { provider } = this.deps.buildProvider();
    const res = await provider.step({ system: SYSTEM(this.getName(), this.getMemory()), messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }], tools: [], signal });
    const text = res.text || '';
    if (text && onDelta) onDelta(text);
    return text;
  }

  async research(prompt, { signal } = {}) {
    const { provider } = this.deps.buildProvider();
    const r = await this.deps.runAgent({ text: prompt, provider, tools: this.getTools(), system: RESEARCH_SYSTEM, confirm: async () => false, signal, maxSteps: 5 });
    if (r.status === 'failed') throw new Error(r.reply || 'failed');
    return String(r.reply || '');
  }

  close() {}
}

module.exports = { ClaudeAnswerer, ProviderAnswerer, RECYCLE_AFTER };
