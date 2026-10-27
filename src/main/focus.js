// Focus mode by voice: "focus mode for 25 minutes", "I need to focus for an hour". It closes the distracting apps you listed, turns on Do Not Disturb if
// you have a Shortcut for it, and starts a timer; when the time is up (or you say "end focus mode") it turns notifications back on and reopens what it closed.
// macOS gives apps no dependable way to switch a Focus on, so that part is a Shortcut you make once (see FOCUS_HELP).

const { parseDuration } = require('./when');

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const DEFAULT_APPS = ['Messages', 'Slack', 'Discord', 'Mail', 'Telegram', 'WhatsApp', 'Steam', 'Twitter', 'Instagram', 'Facebook', 'Reddit'];
const FOCUS_HELP = 'To silence notifications too, open the Shortcuts app, make a Shortcut named “Relay Focus On” with the action “Set Focus” (Do Not Disturb, on), and one named “Relay Focus Off” (off).';

// Returns { type: 'focus-start', minutes? } | { type: 'focus-end' } | { type: 'focus-status' } or null.
function parseFocusCommand(text) {
  const n = clean(text).replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '').replace(/ please$/, '');
  let m;
  if (/^(?:stop|end|turn off|exit|leave|cancel|finish|disable) (?:my |the )?focus(?: mode| session| time)?$/.test(n) || /^(?:i am|im|i m) done (?:focusing|with focus(?: mode)?)$/.test(n) || /^focus (?:mode )?off$/.test(n)) return { type: 'focus-end' };
  if (/^(?:how (?:much )?(?:time|long)(?: is)? (?:left|remaining) (?:in|on) (?:my |the )?focus(?: mode| session| time)?|focus(?: mode)? status|am i in focus(?: mode)?)$/.test(n)) return { type: 'focus-status' };
  const dur = (s) => (s ? parseDuration(s) : 0);
  if ((m = n.match(/^(?:start |turn on |enter |begin |go into |activate |switch on |enable )?focus mode(?: for (.+))?$/)) || (m = n.match(/^(?:start|begin|turn on|enable) (?:a |my |the )?focus(?: session| time)?(?: for (.+))?$/)) ||
      (m = n.match(/^(?:i need to|let me|help me|i want to|i have to|time to|lets|let s|let us) focus(?: for (.+))?$/)) || (m = n.match(/^focus for (.+)$/)) || (m = n.match(/^(?:give me|set up) (.+?) of focus$/))) {
    const seconds = dur(m[1]);
    if (m[1] && !seconds) return null; // "focus for the exam" is not a length of time
    return { type: 'focus-start', minutes: seconds ? Math.max(1, Math.round(seconds / 60)) : 0 };
  }
  return null;
}

const sameApp = (a, b) => a.toLowerCase() === b.toLowerCase();

class FocusMode {
  // store: get/set/data; mac: listApps(), quitApp(), openApp(), hasShortcut(), runShortcut(); timers: add(seconds, label, extra), cancel(id)
  constructor({ store, mac, timers, now = Date.now }) {
    Object.assign(this, { store, mac, timers, now });
  }

  get cfg() { return { apps: DEFAULT_APPS, minutes: 25, shortcutOn: 'Relay Focus On', shortcutOff: 'Relay Focus Off', reopen: true, ...(this.store.get('settings.focus') || {}) }; }
  get state() { return this.store.get('focusState') || null; }
  set state(v) { this.store.data.focusState = v; this.store.save(); }
  get active() { const s = this.state; return !!s && s.until > this.now(); }

  async start({ minutes = 0 } = {}) {
    const cfg = this.cfg;
    if (this.active) await this.end({ quiet: true });
    const mins = Math.max(1, Math.min(480, minutes || cfg.minutes || 25));
    const running = await this.mac.listApps().catch(() => []);
    const toClose = running.filter((r) => cfg.apps.some((a) => sameApp(a, r)));
    const closed = [];
    for (const app of toClose) {
      try { await this.mac.quitApp(app); closed.push(app); } catch { /* it asked to save something: leave it */ }
    }
    let silenced = false;
    if (await this.mac.hasShortcut(cfg.shortcutOn).catch(() => false)) {
      try { await this.mac.runShortcut(cfg.shortcutOn); silenced = true; } catch { /* the Shortcut failed: carry on without it */ }
    }
    const t = this.timers.add(mins * 60, `Focus time is up. ${mins} ${mins === 1 ? 'minute' : 'minutes'} done.`, { focus: true });
    this.state = { until: this.now() + mins * 60000, minutes: mins, closed, silenced, timerId: t.id };
    const bits = [`Focus mode on for ${mins} ${mins === 1 ? 'minute' : 'minutes'}.`];
    if (closed.length) bits.push(`Closed ${closed.join(', ')}.`);
    bits.push(silenced ? 'Notifications are off.' : FOCUS_HELP);
    return { reply: bits.join(' '), undo: async () => (await this.end({})).reply };
  }

  // Ends it: timer cancelled, notifications back on, the apps it closed reopened (unless that is switched off).
  async end({ quiet = false, auto = false } = {}) {
    const s = this.state;
    if (!s) return { reply: 'Focus mode is not on.' };
    try { this.timers.cancel(s.timerId); } catch { /* it already rang */ }
    this.state = null;
    if (s.silenced) await this.mac.runShortcut(this.cfg.shortcutOff).catch(() => {});
    const reopened = [];
    if (this.cfg.reopen) for (const app of s.closed || []) { try { await this.mac.openApp(app); reopened.push(app); } catch { /* not installed any more */ } }
    if (quiet) return { reply: '' };
    return { reply: `${auto ? 'Focus time is over.' : 'Focus mode off.'}${s.silenced ? ' Notifications are back.' : ''}${reopened.length ? ` Reopened ${reopened.join(', ')}.` : ''}` };
  }

  status() {
    const s = this.state;
    if (!s || s.until <= this.now()) return 'Focus mode is not on.';
    const left = Math.max(1, Math.round((s.until - this.now()) / 60000));
    return `Focus mode: about ${left} ${left === 1 ? 'minute' : 'minutes'} left.`;
  }
}

module.exports = { FocusMode, parseFocusCommand, DEFAULT_APPS, FOCUS_HELP };
