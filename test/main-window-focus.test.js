const test = require('node:test');
const assert = require('node:assert/strict');
const { activateMainWindow, restoreDockPreference } = require('../src/main/mainWindowFocus');

test('a hidden Dock icon is temporarily shown before activating the main window', async () => {
  const events = [];
  const app = { dock: { isVisible: () => false, show: async () => events.push('show'), hide: () => events.push('hide') }, focus: () => events.push('app focus') };
  const win = { isDestroyed: () => false, isVisible: () => true, focus: () => events.push('window focus') };
  await activateMainWindow({ app, win, platform: 'darwin' });
  assert.deepEqual(events, ['show', 'app focus', 'window focus']);
  restoreDockPreference({ app, showInDock: false, platform: 'darwin' });
  assert.equal(events.at(-1), 'hide');
});

test('closing the window during Dock activation does not reactivate it', async () => {
  let destroyed = false, focused = false;
  const app = { dock: { isVisible: () => false, show: async () => { destroyed = true; } }, focus: () => { focused = true; } };
  const win = { isDestroyed: () => destroyed, isVisible: () => true, focus: () => { focused = true; } };
  await activateMainWindow({ app, win, platform: 'darwin' });
  assert.equal(focused, false);
});
