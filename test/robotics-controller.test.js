const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { explainPrompt, needsDevices } = require('../src/main/explain');
const { DEFAULT_LISTS } = require('../src/main/robotics');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

function rig({ usb = [], ports = [], volumes = [], scan = null, sheet = true, clip = '', selected = '', google = true } = {}) {
  const data = { 'settings.robotics': { lists: {}, sheetId: sheet ? 'S'.repeat(44) : '' } };
  const appended = [], cards = [], actions = [];
  const c = Object.create(AskController.prototype);
  Object.assign(c, {
    store: { get: (k) => (k === 'settings.robotics.lists' ? data['settings.robotics'].lists : k === 'settings.robotics' ? data['settings.robotics'] : data[k]), set: (k, v) => { if (k === 'settings.robotics.lists') data['settings.robotics'].lists = v; else if (k === 'settings.robotics.sheetId') data['settings.robotics'].sheetId = v; else data[k] = v; }, addAction: (a) => actions.push(a) },
    onChange() {}, cardPanel: { show: async (x) => { cards.push(x); } }, push() {},
    hw: { usb: async () => usb, ports: () => ports, volumes: async () => volumes, scan: async () => scan || { files: 0, dirs: 0, bytes: 0, groups: {}, tops: {}, biggest: [], stopped: '', unreadable: 0, names: new Set() } },
    mac: { clipboardRead: async () => clip, selectedText: async () => selected },
    googleApiIfConnected: () => (google ? { sheetAppend: async (...a) => { appended.push(a); return { updated: 1 }; } } : null)
  });
  return { c, data, appended, cards, actions };
}

test('devices: the Arduino is found by name and by port, and the reply says what to try when it is not', async () => {
  const usb = [{ name: 'Arduino Uno', vendor: 'Arduino', vendorId: '2341', productId: '0043' }];
  const ports = [{ path: '/dev/cu.usbmodem1101', guess: 'a board with built-in USB (Arduino, Pico, Teensy)' }];
  assert.match((await rig({ usb, ports }).c.devicesCommand({ type: 'devices', filter: 'arduino' })).reply, /^Yes: Arduino \(Arduino Uno\)\. Serial ports: \/dev\/cu\.usbmodem1101/);
  assert.match((await rig().c.devicesCommand({ type: 'devices', filter: 'arduino' })).reply, /some only charge/);
  assert.match((await rig({ ports }).c.devicesCommand({ type: 'devices', filter: 'ports', ports: true })).reply, /One serial port: \/dev\/cu\.usbmodem1101/);
});

const SD = { name: 'ROBOTCAM', path: '/Volumes/ROBOTCAM', info: { name: 'ROBOTCAM', fs: 'ExFAT', protocol: 'Secure Digital', media: 'SD Card Reader', solid: null, removable: true, external: true, internal: false, total: 63.82e9, free: 47.2e9, used: 16.62e9, mounted: true } };
const SSD = { name: 'Backup', path: '/Volumes/Backup', info: { name: 'Backup', fs: 'APFS', protocol: 'USB', media: 'Portable SSD', solid: true, removable: false, external: true, internal: false, total: 1e12, free: 4e11, used: 6e11, mounted: true } };

test('drives: the one that matches is looked at, a mismatch is said, two are listed, none says what to do', async () => {
  const scan = { files: 3, dirs: 1, bytes: 9e6, groups: { photos: { count: 3, bytes: 9e6 } }, tops: { DCIM: { files: 3, bytes: 9e6, dir: true } }, biggest: [{ path: '/Volumes/ROBOTCAM/DCIM/a.jpg', bytes: 5e6 }], stopped: '', unreadable: 0, names: new Set(['DCIM']) };
  const one = rig({ volumes: [SD], scan });
  const r = await one.c.driveCommand({ type: 'drive-inspect', want: 'SD card', name: '' });
  assert.match(r.reply, /^ROBOTCAM: SD card, ExFAT, 63.8 GB\./);
  assert.match(r.reply, /camera card/);
  assert.equal(one.cards[0].title, 'ROBOTCAM (SD card)');
  assert.match((await rig({ volumes: [SD], scan }).c.driveCommand({ type: 'drive-inspect', want: 'SSD', name: '' })).reply, /^I do not see an SSD, but there is an SD card\. ROBOTCAM/);
  const two = await rig({ volumes: [SD, SSD], scan }).c.driveCommand({ type: 'drive-inspect', want: null, name: '' });
  assert.match(two.reply, /I see 2 drives: ROBOTCAM \(SD card, 63.8 GB\); Backup \(SSD, 1 TB\)/);
  assert.match((await rig({ volumes: [SD, SSD], scan }).c.driveCommand({ type: 'drive-inspect', want: 'SSD', name: '' })).reply, /^Backup: SSD/);
  assert.match((await rig({ volumes: [SD, SSD], scan }).c.driveCommand({ type: 'drive-inspect', want: null, name: 'robotcam' })).reply, /^ROBOTCAM: SD card/);
  assert.match((await rig().c.driveCommand({ type: 'drive-inspect', want: 'SD card', name: '' })).reply, /do not see any external drive/);
  assert.match((await rig({ volumes: [SD] }).c.driveCommand({ type: 'drives' })).reply, /One drive: ROBOTCAM \(SD card, 63.8 GB\)/);
  assert.match((await rig({ volumes: [{ ...SD, info: { ...SD.info, internal: true, external: false } }] }).c.driveCommand({ type: 'drives' })).reply, /No external drives/, 'the startup disk is not listed');
});

test('checklists: run item by item, can be added to and trimmed, keep going between other requests, and the result can be logged', async () => {
  const { c, data, appended, actions } = rig();
  const start = c.checklistCommand({ type: 'cl-start', name: 'between matches' });
  assert.match(start.reply, /Between matches checklist, 6 items\..*1 of 6: Swap in a fresh battery/);
  assert.match(c.checklistControl({ op: 'done' }), /^2 of 6: Look over the robot/);
  assert.match(c.checklistControl({ op: 'later' }), /^3 of 6/);
  assert.match(c.checklistControl({ op: 'status' }), /1 done, 0 skipped, 5 to go/);
  let last;
  for (let i = 0; i < 4; i++) last = c.checklistControl({ op: 'skip' });
  assert.match(last, /^Back to: Look over the robot/, 'the postponed one comes round again');
  const end = c.checklistControl({ op: 'done' });
  assert.match(end, /Between matches checklist finished: 2 of 6 done\. Skipped: /);
  assert.match(end, /Say “log this”/);
  assert.equal(c.checklist, null);
  const logged = await c.logCommand({ type: 'log-add', note: '' });
  assert.match(logged.reply, /^Logged: Between matches checklist: finished/);
  assert.deepEqual(appended[0].slice(0, 3), [null, 'S'.repeat(44), 'A1']);
  assert.match(appended[0][3][0][0], /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.equal(appended[0][3][0][2], 'Relay');
  assert.equal(actions[0].tool, 'sheet_append');
  assert.match(c.checklistCommand({ type: 'cl-add', name: 'match day', item: 'spare bumpers' }).reply, /Added “Spare bumpers” to the match day checklist\. It has 13 items/);
  assert.equal(data['settings.robotics'].lists['match day'].at(-1), 'Spare bumpers');
  assert.equal(c.checklistLists()['pack up'].length, DEFAULT_LISTS['pack up'].length, 'the other lists are untouched');
  assert.match(c.checklistCommand({ type: 'cl-remove', name: 'match day', item: 'spare bumpers' }).reply, /Took “Spare bumpers” off/);
  assert.match(c.checklistCommand({ type: 'cl-remove', name: 'match day', item: 'unicorn' }).reply, /Nothing on the match day checklist/);
});

test('log this: needs a sheet and Google, takes the words said, else what is selected, and "set my log sheet" reads the link', async () => {
  assert.match((await rig({ sheet: false }).c.logCommand({ type: 'log-add', note: 'x' })).reply, /Which Google Sheet is your log/);
  assert.match((await rig({ google: false }).c.logCommand({ type: 'log-add', note: 'x' })).reply, /Connect your Google account/);
  assert.match((await rig().c.logCommand({ type: 'log-add', note: '' })).reply, /Say what to log/);
  const sel = rig({ selected: 'Battery 3 sagged' });
  assert.match((await sel.c.logCommand({ type: 'log-add', note: '' })).reply, /^Logged: Battery 3 sagged/);
  const id = 'x'.repeat(40);
  const set = rig({ sheet: false, clip: `https://docs.google.com/spreadsheets/d/${id}/edit` });
  assert.match((await set.c.logCommand({ type: 'log-sheet', id: null, fromClipboard: true })).reply, /Done/);
  assert.equal(set.data['settings.robotics'].sheetId, id);
  assert.match((await rig({ sheet: false, clip: 'hello' }).c.logCommand({ type: 'log-sheet', id: null, fromClipboard: true })).reply, /could not find a Google Sheet link/);
  assert.match((await set.c.logCommand({ type: 'log-where' })).reply, /ending xxxxxx/);
  const bad = rig();
  bad.c.googleApiIfConnected = () => ({ sheetAppend: async () => { throw new Error('Google says Relay is not allowed to do that.'); } });
  assert.match((await bad.c.logCommand({ type: 'log-add', note: 'x' })).reply, /could not add it to the sheet: Google says/);
});

test('explain this error: robotics errors get the known patterns, and errors about boards and ports get what is plugged in', () => {
  assert.equal(needsDevices('avrdude: stk500_recv(): programmer is not responding'), true);
  assert.equal(needsDevices("NameError: name 'x' is not defined"), false);
  const p = explainPrompt({ material: 'avrdude: stk500_getsync(): not in sync', devices: 'Boards and adapters: Arduino (Arduino Uno).' });
  assert.match(p, /Loop time of 0\.02s overrun/);
  assert.match(p, /what the Mac sees plugged in right now[^]*Arduino Uno/);
  assert.doesNotMatch(explainPrompt({ material: 'x' }), /plugged in right now/);
  assert.match(explainPrompt({ material: '' }), /Known patterns/);
});
