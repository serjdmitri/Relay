const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

function defaultExec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').toString().trim();
        return reject(new Error(msg || `${cmd} failed`));
      }
      resolve(stdout.toString().replace(/\n$/, ''));
    });
  });
}

// AppleScript string literal
const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

const KEY_CODES = {
  return: 36, enter: 36, tab: 48, space: 49, delete: 51, backspace: 51, escape: 53, esc: 53,
  left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111
};
const MOD_NAMES = { cmd: 'command down', command: 'command down', ctrl: 'control down', control: 'control down', alt: 'option down', option: 'option down', opt: 'option down', shift: 'shift down' };

// Builds the AppleScript for a key combo like "cmd+shift+t" or "enter".
function keyScript(combo) {
  const parts = String(combo).toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
  const key = parts.pop();
  const mods = parts.map((m) => {
    if (!MOD_NAMES[m]) throw new Error(`Unknown modifier: ${m}`);
    return MOD_NAMES[m];
  });
  const using = mods.length ? ` using {${mods.join(', ')}}` : '';
  if (KEY_CODES[key] !== undefined) return `tell application "System Events" to key code ${KEY_CODES[key]}${using}`;
  if (key.length === 1) return `tell application "System Events" to keystroke ${q(key)}${using}`;
  throw new Error(`Unknown key: ${key}`);
}

// AppleScript that builds a date from numeric parts. Avoids locale-dependent date parsing.
function dateScript(varName, iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) throw new Error(`Bad date "${iso}". Use YYYY-MM-DD or YYYY-MM-DDTHH:MM.`);
  const [, y, mo, d, h = '9', mi = '0'] = m;
  return [
    `set ${varName} to current date`,
    `set day of ${varName} to 1`,
    `set year of ${varName} to ${+y}`,
    `set month of ${varName} to ${+mo}`,
    `set day of ${varName} to ${+d}`,
    `set time of ${varName} to ${+h * 3600 + +mi * 60}`
  ];
}

function createMac({ exec = defaultExec, clipboard, capture, getDisplay } = {}) {
  const osa = (script, { signal } = {}) => {
    const lines = Array.isArray(script) ? script : String(script).split('\n');
    const args = [];
    for (const l of lines) args.push('-e', l);
    return exec('osascript', args, { signal });
  };
  const jxa = (script, { signal } = {}) => exec('osascript', ['-l', 'JavaScript', '-e', script], { signal });
  const lines = (s) => (s ? s.split('\n').filter(Boolean) : []);

  return {
    osa,
    jxa,
    keyScript,

    async frontmostApp() {
      return osa('tell application "System Events" to get name of first application process whose frontmost is true');
    },

    async listApps() {
      const out = await osa('tell application "System Events" to get name of (processes where background only is false)');
      return out.split(', ').map((s) => s.trim()).filter(Boolean);
    },

    openApp: (name) => exec('open', ['-a', name]).then(() => `Opened ${name}.`),

    async quitApp(name) {
      await osa(`tell application ${q(name)} to quit`);
      return `Quit ${name}.`;
    },

    async focusApp(name) {
      await osa(`tell application ${q(name)} to activate`);
      return `Focused ${name}.`;
    },

    async openUrl(url, app = 'Firefox') {
      if (!/^(https?:|mailto:)/i.test(url)) throw new Error('Only http, https and mailto URLs are allowed.');
      await exec('open', ['-a', app, url]);
      return `Opened ${url} in ${app}.`;
    },

    async openPath(p) {
      const full = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
      if (!fs.existsSync(full)) throw new Error(`Path does not exist: ${full}`);
      await exec('open', [full]);
      return `Opened ${full}.`;
    },

    async revealPath(p) {
      const full = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
      if (!fs.existsSync(full)) throw new Error(`Path does not exist: ${full}`);
      await exec('open', ['-R', full]);
      return `Revealed ${full} in Finder.`;
    },

    async trashPath(p) {
      const full = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
      if (!fs.existsSync(full)) throw new Error(`Path does not exist: ${full}`);
      await osa(`tell application "Finder" to delete POSIX file ${q(full)}`);
      return `Moved ${full} to the Trash.`;
    },

    async listDir(p) {
      const full = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
      const entries = fs.readdirSync(full, { withFileTypes: true }).slice(0, 200);
      return entries.map((e) => (e.isDirectory() ? e.name + '/' : e.name)).join('\n') || '(empty)';
    },

    // Notes
    async notesCreate(title, body = '') {
      const html = `<h1>${esc(title)}</h1>` + esc(body).replace(/\n/g, '<br>');
      await osa(['tell application "Notes"', `make new note with properties {body:${q(html)}}`, 'end tell']);
      return `Created note "${title}".`;
    },
    async notesList(limit = 20) {
      return osa([
        'tell application "Notes"', 'set out to {}', 'set n to count of notes', `if n > ${+limit} then set n to ${+limit}`,
        'repeat with i from 1 to n', 'set end of out to name of note i', 'end repeat',
        'set AppleScript\'s text item delimiters to linefeed', 'return out as text', 'end tell'
      ]);
    },
    async notesRead(title) {
      return osa(['tell application "Notes"', `set r to notes whose name contains ${q(title)}`, 'if (count of r) = 0 then return "No matching note."', 'return plaintext of item 1 of r', 'end tell']);
    },
    async notesAppend(title, text) {
      return osa([
        'tell application "Notes"', `set r to notes whose name is ${q(title)}`, 'if (count of r) = 0 then return "No note with that exact title."',
        `set body of item 1 of r to (body of item 1 of r) & ${q('<br>' + esc(text).replace(/\n/g, '<br>'))}`, 'return "Appended."', 'end tell'
      ]);
    },

    // Reminders
    async remindersAdd(title, due, list) {
      const script = ['tell application "Reminders"'];
      script.push(list ? `set theList to list ${q(list)}` : 'set theList to default list');
      const props = [`name:${q(title)}`];
      if (due) {
        script.push(...dateScript('d', due));
        props.push('due date:d');
      }
      script.push(`tell theList to make new reminder with properties {${props.join(', ')}}`, 'end tell');
      await osa(script);
      return `Added reminder "${title}"${due ? ' due ' + due : ''}.`;
    },
    async remindersList() {
      const out = await osa([
        'tell application "Reminders"', 'set out to {}',
        'repeat with r in (reminders whose completed is false)', 'set end of out to name of r', 'end repeat',
        'set AppleScript\'s text item delimiters to linefeed', 'return out as text', 'end tell'
      ]);
      return out || 'No open reminders.';
    },
    async remindersComplete(title) {
      return osa(['tell application "Reminders"', `set r to (reminders whose name is ${q(title)} and completed is false)`, 'if (count of r) = 0 then return "No open reminder with that exact name."', 'set completed of item 1 of r to true', 'return "Completed."', 'end tell']);
    },

    // Calendar
    async calendarEvents(days = 1) {
      const out = await osa([
        'tell application "Calendar"', 'set s to current date', 'set time of s to 0', `set e to s + ${+days} * days`, 'set out to {}',
        'repeat with c in calendars', 'repeat with ev in (every event of c whose start date is greater than or equal to s and start date is less than e)',
        'set end of out to (summary of ev) & " | " & (start date of ev as string)', 'end repeat', 'end repeat',
        'set AppleScript\'s text item delimiters to linefeed', 'return out as text', 'end tell'
      ]);
      return out || 'No events.';
    },
    async calendarCreate(title, start, end) {
      const script = ['tell application "Calendar"', ...dateScript('s', start)];
      if (end) script.push(...dateScript('e', end));
      else script.push('set e to s + 1 * hours');
      // calendar 1 is often a read-only subscription (Holidays, Birthdays), so pick a writable one
      script.push('set c to first calendar whose writable is true', 'tell c to make new event with properties {summary:' + q(title) + ', start date:s, end date:e}', 'end tell');
      await osa(script);
      return `Created event "${title}" at ${start}.`;
    },

    // Messages
    async messagesSend(to, text) {
      await osa([
        'tell application "Messages"', 'set s to 1st service whose service type = iMessage', `set b to buddy ${q(to)} of s`, `send ${q(text)} to b`, 'end tell'
      ]);
      return `Sent "${text}" to ${to}.`;
    },

    // Input
    async typeText(text) {
      if (!clipboard) throw new Error('Clipboard unavailable.');
      const prevText = clipboard.readText();
      clipboard.writeText(text);
      await osa('tell application "System Events" to keystroke "v" using {command down}');
      await new Promise((r) => setTimeout(r, 250));
      clipboard.writeText(prevText);
      return `Typed ${text.length} characters.`;
    },
    async pressKeys(combo) {
      await osa(keyScript(combo));
      return `Pressed ${combo}.`;
    },
    async click(x, y, { double = false, right = false } = {}) {
      const [btnDown, btnUp, btn] = right ? ['kCGEventRightMouseDown', 'kCGEventRightMouseUp', 'kCGMouseButtonRight'] : ['kCGEventLeftMouseDown', 'kCGEventLeftMouseUp', 'kCGMouseButtonLeft'];
      await jxa(`
ObjC.import('CoreGraphics');
var p = $.CGPointMake(${+x}, ${+y});
function post(t, n) { var e = $.CGEventCreateMouseEvent(null, t, p, $.${btn}); $.CGEventSetIntegerValueField(e, $.kCGMouseEventClickState, n); $.CGEventPost($.kCGHIDEventTap, e); }
post($.kCGEventMouseMoved, 1);
delay(0.05);
for (var i = 1; i <= ${double ? 2 : 1}; i++) { post($.${btnDown}, i); post($.${btnUp}, i); }
`);
      return `Clicked at ${Math.round(x)},${Math.round(y)}.`;
    },
    async scroll(dy) {
      await jxa(`ObjC.import('CoreGraphics'); var e = $.CGEventCreateScrollWheelEvent2(null, $.kCGScrollEventUnitLine, 1, ${Math.round(dy)}, 0, 0); $.CGEventPost($.kCGHIDEventTap, e);`);
      return `Scrolled ${dy > 0 ? 'up' : 'down'}.`;
    },

    // UI scripting through the accessibility tree
    async uiList(app) {
      const out = await osa([
        'tell application "System Events"', `tell process ${q(app)}`, 'set out to {}', 'try', 'set els to entire contents of window 1', 'on error', 'return "No window."', 'end try',
        'repeat with e in els', 'try', 'set r to role of e', 'set n to name of e',
        'if n is not missing value and n is not "" then set end of out to r & " | " & n', 'end try', 'end repeat',
        'set AppleScript\'s text item delimiters to linefeed', 'return out as text', 'end tell', 'end tell'
      ]);
      return lines(out).slice(0, 150).join('\n') || 'No named UI elements found.';
    },
    async uiClick(app, name) {
      const out = await osa([
        'tell application "System Events"', `tell process ${q(app)}`, 'set els to entire contents of window 1',
        'repeat with e in els', 'try', `if name of e is ${q(name)} then`, 'click e', 'return "clicked"', 'end if', 'end try', 'end repeat',
        'return "not found"', 'end tell', 'end tell'
      ]);
      if (out !== 'clicked') throw new Error(`No UI element named "${name}" in ${app}. Use ui_list to see what exists.`);
      return `Clicked "${name}" in ${app}.`;
    },
    async menuClick(app, menuPath) {
      if (!Array.isArray(menuPath) || menuPath.length < 2) throw new Error('menu_path needs at least [menu, item].');
      const [top, ...rest] = menuPath;
      let target = `menu item ${q(rest[rest.length - 1])}`;
      let chain = `of menu 1 of menu bar item ${q(top)} of menu bar 1`;
      for (let i = rest.length - 2; i >= 0; i--) chain = `of menu 1 of menu item ${q(rest[i])} ` + chain;
      await osa(['tell application "System Events"', `tell process ${q(app)}`, `click ${target} ${chain}`, 'end tell', 'end tell']);
      return `Clicked menu ${menuPath.join(' > ')} in ${app}.`;
    },

    async screenshot() {
      if (!capture) throw new Error('Screen capture unavailable.');
      return capture();
    },

    async setVolume(n) {
      await osa(`set volume output volume ${Math.max(0, Math.min(100, Math.round(n)))}`);
      return `Volume set to ${n}.`;
    },
    async toggleDarkMode() {
      await osa('tell application "System Events" to tell appearance preferences to set dark mode to not dark mode');
      return 'Toggled dark mode.';
    },

    async runShell(command) {
      return exec('/bin/zsh', ['-lc', command], { timeout: 60000 });
    },
    async runAppleScript(script, opts) {
      return osa(script, opts);
    }
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

module.exports = { createMac, keyScript, dateScript, q, defaultExec };
