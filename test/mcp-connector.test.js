const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { McpRemote, mcpTools, classifyCall, parseReply } = require('../src/main/connectors/mcp');

// A pretend MCP server over Streamable HTTP: JSON replies for most, an event stream for tools/call, a session id, a page cursor.
function fakeServer({ key = 'k1' } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.headers['x-api-key'] !== key) { res.writeHead(401); return res.end('no'); }
      const m = JSON.parse(body);
      seen.push({ method: m.method, session: req.headers['mcp-session-id'] || '' });
      if (m.method === 'initialize') { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' }); return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'fake' }, capabilities: {} } })); }
      if (m.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
      if (m.method === 'tools/list') {
        const first = !m.params?.cursor;
        const tools = first ? [{ name: 'GMAIL_FETCH_EMAILS', description: 'Fetch emails', inputSchema: { properties: { query: { type: 'string' } }, required: ['query'] } }] : [{ name: 'SLACK_SEND_MESSAGE', description: 'Send a Slack message', inputSchema: {} }];
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools, ...(first ? { nextCursor: 'p2' } : {}) } }));
      }
      if (m.method === 'tools/call') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `ran ${m.params.name} ${JSON.stringify(m.params.arguments)}` }] } })}\n\n`);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { message: 'unknown method' } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/mcp`, server, seen })));
}

test('the client starts a session, lists tools across pages, and reads a reply from an event stream', async () => {
  const { url, server, seen } = await fakeServer();
  try {
    const c = new McpRemote({ url, headers: { 'x-api-key': 'k1' } });
    const tools = await c.listTools();
    assert.deepEqual(tools.map((t) => t.name), ['GMAIL_FETCH_EMAILS', 'SLACK_SEND_MESSAGE']);
    assert.deepEqual(seen.map((s) => s.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/list']);
    assert.equal(seen[2].session, 'sess-1', 'the session id is sent back');
    assert.equal(await c.callTool('GMAIL_FETCH_EMAILS', { query: 'invoice' }), 'ran GMAIL_FETCH_EMAILS {"query":"invoice"}');
  } finally { server.close(); }
});

test('a wrong key, a plain http address and a silent server are explained', async () => {
  const { url, server } = await fakeServer();
  try {
    await assert.rejects(() => new McpRemote({ url, headers: { 'x-api-key': 'bad' } }).listTools(), /rejected the key/);
    assert.throws(() => new McpRemote({ url: 'http://example.com/mcp' }), /https/);
    assert.equal(parseReply('not json', 'application/json', 1), null);
    assert.equal(parseReply('data: {"id":2,"result":{}}\n\n', 'text/event-stream', 1), null);
  } finally { server.close(); }
});

test('reads run, changes ask, deletes are refused: by tool name, and by the actions inside a Composio multi-execute', () => {
  assert.deepEqual(classifyCall('GMAIL_FETCH_EMAILS', {}), {});
  assert.deepEqual(classifyCall('COMPOSIO_SEARCH_TOOLS', { queries: [] }), {});
  assert.match(classifyCall('SLACK_SEND_MESSAGE', {}, 'your apps').confirm, /slack send message/);
  assert.match(classifyCall('COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS', arguments: {} }, { tool_slug: 'GMAIL_CREATE_EMAIL_DRAFT', arguments: {} }] }).confirm, /gmail create email draft/);
  assert.deepEqual(classifyCall('COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: 'GITHUB_LIST_ISSUES' }, { tool_slug: 'LINEAR_GET_ISSUE' }] }), {}, 'only reads: no question');
  assert.match(classifyCall('GMAIL_DELETE_EMAIL', {}).block, /never deletes/);
  assert.match(classifyCall('COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: 'DRIVE_REMOVE_FILE' }] }).block, /never deletes/);
  assert.match(classifyCall('NOTION_ARCHIVE_ALL', {}).block || classifyCall('NOTION_ARCHIVE_ALL', {}).confirm, /./);
  assert.match(classifyCall('COMPOSIO_MULTI_EXECUTE_TOOL', {}).confirm, /could not see/);
  assert.match(classifyCall('COMPOSIO_REMOTE_BASH_TOOL', { command: 'ls' }).confirm, /./);
});

test('the Relay tools list what is there, run reads at once, ask before changes and refuse deletes', async () => {
  const { url, server } = await fakeServer();
  try {
    const [list, call] = mcpTools(new McpRemote({ url, headers: { 'x-api-key': 'k1' } }), { label: 'your apps' });
    assert.match(await list.run({}), /GMAIL_FETCH_EMAILS: Fetch emails[\s\S]*required: query/);
    assert.match(await list.run({ query: 'slack' }), /SLACK_SEND_MESSAGE/);
    assert.ok(!/GMAIL/.test(await list.run({ query: 'slack' })));
    assert.equal(call.confirm({ tool: 'GMAIL_FETCH_EMAILS', arguments: {} }), null);
    assert.match(call.confirm({ tool: 'SLACK_SEND_MESSAGE', arguments: {} }), /send message/);
    assert.match(await call.run({ tool: 'GMAIL_FETCH_EMAILS', arguments: { query: 'x' } }), /ran GMAIL_FETCH_EMAILS/);
    assert.match(await call.run({ tool: 'GMAIL_DELETE_EMAIL', arguments: {} }), /never deletes/);
  } finally { server.close(); }
});
