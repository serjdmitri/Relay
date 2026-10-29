const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { parseStatus, buildArgs, parseEvent, runCodex, codexEnv, codexStatus, findCodex } = require('../src/main/agent/codexCli');

test('only a ChatGPT sign-in counts, not a key or no login', () => {
  assert.deepEqual(parseStatus('Logged in using ChatGPT').usable, true);
  assert.deepEqual([parseStatus('Logged in using an API key - sk-***').signedIn, parseStatus('Logged in using an API key').usable], [true, false]);
  assert.deepEqual(parseStatus('Not logged in'), { signedIn: false, method: '', usable: false, text: 'Not logged in' });
});

test('status runs `codex login status`, and a missing program is reported', async () => {
  const seen = [];
  const s = await codexStatus('/bin/codex', { execFileFn: (p, args, o, cb) => { seen.push([p, args, 'OPENAI_API_KEY' in o.env]); cb(null, 'Logged in using ChatGPT\n', ''); } });
  assert.deepEqual(seen[0], ['/bin/codex', ['login', 'status'], false]);
  assert.equal(s.usable, true);
  assert.equal((await codexStatus(null)).installed, false);
  assert.equal(await findCodex({ exists: (p) => p === '/opt/homebrew/bin/codex' }), '/opt/homebrew/bin/codex');
  assert.equal(await findCodex({ exists: () => false, shell: async () => '' }).catch(() => null), null);
});

test('Codex is started read-only with Relay as its only tool server, no saved session, no user config, and no API key', () => {
  const a = buildArgs({ port: 5555, outFile: '/tmp/o.txt', cwd: '/tmp/x' });
  assert.deepEqual(a.slice(0, 6), ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules']);
  assert.ok(a.join(' ').includes('-s read-only'));
  assert.ok(a.includes('mcp_servers.relay.url="http://127.0.0.1:5555/mcp"'));
  assert.ok(a.includes('mcp_servers.relay.bearer_token_env_var="RELAY_MCP_TOKEN"'));
  assert.ok(a.includes('approval_policy="never"'));
  assert.ok(a.includes('mcp_servers.relay.default_tools_approval_mode="approve"'));
  assert.equal(a.at(-1), '-');
  process.env.OPENAI_API_KEY = 'sk-test';
  const env = codexEnv({ RELAY_MCP_TOKEN: 't' });
  delete process.env.OPENAI_API_KEY;
  assert.equal(env.OPENAI_API_KEY, undefined, 'the plan is used, not a key');
  assert.equal(env.RELAY_MCP_TOKEN, 't');
});

test('events are read loosely', () => {
  assert.deepEqual(parseEvent('{"type":"item.completed","item":{"type":"agent_message","text":"Done."}}'), { text: 'Done.' });
  assert.deepEqual(parseEvent('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":3}}'), { usage: { in: 10, out: 3 } });
  assert.deepEqual(parseEvent('{"type":"turn.failed","error":{"message":"hit your usage limit"}}'), { error: 'hit your usage limit' });
  assert.deepEqual(parseEvent('{"type":"error","message":"boom"}'), { error: 'boom' });
  assert.deepEqual(parseEvent('{"type":"thread.started"}'), {});
  assert.equal(parseEvent('not json'), null);
  assert.deepEqual(parseEvent('{"type":"item.completed","item":{"type":"file_change"}}'), { fileChange: true });
});

// A fake `codex`: records how it was started, prints events, and writes the -o file like the real one.
function fakeSpawn({ events = [], out = null, code = 0, stderr = '', hang = false } = {}) {
  const calls = [];
  const fn = (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    let prompt = '';
    child.stdin = { on() {}, end(p) { prompt = p; calls.push({ bin, args, env: opts.env, prompt }); if (hang) return; setImmediate(() => { for (const e of events) child.stdout.emit('data', `${JSON.stringify(e)}\n`); if (stderr) child.stderr.emit('data', stderr); if (out != null) fs.writeFileSync(args[args.indexOf('-o') + 1], out); child.emit('exit', code); }); } };
    child.kill = () => { calls.push('killed'); };
    return child;
  };
  return { fn, calls };
}
const host = { port: 4242, token: 'tok', run: null };

test('a request is sent on stdin with the rules and the tools, and the answer comes back', async () => {
  const f = fakeSpawn({ events: [{ type: 'item.completed', item: { type: 'agent_message', text: 'Opened Notes.' } }, { type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 2 } }], out: 'Opened Notes.\n' });
  const seen = [];
  const r = await runCodex({ codexPath: '/bin/codex', host, system: 'You are Relay.', text: 'Request: open notes', tools: [{ name: 'open_app' }], onEvent: (e) => seen.push(e), spawnFn: f.fn });
  assert.equal(r.status, 'done');
  assert.equal(r.reply, 'Opened Notes.');
  assert.deepEqual(r.usage, { in: 5, out: 2, model: 'codex' });
  assert.match(f.calls[0].prompt, /^You are Relay\.\n\nUse only the "relay" tools[^]*Request: open notes$/);
  assert.equal(f.calls[0].env.RELAY_MCP_TOKEN, 'tok');
  assert.ok(f.calls[0].args.includes('mcp_servers.relay.url="http://127.0.0.1:4242/mcp"'));
  assert.deepEqual(seen, [{ type: 'text-delta', text: 'Opened Notes.' }]);
  assert.equal(host.run, null, 'the tool server is released');
});

test('a usage limit, a missing login, a crash, a file change, a timeout and a stop are each reported', async () => {
  const lim = await runCodex({ codexPath: 'c', host, text: 't', tools: [], spawnFn: fakeSpawn({ events: [{ type: 'turn.failed', error: { message: "You've hit your usage limit. Try again at 4:10 PM." } }], code: 1 }).fn });
  assert.deepEqual([lim.status, lim.limit], ['failed', true]);
  assert.match(lim.resetText, /4:10 PM/);
  const login = await runCodex({ codexPath: 'c', host, text: 't', tools: [], spawnFn: fakeSpawn({ stderr: 'Error: not logged in', code: 1 }).fn });
  assert.match(login.reply, /not signed in to Codex/);
  const crash = await runCodex({ codexPath: 'c', host, text: 't', tools: [], spawnFn: fakeSpawn({ code: 2 }).fn });
  assert.match(crash.reply, /Codex stopped \(code 2\)/);
  const fc = fakeSpawn({ events: [{ type: 'item.completed', item: { type: 'file_change' } }], hang: true });
  const bad = await runCodex({ codexPath: 'c', host, text: 't', tools: [], spawnFn: (...a) => { const c = fc.fn(...a); setImmediate(() => c.stdout.emit('data', '{"type":"item.completed","item":{"type":"file_change"}}\n')); return c; } });
  assert.match(bad.reply, /does not allow/);
  const slow = await runCodex({ codexPath: 'c', host, text: 't', tools: [], timeoutMs: 20, spawnFn: fakeSpawn({ hang: true }).fn });
  assert.match(slow.reply, /took too long/);
  const ac = new AbortController();
  const p = runCodex({ codexPath: 'c', host, text: 't', tools: [], signal: ac.signal, spawnFn: fakeSpawn({ hang: true }).fn });
  setImmediate(() => ac.abort());
  assert.equal((await p).status, 'stopped');
});

test('fast mode asks Codex for little reasoning', () => {
  const { buildArgs } = require('../src/main/agent/codexCli');
  const base = { port: 1, outFile: '/o', cwd: '/c' };
  assert.ok(buildArgs({ ...base, fast: true }).includes('model_reasoning_effort="low"'));
  assert.ok(!buildArgs(base).join(' ').includes('model_reasoning_effort'));
});
