// The documents Relay writes for you, kept in ~/Documents/Relay Documents. Each document has a folder of its own:
//   Cover letter/Cover letter.docx          the current version, as a Word file you can open
//   Cover letter/.relay/document.json       { id, title, current, pending, versions: [{ n, at, kind, note, status }], docxSha, docxName }
//   Cover letter/.relay/versions/v1.json    { pages: ["markdown of page 1", ...] } for every version, so a change can always be taken back
//   Cover letter/.relay/versions/v1.docx    the Word file as it was for that version
//   Cover letter/.relay/pages/<hash>.png    the picture of one page (named by what is on it, so a page that moved is not drawn again)
//   Cover letter/.relay/backup/             a Word file you changed by hand, saved before Relay put a new version in its place
// A change made by voice is a new version that is live at once but "pending": the phone shows what changed, and Approve keeps it, Reject puts the old pages back
// (as a new version, so nothing is ever lost). The Mac pieces (making the Word file, drawing a page) are passed in, so this is testable.

const nodeFs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { markdownToHtml } = require('../homework');
const { safeName } = require('../homeworkFiles');
const model = require('./model');

const BREAK = 'RELAYPAGEBREAKMARKER';
const sha = (x) => crypto.createHash('sha1').update(x).digest('hex');

// The page's HTML pieces, from the homework helper's markdown converter: its style and its body.
function parts(md) {
  const html = markdownToHtml(md);
  return { style: (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0], body: (html.match(/<body>([\s\S]*)<\/body>/) || [0, ''])[1] };
}

// The whole document as one HTML file for textutil. textutil drops page breaks, so each one is a paragraph holding a marker that is turned into a real break afterwards.
function documentHtml(title, pages) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ps = pages.map(parts);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${ps[0].style}</head><body>${ps.map((p) => p.body).join(`\n<p>${BREAK}</p>\n`)}</body></html>`;
}

// word/document.xml with each marker paragraph replaced by a paragraph that is a page break.
function withPageBreaks(xml) {
  return String(xml).replace(/<w:p>(?:(?!<\/w:p>)[\s\S])*?RELAYPAGEBREAKMARKER[\s\S]*?<\/w:p>/g, '<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
}

class DocumentStore {
  // exec(cmd, args, { cwd }) -> stdout text; render(markdown) -> { png: Buffer, overflow: boolean }; reveal(path)
  constructor({ fs = nodeFs, home = os.homedir(), now = () => Date.now(), exec, render, reveal, tmp = os.tmpdir(), id = () => `doc-${crypto.randomBytes(4).toString('hex')}` } = {}) {
    Object.assign(this, { fs, now, exec, render, reveal, tmp, newId: id });
    this.dir = path.join(home, 'Documents', 'Relay Documents');
    this.chain = Promise.resolve();
  }

  // One change at a time, so two edits never write over each other.
  serial(fn) {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  meta(folder) { return path.join(folder, '.relay', 'document.json'); }

  readJson(file) { try { return JSON.parse(this.fs.readFileSync(file, 'utf8')); } catch { return null; } }

  writeJson(file, data) {
    this.fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    this.fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    this.fs.renameSync(tmp, file);
  }

  // Every document, newest change first: { ...document.json, folder }.
  all() {
    let names = [];
    try { names = this.fs.readdirSync(this.dir); } catch { return []; }
    const out = [];
    for (const name of names) {
      const folder = path.join(this.dir, name);
      const m = this.readJson(this.meta(folder));
      if (m && typeof m.id === 'string' && Array.isArray(m.versions)) out.push({ ...m, folder });
    }
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  // By id, or by words of the title ("the cover letter"); with nothing, the latest. Throws a sentence for the person.
  find(query = '') {
    const all = this.all();
    if (!all.length) throw new Error('There are no documents yet. Ask me to write one.');
    const q = String(query || '').trim().toLowerCase();
    if (!q) return all[0];
    const byId = all.find((d) => d.id.toLowerCase() === q);
    if (byId) return byId;
    const words = q.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1 && !/^(?:the|my|a|an|document|doc|file|please)$/.test(w));
    const hit = all.find((d) => d.title.toLowerCase() === q) || all.find((d) => words.length && words.every((w) => d.title.toLowerCase().includes(w))) || all.find((d) => d.title.toLowerCase().includes(q));
    if (!hit) throw new Error(`I could not find a document called "${String(query).slice(0, 60)}". I have: ${all.slice(0, 8).map((d) => d.title).join(', ')}.`);
    return hit;
  }

  versionFile(doc, n, ext = 'json') { return path.join(doc.folder, '.relay', 'versions', `v${n}.${ext}`); }

  pagesOf(doc, n = doc.current) {
    const v = this.readJson(this.versionFile(doc, n));
    if (!v || !Array.isArray(v.pages)) throw new Error(`Version ${n} of ${doc.title} is missing.`);
    return v.pages;
  }

  docxPath(doc) { return path.join(doc.folder, doc.docxName); }

  // The Word file for these pages, written into the document's folder (what was there is kept first, if it is not what Relay wrote).
  async writeDocx(doc, pages) {
    const html = documentHtml(doc.title, pages);
    const stamp = `${process.pid}-${this.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const work = path.join(this.tmp, `relay-doc-${stamp}`);
    this.fs.mkdirSync(path.join(work, 'word'), { recursive: true });
    try {
      const src = path.join(work, 'doc.html'), out = path.join(work, 'doc.docx');
      this.fs.writeFileSync(src, html);
      await this.exec('/usr/bin/textutil', ['-convert', 'docx', '-output', out, src], { cwd: work });
      if (!this.fs.existsSync(out)) throw new Error('no Word file was made');
      if (pages.length > 1) {
        const xml = await this.exec('/usr/bin/unzip', ['-p', out, 'word/document.xml'], { cwd: work });
        if (!String(xml).includes('<w:body>')) throw new Error('the Word file could not be read back');
        this.fs.writeFileSync(path.join(work, 'word', 'document.xml'), withPageBreaks(xml));
        await this.exec('/usr/bin/zip', ['-q', out, 'word/document.xml'], { cwd: work });
      }
      const bytes = this.fs.readFileSync(out);
      const target = this.docxPath(doc);
      if (this.fs.existsSync(target) && doc.docxSha && sha(this.fs.readFileSync(target)) !== doc.docxSha) { // changed by hand in Word: keep it
        const keep = path.join(doc.folder, '.relay', 'backup', `${this.now()}.docx`);
        this.fs.mkdirSync(path.dirname(keep), { recursive: true });
        this.fs.copyFileSync(target, keep);
      }
      this.fs.writeFileSync(`${target}.tmp`, bytes);
      this.fs.renameSync(`${target}.tmp`, target);
      doc.docxSha = sha(bytes);
      return bytes;
    } finally { try { this.fs.rmSync(work, { recursive: true, force: true }); } catch { /* temporary */ } }
  }

  // Adds a version with these pages: its pages and Word file are kept, the document's Word file becomes it.
  async commit(doc, pages, { kind, note, status }) {
    const n = (doc.versions.at(-1)?.n || 0) + 1;
    const bytes = await this.writeDocx(doc, pages);
    this.writeJson(this.versionFile(doc, n), { pages });
    this.fs.writeFileSync(this.versionFile(doc, n, 'docx'), bytes);
    doc.versions.push({ n, at: this.now(), kind, note, status });
    doc.current = n;
    doc.updatedAt = this.now();
    this.save(doc);
    return n;
  }

  save(doc) {
    const { folder, ...rest } = doc;
    this.writeJson(this.meta(folder), rest);
  }

  summary(doc) {
    return { id: doc.id, title: doc.title, folder: doc.folder, docx: this.docxPath(doc), version: doc.current, pages: this.pagesOf(doc).length, pending: !!doc.pending, updatedAt: doc.updatedAt };
  }

  // A new document. pages: markdown, one string per page.
  create({ title, pages }) {
    return this.serial(async () => {
      const clean = model.cleanPages(pages);
      const name = safeName(title, 'Document');
      this.fs.mkdirSync(this.dir, { recursive: true });
      let folder = path.join(this.dir, name), k = 1;
      while (this.fs.existsSync(folder)) folder = path.join(this.dir, `${name} (${++k})`);
      this.fs.mkdirSync(path.join(folder, '.relay'), { recursive: true });
      const doc = { id: this.newId(), title: String(title || '').trim().slice(0, 120) || name, createdAt: this.now(), updatedAt: this.now(), current: 0, pending: null, versions: [], docxName: `${path.basename(folder)}.docx`, docxSha: '', folder };
      await this.commit(doc, clean, { kind: 'create', note: `Written with ${clean.length} page${clean.length === 1 ? '' : 's'}`, status: 'approved' });
      try { await this.reveal?.(this.docxPath(doc)); } catch { /* it is saved even if Finder did not open */ }
      return this.summary(doc);
    });
  }

  // A change by voice: becomes the live version, pending until it is approved or rejected.
  edit(query, ops) {
    return this.serial(async () => {
      const doc = this.find(query);
      const before = this.pagesOf(doc);
      const { pages, note } = model.applyOps(before, ops);
      if (model.same(pages, before)) throw new Error('That would not change anything.');
      if (!doc.pending) doc.pending = { base: doc.current };
      await this.commit(doc, pages, { kind: 'edit', note: note[0].toUpperCase() + note.slice(1), status: 'pending' });
      return { ...this.summary(doc), note, changes: model.changes(this.pagesOf(doc, doc.pending.base), pages) };
    });
  }

  // Approve keeps the pending changes; reject puts the pages from before them back (as a new version).
  review(id, action) {
    return this.serial(async () => {
      const doc = this.find(id);
      if (!doc.pending) throw new Error('There is no change waiting for an answer.');
      const base = doc.pending.base;
      if (action === 'approve') {
        for (const v of doc.versions) if (v.status === 'pending') v.status = 'approved';
        doc.pending = null;
        doc.updatedAt = this.now();
        this.save(doc);
        return { ...this.summary(doc), action };
      }
      if (action !== 'reject') throw new Error('Say approve or reject.');
      const back = this.pagesOf(doc, base);
      for (const v of doc.versions) if (v.status === 'pending') v.status = 'rejected';
      doc.pending = null;
      await this.commit(doc, back, { kind: 'restore', note: `Put version ${base} back`, status: 'approved' });
      return { ...this.summary(doc), action };
    });
  }

  // The pages in the order the person dragged them to. A change waiting for an answer comes first, so a reject can still put things back cleanly.
  reorder(id, order) {
    return this.serial(async () => {
      const doc = this.find(id);
      if (doc.pending) throw new Error('Approve or reject the waiting change before moving pages.');
      const pages = model.reorder(this.pagesOf(doc), order);
      if (model.same(pages, this.pagesOf(doc))) return this.summary(doc);
      await this.commit(doc, pages, { kind: 'reorder', note: 'Pages moved', status: 'approved' });
      return this.summary(doc);
    });
  }

  // Everything the phone shows about one document.
  detail(id) {
    const doc = this.find(id);
    const pages = this.pagesOf(doc);
    const side = (md) => this.readJson(path.join(doc.folder, '.relay', 'pages', `${sha(md)}.json`)) || {};
    return {
      ...this.summary(doc),
      folderName: path.basename(doc.folder),
      pageList: pages.map((md, i) => ({ index: i, excerpt: model.excerpt(md), overflow: !!side(md).overflow, key: sha(md).slice(0, 12) })),
      changes: doc.pending ? model.changes(this.pagesOf(doc, doc.pending.base), pages) : [],
      pendingNote: doc.pending ? doc.versions.filter((v) => v.status === 'pending').map((v) => v.note).join('; ') : '',
      versions: doc.versions.slice(-12).map((v) => ({ n: v.n, at: v.at, kind: v.kind, note: v.note, status: v.status }))
    };
  }

  // The text of one version (for "read me the letter" or before editing): numbered pages and paragraphs.
  read(query) {
    const doc = this.find(query);
    return { ...this.summary(doc), text: model.numbered(this.pagesOf(doc)) };
  }

  // The picture of one page of the current version (drawn once, then kept).
  pageImage(id, index) {
    return this.serial(async () => {
      const doc = this.find(id);
      const pages = this.pagesOf(doc);
      const i = Number(index);
      if (!Number.isInteger(i) || i < 0 || i >= pages.length) throw new Error('There is no such page.');
      const key = sha(pages[i]);
      const file = path.join(doc.folder, '.relay', 'pages', `${key}.png`);
      if (this.fs.existsSync(file)) return { bytes: this.fs.readFileSync(file), title: doc.title, key };
      if (!this.render) throw new Error('Pages cannot be drawn right now.');
      const r = await this.render(pages[i]);
      this.fs.mkdirSync(path.dirname(file), { recursive: true });
      this.fs.writeFileSync(file, r.png);
      this.writeJson(path.join(doc.folder, '.relay', 'pages', `${key}.json`), { overflow: !!r.overflow });
      return { bytes: r.png, title: doc.title, key };
    });
  }
}

module.exports = { DocumentStore, documentHtml, withPageBreaks, parts, BREAK };
