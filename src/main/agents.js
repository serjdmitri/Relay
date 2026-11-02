// Background agents: longer jobs (research, reading, writing into Notes) that run on their own while you do other things,
// each with progress shown in the top right of the screen. They cannot see or control the screen and cannot send or delete
// anything, so they never fight you for the mouse. The manager only keeps the list and the lifecycle; the app supplies how a job runs.

const crypto = require('crypto');

const MAX_RUNNING = 3;
const LINGER_MS = 15000; // a finished agent stays on screen this long, then goes
const MAX_QUEUE = 10; // jobs waiting for a free slot (the dashboard queues; saying "start an agent" still refuses at the limit)
const MAX_HISTORY = 20; // finished agents the dashboard keeps for review, this session only

const cut = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s));

class AgentManager {
  constructor({ run, onChange = () => {}, onFinish = () => {}, max = MAX_RUNNING, linger = LINGER_MS, now = Date.now, setTimer = setTimeout }) {
    this.run = run; // (agent, signal) => Promise<{ status, reply }>
    this.onChange = onChange;
    this.onFinish = onFinish;
    this.max = max;
    this.linger = linger;
    this.now = now;
    this.setTimer = setTimer;
    this.items = [];
    this.queue = [];
    this.history = [];
  }

  running() {
    return this.items.filter((a) => a.status === 'running');
  }

  // Starts an agent, or returns null when the limit is reached.
  start(task, id = crypto.randomUUID()) {
    if (this.running().length >= this.max) return null;
    const ac = new AbortController();
    const a = { id, task: String(task).trim(), status: 'running', step: 'Starting', steps: 0, startedAt: this.now(), result: '', ac, stopped: false };
    this.items.push(a);
    this.onChange();
    Promise.resolve()
      .then(() => (ac.signal.aborted ? { status: 'stopped', reply: 'Stopped.' } : this.run(a, ac.signal)))
      .catch((e) => ({ status: 'failed', reply: e.message }))
      .then((r) => this._end(a, r || { status: 'failed', reply: 'No answer.' }));
    return a;
  }

  progress(a, label) {
    if (a.status !== 'running' || !label || label === a.step) return;
    a.step = cut(label, 80);
    a.steps++;
    this.onChange();
  }

  _end(a, r) {
    if (a.status !== 'running') return;
    a.status = a.stopped ? 'stopped' : r.status === 'done' ? 'done' : 'failed';
    a.result = String(r.reply || '');
    a.endedAt = this.now();
    this.history.unshift({ id: a.id, task: a.task, status: a.status, steps: a.steps, startedAt: a.startedAt, endedAt: a.endedAt, result: String(a.result).slice(0, 8000) });
    this.history = this.history.slice(0, MAX_HISTORY);
    this.onChange();
    this.onFinish(a);
    this.setTimer(() => { this.items = this.items.filter((x) => x !== a); this.onChange(); }, this.linger);
    this._startNext();
  }

  // A slot freed up: the job that has waited longest starts.
  _startNext() {
    while (this.queue.length && this.running().length < this.max) {
      const q = this.queue.shift();
      if (!this.start(q.task, q.id)) { this.queue.unshift(q); break; }
    }
    this.onChange();
  }

  // For the dashboard: start now if there is a free slot, otherwise wait in line. Returns { started | queued, id } or { error }.
  submit(task) {
    const text = String(task || '').trim();
    if (text.length < 4) return { error: 'Tell me what the job should do.' };
    const a = this.start(text);
    if (a) return { started: true, id: a.id };
    if (this.queue.length >= MAX_QUEUE) return { error: `${MAX_QUEUE} jobs are already waiting. Let some finish first.` };
    const q = { id: crypto.randomUUID(), task: text, at: this.now() };
    this.queue.push(q);
    this.onChange();
    return { queued: true, id: q.id, position: this.queue.length };
  }

  // Cancel one job by its id: a running one is stopped, a waiting one is dropped. Returns 'running', 'queued' or null.
  cancel(id) {
    const q = this.queue.findIndex((x) => x.id === id);
    if (q >= 0) { this.queue.splice(q, 1); this.onChange(); return 'queued'; }
    const a = this.running().find((x) => x.id === id);
    if (a && !a.stopped) { a.stopped = true; a.ac.abort(); return 'running'; }
    return null;
  }

  clearFinished() { const n = this.history.length; this.history = []; this.onChange(); return n; }

  // Everything the dashboard shows.
  snapshot() {
    return {
      max: this.max, maxQueue: MAX_QUEUE, now: this.now(),
      running: this.running().map((a) => ({ id: a.id, task: a.task, step: a.step, steps: a.steps, startedAt: a.startedAt, stopping: !!a.stopped })),
      queued: this.queue.map((q, i) => ({ id: q.id, task: q.task, position: i + 1, waitingSince: q.at })),
      finished: this.history.map((h) => ({ ...h }))
    };
  }

  // Stops the agents whose task has all of these words (all running ones with no query). Returns how many.
  stop(query = '') {
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    const hit = this.running().filter((a) => !a.stopped && words.every((w) => a.task.toLowerCase().includes(w)));
    // Waiting jobs that match are dropped first, so a freed slot does not start one the person just asked to stop.
    const waiting = this.queue.filter((q) => words.every((w) => q.task.toLowerCase().includes(w)));
    if (waiting.length) { this.queue = this.queue.filter((q) => !waiting.includes(q)); this.onChange(); }
    for (const a of hit) { a.stopped = true; a.ac.abort(); }
    return hit.length + waiting.length;
  }

  // What the screen shows.
  view() {
    return this.items.map((a) => ({ id: a.id, task: cut(a.task, 90), status: a.status, step: a.step, steps: a.steps, startedAt: a.startedAt, endedAt: a.endedAt || null, result: cut(a.result, 170) }));
  }
}

const PREFIX = String.raw`^(?:(?:hey |ok |okay )?(?:relay|jarvis)[, ]+)?(?:please )?`;

// "agents dashboard", "open the agent manager": the window with every agent, a queue and cancel buttons. ("what are my agents doing" stays a spoken answer.)
function parseAgentsDashboardCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/[.!?]+$/, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/\s+/g, ' ').toLowerCase();
  return /^(?:open|show|bring up|pull up|display)(?: me)?(?: my| the| all my)? (?:background )?(?:agents?|jobs?) (?:dashboard|window|board|manager|panel|list)$/.test(n) || /^(?:agents?|jobs?) (?:dashboard|manager|board)$/.test(n) || /^open (?:all )?(?:my )?agents$/.test(n);
}

// "In the background, research the best headphones and save it in a note", "start an agent to …", "what are my agents doing",
// "stop all agents". A request that merely ends with "in the background" ("play jazz in the background") is not one.
function parseAgentCommand(text) {
  const t = String(text || '').trim().replace(/[“”"]/g, '');
  let m;
  if (new RegExp(`${PREFIX}(?:what(?:'s| is| are)|how(?:'s| are| is)) (?:my |the )?(?:background )?(?:agents?|helpers?)(?: (?:doing|up to|going|getting on))?[?.!]*$`, 'i').test(t) || new RegExp(`${PREFIX}(?:show|list) (?:me )?(?:my |the )?(?:background )?(?:agents|helpers)[.!]*$`, 'i').test(t)) return { type: 'agent-list' };
  if ((m = t.match(new RegExp(`${PREFIX}(?:stop|cancel|kill|end) (?:all |every |the |my )*(?:background )?(?:agents?|helpers?)(?: (?:that(?:'s| is| are) )?(?:working on|doing|about|on|for))?\\s*(.*?)[.!]*$`, 'i')))) return { type: 'agent-stop', query: (m[1] || '').trim() };
  if ((m = t.match(new RegExp(`${PREFIX}(?:run this |do this |do it |work on this |handle this )?(?:in the background|as a background (?:task|agent|job)|in a background agent)[:,]?\\s+(.+?)[.!]*$`, 'i')))) return { type: 'agent-start', task: m[1].trim() };
  if ((m = t.match(new RegExp(`${PREFIX}(?:start|launch|spawn|send|run|use|have|get|create|kick off) (?:me )?(?:an? |another |one )?(?:background )?(?:agent|helper)(?: to| that| and| and have it| and let it)?[:,]?\\s+(.+?)[.!]*$`, 'i')))) return { type: 'agent-start', task: m[1].trim() };
  return null;
}

module.exports = { AgentManager, parseAgentCommand, parseAgentsDashboardCommand, MAX_RUNNING, LINGER_MS, MAX_QUEUE, MAX_HISTORY };
