const test = require('node:test');
const assert = require('node:assert/strict');
const tc = require('../src/main/agent/toolCategories');
const { handleRpc } = require('../src/main/agent/claudeCli');

const mk = (name, extra = {}) => ({ name, description: `does ${name}`, input_schema: { type: 'object', properties: {} }, run: async (i) => `ran ${name} ${JSON.stringify(i)}`, ...extra });
const tools = () => ['open_app', 'web_search', 'notes_create', 'firefox_open', 'firefox_read_page', 'show_3d', 'drive_scan', 'make_document', 'run_shell'].map((n) => mk(n));
const run = (request) => { const t = tools(); t.exposed = tc.exposure(t, { request }); return { tools: t, exposed: t.exposed, confirm: async () => true, onEvent: () => {}, counter: { actions: 0 } }; };
const list = async (r) => (await handleRpc({ id: 1, method: 'tools/list' }, r)).result.tools.map((t) => t.name);
const call = (r, name, args) => handleRpc({ id: 2, method: 'tools/call', params: { name, arguments: args } }, r);

test('rarely used groups are hidden, everything else stays, and the loader tools appear', async () => {
  const names = await list(run(''));
  assert.deepEqual(names.slice(0, 3), ['open_app', 'web_search', 'notes_create']);
  assert.ok(!names.some((n) => /firefox_|show_3d|drive_|make_document|run_shell/.test(n)));
  assert.ok(names.includes('load_more_tools') && names.includes('use_tool'));
  assert.match((await handleRpc({ id: 1, method: 'tools/list' }, run(''))).result.tools.find((t) => t.name === 'load_more_tools').description, /firefox.*holograms|holograms.*firefox/);
});

test('a request that clearly asks for a group gets it listed directly', async () => {
  assert.ok((await list(run('read this page in Firefox'))).includes('firefox_open'));
  assert.ok((await list(run('make a 3D model of a gear'))).includes('show_3d'));
  assert.ok(!(await list(run('what time is it'))).includes('firefox_open'));
  assert.deepEqual(tc.classify(''), []);
});

test('load_more_tools shows a group and use_tool runs the real tool, with its confirmation', async () => {
  const r = run('');
  const out = await call(r, 'load_more_tools', { group: 'firefox' });
  assert.match(out.result.content[0].text, /firefox_open: does firefox_open\ninput: /);
  assert.ok((await list(r)).includes('firefox_open'), 'listed from then on');
  const ran = await call(r, 'use_tool', { name: 'run_shell', input: { cmd: 'ls' } });
  assert.match(ran.result.content[0].text, /ran run_shell \{"cmd":"ls"\}/);
  assert.equal(r.counter.actions, 1);
  let asked = null;
  const r2 = run(''); r2.tools.find((t) => t.name === 'drive_scan').confirm = () => 'Scan the drive?'; r2.confirm = async (q) => { asked = q; return false; };
  const declined = await call(r2, 'use_tool', { name: 'drive_scan', input: {} });
  assert.equal(asked.question, 'Scan the drive?');
  assert.match(declined.result.content[0].text, /declined/);
  assert.match((await call(r, 'use_tool', { name: 'nope', input: {} })).result.content[0].text, /Unknown tool/);
  assert.match((await call(r, 'load_more_tools', { group: 'zzz' })).result.content[0].text, /Unknown group/);
});

test('with the feature off nothing changes', async () => {
  const t = tools();
  const r = { tools: t, exposed: null, confirm: async () => true, onEvent: () => {}, counter: { actions: 0 } };
  assert.equal((await list(r)).length, 9);
  assert.ok(!(await list(r)).includes('load_more_tools'));
});

test('when every group is already shown the loader tools are not offered', async () => {
  const t = tools(); t.exposed = new Set(t.map((x) => x.name));
  assert.ok(!(await list({ tools: t, exposed: t.exposed })).includes('use_tool'));
});

test('each time the model asks for a hidden group it is reported, so Doctor can show how often', async () => {
  const r = run(''); const asked = []; r.onLoadMore = (g) => asked.push(g);
  await call(r, 'load_more_tools', { group: 'firefox' });
  await call(r, 'load_more_tools', { group: 'drive' });
  assert.deepEqual(asked, ['firefox', 'drive']);
});
