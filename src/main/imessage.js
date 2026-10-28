// Command Relay by text. Only your own message thread (you texting yourself) is read, and only after a one-time pairing code. Messages from
// any other thread or sender are never looked at beyond a count. The reading and sending are injected, so everything here is testable.
//
// Messages' database lives at ~/Library/Messages/chat.db and can only be opened with Full Disk Access. Newer macOS versions sometimes keep a
// message's words only in a binary column (`attributedBody`); `textOf` reads those too, and rows with no readable words are counted, not guessed.

const crypto = require('crypto');

const MARK = 'Relay: '; // everything Relay sends starts with this, so it never reads its own replies as commands
const CODE_MS = 10 * 60000;

class Pairing {
  constructor({ now = Date.now, code = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0') } = {}) {
    this.now = now;
    this.makeCode = code;
    this.current = null;
  }

  start() { this.current = { code: this.makeCode(), until: this.now() + CODE_MS }; return this.current.code; }

  // Does this text hold the live code? A code works once.
  check(text) {
    const c = this.current;
    if (!c || this.now() > c.until) return false;
    if (!String(text || '').replace(/\D/g, ' ').split(/\s+/).includes(c.code)) return false;
    this.current = null;
    return true;
  }

  get live() { return !!this.current && this.now() <= this.current.until; }
}

// The words of a message from a `text` column or the `attributedBody` blob (hex from sqlite).
function textOf(row) {
  if (row.text) return String(row.text).trim();
  const hex = row.body_hex;
  if (!hex) return '';
  try {
    const buf = Buffer.from(hex, 'hex');
    const i = buf.indexOf(Buffer.from('NSString'));
    if (i < 0) return '';
    let p = i + 8;
    while (p < buf.length && buf[p] !== 0x2b) p++; // the '+' that precedes the string's length
    if (p >= buf.length) return '';
    p++;
    let len = buf[p++];
    if (len === 0x81) { len = buf.readUInt16LE(p); p += 2; } else if (len === 0x82) { len = buf.readUInt32LE(p); p += 4; }
    return buf.slice(p, p + len).toString('utf8').trim();
  } catch { return ''; }
}

// A message in the thread you share with yourself: the thread's name is your own address, and you sent it.
const isSelfChat = (row) => !!row.chat_identifier && !!row.account && String(row.chat_identifier).toLowerCase() === String(row.account).replace(/^[EPe]:/, '').toLowerCase();

const SQL = (since) => `SELECT m.ROWID AS rowid, m.text AS text, hex(m.attributedBody) AS body_hex, m.date AS date, m.is_from_me AS is_from_me, c.chat_identifier AS chat_identifier, m.account AS account FROM message m JOIN chat_message_join j ON j.message_id = m.ROWID JOIN chat c ON c.ROWID = j.chat_id WHERE m.ROWID > ${Number(since) | 0} ORDER BY m.ROWID LIMIT 200`;

// Messages stores dates as nanoseconds (newer macOS) or seconds since 2001-01-01.
const toMs = (d) => ((Number(d) > 1e12 ? Number(d) / 1e6 : Number(d) * 1000) + Date.UTC(2001, 0, 1));

class Inbox {
  // readRows(since) -> rows; send(text); load()/save(state): { paired, last }; onMessages(list, { sleptThrough }) is given the new commands, oldest first.
  constructor({ readRows, send, load, save, onMessages, pairing = new Pairing(), onAnswer = () => false, now = Date.now }) {
    Object.assign(this, { readRows, send, load, save, onMessages, pairing, onAnswer, now });
    this.state = { paired: false, last: 0, ...load() };
    this.unreadable = 0;
    this.ignored = 0;
  }

  reply(text) { return this.send(`${MARK}${String(text).slice(0, 900)}`); }

  async poll({ sleptThrough = false } = {}) {
    const rows = await this.readRows(this.state.last);
    if (!rows.length) return { handled: 0 };
    const cmds = [];
    for (const r of rows) {
      this.state.last = Math.max(this.state.last, Number(r.rowid) || 0);
      if (!isSelfChat(r)) { this.ignored++; continue; }
      if (!r.is_from_me) continue; // your own thread, but not you: nothing from outside is a command
      const text = textOf(r);
      if (!text) { this.unreadable++; continue; }
      if (text.startsWith(MARK)) continue; // Relay's own reply
      if (!this.state.paired) {
        if (this.pairing.check(text)) { this.state.paired = true; this.state.self = r.chat_identifier; this.save(this.state); await this.reply('Paired. You can text me commands here.'); }
        continue;
      }
      if (this.onAnswer(text)) continue; // a yes or no to a question that is waiting
      cmds.push({ text, ts: toMs(r.date), rowid: Number(r.rowid) });
    }
    this.save(this.state);
    if (cmds.length) await this.onMessages(cmds, { sleptThrough });
    return { handled: cmds.length };
  }

  unpair() { this.state = { paired: false, last: this.state.last, self: this.state.self }; this.save(this.state); }
}

module.exports = { Pairing, Inbox, textOf, isSelfChat, SQL, toMs, MARK, CODE_MS };
