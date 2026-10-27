const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLayoutCommand, fitFrame, Layouts } = require('../src/main/layouts');
const { parseFocusCommand, FocusMode, FOCUS_HELP } = require('../src/main/focus');
const { parseOcrCommand, toLines, plainText, toTable, toTsv, toCsv } = require('../src/main/ocr');

test('layouts: saving, restoring, listing and forgetting are understood', () => {
  const T = (t) => parseLayoutCommand(t);
  assert.deepEqual(T('save this as my study layout'), { type: 'layout-save', name: 'study' });
  assert.deepEqual(T('remember this layout as coding'), { type: 'layout-save', name: 'coding' });
  assert.deepEqual(T('set up my study layout'), { type: 'layout-restore', name: 'study' });
  assert.deepEqual(T('arrange my windows for study'), { type: 'layout-restore', name: 'study' });
  assert.deepEqual(T('switch to my design work setup'), { type: 'layout-restore', name: 'design work' });
  assert.deepEqual(T('what layouts do i have'), { type: 'layout-list' });
  assert.deepEqual(T('forget my study layout'), { type: 'layout-forget', name: 'study' });
  for (const t of ['open my notes', 'save this note', 'open safari window', 'save it', 'set up a timer']) assert.equal(T(t), null, t);
});

test('layouts: a window that is off every screen is brought back, and one that is too big is shrunk', () => {
  const one = [{ workArea: { x: 0, y: 25, width: 1440, height: 875 } }];
  assert.deepEqual(fitFrame({ x: 100, y: 100, w: 600, h: 400 }, one), { x: 100, y: 100, w: 600, h: 400 });
  assert.deepEqual(fitFrame({ x: 2000, y: 100, w: 600, h: 400 }, one), { x: 840, y: 100, w: 600, h: 400 }, 'from an unplugged screen on the right');
  assert.deepEqual(fitFrame({ x: 0, y: 0, w: 3000, h: 2000 }, one), { x: 0, y: 25, w: 1440, h: 875 });
});

function fakeStore(data = {}) { return { data, get: (k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), data), save() {} }; }

test('layouts: remembers the windows, restores them (opening what is not running), and can undo', async () => {
  const store = fakeStore();
  const moved = []; const opened = [];
  let windows = [{ app: 'Safari', x: 0, y: 25, w: 700, h: 800 }, { app: 'Notes', x: 700, y: 25, w: 740, h: 400 }, { app: 'Relay', x: 5, y: 5, w: 5, h: 5 }];
  const mac = { windowList: async () => windows, listApps: async () => ['Safari', 'Finder'], openApp: async (a) => { opened.push(a); }, setWindowFrame: async (a, r) => { moved.push([a, r]); return r; } };
  const L = new Layouts({ store, mac, displays: () => [{ workArea: { x: 0, y: 25, width: 1440, height: 875 } }], sleep: async () => {} });
  const saved = await L.remember('Study');
  assert.match(saved.reply, /Saved your Study layout: 2 windows \(Safari, Notes\)/);
  assert.equal(store.data.layouts[0].windows.length, 2, 'Relay itself is not part of a layout');
  windows = [{ app: 'Safari', x: 300, y: 300, w: 500, h: 500 }];
  const r = await L.restore('study');
  assert.match(r.reply, /Set up your Study layout: 2 windows, opened Notes\./);
  assert.deepEqual(opened, ['Notes']);
  assert.deepEqual(moved.map((m) => m[0]), ['Safari', 'Notes']);
  moved.length = 0;
  assert.match(await r.undo(), /Put the windows back/);
  assert.deepEqual(moved, [['Safari', { x: 300, y: 300, w: 500, h: 500 }]]);
  assert.match((await L.restore('gaming')).reply, /do not have a layout called gaming\. You have: Study/);
  assert.match((await L.remember('study')).reply, /^Updated/);
  assert.equal(store.data.layouts.length, 1);
  assert.match(L.list(), /study \(1 window\)/);
  assert.match(L.forget('study'), /Forgot/);
  assert.match(L.list(), /no saved layouts/);
});

test('focus: the phrases', () => {
  const F = (t) => parseFocusCommand(t);
  assert.deepEqual(F('focus mode'), { type: 'focus-start', minutes: 0 });
  assert.deepEqual(F('focus mode for 25 minutes'), { type: 'focus-start', minutes: 25 });
  assert.deepEqual(F('start focus mode for an hour'), { type: 'focus-start', minutes: 60 });
  assert.deepEqual(F('i need to focus for 45 minutes'), { type: 'focus-start', minutes: 45 });
  assert.deepEqual(F('focus for 90 minutes'), { type: 'focus-start', minutes: 90 });
  assert.deepEqual(F('end focus mode'), { type: 'focus-end' });
  assert.deepEqual(F('i am done focusing'), { type: 'focus-end' });
  assert.deepEqual(F('how much time is left in focus mode'), { type: 'focus-status' });
  for (const t of ['focus on safari', 'focus for the exam', 'focus', 'switch to focus app', 'open focus']) assert.equal(F(t), null, t);
});

test('focus: closes the listed apps, runs the Shortcut if there is one, sets a timer, and ends by reopening them', async () => {
  const store = fakeStore({ settings: { focus: { apps: ['Slack', 'Messages'] } } });
  const log = [];
  const mac = { listApps: async () => ['Safari', 'Slack', 'Messages'], quitApp: async (a) => log.push(`quit ${a}`), openApp: async (a) => log.push(`open ${a}`), hasShortcut: async (n) => n === 'Relay Focus On' || n === 'Relay Focus Off', runShortcut: async (n) => log.push(`shortcut ${n}`) };
  const timers = { add: (s, label, extra) => { log.push(`timer ${s} ${extra.focus}`); return { id: 't1' }; }, cancel: (id) => log.push(`cancel ${id}`) };
  let now = 1000;
  const f = new FocusMode({ store, mac, timers, now: () => now });
  const r = await f.start({ minutes: 30 });
  assert.deepEqual(log, ['quit Slack', 'quit Messages', 'shortcut Relay Focus On', 'timer 1800 true']);
  assert.match(r.reply, /Focus mode on for 30 minutes\. Closed Slack, Messages\. Notifications are off\./);
  assert.equal(f.active, true);
  now += 10 * 60000;
  assert.match(f.status(), /20 minutes left/);
  log.length = 0;
  const e = await f.end({});
  assert.deepEqual(log, ['cancel t1', 'shortcut Relay Focus Off', 'open Slack', 'open Messages']);
  assert.match(e.reply, /Focus mode off\. Notifications are back\. Reopened Slack, Messages\./);
  assert.equal(f.active, false);
  assert.match((await f.end({})).reply, /not on/);
});

test('focus: without the Shortcut it says how to get notifications silenced, and a second start replaces the first', async () => {
  const store = fakeStore({});
  const mac = { listApps: async () => ['Mail'], quitApp: async () => {}, openApp: async () => {}, hasShortcut: async () => false, runShortcut: async () => { throw new Error('no'); } };
  const timers = { add: () => ({ id: 'x' }), cancel() {} };
  const f = new FocusMode({ store, mac, timers });
  const r = await f.start({});
  assert.match(r.reply, /Focus mode on for 25 minutes\. Closed Mail\./);
  assert.ok(r.reply.endsWith(FOCUS_HELP));
  assert.ok(await f.start({ minutes: 5 }), 'starting again is fine');
});

test('ocr: the phrases', () => {
  const O = (t) => parseOcrCommand(t);
  assert.deepEqual(O('copy the text from my last screenshot'), { type: 'ocr', source: 'screenshot', mode: 'text' });
  assert.deepEqual(O('copy the text on my screen'), { type: 'ocr', source: 'screen', mode: 'text' });
  assert.deepEqual(O('grab the text from the screen'), { type: 'ocr', source: 'screen', mode: 'text' });
  assert.deepEqual(O('turn this table into a spreadsheet'), { type: 'ocr', source: 'screen', mode: 'table' });
  assert.deepEqual(O('turn the table in my last screenshot into a spreadsheet'), { type: 'ocr', source: 'screenshot', mode: 'table' });
  for (const t of ['copy the text', 'what is on my screen', 'turn this into a table', 'copy the file from my desktop']) assert.equal(O(t), null, t);
});

const piece = (text, x, y, w = 0.1, h = 0.02) => ({ text, x, y, w, h });

test('ocr: pieces become lines in reading order, and a grid becomes a table', () => {
  const obs = [piece('Total', 0.6, 0.30), piece('Item', 0.1, 0.20), piece('Name', 0.35, 0.201), piece('Qty', 0.6, 0.199), piece('Apples', 0.1, 0.25), piece('3', 0.6, 0.251), piece('Pears', 0.1, 0.30), piece('7', 0.6, 0.299),
    piece('Fruit order', 0.1, 0.05)];
  assert.equal(plainText(obs).split('\n')[0], 'Fruit order');
  assert.equal(toLines(obs).length, 4);
  const t = toTable(obs);
  assert.equal(t.columns, 2, 'the title and the stray cell do not make columns');
  assert.deepEqual(t.rows[0].length, 2);
  assert.equal(toTsv([['a', 'b c'], ['1', '2']]), 'a\tb c\n1\t2');
  assert.equal(toCsv([['x,y', 'say "hi"'], ['1', '2']]), '"x,y","say ""hi"""\n1,2');
  assert.equal(toTable([piece('Only', 0.1, 0.1), piece('lines', 0.1, 0.2)]), null, 'one column is not a table');
  const grid = [];
  [['Name', 'Qty', 'Price'], ['Apples', '3', '1.20'], ['Pears', '7', '0.80']].forEach((row, r) => row.forEach((c, i) => grid.push(piece(c, 0.1 + i * 0.25, 0.2 + r * 0.05))));
  assert.deepEqual(toTable(grid).rows, [['Name', 'Qty', 'Price'], ['Apples', '3', '1.20'], ['Pears', '7', '0.80']]);
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const { latestScreenshot } = require('../src/main/ocr');
const { parseQuick, runQuick } = require('../src/main/quick');

test('the newest screenshot is found, ignoring other files and screen recordings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-shots-'));
  const mk = (n, t) => { const p = path.join(dir, n); fs.writeFileSync(p, 'x'); fs.utimesSync(p, t, t); };
  mk('Screenshot 2026-10-27 at 9.00.00 AM.png', 1000); mk('Screenshot 2026-10-27 at 10.00.00 AM.png', 2000); mk('Screen Recording 2026.mov', 3000); mk('notes.png', 4000);
  assert.equal(path.basename(latestScreenshot(fs, [dir])), 'Screenshot 2026-10-27 at 10.00.00 AM.png');
  assert.equal(latestScreenshot(fs, ['/nowhere', fs.mkdtempSync(path.join(os.tmpdir(), 'relay-none-'))]), null);
});

test('quick commands route layouts, focus and screen text, and leave them to the model when the Mac helpers are missing', async () => {
  assert.equal(parseQuick('save this as my study layout').type, 'layout-save');
  assert.equal(parseQuick('focus mode for 25 minutes').type, 'focus-start');
  assert.equal(parseQuick('copy the text from my last screenshot').type, 'ocr');
  assert.equal(parseQuick('focus on safari').type, 'focus-app', 'switching apps still works');
  assert.equal(parseQuick('open Notes').type, 'open-app');
  assert.equal(await runQuick(parseQuick('focus mode'), {}, {}), null);
  const ctx = {
    layouts: { remember: async (n) => ({ reply: `Saved ${n}` }), restore: async (n) => ({ reply: `Restored ${n}`, undo: async () => 'back' }), list: () => 'list', forget: () => 'gone' },
    focus: { start: async ({ minutes }) => ({ reply: `on ${minutes}`, undo: async () => 'off' }), end: async () => ({ reply: 'ended' }), status: () => 'left' },
    ocr: async (c) => `${c.source}/${c.mode}`
  };
  assert.equal((await runQuick(parseQuick('save this as my study layout'), {}, ctx)).reply, 'Saved study');
  const r = await runQuick(parseQuick('set up my study layout'), {}, ctx);
  assert.equal(r.reply, 'Restored study');
  assert.equal(await r.undo(), 'back');
  assert.equal((await runQuick(parseQuick('focus mode for 25 minutes'), {}, ctx)).reply, 'on 25');
  assert.equal((await runQuick(parseQuick('end focus mode'), {}, ctx)).reply, 'ended');
  assert.equal((await runQuick(parseQuick('turn this table into a spreadsheet'), {}, ctx)).reply, 'screen/table');
});
