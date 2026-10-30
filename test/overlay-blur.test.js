const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  return name === 'electron' ? { app: {}, BrowserWindow: class {}, screen: { getCursorScreenPoint: () => ({}), getDisplayNearestPoint: () => ({}) } } : original.call(this, name, ...args);
};
let Overlay;
try { ({ Overlay } = require('../src/main/overlay')); } finally { Module._load = original; }

test('HUD blur is optional, follows settings and is removed when HUD hides', () => {
  let enabled = false;
  const effects = [];
  const entry = { win: { isDestroyed: () => false, setVibrancy: (value) => effects.push(value) } };
  const overlay = new Overlay({ isEnabled: () => true, getBlur: () => enabled });
  overlay.entry = () => entry;
  overlay.refresh = () => {};
  overlay.send = () => {};
  overlay.hudInteractive = () => {};
  overlay.hud({ state: 'listening' });
  enabled = true;
  overlay.refreshHudBlur();
  overlay.hud({ state: 'working' });
  overlay.hud({ hide: true });
  clearTimeout(entry.hudTimer);
  assert.deepEqual(effects, [null, 'hud', null]);
  assert.equal(overlay.hudEntry, null);
});
