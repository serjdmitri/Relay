const crypto = require('crypto');
// Glue for "Command Relay by text": reads your own message thread, runs what you text (queued while the Mac slept, with later messages able to
// cancel earlier ones), texts the answers back, and asks risky questions on the phone too. The parts with rules are in imessage.js, queue.js
// and confirmHub.js; this file only connects them to the Mac. Needs Full Disk Access to read Messages.

const path = require('path');
const os = require('os');
const { Inbox, Pairing, SQL } = require('./imessage');
const q = require('./queue');
const { parseAnswer } = require('./confirmHub');

const POLL_MS = 5000;

class InboundService {
  // exec(file, args) -> stdout; send(text) texts your own thread; powerMonitor: Electron's, for wake events.
  constructor({ store, ask, hub, exec, send, flagOn, powerMonitor = null, home = os.homedir(), now = Date.now }) {
    Object.assign(this, { store, ask, hub, exec, send, flagOn, powerMonitor, now });
    this.db = path.join(home, 'Library/Messages/chat.db');
    this.pairing = new Pairing();
    this.inbox = null;
    this.timer = null;
    this.polling = false;
    this.mine = new Set(); // request ids that came from a text
    this.lastPoll = now();
    this.onWake = () => this.poll(true);
    this.error = '';
    hub.on('open', (item) => { if (item.origin === 'imessage') this.reply(`Relay needs a yes or no: ${item.question} Reply yes or no.`); });
    hub.on('reask', (item, n) => { if (item.origin === 'imessage') this.reply(`Still waiting (${n}/3): ${item.question} Reply yes or no.`); });
    hub.on('settle', (item, r) => {
      if (item.origin !== 'imessage') return;
      if (r.by === 'mac') this.reply(`Already answered on the Mac (${r.yes ? 'yes' : 'no'}).`);
      else if (r.by === 'expired') this.reply(`No answer, so I skipped it: ${item.question}`);
    });
  }

  owns(id) { return !!id && this.mine.has(id); }

  reply(text) { return this.inbox ? this.inbox.reply(text).catch(() => {}) : Promise.resolve(); }

  // A yes or no text answers the question that is waiting, if there is one.
  answer(text) {
    const open = this.hub.latest();
    if (!open || open.origin !== 'imessage') return false;
    const yes = parseAnswer(text);
    if (yes === null) return false;
    this.hub.answer(open.id, yes, 'phone');
    return true;
  }

  // Texts your own thread: the address it was paired from.
  async sendText(text) {
    const self = (this.store.get('inboundState') || {}).self;
    if (self) await this.send(self, text);
  }

  readRows(since) {
    return this.exec('/usr/bin/sqlite3', ['-readonly', '-json', this.db, SQL(since)]).then((out) => (String(out).trim() ? JSON.parse(out) : []));
  }

  start() {
    if (this.inbox || !this.flagOn()) return;
    this.inbox = new Inbox({
      readRows: (s) => this.readRows(s), send: (t) => this.sendText(t), pairing: this.pairing,
      load: () => this.store.get('inboundState') || { paired: false, last: 0 }, save: (s) => this.store.set('inboundState', s),
      onMessages: (cmds, o) => this.onMessages(cmds, o), onAnswer: (t) => this.answer(t)
    });
    if (!(this.store.get('inboundState') || {}).last) this.skipHistory(); // never run what was texted before you turned this on
    this.timer = setInterval(() => this.poll(), POLL_MS);
    this.powerMonitor?.on('resume', this.onWake);
    this.poll();
  }

  async skipHistory() {
    try {
      const rows = await this.readRows(0);
      this.inbox.state.last = rows.reduce((m, r) => Math.max(m, Number(r.rowid) || 0), 0);
      this.store.set('inboundState', this.inbox.state);
    } catch { /* no access yet: Doctor says so */ }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.powerMonitor?.removeListener?.('resume', this.onWake);
    this.inbox = null;
  }

  async poll(sleptThrough = false) {
    if (!this.inbox || this.polling) return;
    this.polling = true;
    try {
      // a gap much longer than the poll interval means the Mac was asleep
      const gap = this.now() - this.lastPoll;
      await this.inbox.poll({ sleptThrough: sleptThrough || gap > POLL_MS * 6 });
      this.error = '';
    } catch (e) { this.error = /authoriz|permission|not permitted|unable to open/i.test(String(e.message)) ? 'Full Disk Access is off' : String(e.message).slice(0, 120); } finally { this.lastPoll = this.now(); this.polling = false; }
  }

  newCode() { if (this.store.get('inboundState')?.paired) return null; return this.pairing.start(); }

  unpair() { this.inbox?.unpair(); if (!this.inbox) this.store.set('inboundState', { paired: false, last: (this.store.get('inboundState') || {}).last || 0 }); }

  status() { const s = this.store.get('inboundState') || {}; return { running: !!this.inbox, paired: !!s.paired, codeLive: this.pairing.live, error: this.error, unreadable: this.inbox?.unreadable || 0 }; }

  // New texts. With "Queue while the Mac sleeps" on they go through the queue (cancel, list, old ones held); otherwise they just run in order.
  async onMessages(cmds, { sleptThrough = false } = {}) {
    let run = cmds.map((c) => ({ id: crypto.randomUUID(), text: c.text }));
    if (this.flagOn('queue')) {
      const { list, notes, toRun } = q.applyBatch(q.prune(this.store.get('queue') || [], this.now()), cmds, { now: this.now(), id: () => crypto.randomUUID() });
      this.store.set('queue', list);
      for (const n of notes) await this.reply(n);
      run = toRun;
      const held = list.filter((i) => i.state === 'review').length;
      if (held) await this.reply(`${held} old request${held === 1 ? ' is' : 's are'} waiting for your OK on the Mac; I did not run ${held === 1 ? 'it' : 'them'}.`);
    }
    if (run.length && sleptThrough) await this.reply('Your Mac was asleep. Running that now.');
    for (const item of run) {
      if (this.flagOn('queue')) this.store.set('queue', q.mark(this.store.get('queue') || [], item.id, 'running'));
      const result = await this.runOne(item);
      if (this.flagOn('queue')) this.store.set('queue', q.mark(this.store.get('queue') || [], item.id, result.status === 'done' ? 'done' : 'cancelled'));
      await this.reply(String(result.reply || (result.status === 'done' ? 'Done.' : 'That did not work.')).slice(0, 900));
    }
  }

  // An old request that was held for your OK (on the Mac): run it now, or drop it.
  async releaseReview(id, run) {
    const list = this.store.get('queue') || [];
    const item = list.find((i) => i.id === id && i.state === 'review');
    if (!item) return { ok: false };
    if (!run) { this.store.set('queue', q.mark(list, id, 'cancelled')); return { ok: true }; }
    this.store.set('queue', q.mark(list, id, 'running'));
    const result = await this.runOne(item);
    this.store.set('queue', q.mark(this.store.get('queue') || [], id, result.status === 'done' ? 'done' : 'cancelled'));
    await this.reply(String(result.reply || 'Done.').slice(0, 900));
    return { ok: true };
  }

  runOne(item) {
    return new Promise((resolve) => {
      this.mine.add(item.id);
      const off = this.ask.addResultListener((r) => { if (r.id !== item.id) return; off(); this.mine.delete(item.id); resolve(r); });
      this.ask.remoteAsk(item.text, { name: 'iMessage' }, item.id);
    });
  }

  // The same risky question, asked on the phone too: the first answer, from the Mac or the phone, settles it.
  askPhone(question) { return this.hub.open({ id: `phone-${Math.random().toString(36).slice(2)}`, question, origin: 'imessage' }); }
}

module.exports = { InboundService, POLL_MS };
