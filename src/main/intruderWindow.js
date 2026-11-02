const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

// The "this is not your computer" screen. One borderless window per display, each a blurred, red-tinted view of what is behind it with the alarm page on top.
// main.js decides when to show and hide it (see ownerGuard.js); the pages ask for the state, so they cannot be told anything else by anyone else.
class IntruderWindow {
  constructor() {
    this.wins = [];
    this.state = { active: false };
    ipcMain.handle('intruder:state', (e) => (this.wins.some((w) => !w.isDestroyed() && w.webContents === e.sender) ? this.state : { active: false }));
  }

  show({ seconds, demo = false }) {
    this.state = { active: true, mode: 'alarm', endsAt: Date.now() + seconds * 1000, total: seconds, demo };
    this.open();
  }

  // The standby screen: you stepped away. Calm, blue, no siren; it stays until main.js hides it.
  showAway() {
    if (this.state.active && this.state.mode === 'alarm') return;
    this.state = { active: true, mode: 'away', since: Date.now() };
    this.open();
  }

  open() {
    if (this.wins.some((w) => !w.isDestroyed())) return;
    this.wins = screen.getAllDisplays().map((d) => {
      const { x, y, width, height } = d.bounds;
      const win = new BrowserWindow({
        x, y, width, height, enableLargerThanScreen: true, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: false, show: false, skipTaskbar: true, focusable: false, type: 'panel',
        vibrancy: 'hud', visualEffectState: 'active',
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, autoplayPolicy: 'no-user-gesture-required' }
      });
      win.setBounds({ x, y, width, height }); // macOS keeps a new window below the menu bar unless the bounds are set again with enableLargerThanScreen
      win.setAlwaysOnTop(true, 'screen-saver', 2); win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); win.setHiddenInMissionControl?.(true);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', (e) => e.preventDefault());
      win.loadFile(path.join(__dirname, '../renderer/intruder.html'));
      win.once('ready-to-show', () => win.showInactive());
      return win;
    });
  }

  hide() {
    this.state = { active: false };
    for (const w of this.wins) { try { if (!w.isDestroyed()) w.close(); } catch { /* gone */ } }
    this.wins = [];
  }
}
module.exports = { IntruderWindow };
