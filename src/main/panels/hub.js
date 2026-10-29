// The open live panels: which are showing, what each is allowed to read, and the data sent to each on a timer. Three kinds:
//   fixed   shows some of Relay's own numbers (cpu, memory, battery, network, disk, jobs)
//   plugin  shows what an installed plugin's tool returns, as often as the plugin's manifest says (not faster than once a second)
//   custom  a small web page the model wrote. It runs in an isolated frame with no network except hosts you approved, and reads only the
//           numbers it declared. It cannot call tools, speak, type, or see your screen or files.
// The window itself is made by the app (openWindow); this file holds the rules, so they can be tested.

const crypto = require('crypto');
const { SOURCES } = require('./sources');

const MAX_PANELS = 4;
const MAX_HTML = 60 * 1024;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const LOW_BATTERY = 20;

const hashOf = (spec) => crypto.createHash('sha256').update(JSON.stringify([spec.kind, spec.sources, spec.hosts, spec.html || '', spec.plugin || ''])).digest('hex').slice(0, 16);

// A request for a panel, cleaned up. Returns { ok, spec } or { ok: false, error }.
function normalize(raw, { plugins = [] } = {}) {
  const title = String(raw?.title || 'Panel').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Panel';
  const plugin = String(raw?.plugin || '');
  if (plugin) { // "plugin:name:panelid"
    const [, name, id] = plugin.match(/^plugin:([a-z0-9-]+):([a-z0-9_]+)$/) || [];
    const p = plugins.find((x) => x.name === name);
    const def = p?.panels?.find((x) => x.id === id);
    if (!def) return { ok: false, error: 'No installed plugin offers that panel.' };
    return { ok: true, spec: { kind: 'plugin', title: raw.title ? title : def.title, sources: [], hosts: [], plugin, tool: def.tool, everySeconds: def.everySeconds, pluginName: name } };
  }
  const asked = [...new Set((Array.isArray(raw?.sources) ? raw.sources : []).map(String))];
  const bad = asked.filter((s) => !SOURCES[s]);
  if (bad.length) return { ok: false, error: `Unknown number: ${bad.join(', ')}. Choose from ${Object.keys(SOURCES).join(', ')}.` };
  const html = typeof raw?.html === 'string' ? raw.html : '';
  if (!html) return asked.length ? { ok: true, spec: { kind: 'fixed', title, sources: asked, hosts: [] } } : { ok: false, error: 'Say which numbers to show.' };
  if (html.length > MAX_HTML) return { ok: false, error: 'The panel page is too big (over 60 KB).' };
  const hosts = [...new Set((Array.isArray(raw?.hosts) ? raw.hosts : []).map((h) => String(h).toLowerCase()))];
  const badHost = hosts.find((h) => !HOST.test(h));
  if (badHost) return { ok: false, error: `"${badHost}" is not a host name.` };
  return { ok: true, spec: { kind: 'custom', title, sources: asked, hosts, html } };
}

// What the person is shown before a model-built panel appears.
function approvalText(spec) {
  const reads = spec.sources.length ? spec.sources.map((s) => SOURCES[s].label).join(', ') : 'nothing from your Mac';
  const net = spec.hosts.length ? `It may contact: ${spec.hosts.join(', ')}.` : 'It cannot use the internet.';
  return `This panel reads: ${reads}. ${net} It cannot use tools, speak, type, or see your screen or files.`;
}

// The page that runs a custom panel: a locked-down content policy (only the approved hosts), and a way to receive the numbers.
function frameDocument(spec) {
  const src = spec.hosts.map((h) => `https://${h}`).join(' ');
  const csp = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: ${src}; font-src data:; connect-src ${src || "'none'"}`;
  const bridge = '<script>window.relayPanel={_f:[],onData(f){this._f.push(f)}};addEventListener("message",function(e){if(e.source!==parent)return;(relayPanel._f).forEach(function(f){try{f(e.data)}catch(x){}})});</script>';
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}">${bridge}${spec.html}`;
}

class PanelHub {
  // sampler.sample(source); callPlugin(name, tool) -> text; openWindow(panel) -> { send(data), close(), onClosed(fn) }; lowPower() -> bool
  constructor({ sampler, callPlugin = async () => '', openWindow, getPlugins = () => [], approved = () => false, remember = () => {}, ask = async () => false, lowPower = () => false, setTimer = setInterval, clearTimer = clearInterval }) {
    Object.assign(this, { sampler, callPlugin, openWindow, getPlugins, approved, remember, ask, lowPower, setTimer, clearTimer });
    this.panels = new Map();
    this.hidden = false;
  }

  list() { return [...this.panels.values()].map((p) => ({ id: p.id, title: p.spec.title, kind: p.spec.kind })); }

  // Opens a panel. Returns { ok, id } or { ok: false, error }. A model-built panel needs your approval the first time (and again if it changes).
  async show(raw) {
    const n = normalize(raw, { plugins: this.getPlugins() });
    if (!n.ok) return n;
    if (this.panels.size >= MAX_PANELS) return { ok: false, error: `${MAX_PANELS} panels are already open. Close one first.` };
    const spec = n.spec;
    if (spec.kind === 'custom' && !this.approved(hashOf(spec))) {
      if (!(await this.ask(approvalText(spec), spec))) return { ok: false, error: 'You did not approve the panel.' };
      this.remember(hashOf(spec));
    }
    const id = crypto.randomUUID();
    const win = this.openWindow({ id, spec });
    const panel = { id, spec, win, timer: null, busy: false };
    this.panels.set(id, panel);
    win.onClosed(() => this.close(id));
    const every = spec.kind === 'plugin' ? spec.everySeconds * 1000 : 2000;
    panel.timer = this.setTimer(() => this.tick(panel), every);
    this.tick(panel);
    return { ok: true, id };
  }

  async tick(p) {
    if (p.busy || this.hidden || !this.panels.has(p.id)) return;
    if (this.lowPower()) return; // on a low battery the panels rest
    p.busy = true;
    try {
      if (p.spec.kind === 'plugin') p.win.send({ text: String(await this.callPlugin(p.spec.pluginName, p.spec.tool)).slice(0, 4000) });
      else { const data = {}; for (const s of p.spec.sources) data[s] = await this.sampler.sample(s); p.win.send(data); }
      p.fails = 0;
    } catch (e) {
      p.fails = (p.fails || 0) + 1;
      if (p.fails >= 5) { p.win.send({ error: String(e.message).slice(0, 200) }); this.close(p.id); }
    } finally { p.busy = false; }
  }

  close(id) {
    const p = this.panels.get(id);
    if (!p) return false;
    this.clearTimer(p.timer);
    this.panels.delete(id);
    try { p.win.close(); } catch { /* already closed */ }
    return true;
  }

  closeAll() { for (const id of [...this.panels.keys()]) this.close(id); }

  setHidden(h) { this.hidden = !!h; }
}

// "show my cpu", "show a system panel", "close the panel".
function parsePanelCommand(text) {
  const t = String(text || '').trim().replace(/[“”"]/g, '').replace(/[.!?]+$/, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '');
  if (/^(?:close|hide|dismiss|remove|get rid of) (?:the |all |my |these |those )?(?:live )?panels?$/i.test(t)) return { type: 'close' };
  if (/^(?:show|open|give|put up|bring up) (?:me )?(?:a |the |my )?(?:calculator|calc)(?: panel)?$/i.test(t)) return { type: 'calculator' };
  const m = t.match(/^(?:show|open|give|put up|bring up) (?:me )?(?:a |the |my )?(.+?)(?: panel| stats| monitor)?$/i);
  if (!m || !/\b(?:panel|stats|monitor)\b|^(?:cpu|memory|battery|network|disk)\b/i.test(t)) return null;
  const w = m[1].toLowerCase();
  if (/^(?:calculator|calc)$/.test(w)) return { type: 'calculator' };
  if (/^(?:system|mac|computer|pc)(?: load| stats| status)?$/.test(w) || /system (?:load|stats)/.test(w)) return { type: 'show', title: 'System', sources: ['cpu', 'memory', 'battery', 'network', 'disk'] };
  const WORDS = { cpu: /\b(?:cpu|processor|load)\b/, memory: /\b(?:memory|ram)\b/, battery: /\bbattery\b/, network: /\b(?:network|wifi|internet)\b/, disk: /\b(?:disk|storage)\b/, jobs: /\b(?:jobs|work|progress)\b/ };
  const found = Object.keys(WORDS).filter((k) => WORDS[k].test(w));
  return found.length ? { type: 'show', title: found.length === 1 ? SOURCES[found[0]].label : 'Panel', sources: found } : null;
}

module.exports = { PanelHub, normalize, approvalText, frameDocument, hashOf, parsePanelCommand, MAX_PANELS };
