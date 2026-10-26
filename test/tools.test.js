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
  // Without the extension only the tab strip tools (read through accessibility) remain; page tools need the extension.
  assert.deepEqual(a.filter((n) => n.startsWith('firefox_')).sort(), ['firefox_switch_tab', 'firefox_tabs']);
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

// ---- show-me tools: point at an element, draw on screen, guide a task step by step
function fakeOverlay() {
  const calls = [];
  return { calls, point: async (x, y, label) => { calls.push(['point', x, y, label]); return true; }, draw: async (shapes, o) => { calls.push(['draw', shapes, o]); return true; }, guide: async (card, target, box) => { calls.push(['guide', card, target, box]); return true; }, clear: () => calls.push(['clear']) };
}
const frame = { x: 100, y: 200, w: 80, h: 30, cx: 140, cy: 215 };

test('point_at_element points at the exact spot and outlines the element, with no vision model needed', async () => {
  const overlay = fakeOverlay();
  const tools = Object.fromEntries(buildTools({ mac: { ...fakeMac, uiLocate: async () => frame }, overlay, getScale: () => 1, visionCapable: false }).map((t) => [t.name, t]));
  assert.ok(tools.point_at_element && tools.guide_step && tools.draw_on_screen, 'available to text-only models (drawing can anchor to element names)');
  const out = await tools.point_at_element.run({ app: 'Notes', name: 'New Note', label: 'Here' });
  assert.match(out, /Pointed at "New Note" in Notes/);
  assert.deepEqual(overlay.calls[0], ['point', 140, 215, 'Here']);
  assert.deepEqual(overlay.calls[1], ['draw', [{ type: 'box', x: 100, y: 200, w: 80, h: 30, label: '' }], { add: true }]);
});

test('draw_on_screen converts screenshot pixels with the scale and the display origin, and can clear', async () => {
  const overlay = fakeOverlay();
  const tools = Object.fromEntries(buildTools({ mac: fakeMac, overlay, getScale: () => 2, getOrigin: () => ({ x: 1440, y: 0 }) }).map((t) => [t.name, t]));
  const out = await tools.draw_on_screen.run({ shapes: [{ type: 'box', x: 10, y: 10, w: 50, h: 20, label: 'Save' }], add: true });
  assert.match(out, /Drew 1 mark\./);
  assert.deepEqual(overlay.calls[0][1][0], { type: 'box', x: 1460, y: 20, w: 100, h: 40, label: 'Save' });
  assert.deepEqual(overlay.calls[0][2], { add: true });
  assert.equal(await tools.draw_on_screen.run({ clear: true }), 'Cleared the marks.');
  assert.deepEqual(overlay.calls.at(-1), ['clear']);
  await assert.rejects(() => tools.draw_on_screen.run({ shapes: [{ type: 'star', x: 1, y: 1 }] }), /type must be one of/);
});

test('guide_step starts a guide once, with a target for the first step from an element or a screenshot spot', async () => {
  const overlay = fakeOverlay();
  const tools = Object.fromEntries(buildTools({ mac: { ...fakeMac, uiLocate: async () => frame }, overlay, getScale: () => 2, getOrigin: () => ({ x: 10, y: 0 }) }).map((t) => [t.name, t]));
  const texts = ['Open System Settings', 'Click Displays', 'Turn on Night Shift'];
  const a = await tools.guide_step.run({ steps: texts.map((text) => ({ text })), current: 2, app: 'System Settings', name: 'Displays' });
  assert.match(a, /step 2 of 3/i);
  assert.match(a, /do not call guide_step again/);
  assert.deepEqual(overlay.calls[0][1], { steps: texts, current: 1, total: 3 });
  assert.deepEqual(overlay.calls[0][2], { x: 140, y: 215 });
  assert.deepEqual(overlay.calls[0][3], { type: 'box', x: 100, y: 200, w: 80, h: 30, label: '' });
  await tools.guide_step.run({ steps: texts, current: 3, x: 50, y: 40 });
  assert.deepEqual(overlay.calls[1][2], { x: 110, y: 80 });
  assert.equal(overlay.calls[1][3].type, 'circle', 'a spot with no element gets a ring');
  await tools.guide_step.run({ steps: texts, current: 1 });
  assert.equal(overlay.calls[2][2], null, 'no target: the card alone');
  await assert.rejects(() => tools.guide_step.run({ steps: [], current: 1 }), /non-empty/);
});

test('draw_on_screen outlines a named element exactly, and mixes with screenshot-pixel shapes', async () => {
  const overlay = fakeOverlay();
  const tools = Object.fromEntries(buildTools({ mac: { ...fakeMac, uiLocate: async () => frame }, overlay, getScale: () => 2, getOrigin: () => ({ x: 0, y: 0 }) }).map((t) => [t.name, t]));
  const out = await tools.draw_on_screen.run({ shapes: [{ type: 'box', app: 'Notes', name: 'New Note', label: 'Here' }, { type: 'circle', app: 'Notes', name: 'New Note' }, { type: 'text', x: 5, y: 5, text: 'Hi' }] });
  assert.match(out, /Drew 3 marks/);
  const drawn = overlay.calls[0][1];
  assert.deepEqual(drawn[0], { type: 'box', x: 100, y: 200, w: 80, h: 30, label: 'Here' });
  assert.equal(drawn[1].type, 'circle');
  assert.deepEqual([drawn[1].x, drawn[1].y], [140, 215]);
  assert.deepEqual(drawn[2], { type: 'text', x: 10, y: 10, text: 'Hi' });
});

test('the show-me tools say so plainly when Relay cursor is turned off', async () => {
  const off = { point: async () => false, draw: async () => false, guide: async () => false, clear() {} };
  const tools = Object.fromEntries(buildTools({ mac: { ...fakeMac, uiLocate: async () => frame }, overlay: off, getScale: () => 1 }).map((t) => [t.name, t]));
  assert.match(await tools.point_at_element.run({ app: 'A', name: 'B' }), /turned off/);
  assert.match(await tools.draw_on_screen.run({ shapes: [{ type: 'text', x: 1, y: 1, text: 'a' }] }), /turned off/);
  assert.match(await tools.guide_step.run({ steps: ['a'], current: 1 }), /turned off/);
});

test('the system prompt tells the model how to show things on screen', () => {
  const p = buildSystemPrompt({});
  assert.ok(p.includes('point_at_element') && p.includes('guide_step') && p.includes('draw_on_screen'));
});

// ---- the area the user marked with the mark key
test('see_marked_area gives a vision model the picture, a text-only model the text, and says so when nothing is marked', async () => {
  const mark = { mediaType: 'image/jpeg', data: 'AAAA', width: 300, height: 200, box: { x: 10, y: 20, w: 120, h: 80 } };
  const mk = (extra) => Object.fromEntries(buildTools({ mac: { ...fakeMac, readText: async () => 'Total: $42' }, overlay: null, getScale: () => 1, ...extra }).map((t) => [t.name, t]));
  const seeing = await mk({ getMark: () => mark }).see_marked_area.run({});
  assert.deepEqual(seeing.image, { mediaType: 'image/jpeg', data: 'AAAA' });
  assert.match(seeing.text, /120x80 points drawn around 10,20/);
  const blind = await mk({ getMark: () => mark, visionCapable: false }).see_marked_area.run({});
  assert.match(blind, /Text in the area the user marked/);
  assert.match(blind, /Total: \$42/);
  assert.match(await mk({}).see_marked_area.run({}), /has not marked anything/);
});

test('the request context says when the user marked something', () => {
  const { buildContext, buildSystemPrompt } = require('../src/main/agent/system-prompt');
  assert.match(buildContext({ mark: { ageSec: 7, w: 120.4, h: 80 } }), /marked an area of their screen 7 seconds ago \(120x80 points\)\. Call see_marked_area/);
  assert.ok(!buildContext({}).includes('marked'));
  assert.match(buildSystemPrompt({ mark: { ageSec: 1, w: 5, h: 5 } }), /see_marked_area/);
  assert.match(buildSystemPrompt({}), /If the context says the user marked/, 'the standing rule is always there');
});

test('the Firefox tools pass their arguments to the extension, and closing several tabs asks first', async () => {
  const calls = [];
  const firefox = { isConnected: () => true, call: async (m, p) => { calls.push([m, p]); return { ok: true }; } };
  const t = Object.fromEntries(buildTools({ mac: fakeMac, getScale: () => 1, firefox }).map((x) => [x.name, x]));
  for (const n of ['firefox_tabs', 'firefox_switch_tab', 'firefox_open', 'firefox_read_page', 'firefox_click', 'firefox_type', 'firefox_press', 'firefox_scroll', 'firefox_navigate', 'firefox_close_tabs', 'firefox_screenshot']) assert.ok(t[n], n);
  await t.firefox_click.run({ index: 3 });
  await t.firefox_type.run({ index: 1, text: 'hi', submit: true });
  await t.firefox_navigate.run({ action: 'back' });
  await t.firefox_open.run({ url: 'github.com', background: true });
  assert.deepEqual(calls.map((c) => c[0]), ['page.click', 'page.type', 'tabs.back', 'tabs.open']);
  assert.equal(calls[3][1].background, true);
  assert.equal(t.firefox_close_tabs.confirm({ id: 5 }), null); // one tab by id is quiet
  assert.match(t.firefox_close_tabs.confirm({ match: 'amazon' }), /amazon/);
  assert.match(t.firefox_close_tabs.confirm({ duplicates: true }), /duplicate/);
});
