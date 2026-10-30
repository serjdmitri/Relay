// Read-only Sentient OS access through the user's existing Codex MCP configuration.
// The endpoint may itself contain an access secret: never return it or log it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { McpRemote } = require('./mcp');

function configuredEndpoint(config) {
  const section = String(config || '').split(/^\[mcp_servers\.sentientos\]\s*$/m)[1]?.split(/^\[/m)[0] || '';
  const value = section.match(/^\s*url\s*=\s*"([^"\r\n]+)"\s*$/m)?.[1];
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'mcp.sentient-os.ai' || url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}

class SentientReader {
  constructor({ configPath = path.join(os.homedir(), '.codex', 'config.toml'), readFile = fs.readFileSync, Client = McpRemote } = {}) {
    Object.assign(this, { configPath, readFile, Client });
  }

  client() {
    let url;
    try { url = configuredEndpoint(this.readFile(this.configPath, 'utf8')); } catch { /* no configuration */ }
    if (!url) throw new Error('Sentient OS is not configured in Codex on this Mac.');
    return new this.Client({ url, timeoutMs: 10000 });
  }

  async call(name, args) {
    try {
      const client = this.client();
      const available = await client.listTools();
      if (!available.some((tool) => tool.name === name)) throw new Error('unavailable');
      const result = await client.callTool(name, args);
      if (result.startsWith('The app reported a problem:')) throw new Error('remote error');
      return result;
    } catch { throw new Error('Sentient OS could not be read. Check the connection and try again.'); }
  }

  structure() { return this.call('get_structure', {}); }
  files(paths) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 5 || paths.some((p) => typeof p !== 'string' || p.length > 300 || !p.endsWith('.md') || p.startsWith('/') || p.split('/').some((part) => !part || part === '.' || part === '..'))) throw new Error('Choose one to five note paths from the Sentient OS index.');
    return this.call('get_files', { paths });
  }
}

module.exports = { SentientReader, configuredEndpoint };
