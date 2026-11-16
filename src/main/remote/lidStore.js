// Things the Mac sends to the phone with a lid flick, held in memory for a little while so the phone can fetch them (the event on the stream only says what arrived).
// Only the last few are kept, they expire, and nothing is written to disk.

const crypto = require('crypto');

const MAX_BYTES = 30 * 1024 * 1024;

// What the phone is told the thing is. Only kinds a phone shows safely keep their type; web pages, scripts and pictures that can run code (SVG) become plain text, and the rest a download.
const SAFE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'text/plain', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'video/mp4', 'video/quicktime']);
function safeMime(mime) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (SAFE.has(m)) return m;
  if (m === 'image/svg+xml' || m.startsWith('text/') || m === 'application/json' || m === 'application/xml') return 'text/plain';
  return 'application/octet-stream';
}

const cleanName = (name) => String(name || '').replace(/[\\/\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'From your Mac';

class LidStore {
  constructor({ max = 3, totalBytes = 2 * MAX_BYTES, ttlMs = 15 * 60 * 1000, now = Date.now, newId = () => crypto.randomUUID() } = {}) {
    Object.assign(this, { max, totalBytes, ttlMs, now, newId });
    this.items = []; // newest last
  }

  prune() {
    const t = this.now();
    this.items = this.items.filter((i) => t - i.at < this.ttlMs);
    while (this.items.length > this.max || this.items.reduce((a, i) => a + i.bytes.length, 0) > this.totalBytes) this.items.shift();
  }

  // item: { kind: 'file'|'image'|'text', name, mime, bytes: Buffer }. { ok: true, meta } or { ok: false, reason }.
  add(item) {
    const bytes = item && Buffer.isBuffer(item.bytes) ? item.bytes : null;
    if (!bytes || !bytes.length) return { ok: false, reason: 'nothing' };
    if (bytes.length > MAX_BYTES) return { ok: false, reason: 'too-big' };
    const kind = ['file', 'image', 'text'].includes(item.kind) ? item.kind : 'file';
    const entry = { id: this.newId(), kind, name: cleanName(item.name), mime: safeMime(item.mime), bytes, at: this.now() };
    this.items.push(entry);
    this.prune();
    return { ok: true, meta: this.meta(entry) };
  }

  meta(i) { return { id: i.id, kind: i.kind, name: i.name, mime: i.mime, size: i.bytes.length, at: i.at }; }

  list() { this.prune(); return this.items.map((i) => this.meta(i)).reverse(); }

  get(id) { this.prune(); return this.items.find((i) => i.id === id) || null; }
}

module.exports = { LidStore, safeMime, cleanName, MAX_BYTES };
