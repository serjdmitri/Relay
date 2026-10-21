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
