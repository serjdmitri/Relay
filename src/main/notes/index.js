// An index of one folder: its files cut into passages, each with a vector (a list of numbers that stands for its meaning) when the Mac can make
// one. Kept in ~/Relay/index/<folder hash>/ so asking is fast; only files that changed are read again. Everything stays on this Mac.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { kindOf, skipFile, skipDir, chunkText, rank } = require('./chunk');

const MAX_FILES = 5000;
const MAX_BYTES = 500 * 1024 * 1024;
const MAX_CHUNKS = 20000;
const BATCH = 40;
const hashOf = (folder) => crypto.createHash('sha256').update(path.resolve(folder)).digest('hex').slice(0, 16);

class TooBig extends Error { constructor(files, bytes) { super(`That folder has ${files} files (${Math.round(bytes / 1048576)} MB).`); this.tooBig = true; this.files = files; this.bytes = bytes; } }

class FolderIndex {
  // embed(texts) -> [vector or []] | null when this Mac has none; readText(file, kind) -> text; now() for tests
  constructor({ root, embed = async () => null, readText, now = Date.now }) {
    Object.assign(this, { root, embed, readText, now });
    this.cache = new Map();
  }

  dirOf(folder) { return path.join(this.root, hashOf(folder)); }

  // Every readable file under the folder: { rel, abs, mtime, size, kind }.
  scan(folder) {
    const out = [];
    let bytes = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isSymbolicLink()) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!skipDir(e.name)) walk(p); continue; }
        if (!e.isFile() || skipFile(e.name)) continue;
        const st = fs.statSync(p);
        if (st.size > 20 * 1024 * 1024) continue;
        bytes += st.size;
        out.push({ rel: path.relative(folder, p), abs: p, mtime: Math.floor(st.mtimeMs), size: st.size, kind: kindOf(e.name) });
      }
    };
    walk(folder);
    return { files: out, bytes };
  }

  load(folder) {
    const dir = this.dirOf(folder);
    if (this.cache.has(dir)) return this.cache.get(dir);
    let idx = { folder: path.resolve(folder), files: {}, chunks: [], dim: 0, at: 0, skipped: [], truncated: false };
    let vectors = new Float32Array(0);
    try {
      idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
      const b = fs.readFileSync(path.join(dir, 'vectors.bin'));
      vectors = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
    } catch { /* a new folder */ }
    const entry = { idx, vectors };
    this.cache.set(dir, entry);
    return entry;
  }

  save(folder, entry) {
    const dir = this.dirOf(folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(entry.idx));
    fs.writeFileSync(path.join(dir, 'vectors.bin'), Buffer.from(entry.vectors.buffer, entry.vectors.byteOffset, entry.vectors.byteLength));
  }

  // Brings the index up to date. Throws TooBig (unless force) for a very large folder so the person can say yes first.
  async update(folder, { force = false, onProgress = () => {} } = {}) {
    const { files, bytes } = this.scan(folder);
    if (!force && (files.length > MAX_FILES || bytes > MAX_BYTES)) throw new TooBig(files.length, bytes);
    const entry = this.load(folder);
    const { idx } = entry;
    const now = new Set(files.map((f) => f.rel));
    const stale = files.filter((f) => !idx.files[f.rel] || idx.files[f.rel].mtime !== f.mtime || idx.files[f.rel].size !== f.size);
    const gone = Object.keys(idx.files).filter((r) => !now.has(r));
    const drop = new Set([...gone, ...stale.map((f) => f.rel)]);
    if (drop.size) { // remove the passages of files that changed or vanished, keeping the vectors of the rest in step
      const keep = idx.chunks.map((c, i) => i).filter((i) => !drop.has(idx.chunks[i].file));
      const dim = idx.dim;
      const v = new Float32Array(keep.length * dim);
      keep.forEach((old, n) => v.set(entry.vectors.subarray(old * dim, old * dim + dim), n * dim));
      idx.chunks = keep.map((i) => idx.chunks[i]);
      entry.vectors = v;
      for (const r of drop) delete idx.files[r];
    }
    idx.skipped = [];
    idx.truncated = false;
    let done = 0;
    for (const f of stale) {
      onProgress({ done: done++, total: stale.length, file: f.rel });
      let text = '';
      try { text = await this.readText(f.abs, f.kind); } catch { text = ''; }
      const pieces = chunkText(text);
      if (!pieces.length) { idx.skipped.push(f.rel); idx.files[f.rel] = { mtime: f.mtime, size: f.size, chunks: 0 }; continue; }
      if (idx.chunks.length + pieces.length > MAX_CHUNKS) { idx.truncated = true; break; }
      const vecs = [];
      for (let i = 0; i < pieces.length; i += BATCH) {
        const got = await this.embed(pieces.slice(i, i + BATCH).map((p) => p.text));
        if (!got) { vecs.length = 0; break; }
        vecs.push(...got);
      }
      pieces.forEach((p) => idx.chunks.push({ file: f.rel, text: p.text, offset: p.offset }));
      idx.files[f.rel] = { mtime: f.mtime, size: f.size, chunks: pieces.length };
      if (vecs.length === pieces.length && vecs.every((v) => v.length)) {
        const dim = idx.dim || vecs[0].length;
        if (!idx.dim) idx.dim = dim;
        if (vecs.every((v) => v.length === dim) && entry.vectors.length === (idx.chunks.length - pieces.length) * dim) {
          const nv = new Float32Array(entry.vectors.length + pieces.length * dim);
          nv.set(entry.vectors); vecs.forEach((v, n) => nv.set(v, entry.vectors.length + n * dim));
          entry.vectors = nv;
        } else idx.dim = 0; // mixed or missing vectors: this index searches by words
      } else if (idx.dim) idx.dim = 0;
    }
    if (idx.dim && entry.vectors.length !== idx.chunks.length * idx.dim) { idx.dim = 0; entry.vectors = new Float32Array(0); } // never rank with vectors that do not line up
    idx.at = this.now();
    this.save(folder, entry);
    return { files: Object.keys(idx.files).length, chunks: idx.chunks.length, skipped: idx.skipped.length, truncated: idx.truncated, mode: idx.dim ? 'meaning' : 'words' };
  }

  async search(folder, query, { k = 5, cosMin } = {}) {
    const { idx, vectors } = this.load(folder);
    if (!idx.chunks.length) return { hits: [], mode: 'words', empty: true };
    let qvec = null;
    if (idx.dim) { const r = await this.embed([query]).catch(() => null); if (r && r[0]?.length === idx.dim) qvec = r[0]; }
    const out = rank(query, idx.chunks.map((c) => ({ file: c.file, text: c.text })), { qvec, vectors: qvec ? vectors : null, dim: idx.dim, k, ...(cosMin !== undefined ? { cosMin } : {}) });
    return { ...out, empty: false };
  }

  info(folder) { const { idx } = this.load(folder); return { files: Object.keys(idx.files).length, chunks: idx.chunks.length, skipped: idx.skipped.length, at: idx.at, mode: idx.dim ? 'meaning' : 'words', truncated: !!idx.truncated }; }

  remove(folder) { this.cache.delete(this.dirOf(folder)); fs.rmSync(this.dirOf(folder), { recursive: true, force: true }); }
}

module.exports = { FolderIndex, TooBig, MAX_FILES, MAX_BYTES, MAX_CHUNKS };
