// Starts and stops Relay Remote to match the settings, and tells the settings page what to show (addresses, a QR code, paired phones).

const os = require('os');
const path = require('path');
const qrcode = require('qrcode-generator');
const { RemoteServer } = require('./server');
const { Pairing, Devices } = require('./auth');
const tailscale = require('./tailscale');

function lanAddresses(nets = os.networkInterfaces()) {
  const out = [];
  for (const list of Object.values(nets)) for (const n of list || []) if (n.family === 'IPv4' && !n.internal && !/^169\.254\./.test(n.address)) out.push(n.address);
  return out;
}

const qrSvg = (text) => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); };

class RemoteService {
  constructor({ store, ask, broadcast, root = path.join(__dirname, '../../remote') }) {
    this.store = store;
    this.ask = ask;
    this.broadcast = broadcast;
    this.root = root;
    this.server = null;
    this.pairing = new Pairing();
    this.devices = new Devices({ list: () => this.store.get('remoteDevices') || [], save: (l) => { this.store.data.remoteDevices = l; this.store.save(); } });
    this.ts = { installed: false };
    this.error = '';
  }

  get settings() {
    return this.store.get('settings.remote') || { enabled: false, lan: true, port: 47900 };
  }

  // Makes the server match the settings: running when enabled, on the right interface and port.
  async sync() {
    const s = this.settings;
    const host = s.lan === false ? '127.0.0.1' : '0.0.0.0';
    if (this.server && (!s.enabled || this.server.host !== host || this.server.port !== s.port)) { this.stop(); }
    if (!s.enabled || this.server) return;
    const control = { ask: (t, d) => this.ask.remoteAsk(t, d), stop: () => this.ask.cancelAll(), snapshot: () => this.ask.remoteSnapshot(), recent: (n) => this.ask.remoteRecent(n) };
    const server = new RemoteServer({ control, pairing: this.pairing, devices: this.devices, root: this.root, host, port: s.port });
    server.onPaired = () => this.broadcast();
    try {
      await server.start();
      this.server = server;
      this.error = '';
      this.ask.onStatus = (snap) => server.broadcast({ type: 'status', ...snap });
      this.ask.onResult = (r) => server.broadcast({ type: 'result', ...r });
    } catch (e) {
      this.error = /EADDRINUSE/.test(e.message) ? `Port ${s.port} is already in use.` : e.message;
    }
    this.ts = await tailscale.status().catch(() => ({ installed: false }));
  }

  stop() {
    this.server?.stop();
    this.server = null;
    this.ask.onStatus = null;
    this.ask.onResult = null;
  }

  urls() {
    const s = this.settings;
    const list = this.settings.lan === false ? [] : lanAddresses().map((ip) => `http://${ip}:${s.port}`);
    if (this.ts?.https && this.store.get('settings.remote.tailscaleServing')) list.unshift(this.ts.https);
    return list;
  }

  // Starts a pairing. The QR holds the link with the code in it, so scanning opens the page with the code filled in.
  pair() {
    const { code, expiresInMs } = this.pairing.start();
    const urls = this.urls();
    const best = urls[0] || '';
    return { code, expiresInMs, urls, qr: best ? qrSvg(`${best}/?code=${code}`) : '' };
  }

  async enableTailscale() {
    const r = await tailscale.serve(this.settings.port);
    if (r.ok) this.store.set('settings.remote.tailscaleServing', true);
    this.ts = await tailscale.status().catch(() => this.ts);
    return r;
  }

  async disableTailscale() {
    await tailscale.unserve();
    this.store.set('settings.remote.tailscaleServing', false);
  }

  info() {
    const s = this.settings;
    return {
      enabled: !!s.enabled, running: !!this.server, lan: s.lan !== false, port: s.port, error: this.error, urls: this.urls(),
      devices: (this.store.get('remoteDevices') || []).map((d) => ({ id: d.id, name: d.name, lastSeen: d.lastSeen })),
      tailscale: { ...this.ts, serving: !!s.tailscaleServing }
    };
  }
}

module.exports = { RemoteService, lanAddresses, qrSvg };
