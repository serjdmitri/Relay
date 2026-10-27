const { scriptNeedsConfirm } = require('./safety');
const { shellBlocked, scriptBlocked, pathProblem } = require('../drive/guard');
const web = require('./web');
const { toGlobal, normalizeShapes, guideSteps, KINDS } = require('../overlayGeometry');
const { Guide } = require('../guide');
const { layoutRect, pickArea, NAMES: WINDOW_NAMES } = require('../windows');
const { readDropped } = require('./files');

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const obj = (properties, required = []) => ({ type: 'object', properties, required });

// ctx: { mac, firefox, overlay, getScale, getOrigin }
// overlay.point(x, y, label) shows the Relay cursor at global screen points; overlay.draw(shapes) and overlay.guide(card, target)
// leave marks on screen. getScale() maps screenshot pixels to screen points for the last screenshot taken, and
// getOrigin() says where that screenshot's display starts (a second screen does not start at 0,0).
function buildTools({ mac, firefox, overlay, guides = null, getMark = () => null, getDisplays = () => [], getFront = () => null, getFiles = () => [], memory = null, schedules = null, agents = null, cards = null, models = null, drive = null, getScale, getOrigin = () => ({ x: 0, y: 0 }), visionCapable = true }) {
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
      description: 'Move ONE file or folder to the Trash (it can be put back). Relay never deletes anything and never empties the Trash. Only when the user asked to get rid of that item; to tidy many files use drive_propose instead.',
      input_schema: obj({ path: str('Absolute path or starting with ~') }, ['path']),
      confirm: (i) => (pathProblem(i.path, require('os').homedir()) ? null : `Move ${i.path} to the Trash? (You can put it back.)`),
      run: (i) => { const no = pathProblem(i.path, require('os').homedir()); return no ? `Not moved to the Trash. ${no}` : mac.trashPath(i.path); }
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
      name: 'arrange_window',
      description: `Move and resize an app's front window: left, right, top or bottom half, a corner (top-left, top-right, bottom-left, bottom-right), a third (left-third, middle-third, right-third), center, or maximize to fill the screen. Omit app for the window the user is looking at. display: this (default, where the window is), other (the next screen) or main.`,
      input_schema: obj({
        app: str('App name; omit for the front window'),
        position: { type: 'string', enum: Object.keys(WINDOW_NAMES) },
        display: str('this, other or main')
      }, ['position']),
      describe: (i) => `Moving the window to ${WINDOW_NAMES[i.position] || i.position}`,
      run: async (i) => {
        const app = i.app || getFront();
        if (!app) throw new Error('I could not tell which app to move. Name the app.');
        const before = await mac.windowFrame(app);
        const area = pickArea(getDisplays(), before, i.display || 'this');
        const after = await mac.setWindowFrame(app, layoutRect(i.position, area));
        const wanted = layoutRect(i.position, area);
        const off = Math.abs(after.w - wanted.w) > 12 || Math.abs(after.h - wanted.h) > 12;
        return `Moved ${app} to ${WINDOW_NAMES[i.position]}.${off ? ` It stopped at ${Math.round(after.w)} by ${Math.round(after.h)} because the app limits its size.` : ''}`;
      }
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
      run: async (i) => {
        // Show the click first: fly to the element and ripple. If it cannot be located, just press it.
        if (overlay?.click) { try { const f = await locate(i.app, i.name); await overlay.click(f.cx, f.cy); } catch {} }
        return mac.uiClick(i.app, i.name);
      }
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
      description: 'Run raw AppleScript for anything the other tools do not cover. Returns its output. It can never empty the Trash or delete files.',
      input_schema: obj({ script: str('AppleScript source') }, ['script']),
      confirm: (i) => (scriptBlocked(i.script) ? null : scriptNeedsConfirm(i.script) ? `Run this AppleScript?\n${i.script.slice(0, 300)}` : null),
      describe: () => 'Running a script',
      run: (i, ctx) => scriptBlocked(i.script) || mac.runAppleScript(i.script, ctx)
    },
    {
      name: 'run_shell',
      description: 'Run a zsh command. Always asks the user first. Prefer other tools when they exist. Commands that delete or destroy anything (rm, find -delete, git clean...) are refused outright: Relay never deletes.',
      input_schema: obj({ command: str('Shell command') }, ['command']),
      confirm: (i) => (shellBlocked(i.command) ? null : `Run this command?\n${i.command.slice(0, 300)}`),
      describe: () => 'Running a command',
      run: (i) => shellBlocked(i.command) || mac.runShell(i.command)
    }
  ];

  // Things the user wants Relay to remember about them (kept on this Mac, shown with every request).
  if (memory) {
    tools.push(
      {
        name: 'remember',
        description: 'Keep a short fact about the user for later requests, e.g. "name is Sergey", "vegetarian", "sister Anna lives in Boston". Only when they ask you to remember something or state a lasting fact about themselves. Never secrets.',
        input_schema: obj({ fact: str('One short fact, in plain words') }, ['fact']),
        describe: () => 'Remembering that',
        run: (i) => memory.add(i.fact)
      },
      {
        name: 'forget_memory',
        description: 'Forget remembered facts that have all of these words.',
        input_schema: obj({ match: str('Words from the fact') }, ['match']),
        describe: () => 'Forgetting that',
        run: (i) => memory.remove(i.match)
      }
    );
  }

  // A 3D model you can turn and zoom: a real one from Wikimedia Commons (an STL, when someone has made one), else built from shapes.
  if (models) {
    tools.push({
      name: 'show_3d',
      description: 'Show a REALISTIC 3D hologram floating on the screen (no window). The user can drag its glowing base to move it anywhere, drag the model to turn it, scroll to resize, pin it, switch between other models, and drop one hologram on another to combine them. Use it for "show me a 3D model of…", "what does … look like in 3D", or a model that makes an idea clear. REALISM MATTERS: for a specific real thing (a VEX V5 robot, a car model, a building, a gadget, an animal, a part), research it first with web_search and fetch_page so you know exactly what it looks like, then call show_3d with the precise name as query (and photo_query with words that find a clear photo of the whole object from the side or three-quarter view). If your research found a good photo of it, pass its direct https image link as photo_url. Relay then finds a ready-made 3D model, or turns a real photo into a realistic 3D model. Only give parts (simple shapes) when the thing is abstract or a diagram (an atom, the planets) or nothing else exists; never build a real object from boxes and cylinders when a photo exists, and do not add labels unless the user asked for them.',
      input_schema: obj({
        title: str('Name shown under the hologram'), query: str('The exact name of the thing, for finding a ready-made model'), photo_query: str('Words to find a clear photo of the whole real object (e.g. "VEX V5 competition robot")'),
        photo_url: str('A direct https link to a clear photo of it, from your research (optional)'), note: str('One short line under the title'),
        combine: { type: 'boolean', description: 'true to add this model next to the hologram already on screen ("add a heart to it", "put them together"), instead of making a new one' },
        attach: str('With combine: how the user wants it attached, in their words ("on top", "next to it", "inside", "as the head"), so it is placed that way'),
        keep: { type: 'boolean', description: 'true to pin it so it stays on screen ("keep it up", "leave it there")' },
        parts: { type: 'array', description: 'ONLY for abstract things and diagrams, or when nothing realistic exists: shapes to build it from', items: { type: 'object', properties: { shape: str('sphere|box|cylinder|cone|torus|capsule|ring'), size: { type: 'array', items: { type: 'number' } }, position: { type: 'array', items: { type: 'number' } }, rotation: { type: 'array', items: { type: 'number' } }, color: str('#rrggbb'), opacity: num('0.1 to 1'), glow: { type: 'boolean' }, label: str('Short label (only if the user asked for labels)'), spin: { type: 'array', items: { type: 'number' } }, orbit: { type: 'object', properties: { radius: num('Distance'), speed: num('Degrees per second'), tilt: num('Degrees'), center: { type: 'array', items: { type: 'number' } } } } }, required: ['shape', 'size'] } }
      }, ['title']),
      describe: (i) => `Getting a 3D model of ${i.title}`,
      run: async (i) => models.show(i)
    });
    if (models.save) {
      tools.push({
        name: 'save_3d',
        description: 'Save the 3D hologram on screen as a file in Downloads/Relay 3D: STL or 3MF (for 3D printing slicers), or STEP (for CAD apps like Fusion and FreeCAD; models up to about 20,000 triangles). The model stands on the bed, z up; a designed model keeps its real millimetres, anything else is scaled to 100 mm across. Optionally open it in an installed app by name ("Bambu Studio", "OrcaSlicer", "PrusaSlicer", "Cura", "Fusion", "FreeCAD"): the best format for that app is chosen. Use for "save this", "export it as STEP", "send it to my 3D printer", "open it in Fusion".',
        input_schema: obj({ title: str('Which hologram, by its title (optional: the latest)'), format: str('stl | 3mf | step (optional)'), open_with: str('An app to open the file in, e.g. "Bambu Studio" (optional)') }),
        describe: () => 'Saving the model',
        run: async (i) => models.save(i)
      });
    }
    if (models.design) {
      const shapeProps = {
        name: str('A short name you can refer to later ("Cube", "Hole", "Roof")'), type: str('box (cube/block/plate) | cylinder | sphere | cone | wedge (roof/ramp) | pyramid | torus (ring) | tube (hollow cylinder)'),
        size: { type: 'array', description: 'Width, height and depth in millimetres, e.g. [40, 40, 40]. A number alone makes it the same all round. A cylinder or sphere: [diameter, height, diameter].', items: { type: 'number' } },
        diameter: { type: 'number', description: 'For a round shape or a hole: how wide' },
        position: { type: 'array', description: 'Where the MIDDLE of the shape is: [x, y, z] in mm, y is up. Leave it out for the first shape (it stands on the floor). Prefer on/through below.', items: { type: 'number' } },
        rotation: { type: 'array', description: 'Degrees about x, y, z', items: { type: 'number' } },
        hole: { type: 'boolean', description: 'true: this shape is cut OUT of the solid shapes (a hole, a slot, a dent)' },
        color: str('A colour name or #hex (optional)'),
        on: { type: 'object', description: 'Put it ON another shape, touching it: { of: "<name>", side: "top|bottom|left|right|front|back", offset: [a, b] (optional, slide it) }', properties: { of: str('Name of the other shape'), side: str('top|bottom|left|right|front|back'), offset: { type: 'array', items: { type: 'number' } } } },
        through: { type: 'object', description: 'For a hole: make it go right THROUGH another shape (opens on both sides): { of: "<name>", axis: "x|y|z" (default y, top to bottom), offset: [a, b] (optional) }', properties: { of: str('Name of the other shape'), axis: str('x|y|z'), offset: { type: 'array', items: { type: 'number' } } } }
      };
      tools.push({
        name: 'design_3d',
        description: 'DESIGN a new 3D model from simple shapes, like Tinkercad, as a hologram the user can then edit themselves (resize, move, add, remove, make holes) and save as an STL. Use it when the user asks you to MAKE something ("make a cube with a hole going through it and add a cone on top", "design a phone stand", "a keychain with a round hole", "a simple house"), not when they want to SEE a real thing (that is show_3d). Give the shapes in order; later ones can use on/through to sit on or cut through earlier ones by name, so you do not have to work out positions. Solid shapes are added together, holes are subtracted. Dimensions are in millimetres (a cube of 40 is a 4 cm cube). Keep it simple and exact: the user will edit it.',
        input_schema: obj({ title: str('Name shown under the hologram'), shapes: { type: 'array', description: 'The shapes, in order', items: { type: 'object', properties: shapeProps } }, keep: { type: 'boolean', description: 'true to pin it' } }, ['title', 'shapes']),
        describe: (i) => `Designing ${i.title}`,
        run: async (i) => models.design(i)
      });
      tools.push({
        name: 'edit_3d',
        description: 'CHANGE the designed 3D model already on screen (made with design_3d, or edited by the user by hand): make a hole bigger, move or resize a shape, add or remove one, turn a shape into a hole. Refer to shapes by the names read_3d or design_3d gave. If the user may have changed it by hand since, call read_3d first.',
        input_schema: obj({ changes: { type: 'array', description: 'In order. Each: { op: "set", name, size|diameter|radius|width|height|depth (new size), scale (a number or [x,y,z] to multiply the size), position, move: [dx, dy, dz], rotation, hole (true/false), color } | { op: "add", ...a shape as in design_3d, with on/through } | { op: "remove", name } | { op: "clear" }', items: { type: 'object' } }, title: str('Which hologram, by its title (optional: the latest designed one)') }, ['changes']),
        describe: () => 'Changing the model',
        run: async (i) => models.edit(i)
      });
      tools.push({
        name: 'read_3d',
        description: 'Read the shapes of the designed 3D model on screen, with their names, sizes and places, as the user has it now (they may have edited it by hand). Use it before edit_3d when you are not sure.',
        input_schema: obj({ title: str('Which hologram, by its title (optional)') }),
        describe: () => 'Looking at the model',
        run: async (i) => models.read(i)
      });
    }
  }

  // Mac drive: find files with previews, and tidy folders by a plan the user has seen. Nothing is ever deleted or overwritten.
  if (drive) {
    tools.push(
      {
        name: 'drive_find',
        description: 'Find files on the Mac by name or content (Spotlight), inside the home folder. Shows the best matches on screen as a card with PREVIEW pictures; the user can click one to open it or show it in Finder. Use for "find my …", "where is the … file", "show me my photos of …".',
        input_schema: obj({ query: str('Words from the name or the content'), folder: str('Only look in this folder (optional), e.g. ~/Documents'), kind: str('image | video | audio | pdf | document | spreadsheet | slides | archive | code | folder (optional)') }, ['query']),
        describe: (i) => `Looking for ${i.query}`,
        run: (i) => drive.find(i)
      },
      {
        name: 'drive_scan',
        description: 'List what is inside a folder (a few levels down) with each file kind, size and date, so you can plan how to tidy it. Read-only. Folders marked as projects are not to be taken apart.',
        input_schema: obj({ folder: str('e.g. ~/Downloads'), depth: { type: 'number', description: 'How many levels down, 1 to 5 (default 3)' } }, ['folder']),
        describe: (i) => `Looking inside ${i.folder}`,
        run: (i) => drive.scan(i)
      },
      {
        name: 'drive_propose',
        description: 'Propose how to tidy files: a list of moves, shown to the user on screen as "where I will put everything". NOTHING MOVES YET. Check the plan with drive_scan first, group sensibly (by kind, by project or by year), keep names as they are, and prefer moving files into folders (new folders are made for you) over anything else. Only put something in the Trash (trash list) if the user asked you to get rid of it; otherwise use a folder such as ~/Documents/To review. After it returns, tell the user plainly where things will go, ask them to confirm, and only then call drive_apply.',
        input_schema: obj({
          moves: { type: 'array', description: 'Each file or folder and where it goes', items: { type: 'object', properties: { from: str('Absolute path or ~/…'), to_folder: str('The folder to move it into (created if missing)') } } },
          trash: { type: 'array', description: 'Only things the user asked to get rid of: they go to the Trash (recoverable), never deleted', items: { type: 'string' } },
          note: str('One line: the idea of the plan')
        }, ['moves']),
        describe: () => 'Planning where things go',
        run: (i) => drive.propose(i)
      },
      {
        name: 'drive_apply',
        description: 'Carry out a plan made with drive_propose, after the user has been told where everything goes. The user is asked to confirm. Moves only; never deletes or overwrites. Needs the plan_id that drive_propose returned.',
        input_schema: obj({ plan_id: str('The id from drive_propose') }, ['plan_id']),
        confirm: (i) => drive.confirmText(i.plan_id),
        describe: () => 'Moving the files',
        run: (i) => drive.apply(i)
      },
      {
        name: 'drive_undo',
        description: 'Put the last tidy-up back where it was (files that went to the Trash are put back by the user from the Trash).',
        input_schema: obj({}),
        confirm: () => 'Put the last tidy-up back where it was?',
        describe: () => 'Putting the files back',
        run: () => drive.undo()
      }
    );
  }

  // An answer card: a picture, the key facts and links, shown beside the answer (Relay finds the picture).
  if (cards) {
    tools.push({
      name: 'show_card',
      description: 'Show an answer card on screen with a picture, key facts and links, for "who is…", "what is…", "what does … look like", "tell me about…" (kind entity) or "show me … options" such as hotels, restaurants, products or places (kind list). Relay finds the picture from Wikipedia and Wikimedia Commons by image_query (default the title; use the proper Wikipedia name, e.g. "Eiffel Tower"). Fill in only what you know is true. After it, answer in one short sentence: the card shows the rest.',
      input_schema: obj({
        kind: str('entity or list'), title: str('Name of the thing, or what the list is'), subtitle: str('A few words, e.g. "Paris, France" or "French engineer, 1832 to 1923"'), summary: str('Two or three sentences'),
        image_query: str('What to look up a picture for'),
        facts: { type: 'array', description: 'Up to 6 label/value pairs', items: obj({ label: str('Label'), value: str('Value') }, ['label', 'value']) },
        links: { type: 'array', description: 'Up to 4 https links', items: obj({ label: str('Button text'), url: str('https URL') }, ['url']) },
        items: { type: 'array', description: 'For a list: up to 6 options', items: obj({ title: str('Name'), subtitle: str('Short detail'), note: str('One line, e.g. price or rating'), url: str('https URL, only if you are certain it is real; otherwise leave it out and Relay links its Wikipedia page or a web search'), image_query: str('What to look up a picture for, if it has a Wikipedia page') }, ['title']) }
      }, ['title']),
      describe: (i) => `Showing ${i.title}`,
      run: async (i) => cards.show(i)
    });
  }

  // Long jobs that do not need the screen can run in the background while the user carries on.
  if (agents) {
    tools.push({
      name: 'start_background_agent',
      description: 'Start a background agent for a long job that needs no screen: research, reading and summarizing, writing something into a Note. It works by itself (web, pages, Notes, Reminders, Calendar, dropped files; it cannot control the screen or send anything) and its progress shows in the top right. Use it when the user asks for a big job in the background, or it would take many steps. Write the job as complete instructions.',
      input_schema: obj({ task: str('The whole job, in plain words, including where to keep the result (e.g. "in a Note called …")') }, ['task']),
      confirm: (i) => `Start a background agent: ${String(i.task).slice(0, 120)}?`,
      describe: () => 'Starting a background agent',
      run: async (i) => agents.start(i.task)
    });
  }

  // Requests that run later or on repeat, while the Mac is on and Relay is open. They run unattended, so what sends or deletes
  // is declined unless the user answers within 90 seconds.
  if (schedules) {
    tools.push(
      {
        name: 'schedule_task',
        description: 'Run a request later or on repeat, e.g. "open my email" every weekday at 08:00. time is 24-hour "HH:MM". repeat: once, daily, weekdays, weekends or weekly (weekly needs days). For a single run give date as YYYY-MM-DD, or leave it out for the next time that clock shows. The task is written as the request Relay will get then.',
        input_schema: obj({ task: str('The request to run, in the user\'s words'), repeat: str('once | daily | weekdays | weekends | weekly'), time: str('HH:MM, 24-hour'), days: { type: 'array', items: { type: 'string' }, description: 'For weekly: day names' }, date: str('YYYY-MM-DD, for once') }, ['task', 'time']),
        confirm: (i) => `Schedule "${i.task}" (${i.repeat || 'once'} at ${i.time})?`,
        describe: () => 'Scheduling that',
        run: async (i) => schedules.add(i)
      },
      { name: 'list_schedules', description: 'List the scheduled requests.', input_schema: obj({}), run: async () => schedules.list() },
      {
        name: 'cancel_schedule',
        description: 'Cancel scheduled requests whose text has all of these words.',
        input_schema: obj({ match: str('Words from the scheduled request') }, ['match']),
        describe: () => 'Cancelling that schedule',
        run: async (i) => schedules.remove(i.match)
      }
    );
  }

  // Files dropped on Relay (the menu bar icon, or its window): readable by name, and nothing else on the disk.
  tools.push({
    name: 'read_file',
    description: 'Read a file or folder the user dropped on Relay: text, PDF, Word/RTF/HTML, or a picture. Only the dropped files (and what is inside a dropped folder) can be read.',
    input_schema: obj({ path: str('Absolute path of a dropped file or a file inside a dropped folder') }, ['path']),
    describe: (i) => `Reading ${String(i.path || '').split('/').pop()}`,
    run: async (i) => {
      const dropped = getFiles();
      if (!dropped.length) return 'The user has not dropped any files on Relay.';
      const r = await readDropped(i.path, dropped);
      return r.image && visionCapable ? r : `${r.text}${r.image ? '\n(This model cannot see pictures.)' : ''}`;
    }
  });

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
          await (overlay?.click ? overlay.click(p.x, p.y) : overlay?.point(p.x, p.y)); // the helper flies there and shows the click
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
    const json = async (method, params) => JSON.stringify(await ff(method, params));
    tools.push(
      { name: 'firefox_tabs', description: 'List every open Firefox tab (all windows) with id, title, URL, and whether it is the active tab, pinned or playing sound.', input_schema: obj({}), describe: () => 'Looking at your tabs', run: () => json('tabs.list', {}) },
      {
        name: 'firefox_switch_tab',
        description: 'Bring a Firefox tab to the front, by id or by words from its title or URL (all the words must match; the closest title wins).',
        input_schema: obj({ id: num('Tab id'), match: str('Words from the title or URL') }),
        describe: (i) => `Switching to ${i.match || 'a tab'}`,
        run: (i) => json('tabs.activate', i)
      },
      {
        name: 'firefox_open',
        description: 'Open a URL in Firefox, in a new tab by default, and wait until it has loaded. A bare address like "github.com" gets https. Use background to open it without leaving the current tab.',
        input_schema: obj({ url: str('URL or address'), new_tab: { type: 'boolean' }, background: { type: 'boolean', description: 'Open behind the current tab' } }, ['url']),
        describe: (i) => `Opening ${i.url}`,
        run: (i) => json('tabs.open', { url: i.url, newTab: i.new_tab !== false, background: i.background === true })
      },
      {
        name: 'firefox_read_page',
        description: 'Read a Firefox tab (the active one if no id): its title, URL, visible text, how far it is scrolled, and a numbered list of its buttons, links and fields. Use those numbers with firefox_click and firefox_type. Read again after the page changes: numbers are renewed on every read.',
        input_schema: obj({ id: num('Tab id') }),
        describe: () => 'Reading the page',
        run: (i) => json('page.read', i)
      },
      {
        name: 'firefox_click',
        description: 'Click something in a Firefox tab: by its number from firefox_read_page (best), or by visible text, or a CSS selector.',
        input_schema: obj({ index: num('Number from firefox_read_page'), text: str('Visible text'), selector: str('CSS selector'), id: num('Tab id') }),
        describe: (i) => `Clicking ${i.text || (i.index != null ? `item ${i.index}` : i.selector)}`,
        run: (i) => json('page.click', i)
      },
      {
        name: 'firefox_type',
        description: 'Type into a field in a Firefox tab, by its number from firefox_read_page (best) or a CSS selector, optionally submitting the form (Enter).',
        input_schema: obj({ index: num('Number from firefox_read_page'), selector: str('CSS selector'), text: str('Text'), submit: { type: 'boolean' }, id: num('Tab id') }, ['text']),
        describe: () => 'Typing',
        run: (i) => json('page.type', i)
      },
      {
        name: 'firefox_press',
        description: 'Press a key (Enter, Escape, Tab, ArrowDown…) in the field that has focus on a Firefox page.',
        input_schema: obj({ key: str('Key name'), id: num('Tab id') }, ['key']),
        describe: (i) => `Pressing ${i.key}`,
        run: (i) => json('page.press', i)
      },
      {
        name: 'firefox_scroll',
        description: 'Scroll a Firefox page: to "top" or "bottom", or by a screenful up or down. Returns the position.',
        input_schema: obj({ to: str('"top" or "bottom"'), direction: str('"up" or "down" (a screenful)'), id: num('Tab id') }),
        describe: () => 'Scrolling',
        run: (i) => json('page.scroll', i)
      },
      {
        name: 'firefox_navigate',
        description: 'Reload a Firefox tab, or go back or forward in its history.',
        input_schema: obj({ action: str('"reload", "back" or "forward"'), id: num('Tab id') }, ['action']),
        describe: (i) => (i.action === 'reload' ? 'Reloading' : `Going ${i.action}`),
        run: (i) => json(`tabs.${['back', 'forward'].includes(i.action) ? i.action : 'reload'}`, { id: i.id })
      },
      {
        name: 'firefox_close_tabs',
        description: 'Close Firefox tabs: one by id, or every tab whose title or URL has all of some words, or every duplicate of a page (the first of each is kept). Pinned tabs are never closed. At most 25 at once.',
        input_schema: obj({ id: num('Tab id'), match: str('Words from title or URL'), duplicates: { type: 'boolean' } }),
        confirm: (i) => (i.id != null ? null : i.duplicates ? 'Close the duplicate Firefox tabs?' : `Close the Firefox tabs matching "${i.match}"?`),
        describe: () => 'Closing tabs',
        run: (i) => json('tabs.close', i)
      }
    );
    if (visionCapable) {
      tools.push({
        name: 'firefox_screenshot',
        description: 'A picture of the visible part of a Firefox tab (the active one if no id; it is brought to the front first).',
        input_schema: obj({ id: num('Tab id') }),
        describe: () => 'Looking at the page',
        run: async (i) => {
          const r = await ff('page.screenshot', i);
          return { image: { mediaType: r.mediaType, data: r.data }, text: 'The visible part of the Firefox tab.' };
        }
      });
    }
  } else if (mac.browserTabs) {
    // No extension: the tab strip can still be read and pressed through accessibility.
    tools.push(
      {
        name: 'firefox_tabs',
        description: 'List the open tabs of the front Firefox window (titles only, read from the tab strip; the extension is not connected).',
        input_schema: obj({}),
        describe: () => 'Looking at your tabs',
        run: async () => JSON.stringify(await mac.browserTabs('Firefox'))
      },
      {
        name: 'firefox_switch_tab',
        description: 'Bring a Firefox tab to the front by words from its title (the extension is not connected, so this presses the tab in the tab strip).',
        input_schema: obj({ match: str('Words from the tab title') }, ['match']),
        describe: (i) => `Switching to ${i.match}`,
        run: async (i) => `Now on "${await mac.switchBrowserTab(i.match, 'Firefox')}".`
      }
    );
  }
  return tools;
}

module.exports = { buildTools };
