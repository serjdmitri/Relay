// "Code me a login form" while VS Code (or Cursor) is open: Relay finds the project folder the editor has open, hands the request to your own Claude (or, when Claude is out of usage, Codex)
// working in that folder, and then opens the first changed file in the editor so you see it. The editor reloads changed files by itself, so what is said by voice appears in the code.
// What it will and will not do: it edits files inside that one folder only (the CLI tools are held to it), reads with Glob/Grep, and runs no shell except reading git. A folder that is not
// under git cannot be undone, so Relay asks first there; in a git folder it just goes and then says which files changed.
const path = require('path');
const os = require('os');
const fs = require('fs');

// bundle id -> where that editor keeps its "which folder is open" file and what to call it
const EDITORS = [
  { id: /^com\.microsoft\.VSCode$/, name: 'VS Code', app: 'Visual Studio Code', support: 'Code' },
  { id: /^com\.microsoft\.VSCodeInsiders$/, name: 'VS Code Insiders', app: 'Visual Studio Code - Insiders', support: 'Code - Insiders' },
  { id: /^com\.todesktop\.230313mzl4w4u92$/, name: 'Cursor', app: 'Cursor', support: 'Cursor' },
  { id: /^com\.exafunction\.windsurf$/, name: 'Windsurf', app: 'Windsurf', support: 'Windsurf' },
  { id: /^com\.vscodium$/, name: 'VSCodium', app: 'VSCodium', support: 'VSCodium' }
];
const editorFor = (bundleId) => EDITORS.find((e) => e.id.test(String(bundleId || ''))) || null;

// "code me a login form", "code this: ...", "write code that ...", "vibe code ...", or "... in VS Code / Cursor / my editor / my project". Returns { task } or null.
// Stays narrow on purpose: an ordinary "write an email" or "add milk to my list" is not this.
const EDITOR_WORDS = '(?:vs ?code|visual studio code|code editor|cursor|windsurf|my editor|my project|my repo|this project|this repo|the project|my code(?:base)?|the code(?:base)?)';
function parseCodeCommand(raw) {
  const text = String(raw || '').trim().replace(/^(?:(?:hey|ok|okay) )?(?:jarvis|relay)[, ]+/i, '').replace(/[.!?]+$/, '').trim();
  if (text.length < 8 || text.length > 1500) return null;
  let m = /^(?:please |can you |could you |i want you to |go ahead and )*(?:vibe[- ]?code|code(?: me| up| this| that| it)?|write(?: me)? (?:some |the )?code(?: for| to| that| which)?)(?:[:,]? )(.+)$/i.exec(text);
  if (m && m[1].trim().split(/\s+/).length >= 2) return { task: m[1].trim().replace(/^(?:for|to|that) /i, '') };
  m = new RegExp(`^(?:please |can you |could you |i want you to |go ahead and )*((?:add|build|create|make|write|implement|fix|refactor|change|update|rename|remove)\\b.+?)\\s+(?:in|into|inside|to|for|on) ${EDITOR_WORDS}$`, 'i').exec(text);
  if (m) return { task: m[1].trim() };
  m = new RegExp(`^(?:in|inside) ${EDITOR_WORDS}[, ]+(.{8,})$`, 'i').exec(text);
  if (m) return { task: m[1].trim() };
  return null;
}

const fileUrlToPath = (u) => { try { return decodeURIComponent(new URL(u).pathname); } catch { return ''; } };

// The open project folder from the editor's storage.json and the window title ("file.js — project — Visual Studio Code").
// The folder the title names wins; else the editor's last active window; else null (Relay then says it cannot tell).
function folderFromStorage(storage, title = '', exists = fs.existsSync) {
  const w = storage?.windowsState || {};
  const folders = [w.lastActiveWindow?.folder, ...(w.openedWindows || []).map((x) => x.folder), ...Object.keys(storage?.profileAssociations?.workspaces || {})].filter(Boolean).map(fileUrlToPath).filter((p) => p && exists(p));
  const parts = String(title).split(/\s+[—–-]\s+/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) { const hit = folders.find((f) => path.basename(f) === part); if (hit) return hit; }
  const last = w.lastActiveWindow?.folder ? fileUrlToPath(w.lastActiveWindow.folder) : '';
  return last && exists(last) ? last : null;
}

const RULES = 'You are editing the project in the current folder, which the user has open in their editor. Do exactly what they ask, with small focused changes. Edit files directly. Do not delete files, do not touch anything outside this folder, and do not run commands except to read the code or the git state. When finished, reply in one or two plain spoken sentences saying what you changed.';

class CodeAgent {
  constructor({ frontmost, windowTitle, readStorage, isGit, gitChanged, run, findClaude, findCodex, runCodex, openInEditor, exists = fs.existsSync, isLimit = () => false, confirm = async () => false, push = () => {} }) {
    Object.assign(this, { frontmost, windowTitle, readStorage, isGit, gitChanged, run, findClaude, findCodex, runCodex, openInEditor, exists, isLimit, confirm, push });
  }

  // -> { status, reply }
  async code(task, { signal } = {}) {
    const front = await this.frontmost().catch(() => null);
    const editor = editorFor(front?.bundleId);
    if (!editor) return { status: 'failed', reply: `Open the project in VS Code or Cursor and bring it to the front, then ask again, Sir. ${front?.name ? `${front.name} is in front now.` : ''}`.trim() };
    const title = await this.windowTitle(front).catch(() => '');
    const storage = await this.readStorage(editor.support).catch(() => null);
    const folder = folderFromStorage(storage, title, this.exists);
    if (!folder) return { status: 'failed', reply: `I cannot tell which folder ${editor.name} has open. Open a folder there (File, Open Folder), then ask again, Sir.` };
    const project = path.basename(folder);
    const git = await this.isGit(folder).catch(() => false);
    if (!git && !(await this.confirm({ question: `${project} is not under git, so I could not undo my changes. Code it anyway?` }))) return { status: 'stopped', reply: 'Okay, I did not change anything.' };
    const before = git ? await this.gitChanged(folder).catch(() => []) : [];
    const prompt = `${RULES}\n\nThe request: ${task}`;
    let result = null, via = 'Claude';
    const claude = await this.findClaude().catch(() => null);
    if (claude) { this.push({ label: `Coding in ${editor.name} with Claude` }); result = await this.run({ kind: 'claude', bin: claude, cwd: folder, prompt, signal }); }
    if (!claude || (result && result.status === 'failed' && this.isLimit(result.reply))) {
      const codex = await this.findCodex().catch(() => null);
      if (!codex) return { status: 'failed', reply: claude ? 'Claude is out of usage and Codex is not signed in, Sir.' : 'Neither Claude nor Codex is set up, Sir.' };
      this.push({ label: `Coding in ${editor.name} with Codex` });
      via = 'Codex'; result = await this.run({ kind: 'codex', bin: codex, cwd: folder, prompt, signal });
    }
    if (!result || result.status === 'stopped') return { status: 'stopped', reply: 'Stopped.' };
    if (result.status === 'failed') return { status: 'failed', reply: `The coding run did not finish: ${String(result.reply || 'no reason given').slice(0, 200)}` };
    const after = git ? await this.gitChanged(folder).catch(() => []) : [];
    const changed = after.filter((f) => !before.includes(f));
    if (changed.length) await this.openInEditor(editor.app, path.join(folder, changed[0])).catch(() => {});
    const files = changed.length ? ` I changed ${changed.slice(0, 4).join(', ')}${changed.length > 4 ? ` and ${changed.length - 4} more` : ''} in ${project} and opened ${changed[0]}.` : '';
    return { status: 'done', reply: `${String(result.reply || 'Done.').trim()}${files}${git ? ' It is all in git, so you can undo it.' : ''}`.trim(), actions: changed.length, model: via.toLowerCase() };
  }
}

// ---- the real pieces (the class above takes them as arguments, so tests use fakes) ----
const execOut = (execFile, bin, args, opts = {}) => new Promise((resolve, reject) => execFile(bin, args, { timeout: 15000, ...opts }, (err, out) => (err ? reject(err) : resolve(String(out)))));

function realDeps({ execFile = require('child_process').execFile, spawn = require('child_process').spawn, claudeCli, codexCli } = {}) {
  const osa = (script) => execOut(execFile, '/usr/bin/osascript', ['-e', script]);
  return {
    frontmost: async () => { const out = (await osa('tell application "System Events" to get {bundle identifier, name} of first application process whose frontmost is true')).trim(); const [bundleId, name] = out.split(/,\s*/); return { bundleId, name }; },
    windowTitle: async (front) => (await osa(`tell application "System Events" to get name of front window of (first application process whose bundle identifier is "${String(front.bundleId).replace(/[^\w.]/g, '')}")`)).trim(),
    readStorage: async (support) => JSON.parse(fs.readFileSync(path.join(os.homedir(), 'Library', 'Application Support', support, 'User', 'globalStorage', 'storage.json'), 'utf8')),
    isGit: async (folder) => { try { return (await execOut(execFile, 'git', ['-C', folder, 'rev-parse', '--is-inside-work-tree'])).trim() === 'true'; } catch { return false; } },
    gitChanged: async (folder) => (await execOut(execFile, 'git', ['-C', folder, 'status', '--porcelain'])).split('\n').map((l) => l.slice(3).trim()).filter(Boolean),
    findClaude: async () => (await claudeCli?.findClaude?.()) || null,
    findCodex: async () => (await codexCli?.findCodex?.()) || null,
    openInEditor: async (app, file) => execOut(execFile, '/usr/bin/open', ['-a', app, file]),
    run: ({ kind, bin, cwd, prompt, signal }) => new Promise((resolve) => {
      const args = kind === 'claude'
        ? ['-p', prompt, '--permission-mode', 'acceptEdits', '--model', 'sonnet', '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)']
        : ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'workspace-write', '-c', 'approval_policy="never"', '-c', 'model_reasoning_effort="medium"', '-C', cwd, prompt];
      const env = { ...process.env }; if (kind === 'codex') { delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY; }
      const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '', done = false;
      const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
      const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* gone */ } finish({ status: 'failed', reply: 'It took longer than 10 minutes.' }); }, 10 * 60 * 1000);
      signal?.addEventListener?.('abort', () => { try { child.kill('SIGTERM'); } catch { /* gone */ } finish({ status: 'stopped', reply: 'Stopped.' }); });
      child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => finish({ status: 'failed', reply: e.message }));
      child.on('exit', (code) => finish(code === 0 ? { status: 'done', reply: out.trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 600) } : { status: 'failed', reply: (err || out).trim().slice(-300) }));
    })
  };
}

module.exports = { CodeAgent, parseCodeCommand, folderFromStorage, editorFor, realDeps, EDITORS };
