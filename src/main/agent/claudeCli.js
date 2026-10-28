// "Sign in with Claude": Relay runs the user's own Claude Code CLI (`claude`) that is already
// signed in to their Claude account, so no API key or Ollama is needed.
//
// The CLI runs the agent loop. Relay's Mac tools reach it through a small MCP server on
// 127.0.0.1 (random port, bearer token). The confirm gate lives in the tool handler, so
// anything that sends, deletes or runs a command still asks first.

const http = require('http');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { callTool } = require('./loop');
const categories = require('./toolCategories');
const { isLimitText } = require('../failover');

const HOME = os.homedir();
const CANDIDATES = [
  `${HOME}/.local/bin/claude`,
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  `${HOME}/.claude/local/claude`,
  `${HOME}/.npm-global/bin/claude`,
  `${HOME}/.bun/bin/claude`
];

let cachedPath = null;

// Finds the CLI. A GUI app does not inherit the shell PATH, so also ask a login shell.
async function findClaude({ exists = fs.existsSync, shell = defaultShellLookup } = {}) {
  if (cachedPath && exists(cachedPath)) return cachedPath;
  for (const c of CANDIDATES) {
    if (exists(c)) return (cachedPath = c);
  }
  const found = await shell().catch(() => '');
  if (found && exists(found)) return (cachedPath = found);
  return null;
}

function defaultShellLookup() {
  return new Promise((resolve, reject) => {
    execFile(process.env.SHELL || '/bin/zsh', ['-lc', 'command -v claude'], { timeout: 4000 }, (err, out) => (err ? reject(err) : resolve(String(out).trim().split('\n').pop())));
  });
}

function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  // An API key in the environment would make the CLI bill the API instead of using the sign-in.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.PATH = `${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${env.PATH || '/usr/bin:/bin'}`;
  return env;
}

function authStatus(claudePath, { execFileFn = execFile } = {}) {
  return new Promise((resolve) => {
    if (!claudePath) return resolve({ installed: false, loggedIn: false });
    execFileFn(claudePath, ['auth', 'status', '--json'], { timeout: 10000, env: childEnv() }, (err, out) => {
      if (err && !out) return resolve({ installed: true, loggedIn: false, error: err.message });
      try {
        const j = JSON.parse(String(out));
        resolve({ installed: true, loggedIn: !!j.loggedIn, email: j.email || '', plan: j.subscriptionType || '', method: j.authMethod || '', org: j.orgName || '' });
      } catch {
        resolve({ installed: true, loggedIn: false });
      }
    });
  });
}

// Opens the browser sign-in flow. Resolves when the CLI exits.
function login(claudePath, { spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    const child = spawnFn(claudePath, ['auth', 'login', '--claudeai'], { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (out += d));
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('exit', (code) => resolve({ ok: code === 0, error: code === 0 ? '' : out.trim().slice(-300) }));
    login.current = child;
  });
}

function logout(claudePath) {
  return new Promise((resolve) => {
    execFile(claudePath, ['auth', 'logout'], { timeout: 15000, env: childEnv() }, (err) => resolve({ ok: !err }));
  });
}

// ---------- MCP server ----------

const PROTOCOL = '2025-06-18';

function toMcpContent(blocks) {
  return (blocks || []).map((b) => (b.type === 'image' ? { type: 'image', data: b.source.data, mimeType: b.source.media_type } : { type: 'text', text: String(b.text ?? '') }));
}

// Pure JSON-RPC handler, so it can be tested without a socket.
async function handleRpc(msg, run) {
  const ok = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  if (msg.id === undefined || msg.id === null) return null; // notification
  switch (msg.method) {
    case 'initialize':
      return ok({ protocolVersion: msg.params?.protocolVersion || PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'relay', version: '1' } });
    case 'ping':
      return ok({});
    case 'tools/list': {
      const all = run?.tools || [];
      const shown = run?.exposed ? all.filter((t) => run.exposed.has(t.name)) : all; // fewer tools: the rest are reached through load_more_tools
      return ok({ tools: [...shown.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })), ...(run?.exposed ? categories.loaderDefs(all, run.exposed) : [])] });
    }
    case 'tools/call': {
      if (!run) return err(-32000, 'No request is running.');
      let { name, arguments: args } = msg.params || {};
      if (run.exposed && name === 'load_more_tools') return ok({ content: [{ type: 'text', text: categories.loadMore(run, args?.group) }] });
      if (run.exposed && name === 'use_tool') { name = String(args?.name || ''); args = args?.input || {}; } // the real tool runs, with its own confirmation
      const tool = run.tools.find((t) => t.name === name);
      const out = await callTool({ tool, name, input: args || {}, confirm: run.confirm, onEvent: run.onEvent, signal: run.signal });
      if (out.aborted) return ok({ content: [{ type: 'text', text: 'Stopped by the user.' }], isError: true });
      if (out.ran) run.counter.actions++;
      return ok({ content: toMcpContent(out.content), isError: !!out.isError });
    }
    default:
      return err(-32601, `Method not found: ${msg.method}`);
  }
}

class McpHost {
  constructor() {
    this.token = crypto.randomBytes(24).toString('hex');
    this.run = null;
    this.port = 0;
    this.server = null;
  }

  async start() {
    if (this.server) return this.port;
    this.server = http.createServer((req, res) => this._onRequest(req, res));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    this.port = this.server.address().port;
    return this.port;
  }

  stop() {
    this.server?.close();
    this.server = null;
  }

  config() {
    return { mcpServers: { relay: { type: 'http', url: `http://127.0.0.1:${this.port}/mcp`, headers: { Authorization: `Bearer ${this.token}` } } } };
  }

  _onRequest(req, res) {
    const deny = (code) => {
      req.resume();
      res.writeHead(code, { connection: 'close' });
      res.end();
    };
    // Only the local CLI, with the token, may call tools. The Host check blocks DNS rebinding from web pages.
    if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) return deny(403);
    const auth = Buffer.from(req.headers.authorization || '');
    const want = Buffer.from(`Bearer ${this.token}`);
    if (auth.length !== want.length || !crypto.timingSafeEqual(auth, want)) return deny(401);
    if (req.method !== 'POST') return deny(405);
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 5e6) req.destroy();
    });
    req.on('end', async () => {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        return deny(400);
      }
      try {
        const out = await handleRpc(msg, this.run);
        if (!out) return deny(202);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } }));
      }
    });
  }
}

// ---------- running requests ----------

function buildArgs({ model, system, config }) {
  return [
    '-p',
    '--input-format', 'stream-json', // stays open: messages and model changes arrive later, so it can start before you finish talking
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages', // the answer arrives in pieces, so long ones can be shown as they are written
    '--mcp-config', JSON.stringify(config),
    '--strict-mcp-config',
    '--tools', '', // none of Claude Code's own tools: Relay's Mac tools only
    '--allowedTools', 'mcp__relay__*',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--setting-sources', '', // no user hooks, memory files or project settings
    '--model', model || 'haiku',
    '--system-prompt', system
  ];
}

const FINAL_GRACE_MS = 250;
const AUTH_RE = /invalid api key|please run \/login|not logged in|authentication|oauth|credit balance|401/i;

function friendlyError(text) {
  if (AUTH_RE.test(text || '')) return 'Relay is not signed in to Claude. Open Account and sign in.';
  return text || 'Claude did not answer.';
}

// One Claude process, started early and reused for a whole request: start it while you are still talking,
// send the request when it is ready, switch model on the fly, and keep the conversation if it has to move up.
class ClaudeSession {
  constructor({ claudePath, host, system, tools, model = 'haiku', spawnFn = spawn, timeoutMs = 5 * 60 * 1000 }) {
    this.host = host;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.run = { tools, exposed: tools.exposed || null, confirm: async () => false, onEvent: () => {}, signal: undefined, counter: { actions: 0 } };
    host.run = this.run;
    this.turn = null;
    this.turns = 0; // requests answered so far: a session with turns remembers the conversation
    this.costQueue = []; // one callback per request, called when its result (with the cost) arrives, which can be after the answer
    this.rate = null; // the latest plan limit report from the CLI
    this.onRate = null;
    this.stale = 0; // results still to come from turns that were answered early or stopped
    this.dead = false;
    this.exitMessage = '';
    this.controls = new Map();
    this.seq = 0;
    this.buf = '';
    this.stderr = '';
    this.startedAt = Date.now();
    const child = spawnFn(claudePath, buildArgs({ model, system, config: host.config() }), { cwd: os.tmpdir(), env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout.on('data', (d) => this._onData(d.toString()));
    child.stderr.on('data', (d) => (this.stderr += d));
    child.stdin.on('error', () => {});
    child.on('error', (e) => this._died(`Could not start Claude: ${e.message}`));
    child.on('exit', (code) => this._died(friendlyError(this.stderr.trim().slice(-300)) || `Claude stopped (code ${code}).`));
  }

  get alive() {
    return !this.dead;
  }

  _died(message) {
    if (this.dead) return;
    this.dead = true;
    this.exitMessage = message;
    for (const cb of this.controls.values()) cb(false);
    this.controls.clear();
    this._finish({ status: 'failed', reply: message, fatal: true }, { viaResult: true });
  }

  write(obj) {
    if (this.dead) return;
    try {
      this.child.stdin.write(JSON.stringify(obj) + '\n');
    } catch {}
  }

  control(request) {
    return new Promise((resolve) => {
      const id = `c${++this.seq}`;
      const timer = setTimeout(() => {
        this.controls.delete(id);
        resolve(false);
      }, 3000);
      this.controls.set(id, (ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
      this.write({ type: 'control_request', request_id: id, request });
    });
  }

  async setModel(model) {
    if (model === this.model) return;
    await this.control({ subtype: 'set_model', model });
    this.model = model;
  }

  interrupt() {
    this.write({ type: 'control_request', request_id: `i${++this.seq}`, request: { subtype: 'interrupt' } });
  }

  // Sends one message and resolves with { status, reply, actions, toolCalls, toolErrors, interrupted }.
  // watch(stats) may return true to interrupt a run that is going nowhere.
  async ask(text, { model, confirm, onEvent = () => {}, signal, watch, onCost } = {}) {
    if (this.dead) throw new Error(this.exitMessage || 'Claude is not running.');
    if (this.turn) throw new Error('Claude is already busy with a request.');
    if (model) await this.setModel(model);
    this.host.run = this.run; // the tool server must serve this conversation
    this.turns++;
    return new Promise((resolve) => {
      const stats = { toolCalls: 0, toolErrors: 0 };
      this.costQueue.push(onCost || null);
      this._acc = '';
      const turn = { resolve, stats, usage: { in: 0, out: 0, model: '' }, settled: false, interrupted: false, finalTimer: null, timer: null, onAbort: null, signal };
      this.turn = turn;
      this.run.confirm = confirm || (async () => false);
      this.run.counter = { actions: 0 };
      this.run.signal = signal;
      this.run.onEvent = (e) => {
        if (e.type === 'tool') {
          stats.toolCalls++;
          if (!e.ok && e.result !== 'declined') stats.toolErrors++;
        }
        onEvent(e);
        if (!turn.settled && !turn.interrupted && watch?.(stats)) {
          turn.interrupted = true;
          this.interrupt();
        }
      };
      this._onThought = (t) => onEvent({ type: 'thought', text: t });
      this._onDelta = (t) => onEvent({ type: 'text-delta', text: t });
      turn.timer = setTimeout(() => this._finish({ status: 'failed', reply: 'Claude took too long and I stopped waiting.' }), this.timeoutMs);
      if (signal) {
        if (signal.aborted) return this._finish({ status: 'stopped', reply: 'Stopped.' });
        turn.onAbort = () => {
          this.interrupt();
          this._finish({ status: 'stopped', reply: 'Stopped.' });
        };
        signal.addEventListener('abort', turn.onAbort);
      }
      this.write({ type: 'user', message: { role: 'user', content: text } });
    });
  }

  _finish(res, { viaResult = false } = {}) {
    const t = this.turn;
    if (!t || t.settled) return;
    t.settled = true;
    clearTimeout(t.timer);
    clearTimeout(t.finalTimer);
    t.signal?.removeEventListener?.('abort', t.onAbort);
    this.turn = null;
    if (!viaResult) this.stale++; // the CLI will still report a result for this turn: ignore it later
    t.resolve({ usage: t.usage, actions: this.run.counter.actions, toolCalls: t.stats.toolCalls, toolErrors: t.stats.toolErrors, interrupted: t.interrupted, ...res });
  }

  _onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      try {
        this._onEvent(JSON.parse(line));
      } catch {}
    }
  }

  _onEvent(ev) {
    const t = this.turn;
    if (ev.type === 'control_response') {
      const id = ev.response?.request_id;
      const cb = this.controls.get(id);
      if (cb) {
        this.controls.delete(id);
        cb(ev.response?.subtype === 'success');
      }
    } else if (ev.type === 'system' && ev.subtype === 'init') {
      const relay = (ev.mcp_servers || []).find((s) => s.name === 'relay');
      if (relay && relay.status !== 'connected') this._finish({ status: 'failed', fatal: true, reply: "Claude could not reach Relay's tools. Quit and reopen Relay." });
    } else if (ev.type === 'stream_event') {
      const e = ev.event || {};
      if (e.type === 'message_start') this._acc = '';
      else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && t && !t.interrupted) {
        this._acc = (this._acc || '') + e.delta.text;
        this._onDelta?.(this._acc);
      }
    } else if (ev.type === 'rate_limit_event') {
      const r = ev.rate_limit_info || {};
      this.rate = { type: r.rateLimitType, util: r.utilization, resetsAt: r.resetsAt, status: r.status, ts: Date.now() };
      this.onRate?.(this.rate);
    } else if (ev.type === 'assistant' && t && !t.interrupted) {
      const u = ev.message?.usage;
      if (u) {
        t.usage.in += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        t.usage.out += u.output_tokens || 0;
      }
      if (ev.message?.model) t.usage.model = ev.message.model;
      const blocks = ev.message?.content || [];
      const text = blocks.filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
      if (blocks.some((c) => c.type === 'tool_use')) {
        clearTimeout(t.finalTimer);
      } else if (text) {
        // A text-only message is the final answer unless a tool call follows within a moment.
        // Taking it now skips the CLI's closing summary step, which costs over a second.
        this._onThought?.(text);
        clearTimeout(t.finalTimer);
        t.finalTimer = setTimeout(() => this._finish({ status: 'done', reply: text }), FINAL_GRACE_MS);
      }
    } else if (ev.type === 'result') {
      const costCb = this.costQueue.shift();
      if (costCb && typeof ev.total_cost_usd === 'number') costCb({ cost: ev.total_cost_usd, ms: ev.duration_ms });
      if (this.stale > 0) {
        this.stale--;
        return;
      }
      if (!t) return;
      clearTimeout(t.finalTimer);
      if (t.interrupted) return this._finish({ status: 'interrupted', reply: '' }, { viaResult: true });
      if (ev.is_error) {
        const msg = ev.result || (ev.errors || []).join(' ');
        const auth = AUTH_RE.test(msg || '');
        this._finish({ status: 'failed', reply: friendlyError(msg), fatal: auth }, { viaResult: true });
      } else {
        this._finish({ status: 'done', reply: String(ev.result || 'Done.').trim() }, { viaResult: true });
      }
    }
  }

  close() {
    if (this.host.run === this.run) this.host.run = null;
    this._finish({ status: 'stopped', reply: 'Stopped.' }, { viaResult: true });
    this.dead = true;
    try {
      this.child.kill('SIGTERM');
    } catch {}
  }
}

// One request on a fresh process. Used for the connection test and in tests.
async function runClaude({ text, system, tools, confirm, onEvent, signal, model, host, claudePath, spawnFn, timeoutMs }) {
  const session = new ClaudeSession({ claudePath, host, system, tools, model: model || 'sonnet', spawnFn, timeoutMs });
  try {
    return await session.ask(text, { confirm, onEvent, signal });
  } finally {
    session.close();
  }
}

const GIVE_UP = /\b(can't|cannot|can not|couldn't|could not|unable to|not able to|wasn't able|isn't possible|don't have (?:a |the )?(?:way|tool|ability|access))\b/i;

// Why a request that started on the fast model should move up to the stronger one, or null to keep the answer.
function escalationReason(r) {
  if (!r || r.status === 'stopped' || r.fatal) return null;
  if (r.interrupted) return 'it was going in circles';
  if (r.status === 'failed' && isLimitText(r.reply)) return null; // out of usage: a stronger model would be out too
  if (r.status === 'failed') return r.reply || 'it hit an error';
  if (r.toolErrors >= 2) return 'its tool calls kept failing';
  if (r.status === 'done' && GIVE_UP.test(r.reply || '') && (r.toolErrors > 0 || r.actions === 0)) return `it said: "${r.reply}"`;
  return null;
}

const flailing = (stats) => stats.toolCalls > 8 || stats.toolErrors >= 3;

// Runs a request on the model the router picked. When it starts on the fast model and struggles, the same
// conversation (so nothing already done is repeated) is handed to Sonnet. escalate=false keeps one model.
async function runSmart({ session, text, context = '', model, escalate = false, confirm, onEvent = () => {}, signal, onCost }) {
  const prompt = context ? `${context}\n\nRequest: ${text}` : text;
  const first = await session.ask(prompt, { model, confirm, onEvent, signal, onCost, watch: escalate ? flailing : undefined });
  const reason = escalate ? escalationReason(first) : null;
  if (!reason || signal?.aborted || !session.alive) return { ...first, model, escalated: false };
  onEvent({ type: 'escalate', reason });
  const second = await session.ask(
    `The faster assistant did not manage this: ${reason}. Carry on from where things stand now, using what has already been done (do not repeat completed actions), and finish the original request: ${text}`,
    { model: 'sonnet', confirm, onEvent, signal, onCost }
  );
  return { ...second, usage: { in: (first.usage?.in || 0) + (second.usage?.in || 0), out: (first.usage?.out || 0) + (second.usage?.out || 0), model: second.usage?.model || first.usage?.model || '' }, actions: first.actions + second.actions, toolCalls: first.toolCalls + second.toolCalls, model: 'sonnet', escalated: true };
}

module.exports = { findClaude, authStatus, login, logout, McpHost, ClaudeSession, handleRpc, buildArgs, runClaude, runSmart, escalationReason, toMcpContent, friendlyError };
