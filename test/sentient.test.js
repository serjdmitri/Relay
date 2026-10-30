const test = require('node:test');
const assert = require('node:assert/strict');
const { SentientReader, configuredEndpoint, sentientTools } = require('../src/main/connectors/sentient');
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

test('model tools refuse disabled access, label notes as data and omit obvious secrets', async () => {
  let allowed = false, reads = 0;
  const reader = { structure: async () => 'README.md\napi key: secret-value', files: async () => 'User prefers tea.' };
  const [index, notes] = sentientTools(reader, { allowed: () => allowed, onRead: () => reads++ });
  await assert.rejects(index.run({}), /disabled or unavailable/);
  assert.equal(reads, 0);
  allowed = true;
  const result = await index.run({});
  assert.match(result, /untrusted note content/);
  assert.match(result, /Possible secret omitted/);
  assert.doesNotMatch(result, /secret-value/);
  assert.match(await notes.run({ paths: ['README.md'] }), /User prefers tea/);
  assert.equal(reads, 2);
});

test('Relay exposes vault tools only when enabled and not using the local model', async () => {
  const Module = require('node:module');
  const original = Module._load;
  Module._load = function (name, ...args) { return name === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {}, safeStorage: {} } : original.call(this, name, ...args); };
  let AskController;
  try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = original; }
  const values = { 'settings.memory': true, 'settings.sentient.enabled': true, 'settings.model.provider': 'claude' };
  const controller = Object.create(AskController.prototype);
  controller.store = { get: (key) => values[key] };
  controller.googleApiIfConnected = () => null;
  controller.sentientReader = { structure: async () => 'index' };
  const index = controller.connectorTools().find((tool) => tool.name === 'sentient_index');
  assert.ok(index);
  values['settings.model.provider'] = 'ollama';
  assert.equal(controller.connectorTools().some((tool) => tool.name.startsWith('sentient_')), false);
  await assert.rejects(index.run({}), /unavailable in local model mode/);
  values['settings.model.provider'] = 'claude';
  values['settings.memory'] = false;
  assert.equal(controller.connectorTools().some((tool) => tool.name.startsWith('sentient_')), false);
});
