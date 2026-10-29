// Mac drive: find files (with pictures of them), and tidy folders by a plan the person has seen and said yes to. Nothing is ever deleted
// or overwritten; the most Relay does is move files (and, only if asked, put some in the Trash). See guard.js and plan.js for the rules.

const path = require('path');
const { buildPlan, applyPlan, undoMoves, hasSymlink } = require('./plan');
const { pathProblem } = require('./guard');
const { planMake, runMake } = require('./make');
const { planDownloads } = require('./nightly');
const { scanFolder, describeScan, findFiles, kindOf, size, day, tilde, OPEN_SAFE } = require('./files');

const PLAN_TTL = 30 * 60 * 1000;
const NIGHTLY_TTL = 20 * 60 * 60 * 1000; // tonight's tidy-up waits until tomorrow evening for a yes

class Drive {
  // fs, exec(file, args) -> stdout, cards: { show(card), hide() }, thumb(path) -> data URL | null, trashItem(path), reveal(path), open(path), log: { read(), write(list) }
  constructor({ fs, home, exec, cards, thumb = async () => null, trashItem, reveal = () => {}, open = () => {}, log = { read: () => [], write: () => {} } }) {
    Object.assign(this, { fs, home, exec, cards, thumb, trashItem, reveal, open, log });
    this.plans = new Map();
  }

  resolve(p) {
    const t = String(p || '');
    return path.resolve(t.startsWith('~') ? path.join(this.home, t.slice(1)) : t || this.home);
  }

  // Files by name or content, with pictures on a card. Returns what to tell the model.
  async find({ query, folder, kind, limit } = {}) {
    const where = folder ? this.resolve(folder) : this.home;
    if (where !== this.home && !where.startsWith(this.home + path.sep)) return 'Relay only looks inside your home folder.';
    const found = await findFiles(query, { exec: this.exec, fs: this.fs, home: this.home, folder: where, kind, limit: Math.min(24, Math.max(1, +limit || 10)) });
    if (!found.length) return `Nothing found for "${query}"${folder ? ` in ${tilde(where, this.home)}` : ''}. Try fewer or different words, or look in a folder with drive_scan.`;
    const items = await Promise.all(found.slice(0, 10).map(async (f) => ({
      title: f.name, subtitle: tilde(path.dirname(f.path), this.home), note: `${f.kind}${f.size ? ` · ${size(f.size)}` : ''} · ${day(f.mtime)}`, image: await this.thumb(f.path).catch(() => null), url: `file:${f.path}`
    })));
    await this.cards?.show({ kind: 'list', title: `Found ${found.length} for “${String(query).slice(0, 40)}”`, subtitle: 'Click one to show it in Finder', summary: '', facts: [], links: [], items, image: null, credit: '' });
    return `Showing ${Math.min(10, found.length)} of ${found.length} on screen with previews (click one to show it in Finder). Results:\n${found.map((f) => `${f.path} | ${f.kind} | ${size(f.size)} | ${day(f.mtime)}`).join('\n')}`;
  }

  scan({ folder, depth } = {}) {
    const root = this.resolve(folder);
    const bad = root === this.home ? '' : pathProblem(path.join(root, 'x'), this.home);
    if (root !== this.home && !root.startsWith(this.home + path.sep)) return 'Relay only looks inside your home folder.';
    if (bad && !/main folders|itself/.test(bad)) return bad;
    try { if (hasSymlink(root, this.fs, this.home)) return 'That folder path contains a symbolic link, so Relay will not scan it.'; }
    catch { return 'That folder path could not be checked.'; }
    try { if (!this.fs.statSync(root).isDirectory()) return 'That is not a folder.'; } catch { return 'That folder is not there.'; }
    return describeScan(scanFolder(root, { fs: this.fs, home: this.home, depth: Math.min(5, Math.max(1, +depth || 3)) }), this.home);
  }

  // Checks a plan and shows it: where everything goes. Nothing moves yet.
  async propose(raw, { ttl = 0, nightly = false } = {}) {
    const plan = buildPlan(raw, { fs: this.fs, home: this.home });
    if (ttl) plan.ttl = ttl;
    if (!plan.moves.length && !plan.trash.length) {
      return `Nothing can be done with that plan.${plan.skipped.length ? ` Skipped: ${plan.skipped.slice(0, 8).map((s) => `${s.path} (${s.reason})`).join('; ')}` : ''}`;
    }
    this.plans.set(plan.id, plan);
    for (const [id, p] of this.plans) if (Date.now() - p.createdAt > (p.ttl || PLAN_TTL) || this.plans.size > 5) this.plans.delete(id);
    const items = await Promise.all(plan.groups.slice(0, 12).map(async (g) => {
      const names = g.moves.map((m) => path.basename(m.from));
      return { title: `→ ${tilde(g.folder, this.home)}`, subtitle: `${g.moves.length} ${g.moves.length === 1 ? 'item' : 'items'}`, note: `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`, image: await this.thumb(g.moves[0].from).catch(() => null), url: `file:${g.moves[0].from}` };
    }));
    if (plan.trash.length) items.push({ title: '→ the Trash (you can put them back)', subtitle: `${plan.trash.length} ${plan.trash.length === 1 ? 'item' : 'items'}`, note: plan.trash.slice(0, 3).map((t) => path.basename(t)).join(', '), image: null, url: '' });
    await this.cards?.show({
      kind: 'list', hold: true, title: 'Where I will put everything', subtitle: `${plan.moves.length} ${plan.moves.length === 1 ? 'item' : 'items'} to move${plan.trash.length ? `, ${plan.trash.length} to the Trash` : ''}`,
      summary: `${nightly ? 'Say “apply the plan” to do it, or “skip the plan”. ' : ''}Nothing is deleted or overwritten. Relay can undo moves${plan.trash.length ? '; restore items in the Trash using Put Back' : ''}.${plan.skipped.length ? ` ${plan.skipped.length} left alone.` : ''}`, facts: [], links: [], items, image: null, credit: ''
    });
    if (nightly) { this.nightlyPlanId = plan.id; return { id: plan.id, moves: plan.moves.length, groups: plan.groups.length }; }
    const lines = plan.groups.map((g) => `${tilde(g.folder, this.home)}: ${g.moves.length} (${g.moves.slice(0, 4).map((m) => path.basename(m.from)).join(', ')}${g.moves.length > 4 ? ', …' : ''})`);
    if (plan.trash.length) lines.push(`Trash: ${plan.trash.length} (${plan.trash.slice(0, 4).map((t) => path.basename(t)).join(', ')})`);
    return `Plan ${plan.id} is on screen. Where everything goes:\n${lines.join('\n')}${plan.skipped.length ? `\nLeft alone: ${plan.skipped.slice(0, 8).map((s) => `${path.basename(String(s.path))} (${s.reason})`).join('; ')}` : ''}\nNow tell the user in a few plain sentences where things will go, and ask them to confirm. Only then call drive_apply with plan_id "${plan.id}". Nothing has been moved yet.`;
  }

  confirmText(planId) {
    const p = this.plans.get(planId);
    if (!p) return null;
    return `Move ${p.moves.length} ${p.moves.length === 1 ? 'item' : 'items'} as shown${p.trash.length ? ` and put ${p.trash.length} in the Trash` : ''}? Nothing is deleted. Relay can undo moves${p.trash.length ? '; restore items in the Trash using Put Back' : ''}.`;
  }

  async apply({ plan_id } = {}) {
    const plan = this.plans.get(plan_id);
    if (!plan) return 'There is no such plan (it may be old). Use drive_propose again.';
    if (Date.now() - plan.createdAt > (plan.ttl || PLAN_TTL)) { this.plans.delete(plan_id); return 'That plan is too old. Use drive_propose again so the user sees it fresh.'; }
    this.plans.delete(plan_id);
    const res = await applyPlan(plan, { fs: this.fs, home: this.home, trashItem: this.trashItem });
    this.cards?.hide?.();
    const list = [...(this.log.read() || []), { id: res.id, ts: res.ts, done: res.done, trashed: res.trashed }].slice(-30);
    this.log.write(list);
    this.lastLogId = res.id;
    const bits = [`Moved ${res.done.length}`];
    if (res.trashed.length) bits.push(`put ${res.trashed.length} in the Trash`);
    return `${bits.join(' and ')}.${res.failed.length ? ` Could not do ${res.failed.length}: ${res.failed.slice(0, 5).map((f) => `${path.basename(String(f.path))} (${f.reason})`).join('; ')}.` : ''}${res.done.length ? ' Moves can be undone with drive_undo.' : ''}${res.trashed.length ? ' Restore items in the Trash using Put Back.' : ''}`;
  }

  // What drive_make will do, said to the person before it happens; null when there is nothing to do (drive_make then says why).
  makeConfirmText(raw) {
    const { jobs } = planMake(raw, { fs: this.fs, home: this.home });
    if (!jobs.length) return null;
    const j = jobs[0];
    if (j.kind === 'zip') return `Zip ${j.sources.length} ${j.sources.length === 1 ? 'item' : 'items'} into ${tilde(j.out, this.home)}? Your originals stay as they are, and it can be undone.`;
    return `Make ${jobs.length} ${jobs.length === 1 ? 'copy' : 'copies'} as ${j.format.toUpperCase()} next to the originals? Nothing is replaced, and it can be undone.`;
  }

  async make(raw) {
    const { jobs, skipped } = planMake(raw, { fs: this.fs, home: this.home });
    const why = skipped.length ? ` Left alone: ${skipped.slice(0, 6).map((s) => `${path.basename(String(s.path)) || 'request'} (${s.reason})`).join('; ')}` : '';
    if (!jobs.length) return `Nothing was made.${why}`;
    const res = await runMake(jobs, { fs: this.fs, home: this.home, exec: this.exec, trashItem: this.trashItem });
    if (res.made.length) { this.lastLogId = `make-${Date.now()}`; this.log.write([...(this.log.read() || []), { id: this.lastLogId, ts: Date.now(), done: [], made: res.made, trashed: [] }].slice(-30)); }
    const names = res.made.map((m) => tilde(m, this.home)).join(', ');
    return `${res.made.length ? `Made ${names}. It can be undone with drive_undo.` : 'Nothing was made.'}${res.failed.length ? ` Could not do ${res.failed.length}: ${res.failed.slice(0, 4).map((f) => `${path.basename(String(f.path))} (${f.reason})`).join('; ')}.` : ''}${why}`;
  }

  // Puts the last thing back: moved files go back where they were, and files Relay made go to the Trash (nothing is deleted; the person can take them back).
  async undo(id = '') {
    const list = this.log.read() || [];
    const last = id ? list.find((e) => e.id === id) : list.at(-1);
    if (!last || !(last.done?.length || last.made?.length)) return 'There is nothing to undo.';
    const { back, left } = undoMoves({ done: last.done || [] }, { fs: this.fs });
    const gone = [];
    for (const m of last.made || []) {
      try { if (!this.fs.existsSync(m)) { left.push({ path: m, reason: 'It is no longer there.' }); continue; } await this.trashItem(m); gone.push(m); } catch (e) { left.push({ path: m, reason: e.message }); }
    }
    // Keep failed items in the undo log so the user can fix the conflict and retry.
    const restored = new Set(back.map((item) => item.to));
    const removed = new Set(gone);
    const pending = { ...last, done: (last.done || []).filter((item) => !restored.has(item.to)), made: (last.made || []).filter((item) => !removed.has(item)) };
    this.log.write(list.flatMap((entry) => entry !== last ? [entry] : (pending.done.length || pending.made.length ? [pending] : [])));
    const bits = [];
    if (back.length) bits.push(`Put ${back.length} back where ${back.length === 1 ? 'it was' : 'they were'}.`);
    if (gone.length) bits.push(`Put ${gone.length} ${gone.length === 1 ? 'file' : 'files'} Relay made in the Trash (Put Back there if you want ${gone.length === 1 ? 'it' : 'them'} again).`);
    return `${bits.join(' ') || 'Nothing could be undone.'}${left.length ? ` ${left.length} could not be put back: ${left.slice(0, 4).map((l) => `${path.basename(l.path)} (${l.reason})`).join('; ')}.` : ''}${last.trashed?.length ? ` ${last.trashed.length} went to the Trash: open the Trash and choose Put Back.` : ''}`;
  }

  // Tonight's tidy of ~/Downloads, shown but not done. Returns { moves } (0 when there is nothing to tidy) after showing the plan on screen.
  async proposeDownloads({ nightly = true } = {}) {
    const { raw, left } = planDownloads({ fs: this.fs, home: this.home, declined: this.declined || new Set() });
    if (!raw.moves.length) return { moves: 0, left };
    const r = await this.propose(raw, { ttl: NIGHTLY_TTL, nightly: true });
    if (!r || typeof r === 'string') return { moves: 0, left };
    return { moves: r.moves, left, id: r.id, nightly };
  }

  // "Apply the plan": carries out tonight's plan if there is one that has not expired.
  async applyDownloads() {
    const id = this.nightlyPlanId;
    if (!id || !this.plans.has(id)) return 'There is no downloads plan waiting. Say “tidy my downloads” and I will make one.';
    this.nightlyPlanId = null;
    return this.apply({ plan_id: id });
  }

  // "Skip the plan": drops it, and the files in it are not proposed again by tomorrow night's.
  skipDownloads() {
    const id = this.nightlyPlanId;
    const plan = id && this.plans.get(id);
    if (!plan) return 'There is no downloads plan waiting.';
    this.declined = this.declined || new Set();
    for (const m of plan.moves) this.declined.add(m.from);
    this.plans.delete(id);
    this.nightlyPlanId = null;
    this.cards?.hide?.();
    return 'Skipped. I will leave those files where they are.';
  }

  // A click on a result: a file of a safe kind opens, anything else is shown in Finder.
  openFile(p) {
    const full = this.resolve(p);
    if (!full.startsWith(this.home + path.sep)) return;
    let st; try { st = this.fs.statSync(full); } catch { return; }
    if (st.isFile() && OPEN_SAFE.has(kindOf(full))) this.open(full); else this.reveal(full);
  }
}

module.exports = { Drive };
