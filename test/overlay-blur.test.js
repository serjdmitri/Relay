const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const effects = [];
const original = Module._load;
Module._load = function (name, ...args) {
  return name === 'electron' ? { app: {}, BrowserWindow: class { constructor(opts) { effects.push(opts.vibrancy); } isDestroyed(){return false} setIgnoreMouseEvents(){} setAlwaysOnTop(_on,_level,relative){effects.push(relative)} setVisibleOnAllWorkspaces(){} showInactive(){effects.push('show')} hide(){effects.push('hide')} }, screen: { getCursorScreenPoint: () => ({}), getDisplayNearestPoint: () => ({}) } } : original.call(this, name, ...args);
};
let Overlay;
try { ({ Overlay } = require('../src/main/overlay')); } finally { Module._load = original; }

test('HUD blur is optional, follows settings and is removed when HUD hides', () => {
  let enabled = false;
  effects.length = 0;
  const entry = { win: { isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0 }), setVibrancy: (value) => effects.push(value) } };
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
  assert.deepEqual(effects, ['hud', -2, 'show', 'hide']);
  assert.equal(overlay.hudEntry, null);
});
