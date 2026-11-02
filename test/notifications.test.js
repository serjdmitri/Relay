const test = require('node:test');
const assert = require('node:assert/strict');
const n = require('../src/main/notifications');

const xml = (t, s, b) => `<?xml version="1.0"?><plist><dict><key>app</key><string>com.apple.MobileSMS</string><key>req</key><dict><key>titl</key><string>${t}</string><key>subt</key><string>${s}</string><key>body</key><string>${b}</string></dict></dict></plist>`;

test('parsePlistXml reads title, subtitle and body and unescapes entities', () => {
  assert.deepEqual(n.parsePlistXml(xml('Anna &amp; Bo', '', 'running  late &lt;5 min&gt;')), { title: 'Anna & Bo', subtitle: '', body: 'running late <5 min>' });
  assert.deepEqual(n.parsePlistXml('garbage'), { title: '', subtitle: '', body: '' });
});

function fakeRun(rowsByCall, plists) {
  const calls = [];
  const run = async (file, args, input) => {
    calls.push([file, args]);
    if (file.endsWith('sqlite3')) return JSON.stringify(rowsByCall.shift() || []);
    return plists[input.toString('hex')] || '';
  };
  return { run, calls };
}
const hex = (s) => Buffer.from(s).toString('hex');

test('the first poll only remembers where things stand; later polls return new notifications, oldest first, skipping Relay\'s own', async () => {
  const plists = { [hex('a')]: xml('Anna', '', 'lunch?'), [hex('b')]: xml('Relay', '', 'hi'), [hex('c')]: xml('Invoice', '', 'due today') };
  const { run } = fakeRun([
    [{ id: 5, app: 'com.apple.mail', at: 1, data: hex('old') }],
    [{ id: 8, app: 'com.apple.mail', at: 100, data: hex('c') }, { id: 7, app: 'com.relay.app', at: 99, data: hex('b') }, { id: 6, app: 'com.apple.MobileSMS', at: 98, data: hex('a') }]
  ], plists);
  const r = new n.NotificationReader({ run, exists: () => true, now: () => (100 + n.APPLE_EPOCH) * 1000 });
  assert.deepEqual(await r.poll(), []);
  assert.equal(r.last, 5);
  const fresh = await r.poll();
  assert.deepEqual(fresh.map((x) => [x.id, x.appName, x.title]), [[6, 'Messages', 'Anna'], [8, 'Mail', 'Invoice']]);
  assert.equal(r.last, 8);
});

test('summary speaks what you missed, can filter by app, and says so when there is nothing', async () => {
  const plists = { [hex('a')]: xml('Anna', '', 'lunch?'), [hex('c')]: xml('Bank', '', 'Security alert') };
  const { run } = fakeRun([[], [{ id: 2, app: 'com.apple.mail', at: 100, data: hex('c') }, { id: 1, app: 'com.apple.MobileSMS', at: 100, data: hex('a') }]], plists);
  const r = new n.NotificationReader({ run, now: () => (100 + n.APPLE_EPOCH) * 1000 });
  assert.equal(r.summary(), 'No recent notifications.');
  await r.poll(); await r.poll();
  assert.equal(r.summary(), 'Messages from Anna: lunch?. Mail from Bank: Security alert.');
  assert.equal(r.summary({ app: 'messages' }), 'Messages from Anna: lunch?.');
  assert.equal(r.summary({ app: 'slack' }), 'No recent notifications from slack.');
});

test('a locked database says to turn on Full Disk Access; a missing one says the layout was not found', async () => {
  const denied = new n.NotificationReader({ run: async () => { throw new Error('Error: unable to open database file'); } });
  await assert.rejects(denied.poll(), /Full Disk Access/);
  const none = new n.NotificationReader({ run: async () => '[]', exists: () => false });
  await assert.rejects(none.poll(), /Could not find the notification database/);
});

test('importance: people rank above ordinary apps; sign-in alerts rise', () => {
  assert.equal(n.importanceOf({ appName: 'Messages', title: 'Anna', body: 'hi' }), 0.6);
  assert.equal(n.importanceOf({ appName: 'Photos', title: 'Memories', body: 'new' }), 0.2);
  assert.equal(n.importanceOf({ appName: 'Photos', title: 'New sign-in', body: '' }), 0.7);
});

test('notification commands are understood', () => {
  assert.deepEqual(n.parseNotificationCommand('read my notifications'), { type: 'notifications', app: '' });
  assert.deepEqual(n.parseNotificationCommand('Relay, what notifications did I miss?'), { type: 'notifications', app: '' });
  assert.deepEqual(n.parseNotificationCommand('any notifications from messages'), { type: 'notifications', app: 'messages' });
  assert.equal(n.parseNotificationCommand('open notes'), null);
});
