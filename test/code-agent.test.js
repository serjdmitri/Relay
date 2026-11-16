const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CodeAgent, parseCodeCommand, folderFromStorage, editorFor } = require('../src/main/codeAgent');

test('"code me ..." and a request that names the editor are code requests; ordinary requests are not', () => {
  assert.equal(parseCodeCommand('code me a login form with email and password').task, 'a login form with email and password');
  assert.equal(parseCodeCommand('Jarvis, code this: a function that sorts users by age').task, 'a function that sorts users by age');
  assert.equal(parseCodeCommand('can you write code that reads a csv file').task, 'reads a csv file');
  assert.equal(parseCodeCommand('vibe code a snake game').task, 'a snake game');
  assert.equal(parseCodeCommand('add a dark mode toggle to my project').task, 'add a dark mode toggle');
  assert.equal(parseCodeCommand('fix the failing test in VS Code').task, 'fix the failing test');
  assert.equal(parseCodeCommand('in Cursor, rename the helper function to parseDate').task, 'rename the helper function to parseDate');
  for (const no of ['write an email to my coach', 'add milk to my list', 'what is the code for Florida', 'call me', 'code', 'open VS Code', 'code red', 'make me a coffee', 'write the code']) assert.equal(parseCodeCommand(no), null, no);
});

test('the open project comes from the window title first, then the editor\'s last active window, and only if the folder exists', () => {
  const storage = { windowsState: { lastActiveWindow: { folder: 'file:///Users/me/work/alpha' }, openedWindows: [{ folder: 'file:///Users/me/work/beta' }] }, profileAssociations: { workspaces: { 'file:///Users/me/work/gamma': 'x' } } };
  const exists = (p) => ['/Users/me/work/alpha', '/Users/me/work/beta', '/Users/me/work/gamma'].includes(p);
  assert.equal(folderFromStorage(storage, 'app.js — beta — Visual Studio Code', exists), '/Users/me/work/beta');
  assert.equal(folderFromStorage(storage, 'notes.md - gamma - Cursor', exists), '/Users/me/work/gamma');
  assert.equal(folderFromStorage(storage, 'Untitled-1 — Visual Studio Code', exists), '/Users/me/work/alpha');
  assert.equal(folderFromStorage(storage, '', () => false), null, 'a folder that is gone is not used');
  assert.equal(folderFromStorage(null, 'x', exists), null);
  assert.equal(editorFor('com.microsoft.VSCode').name, 'VS Code'); assert.equal(editorFor('com.apple.Safari'), null);
});

function make(over = {}) {
  const log = { runs: [], opened: [], confirms: [], pushes: [] };
  let changed = [];
  const deps = {
    frontmost: async () => ({ bundleId: 'com.microsoft.VSCode', name: 'Code' }), windowTitle: async () => 'app.js — alpha — Visual Studio Code',
    readStorage: async () => ({ windowsState: { lastActiveWindow: { folder: 'file:///Users/me/work/alpha' } } }), exists: () => true,
    isGit: async () => true, gitChanged: async () => changed.slice(), findClaude: async () => '/bin/claude', findCodex: async () => '/bin/codex',
    run: async (r) => { log.runs.push(r); if (over.runs) return over.runs.shift()(r, (f) => { changed = f; }); changed = ['src/login.js', 'src/login.css']; return { status: 'done', reply: 'I added a login form.' }; },
    openInEditor: async (app, file) => { log.opened.push([app, file]); }, isLimit: (t) => /usage limit/i.test(t), confirm: async (q) => { log.confirms.push(q.question); return over.yes !== false; }, push: (l) => log.pushes.push(l.label),
    ...over.deps
  };
  return { agent: new CodeAgent(deps), log };
}

test('in a git project it runs Claude in that folder, then opens the first changed file and says what changed', async () => {
  const { agent, log } = make();
  const r = await agent.code('a login form');
  assert.equal(r.status, 'done');
  assert.equal(log.runs.length, 1); assert.equal(log.runs[0].kind, 'claude'); assert.equal(log.runs[0].cwd, '/Users/me/work/alpha'); assert.match(log.runs[0].prompt, /The request: a login form/);
  assert.deepEqual(log.opened, [['Visual Studio Code', path.join('/Users/me/work/alpha', 'src/login.js')]]);
  assert.match(r.reply, /I added a login form\./); assert.match(r.reply, /src\/login\.js, src\/login\.css/); assert.match(r.reply, /undo/);
  assert.equal(log.confirms.length, 0, 'a git project needs no question');
  assert.deepEqual(log.pushes, ['Coding in VS Code with Claude']);
});

test('only the files this run changed are named, not ones that were already changed', async () => {
  let n = 0;
  const { agent } = make({ deps: { gitChanged: async () => (n++ === 0 ? ['old.txt'] : ['old.txt', 'new.js']) } });
  const r = await agent.code('x');
  assert.match(r.reply, /new\.js/); assert.doesNotMatch(r.reply, /old\.txt/);
});

test('a folder without git is only changed after a yes, and a no changes nothing', async () => {
  const no = make({ yes: false, deps: { isGit: async () => false } });
  const r1 = await no.agent.code('x'); assert.equal(r1.status, 'stopped'); assert.equal(no.log.runs.length, 0); assert.match(no.log.confirms[0], /not under git/);
  const yes = make({ deps: { isGit: async () => false } });
  const r2 = await yes.agent.code('x'); assert.equal(r2.status, 'done'); assert.equal(yes.log.runs.length, 1); assert.doesNotMatch(r2.reply, /undo/);
});

test('Claude out of usage hands the same request to Codex; with neither, it says so', async () => {
  const limit = make({ runs: [async () => ({ status: 'failed', reply: 'Claude usage limit reached' }), async (r, set) => { set(['a.js']); return { status: 'done', reply: 'Done with Codex.' }; }] });
  const r = await limit.agent.code('x');
  assert.equal(r.status, 'done'); assert.deepEqual(limit.log.runs.map((x) => x.kind), ['claude', 'codex']); assert.deepEqual(limit.log.pushes, ['Coding in VS Code with Claude', 'Coding in VS Code with Codex']);
  const none = make({ runs: [async () => ({ status: 'failed', reply: 'usage limit' })], deps: { findCodex: async () => null } });
  assert.match((await none.agent.code('x')).reply, /out of usage and Codex is not signed in/);
  const nothing = make({ deps: { findClaude: async () => null, findCodex: async () => null } });
  assert.match((await nothing.agent.code('x')).reply, /Neither Claude nor Codex/);
  const other = make({ runs: [async () => ({ status: 'failed', reply: 'some other error' })] });
  const o = await other.agent.code('x'); assert.equal(o.status, 'failed'); assert.equal(other.log.runs.length, 1, 'an ordinary failure is not retried on Codex');
});

test('it says what to do when no editor is in front or the open folder cannot be found', async () => {
  const safari = make({ deps: { frontmost: async () => ({ bundleId: 'com.apple.Safari', name: 'Safari' }) } });
  const a = await safari.agent.code('x'); assert.equal(a.status, 'failed'); assert.match(a.reply, /VS Code or Cursor/); assert.equal(safari.log.runs.length, 0);
  const nofolder = make({ deps: { readStorage: async () => ({ windowsState: {} }) } });
  const b = await nofolder.agent.code('x'); assert.match(b.reply, /cannot tell which folder/); assert.equal(nofolder.log.runs.length, 0);
});

test('Claude is held to reading and editing in the project, Codex to a workspace sandbox, and the wiring is in place', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/main/codeAgent.js'), 'utf8');
  assert.match(src, /'--permission-mode', 'acceptEdits', '--model', 'sonnet', '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash\(git status:\*\)'/);
  assert.doesNotMatch(src, /'Bash'\s*[,\]]/, 'no open shell');
  assert.match(src, /'--sandbox', 'workspace-write'/);
  assert.match(src, /delete env\.OPENAI_API_KEY; delete env\.CODEX_API_KEY/, 'Codex uses the ChatGPT plan, not a key');
  assert.match(fs.readFileSync(path.join(__dirname, '../src/main/askController.js'), 'utf8'), /parseCodeCommand\(effective\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8'), /ask\.onCodeCommand = async \(cmd\) =>/);
});
