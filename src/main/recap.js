// The daily recap: what Relay did today, from the activity log. Counts the things that changed something ("created 2 notes, moved 18 files"), points out the ones
// worth a second look (anything sent, moved to the Trash, run as a command or a script, typed for you), and says which of them can be undone with one tap.
// Never repeats message text, typed text or clipboard contents: those can hold private things. Pure.

const path = require('path');

// tool -> [singular, plural, risk]. risk: 0 harmless, 1 worth knowing, 2 worth a look. Tools not listed here and not read-only are counted as "other actions".
const CHANGES = {
  open_app: ['opened an app', 'opened apps', 0], focus_app: ['switched to an app', 'switched between apps', 0], quit_app: ['quit an app', 'quit apps', 1], open_url: ['opened a web page', 'opened web pages', 0],
  open_path: ['opened a file or folder', 'opened files or folders', 0], reveal_path: ['showed a file in Finder', 'showed files in Finder', 0],
  trash_path: ['moved an item to the Trash', 'moved items to the Trash', 2], notes_create: ['created a note', 'created notes', 0], notes_append: ['added to a note', 'added to notes', 0],
  reminders_add: ['added a reminder', 'added reminders', 0], reminders_complete: ['completed a reminder', 'completed reminders', 0], calendar_create: ['added a calendar event', 'added calendar events', 1], gcal_create: ['added a calendar event', 'added calendar events', 1],
  messages_send: ['sent a message', 'sent messages', 2], gmail_send: ['sent an email', 'sent emails', 2], gmail_draft: ['saved an email draft', 'saved email drafts', 0],
  arrange_window: ['moved a window', 'moved windows', 0], type_text: ['typed text for you', 'typed text for you', 1], press_keys: ['pressed keys for you', 'pressed keys for you', 1], ui_click: ['clicked in an app', 'clicked in apps', 1], menu_click: ['used a menu', 'used menus', 1], click: ['clicked on the screen', 'clicked on the screen', 1],
  clipboard_write: ['put text on the clipboard', 'put text on the clipboard', 0], set_volume: ['changed the volume', 'changed the volume', 0], toggle_dark_mode: ['switched dark mode', 'switched dark mode', 0],
  run_applescript: ['ran a script', 'ran scripts', 2], run_shell: ['ran a command', 'ran commands', 2], drive_apply: ['tidied files', 'tidied files', 1], drive_make: ['made a file', 'made files', 0], drive_undo: ['put files back', 'put files back', 0],
  sheet_append: ['added a line to a Google Sheet', 'added lines to Google Sheets', 1], notion_create: ['created a Notion page', 'created Notion pages', 0], notion_append: ['added to a Notion page', 'added to Notion pages', 0],
  schedule_task: ['scheduled something', 'scheduled things', 0], start_background_agent: ['started a background agent', 'started background agents', 0], remember: ['remembered something about you', 'remembered things about you', 0], forget_memory: ['forgot something', 'forgot things', 0],
  firefox_click: ['clicked in Firefox', 'clicked in Firefox', 1], firefox_type: ['typed in Firefox', 'typed in Firefox', 1], firefox_navigate: ['browsed in Firefox', 'browsed in Firefox', 0]
};

const base = (p) => path.basename(String(p || '')) || 'an item';
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

// One readable line for an action, without any private contents.
function line(a) {
  const i = a.input || {};
  switch (a.tool) {
    case 'trash_path': return `Moved ${base(i.path)} to the Trash`;
    case 'messages_send': return `Sent a message${i.to ? ` to ${clip(i.to, 40)}` : ''}`;
    case 'gmail_send': return `Sent an email${i.to ? ` to ${clip(i.to, 40)}` : ''}`;
    case 'run_shell': return `Ran a command: ${clip(i.command, 70)}`;
    case 'run_applescript': return 'Ran a script';
    case 'type_text': return `Typed ${String(i.text || '').length} characters for you`;
    case 'drive_apply': return clip(a.result, 90) || 'Moved files into folders';
    case 'sheet_append': return 'Added a line to the log sheet';
    case 'quit_app': return `Quit ${clip(i.name || i.app, 40) || 'an app'}`;
    case 'calendar_create': case 'gcal_create': return `Added the event “${clip(i.title, 50)}”`;
    case 'notes_create': return `Created the note “${clip(i.title, 50)}”`;
    case 'open_app': return `Opened ${clip(i.name || i.app, 40) || 'an app'}`;
    default: return (CHANGES[a.tool]?.[0] || a.tool.replace(/_/g, ' ')).replace(/^./, (c) => c.toUpperCase());
  }
}

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const plural = (n, one, many) => (n === 1 ? one : many);
const ago = (t, now) => { const m = Math.max(0, Math.round((now - t) / 60000)); return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

// actions: the activity log (newest first); history: requests; undoable: ids that can be undone now. Returns what the card and the voice need.
function buildRecap({ actions = [], history = [], now = Date.now(), undoable = new Set() } = {}) {
  const from = startOfDay(now);
  const today = actions.filter((a) => a.ts >= from && a.tool !== 'undo');
  const requests = history.filter((h) => h.ts >= from && !/^Agent:/.test(h.text || '')).length;
  const changed = today.filter((a) => a.ok && CHANGES[a.tool]);
  const failed = today.filter((a) => !a.ok);
  const counts = new Map();
  for (const a of changed) counts.set(a.tool, (counts.get(a.tool) || 0) + 1);
  const parts = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([tool, n]) => (n === 1 ? CHANGES[tool][0] : `${CHANGES[tool][1]} ${n} times`));
  const listed = changed.filter((a) => CHANGES[a.tool][2] >= 1 || undoable.has(a.id)).map((a) => ({ id: a.id, text: line(a), when: ago(a.ts, now), ts: a.ts, risk: CHANGES[a.tool][2], undoable: undoable.has(a.id) })).sort((x, y) => y.risk - x.risk || y.ts - x.ts);
  const worth = listed.filter((x) => x.risk >= 2);
  const canUndo = changed.filter((a) => undoable.has(a.id)).length;
  const bits = [];
  if (!today.length && !requests) return { empty: true, requests, changed: 0, failed: 0, undoable: 0, parts: [], items: [], worth: [], spoken: 'I have not done anything today.' };
  bits.push(`Today you made ${requests} ${plural(requests, 'request', 'requests')}${changed.length ? ` and I took ${changed.length} ${plural(changed.length, 'action', 'actions')} that changed something${parts.length ? `: ${parts.slice(0, 4).join(', ')}${parts.length > 4 ? ', and more' : ''}` : ''}` : ' and I changed nothing'}.`);
  if (worth.length) bits.push(`${worth.length === 1 ? 'One is' : `${worth.length} are`} worth a look: ${worth.slice(0, 3).map((x) => x.text.replace(/^./, (c) => c.toLowerCase())).join('; ')}.`);
  if (canUndo) bits.push(`${canUndo === 1 ? 'One' : canUndo} can be undone with one tap.`);
  if (failed.length) bits.push(`${failed.length} did not work.`);
  if (changed.length || failed.length) bits.push('The list is in History, under Actions.');
  return { empty: false, requests, changed: changed.length, failed: failed.length, undoable: canUndo, parts, items: listed.slice(0, 12), worth, spoken: bits.join(' ') };
}

// "daily recap", "recap my day", "what did you do today", "what did Relay do today", "what have you done today".
function parseRecapCommand(text) {
  const n = String(text || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '').replace(/ please$/, '');
  return /^(?:(?:give me |show me |do |run |start )?(?:a |my |the |today's |todays )?(?:daily )?recap(?: of)?(?: my| the| this)?(?: day| today)?|recap (?:my |the |this )?(?:day|today)|what (?:did|have) (?:you|relay|jarvis) (?:do|done|did)(?: for me)?(?: today| so far| this (?:morning|afternoon|evening))?|what did i (?:ask|have) (?:you|relay) (?:to )?(?:do )?today|what have i (?:asked|had) (?:you|relay) (?:to )?(?:do )?today|summary of (?:my |the )?(?:day|today)|what happened today)$/.test(n) ? { type: 'recap' } : null;
}

module.exports = { buildRecap, parseRecapCommand, line, CHANGES };
