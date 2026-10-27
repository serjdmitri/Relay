const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { parseWorkshopCommand, buildDemo, demoKey, DEMOS, WORKSHOP_STYLE } = require('../src/main/workshop');
const { profileFor } = require('../src/main/voiceProfile');
const { buildContext } = require('../src/main/agent/system-prompt');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

test('the phrases for workshop mode and the demos', () => {
  const P = parseWorkshopCommand;
  for (const t of ['workshop mode', 'start workshop mode', 'turn on teaching mode', 'workshop mode on']) assert.deepEqual(P(t), { type: 'workshop-on' }, t);
  for (const t of ['end workshop mode', 'turn off workshop mode', 'workshop mode off', 'stop teaching mode']) assert.deepEqual(P(t), { type: 'workshop-off' }, t);
  assert.deepEqual(P('what demos do you have'), { type: 'workshop-demos' });
  assert.deepEqual(P('show me how phishing works'), { type: 'workshop-demo', key: 'phishing' });
  assert.deepEqual(P('show me a hologram of how phishing works'), { type: 'workshop-demo', key: 'phishing' });
  assert.deepEqual(P('show me how a man in the middle attack works'), { type: 'workshop-demo', key: 'man in the middle' });
  assert.deepEqual(P('how does encryption work'), { type: 'workshop-demo', key: 'encryption' });
  assert.deepEqual(P('demo ddos'), { type: 'workshop-demo', key: 'ddos' });
  assert.deepEqual(P('show me how a firewall works'), { type: 'workshop-demo', key: 'firewall' });
  assert.deepEqual(P('show me how sql injection works'), { type: 'workshop-demo', key: 'sql injection' });
  assert.deepEqual(P('how does a hash work'), { type: 'workshop-demo', key: 'hashing' });
  for (const t of ['show me how photosynthesis works', 'show me a hologram of a skull', 'how does a car engine work', 'open notes', 'workshop']) assert.equal(P(t), null, t);
  assert.equal(demoKey('a phishing attack'), 'phishing');
});

const SHAPES = new Set(['sphere', 'box', 'cylinder', 'cone', 'torus', 'capsule', 'ring']);
test('every demo is a set of well-formed shapes that fit the hologram, with labels short enough to read, and a short explanation', () => {
  for (const key of Object.keys(DEMOS)) {
    const d = buildDemo(key);
    assert.ok(d.parts.length >= 5 && d.parts.length <= 30, `${key}: ${d.parts.length} parts`);
    for (const p of d.parts) {
      assert.ok(SHAPES.has(p.shape), `${key}: ${p.shape}`);
      assert.ok(Array.isArray(p.size) && p.size.every((v) => Number.isFinite(v) && v > 0), `${key} size`);
      for (const v of [p.position, p.rotation]) assert.ok(Array.isArray(v) && v.length === 3 && v.every(Number.isFinite), `${key} vec`);
      assert.ok(p.position.every((v) => Math.abs(v) <= 1.6), `${key}: ${p.position} is off the page`);
      assert.match(p.color, /^#[0-9a-f]{6}$/i);
      if (p.label) assert.ok(p.label.length <= 16, `${key}: label "${p.label}" is too long`);
    }
    assert.ok(d.parts.filter((p) => p.label).length >= 3, `${key} has labels`);
    assert.ok(d.explain.split(/[.!?]/).length <= 8 && d.explain.length < 520, `${key}: explanation length ${d.explain.length}`);
    assert.doesNotMatch(d.explain, /step[- ]by[- ]step|exploit code|payload/i, 'it teaches how it works and how to defend, not how to do it');
    assert.match(d.explain, /fix|protect|stopped|why|matters|means/i, `${key} says how to defend`);
  }
});

test('workshop mode makes the voice slow and calm and the wording simple, and goes back when it ends', () => {
  const base = { voice: 'auto', voiceRate: 'normal', voices: {} };
  assert.equal(profileFor('reply', base).rate, 'normal');
  const w = profileFor('reply', { ...base, workshop: { enabled: true } });
  assert.equal(w.rate, 'slower');
  assert.ok(w.volume <= 0.95);
  assert.match(buildContext({ style: WORKSHOP_STYLE }), /Teaching mode: the listener is a student about 10 to 13/);
  assert.match(WORKSHOP_STYLE, /Never give instructions for attacking real people or systems/);
  assert.doesNotMatch(buildContext({}), /Teaching mode/);
});

function controller() {
  const data = { 'settings.speakReplies': false };
  const shown = [];
  const c = Object.create(AskController.prototype);
  Object.assign(c, { store: { get: (k) => data[k], set: (k, v) => { data[k] = v; } }, onChange() {}, holos: { hideUnpinned() { shown.push('hide'); }, show: async (o) => { shown.push(o); } } });
  return { c, data, shown };
}

test('turning workshop mode on speaks replies and off puts that back as it was; demos appear as holograms and are explained', async () => {
  const { c, data, shown } = controller();
  assert.match((await c.workshopCommand({ type: 'workshop-on' })).reply, /Workshop mode is on/);
  assert.equal(data['settings.workshop.enabled'], true);
  assert.equal(data['settings.speakReplies'], true);
  assert.equal(data['settings.workshop.prevSpeak'], false);
  assert.match((await c.workshopCommand({ type: 'workshop-on' })).reply, /on/);
  assert.equal(data['settings.workshop.prevSpeak'], false, 'saying it twice does not forget how it was');
  const demo = await c.workshopCommand({ type: 'workshop-demo', key: 'phishing' });
  assert.match(demo.reply, /^Phishing is a trick/);
  assert.equal(shown[0], 'hide');
  assert.equal(shown[1].title, 'How phishing works');
  assert.equal(shown[1].items[0].kind, 'shapes');
  assert.ok(shown[1].items[0].parts.length >= 5);
  assert.match((await c.workshopCommand({ type: 'workshop-demos' })).reply, /phishing.*DDoS.*SQL injection/i);
  assert.match((await c.workshopCommand({ type: 'workshop-off' })).reply, /off/);
  assert.equal(data['settings.speakReplies'], false);
  assert.match((await c.workshopCommand({ type: 'workshop-off' })).reply, /was not on/);
});
