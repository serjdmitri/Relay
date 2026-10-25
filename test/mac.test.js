const test = require('node:test');
const assert = require('node:assert/strict');
const { createMac, keyScript, dateScript, q } = require('../src/main/agent/mac');
const { scriptNeedsConfirm } = require('../src/main/agent/safety');

function recorder(result = '') {
  const calls = [];
  return { calls, exec: async (cmd, args) => { calls.push({ cmd, args }); return typeof result === 'function' ? result(cmd, args) : result; } };
}

test('q escapes quotes and backslashes', () => {
  assert.equal(q('say "hi" \\ there'), '"say \\"hi\\" \\\\ there"');
});

test('keyScript builds modifiers, key codes and letters', () => {
  assert.equal(keyScript('cmd+shift+t'), 'tell application "System Events" to keystroke "t" using {command down, shift down}');
  assert.equal(keyScript('enter'), 'tell application "System Events" to key code 36');
  assert.equal(keyScript('cmd+down'), 'tell application "System Events" to key code 125 using {command down}');
  assert.throws(() => keyScript('hyper+x'), /Unknown modifier/);
  assert.throws(() => keyScript('cmd+banana'), /Unknown key/);
});

test('dateScript builds numeric dates and rejects garbage', () => {
  const s = dateScript('d', '2026-10-22T15:30');
  assert.ok(s.includes('set year of d to 2026'));
  assert.ok(s.includes('set month of d to 10'));
  assert.ok(s.includes('set day of d to 22'));
  assert.ok(s.includes(`set time of d to ${15 * 3600 + 30 * 60}`));
  assert.throws(() => dateScript('d', 'next thursday'), /Bad date/);
});

test('openUrl only allows web schemes and defaults to Firefox', async () => {
  const r = recorder();
  const mac = createMac({ exec: r.exec });
  await mac.openUrl('https://example.com');
  assert.deepEqual(r.calls[0], { cmd: 'open', args: ['-a', 'Firefox', 'https://example.com'] });
  await assert.rejects(() => mac.openUrl('file:///etc/passwd'), /Only http/);
  await assert.rejects(() => mac.openUrl('javascript:alert(1)'), /Only http/);
});

test('listApps parses System Events output', async () => {
  const mac = createMac({ exec: recorder('Claude, Finder, Firefox').exec });
  assert.deepEqual(await mac.listApps(), ['Claude', 'Finder', 'Firefox']);
});

test('osa passes each line as its own -e argument', async () => {
  const r = recorder('x');
  const mac = createMac({ exec: r.exec });
  await mac.notesCreate('Plan <1>', 'a\nb');
  const args = r.calls[0].args;
  assert.equal(r.calls[0].cmd, 'osascript');
  assert.equal(args.filter((a) => a === '-e').length, 3);
  assert.ok(args.join(' ').includes('Plan &lt;1&gt;'));
});

test('reminders with due date builds a date', async () => {
  const r = recorder();
  const mac = createMac({ exec: r.exec });
  await mac.remindersAdd('Call Dad', '2026-10-22T15:00');
  assert.ok(r.calls[0].args.join('\n').includes('due date:d'));
});

test('typeText pastes via clipboard and restores it', async () => {
  const r = recorder();
  const clip = { text: 'old', readText() { return this.text; }, writeText(t) { this.text = t; (this.log ||= []).push(t); } };
  const mac = createMac({ exec: r.exec, clipboard: clip });
  await mac.typeText('hello');
  assert.deepEqual(clip.log, ['hello', 'old']);
  assert.ok(r.calls[0].args.join(' ').includes('keystroke "v"'));
});

test('uiLocate reads an element frame and says so clearly when there is none', async () => {
  const found = createMac({ exec: recorder('100|200|80|30').exec });
  assert.deepEqual(await found.uiLocate('Notes', 'New Note'), { x: 100, y: 200, w: 80, h: 30, cx: 140, cy: 215 });
  const none = createMac({ exec: recorder('not found').exec });
  await assert.rejects(() => none.uiLocate('Notes', 'Nope'), /No UI element named "Nope" in Notes/);
  const rec = recorder('1|2|3|4');
  await createMac({ exec: rec.exec }).uiLocate('Notes', 'Say "hi"');
  assert.ok(rec.calls[0].args.join(' ').includes('name of e is "Say \\"hi\\""'), 'the name is quoted safely');
});

test('uiClick surfaces a clear error when nothing matches', async () => {
  const mac = createMac({ exec: recorder('not found').exec });
  await assert.rejects(() => mac.uiClick('Notes', 'Nope'), /No UI element named "Nope"/);
});

test('menuClick builds a nested menu path', async () => {
  const r = recorder();
  const mac = createMac({ exec: r.exec });
  await mac.menuClick('Firefox', ['View', 'Developer', 'Developer Tools']);
  const script = r.calls[0].args.join('\n');
  assert.ok(script.includes('menu item "Developer Tools" of menu 1 of menu item "Developer" of menu 1 of menu bar item "View" of menu bar 1'));
});

test('applescript safety classifier', () => {
  assert.equal(scriptNeedsConfirm('tell application "Notes" to get name of notes'), false);
  assert.equal(scriptNeedsConfirm('tell application "Finder" to delete file x'), true);
  assert.equal(scriptNeedsConfirm('do shell script "rm -rf ~"'), true);
  assert.equal(scriptNeedsConfirm('tell app "Mail" to send m'), true);
});

test('reminders use tell-list form; calendar events go to a writable calendar', async () => {
  const r = recorder();
  const mac = createMac({ exec: r.exec });
  await mac.remindersAdd('Pay rent', '2026-11-01');
  assert.ok(r.calls[0].args.join('\n').includes('tell theList to make new reminder with properties {name:"Pay rent", due date:d}'));
  await mac.calendarCreate('Dentist', '2026-11-02T09:30');
  const cal = r.calls[1].args.join('\n');
  assert.ok(cal.includes('first calendar whose writable is true'));
  assert.ok(cal.includes('set e to s + 1 * hours'));
  assert.ok(!cal.includes('calendar 1'));
});

test('click and scroll go through JXA with the right event types', async () => {
  const r = recorder();
  const mac = createMac({ exec: r.exec });
  await mac.click(10, 20, { double: true });
  const jxa = r.calls[0].args.join(' ');
  assert.equal(r.calls[0].args[0], '-l');
  assert.ok(jxa.includes('CGPointMake(10, 20)') && jxa.includes('i <= 2'));
  await mac.click(1, 2, { right: true });
  assert.ok(r.calls[1].args.join(' ').includes('kCGEventRightMouseDown'));
});

test('typeText keeps an image that was on the clipboard', async () => {
  const written = [];
  const image = { isEmpty: () => false, tag: 'img' };
  const clip = { text: '', readText() { return this.text; }, writeText(t) { this.text = t; written.push(['text', t]); }, readImage: () => image, write(d) { written.push(['write', d]); }, clear() { written.push(['clear']); } };
  const mac = createMac({ exec: recorder().exec, clipboard: clip });
  await mac.typeText('hi');
  assert.deepEqual(written[written.length - 1], ['write', { image }]);
});

test('selectedText copies, reads, and puts the clipboard back', async () => {
  let text = 'before';
  const clip = { readText: () => text, writeText: (t) => { text = t; }, clear() { text = ''; } };
  const r = recorder(() => { text = 'the selection'; return ''; });
  const mac = createMac({ exec: r.exec, clipboard: clip });
  assert.equal(await mac.selectedText(), 'the selection');
  assert.equal(text, 'before');
  assert.ok(r.calls[0].args.join(' ').includes('keystroke "c"'));
  const none = createMac({ exec: recorder().exec, clipboard: { readText: () => text, writeText: (t) => { text = t; } } });
  assert.equal(await none.selectedText(), '');
});

test('voices: parse the say listing and pick a sensible one', () => {
  const { parseVoices, pickVoice, speakable } = require('../src/main/voice');
  const out = [
    'Albert              en_US    # Hello! My name is Albert.',
    'Samantha (English (US)) en_US    # Hello! My name is Samantha.',
    'Daniel              en_GB    # Hello! My name is Daniel.',
    'Tara (English (India)) en_IN    # Hi, I’m Siri!',
    'Zoe (Premium)       en_US    # Hello! My name is Zoe.',
    'Amélie             fr_CA    # Bonjour'
  ].join('\n');
  const v = parseVoices(out);
  assert.deepEqual(v.map((x) => x.kind), ['Novelty', 'Standard', 'Standard', 'Siri', 'Premium', 'Standard']);
  assert.equal(pickVoice(v, 'auto', 'en_US'), 'Zoe (Premium)');
  assert.equal(pickVoice(v.slice(0, 4), 'auto', 'en_US'), 'Samantha (English (US))'); // a natural voice from another region is not used automatically
  assert.equal(pickVoice(v, 'Daniel', 'en_US'), 'Daniel');
  assert.equal(pickVoice(v, 'Gone', 'en_US'), 'Zoe (Premium)');
  assert.equal(speakable('**Done** 🎉 see https://x.co/a?b=1'), 'Done see a link');
});

// ---- the native accessibility helper (relay-ax) and reading text off the screen
function axMac(handler, extra = {}) {
  const calls = [];
  const exec = async (cmd, args) => { calls.push([cmd, ...args]); return handler(cmd, args); };
  return { calls, mac: createMac({ exec, axBin: process.execPath, ...extra }) };
}

test('with the helper, ui_list, locate and click use it instead of System Events', async () => {
  const { mac, calls } = axMac((cmd, args) => {
    if (args[0] === 'list') return 'AXButton | New Note';
    if (args[0] === 'find') return args[2] === 'Nope' ? 'not found' : '100.5|200|80|30|AXButton';
    if (args[0] === 'press') return 'pressed';
  });
  assert.equal(await mac.uiList('Notes'), 'AXButton | New Note');
  assert.deepEqual(await mac.uiLocate('Notes', 'New Note'), { x: 100.5, y: 200, w: 80, h: 30, cx: 140.5, cy: 215 });
  await assert.rejects(() => mac.uiLocate('Notes', 'Nope'), /No UI element named "Nope" in Notes/);
  assert.match(await mac.uiClick('Notes', 'New Note'), /Clicked "New Note"/);
  assert.ok(calls.every((c) => c[0] === process.execPath), 'never touched osascript');
});

test('locate reads the text off the screen when the accessibility tree has no such element', async () => {
  const shot = { data: Buffer.from('x').toString('base64'), width: 1000, height: 500 };
  const { mac } = axMac((cmd, args) => {
    if (args[0] === 'find') return 'not found';
    if (args[0] === 'ocr') return args[2] === 'Send' ? '0.5|0.2|0.1|0.04|Send' : 'not found';
  }, { capture: async () => shot, getView: () => ({ scale: 2, origin: { x: 100, y: 10 } }) });
  const f = await mac.locate('Claude', 'Send');
  assert.deepEqual([f.x, f.y, f.w, f.h], [1100, 210, 200, 40]);
  assert.deepEqual([f.cx, f.cy], [1200, 230]);
  await assert.rejects(() => mac.locate('Claude', 'Nowhere'), /No UI element named "Nowhere" in Claude/);
  await assert.rejects(() => mac.locate('Claude', 'Nowhere', { ocr: false }), /No UI element/);
});

test('if the helper is refused accessibility, the AppleScript way takes over', async () => {
  let n = 0;
  const exec = async (cmd, args) => {
    n++;
    if (cmd === process.execPath) throw new Error('Accessibility is not allowed for Relay.');
    return '5|6|7|8';
  };
  const mac = createMac({ exec, axBin: process.execPath });
  assert.deepEqual(await mac.uiLocate('Notes', 'X'), { x: 5, y: 6, w: 7, h: 8, cx: 8.5, cy: 10 }, 'the same call falls back');
  assert.equal(n, 2);
});
