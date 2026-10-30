const test = require('node:test');
const assert = require('node:assert/strict');
const { SentientReader, configuredEndpoint } = require('../src/main/connectors/sentient');
const config = '[mcp_servers.sentientos]\nurl = "https://mcp.sentient-os.ai/private/mcp"\n\n[other]\nurl = "https://evil.test/"';

test('Sentient endpoint is taken only from its own HTTPS configuration', () => {
  assert.equal(configuredEndpoint(config), 'https://mcp.sentient-os.ai/private/mcp');
  for (const value of ['http://mcp.sentient-os.ai/x', 'https://mcp.sentient-os.ai.evil.test/x', 'https://user:pass@mcp.sentient-os.ai/x', 'https://mcp.sentient-os.ai/x?token=secret']) assert.equal(configuredEndpoint(`[mcp_servers.sentientos]\nurl = "${value}"\n`), null);
});

test('reader exposes only actual read tools and checks note paths', async () => {
  const calls = [];
  class Client { async listTools() { return [{ name: 'get_structure' }, { name: 'get_files' }]; } async callTool(name, args) { calls.push([name, args]); return 'data'; } }
  const reader = new SentientReader({ readFile: () => config, Client });
  assert.equal(await reader.structure(), 'data');
  assert.equal(await reader.files(['README.md']), 'data');
  assert.deepEqual(calls, [['get_structure', {}], ['get_files', { paths: ['README.md'] }]]);
  for (const bad of [[], ['../secret.md'], ['/secret.md'], ['a//b.md'], ['x.txt']]) assert.throws(() => reader.files(bad), /note paths/);
});

test('connection errors do not expose endpoint secrets', async () => {
  class Client { async listTools() { throw new Error('https://mcp.sentient-os.ai/private/mcp'); } }
  const reader = new SentientReader({ readFile: () => config, Client });
  await assert.rejects(reader.structure(), (error) => !error.message.includes('private') && /could not be read/.test(error.message));
});
