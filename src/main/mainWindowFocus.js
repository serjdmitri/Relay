// macOS menu-bar apps can show a window without becoming the keyboard-active app.
// Temporarily show the Dock icon while the main window is open, then restore
// the user's preference when it is hidden.
async function activateMainWindow({ app, win, platform = process.platform }) {
  if (!win || win.isDestroyed()) return;
  if (platform === 'darwin' && app.dock && !app.dock.isVisible()) await app.dock.show();
  if (win.isDestroyed() || !win.isVisible()) return;
  app.focus({ steal: true });
  win.focus();
}

function restoreDockPreference({ app, showInDock, platform = process.platform }) {
  if (platform === 'darwin' && app.dock && !showInDock) app.dock.hide();
}

module.exports = { activateMainWindow, restoreDockPreference };
