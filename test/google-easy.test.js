const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { isGoogleSource, googleCalendars, STEPS, findCredentialFile, parseGoogleSetup } = require('../src/main/connectors/googleEasy');
const { registerGoogleConnections } = require('../src/main/connectors/googleConnection');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('a Google calendar among the Mac\'s calendars is recognised, and iCloud is not', () => {
  assert.equal(isGoogleSource({ account: 'Gmail', name: 'Home' }), true);
  assert.equal(isGoogleSource({ account: 'Google', name: 'Work' }), true);
  assert.equal(isGoogleSource({ account: 'iCloud', name: 'sergey@gmail.com' }), true, 'named after a gmail address');
  assert.equal(isGoogleSource({ account: 'iCloud', name: 'Home' }), false);
  assert.deepEqual(googleCalendars(null), []); assert.equal(googleCalendars([{ account: 'iCloud', name: 'Home' }, { account: 'Gmail', name: 'x' }]).length, 1);
});

test('the guided setup has four steps that open only Google Cloud pages, the first enabling all five APIs at once', () => {
  assert.equal(STEPS.length, 4);
  for (const s of STEPS) assert.match(s.url, /^https:\/\/console\.cloud\.google\.com\//);
  assert.match(STEPS[1].url, /gmail\.googleapis\.com,calendar-json\.googleapis\.com,drive\.googleapis\.com,docs\.googleapis\.com,sheets\.googleapis\.com/);
  assert.match(STEPS[2].text, /Publish app/, 'so the sign-in does not expire after seven days');
});

test('the credentials file Google just made is found by name, size and age; old or odd files are ignored', () => {
  const now = 1e12, f = (name, ageMin, size = 400) => ({ name, size, mtimeMs: now - ageMin * 60000 });
  assert.equal(findCredentialFile([f('client_secret_123-abc.apps.googleusercontent.com.json', 2)], now).name, 'client_secret_123-abc.apps.googleusercontent.com.json');
  assert.equal(findCredentialFile([f('client_secret (1).json', 1), f('client_secret_old.json', 5)], now).name, 'client_secret (1).json', 'the newest');
  assert.equal(findCredentialFile([f('client_secret_x.json', 40)], now), null, 'too old');
  assert.equal(findCredentialFile([f('client_secret_x.json', 1, 999999)], now), null, 'too big');
  assert.equal(findCredentialFile([f('notes.json', 1), f('client_secret.txt', 1)], now), null);
  assert.equal(findCredentialFile([], now), null);
});

test('the words', () => {
  for (const t of ['connect google', 'Jarvis, set up my Google calendar', 'link my gmail', 'connect my google account to relay']) assert.deepEqual(parseGoogleSetup(t), { type: 'google-setup' }, t);
  for (const t of ['google it', 'open gmail', 'what is on my google calendar']) assert.equal(parseGoogleSetup(t), null, t);
});

function rig(files) {
  const handlers = {}, store = new Map(), opened = [], changes = [];
  const win = { webContents: {} };
  const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };
  let tick = null;
  const clientJson = JSON.stringify({ installed: { client_id: 'abc.apps.googleusercontent.com', client_secret: 'GOCSPX-secret', redirect_uris: ['http://localhost'], auth_uri: 'https://accounts.google.com/o/oauth2/auth', token_uri: 'https://oauth2.googleapis.com/token' } });
  const fsImpl = { readdirSync: () => Object.keys(files), statSync: (p) => files[path.basename(p)], readFileSync: () => clientJson };
  const storeApi = { get: (k) => store.get(k), set: (k, v) => store.set(k, v), flush() {} };
  registerGoogleConnections({ ipcMain, store: storeApi, encryptKey: (v) => 'enc:' + v, decryptKey: (v) => String(v || '').replace(/^enc:/, ''), dialog: {}, shell: { openExternal: (u) => opened.push(u) }, getWindow: () => win, onChange: () => changes.push(1), getApi: () => null, resetApi() {}, macCalendars: async () => [{ account: 'Gmail', name: 'Home', writable: true }], downloadsDir: '/dl', fsImpl, setTimer: (fn) => { tick = fn; return 1; }, clearTimer: () => { tick = null; } });
  const call = (name, ...a) => handlers['connectors:google:' + name]({ sender: win.webContents }, ...a);
  return { call, opened, store, changes, tick: async () => { await tick?.(); }, running: () => tick !== null, handlers, win };
}

test('the Mac check finds a Google calendar; the guide opens only its own steps and watches Downloads until the file appears, then saves it', async () => {
  const files = {}; const r = rig(files);
  assert.deepEqual((await r.call('mac')).google.map((c) => c.name), ['Home']);
  assert.deepEqual(await r.call('guide-open', 99), { ok: false }); assert.deepEqual(r.opened, []);
  const g = await r.call('guide'); assert.equal(g.steps.length, 4);
  await r.call('guide-open', 1); assert.match(r.opened[0], /enableapi/);
  assert.match((await r.call('guide-status')).message, /Waiting/);
  await r.tick(); assert.equal(r.store.get('settings.connectors.google.clientId'), undefined, 'nothing yet');
  files['client_secret_abc.json'] = { size: 500, mtimeMs: Date.now() - 1000 };
  await r.tick();
  assert.equal(r.store.get('settings.connectors.google.clientId'), 'abc.apps.googleusercontent.com');
  assert.equal(r.store.get('settings.connectors.google.clientSecretEnc'), 'enc:GOCSPX-secret');
  assert.ok(!/Waiting/.test((await r.call('guide-status')).message), 'moved on from waiting');
  await r.call('guide-stop'); assert.equal(r.running(), false);
});

test('the setup calls are only answered to the Connections window, and the UI and voice are wired', async () => {
  const r = rig({}); const other = await r.handlers['connectors:google:guide']({ sender: {} });
  assert.equal(other.ok, false);
  assert.match(read('src/renderer/connections.js'), /Fastest way: add Google to your Mac/); assert.match(read('src/renderer/connections.js'), /Guided setup for Gmail, Drive, Docs and Sheets/);
  assert.match(read('src/main/askController.js'), /parseGoogleSetup\(effective\)/);
  assert.match(read('native/relay-cal.swift'), /case "calendars":/);
});
