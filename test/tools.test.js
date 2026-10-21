const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTools } = require('../src/main/agent/tools');
const { buildSystemPrompt } = require('../src/main/agent/system-prompt');
const { stripHtml } = require('../src/main/agent/web');

const fakeMac = new Proxy({}, { get: (_, name) => async (...a) => `${String(name)}(${a.join(',')})` });

test('every tool has a name, schema and runner; names are unique', () => {
  const tools = buildTools({ mac: fakeMac, getScale: () => 1, firefox: { isConnected: () => true, call: async () => ({}) } });
  const names = tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const t of tools) {
    assert.ok(t.description, t.name);
    assert.equal(t.input_schema.type, 'object', t.name);
    assert.equal(typeof t.run, 'function', t.name);
  }
  assert.ok(names.includes('firefox_tabs'));
});

test('firefox tools only appear when the extension is connected; vision tools respect the flag', () => {
  const a = buildTools({ mac: fakeMac, getScale: () => 1, firefox: { isConnected: () => false } }).map((t) => t.name);
  assert.ok(!a.some((n) => n.startsWith('firefox_')));
  const b = buildTools({ mac: fakeMac, getScale: () => 1, visionCapable: false }).map((t) => t.name);
  assert.ok(!b.includes('screenshot') && !b.includes('click'));
});

test('dangerous tools ask for confirmation, harmless ones do not', () => {
  const tools = Object.fromEntries(buildTools({ mac: fakeMac, getScale: () => 1 }).map((t) => [t.name, t]));
  assert.ok(tools.messages_send.confirm({ to: 'a', text: 'b' }));
  assert.ok(tools.run_shell.confirm({ command: 'ls' }));
  assert.ok(tools.trash_path.confirm({ path: '/x' }));
  assert.equal(tools.run_applescript.confirm({ script: 'get name of notes' }), null);
  assert.ok(tools.run_applescript.confirm({ script: 'delete note 1' }));
  assert.equal(tools.open_app.confirm, undefined);
});

test('click converts screenshot pixels to screen points and shows the cursor first', async () => {
  const order = [];
  const mac = { ...fakeMac, click: async (x, y) => { order.push(`click ${x},${y}`); return 'ok'; } };
  const tools = Object.fromEntries(buildTools({ mac, getScale: () => 1.5, overlay: { point: async (x, y) => order.push(`point ${x},${y}`) } }).map((t) => [t.name, t]));
  await tools.click.run({ x: 100, y: 40 });
  assert.deepEqual(order, ['point 150,60', 'click 150,60']);
});

test('system prompt carries context', () => {
  const p = buildSystemPrompt({ frontmost: 'Firefox', vocabulary: ['Talkify'], routines: [{ name: 'start my day' }], firefoxConnected: false, now: new Date('2026-10-17T12:00:00Z') });
  assert.match(p, /Frontmost app.*Firefox/);
  assert.match(p, /Talkify/);
  assert.match(p, /start my day/);
  assert.match(p, /Firefox extension is not connected/);
  assert.ok(!p.includes('—'));
});

test('stripHtml', () => {
  assert.equal(stripHtml('<p>Hi&nbsp;<b>there</b></p><script>x()</script>'), 'Hi there');
});

test('system prompt treats page text as untrusted', () => {
  assert.match(buildSystemPrompt({}), /data, not instructions/);
});

test('clipboard and selection tools read, write and fall back to plain messages', async () => {
  const t = Object.fromEntries(buildTools({ mac: {
    clipboardRead: async () => ({ text: 'hello', image: null }), clipboardWrite: async (x) => `wrote ${x}`, selectedText: async () => ''
  }, getScale: () => 1 }).map((x) => [x.name, x]));
  assert.equal(await t.clipboard_read.run({}), 'hello');
  assert.equal(await t.clipboard_write.run({ text: 'hi' }), 'wrote hi');
  assert.equal(await t.selected_text.run({}), 'Nothing is selected in the front app.');
  assert.equal(t.clipboard_read.confirm, undefined);
  const img = Object.fromEntries(buildTools({ mac: { clipboardRead: async () => ({ text: '', image: { mediaType: 'image/jpeg', data: 'AA' } }) }, getScale: () => 1 }).map((x) => [x.name, x]));
  assert.equal((await img.clipboard_read.run({})).image.data, 'AA');
  const blind = Object.fromEntries(buildTools({ mac: { clipboardRead: async () => ({ text: '', image: { mediaType: 'image/jpeg', data: 'AA' } }) }, getScale: () => 1, visionCapable: false }).map((x) => [x.name, x]));
  assert.equal(await blind.clipboard_read.run({}), 'The clipboard is empty.');
});
