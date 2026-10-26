// "Remember this as <name>": turning what Relay just did into steps it can repeat with no model at all.
// Only plain, repeatable actions qualify. If the request used anything that depends on what was on screen at the time
// (a click at pixels, a screenshot-guided scroll), it cannot be replayed safely, so it is saved as words instead.

// Actions that do the same thing every time they are run.
const REPLAYABLE = new Set([
  'open_app', 'focus_app', 'quit_app', 'open_url', 'open_path', 'reveal_path', 'trash_path',
  'notes_create', 'notes_append', 'reminders_add', 'calendar_create', 'messages_send',
  'arrange_window', 'type_text', 'press_keys', 'ui_click', 'menu_click', 'clipboard_write',
  'set_volume', 'toggle_dark_mode', 'firefox_open', 'run_applescript', 'run_shell'
]);

// Looking, not doing: these leave no mark, so they are simply left out of what is saved.
const READ_ONLY = new Set([
  'list_running_apps', 'list_folder', 'notes_list', 'notes_read', 'reminders_list', 'calendar_events', 'ui_list',
  'web_search', 'fetch_page', 'clipboard_read', 'selected_text', 'screenshot', 'see_marked_area', 'firefox_tabs', 'firefox_read_page',
  'point_at_element', 'draw_on_screen', 'guide_step', 'point_at'
]);

// calls: [{ tool, input, ok }] in the order they ran. Returns [{ tool, input }] or null when it cannot be repeated.
function learnFrom(calls) {
  const steps = [];
  for (const c of calls || []) {
    if (!c || !c.ok) continue; // a step that failed (and was retried another way) is not part of the recipe
    if (READ_ONLY.has(c.tool)) continue;
    if (!REPLAYABLE.has(c.tool)) return null;
    steps.push({ tool: c.tool, input: c.input || {} });
  }
  return steps.length ? steps : null;
}

// A short phrase for the pill while a step runs.
function describeStep(step) {
  const i = step.input || {};
  const what = i.name || i.app || i.url || i.path || i.title || i.text || i.keys || i.command || '';
  return `${step.tool.replace(/_/g, ' ')}${what ? `: ${String(what).slice(0, 40)}` : ''}`;
}

module.exports = { learnFrom, describeStep, REPLAYABLE, READ_ONLY };
