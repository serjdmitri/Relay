// Your other apps, through one remote MCP server you paste in Settings > Connectors: Composio (its Tool Router URL and API key reach Gmail,
// Slack, GitHub, Linear, Notion and hundreds more) or any other MCP server that speaks Streamable HTTP. Relay is only the client here: the
// server holds your logins. Two Relay tools sit on top (list what the server offers, call one), and every call is sorted first: reads run,
// anything that changes something asks you, anything that deletes is refused (Relay never deletes). Plain fetch, so it can be tested.

const PROTOCOL = '2025-03-26';
const MAX_TEXT = 8000;

class McpError extends Error {}

// Streamable HTTP can answer with plain JSON or with an event stream: this finds the reply to a request in either.
function parseReply(text, contentType, id) {
  if (/text\/event-stream/.test(contentType || '')) {
    let found = null;
    for (const block of String(text).split(/\n\n+/)) {
      const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try { const j = JSON.parse(data); if (j.id === id || (found === null && j.result !== undefined && id === undefined)) found = j; } catch { /* not json */ }
    }
    return found;
  }
  try { const j = JSON.parse(text); return Array.isArray(j) ? j.find((x) => x.id === id) || null : j; } catch { return null; }
}

class McpRemote {
  // headers: e.g. { 'x-api-key': '…' } or { authorization: 'Bearer …' }
  constructor({ url, headers = {}, fetchImpl = fetch, timeoutMs = 30000 }) {
    const u = new URL(url);
    if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) throw new McpError('The address must start with https://');
    this.url = u.href;
    this.headers = headers;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.sessionId = '';
    this.nextId = 1;
    this.ready = null;
  }

  async post(body, { expectReply = true } = {}) {
    const res = await this.fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...this.headers, ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const sid = res.headers?.get?.('mcp-session-id');
    if (sid) this.sessionId = sid;
    if (res.status === 401 || res.status === 403) throw new McpError('The server rejected the key. Check the address and key in Settings > Connectors.');
    if (res.status === 404 && this.sessionId) { this.sessionId = ''; this.ready = null; throw new McpError('The connection expired; try again.'); }
    if (!res.ok && res.status !== 202) throw new McpError(`The server answered ${res.status}: ${(await res.text()).slice(0, 160)}`);
    if (!expectReply) return null;
    const text = await res.text();
    const reply = parseReply(text, res.headers?.get?.('content-type'), body.id);
    if (!reply) throw new McpError('The server did not answer that request.');
    if (reply.error) throw new McpError(String(reply.error.message || 'The server reported an error.').slice(0, 300));
    return reply.result;
  }

  async init() {
    if (!this.ready) {
      this.ready = (async () => {
        const r = await this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Relay', version: '1' } } });
        await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { expectReply: false }).catch(() => {});
        return r;
      })().catch((e) => { this.ready = null; throw e; });
    }
    return this.ready;
  }

  async request(method, params) {
    await this.init();
    return this.post({ jsonrpc: '2.0', id: this.nextId++, method, params });
  }

  async listTools() {
    const out = [];
    let cursor;
    for (let page = 0; page < 20; page++) {
      const r = await this.request('tools/list', cursor ? { cursor } : {});
      out.push(...(r.tools || []));
      cursor = r.nextCursor;
      if (!cursor || out.length >= 500) break;
    }
    return out;
  }

  // The result as text for the model.
  async callTool(name, args = {}) {
    const r = await this.request('tools/call', { name: String(name), arguments: args && typeof args === 'object' ? args : {} });
    const text = (r.content || []).map((c) => (c.type === 'text' ? c.text : c.type === 'image' ? '[an image]' : c.type === 'resource' ? `[resource ${c.resource?.uri || ''}]` : '')).filter(Boolean).join('\n');
    const cut = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n[cut: ${text.length - MAX_TEXT} more characters]` : text;
    return r.isError ? `The app reported a problem: ${cut || 'no details'}` : cut || (r.structuredContent ? JSON.stringify(r.structuredContent).slice(0, MAX_TEXT) : 'Done.');
  }
}

// What kind of thing a tool or an action does, from its name.
const DELETES = /(?:^|[_\-\s.])(delete|remove|trash|purge|destroy|erase|clear|empty|wipe|revoke|drop|truncate|unsubscribe|disconnect|archive_all)(?:$|[_\-\s.])/i;
const READS = /(?:^|[_\-\s.])(get|list|fetch|search|find|read|retrieve|query|check|lookup|view|show|count|describe|schemas?|status|history|summary|download|export|watch)(?:$|[_\-\s.])/i;
const CHANGES = /(?:^|[_\-\s.])(send|create|update|post|add|insert|reply|forward|move|share|invite|set|write|edit|modify|upload|publish|submit|schedule|book|pay|transfer|approve|merge|assign|label|mark|patch|put|run|execute|start|stop|cancel|import|append|rename|copy|duplicate|tag|react|comment|connect|authorize|manage)(?:$|[_\-\s.])/i;

// Every action name inside a call (Composio runs several by slug in one call: { tools: [{ tool_slug, arguments }] }).
function actionNames(name, args) {
  const names = [String(name)];
  const walk = (v, depth) => {
    if (!v || depth > 4) return;
    if (Array.isArray(v)) { for (const x of v.slice(0, 50)) walk(x, depth + 1); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (/^(tool_slug|slug|tool|tool_name|action|toolSlug)$/i.test(k) && typeof x === 'string') names.push(x); else walk(x, depth + 1); }
  };
  walk(args, 0);
  return names;
}

// { block: reason } to refuse, { confirm: question } to ask first, {} to just run.
const LOOKUP_ONLY = /^COMPOSIO_(SEARCH_TOOLS|GET_TOOL_SCHEMAS|WAIT_FOR_CONNECTIONS)$/i;
const RUNNER = /^COMPOSIO_MULTI_EXECUTE_TOOL$/i;
function classifyCall(name, args, app = 'your app') {
  const names = actionNames(name, args);
  const del = names.find((n) => DELETES.test(n));
  if (del) return { block: `Relay never deletes things, so it will not run "${del}". It can read, add and change, and asks first.` };
  const actions = names.filter((n) => !LOOKUP_ONLY.test(n) && !RUNNER.test(n));
  const risky = actions.filter((n) => CHANGES.test(n) || !READS.test(n));
  if (risky.length) return { confirm: `Run in ${app}: ${risky.slice(0, 4).map((n) => n.replace(/_/g, ' ').toLowerCase()).join(', ')}?` };
  if (!actions.length && names.some((n) => RUNNER.test(n))) return { confirm: `Run actions in ${app}? (Relay could not see which.)` };
  return {};
}

const obj = (properties, required = []) => ({ type: 'object', properties, required });
const str = (description) => ({ type: 'string', description });

function mcpTools(client, { label = 'your apps' } = {}) {
  let cache = null;
  const list = async () => cache || (cache = await client.listTools());
  return [
    {
      name: 'apps_tools',
      description: `List what ${label} can do (the tools of the connected app server, with what each needs), optionally filtered by words. Use it before apps_call. With Composio this includes COMPOSIO_SEARCH_TOOLS to find an action for an app (Gmail, Slack, GitHub, Linear, Google Sheets…) and COMPOSIO_MULTI_EXECUTE_TOOL to run it.`,
      input_schema: obj({ query: str('Words to filter by (optional)') }),
      describe: () => `Looking at ${label}`,
      run: async (i) => {
        const q = String(i?.query || '').toLowerCase();
        const tools = (await list()).filter((t) => !q || `${t.name} ${t.description || ''}`.toLowerCase().includes(q)).slice(0, 40);
        if (!tools.length) return 'No tool matches. Try fewer words, or none.';
        return tools.map((t) => `${t.name}: ${String(t.description || '').replace(/\s+/g, ' ').slice(0, 220)}\n  input: ${JSON.stringify(t.inputSchema?.properties ? Object.fromEntries(Object.entries(t.inputSchema.properties).slice(0, 12).map(([k, v]) => [k, v.type || 'any'])) : {})}${t.inputSchema?.required?.length ? ` required: ${t.inputSchema.required.join(', ')}` : ''}`).join('\n');
      }
    },
    {
      name: 'apps_call',
      description: `Run one tool of ${label} (name and arguments as apps_tools shows them). Reading runs at once; anything that sends, creates or changes asks the user first; anything that deletes is refused. Never put secrets in the arguments.`,
      input_schema: obj({ tool: str('The tool name'), arguments: { type: 'object', description: 'The arguments', additionalProperties: true } }, ['tool']),
      confirm: (i) => classifyCall(i.tool, i.arguments, label).confirm || null,
      describe: (i) => `${label}: ${String(i.tool || '').replace(/_/g, ' ').toLowerCase().slice(0, 40)}`,
      run: async (i) => {
        const c = classifyCall(i.tool, i.arguments, label);
        if (c.block) return c.block;
        return client.callTool(i.tool, i.arguments || {});
      }
    }
  ];
}

module.exports = { McpRemote, McpError, mcpTools, classifyCall, actionNames, parseReply };
