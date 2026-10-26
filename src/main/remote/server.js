// Relay Remote's server: a small web server inside Relay that your phone talks to. The phone page is plain files; everything else
// needs a paired phone's token. Nothing here thinks: it passes your words to the same request path as the Mac's own shortcuts.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { isPrivateAddress } = require('./auth');

const TYPES = { '.ico': 'image/png', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PAGES = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/manifest.webmanifest': 'manifest.webmanifest', '/apple-touch-icon.png': 'apple-touch-icon.png', '/favicon.ico': 'apple-touch-icon.png' };
const MAX_BODY = 20000;

class RemoteServer {
  // control: { ask(text) -> id, stop(), snapshot(), recent(n) }; pairing: Pairing; devices: Devices; root: folder of the phone page.
  constructor({ control, pairing, devices, root, host = '0.0.0.0', port = 47900 }) {
    this.control = control;
    this.pairing = pairing;
    this.devices = devices;
    this.root = root;
    this.host = host;
    this.port = port;
    this.clients = new Set();
    this.server = null;
    this.ping = null;
  }

  async start() {
    if (this.server) return this.port;
    this.server = http.createServer((req, res) => this.handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch {} }));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port, this.host, resolve); });
    this.port = this.server.address().port;
    this.ping = setInterval(() => { for (const c of this.clients) c.res.write(': ping\n\n'); }, 20000);
    return this.port;
  }

  stop() {
    clearInterval(this.ping);
    for (const c of this.clients) { try { c.res.end(); } catch {} }
    this.clients.clear();
    try { this.server?.close(); } catch {}
    this.server = null;
  }

  // Everything you want the phones to see goes through here.
  broadcast(event) {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of this.clients) c.res.write(line);
  }

  json(res, code, obj) {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  body(req) {
    return new Promise((resolve, reject) => {
      let s = '';
      req.on('data', (c) => { s += c; if (s.length > MAX_BODY) { reject(new Error('too large')); req.destroy(); } });
      req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('bad json')); } });
    });
  }

  auth(req) {
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    return m ? this.devices.find(m[1]) : null;
  }

  async handle(req, res) {
    if (!isPrivateAddress(req.socket.remoteAddress)) { res.writeHead(403); return res.end(); } // not from your network
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (req.method === 'GET' && PAGES[p]) {
      const file = path.join(this.root, PAGES[p]);
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      return res.end(fs.readFileSync(file));
    }
    if (!p.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    // Pages on other sites cannot send this header without Relay's permission, so they cannot drive the API through a browser.
    if (req.method === 'POST' && req.headers['x-relay-remote'] !== '1') return this.json(res, 400, { error: 'Missing header.' });

    if (p === '/api/pair' && req.method === 'POST') {
      const b = await this.body(req).catch(() => null);
      if (!b) return this.json(res, 400, { error: 'Bad request.' });
      const r = this.pairing.check(b.code);
      if (!r.ok) return this.json(res, 403, { error: r.error });
      const d = this.devices.add(b.name);
      this.onPaired?.(d);
      return this.json(res, 200, { token: d.token });
    }

    const device = this.auth(req);
    if (!device) return this.json(res, 401, { error: 'Not paired.' });

    if (p === '/api/state' && req.method === 'GET') return this.json(res, 200, { ...this.control.snapshot(), recent: this.control.recent(8), device: device.name });
    if (p === '/api/ask' && req.method === 'POST') {
      const b = await this.body(req).catch(() => null);
      const text = String(b?.text || '').trim().slice(0, 2000);
      if (!text) return this.json(res, 400, { error: 'Say or type something first.' });
      return this.json(res, 200, { id: await this.control.ask(text, device) });
    }
    if (p === '/api/stop' && req.method === 'POST') { this.control.stop(); return this.json(res, 200, { ok: true }); }
    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'status', ...this.control.snapshot() })}\n\n`);
      const c = { res, device };
      this.clients.add(c);
      req.on('close', () => this.clients.delete(c));
      return;
    }
    this.json(res, 404, { error: 'Not found.' });
  }
}

module.exports = { RemoteServer };
