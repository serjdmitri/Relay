const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { editParameter, MAX_BYTES } = require('./scadParameters');
const { pathProblem } = require('../drive/guard');
const { hasSymlink } = require('../drive/plan');
class ScadWorkspace {
  constructor({ home, now = Date.now, io = fs } = {}) { this.home = home; this.now = now; this.io = io; this.previews = new Map(); }
  check(file) {
    const resolved = path.resolve(file.startsWith('~') ? path.join(this.home, file.slice(1)) : file);
    const problem = pathProblem(resolved, this.home);
    if (problem || !/\.scad$/i.test(resolved) || hasSymlink(resolved, this.io, this.home)) throw Error(problem || 'Choose an OpenSCAD file without symbolic links.');
    return resolved;
  }
  preview({ file, parameter, value }) {
    const source = this.check(String(file || ''));
    const stat = this.io.lstatSync(source);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('Choose an OpenSCAD file under 1 MB.');
    const text = this.io.readFileSync(source, 'utf8');
    const edited = editParameter(text, parameter, value);
    const previous = text.split(/\r?\n/).find((line, i) => line !== edited.split(/\r?\n/)[i]);
    const next = edited.split(/\r?\n/).find((line, i) => line !== text.split(/\r?\n/)[i]);
    if (!previous || !next) throw Error('The parameter is already set to that value.');
    const id = crypto.randomUUID(), hash = crypto.createHash('sha256').update(text).digest('hex');
    this.previews.set(id, { source, edited, hash, previous: previous.trim(), next: next.trim(), at: this.now() });
    while (this.previews.size > 5) this.previews.delete(this.previews.keys().next().value);
    return { id, source, before: previous.trim(), after: next.trim() };
  }
  summary(id) {
    const p = this.previews.get(id);
    if (!p || this.now() - p.at > 600000) return null;
    return `Save a new OpenSCAD copy beside ${path.basename(p.source)}?\n${p.previous}\n→ ${p.next}\nThe original stays unchanged.`;
  }
  save(id) {
    const p = this.previews.get(id); this.previews.delete(id);
    if (!p || this.now() - p.at > 600000) throw Error('Preview expired. Preview the edit again.');
    this.check(p.source);
    const current = this.io.readFileSync(p.source, 'utf8');
    if (crypto.createHash('sha256').update(current).digest('hex') !== p.hash) throw Error('The original changed since preview. Preview it again.');
    const dir = path.dirname(p.source), ext = path.extname(p.source), base = path.basename(p.source, ext);
    for (let n = 1; n <= 100; n++) {
      const target = path.join(dir, `${base} - Relay edit${n === 1 ? '' : ` ${n}`}${ext}`);
      this.check(target);
      try { this.io.writeFileSync(target, p.edited, { flag: 'wx', mode: 0o600 }); return target; }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    throw Error('Could not find a free copy name.');
  }
}
module.exports = { ScadWorkspace };
