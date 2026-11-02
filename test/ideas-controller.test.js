const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

function rig(data = {}) {
  const c = Object.create(AskController.prototype);
  Object.assign(c, { store: { get: (k) => data[k], set: (k, v) => { data[k] = v; } }, onChange: () => {} });
  return { c, data };
}

test('a skill the model saves waits for approval, and only an approved one is found', () => {
  const { c, data } = rig();
  const msg = c.saveSkill({ name: 'Top memory apps', goal: 'show the apps using the most memory', kind: 'shell', code: 'ps -Ao comm,rss | sort -k2 -nr | head -5' });
  assert.match(msg, /waits for the user to approve/);
  assert.equal(data.skills[0].status, 'pending');
  assert.match(c.findSkillsFor('apps using the most memory'), /No saved skill fits/);
  assert.equal(c.memoryV2Act('skill-approve', data.skills[0].id).ok, true);
  assert.match(c.findSkillsFor('apps using the most memory'), /ps -Ao comm,rss/);
  assert.equal(data.skills[0].uses, 1);
  assert.equal(c.memoryV2Act('skill-delete', data.skills[0].id).ok, true);
  assert.deepEqual(data.skills, []);
});

test('a script with a secret is refused when saving', () => {
  const { c, data } = rig();
  assert.match(c.saveSkill({ name: 'Call api', goal: 'call the service', kind: 'shell', code: 'curl -H "api_key=abcdefgh12345" https://x' }), /secret/);
  assert.equal(data.skills, undefined);
});

test('recall_memory finds facts the request did not have room for', () => {
  const { c } = rig({ memories: [{ id: '1', text: 'Sister Anna lives in Boston', ts: 1 }] });
  assert.equal(c.recallFacts('anna boston'), '- Sister Anna lives in Boston');
  assert.equal(c.recallFacts('zebra'), 'Nothing remembered matches that.');
});

test('the council command runs three voices through askOnce and speaks the verdict', async () => {
  const { c } = rig();
  c.askOnce = async () => '{"vote":"approve","reason":"fine"}';
  const out = await c.councilCommand({ question: 'buy it', mode: 'quick' });
  assert.match(out, /^The council says yes, 3 to 0, unanimous\./);
});

test('the quick path hands notifications, modes, youtube and the council to their services', async () => {
  const { runQuick, parseQuick } = require('../src/main/quick');
  const seen = [];
  const ctx = {
    notifications: async (cmd) => { seen.push(['n', cmd.app]); return 'No recent notifications.'; },
    modes: { has: () => true, active: null, start: async (n) => { seen.push(['m', n]); return { reply: 'Gaming mode is on.' }; } },
    youtube: { run: async (cmd) => { seen.push(['y', cmd.op]); return { reply: 'Paused.' }; } },
    council: async (cmd) => { seen.push(['c', cmd.mode]); return 'The council says yes.'; }
  };
  const mac = {};
  for (const [text, key] of [['read my notifications', 'n'], ['start gaming mode', 'm'], ['pause youtube', 'y'], ['ask the council whether I should go', 'c']]) {
    const q = parseQuick(text);
    assert.ok(q, text);
    const r = await runQuick(q, mac, ctx);
    assert.ok(r && r.reply, text);
    assert.equal(seen.at(-1)[0], key);
  }
  // "the video" with no YouTube tab is left for the other players
  const weak = parseQuick('pause the video');
  assert.equal(await runQuick(weak, mac, { youtube: { run: async () => ({ reply: 'none', miss: true }) } }), weak.type === 'youtube' ? null : await runQuick(weak, mac, {}));
  // a mode that is not yours is left for the rest of Relay
  assert.equal(await runQuick(parseQuick('start gaming mode'), mac, { modes: { has: () => false, start: async () => null } }), null);
});
