// Background agents: longer jobs (research, reading, writing into Notes) that run on their own while you do other things,
// each with progress shown in the top right of the screen. They cannot see or control the screen and cannot send or delete
// anything, so they never fight you for the mouse. The manager only keeps the list and the lifecycle; the app supplies how a job runs.

const crypto = require('crypto');

const MAX_RUNNING = 3;
const LINGER_MS = 15000; // a finished agent stays on screen this long, then goes

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
  }

  running() {
    return this.items.filter((a) => a.status === 'running');
  }

  // Starts an agent, or returns null when the limit is reached.
  start(task) {
    if (this.running().length >= this.max) return null;
    const ac = new AbortController();
    const a = { id: crypto.randomUUID(), task: String(task).trim(), status: 'running', step: 'Starting', steps: 0, startedAt: this.now(), result: '', ac, stopped: false };
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
    this.onChange();
    this.onFinish(a);
    this.setTimer(() => { this.items = this.items.filter((x) => x !== a); this.onChange(); }, this.linger);
  }

  // Stops the agents whose task has all of these words (all running ones with no query). Returns how many.
  stop(query = '') {
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    const hit = this.running().filter((a) => !a.stopped && words.every((w) => a.task.toLowerCase().includes(w)));
    for (const a of hit) { a.stopped = true; a.ac.abort(); }
    return hit.length;
  }

  // What the screen shows.
  view() {
    return this.items.map((a) => ({ id: a.id, task: cut(a.task, 90), status: a.status, step: a.step, steps: a.steps, startedAt: a.startedAt, endedAt: a.endedAt || null, result: cut(a.result, 170) }));
  }
}

const PREFIX = String.raw`^(?:(?:hey |ok |okay )?(?:relay|jarvis)[, ]+)?(?:please )?`;

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

module.exports = { AgentManager, parseAgentCommand, MAX_RUNNING, LINGER_MS };
