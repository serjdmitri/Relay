// For a robotics team: checklists you run by voice ("start the match day checklist", then "done", "done", "skip"), and "log this" to add a line to a Google Sheet.
// Pure; the controller does the speaking and the Sheet call.

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

const DEFAULT_LISTS = {
  'match day': ['Battery is fresh, strapped down, and the connector is tight', 'Main breaker is on and the robot power light is lit', 'Radio is powered and its lights are right', 'Bumpers are on and the right alliance color', 'Wheels, belts and chains are tight, nothing is loose', 'Wires are tucked in and nothing hangs low', 'Pneumatics are at full pressure with no leaks', 'Driver station laptop is charged and connected to the robot', 'Controllers are plugged in and each one moves the right thing', 'The right autonomous is selected', 'Spare battery is charging', 'Team is in the queue with the cart and the tools'],
  'between matches': ['Swap in a fresh battery and put the used one on the charger', 'Look over the robot for anything bent, loose or hanging', 'Check bumpers and the robot number', 'Check the code deployed is the one you want', 'Write down what went wrong and what went right', 'Eat, drink some water and check the next match time'],
  'pack up': ['Batteries are on chargers or in their bags', 'Tools and spare parts are counted and in the toolbox', 'Bumpers are off and bagged', 'Laptops and controllers are packed with their cables', 'Pit area is clear of trash', 'Everyone has their things']
};
const ALIASES = { 'match day': ['match', 'pre match', 'prematch', 'queue', 'match day', 'before the match', 'before a match'], 'between matches': ['between matches', 'between match', 'pit', 'pit stop', 'turnaround', 'in between'], 'pack up': ['pack up', 'load out', 'loadout', 'pack', 'end of day', 'teardown'] };

function resolveName(raw, names) {
  const t = clean(raw).replace(/\b(?:the|my|our|a)\b/g, ' ').replace(/\s+/g, ' ').replace(/ check ?list$/, '').trim();
  if (!t) return null;
  const exact = names.find((n) => clean(n) === t);
  if (exact) return exact;
  for (const [name, al] of Object.entries(ALIASES)) if (names.includes(name) && al.includes(t)) return name;
  return names.find((n) => clean(n).includes(t) || t.includes(clean(n))) || null;
}

// names: the checklists that exist. active: one is running. Returns { type: 'cl-start'|'cl-list'|'cl-show'|'cl-add'|'cl-remove'|'cl-control', ... } or null.
function parseChecklistCommand(text, { names = Object.keys(DEFAULT_LISTS), active = false } = {}) {
  const n = clean(text).replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '').replace(/ please$/, '');
  if (active) {
    if (/^(?:done|check|checked|check it|checked it|that's done|that s done|its done|it's done|it s done|all good|good|ok|okay|yes|yep|ready|got it|next|next one|next item|complete|finished)$/.test(n)) return { type: 'cl-control', op: 'done' };
    if (/^(?:skip|skip it|skip this|skip that|pass)$/.test(n)) return { type: 'cl-control', op: 'skip' };
    if (/^(?:not yet|later|come back to it|come back to that|not done|not done yet|in a minute|hold on)$/.test(n)) return { type: 'cl-control', op: 'later' };
    if (/^(?:back|go back|previous|last one|the one before)$/.test(n)) return { type: 'cl-control', op: 'back' };
    if (/^(?:repeat|say it again|repeat that|what was that|again)$/.test(n)) return { type: 'cl-control', op: 'repeat' };
    if (/^(?:what's left|what s left|whats left|how many left|how many are left|what is left|status|progress|where am i)$/.test(n)) return { type: 'cl-control', op: 'status' };
    if (/^(?:stop|end|cancel|quit|exit|abort|that's enough|that s enough)(?: the)?(?: check ?list)?$/.test(n)) return { type: 'cl-control', op: 'stop' };
  }
  let m;
  if (/^(?:what|which) check ?lists? (?:do i have|are there|have i got|do we have|exist)$|^(?:list|show) (?:my |the |our )?check ?lists$/.test(n)) return { type: 'cl-list' };
  if ((m = n.match(/^(?:start|begin|run|do|go through|let's do|let s do|lets do|let's run|let s run|lets run|open|use|read me|walk me through|take me through)(?: me)?(?: the| my| our| a)? (.+?) check ?list$/)) || (m = n.match(/^(?:start|begin|run|do|go through)(?: the| my| our)? check ?list(?: for| called)? (.+)$/))) {
    const name = resolveName(m[1], names);
    return name ? { type: 'cl-start', name } : null;
  }
  if ((m = n.match(/^(?:show|read|list|what's on|what s on|whats on|what is on)(?: me)?(?: the| my| our)? (.+?) check ?list$/)) || (m = n.match(/^what(?:'s| s) on (?:the |my |our )?(.+?) check ?list$/))) {
    const name = resolveName(m[1], names);
    return name ? { type: 'cl-show', name } : null;
  }
  if ((m = n.match(/^add (.+?) to (?:the |my |our )?(.+?) check ?list$/)) || (m = n.match(/^add to (?:the |my |our )?(.+?) check ?list[: ]+(.+)$/))) {
    const swap = /^add to /.test(n);
    const name = resolveName(swap ? m[1] : m[2], names);
    return name ? { type: 'cl-add', name, item: (swap ? m[2] : m[1]).trim() } : null;
  }
  if ((m = n.match(/^(?:remove|delete|take) (.+?) (?:from|off|out of) (?:the |my |our )?(.+?) check ?list$/))) {
    const name = resolveName(m[2], names);
    return name ? { type: 'cl-remove', name, item: m[1].trim() } : null;
  }
  return null;
}

class Checklist {
  constructor(name, items) {
    this.name = name;
    this.items = items.map((t, i) => ({ id: i, text: String(t), state: 'todo', later: false }));
    this.queue = this.items.map((i) => i.id);
    this.done = false;
    this.cursor = 0;
  }

  get total() { return this.items.length; }
  get current() { return this.done ? null : this.items[this.queue[0]] || null; }
  count(state) { return this.items.filter((i) => i.state === state).length; }
  get left() { return this.queue.length; }

  ask() {
    const c = this.current;
    if (!c) return this.summary();
    return `${c.later ? 'Back to: ' : `${c.id + 1} of ${this.total}: `}${c.text}?`;
  }

  mark(state) {
    const c = this.current;
    if (!c) return this.summary();
    c.state = state;
    this.queue.shift();
    return this.next();
  }

  later() {
    const c = this.current;
    if (!c) return this.summary();
    if (this.queue.length === 1) return `That is the last one. Say “done” or “skip”.`;
    c.later = true;
    this.queue.push(this.queue.shift());
    return this.ask();
  }

  back() {
    const prev = [...this.items].reverse().find((i) => i.state !== 'todo');
    if (!prev) return `You are at the first one. ${this.ask()}`;
    prev.state = 'todo';
    this.queue.unshift(prev.id);
    this.done = false;
    return this.ask();
  }

  next() {
    if (!this.queue.length) { this.done = true; return this.summary(); }
    return this.ask();
  }

  status() {
    const c = this.current;
    return `${this.count('done')} done, ${this.count('skipped')} skipped, ${this.left} to go.${c ? ` Next: ${c.text}.` : ''}`;
  }

  summary() {
    const skipped = this.items.filter((i) => i.state === 'skipped');
    const open = this.items.filter((i) => i.state === 'todo');
    const name = this.name.charAt(0).toUpperCase() + this.name.slice(1);
    return `${name} checklist ${open.length ? 'stopped' : 'finished'}: ${this.count('done')} of ${this.total} done.${skipped.length ? ` Skipped: ${skipped.map((i) => i.text.replace(/[.?!]+$/, '').toLowerCase()).join('; ')}.` : ''}${open.length ? ` Not reached: ${open.length}.` : ''}`;
  }

  // One line for the log sheet.
  logLine() { return this.summary().replace(/^(\S.*?) checklist /, '$1 checklist: '); }
}

// ---- the log sheet ----
// "log this", "log this: drifted left on the ramp", "log that battery 3 sagged", "add to the log: new bumpers", "set my log sheet to <link>", "which sheet is my log".
function parseLogCommand(text) {
  const raw = String(text || '').trim();
  const n = clean(raw).replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '');
  let m;
  const url = raw.match(/https?:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (/^(?:set|use|change|make|point)\b.*\b(?:log|logbook|log book)\b/.test(n) && /\bsheet\b|\bspreadsheet\b/.test(n)) {
    if (url) return { type: 'log-sheet', id: url[1] };
    if (/\b(?:copied|clipboard|i copied)\b/.test(n)) return { type: 'log-sheet', id: null, fromClipboard: true };
    return { type: 'log-sheet', id: null, fromClipboard: true };
  }
  if (/^(?:which|what) sheet is (?:my |the |our )?(?:log|logbook|log book)(?: sheet)?$|^where (?:does|do) (?:the |my )?log go$/.test(n)) return { type: 'log-where' };
  if (/^log (?:in|out|off|on|into|onto)\b/.test(n)) return null;
  const rest = raw.replace(/^(?:hey |ok |okay )?(?:relay |jarvis )?(?:please )?/i, '');
  if ((m = rest.match(/^(?:log|add to (?:the |my |our )?log(?: sheet)?|write (?:this |that |it )?(?:in|to) (?:the |my |our )?log(?: sheet)?|note (?:this |that |it )?in (?:the |my |our )?log)(?: (?:this|that|it))?\s*[:,\-]?\s*(.*)$/i)) && /^(?:log|add to|write|note)/i.test(rest)) {
    const note = m[1].trim().replace(/[.]+$/, '');
    if (/^(?:in|out|off|on)\b/i.test(note) && /^log\b/i.test(rest) && !/^log (?:this|that|it)/i.test(rest)) return null;
    return { type: 'log-add', note };
  }
  return null;
}

const sheetIdFrom = (text) => { const m = String(text || '').match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/) || String(text || '').trim().match(/^([A-Za-z0-9_-]{30,})$/); return m ? m[1] : null; };

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

module.exports = { DEFAULT_LISTS, parseChecklistCommand, Checklist, resolveName, parseLogCommand, sheetIdFrom, stamp };
