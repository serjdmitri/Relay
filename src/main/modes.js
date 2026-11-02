// Modes: a name for a whole setup. "Create a mode called gaming that opens Steam and Discord and closes Slack and Mail", then "start gaming mode".
// Starting one opens its apps and pages, quits the apps it lists (they come back when you end the mode), puts a saved window layout in place, and can
// start focus mode. Only modes you made exist, so a phrase like "study mode" that is not yours is left for the rest of Relay to handle.

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const strip = (s) => clean(s).replace(/^(?:my|the|a|an) /, '').replace(/ mode$/, '').trim();
const NAME = '([a-z0-9][a-z0-9 ]{0,24}?)';

const splitList = (s) => String(s || '').split(/,| and |\band\b|&/i).map((x) => x.trim()).filter(Boolean);
const cap = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

// -> { type: 'mode-start' | 'mode-end' | 'mode-create' | 'mode-list' | 'mode-forget', ... } or null
function parseModeCommand(text) {
  const raw = String(text || '').replace(/[“”"]/g, '').trim().replace(/[.!?]+$/, '');
  const n = clean(raw).replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '');
  let m;
  if (/^(?:what|which|list|show)(?: are| is)?(?: all)?(?: of)? (?:my )?(?:saved )?modes(?: do i have| i have)?$/.test(n)) return { type: 'mode-list' };
  // create a mode called gaming that opens steam and discord and closes slack and mail
  if ((m = n.match(new RegExp(`^(?:create|make|save|set up|add|define) (?:me )?(?:a |new |a new )?mode (?:called|named) ${NAME}(?: that| which| with| to)?(?: opens?| open| launches?)? (.+)$`)))) {
    const name = strip(m[1]);
    const rest = m[2];
    const [openPart, closePart] = rest.split(/ (?:and |but )?(?:closes?|quits?|shuts|closing) /);
    const open = splitList(openPart.replace(/^(?:opens?|launch(?:es)?) /, '').replace(/ (?:and )?$/, ''));
    const quit = closePart ? splitList(closePart) : [];
    if (name && (open.length || quit.length)) return { type: 'mode-create', name, open: open.map(cap), quit: quit.map(cap) };
  }
  if ((m = n.match(new RegExp(`^(?:forget|delete|remove|drop) (?:my |the )?${NAME} mode$`)))) return { type: 'mode-forget', name: strip(m[1]) };
  if ((m = n.match(new RegExp(`^(?:end|stop|leave|exit|turn off|finish|disable|quit) (?:my |the )?${NAME} mode$`)))) return { type: 'mode-end', name: strip(m[1]) };
  if ((m = n.match(new RegExp(`^(?:start|begin|enter|switch to|go into|go to|activate|turn on|enable|use|set up|run|open) (?:my |the )?${NAME} mode$`)))
    || (m = n.match(new RegExp(`^(?:my |the )?${NAME} mode(?: please| on)?$`)))
    || (m = n.match(new RegExp(`^(?:i m|i am) (?:going to |about to )?(?:start )?${NAME} mode$`)))) {
    const name = strip(m[1]);
    if (name && !/^(?:focus|study|workshop|dark|night|light|low power|airplane|do not disturb)$/.test(name)) return { type: 'mode-start', name };
  }
  return null;
}

class Modes {
  // store: get/data/save. mac: listApps(), openApp(), quitApp(), openUrl(url, null). layouts: restore(name) | null. focus: start({minutes}) / end({}) | null
  constructor({ store, mac, layouts = null, focus = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) { Object.assign(this, { store, mac, layouts, focus, sleep }); }

  get items() { return this.store.get('modes') || []; }
  save(list) { this.store.data.modes = list; this.store.save(); }
  get active() { return this.store.get('modeState') || null; }
  set active(v) { this.store.data.modeState = v; this.store.save(); }
  find(name) { const w = clean(name); return this.items.find((x) => clean(x.name) === w); }
  has(name) { return !!this.find(name); }

  create({ name, open = [], quit = [], urls = [], layout = '', focus = 0 }) {
    const entry = { name: String(name).trim().slice(0, 24), open, quit, urls, layout, focus };
    const replacing = this.has(name);
    this.save([...this.items.filter((x) => clean(x.name) !== clean(name)), entry]);
    const bits = [];
    if (open.length) bits.push(`opens ${open.join(', ')}`);
    if (quit.length) bits.push(`closes ${quit.join(', ')}`);
    return `${replacing ? 'Updated' : 'Saved'} your ${entry.name} mode: it ${bits.join(' and ')}. Say "start ${entry.name} mode" to use it.`;
  }

  list() {
    const L = this.items;
    return L.length ? `You have ${L.length} ${L.length === 1 ? 'mode' : 'modes'}: ${L.map((x) => x.name).join(', ')}.` : 'You have no modes yet. Try: "create a mode called gaming that opens Steam and Discord and closes Slack".';
  }

  forget(name) {
    const m = this.find(name);
    if (!m) return `I do not have a ${name} mode.`;
    this.save(this.items.filter((x) => x !== m));
    return `Forgot your ${m.name} mode.`;
  }

  async start(name) {
    const mode = this.find(name);
    if (!mode) return null;
    if (this.active && clean(this.active.name) !== clean(mode.name)) await this.end({ quiet: true });
    const running = (await this.mac.listApps().catch(() => [])).map((a) => a.toLowerCase());
    const closed = [], opened = [], failed = [];
    for (const app of mode.quit || []) {
      if (!running.includes(app.toLowerCase())) continue;
      try { await this.mac.quitApp(app); closed.push(app); } catch { failed.push(app); } // an app that wants to save something is left alone
    }
    for (const app of mode.open || []) {
      if (running.includes(app.toLowerCase())) continue;
      try { await this.mac.openApp(app); opened.push(app); } catch { failed.push(app); }
    }
    for (const url of mode.urls || []) { try { await this.mac.openUrl(url, null); } catch { /* a bad link is skipped */ } }
    let laid = false;
    if (mode.layout && this.layouts) { await this.sleep(opened.length ? 1500 : 0); laid = !!(await this.layouts.restore(mode.layout).catch(() => null))?.ok; }
    let focused = false;
    if (mode.focus && this.focus) { await this.focus.start({ minutes: mode.focus }).then(() => { focused = true; }).catch(() => {}); }
    this.active = { name: mode.name, closed, opened, focused, at: Date.now() };
    const bits = [`${mode.name} mode is on.`];
    if (opened.length) bits.push(`Opened ${opened.join(', ')}.`);
    if (closed.length) bits.push(`Closed ${closed.join(', ')}.`);
    if (laid) bits.push('Windows are in place.');
    if (focused) bits.push(`Focus is on for ${mode.focus} minutes.`);
    if (failed.length) bits.push(`Could not handle ${failed.join(', ')}.`);
    return { reply: bits.join(' '), undo: async () => (await this.end({})).reply };
  }

  // Ends it: focus off, the apps it closed come back. It does not close what it opened (you may be using them).
  async end({ quiet = false } = {}) {
    const s = this.active;
    if (!s) return { reply: quiet ? '' : 'No mode is on.' };
    this.active = null;
    if (s.focused && this.focus) await this.focus.end({ quiet: true }).catch(() => {});
    const back = [];
    for (const app of s.closed || []) { try { await this.mac.openApp(app); back.push(app); } catch { /* gone */ } }
    return { reply: quiet ? '' : `${s.name} mode is off.${back.length ? ` Reopened ${back.join(', ')}.` : ''}` };
  }
}

module.exports = { Modes, parseModeCommand };
