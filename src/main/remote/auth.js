// Relay Remote's security: who may talk to the Mac. A phone pairs once with a short code you start in Settings (valid for five
// minutes, used once), and gets a long random token it keeps. Only a hash of each token is stored on the Mac. Requests from
// outside your own network are refused outright. Pure functions, so they can be tested.

const crypto = require('crypto');

const CODE_MS = 5 * 60 * 1000;
const MAX_TRIES = 5;
const LOCK_MS = 5 * 60 * 1000;

const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

// Only home networks, this Mac, and Tailscale (its 100.64.0.0/10 addresses) may connect: a port opened on the router by
// mistake would still be refused here.
function isPrivateAddress(ip) {
  let a = String(ip || '').replace(/^::ffff:/, '');
  if (a === '::1' || a === '127.0.0.1') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a)) return true; // IPv6 unique-local and link-local
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [x, y] = [+m[1], +m[2]];
  return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127);
}

// One pairing code at a time. Wrong guesses lock it for a while, so six digits cannot be brute forced.
class Pairing {
  constructor({ now = Date.now, code = newCode } = {}) {
    this.now = now;
    this.makeCode = code;
    this.current = null;
    this.tries = 0;
    this.lockedUntil = 0;
  }

  start() {
    this.current = { code: this.makeCode(), until: this.now() + CODE_MS };
    this.tries = 0;
    return { code: this.current.code, expiresInMs: CODE_MS };
  }

  active() {
    return !!this.current && this.current.until > this.now() ? { code: this.current.code, expiresInMs: this.current.until - this.now() } : null;
  }

  // Returns { ok: true } and uses up the code, or { ok: false, error }.
  check(code) {
    if (this.now() < this.lockedUntil) return { ok: false, error: 'Too many wrong codes. Wait a few minutes and start a new pairing on your Mac.' };
    if (!this.active()) return { ok: false, error: 'There is no pairing going on. Press Pair a phone in Relay on your Mac.' };
    const a = Buffer.from(String(code || '').trim());
    const b = Buffer.from(this.current.code);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      this.current = null;
      this.tries = 0;
      return { ok: true };
    }
    if (++this.tries >= MAX_TRIES) { this.lockedUntil = this.now() + LOCK_MS; this.current = null; }
    return { ok: false, error: 'That code is not right.' };
  }
}

// The paired phones. devices: [{ id, name, hash, created, lastSeen }], kept by the caller (the store).
class Devices {
  constructor({ list, save, now = Date.now }) {
    this.list = list;
    this.save = save;
    this.now = now;
  }

  add(name) {
    const token = newToken();
    const d = { id: crypto.randomUUID(), name: String(name || 'Phone').slice(0, 40), hash: hash(token), created: this.now(), lastSeen: this.now() };
    this.save([...this.list(), d]);
    return { id: d.id, token };
  }

  // The device for a token, or null. Touches lastSeen at most once a minute.
  find(token) {
    if (!token) return null;
    const h = hash(token);
    const a = Buffer.from(h);
    const d = this.list().find((x) => { const b = Buffer.from(x.hash); return a.length === b.length && crypto.timingSafeEqual(a, b); });
    if (d && this.now() - d.lastSeen > 60000) { d.lastSeen = this.now(); this.save(this.list()); }
    return d || null;
  }

  remove(id) {
    this.save(this.list().filter((d) => d.id !== id));
  }
}

module.exports = { Pairing, Devices, isPrivateAddress, hash, newToken, newCode, CODE_MS };
