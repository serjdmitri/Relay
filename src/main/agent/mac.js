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

// The clipboard as it was, so borrowing it for a paste or a copy does not lose an image or formatted text.
function clipSnapshot(clipboard) {
  return { text: clipboard.readText(), html: clipboard.readHTML?.(), rtf: clipboard.readRTF?.(), image: clipboard.readImage?.() };
}

function clipRestore(clipboard, s) {
  const data = {};
  if (s.text) data.text = s.text;
  if (s.html) data.html = s.html;
  if (s.rtf) data.rtf = s.rtf;
  if (s.image && !s.image.isEmpty()) data.image = s.image;
  const keys = Object.keys(data);
  if (keys.length === 1 && data.text) clipboard.writeText(data.text);
  else if (keys.length) clipboard.write(data);
  else if (clipboard.clear) clipboard.clear();
  else clipboard.writeText('');
}

const { parseFrame } = require('../overlayGeometry');

// axBin: native/relay-ax, which walks the accessibility tree directly and reads on-screen text (System Events needs tens of
// seconds on big or Electron apps). getView(): { scale, origin } of the last screenshot, to turn a text position into screen points.
function createMac({ exec = defaultExec, clipboard, capture, getDisplay, axBin = null, getView = () => ({ scale: 1, origin: { x: 0, y: 0 } }) } = {}) {
  let axRefused = false;
  const hasAx = () => !!axBin && !axRefused && fs.existsSync(axBin);
  const ax = async (args) => {
    try {
      return await exec(axBin, args, { timeout: 20000 });
    } catch (e) {
      if (/Accessibility is not allowed/.test(e.message)) axRefused = true; // the old, slower way still works
      throw e;
    }
  };
  const notFound = (app, name) => new Error(`No UI element named "${name}" in ${app}. Use ui_list to see what exists.`);

  // Where a text appears on the display, read from a screenshot. Works in apps whose accessibility tree is thin.
  const findText = async (text) => {
    if (!hasAx() || !capture) throw new Error('Reading text on screen is not available.');
    const shot = await capture();
    const file = path.join(os.tmpdir(), `relay-ocr-${process.pid}-${Date.now()}.jpg`);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    try {
      const out = await ax(['ocr', file, String(text)]);
      if (!out || out === 'not found') throw new Error(`Could not see "${text}" on the screen.`);
      const [nx, ny, nw, nh] = out.split('|').map(Number);
      if (![nx, ny, nw, nh].every(Number.isFinite)) throw new Error('Could not read where that text is.');
      const { scale, origin } = getView();
      const w = nw * shot.width * scale, h = nh * shot.height * scale;
      const x = origin.x + nx * shot.width * scale, y = origin.y + ny * shot.height * scale;
      return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
    } finally {
      fs.rmSync(file, { force: true });
    }
  };

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

    // app = null opens it in the default browser
    async openUrl(url, app = 'Firefox') {
      if (!/^(https?:|mailto:)/i.test(url)) throw new Error('Only http, https and mailto URLs are allowed.');
      await exec('open', app ? ['-a', app, url] : [url]);
      return `Opened ${url}${app ? ' in ' + app : ''}.`;
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
    // Like notesCreate, but returns the note's id so it can be deleted again (undo).
    async notesCreateId(title, body = '') {
      const html = `<h1>${esc(title)}</h1>` + esc(body).replace(/\n/g, '<br>');
      return osa(['tell application "Notes"', `set n to make new note with properties {body:${q(html)}}`, 'return id of n', 'end tell']);
    },
    async notesDeleteById(id) {
      await osa(['tell application "Notes"', `delete (first note whose id is ${q(id)})`, 'end tell']);
      return 'Deleted the note.';
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
    // Returns the reminder's id so it can be deleted again (undo). Sets both the due date and the alert time.
    async remindersAddId(title, due) {
      const script = ['tell application "Reminders"', 'set theList to default list'];
      const props = [`name:${q(title)}`];
      if (due) {
        script.push(...dateScript('d', due));
        props.push('due date:d', 'remind me date:d');
      }
      script.push(`set r to make new reminder at end of reminders of theList with properties {${props.join(', ')}}`, 'return id of r', 'end tell');
      return osa(script);
    },
    async remindersDeleteById(id) {
      await osa(['tell application "Reminders"', `delete (first reminder whose id is ${q(id)})`, 'end tell']);
      return 'Deleted the reminder.';
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
      const before = clipSnapshot(clipboard);
      clipboard.writeText(text);
      await osa('tell application "System Events" to keystroke "v" using {command down}');
      await new Promise((r) => setTimeout(r, 250));
      clipRestore(clipboard, before);
      return `Typed ${text.length} characters.`;
    },

    // What the user copied: text, or an image (as a JPEG no wider than 1400 pixels).
    async clipboardRead() {
      if (!clipboard) throw new Error('Clipboard unavailable.');
      const text = clipboard.readText();
      let image = null;
      const img = clipboard.readImage?.();
      if (img && !img.isEmpty()) {
        let i = img;
        if (i.getSize().width > 1400) i = i.resize({ width: 1400 });
        const size = i.getSize();
        image = { mediaType: 'image/jpeg', data: i.toJPEG(80).toString('base64'), width: size.width, height: size.height };
      }
      return { text, image };
    },

    async clipboardWrite(text) {
      if (!clipboard) throw new Error('Clipboard unavailable.');
      clipboard.writeText(String(text));
      return `Copied ${String(text).length} characters to the clipboard.`;
    },

    // The text selected in the front app: copy it, read it, put the clipboard back.
    async selectedText() {
      if (!clipboard) throw new Error('Clipboard unavailable.');
      const before = clipSnapshot(clipboard);
      const marker = `relay-selection-${Date.now()}-${Math.random()}`;
      clipboard.writeText(marker);
      try {
        await osa('tell application "System Events" to keystroke "c" using {command down}');
        for (let i = 0; i < 25; i++) {
          await new Promise((r) => setTimeout(r, 40));
          if (clipboard.readText() !== marker) break;
        }
        const got = clipboard.readText();
        return got === marker ? '' : got;
      } finally {
        clipRestore(clipboard, before);
      }
    },
    // Music and Spotify: op is play, pause, next or previous.
    async mediaControl(app, op) {
      const cmd = { play: 'play', pause: 'pause', next: 'next track', previous: 'previous track' }[op];
      if (!cmd) throw new Error(`Unknown media command: ${op}`);
      await osa(`tell application ${q(app)} to ${cmd}`);
      return `${op} sent to ${app}.`;
    },
    // The keyboard's media keys, for whatever app has them (a browser tab, for instance).
    async mediaKey(op) {
      const code = { play: 16, next: 17, previous: 18 }[op];
      if (code === undefined) throw new Error(`Unknown media key: ${op}`);
      await jxa(`ObjC.import('AppKit');
function post(down) { var f = down ? 0xa00 : 0xb00; var e = $.NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(14, $.NSMakePoint(0, 0), f, 0, 0, null, 8, (${code} << 16) | f, -1); $.CGEventPost(0, e.CGEvent); }
post(true); post(false);`);
      return `Pressed the ${op} key.`;
    },

    async batteryStatus() {
      const out = await exec('pmset', ['-g', 'batt']);
      const m = out.match(/(\d+)%;\s*([^;]+);(?:\s*(\d+:\d+) remaining)?/);
      if (!m) return null;
      const state = m[2].trim();
      const mins = m[3] ? m[3].split(':').map(Number) : null;
      return {
        percent: +m[1],
        state: /discharging/i.test(state) ? 'on battery power' : /charged/i.test(state) ? 'fully charged' : /charging/i.test(state) ? 'charging' : state.replace(/^finishing charge$/i, 'almost full'),
        remaining: mins ? `${mins[0] ? mins[0] + ' hour' + (mins[0] === 1 ? '' : 's') + (mins[1] ? ' ' : '') : ''}${mins[1] ? mins[1] + ' minute' + (mins[1] === 1 ? '' : 's') : ''}`.trim() : ''
      };
    },
    async lockScreen() {
      await osa('tell application "System Events" to keystroke "q" using {control down, command down}');
      return 'Locked the screen.';
    },
    async sleepDisplay() {
      await exec('pmset', ['displaysleepnow']);
      return 'Display asleep.';
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
      if (hasAx()) {
        try {
          return (await ax(['list', app, '2.5'])) || 'No named UI elements found.';
        } catch (e) {
          if (!axRefused) throw e;
        }
      }
      const out = await osa([
        'tell application "System Events"', `tell process ${q(app)}`, 'set out to {}', 'try', 'set els to entire contents of window 1', 'on error', 'return "No window."', 'end try',
        'repeat with e in els', 'try', 'set r to role of e', 'set n to name of e',
        'if n is not missing value and n is not "" then set end of out to r & " | " & n', 'end try', 'end repeat',
        'set AppleScript\'s text item delimiters to linefeed', 'return out as text', 'end tell', 'end tell'
      ]);
      return lines(out).slice(0, 150).join('\n') || 'No named UI elements found.';
    },
    async uiClick(app, name) {
      if (hasAx()) {
        try {
          const r = await ax(['press', app, name, '2.5']);
          if (r === 'pressed') return `Clicked "${name}" in ${app}.`;
          if (r === 'not found') throw notFound(app, name);
          const f = parseFrame((await ax(['find', app, name, '2.5'])).split('|').slice(0, 4).join('|')); // not pressable: click where it is
          await this.click(f.cx, f.cy);
          return `Clicked "${name}" in ${app}.`;
        } catch (e) {
          if (!axRefused) throw e;
        }
      }
      const out = await osa([
        'tell application "System Events"', `tell process ${q(app)}`, 'set els to entire contents of window 1',
        'repeat with e in els', 'try', `if name of e is ${q(name)} then`, 'click e', 'return "clicked"', 'end if', 'end try', 'end repeat',
        'return "not found"', 'end tell', 'end tell'
      ]);
      if (out !== 'clicked') throw new Error(`No UI element named "${name}" in ${app}. Use ui_list to see what exists.`);
      return `Clicked "${name}" in ${app}.`;
    },
    // Where a named element sits on screen, so Relay can point at it exactly (no screenshot needed).
    async uiLocate(app, name, { seconds = 2.5 } = {}) {
      if (hasAx()) {
        try {
          const out = await ax(['find', app, name, String(seconds)]);
          if (!out || out === 'not found') throw notFound(app, name);
          return parseFrame(out.split('|').slice(0, 4).join('|'));
        } catch (e) {
          if (!axRefused) throw e;
        }
      }
      const out = await osa([
        'tell application "System Events"', `tell process ${q(app)}`, 'set els to entire contents of window 1',
        'repeat with e in els', 'try', `if name of e is ${q(name)} then`, 'set p to position of e', 'set s to size of e',
        'return ((item 1 of p) as text) & "|" & ((item 2 of p) as text) & "|" & ((item 1 of s) as text) & "|" & ((item 2 of s) as text)',
        'end if', 'end try', 'end repeat', 'return "not found"', 'end tell', 'end tell'
      ]);
      if (!out || out === 'not found') throw new Error(`No UI element named "${name}" in ${app}. Use ui_list to see what exists.`);
      return parseFrame(out);
    },
    findText,
    // The tabs of a browser, read from its tab strip with no extension: [{ title, active }].
    async browserTabs(app = 'Firefox') {
      if (!hasAx()) throw new Error('Reading tabs needs the accessibility helper.');
      const out = String(await ax(['tabs', app, '2.5'])).trim();
      return out ? out.split('\n').map((l) => ({ active: l.startsWith('1|'), title: l.slice(2) })) : [];
    },
    // Brings the tab whose title has all of these words to the front, by pressing it in the tab strip.
    async switchBrowserTab(match, app = 'Firefox') {
      const words = String(match || '').toLowerCase().split(/\s+/).filter(Boolean);
      const tabs = await this.browserTabs(app);
      const hit = tabs.find((t) => words.every((w) => t.title.toLowerCase().includes(w)));
      if (!hit) throw new Error(`No tab matching "${match}". Open tabs: ${tabs.map((t) => t.title).slice(0, 15).join(' | ')}`);
      const r = await ax(['press', app, hit.title, '2.5']);
      if (!/pressed/.test(r)) throw new Error(`Could not switch to "${hit.title}".`);
      return hit.title;
    },
    // The text of the field being typed in, with the app it is in. null when there is none or it cannot be read.
    async focusedText() {
      if (!hasAx()) return null;
      const out = String(await ax(['focused']));
      const nl = out.indexOf('\n');
      if (nl < 0) return null;
      const value = out.slice(nl + 1).replace(/\n$/, '');
      return value === 'none' ? null : { app: out.slice(0, nl), text: value };
    },
    // All the text in a picture ({ data: base64 }), read on this Mac. For models that cannot see images.
    async readText(shot) {
      if (!hasAx()) return '';
      const file = path.join(os.tmpdir(), `relay-text-${process.pid}-${Date.now()}.jpg`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      try {
        return (await ax(['text', file])).trim();
      } finally {
        fs.rmSync(file, { force: true });
      }
    },
    // An element by name, else the same words read off the screen.
    async locate(app, name, { seconds = 2.5, ocr = true } = {}) {
      try {
        return await this.uiLocate(app, name, { seconds });
      } catch (e) {
        if (!ocr || !hasAx()) throw e;
        try {
          return await findText(name);
        } catch {
          throw e;
        }
      }
    },
    // Where an app's front window is: { x, y, w, h } in screen points.
    async windowFrame(app) {
      const out = await osa([
        'tell application "System Events"', `tell process ${q(app)}`, 'if (count of windows) is 0 then return "none"', 'set p to position of window 1', 'set s to size of window 1',
        'return ((item 1 of p) as text) & "|" & ((item 2 of p) as text) & "|" & ((item 1 of s) as text) & "|" & ((item 2 of s) as text)', 'end tell', 'end tell'
      ]);
      if (out === 'none') throw new Error(`${app} has no open window.`);
      const f = parseFrame(out);
      return { x: f.x, y: f.y, w: f.w, h: f.h };
    },
    // Moves and resizes an app's front window. Some apps keep a minimum size or nudge the window after a resize, so the
    // result is read back and returned.
    async setWindowFrame(app, r) {
      const n = (v) => Math.round(v);
      const out = await osa([
        'tell application "System Events"', `tell process ${q(app)}`, 'if (count of windows) is 0 then return "none"',
        `set position of window 1 to {${n(r.x)}, ${n(r.y)}}`, `set size of window 1 to {${n(r.w)}, ${n(r.h)}}`, `set position of window 1 to {${n(r.x)}, ${n(r.y)}}`,
        'set p to position of window 1', 'set s to size of window 1',
        'return ((item 1 of p) as text) & "|" & ((item 2 of p) as text) & "|" & ((item 1 of s) as text) & "|" & ((item 2 of s) as text)', 'end tell', 'end tell'
      ]);
      if (out === 'none') throw new Error(`${app} has no open window.`);
      const f = parseFrame(out);
      return { x: f.x, y: f.y, w: f.w, h: f.h };
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
