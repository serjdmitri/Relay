// Found by the full audit: a phone answer to an old question approved whichever question was current, a second question replaced the first without
// closing it, a request that ended (for example by timing out) left its question open, and answering No dropped the next request on the list.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

function controller() {
  const orig = Module._load;
  Module._load = function (req, ...r) { return req === 'electron' ? { app: {}, BrowserWindow: class {}, screen: {}, clipboard: {}, desktopCapturer: {}, safeStorage: {}, systemPreferences: {}, nativeImage: {}, ipcMain: { handle() {} }, shell: {}, Notification: class {} } : orig.call(this, req, ...r); };
  let AskController;
  try { delete require.cache[require.resolve('../src/main/askController')]; ({ AskController } = require('../src/main/askController')); } finally { Module._load = orig; }
  const c = Object.create(AskController.prototype);
  const phone = [];
  Object.assign(c, {
    win: { setFocusable() {} }, push() {}, reveal() {}, sound() {}, statusChanged() {}, unattended: false, currentRemote: 'r1',
    inbound: { owns: () => true, askPhone: () => { let settle; const answer = new Promise((r) => { settle = r; }); const q = { id: `q${phone.length + 1}`, answer, settle }; phone.push(q); return q; } },
    hub: { answered: [], answer(id, yes, by) { this.answered.push([id, yes, by]); } }
  });
  return { c, phone };
}
const tick = () => new Promise((r) => setImmediate(r));

test('a phone answer to an old question never approves a newer one', async () => {
  const { c, phone } = controller();
  const first = c.askConfirm({ question: 'Delete the old drafts?' });
  const second = c.askConfirm({ question: 'Send the message to Sam?' });
  assert.equal(await first, false, 'opening a second question closes the first as No');
  phone[0].settle({ yes: true, by: 'phone' }); // a late Yes to the first question
  await tick();
  assert.ok(c.pendingConfirm, 'the second question is still waiting');
  phone[1].settle({ yes: false, by: 'phone' });
  assert.equal(await second, false);
});

test('a request that ends closes its open question, so a later Yes cannot run its tool', async () => {
  const { c } = controller();
  const asked = c.askConfirm({ question: 'Run this command?' });
  c.pendingConfirm(false); // what finish() now does first
  assert.equal(await asked, false);
  assert.equal(c.pendingConfirm, null);
  assert.equal(c.remoteConfirm(true), false, 'nothing is left for a phone Yes to approve');
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/main/askController.js'), 'utf8');
  assert.match(src, /finish\(entry, res\) \{\n\s*clearTimeout\(this\.ackTimer\);[\s\S]{0,300}if \(this\.pendingConfirm\) this\.pendingConfirm\(false\);/);
});

test('answering No keeps the next request on the list; Stop still empties it', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/main/askController.js'), 'utf8');
  assert.doesNotMatch(src, /if \(next && res\.status !== 'stopped'\)/);
  assert.match(src, /const next = this\.abort\?\.signal\?\.aborted \? null : this\.queue\.shift\(\);/);
  assert.match(src, /stop\(\) \{\n\s*this\.queue = \[\];/);
});
