const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

// The "this is not your computer" screen. One borderless window per display, each a blurred, red-tinted view of what is behind it with the alarm page on top.
// main.js decides when to show and hide it (see ownerGuard.js); the pages ask for the state, so they cannot be told anything else by anyone else.
class IntruderWindow {
  // touchId(): is Touch ID available? fingerprint(): asks for it and, if it is you, stops the alarm (main.js); it throws when the fingerprint is not accepted.
  constructor({ touchId = () => false, fingerprint = async () => ({ ok: false }) } = {}) {
    Object.assign(this, { touchId, fingerprint });
    this.wins = [];
    this.state = { active: false };
    ipcMain.handle('intruder:fingerprint', async (e) => {
      if (this.busy || !this.state.active || !this.wins.some((w) => !w.isDestroyed() && w.webContents === e.sender)) return { ok: false };
      this.busy = true; this.hold();
      try { const r = await this.fingerprint(); if (!r?.ok) this.release(); return { ok: !!r?.ok }; }
      catch (err) { this.release(); return { ok: false, error: /cancel/i.test(String(err?.message)) ? 'Cancelled.' : 'Fingerprint not recognised.' }; }
      finally { this.busy = false; }
    });
    ipcMain.handle('intruder:state', (e) => (this.wins.some((w) => !w.isDestroyed() && w.webContents === e.sender) ? this.state : { active: false }));
  }

  show({ seconds, demo = false }) {
    this.state = { active: true, touchId: this.touchId(), mode: 'alarm', endsAt: Date.now() + seconds * 1000, total: seconds, demo };
    this.open();
  }

  // The standby screen: you stepped away. Calm, blue, no siren; it stays until main.js hides it.
  showAway() {
    if (this.state.active && this.state.mode === 'alarm') return;
    this.state = { active: true, touchId: this.touchId(), mode: 'away', since: Date.now() };
    this.open();
  }

  // While the system's Touch ID sheet is up, the alarm windows step aside (and the siren stops), so the sheet is not hidden behind them; they come back if it fails.
  hold() { this.state = { ...this.state, paused: true }; for (const w of this.wins) { try { if (!w.isDestroyed()) w.hide(); } catch { /* gone */ } } }
  release() { if (!this.state.active) return; this.state = { ...this.state, paused: false }; for (const w of this.wins) { try { if (!w.isDestroyed()) w.showInactive(); } catch { /* gone */ } } }

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
