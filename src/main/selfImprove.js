// Self-improvement workspace: a safe place for a proposed change to Relay's own code. Every proposal lives in its own git worktree on its own branch,
// so the code Relay is running (and your main branch) is never touched. Tests run there, a passing change is saved as ONE commit that can be undone
// with a single revert, and that is where this stops: nothing here merges, pushes, installs or restarts anything. You (or Claude Code) make the edits
// in the proposal folder; you review the commit and decide. Off until a source checkout is set in settings.selfImprove.repo.

const path = require('path');
const fs = require('fs');
const {createHash}=require('crypto');

const MAX_PROPOSALS = 10;
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const clean = (s, n = 120) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const short = (id) => String(id).slice(0, 8);

class ProposalWorkspace {
  // run(args, { cwd, timeout }) => Promise<{ code, stdout, stderr }>: git or npm, run without a shell. getConfig(): { repo, base }. store: { get, set }.
  constructor({ run, store, getConfig = () => ({}), now = Date.now, uuid = () => Math.random().toString(36).slice(2, 10) }) { Object.assign(this, { run, store, getConfig, now, uuid }); }

  conf() { const c = this.getConfig() || {}; return { repo: typeof c.repo === 'string' && path.isAbsolute(c.repo) ? c.repo : '', base: clean(c.base, 60) || 'main' }; }
  list() { const l = this.store.get('proposals'); return Array.isArray(l) ? l : []; }
  save(l) { this.store.set('proposals', l.slice(-30)); }
  find(ref) {
    const l = this.list(), q = String(ref || '').trim().toLowerCase();
    if (!q) return l.length === 1 ? l[0] : null;
    return l.find((p) => p.id === q) || l.find((p) => p.id.startsWith(q)) || l.find((p) => p.title.toLowerCase().includes(q)) || null;
  }
  patch(id, p) { this.save(this.list().map((x) => (x.id === id ? { ...x, ...p } : x))); }
  git(args, cwd, timeout = 60000) { return this.run(['git', ...args], { cwd, timeout }); }
  async status(p) {
    const r=await this.git(['status','--porcelain'],p.dir); if(r.code!==0)return null; if(!r.stdout.trim())return '';
    const diff=await this.git(['diff','HEAD','--binary','--no-ext-diff'],p.dir), files=await this.git(['ls-files','--others','--exclude-standard','-z'],p.dir);
    if(diff.code!==0||files.code!==0)return null;
    const hash=createHash('sha256').update(diff.stdout); let size=0;
    try { for(const name of files.stdout.split('\0').filter(Boolean).sort()) { const file=path.resolve(p.dir,name),relative=path.relative(p.dir,file); if(relative.startsWith('..')||path.isAbsolute(relative))return null; const st=fs.lstatSync(file); if(!st.isFile()||st.size>20*1024*1024||(size+=st.size)>100*1024*1024)return null; hash.update(name).update(fs.readFileSync(file)); } } catch {return null;}
    return r.stdout+'\nsha256:'+hash.digest('hex');
  }

  async create(title) {
    const { repo, base } = this.conf();
    if (!repo) return { error: 'Self-improvement is off. Set settings.selfImprove.repo to the folder of your Relay source checkout first.' };
    const name = slug(title);
    if (name.length < 3) return { error: 'Give the proposal a short name, for example "faster startup".' };
    if (this.list().filter((p) => !p.discarded).length >= MAX_PROPOSALS) return { error: `There are already ${MAX_PROPOSALS} open proposals. Discard one first.` };
    const id = this.uuid(), branch = `proposal/${name}-${id.slice(0, 4)}`, dir = path.join(path.dirname(repo), 'relay-proposals', `${name}-${id.slice(0, 4)}`);
    const r = await this.git(['worktree', 'add', '-b', branch, dir, base], repo);
    if (r.code !== 0) return { error: `Could not create the workspace: ${clean(r.stderr || r.stdout, 200)}` };
    const p = { id, title: clean(title), branch, dir, createdAt: this.now(), lastTest: null, commit: null };
    this.save([...this.list(), p]);
    return { proposal: p };
  }

  // Runs the project's tests inside the proposal only. The result is remembered together with the exact state of the files it tested.
  async test(ref, { signal } = {}) {
    signal?.throwIfAborted();
    const p = this.find(ref); if (!p) return { error: 'No such proposal.' };
    const before = await this.status(p);
    if(p.generated && (!p.reviewed || p.reviewState!==before)) return {error:'Review the generated diff in Settings before testing. It has not been executed.'};
    if (before === null) return { error: 'The proposal folder is not readable. It may have been moved or removed.' };
    const r = await this.run(['npm', 'test'], { cwd: p.dir, timeout: 600000, signal });
    const out = `${r.stdout}\n${r.stderr}`;
    const failed = Number((/ℹ fail (\d+)/.exec(out) || [])[1]), passed = Number((/ℹ pass (\d+)/.exec(out) || [])[1]);
    let ok = r.code === 0 && failed === 0 && passed > 0;
    const state = await this.status(p);
    ok = ok && state !== null && before === state;
    this.patch(p.id, { lastTest: { ok, at: this.now(), state, passed: Number.isFinite(passed) ? passed : null, failed: Number.isFinite(failed) ? failed : null } });
    return { ok, passed: Number.isFinite(passed) ? passed : null, failed: Number.isFinite(failed) ? failed : null, proposal: p };
  }

  // Saves the change as one commit on the proposal's branch, only if the tests passed on exactly these files. Never pushes or merges.
  async commit(ref, message) {
    const p = this.find(ref); if (!p) return { error: 'No such proposal.' };
    if (p.commit) return { error: 'This proposal is already saved as a commit. Review it, then merge it yourself if you want it.' };
    const state = await this.status(p);
    if (state === null) return { error: 'The proposal folder is not readable.' };
    if (!state.trim()) return { error: 'There are no changes in this proposal yet.' };
    if (!p.lastTest?.ok) return { error: 'The tests have not passed yet. Say "test the proposal" first.' };
    if (p.lastTest.state !== state) return { error: 'The files changed after the last passing test run. Run the tests again first.' };
    const msg = clean(message, 120) || p.title;
    const add = await this.git(['add', '-A'], p.dir); if (add.code !== 0) return { error: `Could not stage the change: ${clean(add.stderr, 160)}` };
    const c = await this.git(['commit', '-m', `Proposal: ${msg}`, '-m', 'Proposed by Relay and tested in an isolated workspace. Undo with: git revert <this commit>.'], p.dir);
    if (c.code !== 0) return { error: `Could not commit: ${clean(c.stderr || c.stdout, 160)}` };
    const sha = clean((await this.git(['rev-parse', 'HEAD'], p.dir)).stdout, 40);
    this.patch(p.id, { commit: { sha, at: this.now() } });
    return { sha, branch: p.branch, proposal: p };
  }

  // Removes the proposal's folder. Refuses when it has changes that were not committed. The branch and any commit are kept.
  async discard(ref, { discardGenerated = false } = {}) {
    const p = this.find(ref); if (!p) return { error: 'No such proposal.' };
    const state = await this.status(p);
    if (discardGenerated && (p.reviewed || p.commit)) return { error: 'Reviewed or committed proposals need manual cleanup.' };
    if (!discardGenerated && state && state.trim() && !p.commit) return { error: 'This proposal has changes that were not saved. Commit them or remove them yourself first; nothing was deleted.' };
    const { repo } = this.conf();
    const r = await this.git(['worktree', 'remove', ...(discardGenerated ? ['--force'] : []), p.dir], repo);
    if (r.code !== 0) return { error: `Could not remove the folder: ${clean(r.stderr, 160)}` };
    this.patch(p.id, { discarded: this.now() });
    return { proposal: p };
  }

  describe(p) { return `${short(p.id)} "${p.title}" on ${p.branch}${p.commit ? `, saved as commit ${p.commit.sha.slice(0, 8)}` : p.lastTest ? (p.lastTest.ok ? ', tests passed' : ', tests failed') : ', not tested yet'}`; }
}

// "start a proposal to speed up startup", "test the proposal", "save the proposal", "list proposals", "discard the proposal".
function parseSelfImproveCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/[.!?]+$/, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/\s+/g, ' ');
  const low = n.toLowerCase();
  let m = /^(?:start|open|create|make|begin) (?:a |an )?(?:new )?(?:self[- ]improvement |code )?(?:proposal|improvement workspace)(?: (?:to|for|called|named|about|:)\s*)?\s*(.*)$/i.exec(n);
  if (m) return { type: 'start', title: clean(m[1]) };
  m = /^(?:test|run (?:the )?tests (?:for|on|in)) (?:the |my )?(?:code )?(?:proposal|improvement)\s*(.*)$/i.exec(n);
  if (m) return { type: 'test', ref: clean(m[1]) };
  m = /^(?:save|commit) (?:the |my )?(?:code )?(?:proposal|improvement)(?: as (.+))?$/i.exec(n);
  if (m) return { type: 'commit', message: clean(m[1] || '') };
  m = /^(?:discard|remove|close) (?:the |my )?(?:code )?(?:proposal|improvement)\s*(.*)$/i.exec(n);
  if (m) return { type: 'discard', ref: clean(m[1]) };
  if (/^(?:list|show|what are) (?:me )?(?:my |the )?(?:code )?(?:proposals|improvements)(?: (?:are there|do i have))?$/.test(low)) return { type: 'list' };
  return null;
}

module.exports = { ProposalWorkspace, parseSelfImproveCommand, slug, MAX_PROPOSALS };
