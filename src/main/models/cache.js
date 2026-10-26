// A folder of models Relay has already made, so a hologram that is pinned (or asked for again) does not need the free service again.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ModelCache {
  constructor(dir) { this.dir = dir; }
  key(...parts) { return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40); }
  file(key) { return path.join(this.dir, `${key}.glb`); }
  get(key) { try { return fs.readFileSync(this.file(key)); } catch { return null; } }
  put(key, bytes) { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.file(key), bytes); return this.file(key); }
  // Only files inside this folder may be read back (a saved hologram names its file).
  readInside(file) {
    const f = path.resolve(String(file));
    return f.startsWith(path.resolve(this.dir) + path.sep) && f.endsWith('.glb') ? fs.readFileSync(f) : null;
  }
  // Keeps the folder from growing without end: the oldest files go once it passes 300 MB.
  trim(maxBytes = 300 * 1024 * 1024) {
    try {
      const files = fs.readdirSync(this.dir).map((n) => ({ n, s: fs.statSync(path.join(this.dir, n)) })).sort((a, b) => a.s.mtimeMs - b.s.mtimeMs);
      let total = files.reduce((t, f) => t + f.s.size, 0);
      for (const f of files) { if (total <= maxBytes) break; fs.rmSync(path.join(this.dir, f.n), { force: true }); total -= f.s.size; }
    } catch { /* nothing to trim */ }
  }
}

module.exports = { ModelCache };
