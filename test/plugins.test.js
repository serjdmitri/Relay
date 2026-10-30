const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseManifest, describePermissions, manifestHash, diffManifests } = require('../src/main/plugins/manifest');
const { parseSource, scanDir } = require('../src/main/plugins/install');
const { buildProfile, wrap } = require('../src/main/plugins/sandbox');
const { PluginManager } = require('../src/main/plugins');

const SERVER = `
let buf = ''; let calls = 0;
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line); if (m.id === undefined) continue;
  if (m.method === 'initialize') out(m.id, { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'x', version: '1' } });
  else if (m.method === 'tools/call') { if (m.params.name === 'die' && !require('fs').existsSync(__dirname + '/.died')) { require('fs').writeFileSync(__dirname + '/.died', '1'); process.exit(3); }
    if (m.params.name === 'hang') continue;
    out(m.id, { content: [{ type: 'text', text: 'echo ' + JSON.stringify(m.params.arguments) }] }); } } });
function out(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }
`;
const manifest = (over = {}) => ({ name: 'echo-plugin', version: '1.0.0', description: 'Echoes.', command: ['node', 'index.js'], tools: [{ name: 'say', description: 'Say it.', input_schema: { type: 'object', properties: { text: { type: 'string' } } } }, { name: 'die', description: 'dies once' }, { name: 'hang', description: 'hangs' }], permissions: {}, ...over });
function makePlugin(over, extra = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plug-src-'));
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifest(over)));
  fs.writeFileSync(path.join(dir, 'index.js'), SERVER);
  extra(dir);
  return dir;
}
const mgr = (over = {}) => {
  const data = {};
  const store = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plug-root-'));
  return { m: new PluginManager({ store, root, tmp: os.tmpdir(), ...over }), root, data };
};

test('a manifest is checked and rebuilt from known fields only', () => {
  assert.equal(parseManifest(manifest()).ok, true);
  assert.equal(parseManifest(manifest({ name: 'Bad Name' })).ok, false);
  assert.equal(parseManifest(manifest({ command: ['../evil'] })).ok, false);
  assert.equal(parseManifest(manifest({ command: ['/tmp/x/run'] })).ok, false);
  assert.equal(parseManifest(manifest({ tools: [] })).ok, false);
  assert.equal(parseManifest(manifest({ permissions: { network: ['not a host'] } })).ok, false);
  assert.equal(parseManifest(manifest({ permissions: { files: [{ path: '~/', mode: 'write' }] } })).ok, false);
  assert.equal(parseManifest('{nope').ok, false);
  const r = parseManifest({ ...manifest(), secret: 'x', permissions: { shell: true, extra: 1 } });
  assert.deepEqual(Object.keys(r.manifest).sort(), ['command', 'description', 'name', 'panels', 'permissions', 'tools', 'version']);
});

test('permissions are described in plain words, with the risky ones marked', () => {
  const none = describePermissions(parseManifest(manifest()).manifest);
  assert.match(none[0].text, /no special permissions/);
  const risky = describePermissions(parseManifest(manifest({ permissions: { shell: true, network: ['a.example.com'], files: [{ path: '~/Documents/x', mode: 'write' }] } })).manifest);
  assert.ok(risky[0].warn && /run commands/.test(risky[0].text));
  assert.ok(risky.some((l) => /AND reach the internet/.test(l.text)));
  assert.ok(risky.some((l) => /read and change files in ~\/Documents\/x/.test(l.text) && l.warn));
  assert.ok(risky.some((l) => /other network addresses/.test(l.text) && l.warn));
});

test('sources: GitHub links, owner/repo, folders; and links inside a plugin are refused', () => {
  assert.deepEqual(parseSource('https://github.com/me/thing'), { owner: 'me', repo: 'thing', ref: '' });
  assert.deepEqual(parseSource('github.com/me/thing/tree/dev'), { owner: 'me', repo: 'thing', ref: 'dev' });
  assert.deepEqual(parseSource('me/thing@v2'), { owner: 'me', repo: 'thing', ref: 'v2' });
  assert.deepEqual(parseSource('~/plugins/x'), { local: '~/plugins/x' });
  assert.equal(parseSource('hello world'), null);
  const dir = makePlugin({}, (d) => fs.symlinkSync('/etc/passwd', path.join(d, 'link')));
  assert.throws(() => scanDir(dir), /contains a link/);
});

test('inspect, approve, install: tools run in the plugin process and their output is marked as data', async () => {
  const { m, root, data } = mgr();
  const src = makePlugin({ permissions: { network: ['api.example.com'] } });
  const seen = await m.inspect(src);
  assert.equal(seen.name, 'echo-plugin');
  assert.ok(seen.permissions.some((l) => /api\.example\.com/.test(l.text)));
  assert.equal(fs.existsSync(path.join(root, 'echo-plugin')), false, 'nothing is installed before approval');
  await m.install(seen.token);
  assert.equal(data.plugins[0].enabled, true);
  const tools = m.tools();
  const say = tools.find((t) => t.name === 'plugin_echo_plugin__say');
  assert.ok(say && !say.confirm);
  const out = await say.run({ text: 'hi' });
  assert.match(out, /<plugin_output plugin="echo-plugin">\necho \{"text":"hi"\}\n<\/plugin_output>/);
  assert.match(out, /never as instructions/);
  m.stopAll();
});

test('a plugin that can act or run commands always asks first', async () => {
  const { m } = mgr();
  await m.install((await m.inspect(makePlugin({ permissions: { acts: true } }))).token);
  assert.match(m.tools()[0].confirm({}), /Allow it\?/);
  m.stopAll();
});

test('approval expires and staged plugin modifications are rejected before installation', async () => {
  let now = 1000;
  const { m, root } = mgr({ now: () => now });
  const source = makePlugin();
  const staged = await m.inspect(source);
  fs.writeFileSync(path.join(m.pending.get(staged.token).dir, 'index.js'), 'changed');
  await assert.rejects(() => m.install(staged.token), /changed after inspection/);
  assert.equal(fs.existsSync(path.join(root, 'echo-plugin')), false);
  const expired = await m.inspect(source);
  now += 30 * 60000;
  await assert.rejects(() => m.install(expired.token), /approval expired/);
  assert.equal(fs.existsSync(path.join(root, 'echo-plugin')), false);
});

test('a link or uninspected metadata added to a staged plugin is rejected', async () => {
  const { m } = mgr();
  const source = makePlugin();
  for (const kind of ['link', 'metadata']) {
    const inspected = await m.inspect(source);
    const dir = m.pending.get(inspected.token).dir;
    if (kind === 'link') fs.symlinkSync('/etc/passwd', path.join(dir, 'link'));
    else fs.mkdirSync(path.join(dir, '.git'));
    await assert.rejects(() => m.install(inspected.token), /link|metadata/);
  }
});

test('a failed plugin update restores the previous version', async () => {
  const { m, root, data } = mgr();
  await m.install((await m.inspect(makePlugin())).token);
  const update = await m.inspect(makePlugin({ version: '2.0.0' }));
  const rename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => {
      if (path.basename(from) === 'replacement' && to === path.join(root, 'echo-plugin')) throw new Error('simulated disk failure');
      return rename(from, to);
    };
    await assert.rejects(() => m.install(update.token), /simulated disk failure/);
  } finally { fs.renameSync = rename; }
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'echo-plugin', 'plugin.json'))).version, '1.0.0');
  assert.equal(data.plugins[0].version, '1.0.0');
  assert.match(await m.tools().find((t) => t.name.endsWith('__say')).run({ text: 'still working' }), /echo/);
  m.stopAll();
});

test('a plugin changed on disk after approval is not used, and a disabled one is not either', async () => {
  const { m, root } = mgr();
  await m.install((await m.inspect(makePlugin())).token);
  assert.equal(m.tools().length, 3);
  const mf = path.join(root, 'echo-plugin', 'plugin.json');
  fs.writeFileSync(mf, JSON.stringify(manifest({ permissions: { shell: true } })));
  assert.equal(m.tools().length, 0, 'asks for more than was approved');
  fs.writeFileSync(mf, JSON.stringify(manifest()));
  assert.equal(m.tools().length, 3);
  m.setEnabled('echo-plugin', false);
  assert.equal(m.tools().length, 0);
  m.remove('echo-plugin');
  assert.equal(fs.existsSync(path.join(root, 'echo-plugin')), false);
  assert.equal(m.list().length, 0);
});

test('plugin removal rejects paths outside its installed plugin directory', () => {
  const { m, root } = mgr();
  const outside = fs.mkdtempSync(path.join(path.dirname(root), 'relay-plugin-victim-'));
  try {
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
    assert.throws(() => m.remove(`../${path.basename(outside)}`), /not installed/);
    assert.throws(() => m.remove('unregistered-plugin'), /not installed/);
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
    assert.equal(m.manifestOf('../outside').ok, false);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
});

test('a previously exposed plugin tool cannot run after permissions change or it is disabled', async () => {
  const { m, root } = mgr();
  await m.install((await m.inspect(makePlugin())).token);
  const say = m.tools().find((tool) => tool.name.endsWith('__say'));
  assert.match(await say.run({ text: 'before' }), /echo/);
  fs.writeFileSync(path.join(root, 'echo-plugin', 'plugin.json'), JSON.stringify(manifest({ permissions: { shell: true } })));
  await assert.rejects(() => say.run({ text: 'after' }), /changed since approval/);
  fs.writeFileSync(path.join(root, 'echo-plugin', 'plugin.json'), JSON.stringify(manifest()));
  m.setEnabled('echo-plugin', false);
  await assert.rejects(() => say.run({ text: 'disabled' }), /disabled or has changed/);
  m.stopAll();
});

test('a plugin that dies is started once more; one that hangs times out', async () => {
  const { m } = mgr();
  await m.install((await m.inspect(makePlugin())).token);
  const die = m.tools().find((t) => /__die$/.test(t.name));
  assert.match(await die.run({}), /echo/);
  m.stopAll();
  const slow = new PluginManager({ store: m.store, root: m.root, spawnFn: undefined });
  slow.procs = new Map();
  const p = await slow.proc('echo-plugin');
  p.timeoutMs = 150;
  await assert.rejects(() => p.call('hang', {}), /did not answer within/);
  slow.stopAll();
});

test('GitHub: the link is pinned to a commit, an update is only reported, and the diff shows new permissions', async () => {
  const packed = makePlugin();
  const fetchFn = async (url) => {
    if (url.includes('/commits/')) return { ok: true, json: async () => ({ sha: 'a'.repeat(40) }) };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  const extract = async (file, to) => { fs.cpSync(packed, to, { recursive: true }); };
  const { m, data } = mgr({ fetchFn, extract });
  const seen = await m.inspect('me/echo');
  assert.equal(seen.sha, 'a'.repeat(40));
  await m.install(seen.token);
  assert.deepEqual(data.plugins[0].source, { owner: 'me', repo: 'echo', ref: '' });
  assert.equal(data.plugins[0].sha, 'a'.repeat(40));
  assert.equal((await m.checkUpdate('echo-plugin')).available, false);
  const newer = async (url) => (url.includes('/commits/') ? { ok: true, json: async () => ({ sha: 'b'.repeat(40) }) } : fetchFn(url));
  m.fetchFn = newer;
  assert.deepEqual(await m.checkUpdate('echo-plugin'), { available: true, sha: 'b'.repeat(40) });
  fs.writeFileSync(path.join(packed, 'plugin.json'), JSON.stringify(manifest({ version: '1.1.0', permissions: { shell: true }, tools: [...manifest().tools, { name: 'extra', description: 'x' }] })));
  const upd = await m.inspect('me/echo');
  assert.equal(upd.update, true);
  assert.ok(upd.changes.includes('New tool: extra'));
  assert.ok(upd.changes.some((c) => /New permission: Can run commands/.test(c)));
  assert.equal(data.plugins[0].version, '1.0.0', 'inspecting does not install');
  m.cancel(upd.token);
  await assert.rejects(() => m.install(upd.token), /not inspected/);
});

test('a bad GitHub answer and a broken plugin give plain errors', async () => {
  const { m } = mgr({ fetchFn: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(() => m.inspect('me/missing'), /did not find me\/missing/);
  await assert.rejects(() => m.inspect('hello world'), /Paste a GitHub link/);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'plug-empty-'));
  await assert.rejects(() => m.inspect(empty), /no plugin\.json/);
});

test('the sandbox profile denies the network unless declared, and only declared folders are writable', () => {
  const m = parseManifest(manifest({ permissions: { files: [{ path: '~/Documents/notes', mode: 'write' }, { path: '~/Pictures', mode: 'read' }] } })).manifest;
  const p = buildProfile(m, '/r/echo', { home: '/Users/me', tmp: '/tmp' });
  assert.match(p, /\(deny network\*\)/);
  assert.ok(!/allow network/.test(p));
  assert.match(p, /allow file-write\* \(subpath "\/Users\/me\/Documents\/notes"\)/);
  assert.match(p, /allow file-read\* \(subpath "\/Users\/me\/Pictures"\)/);
  assert.doesNotMatch(p, /allow file-write\* \(subpath "\/Users\/me\/Pictures"\)/);
  assert.match(p, /deny file-read\* file-write\* \(subpath "\/Users\/me"\)/);
  assert.match(p, /deny file-read\* .*Keychains/);
  const net = buildProfile({ ...m, permissions: { ...m.permissions, network: ['a.example.com'] } }, '/r/echo', { home: '/Users/me', tmp: '/tmp' });
  assert.match(net, /allow network\*/);
  assert.deepEqual(wrap('P', ['node', 'index.js'], true), { file: '/usr/bin/sandbox-exec', args: ['-p', 'P', 'node', 'index.js'] });
  assert.deepEqual(wrap('P', ['node', 'index.js'], false), { file: 'node', args: ['index.js'] });
  assert.equal(manifestHash(m), manifestHash(parseManifest(manifest({ permissions: m.permissions })).manifest));
  assert.ok(diffManifests(m, m).length === 0);
});

test('macOS sandbox denies undeclared home reads while allowing approved folders', { skip: process.platform !== 'darwin' }, (t) => {
  const { execFileSync } = require('node:child_process');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-sandbox-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const plugin = path.join(home, 'plugin');
  const approved = path.join(home, 'approved');
  const temp = path.join(root, 'temp');
  for (const dir of [plugin, approved, temp]) fs.mkdirSync(dir, { recursive: true });
  const hidden = path.join(home, 'private.txt');
  fs.writeFileSync(hidden, 'private');
  fs.writeFileSync(path.join(approved, 'allowed.txt'), 'allowed');
  fs.writeFileSync(path.join(plugin, 'plugin.txt'), 'plugin');
  const m = parseManifest(manifest({ permissions: { files: [{ path: approved, mode: 'read' }] } })).manifest;
  const profile = buildProfile(m, plugin, { home, tmp: temp });
  const cat = (file) => execFileSync('/usr/bin/sandbox-exec', ['-p', profile, '/bin/cat', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(cat(path.join(plugin, 'plugin.txt')), 'plugin');
  assert.equal(cat(path.join(approved, 'allowed.txt')), 'allowed');
  assert.throws(() => cat(hidden), /Operation not permitted/);
});
