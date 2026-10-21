const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { McpHost, handleRpc, buildArgs, runClaude, toMcpContent, friendlyError } = require('../src/main/agent/claudeCli');

const echo = { name: 'echo', description: 'Echo', input_schema: { type: 'object', properties: { t: { type: 'string' } } }, run: async (i) => `got ${i.t}` };
const risky = { name: 'send', description: 'Send', input_schema: { type: 'object' }, confirm: () => 'Send it?', run: async () => 'sent' };
const shot = { name: 'screenshot', description: 'Shot', input_schema: { type: 'object' }, run: async () => ({ image: { mediaType: 'image/png', data: 'AAAA' }, text: 'ok' }) };
const mkRun = (over = {}) => ({ tools: [echo, risky, shot], confirm: async () => true, onEvent: () => {}, signal: undefined, counter: { actions: 0 }, ...over });

test('tools/list exposes names, descriptions and schemas', async () => {
  const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, mkRun());
  assert.deepEqual(r.result.tools.map((t) => t.name), ['echo', 'send', 'screenshot']);
  assert.equal(r.result.tools[0].inputSchema.type, 'object');
});

test('initialize echoes the protocol version and notifications get no reply', async () => {
  const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, mkRun());
  assert.equal(r.result.protocolVersion, '2025-03-26');
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, mkRun()), null);
  const bad = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'server/discover' }, mkRun());
  assert.equal(bad.error.code, -32601);
});

test('tools/call runs the tool, counts it, and converts images', async () => {
  const run = mkRun();
  const r = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { t: 'hi' } } }, run);
  assert.deepEqual(r.result.content, [{ type: 'text', text: 'got hi' }]);
  assert.equal(run.counter.actions, 1);
  const s = await handleRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'screenshot', arguments: {} } }, run);
  assert.deepEqual(s.result.content[0], { type: 'image', data: 'AAAA', mimeType: 'image/png' });
});

test('confirm gate: declined actions do not run and are reported to the model', async () => {
  let asked = null;
  const run = mkRun({ confirm: async (q) => { asked = q.question; return false; } });
  const r = await handleRpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'send', arguments: {} } }, run);
  assert.equal(asked, 'Send it?');
  assert.match(r.result.content[0].text, /declined/);
  assert.equal(run.counter.actions, 0);
});

test('unknown tools and missing runs are errors, not crashes', async () => {
  const r = await handleRpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope', arguments: {} } }, mkRun());
  assert.equal(r.result.isError, true);
  const n = await handleRpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'echo', arguments: {} } }, null);
  assert.equal(n.error.code, -32000);
});

test('http host rejects missing token, wrong host header and non-POST', async () => {
  const host = new McpHost();
  await host.start();
  host.run = mkRun();
  const call = (headers, method = 'POST') => new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: host.port, path: '/mcp', method, headers, agent: false }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
  });
  const auth = { authorization: `Bearer ${host.token}`, 'content-type': 'application/json' };
  assert.equal(await call({}), 401);
  assert.equal(await call({ authorization: 'Bearer wrong' }), 401);
  assert.equal(await call({ ...auth, host: 'evil.example:80' }), 403);
  assert.equal(await call(auth, 'GET'), 405);
  assert.equal(await call(auth), 200);
  host.stop();
});

test('args: no built-in tools, only relay tools, own system prompt, no user settings', () => {
  const a = buildArgs({ model: 'sonnet', system: 'SYS', config: { mcpServers: {} } });
  const at = (flag) => a[a.indexOf(flag) + 1];
  assert.equal(at('--tools'), '');
  assert.equal(at('--allowedTools'), 'mcp__relay__*');
  assert.equal(at('--system-prompt'), 'SYS');
  assert.equal(at('--setting-sources'), '');
  assert.ok(a.includes('--strict-mcp-config') && a.includes('--no-session-persistence'));
  assert.equal(at('--model'), 'sonnet');
});

function fakeSpawn(lines, { code = 0, stderr = '' } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    child.prompt = '';
    child.stdin.on('data', (d) => (child.prompt += d));
    setImmediate(() => {
      for (const l of lines) child.stdout.write(JSON.stringify(l) + '\n');
      if (stderr) child.stderr.write(stderr);
      if (lines.length === 0) child.emit('exit', code);
    });
    return child;
  };
}
const host = { run: null, config: () => ({ mcpServers: {} }) };
const base = { text: 'hello', system: 's', tools: [], confirm: async () => true, host, claudePath: '/x/claude' };

test('runClaude resolves with the result text', async () => {
  const r = await runClaude({ ...base, spawnFn: fakeSpawn([{ type: 'system', subtype: 'init', mcp_servers: [{ name: 'relay', status: 'connected' }] }, { type: 'result', subtype: 'success', is_error: false, result: 'Opened Notes.' }]) });
  assert.deepEqual([r.status, r.reply], ['done', 'Opened Notes.']);
  assert.equal(host.run, null);
});

test('runClaude reports an unreachable tool server and sign-in problems plainly', async () => {
  const a = await runClaude({ ...base, spawnFn: fakeSpawn([{ type: 'system', subtype: 'init', mcp_servers: [{ name: 'relay', status: 'failed' }] }]) });
  assert.equal(a.status, 'failed');
  assert.match(a.reply, /reach Relay/);
  const b = await runClaude({ ...base, spawnFn: fakeSpawn([{ type: 'result', is_error: true, result: 'Invalid API key · Please run /login' }]) });
  assert.match(b.reply, /not signed in/);
  assert.match(friendlyError(''), /did not answer/);
});

test('runClaude stops when aborted and when the process dies silently', async () => {
  const ctl = new AbortController();
  const p = runClaude({ ...base, signal: ctl.signal, spawnFn: () => { const c = new EventEmitter(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdin = new PassThrough(); c.kill = () => {}; return c; } });
  ctl.abort();
  assert.equal((await p).status, 'stopped');
  const d = await runClaude({ ...base, spawnFn: fakeSpawn([], { code: 1 }) });
  assert.equal(d.status, 'failed');
});

test('toMcpContent maps screenshots and text', () => {
  assert.deepEqual(toMcpContent([{ type: 'image', source: { media_type: 'image/jpeg', data: 'x' } }, { type: 'text', text: 't' }]), [{ type: 'image', data: 'x', mimeType: 'image/jpeg' }, { type: 'text', text: 't' }]);
});

test('runClaude answers as soon as the final text arrives, without waiting for the closing summary', async () => {
  const t0 = Date.now();
  const r = await runClaude({ ...base, spawnFn: fakeSpawn([{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'x' }] } }, { type: 'assistant', message: { content: [{ type: 'text', text: 'Opened Notes.' }] } }]) });
  assert.deepEqual([r.status, r.reply], ['done', 'Opened Notes.']);
  assert.ok(Date.now() - t0 < 1000);
});

test('text followed by a tool call in the same turn is not mistaken for the final answer', async () => {
  const r = await runClaude({ ...base, spawnFn: fakeSpawn([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Let me look.' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'x' }] } },
    { type: 'result', is_error: false, result: 'Found it.' }
  ]) });
  assert.equal(r.reply, 'Found it.');
});

// ---- warm session, model switching and escalation ----
const { ClaudeSession, runSmart, escalationReason } = require('../src/main/agent/claudeCli');

// A stand-in for `claude -p --input-format stream-json`: answers control requests and turns user messages into events.
function fakeClaude(onUser) {
  const log = [];
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => child.emit('exit', 0);
    const out = (e, delay = 0) => setTimeout(() => child.stdout.write(JSON.stringify(e) + '\n'), delay);
    let model = 'haiku';
    let n = 0;
    child.stdin.on('data', (d) => {
      for (const line of d.toString().split('\n').filter(Boolean)) {
        const m = JSON.parse(line);
        if (m.type === 'control_request') {
          log.push(`${m.request.subtype}${m.request.model ? ':' + m.request.model : ''}`);
          if (m.request.subtype === 'set_model') model = m.request.model;
          out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id } });
          if (m.request.subtype === 'interrupt') out({ type: 'result', is_error: true, subtype: 'error_during_execution' }, 5);
        } else if (m.type === 'user') {
          n++;
          log.push(`user#${n}@${model}`);
          onUser({ model, n, text: m.message.content, out });
        }
      }
    });
    return child;
  };
  return { spawnFn, log };
}
const text = (t) => ({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
const mk = (fake, extra = {}) => new ClaudeSession({ claudePath: '/x/claude', host: { run: null, config: () => ({ mcpServers: {} }) }, system: 's', tools: [], spawnFn: fake.spawnFn, ...extra });

test('a warm session changes model only when the request needs a different one', async () => {
  const fake = fakeClaude(({ out }) => out(text('Done.')));
  const s = mk(fake);
  assert.equal((await s.ask('open notes', { model: 'haiku' })).reply, 'Done.');
  assert.equal((await s.ask('write a long email', { model: 'sonnet' })).reply, 'Done.');
  s.close();
  assert.deepEqual(fake.log, ['user#1@haiku', 'set_model:sonnet', 'user#2@sonnet']);
});

test('a simple request that works stays on Haiku', async () => {
  const fake = fakeClaude(({ out }) => out(text('Opened Notes.')));
  const s = mk(fake);
  const r = await runSmart({ session: s, text: 'open notes', model: 'haiku', escalate: true });
  s.close();
  assert.deepEqual([r.reply, r.model, r.escalated], ['Opened Notes.', 'haiku', false]);
});

test('when Haiku gives up, the same conversation moves to Sonnet', async () => {
  const seen = [];
  const events = [];
  const fake = fakeClaude(({ model, text: t, out }) => {
    seen.push(t);
    out(text(model === 'haiku' ? "I can't do that." : 'Done it.'));
  });
  const s = mk(fake);
  const r = await runSmart({ session: s, text: 'rotate my screen', context: 'Now: today.', model: 'haiku', escalate: true, onEvent: (e) => events.push(e.type) });
  s.close();
  assert.deepEqual([r.reply, r.model, r.escalated], ['Done it.', 'sonnet', true]);
  assert.ok(events.includes('escalate'));
  assert.deepEqual(fake.log, ['user#1@haiku', 'set_model:sonnet', 'user#2@sonnet']);
  assert.match(seen[0], /^Now: today\.\n\nRequest: rotate my screen$/);
  assert.match(seen[1], /did not manage this/);
  assert.match(seen[1], /rotate my screen/);
});

test('a hand-picked model never escalates', async () => {
  const fake = fakeClaude(({ out }) => out(text("I can't do that.")));
  const s = mk(fake);
  const r = await runSmart({ session: s, text: 'x', model: 'haiku', escalate: false });
  s.close();
  assert.deepEqual([r.reply, r.escalated, fake.log.length], ["I can't do that.", false, 1]);
});

test('a run that keeps failing is interrupted, then finished on Sonnet', async () => {
  let session;
  const fake = fakeClaude(({ model, n, out }) => {
    if (n === 1) {
      // The tools keep failing: report three errors the way the tool server would.
      setTimeout(() => { for (let i = 0; i < 3; i++) session.run.onEvent({ type: 'tool', name: 'ui_click', ok: false, result: 'not found' }); }, 5);
    } else out(text('Finished on ' + model + '.'));
  });
  session = mk(fake);
  const r = await runSmart({ session, text: 'click the thing', model: 'haiku', escalate: true });
  session.close();
  assert.deepEqual([r.reply, r.escalated], ['Finished on sonnet.', true]);
  assert.deepEqual(fake.log, ['user#1@haiku', 'interrupt', 'set_model:sonnet', 'user#2@sonnet']);
});

test('the leftover result of an early-answered turn is not taken for the next turn', async () => {
  let n = 0;
  const fake = fakeClaude(({ out }) => {
    n++;
    if (n === 1) { out(text('A')); out({ type: 'result', is_error: false, result: 'ONE' }, 380); }
    else out(text('B'), 50);
  });
  const s = mk(fake);
  assert.equal((await s.ask('first')).reply, 'A');
  assert.equal((await s.ask('second')).reply, 'B');
  s.close();
});

test('escalationReason: when to move up and when to leave the answer alone', () => {
  const ok = { status: 'done', reply: 'Opened Notes.', actions: 1, toolErrors: 0 };
  assert.equal(escalationReason(ok), null);
  assert.match(escalationReason({ ...ok, interrupted: true }), /circles/);
  assert.match(escalationReason({ ...ok, status: 'failed', reply: 'boom' }), /boom/);
  assert.match(escalationReason({ ...ok, toolErrors: 2 }), /failing/);
  assert.match(escalationReason({ status: 'done', reply: "I couldn't find that.", actions: 0, toolErrors: 0 }), /couldn't/);
  assert.equal(escalationReason({ ...ok, status: 'stopped' }), null);
  assert.equal(escalationReason({ ...ok, status: 'failed', fatal: true }), null);
  assert.equal(escalationReason({ status: 'done', reply: "I can't say.", actions: 2, toolErrors: 0 }), null);
});
