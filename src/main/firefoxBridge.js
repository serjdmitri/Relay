const { EventEmitter } = require('events');

// WebSocket server the Firefox extension connects to. Only connections whose Origin is a
// moz-extension:// URL are accepted, so web pages cannot talk to it.
class FirefoxBridge extends EventEmitter {
  constructor({ port = 47831, WebSocketServer = require('ws').WebSocketServer } = {}) {
    super();
    this.port = port;
    this.WebSocketServer = WebSocketServer;
    this.socket = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  start() {
    this.server = new this.WebSocketServer({
      host: '127.0.0.1',
      port: this.port,
      verifyClient: ({ origin }) => typeof origin === 'string' && origin.startsWith('moz-extension://')
    });
    this.server.on('error', (e) => this.emit('error', e));
    this.server.on('connection', (ws) => {
      if (this.socket) this.socket.close();
      this.socket = ws;
      this.emit('status', true);
      ws.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (msg.event === 'hello') { this.extVersion = msg.version; this.emit('status', true); return; }
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
      });
      ws.on('close', () => {
        if (this.socket === ws) {
          this.socket = null;
          this.emit('status', false);
        }
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error('Firefox extension disconnected.'));
          this.pending.delete(id);
        }
      });
    });
  }

  isConnected() {
    return !!this.socket && this.socket.readyState === 1;
  }

  call(method, params, timeoutMs = 10000) {
    if (!this.isConnected()) return Promise.reject(new Error('Firefox extension is not connected.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Firefox did not answer ${method} in time.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  stop() {
    try {
      this.server?.close();
    } catch {}
  }
}

module.exports = { FirefoxBridge };
