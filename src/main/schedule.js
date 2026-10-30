// Scheduled requests: "every weekday at 8, open my email". Pure functions plus a small scheduler that the app drives
// from a timer. A schedule is { id, text, repeat: 'once'|'daily'|'weekdays'|'weekends'|'weekly', hour, minute, days, next, enabled }.

const { parseClock, parseWhen, splitReminder } = require('./when');

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const D = DAYS.join('|');
const PARTS = { morning: [8, 0], afternoon: [14, 0], evening: [18, 0], night: [21, 0] };
const MISSED_MS = 45 * 60 * 1000; // late by more than this (the Mac was asleep or Relay was closed): skipped, not run out of the blue
const missedMessage = (s) => `"${s.text}" was missed while the Mac was asleep or Relay was closed.${s.repeat === 'once' ? ' Schedule it again if you still want it to run.' : ' It will run at its next scheduled time.'}`;

function acknowledgeUnknown(store, id, activeId) {
  if (typeof id !== 'string' || !id.startsWith('scheduled:') || id === activeId) return false;
  const entry = (store.get('history') || []).find((h) => h.id === id && h.status === 'unknown');
  if (!entry) return false;
  store.updateHistory(id, { status: 'resolved', reply: 'Outcome reviewed by the user; the result was not verified by Relay.' });
  return true;
}

const pad = (n) => String(n).padStart(2, '0');
const clockText = (h, m) => `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;

// "8" with no am or pm: 7 to 11 is the morning, 12 to 6 the afternoon or evening.
function to24(c) {
  let h = c.h;
  if (c.ampm === 'pm' && h < 12) h += 12;
  else if (c.ampm === 'am' && h === 12) h = 0;
  else if (!c.ampm && h >= 1 && h <= 6) h += 12;
  return h > 23 ? null : h;
}

function dayList(s) {
  return [...new Set([...s.matchAll(new RegExp(D, 'g'))].map((m) => DAYS.indexOf(m[0])))].sort((a, b) => a - b);
}

const norm = (text) => String(text).toLowerCase().replace(/[“”"]/g, '').replace(/\ba\.?m\.?\b/g, 'am').replace(/\bp\.?m\.?\b/g, 'pm').replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();

// A repeating schedule said in one sentence. Returns { text, repeat, hour, minute, days } or null.
function parseRepeating(raw) {
  let s = ` ${norm(raw)} `.replace(/,/g, ' , ');
  let repeat = null;
  let days = [];
  let part = null;
  const eat = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
    fn(m);
    return true;
  };
  const list = `(?:${D})s?(?:\\s*(?:,|and|&)\\s*(?:${D})s?)*`;
  eat(new RegExp(`\\b(?:every )?(?:${D}) (?:to|through|thru) (?:${D})\\b`), () => { repeat = 'weekdays'; });
  if (!repeat) eat(/\b(?:every (?:single )?weekday|on weekdays|weekdays)\b/, () => { repeat = 'weekdays'; });
  if (!repeat) eat(/\b(?:every weekend|on weekends|weekends)\b/, () => { repeat = 'weekends'; });
  if (!repeat) eat(/\b(?:every (?:single )?day|daily|each day|everyday)\b/, () => { repeat = 'daily'; });
  if (!repeat) eat(/\bevery (morning|afternoon|evening|night)\b/, (m) => { repeat = 'daily'; part = m[1]; });
  if (!repeat) eat(new RegExp(`\\bevery (${list})`), (m) => { repeat = 'weekly'; days = dayList(m[1]); });
  if (!repeat) eat(new RegExp(`\\bon (${list.replace(/s\?/g, 's')})\\b`), (m) => { repeat = 'weekly'; days = dayList(m[1]); }); // "on mondays"
  if (!repeat) return null;
  if (repeat === 'weekly' && !days.length) return null;

  let clock = null;
  eat(/\bat (noon|midday|midnight|\d{1,2}(?::\d{2})?(?: ?(?:am|pm))?)\b/, (m) => { clock = parseClock(m[1]); });
  let hour;
  let minute = 0;
  if (clock) { hour = to24(clock); minute = clock.m; }
  else if (part) [hour, minute] = PARTS[part];
  else return null; // no time: Relay asks
  if (hour === null || hour === undefined) return null;
  eat(/\b(?:every|each) (morning|afternoon|evening|night)\b/, () => {}); // "every morning at 8"
  const task = s
    .replace(/^\s*(?:please\s+)?(?:schedule|set up|create)?\s*(?:a |an )?(?:schedule|scheduled task|recurring task)?\s*(?:to|for|that|:)?\s+/, ' ')
    .replace(/\s*,\s*/g, ' ')
    .replace(/\b(?:and then|then)\s*$/, '')
    .replace(/\b(?:for|to|at|on|and)\s*$/, '')
    .replace(/^\s*(?:to|and|then|do|run)\s+/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!task || task.length < 3 || /^remind me\b/.test(task)) return null;
  return { text: task, repeat, hour, minute, days: repeat === 'weekly' ? days : [] };
}

// A single later run, said with "schedule": "schedule open my email for tomorrow at 7". Returns { text, repeat: 'once', at } or null.
function parseOnce(raw, now = new Date()) {
  const n = norm(raw);
  const m = n.match(/^(?:please )?(?:schedule|queue)(?: up)?\s+(.+)$/);
  if (!m) return null;
  const body = m[1].replace(/\bfor (?=(?:tomorrow|today|tonight|next|day after|in |on |at |this |\d))/g, '').replace(/^(?:a |an )?(?:task|request) (?:to )?/, '');
  const { what, when } = splitReminder(body, now);
  if (!when || !what || what.length < 3) return null;
  return { text: what, repeat: 'once', at: when.getTime() };
}

// Every spoken command about schedules. Returns null for anything else.
function parseScheduleCommand(raw, now = new Date()) {
  const n = norm(raw).replace(/^(?:(?:hey |ok |okay )?(?:relay|jarvis)[, ]+)/, '');
  if (/^(?:what(?:'s| is| are)(?: my| the| all)?(?: scheduled|(?: scheduled| recurring)? (?:tasks|schedules|requests))|list (?:my |the )?(?:scheduled|schedules|recurring)(?: tasks)?|what do i have scheduled|show (?:my )?schedules)$/.test(n)) return { type: 'schedule-list' };
  if (/^(?:cancel|delete|remove|clear|stop) (?:all|every|all of) (?:my |the )?(?:scheduled|schedules|recurring)(?: tasks| requests)?$/.test(n)) return { type: 'schedule-cancel-all' };
  let m = n.match(/^(?:cancel|delete|remove|stop|unschedule) (?:the |my )?(.+?) schedule$/) || n.match(/^(?:cancel|delete|remove|stop) (?:the |my )?(?:scheduled|recurring) (.+)$/) || n.match(/^unschedule (.+)$/);
  if (m && m[1] && !/^(?:that|it|this|all)$/.test(m[1])) return { type: 'schedule-cancel', query: m[1] };
  const rep = parseRepeating(raw);
  if (rep) return { type: 'schedule-add', ...rep };
  const once = parseOnce(raw, now);
  if (once) return { type: 'schedule-add', ...once };
  return null;
}

// The next time this schedule runs after `from` (a Date), as a timestamp, or null when it never will.
function nextRun(s, from = new Date()) {
  if (s.repeat === 'once') return s.at > from.getTime() ? s.at : null;
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(s.hour, s.minute, 0, 0);
    const dow = d.getDay();
    const ok = s.repeat === 'daily' || (s.repeat === 'weekdays' && dow >= 1 && dow <= 5) || (s.repeat === 'weekends' && (dow === 0 || dow === 6)) || (s.repeat === 'weekly' && (s.days || []).includes(dow));
    if (ok && d.getTime() > from.getTime()) return d.getTime();
  }
  return null;
}

function describe(s) {
  const t = clockText(s.hour ?? new Date(s.at).getHours(), s.minute ?? new Date(s.at).getMinutes());
  if (s.repeat === 'once') return `${new Date(s.at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} at ${t}`;
  const name = DAYS.map((d) => d[0].toUpperCase() + d.slice(1));
  if (s.repeat === 'daily') return `Every day at ${t}`;
  if (s.repeat === 'weekdays') return `Every weekday at ${t}`;
  if (s.repeat === 'weekends') return `Every weekend at ${t}`;
  return `Every ${(s.days || []).map((d) => name[d]).join(', ')} at ${t}`;
}

// The scheduler: keeps the list in the store, and on each tick hands over what is due. A run that is late by more than 45
// minutes is skipped and reported instead (the Mac was asleep), and the schedule moves on to its next time.
class Scheduler {
  constructor({ store, now = () => new Date() }) {
    this.store = store;
    this.now = now;
  }

  get items() {
    return this.store.get('schedules') || [];
  }

  save(list) {
    this.store.data.schedules = list;
    this.store.save();
  }

  add(spec, { id = Math.random().toString(36).slice(2) } = {}) {
    const s = { id, text: spec.text, repeat: spec.repeat, hour: spec.hour, minute: spec.minute, days: spec.days || [], at: spec.at, enabled: true, created: this.now().getTime() };
    s.next = nextRun(s, this.now());
    if (s.next === null) return null;
    this.save([...this.items, s]);
    return s;
  }

  remove(query) {
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (s) => words.every((w) => `${s.text} ${describe(s)}`.toLowerCase().includes(w));
    const removed = this.items.filter(hit);
    if (removed.length) this.save(this.items.filter((s) => !hit(s)));
    return removed;
  }

  removeId(id) {
    this.save(this.items.filter((s) => s.id !== id));
  }

  setEnabled(id, on) {
    const list = this.items.map((s) => (s.id === id ? { ...s, enabled: !!on, next: on ? nextRun(s, this.now()) : s.next } : s));
    this.save(list);
  }

  clear() {
    this.save([]);
  }

  // Returns { due: [schedule], missed: [schedule] }. canRun false leaves what is due for the next tick.
  tick(canRun = true) {
    const now = this.now();
    const due = [];
    const missed = [];
    let changed = false;
    const list = [];
    for (const s of this.items) {
      if (!s.enabled || !s.next || s.next > now.getTime()) { list.push(s); continue; }
      const late = now.getTime() - s.next;
      if (late <= MISSED_MS && (!canRun || due.length)) { list.push(s); continue; } // hand off at most one: leave others persisted until Relay is free
      changed = true;
      if (late > MISSED_MS) missed.push(s); else due.push(s);
      if (s.repeat === 'once') continue; // a one-time schedule is done either way
      list.push({ ...s, next: nextRun(s, now), lastRun: late <= MISSED_MS ? now.getTime() : s.lastRun });
    }
    if (changed) {
      // Persist the occurrence and schedule advancement together before handing a task
      // to the executor. If the process dies, its outcome is uncertain, not retried.
      const records = missed.map((s) => ({ id: `missed:${s.id}:${s.next}`, text: `Scheduled: ${s.text}`, status: 'missed', reply: missedMessage(s), ts: s.next, finishedAt: now.getTime() }));
      if (due.length) {
        const s = due[0];
        const runId = `scheduled:${s.id}:${s.next}`;
        s.runId = runId;
        records.push({ id: runId, text: `Scheduled: ${s.text}`, status: 'unknown', reply: 'Started or interrupted; the outcome has not been confirmed.', ts: s.next, finishedAt: now.getTime() });
      }
      const previousHistory = this.store.data.history;
      const previousSchedules = this.store.data.schedules;
      this.store.data.history = [...records, ...(previousHistory || [])].slice(0, 500);
      this.store.data.schedules = list;
      try {
        if (typeof this.store.flush === 'function') this.store.flush();
        else this.store.save();
      } catch (error) {
        // A failed write must not consume the schedule in memory either.
        this.store.data.history = previousHistory;
        this.store.data.schedules = previousSchedules;
        throw error;
      }
    }
    return { due, missed };
  }
}

module.exports = { parseScheduleCommand, parseRepeating, parseOnce, nextRun, describe, Scheduler, MISSED_MS, missedMessage, acknowledgeUnknown };
