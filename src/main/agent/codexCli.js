// "Sign in with ChatGPT": Relay runs the user's own Codex command-line program (`codex`), already signed in to their ChatGPT account, so the plan is used and no API key is.
// It is the backup for Claude: when Claude runs out of usage, requests go here (see failover.js) and the same Relay tools are offered to Codex through the same small
// tool server (McpHost) that Claude uses. Relay never reads or stores Codex's login; Codex keeps it.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { isLimitText } = require('../failover');

const HOME = os.homedir();
const CANDIDATES = [`${HOME}/.local/bin/codex`, '/opt/homebrew/bin/codex', '/usr/local/bin/codex', `${HOME}/.npm-global/bin/codex`, `${HOME}/.bun/bin/codex`, `${HOME}/.codex/bin/codex`];

let cachedPath = null;

// Finds the program. A GUI app does not inherit the shell PATH, so also ask a login shell.
async function findCodex({ exists = fs.existsSync, shell = defaultShellLookup } = {}) {
  if (cachedPath && exists(cachedPath)) return cachedPath;
  for (const c of CANDIDATES) if (exists(c)) return (cachedPath = c);
  const found = await shell().catch(() => '');
  if (found && exists(found)) return (cachedPath = found);
  return null;
}

function defaultShellLookup() {
  return new Promise((resolve, reject) => {
    execFile(process.env.SHELL || '/bin/zsh', ['-lc', 'command -v codex'], { timeout: 4000 }, (err, out) => (err ? reject(err) : resolve(String(out).trim().split('\n').pop())));
  });
}

function codexEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  // A key in the environment would make Codex bill the API instead of using the ChatGPT sign-in.
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  env.PATH = `${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${env.PATH || '/usr/bin:/bin'}`;
  return env;
}

// `codex login status` says "Logged in using ChatGPT" or "Logged in using an API key" or "Not logged in". Only the ChatGPT sign-in counts: that is the plan.
function parseStatus(text) {
  const t = String(text || '');
  const signedIn = /logged in/i.test(t) && !/not logged in/i.test(t);
  const method = /chatgpt/i.test(t) ? 'chatgpt' : /api key/i.test(t) ? 'apikey' : '';
  return { signedIn, method, usable: signedIn && method === 'chatgpt', text: t.trim().slice(0, 200) };
}

function codexStatus(codexPath, { execFileFn = execFile } = {}) {
  return new Promise((resolve) => {
    if (!codexPath) return resolve({ installed: false, signedIn: false, usable: false, method: '' });
    execFileFn(codexPath, ['login', 'status'], { timeout: 10000, env: codexEnv() }, (err, out, errOut) => {
      resolve({ installed: true, ...parseStatus(`${out || ''}\n${errOut || ''}`) });
    });
  });
}

// Opens the browser sign-in. Resolves when the program exits.
function codexLogin(codexPath, { spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    const child = spawnFn(codexPath, ['login'], { env: codexEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (out += d));
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('exit', (code) => resolve({ ok: code === 0, error: code === 0 ? '' : out.trim().slice(-300) }));
    codexLogin.current = child;
  });
}

function codexLogout(codexPath) {
  return new Promise((resolve) => execFile(codexPath, ['logout'], { timeout: 15000, env: codexEnv() }, (err) => resolve({ ok: !err })));
}

// ---- running one request ----

// Codex gets Relay's tools as an MCP server. Its own file tools are held to a read-only sandbox, nothing is remembered, and the user's own Codex config is left out.
function buildArgs({ port, outFile, cwd }) {
  return [
    'exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
    '-s', 'read-only', '-C', cwd,
    '-c', 'approval_policy="never"',
    '-c', `mcp_servers.relay.url="http://127.0.0.1:${port}/mcp"`,
    '-c', 'mcp_servers.relay.bearer_token_env_var="RELAY_MCP_TOKEN"',
    '-o', outFile,
    '-' // the request comes on stdin
  ];
}

const RULES = 'Use only the "relay" tools to act on the Mac and the web. Do not run shell commands, edit files or write code unless a relay tool is for that. Answer briefly, in plain sentences, as a spoken reply.';

// One line of `codex exec --json` -> what matters. The shape is read loosely so a newer version still works.
function parseEvent(line) {
  let ev;
  try { ev = JSON.parse(line); } catch { return null; }
  const item = ev.item || {};
  if ((ev.type === 'item.completed' || ev.type === 'item.updated') && /agent_message|assistant_message/.test(item.type || '') && item.text) return { text: String(item.text) };
  if (ev.type === 'item.completed' && /file_change/.test(item.type || '')) return { fileChange: true };
  if (ev.type === 'turn.completed') return { usage: { in: ev.usage?.input_tokens || 0, out: ev.usage?.output_tokens || 0 } };
  if (ev.type === 'turn.failed') return { error: ev.error?.message || 'Codex failed.' };
  if (ev.type === 'error') return { error: ev.message || 'Codex failed.' };
  return {};
}

// host: an McpHost (its own, started). run: { tools, confirm, onEvent, signal }. Returns { status, reply, actions, usage, limit }.
async function runCodex({ codexPath, host, system = '', text, tools, confirm, onEvent = () => {}, signal, spawnFn = spawn, timeoutMs = 5 * 60 * 1000, tmpDir = os.tmpdir() }) {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'relay-codex-'));
  const outFile = path.join(dir, 'last.txt');
  const counter = { actions: 0 };
  host.run = { tools, confirm: confirm || (async () => false), onEvent, signal, counter };
  const prompt = `${system ? `${system}\n\n` : ''}${RULES}\n\n${text}`;
  return new Promise((resolve) => {
    let settled = false, last = '', usage = { in: 0, out: 0, model: 'codex' }, error = '', buf = '', errText = '';
    const child = spawnFn(codexPath, buildArgs({ port: host.port, outFile, cwd: dir }), { cwd: dir, env: codexEnv({ RELAY_MCP_TOKEN: host.token }), stdio: ['pipe', 'pipe', 'pipe'] });
    const done = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      host.run = null;
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp folder */ }
      resolve({ actions: counter.actions, usage, ...res });
    };
    const onAbort = () => done({ status: 'stopped', reply: 'Stopped.' });
    const timer = setTimeout(() => done({ status: 'failed', reply: 'Codex took too long and I stopped waiting.' }), timeoutMs);
    if (signal) { if (signal.aborted) return done({ status: 'stopped', reply: 'Stopped.' }); signal.addEventListener('abort', onAbort); }
    const line = (l) => {
      const e = parseEvent(l);
      if (!e) return;
      if (e.text) { last = e.text; onEvent({ type: 'text-delta', text: last }); }
      if (e.usage) { usage = { ...usage, ...e.usage }; }
      if (e.error) error = e.error;
      if (e.fileChange) { error = 'Codex tried to change files, which Relay does not allow.'; done({ status: 'failed', reply: error }); }
    };
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    child.stderr.on('data', (d) => { errText += d; });
    child.stdin.on('error', () => {});
    child.on('error', (e) => done({ status: 'failed', reply: `Could not start Codex: ${e.message}` }));
    child.on('exit', (code) => {
      if (buf.trim()) line(buf);
      let reply = '';
      try { reply = fs.readFileSync(outFile, 'utf8').trim(); } catch { /* not written */ }
      reply = reply || last;
      if (reply && !(code && error)) return done({ status: 'done', reply });
      const msg = error || errText.trim().split('\n').slice(-2).join(' ') || `Codex stopped (code ${code}).`;
      done({ status: 'failed', reply: /not logged in|login/i.test(msg) ? 'Relay is not signed in to Codex. Open Account and sign in with ChatGPT.' : msg, limit: isLimitText(msg), resetText: msg });
    });
    child.stdin.end(prompt);
  });
}

module.exports = { findCodex, codexEnv, codexStatus, codexLogin, codexLogout, parseStatus, buildArgs, parseEvent, runCodex, RULES };
