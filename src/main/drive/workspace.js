// The selected-folder organizer reuses the normal classifier, preview and exclusive mover.
const fs = require('fs');
const path = require('path');
const { buildPlan, applyPlan, hasSymlink, isProject } = require('./plan');
const { pathProblem } = require('./guard');
const { planDownloads } = require('./nightly');
const stamp = st => ({ dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs });
const same = (st, saved) => Object.entries(saved).every(([k, v]) => st[k] === v);
class FileWorkspace {
  constructor({ access, store, move, io = fs }) { Object.assign(this, { access, store, move, io }); this.plans = new Map(); this.busy = new Set(); }
  journal() { return this.store.get('workspaceMoves') || []; }
  write(entries) { this.store.data.workspaceMoves = entries; this.store.save(); }
  history(id) { return this.journal().filter(e => e.rootId === id).map(e => ({ id: e.id, createdAt: e.createdAt, count: e.moves.length })); }
  preview(id) {
    const root = this.access.require(id, true);
    if (isProject(root.path, this.io)) throw new Error('This folder is a code project. Choose a folder of loose files instead.');
    const proposal = planDownloads({ fs: this.io, home: root.path, folder: root.path, limit: 150 });
    const plan = buildPlan(proposal.raw, { fs: this.io, home: root.path });
    plan.rootId = id; plan.left = proposal.left;
    plan.moves = plan.moves.filter(m => {
      const st = this.io.lstatSync(m.from);
      if (!st.isFile() || st.dev !== root.dev) { plan.skipped.push({ path: m.from, reason: 'Not a regular file on the selected drive.' }); return false; }
      m.stamp = stamp(st); return true;
    });
    for (const [key, value] of this.plans) if (Date.now() - value.createdAt > 1800000) this.plans.delete(key);
    if (this.plans.size >= 5) this.plans.delete(this.plans.keys().next().value);
    this.plans.set(plan.id, plan);
    return { id: plan.id, moves: plan.moves.map(({ from, to }) => ({ from, to })), skipped: plan.skipped, left: plan.left, expires: plan.createdAt + 1800000 };
  }
  safe(root, p) {
    const bad = pathProblem(p, root.path);
    if (bad || hasSymlink(p, this.io, root.path)) throw new Error(bad || 'A path contains a symbolic link.');
  }
  async exclusive(rootId, run) {
    if (this.busy.has(rootId)) throw Error('This folder is already being organized or restored. Wait for it to finish.');
    this.busy.add(rootId);
    try { return await run(); } finally { this.busy.delete(rootId); }
  }
  apply(id) { return this.exclusive(this.plans.get(id)?.rootId, () => this.applyNow(id)); }
  async applyNow(id) {
    const plan = this.plans.get(id); this.plans.delete(id); // a second click cannot replay the plan
    if (!plan || Date.now() - plan.createdAt > 1800000) throw new Error('Preview expired. Make a fresh preview.');
    const root = this.access.require(plan.rootId, true);
    if (isProject(root.path, this.io)) throw new Error('The folder became a code project; make a fresh preview.');
    const entry = { id, rootId: root.id, createdAt: Date.now(), moves: [] };
    const entries = [...this.journal(), entry];
    const result = await applyPlan({ ...plan, trash: [] }, { fs: this.io, home: root.path, move: async (from, to) => {
      this.access.require(root.id, true);
      this.safe(root, from); this.safe(root, to);
      const expected = plan.moves.find(m => m.from === from).stamp;
      const st = this.io.lstatSync(from);
      if (!st.isFile() || !same(st, expected)) throw new Error('File changed since preview. Left in place.');
      if (this.io.statSync(path.dirname(to)).dev !== root.dev) throw new Error('Destination is on another drive. Left in place.');
      if (typeof this.move !== 'function') throw new Error('Safe file moving is unavailable.');
      const record = { from, to, stamp: expected };
      entry.moves.push(record); this.write(entries); // persist before moving, so interrupted work can be undone
      try {
        if (this.store.saveAsync) { await this.store.saveAsync(); if (this.store.lastError) throw Error('Could not save the undo record. No move started.'); }
        this.access.require(root.id, true); this.safe(root, from); this.safe(root, to);
        if (!same(this.io.lstatSync(from), expected)) throw Error('File changed before moving. Left in place.');
        await this.move(from, to);
      }
      catch (err) {
        // A failed native response can be ambiguous. Retain the record only if the file actually moved.
        if (this.io.existsSync(from) || !this.io.existsSync(to) || !same(this.io.lstatSync(to), expected)) { entry.moves.pop(); this.write(entries); }
        throw err;
      }
    } });
    if (!entry.moves.length) this.write(entries.filter(e => e !== entry));
    return { ...result, history: this.history(root.id) };
  }
  undo(id) { return this.exclusive(this.journal().find(e => e.id === id)?.rootId, () => this.undoNow(id)); }
  async undoNow(id) {
    const entries = this.journal(); const entry = entries.find(e => e.id === id);
    if (!entry) throw new Error('No undo record remains for that organization.');
    const root = this.access.require(entry.rootId, true);
    const failed = []; let count = 0;
    for (const m of [...entry.moves].reverse()) {
      try {
        this.access.require(root.id, true); this.safe(root, m.from); this.safe(root, m.to);
        // A persisted pending move that never happened needs no action.
        if (!this.io.existsSync(m.to) && this.io.existsSync(m.from) && same(this.io.lstatSync(m.from), m.stamp)) { entry.moves = entry.moves.filter(x => x !== m); this.write(entries); continue; }
        if (!same(this.io.lstatSync(m.to), m.stamp)) throw new Error('File changed after organization. Left in place.');
        if (this.io.existsSync(m.from)) throw new Error('Its original name is occupied. Left in place.');
        if (typeof this.move !== 'function') throw new Error('Safe file moving is unavailable.');
        await this.move(m.to, m.from); count++;
        entry.moves = entry.moves.filter(x => x !== m); this.write(entries);
      } catch (e) { failed.push({ path: m.to, reason: e.message }); }
    }
    if (!entry.moves.length) this.write(entries.filter(e => e !== entry));
    return { count, failed, history: this.history(root.id) };
  }
}
module.exports = { FileWorkspace, stamp, same };
