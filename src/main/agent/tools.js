const { scriptNeedsConfirm } = require('./safety');
const web = require('./web');

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const obj = (properties, required = []) => ({ type: 'object', properties, required });

// ctx: { mac, firefox, overlay, getScale }
// overlay.point(x, y, label) shows the Relay cursor at screen points. getScale() maps
// screenshot pixels to screen points for the last screenshot taken.
function buildTools({ mac, firefox, overlay, getScale, visionCapable = true }) {
  const toPoints = (x, y) => {
    const s = getScale();
    return { x: x * s, y: y * s };
  };

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
