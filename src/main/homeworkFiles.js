// Where the homework helper's results go: ~/Documents/Relay Homework. A written piece becomes a Word file (made by the Mac's own textutil), a PDF (printed from a page)
// or a plain text file; code becomes a folder of files. Nothing is ever overwritten (a taken name gets " (2)"), files only go inside that one folder, and names
// the model gives are checked (no "..", no absolute paths, no odd characters). The Mac pieces are passed in, so this is testable.

const nodeFs = require('fs');
const path = require('path');
const os = require('os');
const { markdownToHtml } = require('./homework');

const MAX_DOC = 600 * 1024;
const MAX_FILE = 300 * 1024;
const MAX_FILES = 40;

const pad = (n) => String(n).padStart(2, '0');
const dateText = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const safeName = (s, fallback = 'Homework') => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 70) || fallback;

// A path inside the project folder: relative, at most 4 deep, plain characters. Returns the cleaned path or null.
function safeRel(p) {
  const s = String(p || '').replace(/\\/g, '/').trim();
  if (!s || s.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(s) || /[\u0000-\u001f]/.test(s)) return null;
  const parts = s.split('/').filter((x) => x && x !== '.');
  if (!parts.length || parts.length > 4) return null;
  if (!parts.every((x) => /^[A-Za-z0-9._ +\-@()]+$/.test(x) && !/^\.+$/.test(x) && x.length <= 80)) return null;
  return parts.join('/');
}

class HomeworkDocs {
  constructor({ fs = nodeFs, exec, renderPdf, openPath, revealPath, home = os.homedir(), now = () => new Date(), tmp = os.tmpdir() } = {}) {
    Object.assign(this, { fs, exec, renderPdf, openPath, revealPath, now, tmp });
    this.dir = path.join(home, 'Documents', 'Relay Homework');
  }

  // A name that is free, by adding " (2)", " (3)"...
  free(base, ext = '') {
    let n = 1;
    let p = path.join(this.dir, `${base}${ext}`);
    while (this.fs.existsSync(p)) p = path.join(this.dir, `${base} (${++n})${ext}`);
    return p;
  }

  // format: docx | pdf | md. When the one asked for cannot be made, the next best is: docx -> pdf -> md. Returns { path, format, note }.
  async saveDocument({ title, markdown, format = 'docx' }) {
    const md = String(markdown || '');
    if (!md.trim()) throw new Error('There was nothing to save.');
    if (md.length > MAX_DOC) throw new Error('That document is too long to save.');
    const name = safeName(title);
    this.fs.mkdirSync(this.dir, { recursive: true });
    const base = `${name} ${dateText(this.now())}`;
    const html = markdownToHtml(md, { title: String(title || '').slice(0, 120) });
    const tried = [];
    const chain = format === 'md' ? ['md'] : format === 'pdf' ? ['pdf', 'md'] : ['docx', 'pdf', 'md'];
    for (const f of chain) {
      try {
        if (f === 'md') {
          const out = this.free(base, '.md');
          this.fs.writeFileSync(out, md);
          return await this.done(out, 'md', tried);
        }
        if (f === 'pdf') {
          const out = this.free(base, '.pdf');
          await this.renderPdf(html, out);
          if (!this.fs.existsSync(out)) throw new Error('no PDF was made');
          return await this.done(out, 'pdf', tried);
        }
        const out = this.free(base, '.docx');
        const tmpHtml = path.join(this.tmp, `relay-hw-${process.pid}-${Date.now()}.html`);
        this.fs.writeFileSync(tmpHtml, html);
        try { await this.exec('/usr/bin/textutil', ['-convert', 'docx', '-output', out, tmpHtml]); } finally { try { this.fs.rmSync(tmpHtml, { force: true }); } catch { /* temp file */ } }
        if (!this.fs.existsSync(out)) throw new Error('no Word file was made');
        return await this.done(out, 'docx', tried);
      } catch (e) { tried.push(`${f}: ${e.message}`); }
    }
    throw new Error(`I could not save it (${tried.join('; ')}).`);
  }

  async done(out, format, tried) {
    try { await this.openPath?.(out); } catch { /* it is saved even if it did not open */ }
    return { path: out, format, note: tried.length ? `The ${tried[0].split(':')[0]} version could not be made, so this is a ${format} file.` : '' };
  }

  // A project: a folder with files. Existing folders are never touched; a new one is made beside them.
  async saveFiles({ folder, files }) {
    if (!Array.isArray(files) || !files.length) throw new Error('There were no files to save.');
    if (files.length > MAX_FILES) throw new Error(`That is too many files (the limit is ${MAX_FILES}).`);
    const clean = [];
    for (const f of files) {
      const rel = safeRel(f?.name);
      if (!rel) throw new Error(`"${String(f?.name).slice(0, 60)}" is not a file name I can use.`);
      const content = String(f?.content ?? '');
      if (content.length > MAX_FILE) throw new Error(`${rel} is too long to save.`);
      clean.push({ rel, content });
    }
    if (new Set(clean.map((c) => c.rel.toLowerCase())).size !== clean.length) throw new Error('Two files have the same name.');
    this.fs.mkdirSync(this.dir, { recursive: true });
    const root = this.free(safeName(folder, 'Project'));
    for (const c of clean) {
      const full = path.join(root, c.rel);
      this.fs.mkdirSync(path.dirname(full), { recursive: true });
      this.fs.writeFileSync(full, c.content);
    }
    try { await (this.revealPath || this.openPath)?.(root); } catch { /* saved anyway */ }
    return { path: root, files: clean.map((c) => c.rel) };
  }
}

module.exports = { HomeworkDocs, safeName, safeRel, MAX_FILES };
