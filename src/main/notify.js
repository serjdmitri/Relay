// Tells your phone when a long job finishes, so you can walk away from the Mac. Two ways, both optional:
//   ntfy      a free notification service (ntfy.sh, or your own server): the phone has the ntfy app and subscribes to a secret topic Relay made up.
//   imessage  Relay sends you an iMessage from this Mac (to your own number or Apple ID), which shows up as a normal notification.
// By default only "Relay finished" and the request's first words are sent, never the answer. No Electron in here.

const crypto = require('crypto');

const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const DEFAULT_SERVER = 'https://ntfy.sh';

// A topic is the only secret: anyone who knows it can read what is sent to it, so it is long and random.
const newTopic = () => `relay-${crypto.randomBytes(12).toString('hex')}`;

// Should this finished job send a message? job: { seconds, status, remote, agent }
function shouldNotify(cfg, job) {
  if (!cfg?.enabled) return false;
  if (job.remote) return false; // the phone that asked sees the answer itself
  if (job.agent) return true; // a background agent is always something you walked away from
  if (job.status === 'stopped') return false;
  return (job.seconds || 0) >= Math.max(5, Number(cfg.minSeconds) || 30);
}

function messageFor(cfg, job) {
  const what = cut(job.text, 70);
  const failed = job.status === 'failed';
  const title = failed ? 'Relay hit a problem' : job.agent ? 'Relay agent finished' : 'Relay finished';
  const body = cfg.includeText && job.reply ? `${what ? `${what}: ` : ''}${cut(job.reply, 180)}` : what ? `${failed ? 'Could not finish' : 'Done'}: ${what}` : failed ? 'Something went wrong.' : 'Your request is done.';
  return { title, body };
}

class PhoneNotifier {
  // getConfig(): { enabled, channel: 'ntfy' | 'imessage', ntfyTopic, ntfyServer, imessageTo, minSeconds, includeText }; sendMessage(to, text): iMessage; fetchFn: for tests.
  constructor({ getConfig, sendMessage = async () => { throw new Error('iMessage is not available.'); }, fetchFn = (...a) => fetch(...a), log = console }) {
    Object.assign(this, { getConfig, sendMessage, fetchFn, log });
  }

  async send({ title, body }) {
    const cfg = this.getConfig() || {};
    if (cfg.channel === 'imessage') {
      if (!cfg.imessageTo) throw new Error('Add the phone number or Apple ID to send iMessages to.');
      await this.sendMessage(cfg.imessageTo, `${title}: ${body}`);
      return 'imessage';
    }
    if (!cfg.ntfyTopic) throw new Error('Make a topic first.');
    const server = String(cfg.ntfyServer || DEFAULT_SERVER).replace(/\/+$/, '');
    if (!/^https:\/\//.test(server) && !/^http:\/\/(?:localhost|127\.0\.0\.1)/.test(server)) throw new Error('The server address must start with https://.');
    const res = await this.fetchFn(`${server}/${encodeURIComponent(cfg.ntfyTopic)}`, { method: 'POST', headers: { Title: title.replace(/[^\x20-\x7e]/g, ''), Tags: 'white_check_mark', Priority: 'default' }, body });
    if (!res.ok) throw new Error(`The notification service answered ${res.status}.`);
    return 'ntfy';
  }

  // A job finished. Never throws and never waits for the phone: a message that cannot be sent is logged and dropped.
  async jobDone(job) {
    const cfg = this.getConfig() || {};
    if (!shouldNotify(cfg, job)) return false;
    try { await this.send(messageFor(cfg, job)); return true; } catch (e) { this.log.error?.('phone notification:', e.message); return false; }
  }

  // The "Send a test" button: says what happened in words.
  async test() {
    try { const via = await this.send({ title: 'Relay', body: 'This is a test. Your phone will hear from Relay when a long job finishes.' }); return { ok: true, via }; } catch (e) { return { ok: false, error: e.message }; }
  }
}

module.exports = { PhoneNotifier, shouldNotify, messageFor, newTopic, DEFAULT_SERVER };
