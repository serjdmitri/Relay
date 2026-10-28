// Fewer tools in front of the model. Relay has dozens of tools; the rarely used groups (Firefox, holograms, Drive, homework files, shell, background agents)
// are hidden from the tool list and reached through two small tools: load_more_tools(category) lists a group with how to call each tool, and
// use_tool(name, input) runs one. Everything still goes through the same confirmations and the home-folder guard, because use_tool calls the real tool.
//
// The Claude session is started while you are still talking, before the request is known, and its tool list is read once and cannot be pushed to
// the process again. So the hidden groups are reached through these two tools instead of being added to the list later. When the request is known
// (a fresh process, Codex) the groups it clearly needs are shown directly.

const GROUPS = {
  firefox: { about: 'control Firefox: tabs, read a page, click and type in a page, screenshots of a tab', match: (n) => n.startsWith('firefox_'), asks: /\b(?:firefox|browser|tabs?|web ?page|website|webpage|on the page|this page)\b/i },
  holograms: { about: '3D models and holograms, answer cards', match: (n) => /^(?:show_3d|save_3d|design_3d|edit_3d|read_3d|show_card)$/.test(n), asks: /\b(?:3d|model|hologram|cad|stl|printable|card|what does .* look like|picture of|photo of)\b/i },
  drive: { about: 'find, tidy and organize files on external drives and folders (scan, propose, apply, undo)', match: (n) => n.startsWith('drive_'), asks: /\b(?:drive|tidy|organi[sz]e|clean up|duplicates?|sort my|rename (?:my )?files)\b/i },
  homework: { about: 'save a document (Word, PDF, text) or a project folder of files', match: (n) => n === 'make_document' || n === 'save_files' || n === 'start_quiz', asks: /\b(?:essay|assignment|homework|worksheet|outline|draft|report|study|quiz|flashcards?|project|template|document|pdf|word file)\b/i },
  system: { about: 'run AppleScript or shell commands', match: (n) => n === 'run_applescript' || n === 'run_shell', asks: /\b(?:script|terminal|shell|command line|applescript|install|brew|git|npm|pip|python|node|run (?:a )?command)\b/i },
  agents: { about: 'start a background agent for a long job', match: (n) => n === 'start_background_agent', asks: /\b(?:in the background|background agent|while i|keep working|long job)\b/i }
};

const LOADER = new Set(['load_more_tools', 'use_tool']);

const groupOf = (name) => Object.keys(GROUPS).find((g) => GROUPS[g].match(name)) || null;

// The groups a request clearly asks for. An empty list means "not sure", which shows nothing extra (the model can still load any group).
const classify = (request) => Object.keys(GROUPS).filter((g) => GROUPS[g].asks.test(String(request || '')));

// The tool names shown directly: everything not in a hidden group, plus the groups the request asks for.
function exposure(tools, { request = '', loaded = [] } = {}) {
  const show = new Set([...classify(request), ...loaded]);
  return new Set(tools.filter((t) => { const g = groupOf(t.name); return !g || show.has(g); }).map((t) => t.name));
}

const hiddenGroups = (tools, exposed) => Object.keys(GROUPS).filter((g) => tools.some((t) => groupOf(t.name) === g && !exposed.has(t.name)));

function loaderDefs(tools, exposed) {
  const hidden = hiddenGroups(tools, exposed);
  if (!hidden.length) return [];
  const list = hidden.map((g) => `${g} (${GROUPS[g].about})`).join('; ');
  return [
    { name: 'load_more_tools', description: `Some tools are not listed to keep things quick. Call this with a group name to see its tools and how to call them. Groups: ${list}.`, inputSchema: { type: 'object', properties: { group: { type: 'string', description: `One of: ${hidden.join(', ')}` } }, required: ['group'] } },
    { name: 'use_tool', description: 'Run a tool from a group you looked at with load_more_tools. Same effect (and the same confirmations) as calling it directly.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, input: { type: 'object' } }, required: ['name'] } }
  ];
}

// load_more_tools: the group's tools as text; they are listed directly from then on if the client asks again.
function loadMore(run, group) {
  const g = String(group || '').trim().toLowerCase();
  if (!GROUPS[g]) return `Unknown group "${g}". Groups: ${Object.keys(GROUPS).join(', ')}.`;
  const tools = run.tools.filter((t) => groupOf(t.name) === g);
  for (const t of tools) run.exposed.add(t.name);
  return tools.length ? tools.map((t) => `${t.name}: ${t.description}\ninput: ${JSON.stringify(t.input_schema)}`).join('\n\n') + '\n\nCall one with use_tool(name, input).' : `No tools in "${g}" right now.`;
}

module.exports = { GROUPS, LOADER, groupOf, classify, exposure, loaderDefs, loadMore, hiddenGroups };
