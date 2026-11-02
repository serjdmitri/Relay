// Reads your Mac's notifications so Relay can tell you what you missed ("read my notifications") and, if you want, speak the important ones.
// macOS keeps them in a small database that only an app with Full Disk Access can open. Each notification's words are inside a binary property list,
// which the Mac's own `plutil` turns into text. All of the reading goes through an injected `run(file, args, input)`, so the rest is testable;
// the database's layout is Apple's and can change between macOS versions, so a failure is reported in words and never guessed around.

const os = require('os');
const path = require('path');

const KEEP_MS = 12 * 3600e3;
const MAX_KEPT = 40;
const APPLE_EPOCH = 978307200; // the database counts seconds from 2001-01-01

const dbCandidates = (home = os.homedir()) => [
  path.join(home, 'Library/Group Containers/group.com.apple.usernoted/db2/db'),
  path.join(home, 'Library/Application Support/NotificationCenter/db2/db')
];

const NAMES = {
  'com.apple.MobileSMS': 'Messages', 'com.apple.mail': 'Mail', 'com.apple.iCal': 'Calendar', 'com.apple.reminders': 'Reminders', 'com.apple.FaceTime': 'FaceTime',
  'com.tinyspeck.slackmacgap': 'Slack', 'com.hnc.Discord': 'Discord', 'ru.keepcoder.Telegram': 'Telegram', 'net.whatsapp.WhatsApp': 'WhatsApp',
  'com.microsoft.teams2': 'Teams', 'us.zoom.xos': 'Zoom', 'com.google.Chrome': 'Chrome', 'com.apple.Safari': 'Safari', 'com.apple.systempreferences': 'System Settings'
};
const appName = (id) => NAMES[id] || String(id || 'An app').split('.').filter(Boolean).pop().replace(/^./, (c) => c.toUpperCase());

const unescapeXml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

// The words of a notification out of `plutil -convert xml1` text: it keeps them under the keys titl (title), subt (subtitle) and body.
function parsePlistXml(xml) {
  const get = (key) => { const m = String(xml).match(new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`)); return m ? unescapeXml(m[1]).replace(/\s+/g, ' ').trim() : ''; };
  return { title: get('titl'), subtitle: get('subt'), body: get('body') };
}

const sqlFor = (since, limit = 30) => `select r.rec_id as id, a.identifier as app, r.delivered_date as at, hex(r.data) as data from record r join app a on a.app_id = r.app_id where r.rec_id > ${Number(since) || 0} order by r.rec_id desc limit ${Number(limit) || 30};`;

const fromHex = (hex) => Buffer.from(String(hex || ''), 'hex');

// Phones and speakers: "Messages from Anna: running late" or just "Mail: Invoice".
function describe(n) {
  const head = n.title ? `${n.appName} from ${n.title}` : n.appName;
  const rest = [n.subtitle, n.body].filter(Boolean).join('. ');
  return rest ? `${head}: ${rest}` : head;
}

// How much one notification matters to the speak-up rules: people talking to you rank above everything else.
function importanceOf(n) {
  if (/^(?:Messages|FaceTime|WhatsApp|Telegram|Discord|Slack|Teams)$/.test(n.appName)) return 0.6;
  if (n.appName === 'Calendar' || n.appName === 'Reminders') return 0.55;
  if (/security|alert|failed|verify|password|sign.?in/i.test(`${n.title} ${n.body}`)) return 0.7;
  return 0.2;
}

class NotificationReader {
  // run(file, args, input): runs a program and gives its text output. getSelfApp(): bundle id of Relay (its own notifications are skipped).
  constructor({ run, dbPaths = dbCandidates(), exists = () => true, now = Date.now, selfApps = ['com.relay.app'] } = {}) {
    Object.assign(this, { run, dbPaths, exists, now, selfApps });
    this.db = null;
    this.last = 0; // highest id seen
    this.baselined = false;
    this.recent = [];
  }

  findDb() {
    if (!this.db) this.db = this.dbPaths.find((p) => this.exists(p)) || null;
    return this.db;
  }

  async rows(since) {
    const db = this.findDb();
    if (!db) throw new Error('Could not find the notification database on this macOS version.');
    let out;
    try { out = await this.run('/usr/bin/sqlite3', ['-readonly', '-json', db, sqlFor(since)]); } catch (e) {
      if (/authorization|permission|not permitted|unable to open/i.test(String(e.message))) throw new Error('Reading notifications needs Full Disk Access for Relay (System Settings > Privacy & Security > Full Disk Access).');
      throw e;
    }
    return String(out).trim() ? JSON.parse(out) : [];
  }

  async decode(row) {
    let xml = '';
    try { xml = await this.run('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', '-'], fromHex(row.data)); } catch { /* an unreadable one is shown by app name only */ }
    const w = parsePlistXml(xml);
    return { id: row.id, app: row.app, appName: appName(row.app), ...w, at: row.at ? (Number(row.at) + APPLE_EPOCH) * 1000 : this.now() };
  }

  // New notifications since the last check, oldest first. The first check only remembers where things stand (it never reads out history).
  async poll() {
    const rows = await this.rows(this.last);
    if (!this.baselined) {
      this.baselined = true;
      this.last = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), this.last);
      return [];
    }
    const fresh = [];
    for (const r of rows.slice().reverse()) {
      this.last = Math.max(this.last, Number(r.id) || 0);
      if (this.selfApps.includes(r.app)) continue;
      const n = await this.decode(r);
      if (n.title || n.body || n.subtitle) fresh.push(n);
    }
    this.recent = [...this.recent, ...fresh].filter((n) => this.now() - n.at < KEEP_MS).slice(-MAX_KEPT);
    return fresh;
  }

  // What you missed, newest last, as sentences. app: only that app ("messages").
  summary({ app = '', max = 8 } = {}) {
    const want = String(app).toLowerCase().trim();
    const list = this.recent.filter((n) => !want || n.appName.toLowerCase() === want || n.appName.toLowerCase().startsWith(want));
    if (!list.length) return want ? `No recent notifications from ${app}.` : 'No recent notifications.';
    const shown = list.slice(-max);
    const more = list.length - shown.length;
    return `${shown.map(describe).join('. ')}.${more > 0 ? ` And ${more} older ${more === 1 ? 'one' : 'ones'}.` : ''}`;
  }
}

// "read my notifications", "what notifications did I miss", "any notifications from messages" -> { app } or null.
function parseNotificationCommand(text) {
  const n = String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '');
  let m = n.match(/^(?:read|check|show|tell me|what are|list) (?:me )?(?:my |the |all )?(?:new |recent |latest )?notifications?(?: from (?:my )?([a-z0-9 ]+))?$/)
    || n.match(/^(?:what|which) notifications?(?: did i| have i)?(?: miss| missed| get| got)?(?: from (?:my )?([a-z0-9 ]+))?$/)
    || n.match(/^(?:do i have|did i get|any) (?:any )?(?:new )?notifications?(?: from (?:my )?([a-z0-9 ]+))?$/);
  if (!m) return null;
  return { type: 'notifications', app: (m[1] || '').trim() };
}

module.exports = { NotificationReader, parsePlistXml, parseNotificationCommand, describe, importanceOf, appName, sqlFor, dbCandidates, APPLE_EPOCH };
