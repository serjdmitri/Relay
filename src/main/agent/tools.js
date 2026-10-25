const { scriptNeedsConfirm } = require('./safety');
const web = require('./web');
const { toGlobal, normalizeShapes, guideSteps, KINDS } = require('../overlayGeometry');
const { Guide } = require('../guide');

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const obj = (properties, required = []) => ({ type: 'object', properties, required });

// ctx: { mac, firefox, overlay, getScale, getOrigin }
// overlay.point(x, y, label) shows the Relay cursor at global screen points; overlay.draw(shapes) and overlay.guide(card, target)
// leave marks on screen. getScale() maps screenshot pixels to screen points for the last screenshot taken, and
// getOrigin() says where that screenshot's display starts (a second screen does not start at 0,0).
function buildTools({ mac, firefox, overlay, guides = null, getMark = () => null, getScale, getOrigin = () => ({ x: 0, y: 0 }), visionCapable = true }) {
  const toPoints = (x, y) => toGlobal(x, y, { scale: getScale(), origin: getOrigin() });
  const locate = (app, name) => (mac.locate ? mac.locate(app, name) : mac.uiLocate(app, name));
  const OFF = 'Marks on screen are turned off in Relay settings (General > Relay cursor). Describe it in words instead.';

  const tools = [
    {
      name: 'list_running_apps',
      description: 'List the apps currently open.',
      input_schema: obj({}),
      run: async () => (await mac.listApps()).join(', ')
    },
    {
      name: 'open_app',
      description: 'Open or launch an app by name (e.g. "Notes", "Firefox", "System Settings").',
      input_schema: obj({ name: str('App name') }, ['name']),
      describe: (i) => `Opening ${i.name}`,
      run: (i) => mac.openApp(i.name)
    },
    {
      name: 'focus_app',
      description: 'Bring an already running app to the front.',
      input_schema: obj({ name: str('App name') }, ['name']),
      describe: (i) => `Switching to ${i.name}`,
      run: (i) => mac.focusApp(i.name)
    },
    {
      name: 'quit_app',
      description: 'Quit an app.',
      input_schema: obj({ name: str('App name') }, ['name']),
      describe: (i) => `Quitting ${i.name}`,
      run: (i) => mac.quitApp(i.name)
    },
    {
      name: 'open_url',
      description: 'Open a web address (http, https or mailto). Defaults to Firefox.',
      input_schema: obj({ url: str('Full URL'), app: str('App to open it in, default Firefox') }, ['url']),
      describe: (i) => `Opening ${i.url}`,
      run: (i) => mac.openUrl(i.url, i.app || 'Firefox')
    },
    {
      name: 'open_path',
      description: 'Open a file or folder (e.g. "~/Downloads"). Folders open in Finder.',
      input_schema: obj({ path: str('Absolute path or starting with ~') }, ['path']),
      describe: (i) => `Opening ${i.path}`,
      run: (i) => mac.openPath(i.path)
    },
    {
      name: 'reveal_path',
      description: 'Show a file in Finder, selected.',
      input_schema: obj({ path: str('Absolute path or starting with ~') }, ['path']),
      run: (i) => mac.revealPath(i.path)
    },
    {
      name: 'list_folder',
      description: 'List the contents of a folder (up to 200 entries).',
      input_schema: obj({ path: str('Absolute path or starting with ~') }, ['path']),
      run: (i) => mac.listDir(i.path)
    },
    {
      name: 'trash_path',
      description: 'Move a file or folder to the Trash.',
      input_schema: obj({ path: str('Absolute path or starting with ~') }, ['path']),
      confirm: (i) => `Move ${i.path} to the Trash?`,
      run: (i) => mac.trashPath(i.path)
    },

    {
      name: 'notes_create',
      description: 'Create a new note in Apple Notes.',
      input_schema: obj({ title: str('Note title'), body: str('Note text') }, ['title']),
      describe: (i) => `Creating note "${i.title}"`,
      run: (i) => mac.notesCreate(i.title, i.body || '')
    },
    {
      name: 'notes_list',
      description: 'List recent note titles in Apple Notes.',
      input_schema: obj({}),
      run: () => mac.notesList()
    },
    {
      name: 'notes_read',
      description: 'Read the text of the first note whose title contains the given text.',
      input_schema: obj({ title: str('Part of the note title') }, ['title']),
      run: (i) => mac.notesRead(i.title)
    },
    {
      name: 'notes_append',
      description: 'Append text to the note with this exact title.',
      input_schema: obj({ title: str('Exact note title'), text: str('Text to add') }, ['title', 'text']),
      run: (i) => mac.notesAppend(i.title, i.text)
    },

    {
      name: 'reminders_add',
      description: 'Add a reminder. due is optional, formatted YYYY-MM-DD or YYYY-MM-DDTHH:MM in local time.',
      input_schema: obj({ title: str('Reminder text'), due: str('Due date/time'), list: str('List name, default list if omitted') }, ['title']),
      describe: (i) => `Adding reminder "${i.title}"`,
      run: (i) => mac.remindersAdd(i.title, i.due, i.list)
    },
    {
      name: 'reminders_list',
      description: 'List open reminders.',
      input_schema: obj({}),
      run: () => mac.remindersList()
    },
    {
      name: 'reminders_complete',
      description: 'Mark the reminder with this exact name as completed.',
      input_schema: obj({ title: str('Exact reminder name') }, ['title']),
      run: (i) => mac.remindersComplete(i.title)
    },

    {
      name: 'calendar_events',
      description: 'List calendar events starting today through the next N days (default 1).',
      input_schema: obj({ days: num('Number of days, 1 to 14') }),
      run: (i) => mac.calendarEvents(Math.min(14, Math.max(1, i.days || 1)))
    },
    {
      name: 'calendar_create',
      description: 'Create a calendar event. start and end are local time, YYYY-MM-DDTHH:MM. end defaults to one hour after start.',
      input_schema: obj({ title: str('Event title'), start: str('Start'), end: str('End') }, ['title', 'start']),
      describe: (i) => `Creating event "${i.title}"`,
      run: (i) => mac.calendarCreate(i.title, i.start, i.end)
    },

    {
      name: 'messages_send',
      description: 'Send an iMessage. "to" is a phone number or Apple ID email (names are not resolved).',
      input_schema: obj({ to: str('Phone number or email'), text: str('Message text') }, ['to', 'text']),
      confirm: (i) => `Send "${i.text}" to ${i.to}?`,
      run: (i) => mac.messagesSend(i.to, i.text)
    },

    {
      name: 'type_text',
      description: 'Type text into whatever field currently has focus (pastes it).',
      input_schema: obj({ text: str('Text to type') }, ['text']),
      describe: () => 'Typing',
      run: (i) => mac.typeText(i.text)
    },
    {
      name: 'press_keys',
      description: 'Press a key or combo, e.g. "cmd+t", "cmd+shift+4", "enter", "escape", "down".',
      input_schema: obj({ keys: str('Key combo') }, ['keys']),
      describe: (i) => `Pressing ${i.keys}`,
      run: (i) => mac.pressKeys(i.keys)
    },
    {
      name: 'ui_list',
      description: 'List named buttons, fields and other UI elements in the front window of an app (accessibility tree). Use before ui_click.',
      input_schema: obj({ app: str('App name') }, ['app']),
      run: (i) => mac.uiList(i.app)
    },
    {
      name: 'ui_click',
      description: 'Click the UI element with this exact name in the front window of an app.',
      input_schema: obj({ app: str('App name'), name: str('Exact element name from ui_list') }, ['app', 'name']),
      describe: (i) => `Clicking ${i.name}`,
      run: (i) => mac.uiClick(i.app, i.name)
    },
    {
      name: 'menu_click',
      description: 'Choose a menu bar item, e.g. app "Notes", menu_path ["File","New Folder"].',
      input_schema: obj({ app: str('App name'), menu_path: { type: 'array', items: { type: 'string' }, description: 'Menu, then submenus, then item' } }, ['app', 'menu_path']),
      describe: (i) => `Choosing ${i.menu_path.join(' > ')}`,
      run: (i) => mac.menuClick(i.app, i.menu_path)
    },

    {
      name: 'web_search',
      description: 'Search the web and return the top results with snippets.',
      input_schema: obj({ query: str('Search query') }, ['query']),
      describe: (i) => `Searching "${i.query}"`,
      run: (i) => web.search(i.query)
    },
    {
      name: 'fetch_page',
      description: 'Download a web page and return its text (first 8000 characters).',
      input_schema: obj({ url: str('Full URL') }, ['url']),
      describe: () => 'Reading a page',
      run: (i) => web.fetchPage(i.url)
    },

    {
      name: 'clipboard_read',
      description: 'Read what the user last copied: its text, or the image if an image was copied. Use for "what I copied" or "my clipboard".',
      input_schema: obj({}),
      describe: () => 'Reading the clipboard',
      run: async () => {
        const c = await mac.clipboardRead();
        if (c && c.image && visionCapable) return { image: c.image, text: c.text ? c.text.slice(0, 20000) : 'An image is on the clipboard.' };
        const t = c && typeof c === 'object' ? c.text : c;
        return t ? String(t).slice(0, 20000) : 'The clipboard is empty.';
      }
    },
    {
      name: 'clipboard_write',
      description: 'Put text on the clipboard so the user can paste it.',
      input_schema: obj({ text: str('Text to copy') }, ['text']),
      describe: () => 'Copying to the clipboard',
      run: (i) => mac.clipboardWrite(i.text)
    },
    {
      name: 'selected_text',
      description: 'Read the text currently selected in the front app. Use for "this", "what I highlighted" or "what I selected". Empty when nothing is selected.',
      input_schema: obj({}),
      describe: () => 'Reading the selection',
      run: async () => {
        const t = await mac.selectedText();
        return t ? String(t).slice(0, 20000) : 'Nothing is selected in the front app.';
      }
    },
    {
      name: 'set_volume',
      description: 'Set the system output volume, 0 to 100.',
      input_schema: obj({ level: num('0 to 100') }, ['level']),
      run: (i) => mac.setVolume(i.level)
    },
    {
      name: 'toggle_dark_mode',
      description: 'Switch macOS between light and dark appearance.',
      input_schema: obj({}),
      run: () => mac.toggleDarkMode()
    },

    {
      name: 'run_applescript',
      description: 'Run raw AppleScript for anything the other tools do not cover. Returns its output.',
      input_schema: obj({ script: str('AppleScript source') }, ['script']),
      confirm: (i) => (scriptNeedsConfirm(i.script) ? `Run this AppleScript?\n${i.script.slice(0, 300)}` : null),
      describe: () => 'Running a script',
      run: (i, ctx) => mac.runAppleScript(i.script, ctx)
    },
    {
      name: 'run_shell',
      description: 'Run a zsh command. Always asks the user first. Prefer other tools when they exist.',
      input_schema: obj({ command: str('Shell command') }, ['command']),
      confirm: (i) => `Run this command?\n${i.command.slice(0, 300)}`,
      describe: () => 'Running a command',
      run: (i) => mac.runShell(i.command)
    }
  ];

  // What the user marked with the mark key: a picture of that area, or its text for a model that cannot see images.
  tools.push({
    name: 'see_marked_area',
    description: 'Look at the part of the screen the user marked (circled) by holding the mark key. Use it first when the request says "this", "here" or "that" and the context says they marked something. Returns a picture of that area.',
    input_schema: obj({}),
    describe: () => 'Looking at what you marked',
    run: async () => {
      const m = getMark();
      if (!m) return 'The user has not marked anything recently. Use screenshot to look at the screen instead.';
      const where = `${Math.round(m.box.w)}x${Math.round(m.box.h)} points drawn around ${Math.round(m.box.x)},${Math.round(m.box.y)}`;
      if (visionCapable) return { image: { mediaType: m.mediaType, data: m.data }, text: `The area the user marked (${where}), with some of its surroundings.` };
      const text = mac.readText ? await mac.readText(m) : '';
      return text ? `Text in the area the user marked (${where}):\n${text}` : 'The marked area has no readable text, and this model cannot see images.';
    }
  });

  // Show the user where something is. These work from the accessibility tree, so they need no vision model.
  tools.push(
    {
      name: 'point_at_element',
      description: 'Show the user where a named UI element is: the Relay helper flies to it and draws a box around it. Exact, and needs no screenshot. Get names from ui_list.',
      input_schema: obj({ app: str('App name'), name: str('Exact element name from ui_list'), label: str('Short label') }, ['app', 'name']),
      describe: (i) => `Showing ${i.name}`,
      run: async (i) => {
        const f = await locate(i.app, i.name);
        if (!overlay) return OFF;
        const shown = await overlay.point(f.cx, f.cy, i.label || i.name);
        if (shown === false) return OFF;
        await overlay.draw([{ type: 'box', x: f.x, y: f.y, w: f.w, h: f.h, label: '' }], { add: true });
        return `Pointed at "${i.name}" in ${i.app}.`;
      }
    },
    {
      name: 'draw_on_screen',
      description: 'Draw boxes, circles, arrows and text labels over the screen to show the user something, for example to circle a button or mark where to look. Best: give a shape app and name (an exact element from ui_list) and Relay outlines that element exactly, with no screenshot. Otherwise x, y (and w, h, r, x2, y2) are pixels in the most recent screenshot, so take one first. Use few, clear marks. They stay about 30 seconds, or until the user presses Esc. Set add to build on what is already drawn; set clear with no shapes to remove marks.',
      input_schema: obj({
        shapes: {
          type: 'array',
          description: 'Up to 12 shapes',
          items: obj({ type: { type: 'string', enum: KINDS }, app: str('With name: outline this element exactly'), name: str('Exact element name from ui_list'), x: num('X'), y: num('Y'), w: num('Box width'), h: num('Box height'), r: num('Circle radius'), x2: num('Arrow end X'), y2: num('Arrow end Y'), label: str('Short label'), text: str('Text for a text shape') }, ['type'])
        },
        add: { type: 'boolean', description: 'Keep what is already drawn' },
        clear: { type: 'boolean', description: 'Remove all marks' }
      }),
      describe: () => 'Drawing on the screen',
      run: async (i) => {
        if (!overlay) return OFF;
        if (i.clear && !(i.shapes && i.shapes.length)) { overlay.clear(); return 'Cleared the marks.'; }
        if (!Array.isArray(i.shapes) || !i.shapes.length) throw new Error('shapes must be a non-empty list.');
        // A shape with app and name is anchored to the element's exact frame (global points); the rest are screenshot pixels.
        const anchored = [];
        const loose = [];
        for (const s of i.shapes) {
          if (s && s.app && s.name) {
            const f = await locate(s.app, s.name);
            anchored.push(s.type === 'circle'
              ? { type: 'circle', x: f.cx, y: f.cy, r: Math.max(f.w, f.h) / 2 + 8, label: String(s.label || '').slice(0, 60) }
              : s.type === 'arrow'
                ? { type: 'arrow', x: f.cx + 120, y: f.cy + 90, x2: f.cx, y2: f.cy, label: String(s.label || '').slice(0, 60) }
                : s.type === 'text'
                  ? { type: 'text', x: f.x, y: f.y + f.h + 6, text: String(s.text || s.label || s.name).slice(0, 60) }
                  : { type: 'box', x: f.x, y: f.y, w: f.w, h: f.h, label: String(s.label || '').slice(0, 60) });
          } else loose.push(s);
        }
        const shapes = [...anchored, ...(loose.length ? normalizeShapes(loose, { scale: getScale(), origin: getOrigin() }) : [])];
        if (shapes.length > 12) throw new Error('Draw at most 12 shapes at a time.');
        if ((await overlay.draw(shapes, { add: !!i.add })) === false) return OFF;
        return `Drew ${shapes.length} mark${shapes.length === 1 ? '' : 's'}. They stay about 30 seconds, or until the user presses Esc.`;
      }
    },
    {
      name: 'guide_step',
      description: 'Walk the user through a task on their own screen. Call it ONCE with the whole list of steps. Each step is a short sentence, or an object { text, app, name } where app and name are the exact UI element to click (names come from ui_list), or { text, x, y } for a spot in a screenshot. Relay shows a checklist card, outlines the current step\'s element and moves to the next step on its own when the user clicks it or says "next". Do not call it again for each step.',
      input_schema: obj({
        steps: { type: 'array', description: '1 to 8 steps', items: obj({ text: str('One short step'), app: str('App that has the element'), name: str('Exact element name from ui_list'), x: num('X in screenshot pixels'), y: num('Y in screenshot pixels') }, ['text']) },
        current: num('Step to start on, from 1 (default 1)'),
        goal: str('What the user is trying to do, in a few words'),
        app: str('App for the start step\'s element, if the step has none'), name: str('Exact element name for the start step'),
        x: num('X for the start step, in screenshot pixels'), y: num('Y for the start step, in screenshot pixels')
      }, ['steps']),
      describe: () => 'Showing the steps',
      run: async (i) => {
        const { steps, current } = guideSteps(i.steps, i.current || 1, { toPt: toPoints, fallback: { app: i.app, name: i.name, x: i.x, y: i.y } });
        if (!overlay) return OFF;
        const g = guides || new Guide({ overlay, mac });
        const out = await g.start(steps, current, i.goal);
        return out === false ? OFF : out;
      }
    }
  );

  if (visionCapable) {
    tools.push(
      {
        name: 'screenshot',
        description: 'Capture the main display so you can see it. Returns an image; later click coordinates refer to this image.',
        input_schema: obj({}),
        describe: () => 'Looking at the screen',
        run: async () => {
          const shot = await mac.screenshot();
          return { image: { mediaType: shot.mediaType, data: shot.data }, text: `Screenshot ${shot.width}x${shot.height}.` };
        }
      },
      {
        name: 'click',
        description: 'Click at a position in the most recent screenshot (pixels, origin top-left). Shows the Relay cursor first.',
        input_schema: obj({ x: num('X in screenshot pixels'), y: num('Y in screenshot pixels'), double: { type: 'boolean' }, right: { type: 'boolean' } }, ['x', 'y']),
        describe: () => 'Clicking',
        run: async (i) => {
          const p = toPoints(i.x, i.y);
          await overlay?.point(p.x, p.y);
          return mac.click(p.x, p.y, { double: i.double, right: i.right });
        }
      },
      {
        name: 'point_at',
        description: 'Show the Relay cursor at a spot on screen to guide the user, without clicking. Optional short label.',
        input_schema: obj({ x: num('X in screenshot pixels'), y: num('Y in screenshot pixels'), label: str('Short label') }, ['x', 'y']),
        run: async (i) => {
          const p = toPoints(i.x, i.y);
          await overlay?.point(p.x, p.y, i.label);
          return 'Pointed.';
        }
      },
      {
        name: 'scroll',
        description: 'Scroll the window under the mouse. Positive scrolls up, negative scrolls down (lines).',
        input_schema: obj({ amount: num('Lines, e.g. -10') }, ['amount']),
        run: (i) => mac.scroll(i.amount)
      }
    );
  }

  if (firefox?.isConnected()) {
    const ff = (method, params) => firefox.call(method, params);
    tools.push(
      { name: 'firefox_tabs', description: 'List open Firefox tabs with ids, titles and URLs.', input_schema: obj({}), run: async () => JSON.stringify(await ff('tabs.list', {})) },
      {
        name: 'firefox_switch_tab',
        description: 'Switch to a Firefox tab by id, or by text in its title or URL.',
        input_schema: obj({ id: num('Tab id'), match: str('Text in title or URL') }),
        describe: () => 'Switching tab',
        run: async (i) => JSON.stringify(await ff('tabs.activate', i))
      },
      {
        name: 'firefox_open',
        description: 'Open a URL in Firefox, in a new tab by default.',
        input_schema: obj({ url: str('Full URL'), new_tab: { type: 'boolean' } }, ['url']),
        describe: (i) => `Opening ${i.url}`,
        run: async (i) => JSON.stringify(await ff('tabs.open', { url: i.url, newTab: i.new_tab !== false }))
      },
      {
        name: 'firefox_read_page',
        description: 'Read the visible text of a Firefox tab (active tab if no id), plus its clickable links and form fields.',
        input_schema: obj({ id: num('Tab id') }),
        describe: () => 'Reading the page',
        run: async (i) => JSON.stringify(await ff('page.read', i))
      },
      {
        name: 'firefox_click',
        description: 'Click an element in a Firefox tab by visible text or CSS selector.',
        input_schema: obj({ text: str('Visible text'), selector: str('CSS selector'), id: num('Tab id') }),
        describe: (i) => `Clicking ${i.text || i.selector}`,
        run: async (i) => JSON.stringify(await ff('page.click', i))
      },
      {
        name: 'firefox_type',
        description: 'Type into a field in a Firefox tab (CSS selector), optionally pressing Enter.',
        input_schema: obj({ selector: str('CSS selector'), text: str('Text'), submit: { type: 'boolean' }, id: num('Tab id') }, ['selector', 'text']),
        describe: () => 'Typing',
        run: async (i) => JSON.stringify(await ff('page.type', i))
      },
      {
        name: 'firefox_close_tab',
        description: 'Close a Firefox tab by id.',
        input_schema: obj({ id: num('Tab id') }, ['id']),
        run: async (i) => JSON.stringify(await ff('tabs.close', i))
      }
    );
  }
  return tools;
}

module.exports = { buildTools };
